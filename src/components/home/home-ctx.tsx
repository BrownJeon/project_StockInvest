/**
 * T-108 홈 섹션 공통 — 섹션이 받는 조회 맥락(HomeCtx)과 지표 상태 → 칩 변환.
 *
 * 데이터 상태 6종(가이드 §2.3.1)은 섹션·지표마다 따로 생긴다:
 *   정상(available) · 첫 배포(unknown/prep) · 빈(zero) · 로딩(첫 응답 전) · 조회 실패(HTTP·섹션 error·네트워크) · 오래됨(stale)
 * - 조회 전체가 실패(첫 응답부터) → 섹션마다 「! 조회 실패 · {code}」 + [다시 시도].
 * - 재조회 실패(성공한 적 있음) → 마지막 값을 회색으로 + 「오래됨 · 기준 {시각}」.
 * - 「0」은 지표 state='zero'(조회 성공 + 0)일 때만 — 나머지는 `—` + 사유 칩.
 */
import { Fragment, type ReactNode } from 'react';
import type { Metric, OpsStage, Section as Sec } from '@/lib/ops/metrics/types';
import { CHIP, fmtKstTime } from '@/components/ops/format';
import { StatusChip } from '@/components/ops/ui/StatusChip';

export interface HomeCtx {
  /** 홈 조회 상태 */
  poll: 'loading' | 'ok' | 'stale' | 'error';
  /** 마지막 실패 코드(unauthorized·network·http_503 …) */
  code: string | null;
  nowMs: number;
  /** 지표 세트·문구를 고르는 단계(서버 HomeDTO.stage — 응답 전이면 안전 띠 단계, 그것도 없으면 observe) */
  stage: OpsStage;
  /** 응답 생성 시각(ISO) — 「기준 {HH:MM}」 */
  generatedAt: string | null;
  onRetry?: () => void;
}

/** 이 섹션을 「조회 실패」로 그려야 하면 그 코드, 아니면 null. */
export function sectionErrorCode<T>(ctx: HomeCtx, sec: Sec<T> | null | undefined): string | null {
  if (ctx.poll === 'error') return ctx.code ?? 'api_error';
  if (ctx.poll === 'loading') return null;
  if (!sec) return 'missing';
  return sec.state === 'error' ? sec.error : null;
}

/** 섹션 데이터(정상일 때만). */
export function sectionData<T>(sec: Sec<T> | null | undefined): T | null {
  return sec && sec.state === 'ok' ? sec.data : null;
}

export const isStale = (ctx: HomeCtx) => ctx.poll === 'stale';
export const baseTime = (ctx: HomeCtx) => fmtKstTime(ctx.generatedAt, ctx.nowMs);

/** 값이 있는 지표인가(정상·확인된 0·오래됨·부분) — 그 밖은 `—` + 칩. */
export function hasValue<T>(m: Metric<T> | null | undefined): m is Metric<T> & { value: T } {
  return !!m && m.value != null && (m.state === 'available' || m.state === 'zero' || m.state === 'stale' || m.state === 'partial');
}

/** 값이 없는 지표의 사유 칩(짧은 글자). */
export function MetricReason({ m, short }: { m: Metric<unknown> | null | undefined; short?: boolean }): JSX.Element {
  const st = m?.state ?? 'unknown';
  switch (st) {
    case 'error': return <StatusChip kind="error">{short ? '!' : `! 조회 실패${m?.reason ? ` · ${m.reason}` : ''}`}</StatusChip>;
    case 'prep': return <StatusChip kind="prep">준비 중</StatusChip>;
    case 'off_hours': return <StatusChip kind="off">장외</StatusChip>;
    case 'blocked': return <StatusChip kind="blocked">{short ? '⊘' : '⊘ 차단'}</StatusChip>;
    case 'zero': return <StatusChip kind="zero">{CHIP.zero}</StatusChip>;
    case 'stale': return <StatusChip kind="stale">오래됨</StatusChip>;
    default: return <StatusChip kind="unknown">{short ? '◌' : CHIP.unknown}</StatusChip>;
  }
}

/** 오래됨 칩 — 「오래됨 · 기준 {시각}」. */
export function StaleChip({ ctx, at }: { ctx: HomeCtx; at?: string | null }): JSX.Element {
  return <StatusChip kind="stale">{CHIP.stale(fmtKstTime(at ?? ctx.generatedAt, ctx.nowMs))}</StatusChip>;
}

/** 조회 실패 칩 — 「! 조회 실패 · {code}」. */
export function ErrorChip({ code }: { code: string }): JSX.Element {
  return <StatusChip kind="error">{CHIP.error(code)}</StatusChip>;
}

/** 여러 조각을 ` · ` 로 잇는다(빈 조각 제외). 조각이 하나도 없으면 null. */
export function joinDot(parts: ReactNode[]): ReactNode {
  const kept = parts.filter((p) => !(p === null || p === undefined || p === false || p === ''));
  if (kept.length === 0) return null;
  return kept.map((p, i) => <Fragment key={i}>{i > 0 ? ' · ' : null}{p}</Fragment>);
}
