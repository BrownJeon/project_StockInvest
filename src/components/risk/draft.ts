/**
 * T-066 리스크 정책 화면 — 입력 초안(draft) 검증·변경 수 계산 (순수 함수, 데모 v3 `validate`·`dirtyCount`).
 */
import { checkHeatCapPct, checkStopPct, parsePct, round2, type FieldCheck } from '@/lib/risk/compute';
import { DEFAULT_EDITABLE, type RiskPolicyEditable, type StopBasis } from '@/lib/risk/defaults';

export interface Draft {
  stopPct: string;
  heatCapPct: string;
  stopBasis: StopBasis;
}

export interface SavedPolicy extends RiskPolicyEditable {
  version: number;
  updatedAt: string;
}

export interface DraftCheck {
  stop: FieldCheck;
  cap: FieldCheck;
  errs: number;
  /** 계산에 쓰는 값 — 잘못된 입력은 저장된 값(없으면 제안값)으로 대신한다 */
  eff: RiskPolicyEditable;
  usedFallback: boolean;
}

export function checkDraft(d: Draft, saved: SavedPolicy | null): DraftCheck {
  const stop = checkStopPct(d.stopPct);
  const cap = checkHeatCapPct(d.heatCapPct);
  const base = saved ?? DEFAULT_EDITABLE;
  const errs = (stop.error ? 1 : 0) + (cap.error ? 1 : 0);
  return {
    stop, cap, errs,
    eff: {
      stopPct: stop.value ?? base.stopPct,
      heatCapPct: cap.value ?? base.heatCapPct,
      stopBasis: d.stopBasis,
    },
    usedFallback: errs > 0,
  };
}

/** 입력값을 저장될 값(소수 2자리 반올림)으로 — 숫자가 아니면 NaN */
const asSaved = (raw: string) => {
  const n = parsePct(raw);
  return Number.isNaN(n) ? n : round2(n);
};

/**
 * 저장된 값과 다른 항목 수. 정책이 아직 없으면 3(처음 저장).
 * 반올림 뒤 같은 값(예: 3.001 → 3)은 변경으로 보지 않는다 — 같은 값으로 version·history 만 오르는 저장을 막는다.
 */
export function dirtyCount(d: Draft, saved: SavedPolicy | null): number {
  if (!saved) return 3;
  let n = 0;
  if (asSaved(d.stopPct) !== saved.stopPct) n++;
  if (asSaved(d.heatCapPct) !== saved.heatCapPct) n++;
  if (d.stopBasis !== saved.stopBasis) n++;
  return n;
}

export function draftFrom(saved: RiskPolicyEditable | null): Draft {
  const s = saved ?? DEFAULT_EDITABLE;
  return { stopPct: String(s.stopPct), heatCapPct: String(s.heatCapPct), stopBasis: s.stopBasis };
}

export const basisLabel = (b: StopBasis) => (b === 'avg' ? '평균단가' : '고점');

/** 다른 기기 저장값 요약 — "손절폭 2.5% · 한도 2% · 평균단가 기준" 중 바뀐 항목만 (없으면 전체) */
export function describePolicy(next: RiskPolicyEditable, prev: RiskPolicyEditable | null): string {
  const parts: string[] = [];
  if (!prev || prev.stopPct !== next.stopPct) parts.push(`손절폭 ${next.stopPct}%`);
  if (!prev || prev.heatCapPct !== next.heatCapPct) parts.push(`손절 합 한도 ${next.heatCapPct}%`);
  if (!prev || prev.stopBasis !== next.stopBasis) parts.push(`${basisLabel(next.stopBasis)} 기준`);
  return parts.length ? parts.join(' · ') : `손절폭 ${next.stopPct}% · 손절 합 한도 ${next.heatCapPct}% · ${basisLabel(next.stopBasis)} 기준`;
}
