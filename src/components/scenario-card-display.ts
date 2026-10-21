/**
 * T-062 WP-U — 시나리오 카드 목록·승인 화면의 **표시 판정** 순수 함수 (React·DB·fetch 무관).
 *
 * 구현 기준: 승인 데모 `mockups/T-062-post-market-overseas-v2.html`(사용자 "v2승인" 2026-10-21) +
 * designer 구현 가이드 G3·G4·G6·G7 (`agent-vault/10-Flow/tasks/T-062-post-market-overseas-p2.md`).
 *
 * ── 왜 여기 모았는가 ─────────────────────────────────────────────────────────────
 * 1. `GET /api/signals`(목록)는 `indicators` 를 파싱하지 않는다. DB 는 MariaDB `longtext CHECK json_valid`
 *    이고 mysql2 가 이것을 JSON 으로 읽지 않으므로 **목록의 `indicators` 는 문자열로 온다**(Leader 실측,
 *    가이드 G1). 그래서 대시보드 "내일" 탭·추천 탭 카드는 등급·목표·진입 구간을 못 그리고 있었다.
 *    → 모든 목록 소비 지점은 `parseIndicators()` 를 거친다(문자열·객체 모두 처리).
 * 2. `amount_krw` 는 DECIMAL 이라 mysql2 가 문자열(`"100000.00"`)로 준다. `String.prototype.toLocaleString`
 *    은 숫자 서식 옵션을 무시하므로 "약 100000.00원" 이 그대로 보였다(T-063). → `fmtApproxKrw()`.
 * 3. RTL·jsdom 미설치 환경이라 "무엇을 보여줄지" 를 순수 함수로 빼야 `npm test` 로 고정할 수 있다
 *    (선례: `./scenario-view-model.ts`).
 *
 * ── 원칙 ───────────────────────────────────────────────────────────────────────
 * - 없는 값은 지어내지 않는다: 키가 없거나 형식이 틀리면 `null` → 호출부는 그 줄을 그리지 않는다.
 * - **화면은 KRW→USD 환산을 하지 않는다.** 달러 값은 서버가 카드에 저장한 `indicators.price_zone_usd`
 *   (카드 시점 환율, AI 가 낸 값 그대로)를 표시만 한다. 환산 경계는 `lib/__tests__/currency-mixing-fence.test.ts`
 *   가 고정한다 — 이 파일은 그 식별자들을 쓰지 않는다.
 */

import { toKstDatetime } from '@/lib/time';
import type { StoredScenario } from './scenario-view-model';

type Obj = Record<string, unknown>;

function isPlainObject(v: unknown): v is Obj {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function objAt(o: Obj | null | undefined, key: string): Obj | null {
  const v = o?.[key];
  return isPlainObject(v) ? v : null;
}

// ─── indicators 파싱 ──────────────────────────────────────────────────────────

/**
 * 목록 API 의 `indicators` 를 객체로. 문자열이면 JSON.parse(실패 시 null), 평범한 객체면 그대로, 그 밖 null.
 * (배열·숫자·JSON 배열 문자열도 null — `indicators` 는 객체여야 한다.)
 */
export function parseIndicators(raw: unknown): Obj | null {
  if (typeof raw === 'string') {
    try {
      const v: unknown = JSON.parse(raw);
      return isPlainObject(v) ? v : null;
    } catch {
      return null;
    }
  }
  return isPlainObject(raw) ? raw : null;
}

/** `indicators.ai.scenario` (객체일 때만). 입력은 원시값·문자열·객체 모두 허용. */
export function scenarioOf(ind: unknown): StoredScenario | undefined {
  const sc = objAt(objAt(parseIndicators(ind), 'ai'), 'scenario');
  return sc ? (sc as StoredScenario) : undefined;
}

// ─── 등급·신뢰도·시장 ─────────────────────────────────────────────────────────

export type CardGrade = 'A' | 'B+' | 'B' | 'C';
const GRADE_RANK: Record<CardGrade, number> = { 'A': 4, 'B+': 3, 'B': 2, 'C': 1 };

/** `ai.scenario.grade` 가 정확히 A·B+·B·C 중 하나일 때만. 소문자·'D'·'' 등은 null(= 등급 없음). */
export function gradeOf(ind: unknown): CardGrade | null {
  const g = scenarioOf(ind)?.grade as unknown;
  return typeof g === 'string' && Object.prototype.hasOwnProperty.call(GRADE_RANK, g) ? (g as CardGrade) : null;
}

/** `ai.confidence` 가 유한한 number 이고 0~100 일 때만. 문자열 "74"·NaN·범위 밖은 null. */
export function confidenceOf(ind: unknown): number | null {
  const c = objAt(parseIndicators(ind), 'ai')?.confidence;
  return typeof c === 'number' && Number.isFinite(c) && c >= 0 && c <= 100 ? c : null;
}

/** `market==='overseas'`. market 이 없을(null/undefined) 때만 심볼 형식(`NAS:AAPL`)으로 판정. */
export function isOverseasSignal(s: { market?: string | null; symbol: string }): boolean {
  if (s.market == null) return typeof s.symbol === 'string' && s.symbol.includes(':');
  return s.market === 'overseas';
}

// ─── 정렬 ─────────────────────────────────────────────────────────────────────

/**
 * 평가등급순 정렬 — 새 배열 반환(입력 불변).
 * ① 등급 A>B+>B>C>없음 ② 같은 등급은 신뢰도 높은 순(null 은 그 등급 맨 뒤) ③ 그다음 **입력 순서**
 * (서버가 `created_at DESC, id DESC` = 최신순으로 준다). 동률은 인덱스로 명시 해소한다.
 * 시장·매수/매도·출처는 비교에 쓰지 않는다 → 국내·해외가 한 순서로 섞이고 매도 시그널도 같은 규칙.
 *
 * 한계: 목록은 API 가 자른 뒤 정렬된다(추천 탭 limit 100, "내일" 탭 limit 20) — 초과분은 등급과 무관하게 빠진다.
 */
export function sortScenarioCards<T>(
  items: readonly T[],
  pick: (t: T) => { grade: CardGrade | null; confidence: number | null },
): T[] {
  const decorated = items.map((item, index) => {
    const { grade, confidence } = pick(item);
    return { item, index, rank: grade ? GRADE_RANK[grade] ?? 0 : 0, conf: confidence };
  });
  decorated.sort((a, b) => {
    if (a.rank !== b.rank) return b.rank - a.rank;
    if (a.conf !== b.conf) {
      if (a.conf === null) return 1;
      if (b.conf === null) return -1;
      return b.conf - a.conf;
    }
    return a.index - b.index;
  });
  return decorated.map(d => d.item);
}

// ─── 금액 서식 (T-063 합침) ──────────────────────────────────────────────────

function positiveNumber(raw: unknown): number | null {
  let n: number;
  if (typeof raw === 'number') n = raw;
  else if (typeof raw === 'string' && raw.trim() !== '') n = Number(raw.trim());
  else return null;
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** `"100000.00"`·`100000` → `"100,000원"`. 0 이하·비숫자·빈 값 → null. */
export function fmtKrw(raw: unknown): string | null {
  const n = positiveNumber(raw);
  return n === null ? null : `${Math.round(n).toLocaleString('ko-KR')}원`;
}

/**
 * 카드 금액 `"약 100,000원"`. DECIMAL 은 mysql2 가 문자열로 주는데 `String.prototype.toLocaleString` 은
 * 옵션을 무시해 "약 100000.00원" 이 보였다 — 숫자로 바꾼 뒤 서식한다. null 이면 호출부는 금액 꼬리를 그리지 않는다.
 */
export function fmtApproxKrw(raw: unknown): string | null {
  const s = fmtKrw(raw);
  return s === null ? null : `약 ${s}`;
}

// ─── 해외 진입 구간 ───────────────────────────────────────────────────────────

/** 서버 저장 `indicators.price_zone_usd` — 유한한 number, 0 < lo ≤ hi 일 때만. */
export function usdZoneOf(ind: unknown): { lo: number; hi: number } | null {
  const z = objAt(parseIndicators(ind), 'price_zone_usd');
  const lo = z?.lo;
  const hi = z?.hi;
  if (typeof lo !== 'number' || typeof hi !== 'number') return null;
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo <= 0 || lo > hi) return null;
  return { lo, hi };
}

/** `"$27.20 ~ $27.60"` 또는 null. */
export function usdZoneText(ind: unknown): string | null {
  const z = usdZoneOf(ind);
  return z === null ? null : `$${z.lo.toFixed(2)} ~ $${z.hi.toFixed(2)}`;
}

/** `ai.scenario.entry.price_zone` "lo~hi"(원화 환산값) → `"36,176 ~ 36,708원"`. 파싱 실패·0 이하 → null. */
export function krwZoneText(ind: unknown): string | null {
  const zone = scenarioOf(ind)?.entry?.price_zone as unknown;
  if (typeof zone !== 'string') return null;
  const parts = zone.split('~');
  if (parts.length !== 2) return null;
  const [lo, hi] = parts.map(p => (p.trim() === '' ? NaN : Number(p.trim())));
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo <= 0 || hi <= 0) return null;
  return `${Math.round(lo).toLocaleString('ko-KR')} ~ ${Math.round(hi).toLocaleString('ko-KR')}원`;
}

export interface OverseasZoneView {
  /** 달러 주표기 — 서버 저장값이 있을 때만. */
  usd: string | null;
  /** 원화 구간(단위 표기). 달러가 없으면 이것이 주표기(폴백), 있으면 보조 줄. */
  krw: string | null;
}

/** 해외 카드 진입 구간. 둘 다 없으면 null → 진입 구간 줄 미표시. */
export function overseasZoneView(ind: unknown): OverseasZoneView | null {
  const usd = usdZoneText(ind);
  const krw = krwZoneText(ind);
  return usd === null && krw === null ? null : { usd, krw };
}

// ─── 시각 (KST 고정) ─────────────────────────────────────────────────────────

const WEEKDAY_KO = ['일', '월', '화', '수', '목', '금', '토'];
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

function toValidDate(v: unknown): Date | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === 'string' && v.trim() !== '') {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof v === 'number' && Number.isFinite(v)) return new Date(v);
  return null;
}

/** KST 벽시계 `MM-DD` / `HH:mm` / 요일 — `@/lib/time` 의 +9h 고정 변환이라 실행 환경 시간대와 무관. */
function kstParts(d: Date): { md: string; hm: string; wd: string } {
  const s = toKstDatetime(d); // "YYYY-MM-DD HH:mm:ss" (KST)
  return {
    md: s.slice(5, 10),
    hm: s.slice(11, 16),
    wd: WEEKDAY_KO[new Date(d.getTime() + KST_OFFSET_MS).getUTCDay()],
  };
}

/**
 * `"미국 정규장 10-21(수) 22:30 ~ 10-22(목) 05:00 KST"` — 카드 컬럼 `valid_from`·`expires_at`
 * (= 09:30/16:00 ET 를 KST 로 저장)로 만든다. 둘 중 하나라도 없거나 Invalid, 또는 끝 ≤ 시작이면 null.
 */
export function sessionLine(validFrom: unknown, expiresAt: unknown): string | null {
  const a = toValidDate(validFrom);
  const b = toValidDate(expiresAt);
  if (!a || !b || b.getTime() <= a.getTime()) return null;
  const s = kstParts(a);
  const e = kstParts(b);
  return `미국 정규장 ${s.md}(${s.wd}) ${s.hm} ~ ${e.md}(${e.wd}) ${e.hm} KST`;
}

/** `"카드 환율 1,330 (10-21 08:00)"`. asOf 없거나 Invalid 면 괄호 생략, rate 없으면 null. */
export function fxView(ind: unknown): string | null {
  const fx = objAt(parseIndicators(ind), 'fx');
  const rate = fx?.rate;
  if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) return null;
  const head = `카드 환율 ${rate.toLocaleString('ko-KR', { maximumFractionDigits: 2 })}`;
  const at = toValidDate(fx?.asOf);
  if (!at) return head;
  const p = kstParts(at);
  return `${head} (${p.md} ${p.hm})`;
}

/**
 * 승인 화면 "AI 권장 진입 구간" 아래 보조 줄.
 * 달러 + 원화: `"≈ 36,176 ~ 36,708원 · 카드 환율 1,330 (10-21 08:00) · 자동 진입은 이 원화 구간으로 판단"`.
 * 달러만: 환율 문구(없으면 null). 달러 없음: null(원화가 주표기라 보조 줄 불필요).
 */
export function detailZoneAux(ind: unknown): string | null {
  const view = overseasZoneView(ind);
  if (!view || view.usd === null) return null;
  const fx = fxView(ind);
  if (view.krw === null) return fx;
  return [`≈ ${view.krw}`, fx, '자동 진입은 이 원화 구간으로 판단'].filter((x): x is string => x !== null).join(' · ');
}

// ─── 실적 일정 ───────────────────────────────────────────────────────────────

export interface EarningsLineView {
  /** warn = 노랑(추정 기간 겹침), muted = 회색(없음). */
  tone: 'warn' | 'muted';
  /** 본문. warn 이면 앞에 ⚠(aria-hidden)를 붙여 그린다. */
  text: string;
  /** 괄호 보조(회색). */
  note: string;
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 실적 한 줄. 서버 `indicators.earnings` 만 근거로 한다(지어내지 않음).
 * - estimated_window + window(from·to YYYY-MM-DD) → 노랑 "실적 발표 추정 기간과 겹침 · 10-24 ~ 10-31" (추정, 미확정)
 * - none + nextConfirmed 없음 → 회색 "실적 일정: 앞으로 5거래일 안 없음" (추정치 기준 · 확정일 미입력)
 * - none + nextConfirmed 있음 → **null**: 승인 데모 v2 에 없는 상태("확정일이 5거래일 밖"). "확정일 미입력" 문구를
 *   쓰면 거짓이 되므로 줄을 그리지 않는다(Leader 결정 G11-①, 문구는 확정일 입력 시작 전 사용자 확인 대상).
 * - 키 없음·형식 오류·confirmed_blackout(카드가 만들어지지 않음)·그 밖 → null
 */
export function earningsLine(ind: unknown): EarningsLineView | null {
  const e = objAt(parseIndicators(ind), 'earnings');
  if (!e) return null;
  if (e.status === 'estimated_window') {
    const w = objAt(e, 'window');
    const from = w?.from;
    const to = w?.to;
    if (typeof from !== 'string' || typeof to !== 'string' || !YMD.test(from) || !YMD.test(to)) return null;
    return { tone: 'warn', text: `실적 발표 추정 기간과 겹침 · ${from.slice(5)} ~ ${to.slice(5)}`, note: '(추정, 미확정)' };
  }
  if (e.status === 'none') {
    if (e.nextConfirmed != null) return null;
    return { tone: 'muted', text: '실적 일정: 앞으로 5거래일 안 없음', note: '(추정치 기준 · 확정일 미입력)' };
  }
  return null;
}

// ─── "내일" 탭 하단 고정 문구 ────────────────────────────────────────────────

/**
 * 목록에 해외 카드가 1장 이상일 때만 문구, 0장이면 null(스위치 꺼짐을 화면이 모르므로 숨김).
 * 금액은 하드코딩하지 않고 목록 안 해외 카드 `amount_krw` 의 첫 유효값(약 없이), 없으면 "카드 금액".
 */
export function overseasFootnote(
  items: readonly { market?: string | null; symbol: string; amount_krw?: unknown }[],
): string | null {
  const overseas = items.filter(isOverseasSignal);
  if (overseas.length === 0) return null;
  const amount = overseas.map(s => fmtKrw(s.amount_krw)).find((x): x is string => x !== null) ?? '카드 금액';
  return `미국 카드는 매일 08:00 분석 · 1주 가격이 ${amount} 이하인 종목만 만들어집니다(보유·관심 종목 중 비싼 종목은 나오지 않음).`;
}
