/**
 * T-108 안전 상태 띠 — 화면 모델 (가이드 §2.2 표가 정본, 순수 함수 · 시험 B-2).
 *
 * 단계(`stage`)는 서버가 정한다(`/api/ops/safety-state` → `deriveOpsStage`). 이 파일은 단계별 **배지·요약·칩 문구**만 만든다.
 * - 실거래여부 글자·방향은 `@/lib/safety/live-trading`(`liveTradingText`·`LIVE_TRADING_LABEL`) 한 곳에서 — 여기서 dryRun 을 뒤집지 않는다
 *   (DTO 의 `liveTrading` 은 서버가 이미 `liveTradingFromDryRun` 으로 바꾼 값).
 * - 「검증 통과 {v}/{t}」의 v 는 `validatedEnabled`(검증 통과 ∧ 켜짐) — 단계 파생(mixed = validatedEnabled 0)과 같은 수를 써야
 *   「검증 통과 1/16 이라 신규 매수 차단」 같은 모순 문장이 나오지 않는다.
 * - 안전 표시는 오래된 값을 보이지 않는다: 읽기 실패면 마지막 값 대신 「! 확인 실패」(`unknown`).
 */
import type { SafetyStateDTO } from '@/lib/ops/metrics/types';
import { LIVE_TRADING_LABEL, liveTradingText } from '@/lib/safety/live-trading';
import type { PollState } from './useOpsPoll';

/** 띠·미니 띠가 받는 상태. ok 의 dto.stage 는 unknown 이 아니다(unknown 은 error 로 바꿔 넘긴다). */
export type SafetyStateView =
  | { kind: 'loading' }
  | { kind: 'ok'; dto: SafetyStateDTO }
  | { kind: 'error'; lastGoodAt: string | null; code: string | null };

/** 재조회 상태 → 띠 상태. lastGoodAt = 마지막으로 단계를 알았던 시각(ISO, readAt). */
export function safetyViewFromPoll(poll: PollState<SafetyStateDTO>, lastGoodAt: string | null): SafetyStateView {
  if (poll.status === 'loading') return { kind: 'loading' };
  const dto = poll.status === 'ok' ? poll.data : null;
  if (!dto) return { kind: 'error', lastGoodAt, code: poll.error };
  if (dto.stage === 'unknown') return { kind: 'error', lastGoodAt, code: dto.errors[0] ?? 'unknown' };
  return { kind: 'ok', dto };
}

export type StripStageClass = 'obs' | 'halt' | 'mixed' | 'live' | 'err';
export interface StripChip { name: string; value: string; tone: Array<'bad' | 'warn' | 'sep'> }
export interface StripModel {
  cls: StripStageClass;
  badge: string;
  /** 요약 = pre + **bold** + post */
  summary: { pre: string; bold: string; post: string };
  chips: StripChip[];
  /** 혼합 단계 + 청산 엔진 ON — 「청산 주문은 실제로 송신됩니다」 빨간 줄 */
  exitLiveAlert: boolean;
}

const KILL_LABEL = '모든거래차단';
const VALID_LABEL = '검증 통과';
const EXIT_LABEL = '청산 엔진';
const HARD_LABEL = '손실한도 손절';

/** 단계 배지 글자(띠) — 가이드 §2.2 표. */
export const STAGE_BADGE: Record<Exclude<StripStageClass, 'err'>, string> = {
  obs: '관찰 (실거래 차단)',
  halt: '중지 (모든거래차단)',
  mixed: '실거래 준비 — 매수 차단',
  live: '실거래',
};
/** 미니 띠(분석 머리) 배지 글자 — 데모 miniStrip(). */
export const MINI_BADGE: Record<StripStageClass, string> = {
  obs: '관찰 (실거래 차단)',
  halt: '중지 (모든거래차단)',
  mixed: '실거래 준비',
  live: '실거래',
  err: '! 확인 실패',
};

export function stageClassOf(stage: SafetyStateDTO['stage']): StripStageClass {
  switch (stage) {
    case 'observe': return 'obs';
    case 'halt': return 'halt';
    case 'mixed': return 'mixed';
    case 'live': return 'live';
    default: return 'err';
  }
}

function exitChip(dto: SafetyStateDTO, cls: StripStageClass): StripChip {
  const ee = dto.exitEngine;
  if (!ee || ee.source === 'db_error') return { name: EXIT_LABEL, value: '—', tone: ['sep'] };
  if (!ee.enabled) return { name: EXIT_LABEL, value: 'OFF · 자동 청산 없음', tone: ['sep', 'bad'] };
  if (cls === 'halt') return { name: EXIT_LABEL, value: 'ON (송신 차단)', tone: ['sep'] };
  if (cls === 'mixed') return { name: EXIT_LABEL, value: 'ON · 실주문', tone: ['sep', 'bad'] };
  return { name: EXIT_LABEL, value: 'ON', tone: ['sep'] };
}

function hardStopChip(dto: SafetyStateDTO): StripChip {
  const ee = dto.exitEngine;
  if (!ee || ee.source === 'db_error') return { name: HARD_LABEL, value: '—', tone: ['sep'] };
  if (!ee.enabled) return { name: HARD_LABEL, value: '— (엔진 OFF)', tone: ['sep'] };
  return ee.hardStopEnabled ? { name: HARD_LABEL, value: 'ON', tone: ['sep'] } : { name: HARD_LABEL, value: 'OFF', tone: ['sep', 'warn'] };
}

/** 정상 단계(관찰·중지·혼합·실거래) 띠 모델. dto.stage 가 unknown 이면 null(호출자가 확인 실패로 그린다). */
export function buildStripModel(dto: SafetyStateDTO): StripModel | null {
  const cls = stageClassOf(dto.stage);
  if (cls === 'err' || !dto.strategies || dto.liveTrading === null || dto.killSwitch === null) return null;
  const v = dto.strategies.validatedEnabled;
  const t = dto.strategies.total;
  const live = dto.liveTrading === true;
  const liveChip: StripChip = { name: LIVE_TRADING_LABEL, value: liveTradingText(live), tone: live ? ['bad'] : [] };
  const killChip: StripChip = dto.killSwitch
    ? { name: KILL_LABEL, value: 'ON · 모든 주문 차단', tone: ['bad'] }
    : { name: KILL_LABEL, value: 'OFF', tone: [] };
  const validChip: StripChip = { name: VALID_LABEL, value: `${v}/${t}`, tone: v === 0 && cls !== 'live' ? ['warn'] : [] };
  const tail = [validChip, exitChip(dto, cls), hardStopChip(dto)];
  const engineOn = !!dto.exitEngine && dto.exitEngine.source !== 'db_error' && dto.exitEngine.enabled;

  switch (cls) {
    case 'halt':
      return { cls, badge: STAGE_BADGE.halt, summary: { pre: '', bold: '모든 주문 차단', post: ' — 매수·매도·청산 송신 안 함' },
        chips: [killChip, liveChip, ...tail], exitLiveAlert: false };
    case 'obs':
      return { cls, badge: STAGE_BADGE.obs,
        summary: { pre: '', bold: v === 0 ? '신규 매수 차단' : '신규 매수 기록만', post: ` — 검증 통과 전략 ${v}/${t} · 주문은 기록만(실거래여부 OFF)` },
        chips: [liveChip, killChip, ...tail], exitLiveAlert: false };
    case 'mixed':
      return { cls, badge: STAGE_BADGE.mixed, summary: { pre: `검증 통과 전략 ${v}/${t} 이라 `, bold: '신규 매수 차단', post: '' },
        chips: [liveChip, killChip, ...tail], exitLiveAlert: engineOn };
    case 'live':
      return { cls, badge: STAGE_BADGE.live, summary: { pre: '', bold: '실거래 가능', post: ` — 검증 통과 ${v}/${t} 전략만 신규 매수` },
        chips: [liveChip, killChip, ...tail], exitLiveAlert: false };
  }
}

/** 확인 실패 띠의 칩 4개(값 모름 `—`). */
export const UNKNOWN_CHIPS: StripChip[] = [
  { name: LIVE_TRADING_LABEL, value: '—', tone: ['sep'] },
  { name: KILL_LABEL, value: '—', tone: ['sep'] },
  { name: VALID_LABEL, value: '—', tone: ['sep'] },
  { name: EXIT_LABEL, value: '—', tone: ['sep'] },
];
