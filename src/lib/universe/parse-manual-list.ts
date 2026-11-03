/**
 * T-143 WP-B — 수동 목록 붙여넣기 파싱·대조 (구현 가이드 §2.6.2). **순수 함수 · 시험 대상.**
 *
 * 화면(일괄 교체)과 서버(`PUT …/manual`)가 **같은 함수**를 쓴다 — 화면 검사를 신뢰하지 않고 서버가 다시 본다.
 *
 * ## 형식 검사가 앱의 `isOverseasSymbol` 보다 엄격한 이유 (가이드 §0.1 불편한 사실 7)
 * `isOverseasSymbol` 은 `/^[A-Z]{3}:[A-Z][A-Z0-9.]*$/` 로 **아무 3글자 거래소**를 통과시키지만, 실제로 KIS
 * `OVRS_EXCG_CD` 로 변환되는 거래소는 `NAS`·`NYS`·`AMS` 3개뿐이다(`kis-symbols.ts` `OverseasExchange`·`OVRS_EXCG_CD_MAP`).
 * 승인 데모 §4 의 검사가 더 맞으므로 **데모 쪽을 쓰고, 기존 함수는 바꾸지 않는다**(바꾸면 기존 데이터·경로의 뜻이 달라진다).
 *
 * ## 규칙
 *  1. 줄바꿈·쉼표로 자르고 `trim()`, 빈 조각 제거.
 *  2. `^(NAS|NYS|AMS):[A-Z][A-Z0-9.]{0,6}$` 를 통과하지 못하면 `bad` — **소문자는 자동 변환하지 않고 막는다**
 *     (Leader L-3: 입력한 것과 저장된 것이 달라지는 상태를 만들지 않는다).
 *  3. 이미 나온 코드는 `dup`(첫 것만 남긴다) — 오류가 아니다.
 *  4. 대조는 **현재 수동 목록만** 상대한다(즐겨찾기·보유는 비교에 넣지 않는다).
 *  5. `bad` 가 1건이라도 있으면 화면이 저장을 막는다 — 일부만 반영되는 상태를 만들지 않는다.
 *  6. 빈 목록은 **허용**한다(확인 시트가 그 결과를 말하고 버튼 글자를 바꾼 뒤 보낸 요청이다).
 */

/** 저장 가능한 해외 종목 코드 — 거래소는 KIS 로 변환되는 3개만. */
export const OVERSEAS_LIST_PATTERN = /^(NAS|NYS|AMS):[A-Z][A-Z0-9.]{0,6}$/;

/**
 * 한 번에 받는 종목 수 상한. **표(`overseas_universe_revision`)의 백스톱과 같은 500 이다**(T-146, 2026-11-03).
 *
 * ## 전에는 150 이었고, 왜 올렸나
 * 처음 값은 **150**(T-143 Reviewer m-2 → m-3)이고 근거는 「WP-C(대상 확대 시간 예산)의 목표치가 ~150 이고,
 * 그마저 08시 틱 최악 287~359초로 아직 빨간불」이었다. 2026-11-03 **사용자가 위험을 듣고 제거를 지시**했다 —
 * 나스닥100(101) + NYSE 상위 50 = 151종목이 150 에 1종목 걸려 저장이 막히는 것이 발단이다.
 * 보고한 위험 3가지(실효 상한 500 · 무인 제안 경로 느슨해짐 · 08시 예산 관문 상실)를 듣고 재확인한 결정이다.
 * 경위·수용한 위험은 `agent-vault/10-Flow/tasks/T-146-manual-list-cap-removal.md` 에 있다.
 *
 * ## 왜 검사를 지우지 않고 500 으로 맞췄나
 * 검사를 지우면 500 초과 입력이 **표의 CHECK(errno 3819)** 로 떨어져 깔끔한 400 대신 DB 오류가 사용자에게 보인다 —
 * 요청에 없던 새 실패 경로다. 500 으로 맞추면 **앱의 정책 상한은 사라지고**(그것이 지시의 내용이다) 표의 사고 방지
 * 백스톱 하나만 남으면서, 초과 시 문구·상태코드는 종전과 같다. 두 수를 **일부러 다르게 두던 설계는 끝났다** —
 * 이제 같은 수이므로, 표의 CHECK 를 바꿀 때는 이 상수도 같이 본다(그 반대도 같다).
 *
 * ## 🔴 이 수가 더 이상 막지 않는 것
 * 150 은 「사고로 수만 줄」과 **「분명히 예산을 넘는 입력」** 둘을 막는 1차 관문이었다. 이제 뒤쪽은 막지 않는다 —
 * 500종목을 저장하면 08시 틱이 300초(순찰 재시작 기준)를 넘을 수 있고, 실제 분석 대상은 이 목록 ∪ 자동 목록 ∪
 * 보유 ∪ 즐겨찾기라 **합집합은 더 크다**. 남은 방어선은 **거래일 1회 실측(WP-C — 미완)** 과 각 경로의 자체
 * 예산·이어받기뿐이다(`kis-fundamentals-snapshot` 90초+이어받기 · `us-edgar` 100초+이어받기 ·
 * `post-market-overseas` 는 **이어받기가 없고** curl 상한 120초뿐). 앞쪽(수만 줄)은 여전히 막는다.
 *
 * ⚠ 이 상수는 **수동 목록 전용**이다. WP-A 의 `topN` 천장은 `refresh-config.ts` 의 `AUTO_TOP_N_MAX` 로 **분리했다**
 * (T-146) — 지시는 수동 목록 상한 제거였고, 무인 경로인 `topN` 천장을 함께 올리는 것은 요청에 없었다.
 */
export const MANUAL_LIST_MAX = 500;

export interface ParsedManualList {
  /** 형식을 통과하고 중복이 아닌 것, 입력 순서대로. */
  good: string[];
  /** 형식 오류 — 입력 그대로(화면이 이스케이프해 보인다). */
  bad: string[];
  /** 중복(두 번째 이후). */
  dup: string[];
}

/** 붙여넣은 글 → `{ good, bad, dup }`. 데모 `parse()` 와 같은 동작. */
export function parseManualList(text: unknown): ParsedManualList {
  const raw = String(text ?? '')
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const good: string[] = [];
  const bad: string[] = [];
  const dup: string[] = [];
  const seen = new Set<string>();
  for (const s of raw) {
    if (!OVERSEAS_LIST_PATTERN.test(s)) { bad.push(s); continue; }
    if (seen.has(s)) { dup.push(s); continue; }
    seen.add(s);
    good.push(s);
  }
  return { good, bad, dup };
}

export interface SymbolDiff {
  /** 새 목록에만 있는 것. */
  add: string[];
  /** 현재 목록에만 있는 것. */
  rm: string[];
  /** 둘 다 있는 것. */
  same: string[];
}

/** 현재 목록 ↔ 새 목록. 순서는 `add` = 새 목록 순서, `rm`·`same` = 현재 목록 순서(데모 `buildDiff()`). */
export function diffSymbols(current: readonly string[], next: readonly string[]): SymbolDiff {
  const cur = new Set(current);
  const nxt = new Set(next);
  return {
    add: next.filter((s) => !cur.has(s)),
    rm: current.filter((s) => !nxt.has(s)),
    same: current.filter((s) => nxt.has(s)),
  };
}

export interface ManualListDiffResult extends SymbolDiff, ParsedManualList {
  /** 저장하면 수동 목록이 될 값(= `good`). */
  next: string[];
  /** 형식 오류·상한 초과로 저장을 막아야 하는가(가이드 §2.6.2 규칙 5 + m-3). */
  blocked: boolean;
  /** 상한(MANUAL_LIST_MAX)을 넘었나 — 넘으면 저장을 막는다. 형식 오류와 같은 자리에 사유를 보인다 */
  tooMany: boolean;
}

/** 붙여넣은 글 + 현재 수동 목록 → 대조 결과. 화면 `ManualListDiff` 가 이 값을 그린다. */
export function buildManualListDiff(current: readonly string[], text: unknown): ManualListDiffResult {
  const p = parseManualList(text);
  const d = diffSymbols(current, p.good);
  const tooMany = p.good.length > MANUAL_LIST_MAX;
  return { ...p, ...d, next: p.good, tooMany, blocked: p.bad.length > 0 || tooMany };
}

export type ManualSymbolsCheckFail =
  /** 배열이 아니다 */
  | 'not_array'
  /** 상한(MANUAL_LIST_MAX) 초과 */
  | 'too_many'
  /** 형식 오류가 섞였다 */
  | 'invalid_symbol';

export type ManualSymbolsCheck =
  | { ok: true; symbols: string[]; dropped: string[] }
  | { ok: false; reason: ManualSymbolsCheckFail; invalid: string[] };

/**
 * 서버 쪽 재검사(가이드 §4.3) — 화면이 보낸 `symbols` 를 **같은 규칙으로** 다시 본다.
 *  - 형식 오류가 하나라도 있으면 **거부**한다(400, DB 는 그대로 — 부분 반영 없음).
 *  - 중복은 오류가 아니라 **첫 것만 남긴다**(파싱 규칙 3과 같다). 떨어진 것은 `dropped` 로 알려 준다.
 *  - 빈 배열은 통과한다(규칙 6).
 * `invalid` 는 형식 오류 목록이다(400 응답의 `fieldErrors.symbols`).
 */
export function checkManualSymbols(symbols: unknown): ManualSymbolsCheck {
  if (!Array.isArray(symbols)) return { ok: false, reason: 'not_array', invalid: [] };
  if (symbols.length > MANUAL_LIST_MAX) return { ok: false, reason: 'too_many', invalid: [] };
  const out: string[] = [];
  const dropped: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  for (const raw of symbols) {
    const s = typeof raw === 'string' ? raw.trim() : '';
    if (!OVERSEAS_LIST_PATTERN.test(s)) {
      // 사람이 읽을 수 있게 원문 일부만 남긴다(긴 쓰레기 입력으로 응답·로그가 부풀지 않게)
      invalid.push(typeof raw === 'string' ? raw.slice(0, 32) : String(raw).slice(0, 32));
      continue;
    }
    if (seen.has(s)) { dropped.push(s); continue; }
    seen.add(s);
    out.push(s);
  }
  if (invalid.length > 0) return { ok: false, reason: 'invalid_symbol', invalid };
  return { ok: true, symbols: out, dropped };
}
