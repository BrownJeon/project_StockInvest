/**
 * sell-proposal-preview — 매도 제안 **1단계 읽기 전용 시뮬레이션** (T-055 §5.1).
 *
 * `runExitEngine` 이 보유 종목마다 이미 가진 값(잔고·시세·`position_state`)으로
 * `evaluateSellProposal` 을 돌려 결과를 **두 곳에만** 남긴다:
 *
 *  1. `eval_funnel` 게이트 `sell_proposal_preview` (verdict pass|skip) — 틱마다, 종목마다
 *  2. 하루 1회(시장별 거래일 1회) 텔레그램 요약 + KIS 잔고 원본 대조
 *
 * ## 🔴 이 모듈이 하지 않는 것 (소스 수준 테스트로 고정)
 *
 * - 시그널 생성·주문 송신·승인 — `signals/service`·`safety/dry-run`·`approval-*` 를 import 하지 않는다
 * - KIS 호출 — `exchanges/*` 를 import 하지 않는다. 잔고·시세는 호출자(엔진 틱)가 이미 조회한 값이다
 * - `position_state`·쿨다운·시그널 테이블 쓰기 — 쓰는 것은 `system_config` 의 일일 표식 키 2개뿐
 *
 * ## 하루 1회 — 지속 표식 (프로세스 재시작·다중 프로세스에 멱등)
 *
 * 프로세스 메모리 스로틀(`sendAlertThrottled`)은 재시작 때 초기화돼 같은 날 요약이 다시 나간다.
 * 그래서 표식을 DB 에 둔다: `system_config.sell_proposal_preview_report_<market>` = 마지막으로
 * 요약을 **선점한** 거래일(JSON 문자열 `"YYYY-MM-DD"`).
 *
 *   ① `INSERT IGNORE` 로 행을 보장한다 (값 `""`)
 *   ② `UPDATE … SET value=<오늘> WHERE key=? AND value <> <오늘>` — 영향 행 1 이면 이 프로세스가
 *      오늘 요약의 주인이다. 0 이면 이미 누군가 보냈다.
 *
 * ②는 행 잠금 아래에서 조건을 다시 평가하므로 두 프로세스가 동시에 와도 한쪽만 1 을 받는다.
 * mysql2 기본 플래그(`FOUND_ROWS`)에서 `affectedRows` 는 "조건에 맞은 행 수"인데, 조건에
 * `value <> <오늘>` 이 들어 있어 "맞은 행 = 실제로 바꾼 행"이므로 플래그 설정과 무관하게 정확하다.
 * (`INSERT … ON DUPLICATE KEY UPDATE` 한 문장으로 하면 FOUND_ROWS 아래에서 "새로 넣음(1)"과
 *  "이미 오늘 값(1)"을 구분할 수 없어 쓰지 않았다.)
 *
 * 선점 후 전송이 **모든 채널에서 실패**하거나 전송 호출이 **예외로 끝나면** 표식을 되돌려 다음 틱에
 * 다시 시도한다(거래일당 최대 {@link MAX_SEND_RETRIES}회 — 텔레그램 400 처럼 재시도해도 같은 실패가
 * 매 틱 반복되지 않게). 선점 자체가 DB 오류면 보내지 않는다 — 중복 발송보다 하루 누락이 낫다.
 * 전달 0·실패 0(채널 없음/자격 증명 미설정)도 같은 상한을 공유해 되돌리고 재시도한다(T-060 — 예전에는
 * 표식이 남은 채 조용히 끝나 그날 요약이 영구 누락됐다). 전송 시도마다 결과 1줄을 로그로 남긴다
 * (`요약 결과 <outcome> (…)` — 채널 이름만, 토큰·본문·수량 없음).
 *
 * 알려진 한계(수용): ① 선점 뒤 전송 전에 프로세스가 강제 종료되면 그날 요약은 누락된다(at-most-once).
 * ② 재시도 횟수(`sendRetries`)는 프로세스 로컬이라 재시작·다중 프로세스에서는 상한이 그만큼 늘어난다
 * (운영 `instances:1`, 최악은 정보성 요약 중복 몇 건). 둘 다 읽기 전용 관측 리포트라 수용했다.
 *
 * "거래일"은 시장 현지 날짜다 — 국내 = KST, 해외 = 미국 동부(ET). 해외 정규장(ET 09:30~16:00)은
 * KST 로는 자정을 넘으므로 KST 날짜를 쓰면 한 세션에 요약이 두 번 나간다.
 *
 * ## 알림 실패 격리
 *
 * 엔진은 `finish()` 를 **기다리지 않는다**(fire-and-forget). 선점 쿼리·종목명 조회·전송이 느리거나
 * 실패해도 틱(청산 평가·진입 평가·eval_funnel flush)은 그대로 진행된다. `observe()` 는 동기이며
 * 절대 던지지 않는다.
 */
import type { ResultSetHeader } from 'mysql2';
import { getPool } from '@/lib/db';
import { dispatchAlert, getSymbolLabel, type AlertLevel } from '@/lib/notify';
import type { AlertDispatch } from '@/lib/notify';
import { escapeAlertText } from '@/lib/notify/escape';
import type { Market } from '@/lib/exchanges/kis-symbols';
import type { Ticker } from '@/lib/exchanges/types';
import type { PositionState } from './position-state';
import type { FunnelGate } from './eval-funnel-labels';
import type { EvalFunnelRecorder } from './eval-funnel';
import {
  evaluateSellProposal,
  SELL_PROPOSAL_STRATEGY_ID,
  type SellProposalEvaluation,
  type SellProposalPolicy,
  type SellProposalSkipReason,
} from './sell-proposal';
import { readSellProposalPreviewPolicy, type SellProposalPreviewSwitch } from './sell-proposal-policy';

export const SELL_PROPOSAL_PREVIEW_GATE: FunnelGate = 'sell_proposal_preview';

/** 일일 요약 표식 키 — 시장별 1개. 값 = 마지막으로 요약을 선점한 거래일(JSON 문자열). */
export function reportMarkerKey(market: Market): string {
  return `sell_proposal_preview_report_${market}`;
}

/** 요약 전에 "평가 못 한 종목"이 있으면 다음 틱까지 미루는 최대 횟수 (5분 틱 기준 15분). */
export const MAX_INCOMPLETE_DEFERRALS = 3;
/** 모든 채널 전송 실패 시 표식을 되돌려 재시도하는 최대 횟수 (거래일·시장별). 전달 0·실패 0(no_channel) 경로도 같은 상한을 공유한다(T-060). */
export const MAX_SEND_RETRIES = 3;
/** 요약 본문에 나열할 최대 종목 수 (텔레그램 4,096자 한도) */
const MAX_LISTED = 30;

/**
 * 정책 판독 상한(ms). 엔진은 열기를 `await` 하므로(이 판독 뒤에야 보유 종목 루프가 시작된다) 이 값이
 * 이 기능이 청산 평가 흐름에 **새로 더하는 최대 대기**다(T-055 Codex C2 medium).
 *
 * 2초 근거: 판독은 PK `IN` 4키 SELECT 1회라 정상이면 [추측] 수~수십 ms 다. 5분 틱 안에서 2초는 무시할 만한
 * 지연이고, 그보다 오래 걸린다면 DB 가 이미 이상한 상태라 미리보기(정보성)는 그 틱에 빠져도 된다.
 * mysql2 의 연결 대기(`connectTimeout` 기본 10초)보다 훨씬 짧게 잡아, 풀이 막혔을 때 엔진이 이 지점에서
 * 10초씩 서지 않게 한다. 시간 초과 = 미리보기만 비활성, 늦게 온 결과는 버린다.
 */
export const POLICY_READ_TIMEOUT_MS = 2000;

/** 시장 현지 거래일 `YYYY-MM-DD` — 국내 KST, 해외 미국 동부. */
export function sessionDateFor(market: Market, now: Date): string {
  const timeZone = market === 'domestic' ? 'Asia/Seoul' : 'America/New_York';
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

// ─── 지속 표식 — 기본 구현 (DB) ──────────────────────────────────────────────

/** 오늘(시장 거래일) 요약을 이 프로세스가 선점하면 true. DB 오류는 그대로 던진다(호출부가 "보내지 않음"으로 처리). */
export async function claimDailyReport(market: Market, sessionDate: string): Promise<boolean> {
  const pool = getPool();
  const key = reportMarkerKey(market);
  const today = JSON.stringify(sessionDate);
  await pool.query('INSERT IGNORE INTO system_config (`key`, value) VALUES (?, ?)', [key, JSON.stringify('')]);
  const [res] = await pool.query<ResultSetHeader>(
    'UPDATE system_config SET value = ? WHERE `key` = ? AND value <> ?',
    [today, key, today],
  );
  return Number((res as ResultSetHeader | undefined)?.affectedRows ?? 0) === 1;
}

/** 선점을 되돌린다 — 아직 오늘 값일 때만(다른 날짜로 넘어갔으면 건드리지 않는다). */
export async function releaseDailyReport(market: Market, sessionDate: string): Promise<void> {
  const today = JSON.stringify(sessionDate);
  await getPool().query(
    'UPDATE system_config SET value = ? WHERE `key` = ? AND value = ?',
    [JSON.stringify(''), reportMarkerKey(market), today],
  );
}

// ─── 프로세스 로컬 상태 (DB 표식의 **보조** — 매 틱 선점 쿼리를 줄일 뿐, 권위는 DB) ────────────

const knownDone = new Map<Market, string>();
const deferrals = new Map<string, number>();
const sendRetries = new Map<string, number>();
/**
 * 진행 중인 요약 처리(`runKey` = `${market}:${sessionDate}`) — T-060 Codex C2 high.
 * 엔진은 `finish()` 를 기다리지 않으므로, 앞 틱의 전송이 느려 한 틱을 넘기면 같은 프로세스 안에서 다음 틱의
 * `finish()` 가 겹친다. 겹친 쪽이 선점에서 져 `claim_lost` 로 `knownDone` 을 세우면, 앞 쪽이 뒤이어 표식을
 * 되돌려도(전달 0·실패 0/전송 실패) 이 프로세스는 다시 시도하지 않아 그날 요약이 누락된다. 그래서 같은
 * runKey 가 진행 중이면 DB 를 건드리지 않고 `in_flight` 로 바로 돌아간다. 다른 프로세스와의 진짜 경쟁은
 * 여전히 DB 선점(`claim_lost`)이 가른다.
 */
const inFlight = new Set<string>();
/** `in_flight` 경고를 이미 남긴 runKey — 전송이 멈춘 경우 매 틱 같은 경고가 쌓이지 않게 runKey 당 1회 (T-060 low-7) */
const inFlightWarned = new Set<string>();

/** 테스트용 — 프로세스 로컬 상태 초기화 (재시작 흉내). */
export function resetSellProposalPreviewState(): void {
  knownDone.clear();
  deferrals.clear();
  sendRetries.clear();
  inFlight.clear();
  inFlightWarned.clear();
}

// ─── 관측 ───────────────────────────────────────────────────────────────────

/** 엔진 틱이 **이미 가진** 값. 이 모듈은 아무것도 다시 조회하지 않는다. */
export interface PreviewObservation {
  symbol: string;
  ticker: Ticker;
  state: PositionState;
  /** 이번 틱 `getBalancesDetailed()` 의 이 종목 행 (KIS 잔고 원본 — 수량·매입평균) */
  kis: { qty: number; avgPrice?: number };
}

export interface PreviewItem {
  symbol: string;
  evaluation: SellProposalEvaluation;
  /** 원화(해외는 환산가). USD 원가는 통화 경계 고정(T-035 fence) 때문에 1단계에서 다루지 않는다 */
  price: number;
  stateEntry: number;
  stateQty: number | null;
  kisQty: number;
  kisAvgPrice: number | null;
}

/** eval_funnel 기록기 중 이 모듈이 쓰는 부분만 (테스트 주입용) */
export type PreviewRecorder = Pick<EvalFunnelRecorder, 'pass' | 'skip'>;

export type SellProposalReportOutcome =
  | 'sent'
  /** 전달 0·실패 0(채널 없음/미설정)이 재시도 상한까지 이어져 그날을 포기함 — 표식 유지 (T-060) */
  | 'no_channel'
  /** 전달 0·실패 0 — 표식을 되돌려 다음 틱에 재시도 ({@link MAX_SEND_RETRIES} 공유, T-060) */
  | 'no_channel_released'
  | 'already_sent'
  /** 같은 프로세스에서 같은 거래일·시장의 요약 처리가 아직 진행 중 — DB·로컬 완료 표시를 건드리지 않음 (T-060) */
  | 'in_flight'
  | 'claim_lost'
  | 'claim_error'
  | 'deferred_incomplete'
  | 'send_failed_released'
  | 'send_failed_kept'
  | 'error';

export interface SellProposalPreviewDeps {
  readPolicy: () => Promise<SellProposalPreviewSwitch>;
  claim: (market: Market, sessionDate: string) => Promise<boolean>;
  release: (market: Market, sessionDate: string) => Promise<void>;
  dispatch: (level: AlertLevel, title: string, body: string) => Promise<AlertDispatch>;
  /** 알림에 그대로 넣어도 안전한(이스케이프된) 종목 표시명 */
  symbolLabel: (symbol: string) => Promise<string>;
  now: () => Date;
  /** 정책 판독 상한(ms) — 기본 {@link POLICY_READ_TIMEOUT_MS} */
  policyTimeoutMs: number;
}

const defaultDeps: SellProposalPreviewDeps = {
  readPolicy: readSellProposalPreviewPolicy,
  claim: claimDailyReport,
  release: releaseDailyReport,
  dispatch: (level, title, body) => dispatchAlert(level, title, body),
  symbolLabel: getSymbolLabel,
  now: () => new Date(),
  policyTimeoutMs: POLICY_READ_TIMEOUT_MS,
};

export interface SellProposalPreviewRun {
  readonly market: Market;
  readonly policy: SellProposalPolicy;
  /** 보유 1종목 판정 + eval_funnel 기록. 동기, 절대 throw 하지 않는다. */
  observe(o: PreviewObservation, rec: PreviewRecorder): void;
  /** 하루 1회 요약. 엔진은 기다리지 않는다. 절대 reject 하지 않는다. */
  finish(): Promise<SellProposalReportOutcome>;
  /** 테스트·진단용 */
  readonly items: readonly PreviewItem[];
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** 판독에 상한을 둔다. 시간 초과면 null. 늦게 도착한 결과·예외는 버리고, 타이머는 항상 정리한다. */
async function readPolicyWithTimeout(
  d: SellProposalPreviewDeps,
  market: Market,
): Promise<SellProposalPreviewSwitch | null> {
  const timeoutMs = d.policyTimeoutMs;
  let timer: ReturnType<typeof setTimeout> | undefined;
  // 동기 throw 도 reject 로 바꾼다. 시간 초과 뒤 늦게 reject 돼도 unhandled 가 되지 않는다 —
  // Promise.race 가 이미 이 promise 에 처리기를 달아 두었기 때문이다(테스트로 고정). 늦은 결과는 아무 데도 쓰이지 않는다.
  const pending = Promise.resolve().then(() => d.readPolicy());
  const timedOut = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), timeoutMs);
    (timer as { unref?: () => void }).unref?.();
  });
  try {
    const r = await Promise.race([pending, timedOut]);
    if (r === 'timeout') {
      console.warn(`[sell-proposal-preview:${market}] 정책 판독 ${timeoutMs}ms 초과 — 이번 틱 미리보기 생략 (청산 엔진 영향 없음)`);
      return null;
    }
    return r;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * 이번 틱의 미리보기를 연다. 스위치 꺼짐·정책 무효·판독 실패면 null (= 아무것도 하지 않음).
 * 절대 throw 하지 않는다.
 */
export async function openSellProposalPreview(
  market: Market,
  heldCount: number,
  deps: Partial<SellProposalPreviewDeps> = {},
): Promise<SellProposalPreviewRun | null> {
  const d: SellProposalPreviewDeps = { ...defaultDeps, ...deps };
  let sw: SellProposalPreviewSwitch | null;
  try {
    sw = await readPolicyWithTimeout(d, market);
  } catch (e) {
    console.warn(`[sell-proposal-preview:${market}] 정책 판독 예외 — 미리보기 생략: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
  if (!sw || sw.enabled !== true || !sw.policy) return null;
  const policy = sw.policy;
  const items: PreviewItem[] = [];

  const observe = (o: PreviewObservation, rec: PreviewRecorder): void => {
    try {
      const evaluation = evaluateSellProposal(o.state, o.ticker, policy, null);
      const item: PreviewItem = {
        symbol: o.symbol,
        evaluation,
        price: Number(o.ticker?.price),
        stateEntry: Number(o.state?.entryPrice),
        stateQty: num(o.state?.qty),
        kisQty: Number(o.kis?.qty),
        kisAvgPrice: num(o.kis?.avgPrice),
      };
      const detail = {
        simulation: true,
        kind: 'stop_loss',
        pnlPct: evaluation.pnlPct,
        thresholdPct: evaluation.thresholdPct,
        ...(evaluation.verdict === 'pass' ? { trigger: evaluation.trigger } : { skipReason: evaluation.reason }),
        price: item.price,
        entry: item.stateEntry,
        qty: item.stateQty,
        kisQty: item.kisQty,
        kisAvgPrice: item.kisAvgPrice,
      };
      const ev = {
        symbol: o.symbol, side: 'sell' as const, strategyId: SELL_PROPOSAL_STRATEGY_ID,
        reason: evaluation.verdict === 'pass' ? evaluation.trigger : evaluation.reason,
        detail,
      };
      if (evaluation.verdict === 'pass') rec.pass(SELL_PROPOSAL_PREVIEW_GATE, ev);
      else rec.skip(SELL_PROPOSAL_PREVIEW_GATE, ev);
      items.push(item);
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      console.error(`[sell-proposal-preview:${market}] ${o?.symbol} 판정 예외 (청산 엔진·틱 영향 없음): ${error}`);
      try {
        rec.skip(SELL_PROPOSAL_PREVIEW_GATE, {
          symbol: o?.symbol ?? null, side: 'sell', strategyId: SELL_PROPOSAL_STRATEGY_ID,
          reason: 'preview_error', detail: { simulation: true, error: error.slice(0, 300) },
        });
      } catch { /* 계측 실패는 무시 */ }
    }
  };

  const finish = async (): Promise<SellProposalReportOutcome> => {
    try {
      return await finishReport(market, heldCount, policy, items, d);
    } catch (e) {
      console.error(`[sell-proposal-preview:${market}] 요약 처리 예외 (틱 영향 없음): ${e instanceof Error ? e.message : String(e)}`);
      return 'error';
    }
  };

  return { market, policy, observe, finish, items };
}

async function finishReport(
  market: Market,
  heldCount: number,
  policy: SellProposalPolicy,
  items: readonly PreviewItem[],
  d: SellProposalPreviewDeps,
): Promise<SellProposalReportOutcome> {
  const sessionDate = sessionDateFor(market, d.now());
  const runKey = `${market}:${sessionDate}`;
  if (knownDone.get(market) === sessionDate) return 'already_sent';
  if (inFlight.has(runKey)) {
    // 전송이 멈춘(hang) 경우도 운영 로그에 드러나게 — runKey(시장·거래일) 당 1회. 상태(DB·카운터)는 건드리지 않는다.
    if (!inFlightWarned.has(runKey)) {
      inFlightWarned.add(runKey);
      console.warn(`[sell-proposal-preview:${market}] 이전 요약 전송이 아직 진행 중 — 거래일 ${sessionDate} 중복 시도 보류(전송이 멈췄다면 오늘 요약이 누락될 수 있음)`);
    }
    return 'in_flight';
  }
  inFlight.add(runKey);
  try {
    // 미루기 판단·선점·전송·되돌리기 전 구간이 가드 안이다. 예외·조기 return 에서도 finally 가 비운다.
    return await finishReportGuarded(market, heldCount, policy, items, d, sessionDate, runKey);
  } finally {
    inFlight.delete(runKey);
  }
}

async function finishReportGuarded(
  market: Market,
  heldCount: number,
  policy: SellProposalPolicy,
  items: readonly PreviewItem[],
  d: SellProposalPreviewDeps,
  sessionDate: string,
  runKey: string,
): Promise<SellProposalReportOutcome> {
  // 평가 못 한 종목이 있으면(시세 레이트리밋 등) 몇 틱 미뤄 완전한 요약을 노린다.
  const missing = Math.max(0, heldCount - items.length);
  if (missing > 0) {
    const n = deferrals.get(runKey) ?? 0;
    if (n < MAX_INCOMPLETE_DEFERRALS) {
      deferrals.set(runKey, n + 1);
      return 'deferred_incomplete';
    }
  }

  let claimed: boolean;
  try {
    claimed = await d.claim(market, sessionDate);
  } catch (e) {
    console.warn(`[sell-proposal-preview:${market}] 일일 표식 선점 실패 — 오늘 요약 보류(다음 틱 재시도): ${e instanceof Error ? e.message : String(e)}`);
    return 'claim_error';
  }
  if (!claimed) {
    knownDone.set(market, sessionDate);
    return 'claim_lost';
  }

  // 여기부터는 선점했다. 종목명 조회 실패는 코드로 대신한다(아래 루프 — 표식과 무관).
  const labels = new Map<string, string>();
  for (const it of items) {
    let label: string;
    try { label = await d.symbolLabel(it.symbol); } catch { label = escapeAlertText(it.symbol); }
    labels.set(it.symbol, label);
  }
  const { title, body } = buildSellProposalPreviewReport({ market, sessionDate, policy, items, heldCount, labels });

  // 전송 실패는 **두 모양**으로 온다 — 모든 채널 실패 결과(resolve)와 예외(reject). 둘 다 같은 경로로
  // 처리한다(T-055 Codex C2 high). 예전에는 reject 를 바깥 catch 로 흘려 표식이 남았고, 그날 요약이
  // 영구 누락됐다. "같은 예외가 매 틱 반복"되는 것은 재시도 상한(MAX_SEND_RETRIES)이 막는다.
  let dispatch: AlertDispatch | null = null;
  let sendError: string | null = null;
  try {
    dispatch = await d.dispatch('info', title, body);
  } catch (e) {
    sendError = e instanceof Error ? e.message : String(e);
  }

  if (dispatch == null || (dispatch.delivered.length === 0 && dispatch.failed.length > 0)) {
    const why = sendError ?? (dispatch?.failed ?? []).map(f => `${f.channel}: ${f.error}`).join(', ');
    const r = sendRetries.get(runKey) ?? 0;
    if (r < MAX_SEND_RETRIES) {
      sendRetries.set(runKey, r + 1);
      console.warn(`[sell-proposal-preview:${market}] 요약 전송 실패(${r + 1}/${MAX_SEND_RETRIES}) — 표식을 되돌리고 다음 틱 재시도: ${why}`);
      // releaseDailyReport 는 "아직 이 거래일 값일 때만" 되돌리는 조건부 갱신이다 — 다른 프로세스가
      // 그 사이 다음 거래일로 선점한 표식은 건드리지 않는다.
      const released = await tryRelease(d, market, sessionDate);
      logReportResult(market, sessionDate, 'send_failed_released', dispatch,
        released ? undefined : RELEASE_FAILED_NOTE);
      return 'send_failed_released';
    }
    console.warn(`[sell-proposal-preview:${market}] 요약 전송 실패 — 재시도 상한 도달, 오늘은 포기: ${why}`);
    knownDone.set(market, sessionDate);
    logReportResult(market, sessionDate, 'send_failed_kept', dispatch);
    return 'send_failed_kept';
  }

  // 전달 0·실패 0 (T-060) — 채널 정책 none / 모든 채널 자격 증명 미설정(`unconfigured`) / 그 밖.
  // 예전에는 여기서 'no_channel' 로 조용히 끝나 표식이 선점된 채 남았고, 그날 요약은 영영 나가지 않았으며
  // 로그로는 "받았다"와 "건너뛰었다"를 구분할 수 없었다. 자격 증명 판독이 일시적으로 빈 값을 돌려주는
  // 경우까지 있을 수 있어 실패와 같은 재시도 상한(sendRetries 공유)으로 되돌려 다시 시도한다.
  // 의도된 `notify_channel=none` 이어도 거래일당 최대 MAX_SEND_RETRIES 회 경고 뒤 멈춘다(매 틱 소음 아님).
  if (dispatch.delivered.length === 0) {
    const r = sendRetries.get(runKey) ?? 0;
    if (r < MAX_SEND_RETRIES) {
      sendRetries.set(runKey, r + 1);
      const released = await tryRelease(d, market, sessionDate);
      logReportResult(market, sessionDate, 'no_channel_released', dispatch, released
        ? `전달된 채널 0·실패 0 — 표식을 되돌리고 다음 틱 재시도(${r + 1}/${MAX_SEND_RETRIES})`
        : `전달된 채널 0·실패 0(${r + 1}/${MAX_SEND_RETRIES}) — ${RELEASE_FAILED_NOTE}`);
      return 'no_channel_released';
    }
    knownDone.set(market, sessionDate);
    logReportResult(market, sessionDate, 'no_channel', dispatch,
      '전달된 채널 0·실패 0 — 재시도 상한 도달, 오늘은 포기');
    return 'no_channel';
  }
  // ⚠️ 알려진 한계(수용, T-055 Leader 결정): 선점 뒤 전송 전에 프로세스가 강제 종료되면 그날 요약은
  //    누락된다(최대 한 번 전송 — at-most-once). 막으려면 lease·상태 머신이 필요하지만 이 요약은
  //    읽기 전용 관측 리포트이고 판정 데이터는 eval_funnel 에 틱마다 남으므로 그 복잡도를 들이지 않는다.
  knownDone.set(market, sessionDate);
  logReportResult(market, sessionDate, 'sent', dispatch);
  return 'sent';
}

/**
 * 결과 줄 메모 — 표식 되돌리기(`d.release`)가 던졌을 때 (T-060 Reviewer medium-1).
 * 되돌리기에 실패하면 표식이 선점된 채 남아 다음 틱은 로그 없는 `claim_lost` 로 끝나므로, "되돌리고 재시도"라고
 * 적으면 조용한 누락을 다시 숨기게 된다. outcome 이름(`*_released`)은 "되돌리기를 시도했다"는 뜻으로 유지한다.
 */
const RELEASE_FAILED_NOTE = '표식 되돌리기 실패 — 오늘 요약 누락 가능';

/** 표식 되돌리기. 던지지 않고 성공 여부만 돌려준다(실패 = 오늘 요약 누락 가능. 중복보다 낫다). */
async function tryRelease(d: SellProposalPreviewDeps, market: Market, sessionDate: string): Promise<boolean> {
  try {
    await d.release(market, sessionDate);
    return true;
  } catch {
    return false;
  }
}

/** 결과 줄에 실어도 되는 채널 이름 (notify 의 NotifyChannel·ChannelName 열거값) */
const KNOWN_CHANNEL_NAMES: ReadonlySet<string> = new Set(['none', 'telegram', 'slack', 'both']);

/**
 * 전송 시도 1회의 결과 1줄 (T-060). 엔진은 `finish()` 결과를 버리므로 이 줄이 "받았다/건너뛰었다/실패했다"를
 * 구분하는 유일한 운영 흔적이다.
 *
 * 🔴 넣는 것은 시장·거래일·outcome·채널 **이름**뿐이다. 토큰·채팅 ID·제목·본문·종목 수량/평단·실패 사유 문자열
 * (`failed[].error` — 외부 응답이 섞일 수 있다)은 넣지 않는다. 실패 사유는 기존 경고 줄과 notify 계층의
 * redact 된 로그가 맡는다.
 *
 * 전 채널 정상 전달(`sent` 이고 failed 0)만 console.log, 그 밖(부분 실패 포함)은 console.warn.
 */
function logReportResult(
  market: Market,
  sessionDate: string,
  outcome: SellProposalReportOutcome,
  dispatch: AlertDispatch | null,
  note?: string,
): void {
  try {
    // 채널 이름은 notify 의 열거값이다. 계약 밖 값이 와도 그 문자열을 싣지 않고 '?' 로 바꾼다
    // (허용 목록 방식 — 이름 자리에 외부 문자열이 섞여도 토큰·본문이 로그로 새지 않게).
    const nm = (x: unknown) => (typeof x === 'string' && KNOWN_CHANNEL_NAMES.has(x) ? x : '?');
    const names = (xs: readonly unknown[] | undefined) => `[${(xs ?? []).map(nm).join(',')}]`;
    const channel = dispatch ? nm(dispatch.channel) : '-';
    const delivered = names(dispatch?.delivered);
    const failed = names((dispatch?.failed ?? []).map(f => f?.channel));
    const unconfigured = names(dispatch?.unconfigured);
    const tail = [dispatch ? null : '전송 호출 예외', note ?? null].filter(Boolean).join(' · ');
    const line = `[sell-proposal-preview:${market}] 요약 결과 ${outcome} (거래일 ${sessionDate}, channel=${channel}, `
      + `delivered=${delivered}, failed=${failed}, unconfigured=${unconfigured})${tail ? ` — ${tail}` : ''}`;
    if (outcome === 'sent' && (dispatch?.failed ?? []).length === 0) console.log(line);
    else console.warn(line);
  } catch { /* 결과 로그 실패가 요약 흐름(표식·반환값)을 바꾸지 않게 한다 */ }
}

// ─── 요약 본문 (순수) ─────────────────────────────────────────────────────────

const SKIP_REASON_KO: Record<SellProposalSkipReason, string> = {
  above_threshold: '임계값 미도달',
  restep_not_met: '재제안 하락폭 미도달',
  rebound_withdraw: '회복으로 철회',
  no_position: '보유 수량 없음',
  quantity_below_min: '1주 미만',
  price_invalid: '현재가 이상',
  entry_invalid: '진입가 이상',
  unit_mismatch: '가격/진입가 단위 불일치',
  policy_invalid: '정책 무효',
  reference_invalid: '기준가 이상',
  decision_invalid: '직전 결정 이상',
};

const fmtW = (v: number | null) => (v == null || !Number.isFinite(v) ? '-' : `₩${Math.round(v).toLocaleString('ko-KR')}`);
const fmtQty = (v: number | null) => (v == null || !Number.isFinite(v) ? '-' : v.toLocaleString('ko-KR', { maximumFractionDigits: 4 }));
const fmtPct = (v: number | null) => (v == null || !Number.isFinite(v) ? '-' : `${v > 0 ? '+' : ''}${v.toFixed(2)}%`);

/** 두 값이 같다고 볼 수 있는가 — DB DECIMAL 반올림·환율 환산 오차 허용 */
function same(a: number | null, b: number | null): boolean {
  if (a == null || b == null || !Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.abs(a - b) <= Math.max(0.01, Math.abs(a) * 1e-6);
}

export interface PreviewReportInput {
  market: Market;
  sessionDate: string;
  policy: SellProposalPolicy;
  items: readonly PreviewItem[];
  heldCount: number;
  /** 종목코드 → 이스케이프된 표시명 */
  labels: ReadonlyMap<string, string>;
}

/**
 * 하루 1회 요약 본문. 텔레그램 HTML·슬랙 mrkdwn 양쪽에 그대로 들어가므로 동적 문자열은 전부
 * `escapeAlertText` 를 거친다(종목명은 `getSymbolLabel` 이 이미 이스케이프해 돌려준다).
 */
export function buildSellProposalPreviewReport(input: PreviewReportInput): { title: string; body: string } {
  const { market, sessionDate, policy, items, heldCount, labels } = input;
  const marketKo = market === 'domestic' ? '국내' : '해외';
  const h = escapeAlertText;
  const name = (sym: string) => {
    const code = h(sym);
    const label = labels.get(sym) ?? code;
    return label && label !== code ? `${label}(${code})` : code;
  };

  const proposals = items
    .filter(i => i.evaluation.verdict === 'pass')
    .sort((a, b) => (a.evaluation.pnlPct ?? 0) - (b.evaluation.pnlPct ?? 0));
  const others = items.filter(i => i.evaluation.verdict === 'skip');
  const missing = Math.max(0, heldCount - items.length);

  const title = `매도 제안 시뮬레이션: 오늘 ${proposals.length}건 (${marketKo})`;
  const lines: string[] = [];
  lines.push(`${marketKo} ${h(sessionDate)} 장 · 기준: 진입가(KIS 매입평균) 대비 -${policy.stopPct}% 이하 → 전량 매도 제안`);
  lines.push(`평가 ${items.length}/${heldCount}종목${missing > 0 ? ` (시세·포지션 확인 실패 ${missing}종목 — 요약에서 빠짐)` : ''}`);
  lines.push('');

  lines.push(`▶ 제안 대상 ${proposals.length}건`);
  if (proposals.length === 0) lines.push('없음');
  proposals.slice(0, MAX_LISTED).forEach((it, idx) => {
    const ev = it.evaluation;
    if (ev.verdict !== 'pass') return;
    lines.push(
      `${idx + 1}. ${name(it.symbol)} ${fmtPct(ev.pnlPct)} · ${fmtQty(ev.draft.quantity)}주 · `
      + `현재 ${fmtW(it.price)} / 진입 ${fmtW(it.stateEntry)} · 평가 ${fmtW(ev.draft.amountKRW)}`,
    );
    lines.push(`   사유: ${h(ev.draft.reasoning)}`);
  });
  if (proposals.length > MAX_LISTED) lines.push(`… 외 ${proposals.length - MAX_LISTED}건`);
  lines.push('');

  lines.push(`▶ 대상 아님 ${others.length}건`);
  if (others.length === 0) lines.push('없음');
  others.slice(0, MAX_LISTED).forEach((it) => {
    const ev = it.evaluation;
    if (ev.verdict !== 'skip') return;
    lines.push(`· ${name(it.symbol)} ${fmtPct(ev.pnlPct)} — ${SKIP_REASON_KO[ev.reason] ?? h(ev.reason)}`);
  });
  if (others.length > MAX_LISTED) lines.push(`… 외 ${others.length - MAX_LISTED}건`);
  lines.push('');

  lines.push('▶ KIS 잔고 원본 대조 (이번 평가 틱의 잔고 조회값 — 추가 KIS 호출 없음)');
  items.slice(0, MAX_LISTED).forEach((it) => {
    const ok = same(it.kisQty, it.stateQty) && same(it.kisAvgPrice, it.stateEntry);
    lines.push(
      `· ${h(it.symbol)} KIS 수량 ${fmtQty(it.kisQty)} · 매입평균 ${fmtW(it.kisAvgPrice)}`
      + ` | position_state 수량 ${fmtQty(it.stateQty)} · 진입 ${fmtW(it.stateEntry)}`
      + ` → ${ok ? '일치' : '⚠ 불일치'}`,
    );
  });
  if (items.length > MAX_LISTED) lines.push(`… 외 ${items.length - MAX_LISTED}종목`);
  if (market === 'overseas') {
    lines.push('(해외: KIS 매입평균은 USD 평단 × 잔고 조회 시점 환율의 원화 값이다. USD 평단 원값은 잔고 어댑터가 보존하지 않는다.)');
  }
  lines.push('');
  lines.push('시뮬레이션 — 시그널·주문 없음');

  return { title, body: lines.join('\n') };
}
