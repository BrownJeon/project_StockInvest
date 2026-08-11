/**
 * `signals.indicators.ai.scenario` (DB JSON) 를 **읽는 쪽**의 타입 + 표시 판정 로직 — T-021.
 *
 * ── 왜 생산자 타입과 분리하는가 ────────────────────────────────────────────────
 * `ScenarioCard` (`@/lib/signals/scenario-builder`) 는 **생산자** 타입이다.
 * `buildScenarioFromAiResult()` 는 전 필드를 항상 채우므로 그쪽은 required 가 맞고,
 * 느슨하게 만들면 "생산자가 필드를 빼먹는 것"을 컴파일러가 못 잡게 된다. 그래서 건드리지 않는다.
 *
 * 반면 **이 앱이 읽는 JSON 은 그 계약을 지킬 의무가 없다.** 실제로
 * `src/lib/strategy/post-market-engine.ts` 경로는 `grade`/`entry`/`exit` 만 넣고
 * `risk_factors`·`why_now`·`context`·`ev` 를 넣지 않은 채 INSERT 한다.
 * 그런데 소비자 타입이 그 필드들을 required 로 **거짓 선언**하고 있었기 때문에
 * 컴파일러가 `sc.risk_factors.length` 를 안전하다고 통과시켰고, 추천 상세 화면이
 * `TypeError: Cannot read properties of undefined (reading 'length')` 로 통째로 죽었다.
 * 타입을 실데이터에 맞게 정직하게 만드는 것이 이 수정의 핵심이다.
 *
 * ── 왜 React 밖의 순수 함수인가 ────────────────────────────────────────────────
 * RTL·jsdom 미설치 + `npm install` 금지 환경이라 컴포넌트를 렌더해서 검증할 수 없다.
 * "무엇을 보여줄지" 판정을 순수 함수로 빼면 `npm test` 로 직접 회귀 검증이 가능하다.
 * (선례: `src/components/__tests__/safety-bar-outcome.test.ts`)
 *
 * ── 원칙: 없는 값은 지어내지 않는다 ───────────────────────────────────────────
 * 결측 필드를 `0`·`''`·`—`·`NaN` 으로 채우지 않고 **해당 항목 자체를 렌더하지 않는다.**
 * 특히 `ev` 결측 시 `(undefined * 100).toFixed(0)` 이 `"NaN"` 을 만들어 화면에
 * `EV NaN%` 라는 **측정값처럼 보이는 거짓 수치**가 떠 있었다.
 */

import type { ScenarioGrade } from '@/lib/signals/scenario-builder';

// ─── 소비자(=DB JSON 읽기) 타입 ──────────────────────────────────────────────
// 전 필드 옵셔널. "저장된 JSON 에 있을 수도, 없을 수도 있다" 가 유일하게 참인 계약이다.

export interface StoredScenarioEntry {
  trigger?: string;
  price_zone?: string;
  condition?: string;
}

export interface StoredScenarioExit {
  target_pct?: number;
  target_pct_hi?: number;
  stop_pct?: number;
  stop_pct_hi?: number;
  trailing_activate_pct?: number;
  holding_days?: string;
  holding_deadline?: string;
}

export interface StoredScenario {
  grade?: ScenarioGrade;
  entry?: StoredScenarioEntry;
  exit?: StoredScenarioExit;
  risk_factors?: string[];
  why_now?: string;
  context?: string;
  /** Expected Value (0~1 scale) */
  ev?: number;
}

export type MaybeScenario = StoredScenario | null | undefined;

// ─── 정규화 헬퍼 ─────────────────────────────────────────────────────────────

/** 유한한 숫자만 통과. `undefined`·`null`·`NaN`·`Infinity`·비숫자는 전부 `null`. */
export function finiteOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** 비어있지 않은 문자열만 통과. 그 외는 `null` → 미표시. */
export function nonEmptyString(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v : null;
}

// ─── AI 평가 섹션 (ScenarioDetail) ───────────────────────────────────────────

export interface AiEvalItems {
  grade: ScenarioGrade | null;
  /** EV 표시 문자열(정수 %). 결측·비유한이면 `null` → EV 박스 자체를 렌더하지 않는다. */
  evPct: string | null;
  targetPct: number | null;
  stopPct: number | null;
}

export function aiEvalItems(sc: MaybeScenario): AiEvalItems {
  const ev = finiteOrNull(sc?.ev);
  return {
    grade: sc?.grade ?? null,
    evPct: ev === null ? null : (ev * 100).toFixed(0),
    targetPct: finiteOrNull(sc?.exit?.target_pct),
    stopPct: finiteOrNull(sc?.exit?.stop_pct),
  };
}

/**
 * AI 평가 섹션에 실제로 보여줄 항목이 하나라도 있는가.
 * `false` 면 섹션(제목 + 빈 박스 줄)을 통째로 렌더하지 않는다 — 빈 껍데기 방지.
 */
export function hasAiEval(items: AiEvalItems): boolean {
  return items.grade !== null
    || items.evPct !== null
    || items.targetPct !== null
    || items.stopPct !== null;
}

// ─── 공통 표시 판정 ──────────────────────────────────────────────────────────

/**
 * 리스크 요인 목록. 배열이 아니면(결측 포함) 빈 배열 → 섹션 미표시.
 * 🔴 이 함수가 없던 자리가 T-021 크래시 지점(`sc.risk_factors.length`)이다.
 */
export function riskFactors(sc: MaybeScenario): string[] {
  const raw = sc?.risk_factors;
  if (!Array.isArray(raw)) return [];
  return raw.filter((r): r is string => typeof r === 'string' && r.trim().length > 0);
}

/** AI 권장 진입 구간. 결측이거나 placeholder(`'0~0'`)면 `null` → 미표시. */
export function entryZoneDisplay(sc: MaybeScenario): string | null {
  const z = nonEmptyString(sc?.entry?.price_zone);
  return z === null || z === '0~0' ? null : z;
}

// ─── 목록 카드 요약 (ScenarioCard) ───────────────────────────────────────────

export interface ScenarioCardSummary {
  grade: ScenarioGrade | null;
  targetPct: number | null;
  targetPctHi: number | null;
  stopPct: number | null;
  stopPctHi: number | null;
  trigger: string | null;
  holdingDays: string | null;
  riskFactors: string[];
}

export function cardSummary(sc: MaybeScenario): ScenarioCardSummary {
  return {
    grade: sc?.grade ?? null,
    targetPct: finiteOrNull(sc?.exit?.target_pct),
    targetPctHi: finiteOrNull(sc?.exit?.target_pct_hi),
    stopPct: finiteOrNull(sc?.exit?.stop_pct),
    stopPctHi: finiteOrNull(sc?.exit?.stop_pct_hi),
    trigger: nonEmptyString(sc?.entry?.trigger),
    holdingDays: nonEmptyString(sc?.exit?.holding_days),
    riskFactors: riskFactors(sc),
  };
}

// ─── 승인 POST 페이로드 ──────────────────────────────────────────────────────

/**
 * `POST /api/signals/custom/confirm` 에 실어보낼 `scenario` 페이로드.
 *
 * 서버(`src/app/api/signals/custom/confirm/route.ts`)가 **구조적으로** 요구하는 것:
 *   - `scenario` 자체가 truthy (없으면 400 `symbol/direction/scenario required`)
 *   - `currentPrice <= 0` 일 때만 `scenario.entry.price_zone` (없으면 400)
 * 그 외(`scenario.why_now`, `scenario.entry.*`)는 서버가 이미 `?? null` / `?? {}` 로 방어한다.
 * → **서버 수정 불필요.** 클라이언트는 위 두 가지 구조만 보장하면 된다.
 *
 * 기존 구현(`sc ?? { ev: 0, grade: 'C', risk_factors: [], why_now: '', ... }`)의 두 결함:
 *   ① `sc` 가 **부분 결측**이면 `??` 가 발동하지 않아 폴백이 전혀 적용되지 않았다.
 *   ② `sc` 가 아예 없을 땐 `EV 0%`·`등급 C` 라는 **지어낸 평가치를 DB 에 INSERT** 했다.
 * 병합(merge) 방식으로 바꿔 ①을 해소하고, 없는 값은 채우지 않아 ②를 해소한다.
 */
export function buildConfirmScenario(sc: MaybeScenario): Record<string, unknown> {
  const entry = sc?.entry ?? {};
  return {
    ...(sc ?? {}),
    // 서버 400 게이트가 요구하는 유일한 구조 — 값이 없을 때만 placeholder.
    // (실제 진입 구간은 서버가 manualSlices 로 슬라이스마다 덮어쓴다.)
    entry: { ...entry, price_zone: entry.price_zone ?? '0~0' },
  };
}
