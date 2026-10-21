/**
 * companyfacts(XBRL) → 분기·연간·시점 값 추출 — 순수 함수 (T-059 Part A).
 *
 * ## 무엇을 적재하는가
 * 1. **`frame` 이 있는 사실만.** SEC 는 회사·태그·단위·달력 기간마다 그 기간을 가장 잘 대표하는 사실 하나에만
 *    `frame`(예 `CY2026Q2`·`CY2025`·`CY2026Q2I`)을 붙인다. 10-Q 의 6개월·9개월 **누적(YTD) 값에는 frame 이 붙지 않는다**
 *    (실측 INTC: `NetCashProvidedByUsedInOperatingActivities` 의 2026 Q2 값은 6개월 누적이라 frame 없음 → 마지막 frame 은 CY2026Q1).
 * 2. 방어적으로 **기간 길이도 본다** — frame 이 붙었더라도 분기 frame(`CYyyyyQn`)은 70~110일, 연간 frame(`CYyyyy`)은 340~390일,
 *    시점 frame(`…I`)은 `start` 가 없어야 한다. 어긋나면 그 사실만 버린다(YTD 가 잘못 섞이는 것을 이중으로 막는다).
 * 3. **화이트리스트 태그만**(`XBRL_CONCEPTS`). 회사당 태그가 수백 개(INTC 684)라 전부 넣으면 행이 수만 개가 되고
 *    분석가가 쓰는 것은 매출·EPS·이익·현금흐름 등 소수다.
 *
 * ## 태그 변동 — 대체 태그 선택 규칙 (테스트로 고정: `__tests__/xbrl-facts.test.ts`)
 * 회사가 같은 개념을 시기마다 다른 태그로 보고한다(실측 INTC: 매출 2018 이전 `SalesRevenueNet` → 이후
 * `RevenueFromContractWithCustomerExcludingAssessedTax`, `Revenues` 는 없음). DB 에는 **후보 태그 전부를 원래 태그 이름 그대로** 넣고,
 * 읽을 때 `pickConceptValue()` 가 **frame 마다** 아래 순서로 첫 번째로 존재하는 태그를 고른다(값을 합치거나 평균하지 않는다).
 *   revenue: Revenues → RevenueFromContractWithCustomerExcludingAssessedTax → RevenueFromContractWithCustomerIncludingAssessedTax → SalesRevenueNet → (ifrs-full) Revenue
 *   `Revenues` 가 1순위인 이유: 둘 다 보고하는 회사에서 `Revenues` 는 총매출, `RevenueFromContract…` 는 고객계약 매출(부분)인 경우가 있다.
 * 같은 frame 에 같은 우선순위 태그가 여러 단위로 있으면 개념에 정한 단위(USD 등)만 본다(ifrs 는 보고 통화가 다를 수 있어 단위를 함께 돌려준다).
 * (실측 MU: `Revenues` 는 10-K 11건·마지막 frame CY2018Q3 에서 끝나고, 이후는 `RevenueFromContractWithCustomerExcludingAssessedTax`.)
 *
 * ## 🔴 파생값(TTM·직전 분기 합)을 여기서 만들지 않는다
 * **회계연도 4분기는 단독 분기 frame 이 없는 경우가 많다** — 10-K 는 연간값만 보고하고 4분기 3개월 값은 문서에 없다
 * (실측 MU `EarningsPerShareDiluted`: CY2025Q2·CY2025Q4·CY2026Q1·CY2026Q2 는 있고 FQ4 FY2025 = CY2025Q3 는 비어 있다).
 * 그래서 "frame 이 있는 최근 4개 분기의 합 = TTM" 은 **연속 분기가 아니라서 틀린다.** 이 모듈과 테이블은 원값 적재가 목적이고
 * 4분기 도출(연간 − 9개월 누적)·TTM 은 P1 범위 밖이다. 필요해지면 frame 연속성 검사와 함께 별도 함수로 만든다(`frameSequence()` 참고).
 *
 * `fy`/`fp` 는 **그 값을 실은 제출 문서의** 회계연도·분기다(SEC 원값). 비교 기간 값은 다음 해 10-Q 에 실려 frame 을 받기도 해서
 * (실측 MU: 2025-02-27 종료 분기 값의 frame CY2025Q1 이 2026-03-19 제출 10-Q(fy 2026, fp Q2) 행에 붙어 있다) 기간 식별은 `period_end` 로 한다.
 */
import { EdgarParseError, daysBetween } from './parse';

export interface ConceptDef {
  /** 우선순위 순서. `taxonomy:tag` */
  tags: string[];
  /** 허용 단위. 비우면 모든 단위(ifrs 보고 통화 등). */
  units: string[];
  kind: 'duration' | 'instant';
}

export const XBRL_CONCEPTS: Record<string, ConceptDef> = {
  revenue: {
    tags: [
      'us-gaap:Revenues',
      'us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax',
      'us-gaap:RevenueFromContractWithCustomerIncludingAssessedTax',
      'us-gaap:SalesRevenueNet',
      'ifrs-full:Revenue',
    ],
    units: [], kind: 'duration',
  },
  eps_diluted: {
    tags: ['us-gaap:EarningsPerShareDiluted', 'us-gaap:EarningsPerShareBasicAndDiluted', 'ifrs-full:DilutedEarningsLossPerShare'],
    units: [], kind: 'duration',
  },
  eps_basic: {
    tags: ['us-gaap:EarningsPerShareBasic', 'us-gaap:EarningsPerShareBasicAndDiluted', 'ifrs-full:BasicEarningsLossPerShare'],
    units: [], kind: 'duration',
  },
  net_income: { tags: ['us-gaap:NetIncomeLoss', 'us-gaap:ProfitLoss', 'ifrs-full:ProfitLoss'], units: [], kind: 'duration' },
  operating_income: { tags: ['us-gaap:OperatingIncomeLoss'], units: ['USD'], kind: 'duration' },
  gross_profit: { tags: ['us-gaap:GrossProfit', 'ifrs-full:GrossProfit'], units: [], kind: 'duration' },
  rnd_expense: { tags: ['us-gaap:ResearchAndDevelopmentExpense'], units: ['USD'], kind: 'duration' },
  operating_cash_flow: { tags: ['us-gaap:NetCashProvidedByUsedInOperatingActivities'], units: ['USD'], kind: 'duration' },
  capex: { tags: ['us-gaap:PaymentsToAcquirePropertyPlantAndEquipment'], units: ['USD'], kind: 'duration' },
  diluted_shares: { tags: ['us-gaap:WeightedAverageNumberOfDilutedSharesOutstanding'], units: ['shares'], kind: 'duration' },
  assets: { tags: ['us-gaap:Assets', 'ifrs-full:Assets'], units: [], kind: 'instant' },
  equity: {
    tags: ['us-gaap:StockholdersEquity', 'us-gaap:StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest', 'ifrs-full:Equity'],
    units: [], kind: 'instant',
  },
  cash: {
    tags: ['us-gaap:CashAndCashEquivalentsAtCarryingValue', 'us-gaap:CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents'],
    units: ['USD'], kind: 'instant',
  },
  shares_outstanding: { tags: ['dei:EntityCommonStockSharesOutstanding'], units: ['shares'], kind: 'instant' },
};

/** 화이트리스트 전체(taxonomy:tag). */
export const WHITELIST_TAGS: ReadonlySet<string> = new Set(Object.values(XBRL_CONCEPTS).flatMap((c) => c.tags));

export interface FactRow {
  cik: number;
  taxonomy: string;
  tag: string;
  unit: string;
  frame: string;
  periodStart: string | null;
  periodEnd: string;
  val: number;
  fy: number | null;
  fp: string | null;
  form: string;
  filed: string;
  accn: string;
}

/**
 * 재무값으로 쓰는 양식. 8-K 에 붙은 XBRL 사실(실측 MU: `SalesRevenueNet`·`EarningsPerShareDiluted` 에 8-K 22건)은 보도자료 첨부라
 * 감사 전 수치이고 정기보고서와 기간 표기가 섞일 수 있어 뺀다. 10-Q·10-K 와 그 정정(/A), 외국 발행사의 연간 보고서(20-F·40-F)만 쓴다.
 */
export const FACT_FORMS: ReadonlySet<string> = new Set(['10-Q', '10-Q/A', '10-K', '10-K/A', '20-F', '20-F/A', '40-F', '40-F/A']);

const FRAME_Q = /^CY\d{4}Q[1-4]$/;
const FRAME_Y = /^CY\d{4}$/;
const FRAME_I = /^CY\d{4}Q[1-4]I$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** frame·기간 길이 검사. 통과하면 true. */
export function isValidFramedPeriod(frame: string, start: string | null, end: string): boolean {
  if (!DATE_RE.test(end)) return false;
  if (FRAME_I.test(frame)) return start == null;
  if (!start || !DATE_RE.test(start)) return false;
  const days = daysBetween(start, end) + 1;
  if (FRAME_Q.test(frame)) return days >= 70 && days <= 110;
  if (FRAME_Y.test(frame)) return days >= 340 && days <= 390;
  return false;
}

/**
 * companyfacts JSON → 화이트리스트·frame 있는 사실. 사실 하나의 형식이 이상하면 그것만 버린다.
 * 최상위 형식(`cik`·`facts`)이 틀리면 던진다.
 */
export function extractFramedFacts(json: unknown, expectedCik: number): FactRow[] {
  if (!json || typeof json !== 'object') throw new EdgarParseError('companyfacts: 객체가 아님');
  const o = json as Record<string, unknown>;
  if (Number(o.cik) !== expectedCik) throw new EdgarParseError(`companyfacts: cik 불일치 (${String(o.cik)})`);
  const facts = o.facts as Record<string, unknown> | undefined;
  if (!facts || typeof facts !== 'object') throw new EdgarParseError('companyfacts: facts 없음');

  const latest = new Map<string, FactRow>();
  for (const full of WHITELIST_TAGS) {
    const [taxonomy, tag] = full.split(':');
    const node = (facts[taxonomy] as Record<string, unknown> | undefined)?.[tag] as Record<string, unknown> | undefined;
    const units = node?.units as Record<string, unknown> | undefined;
    if (!units || typeof units !== 'object') continue;
    for (const [unit, arr] of Object.entries(units)) {
      if (!Array.isArray(arr) || unit.length > 32) continue;
      for (const f of arr) {
        if (!f || typeof f !== 'object') continue;
        const x = f as Record<string, unknown>;
        const frame = typeof x.frame === 'string' ? x.frame : '';
        if (!frame) continue;                                     // ← YTD·비대표 사실 배제
        const start = typeof x.start === 'string' ? x.start : null;
        const end = typeof x.end === 'string' ? x.end : '';
        if (!isValidFramedPeriod(frame, start, end)) continue;
        const val = x.val;
        if (typeof val !== 'number' || !Number.isFinite(val)) continue;
        const filed = typeof x.filed === 'string' && DATE_RE.test(x.filed) ? x.filed : '';
        const accn = typeof x.accn === 'string' && /^\d{10}-\d{2}-\d{6}$/.test(x.accn) ? x.accn : '';
        const form = typeof x.form === 'string' ? x.form.slice(0, 16) : '';
        if (!filed || !accn || !FACT_FORMS.has(form)) continue;     // ← 8-K 등 제외
        const key = `${taxonomy}|${tag}|${unit}|${frame}`;
        const prev = latest.get(key);
        // 같은 (tag, unit, frame) 이 여러 제출에 있으면 **가장 늦은 filed 하나**(같으면 accn 이 큰 쪽)만 남긴다 — 정정 이력은 버린다.
        // DB upsert 도 같은 규칙(filed 가 같거나 늦을 때만 덮음)이라 두 겹이다. 실측 MU 에서는 frame 중복이 없었지만 SEC 가 보장하지 않는다.
        if (prev && (prev.filed > filed || (prev.filed === filed && prev.accn >= accn))) continue;
        latest.set(key, {
          cik: expectedCik, taxonomy, tag, unit, frame,
          periodStart: start, periodEnd: end, val,
          fy: typeof x.fy === 'number' && Number.isInteger(x.fy) ? x.fy : null,
          fp: typeof x.fp === 'string' ? x.fp.slice(0, 4) : null,
          form, filed, accn,
        });
      }
    }
  }
  return [...latest.values()];
}

export interface PickedValue {
  concept: string;
  frame: string;
  tag: string;      // taxonomy:tag
  unit: string;
  val: number;
  periodEnd: string;
  filed: string;
}

/**
 * 한 개념·한 frame 의 값을 대체 태그 우선순위로 고른다. 없으면 null(추정·0 채움 없음).
 * `rows` 는 DB 에서 읽은 같은 CIK 의 사실들(어떤 순서든 무관).
 */
export function pickConceptValue(
  rows: ReadonlyArray<Pick<FactRow, 'taxonomy' | 'tag' | 'unit' | 'frame' | 'val' | 'periodEnd' | 'filed'>>,
  concept: string,
  frame: string,
): PickedValue | null {
  const def = XBRL_CONCEPTS[concept];
  if (!def) throw new Error(`알 수 없는 개념: ${concept}`);
  for (const full of def.tags) {
    const [taxonomy, tag] = full.split(':');
    const cands = rows.filter((r) => r.taxonomy === taxonomy && r.tag === tag && r.frame === frame
      && (def.units.length === 0 || def.units.includes(r.unit)));
    if (cands.length === 0) continue;
    // 같은 태그에 단위가 여럿이면(드묾) USD·USD/shares·shares 를 먼저, 그 다음 사전순 — 결정적으로 고른다.
    const pref = (u: string) => (['USD', 'USD/shares', 'shares'].includes(u) ? 0 : 1);
    cands.sort((a, b) => pref(a.unit) - pref(b.unit) || a.unit.localeCompare(b.unit));
    const c = cands[0];
    return { concept, frame, tag: full, unit: c.unit, val: c.val, periodEnd: c.periodEnd, filed: c.filed };
  }
  return null;
}

/**
 * 분기 frame 'CY2026Q2' → 연속 번호(2026*4+1). 분기 frame 이 아니면 null.
 * 두 분기 frame 이 바로 이웃인지(`b - a === 1`) 확인하는 데 쓴다 — 4분기 결측 때문에 "최근 4개 = 연속 4분기"가 아니다.
 */
export function frameSequence(frame: string): number | null {
  const m = /^CY(\d{4})Q([1-4])$/.exec(frame);
  return m ? Number(m[1]) * 4 + (Number(m[2]) - 1) : null;
}
