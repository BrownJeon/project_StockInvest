/**
 * T-087 (T-081 WP-D1a) — `/api/cron/broker-fills` 의 배선(실제 DB 풀·KIS 원장 조회·지문 함수를 수집기에 꽂는다)과 요청·응답 변환.
 * Next 라우트 파일은 HTTP 메서드만 export 할 수 있어 도우미를 이 파일에 둔다.
 *
 * 🔴 이 경로가 쓰는 KIS 함수는 `kis-domestic-ledger`·`kis-overseas-ledger` 의 **읽기 전용 GET 조회 3종씩**뿐이다(주문·취소·정정 모듈을 import 하지 않는다 —
 *    `kis-domestic`/`kis-overseas` 재노출 대신 원장 모듈을 직접 가져와 주문 코드가 이 라우트 번들에 실리지 않게 했다).
 * 🔴 계좌 원문은 {@link preflightFingerprint} 함수 안에서만 쓰고 지문(16 hex)만 밖으로 나간다. 응답 JSON 에는 건수·상태·사유 코드만 담는다.
 */
import { getCredential } from '@/lib/credentials';
import { fingerprintSecret, isEncryptionConfigured } from '@/lib/auth/secret-box';
import { ledgerTrId } from '@/lib/exchanges/kis-ledger-query';
import * as domesticLedger from '@/lib/exchanges/kis-domestic-ledger';
import * as overseasLedger from '@/lib/exchanges/kis-overseas-ledger';
import {
  KINDS, MARKETS,
  type AccountFingerprintResult, type CollectResult, type CollectorDeps, type JobReport, type LedgerFetchers,
} from '@/lib/broker-ledger/collector';
import type { SqlPool } from '@/lib/broker-ledger/store';
import type { BrokerMarket, BrokerRunKind } from '@/lib/broker-ledger/types';

/**
 * run 행에 미리 적는 TR ID(실전, 모의). 어댑터(`kis-*-ledger.ts`)가 보내는 TR 과 **같아야** 한다 — 다르면 수집기가 그 run 을
 * `failed(source_tr_mismatch)` 로 닫고 아무것도 쓰지 않는다(fail-closed). 시험이 어댑터 원문과 이 표를 대조한다.
 * (Dev-1 API 요청: 어댑터가 TR 선택 함수를 공개하면 이 표는 지운다.)
 */
export const LEDGER_TR_IDS: Record<BrokerMarket, Record<BrokerRunKind, readonly [real: string, mock: string]>> = {
  domestic: { fills: ['TTTC0081R', 'VTTC0081R'], realized_pnl: ['TTTC8708R', 'VTTC8708R'], position_snapshot: ['TTTC8434R', 'VTTC8434R'] },
  overseas: { fills: ['TTTS3035R', 'VTTS3035R'], realized_pnl: ['TTTS3039R', 'VTTS3039R'], position_snapshot: ['CTRP6504R', 'VTRP6504R'] },
};

export function ledgerFetchers(): LedgerFetchers {
  return {
    domestic: {
      fills: (q, o) => domesticLedger.getDailyOrderFills(q, o),
      realizedPnl: (q, o) => domesticLedger.getPeriodProfit(q, o),
      positions: (o) => domesticLedger.getPositionSnapshot(o),
    },
    overseas: {
      fills: (q, o) => overseasLedger.getDailyOrderFills(q, o),
      realizedPnl: (q, o) => overseasLedger.getPeriodProfit(q, o),
      positions: (o) => overseasLedger.getPositionSnapshot(o),
    },
    trId: (market, kind) => {
      const [real, mock] = LEDGER_TR_IDS[market][kind];
      return ledgerTrId(real, mock);
    },
  };
}

/**
 * 실행 전 계좌 지문. 계좌 식별 문자열은 어댑터(`kis-ledger-query.ts runLedgerQuery`)와 **같은 규칙**이다:
 * `${KIS_ACCOUNT_NO.trim()}-${(KIS_ACCOUNT_PRODUCT || '01').trim()}` — 다르면 매 run 이 account_changed 로 멈춘다(시험이 두 원문을 대조).
 * (Dev-1 API 요청: 지문만 계산하는 공개 함수가 생기면 이 중복을 지운다.)
 */
export async function preflightFingerprint(): Promise<AccountFingerprintResult> {
  if (!isEncryptionConfigured()) return { ok: false, error: 'fingerprint_key_missing' };
  let cano = '';
  let prdt = '';
  try {
    cano = String((await getCredential('KIS_ACCOUNT_NO')) || '').trim();
    prdt = String((await getCredential('KIS_ACCOUNT_PRODUCT')) || '01').trim();
  } catch {
    return { ok: false, error: 'credential_error' };
  }
  if (!cano) return { ok: false, error: 'account_missing' };
  let fp: string | null;
  try {
    fp = fingerprintSecret(`${cano}-${prdt}`);
  } catch {
    return { ok: false, error: 'fingerprint_error' };
  }
  return fp ? { ok: true, fingerprint: fp } : { ok: false, error: 'fingerprint_key_missing' };
}

export function buildCollectorDeps(db: SqlPool): CollectorDeps {
  return { db, fetchers: ledgerFetchers(), fingerprint: fingerprintSecret, accountFingerprint: preflightFingerprint };
}

/**
 * (감사 M1 권고) 운영 런타임에서만 수집한다. 개발 서버(`next dev`)·시험 환경이 운영과 **같은 DB** 를 보면서 다른 지문 키로 첫 성공 run 을 만들면
 * 그 지문이 기준(anchor)이 되어 운영 수집이 account_changed 로 멈춘다 — 그 사고를 라우트 문턱에서 막는다(DB·KIS 접근 전).
 * `next start`(pm2 stockinvest)는 NODE_ENV=production 이다. 시험은 이 값을 명시적으로 바꿔 두 경로를 확인한다.
 */
export function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === 'production';
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 요청 파라미터
// ─────────────────────────────────────────────────────────────────────────────────────────────

export type ParsedParams =
  | { ok: true; trigger: 'cron' | 'manual'; markets: BrokerMarket[]; kinds: BrokerRunKind[] }
  | { ok: false; error: string };

/**
 * 쿼리 문자열만 읽는다(본문은 무시 — cron-runner 는 `{}` 를 보낸다).
 *  - `trigger`: 없음 = cron · `manual` · `backfill` 은 **거부**(D1b 범위 — 이 작업의 승인 밖) · 그 밖 거부.
 *  - `market`: 없음/all · domestic · overseas. `kind`: 없음/all · fills · realized_pnl · position_snapshot.
 */
export function parseParams(url: URL): ParsedParams {
  const trig = url.searchParams.get('trigger');
  let trigger: 'cron' | 'manual';
  if (trig == null || trig === '' || trig === 'cron') trigger = 'cron';
  else if (trig === 'manual') trigger = 'manual';
  else if (trig === 'backfill') return { ok: false, error: 'backfill_not_in_d1a' };
  else return { ok: false, error: 'bad_trigger' };

  const m = url.searchParams.get('market');
  let markets: BrokerMarket[];
  if (m == null || m === '' || m === 'all') markets = [...MARKETS];
  else if ((MARKETS as readonly string[]).includes(m)) markets = [m as BrokerMarket];
  else return { ok: false, error: 'bad_market' };

  const k = url.searchParams.get('kind');
  let kinds: BrokerRunKind[];
  if (k == null || k === '' || k === 'all') kinds = [...KINDS];
  else if ((KINDS as readonly string[]).includes(k)) kinds = [k as BrokerRunKind];
  else return { ok: false, error: 'bad_kind' };

  return { ok: true, trigger, markets, kinds };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 응답 — 건수·상태·사유 코드만(계좌·키·지문·금액 없음)
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** 응답에 싣는 작업 필드(허용 목록 — 수집기 결과에 필드가 늘어도 응답에 새지 않는다). */
export function publicJob(j: JobReport) {
  return {
    market: j.market, kind: j.kind, status: j.status, runId: j.runId, pages: j.pages, kisCalls: j.kisCalls, rowsSeen: j.rowsSeen,
    inserted: j.inserted, updated: j.updated, unchanged: j.unchanged, staleSkipped: j.staleSkipped, duplicateKeys: j.duplicateKeys,
    normalizeIssues: j.normalizeIssues, writeFailures: j.writeFailures,
    reasons: j.reasons.filter((r) => /^[a-z0-9_:/.-]{1,80}$/i.test(r)).slice(0, 20),
  };
}

/**
 * 수집 결과 → HTTP. cron-runner 는 200 이 아니면 본문 200자를 로그에 남긴다 — 사람이 볼 상태(실패·중단·준비 안 됨)는 503 으로 돌려 로그에 남게 한다.
 *  - not_migrated · preflight_failed · (작업 중 하나라도 failed/halted) → 503
 *  - skipped(switch_off·in_progress) · 그 밖 done → 200
 */
export function toHttp(trigger: 'cron' | 'manual', r: CollectResult): { status: number; body: Record<string, unknown> } {
  switch (r.status) {
    case 'not_migrated':
      return { status: 503, body: { ok: false, status: 'not_migrated', trigger } };
    case 'skipped':
      return { status: 200, body: { ok: true, status: 'skipped', skipped: r.reason, trigger, switchEnabled: r.switchEnabled } };
    case 'preflight_failed':
      return { status: 503, body: { ok: false, status: 'preflight_failed', error: r.error, trigger, switchEnabled: r.switchEnabled } };
    case 'done': {
      const bad = r.jobs.some((j) => j.status === 'failed' || j.status === 'halted');
      return {
        status: bad ? 503 : 200,
        body: { ok: !bad, status: 'done', trigger, switchEnabled: r.switchEnabled, closedStale: r.closedStale, jobs: r.jobs.map(publicJob) },
      };
    }
  }
}
