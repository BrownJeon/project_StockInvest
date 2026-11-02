/**
 * T-143 WP-A — SEC 상장 목록(`company_tickers_exchange.json`) 판독·사전 필터. **순수 함수**(fetch·DB 없음).
 *
 * 정본: `docs/design/2026-11-01-t143-wpa-nyse50-spec.md` §1·§2.
 *
 * ## 왜 열 순서를 믿지 않나
 * 응답은 `{"fields":["cik","name","ticker","exchange"],"data":[[...], ...]}` 꼴이다. SEC 가 열 순서를 바꾸면
 * 위치로 읽는 파서는 **조용히 엉뚱한 값**을 읽는다(티커 자리에서 회사명을 읽어도 문자열이라 터지지 않는다).
 * 그래서 `fields` 의 **이름으로 인덱스를 찾고**, 넷 중 하나라도 없으면 던진다(폐기된 T-137 의 `parseSecResponse`
 * 가 쓴 방식과 같다 — 그 파일은 저장소에 없어 같은 방식으로 다시 썼다).
 *
 * ## NYSE 판정은 정확 일치다
 * 2026-11-01 측정(10,430행)에서 `exchange` 값은 `Nasdaq · NYSE · OTC · CBOE · TXSE · null` 여섯뿐이고
 * `'NYSE American'`·`'NYSE Arca'` 같은 별도 값은 **없다**. 그래서 `=== 'NYSE'` 로 가른다.
 * ⚠ 그 값에는 **NYSE Arca 상장 ETP 가 섞여 있다**(BMO·UBS 의 ETN 수십 개, ProShares Trust II 의 ETF 등) →
 * SEC 만으로는 보통주를 가려낼 수 없고 KIS 종목 마스터 필터(`kis-overseas-master.ts`)가 **필수**다.
 */

/** 이 작업이 쓰는 SEC 상장 목록 URL. `SecClient` 의 허용 접두(`https://www.sec.gov/`) 안이다. */
export const SEC_COMPANY_TICKERS_EXCHANGE_URL = 'https://www.sec.gov/files/company_tickers_exchange.json';

export interface SecListingRow {
  cik: number;
  name: string | null;
  ticker: string;
  /** 원값 그대로(`null` 포함) — 제안 근거 문장에 그대로 싣는다. */
  exchange: string | null;
}

/** SEC 응답이 기대한 모양이 아니다 — 추측해서 읽지 않는다. */
export class SecListingShapeError extends Error {
  constructor(message: string) {
    super(`SEC 상장 목록 판독 불가 — ${message}`);
    this.name = 'SecListingShapeError';
  }
}

/**
 * `{fields, data}` → 행 배열. **`fields` 의 이름으로** 인덱스를 찾는다. 네 열 중 하나라도 없거나 `data` 가
 * 배열이 아니면 던진다. 개별 행은 cik·ticker 를 읽을 수 없으면 **그 행만** 버리고 센다(전체를 실패시키지 않는다 —
 * 10,430행 중 한 줄의 흠으로 월간 산출을 못 돌리는 쪽이 더 나쁘다).
 */
export function parseSecExchangeResponse(json: unknown): { rows: SecListingRow[]; dropped: number } {
  if (!json || typeof json !== 'object') throw new SecListingShapeError('응답 본문이 객체가 아님');
  const o = json as Record<string, unknown>;
  const fields = o.fields;
  const data = o.data;
  if (!Array.isArray(fields)) throw new SecListingShapeError('fields 가 배열이 아님');
  if (!Array.isArray(data)) throw new SecListingShapeError('data 가 배열이 아님');
  const idx = (name: string): number => {
    const i = fields.findIndex((f) => typeof f === 'string' && f.trim().toLowerCase() === name);
    if (i < 0) throw new SecListingShapeError(`fields 에 '${name}' 열이 없음 (${fields.join(',')})`);
    return i;
  };
  const iCik = idx('cik');
  const iName = idx('name');
  const iTicker = idx('ticker');
  const iExchange = idx('exchange');

  const rows: SecListingRow[] = [];
  let dropped = 0;
  for (const raw of data) {
    if (!Array.isArray(raw)) { dropped += 1; continue; }
    const cik = Number(raw[iCik]);
    const ticker = typeof raw[iTicker] === 'string' ? (raw[iTicker] as string).trim().toUpperCase() : '';
    if (!Number.isSafeInteger(cik) || cik <= 0 || !ticker) { dropped += 1; continue; }
    const name = typeof raw[iName] === 'string' ? (raw[iName] as string).trim() || null : null;
    const ex = typeof raw[iExchange] === 'string' ? (raw[iExchange] as string).trim() || null : null;
    rows.push({ cik, name, ticker, exchange: ex });
  }
  return { rows, dropped };
}

/**
 * 비보통주 접미사 — 우선주(`-P*`)·워런트(`-WT*`)·유닛(`-UN`)·권리(`-RI`)·when-issued(`-WI`) 등.
 * 2026-11-01 기준 NYSE 3,269행 중 **506행**이 여기 걸린다(접미사별 수는 `counts_json` 에 남긴다).
 *
 * ⚠ **한 글자 접미사는 걸지 않는다** — 2026-11-01 파일에서 한 글자 접미사(`-A`·`-B`·`-C`·`-V`)는 **전부 보통주
 * 클래스**였다(24건, `AKO-A`·`BRK-B`·`MKC-V` …). `-U`·`-R`·`-W`·`-WS` 는 두 글자 이상 규칙의 예외로 명시해
 * 포함했다(유닛·권리·워런트의 짧은 표기). 이 규칙이 틀려 보통주를 떨어뜨리면 1회차 `counts_json` 의
 * 접미사별 집계와 후보 표 506행을 사람이 훑어 잡는다.
 */
export const NONCOMMON_SUFFIX = /-(P[A-Z]?|WT[A-Z]?|UN|RI|WI|U|R|W|WS)$/;

/** 보통주 클래스 표기(`BRK-B`·`MKC-V`) — 유지한다. */
export const CLASS_SUFFIX = /^[A-Z]{1,5}-[A-Z]$/;

export function isNoncommonTicker(ticker: string): boolean {
  return NONCOMMON_SUFFIX.test(ticker);
}

/** 사전 제외의 집계 키 — `-BAC-PL` → `PL`. 접미사를 못 읽으면 `other`. */
export function noncommonSuffixOf(ticker: string): string {
  const m = NONCOMMON_SUFFIX.exec(ticker);
  return m ? m[1] : 'other';
}

/**
 * SEC `exchange` 값 → 내부 거래소 코드. 매핑이 없으면 null(KIS 가 다루지 않는 거래소·장외·null).
 *
 * **두 값뿐이다.** `OTC`·`CBOE`·`TXSE`·null 은 KIS 에 거래소 코드가 없다(`OverseasExchange = NAS|NYS|AMS`) —
 * 예: `ET`(Energy Transfer) 가 `TXSE` 로 적혀 있다. `'NYSE American'`·`'NYSE Arca'` 같은 값은 파일에 **없으므로**
 * 매핑을 미리 넣지 않는다(쓰이지 않는 분기를 두면 나중에 그 값이 생겼을 때 검토 없이 거래 대상이 된다).
 */
export const SEC_EXCHANGE_TO_EXCD: Readonly<Record<string, 'NAS' | 'NYS' | 'AMS'>> = {
  Nasdaq: 'NAS',
  NYSE: 'NYS',
};

/** SEC 의 거래소 값이 KIS 로 거래 가능한 코드인가. `OTC`·`TXSE`·`CBOE`·null 은 아니다. */
export function excdForSecExchange(exchange: string | null): 'NAS' | 'NYS' | 'AMS' | null {
  if (!exchange) return null;
  return SEC_EXCHANGE_TO_EXCD[exchange.trim()] ?? null;
}

/**
 * SEC 티커 → 내부 심볼. 내부 규약은 **점**(`kis-symbols.ts` 의 `/^[A-Z]{3}:[A-Z][A-Z0-9.]*$/`)이고
 * SEC 는 하이픈을 쓴다 → `BRK-B` → `NYS:BRK.B`. `toSecTicker`(`us-edgar/parse.ts`)의 역이다.
 */
export function internalSymbolFor(excd: 'NAS' | 'NYS' | 'AMS', ticker: string): string {
  return `${excd}:${ticker.toUpperCase().replace(/-/g, '.')}`;
}

/**
 * KIS 종목 마스터에서 찾아볼 표기 후보 — 마스터의 `symb` 열이 어떤 표기를 쓰는지에 의존하지 않게 셋을 다 본다.
 *
 * 2026-11-01 실측(`NYSMST.COD` 2,841행): 클래스주는 **슬래시**다(`BRK/B`·`AKO/A`·`MKC/V`) — 하이픈·점 표기는
 * 0건이었다. 그래도 후보 셋을 유지한다(마스터 표기가 바뀌어도 조용히 빠지지 않게).
 */
export function kisSymbolCandidates(ticker: string): string[] {
  const t = ticker.toUpperCase();
  const out = [t];
  for (const v of [t.replace(/-/g, '/'), t.replace(/-/g, '.')]) if (!out.includes(v)) out.push(v);
  return out;
}

/**
 * 🔴 **외국 발행사(ADR·ADS) 로 보이는 이름 표지** — 보고·집계 전용이고 **제외 근거로 쓰지 않는다.**
 *
 * 왜 두는가(Reviewer WP-A high-1): L-A2 의 ADR 제외는 KIS 마스터의 `isdr` 한 열에만 기댔는데 그 열이
 * **ADR 을 대부분 표시하지 않는다** — 2026-11-01 보관본을 **이 파일의 힌트 정규식으로** 센 결과
 * 적중 180행 중 **115행(64%)이 `isdr=N`** 이고, 사양 §5.2 가 상위 50 진입을 예상한 ADR 10종 중 `Y` 는
 * TSM·TM **둘뿐**이다. (`DEPOSITARY` 까지 넣은 더 넓은 정규식으로는 183/118 이 된다 — 우리가 쓰는 수치는 앞의 것이다.)
 * (BABA·NVO·SHEL·TTE·HSBC·SONY·UL·BHP 는 전부 `N`). 그 상태에서 `dr_excluded`·`dr_virtual_ranks` 가 `Y` 만 세면
 * **비어 있는 안전장치가 작동하는 것처럼 보고된다.**
 *
 * ⚠ **이름 휴리스틱은 오탐이 난다**(예: 이름에 'SPONSORED' 가 없는 ADR, 'ADS' 가 다른 뜻인 회사). 그래서
 * 이것으로 **제외하지 않고**, 「`isdr=N` 인데 이름상 외국 발행사로 보이는 수」를 **추정치로 함께 보고**한다.
 * 제대로 된 판정(SEC 20-F/40-F/6-K 제출 여부 — 즉 실적 블랙아웃이 실제로 비는지)은 **켜기 전 별도 설계**다.
 */
export const FOREIGN_ISSUER_NAME_HINT = /\b(ADR|ADS|ADRS|SPON|SPONSORED)\b/i;

/**
 * 이름이 외국 발행사(ADR·ADS)로 **보이나** — 추정일 뿐이다(제외 근거 아님).
 *
 * 🔴 **KIS 마스터의 `enam` 에 쓴다. SEC `name` 에 쓰면 안 된다** — 2026-11-01 보관본 실측으로 SEC NYSE
 * 3,269행 중 이 힌트에 걸리는 이름이 **0건**이고(`Alibaba Group Holding Ltd`·`Shell plc` 처럼 표지가 없다)
 * 마스터 `enam` 에서는 180행이 걸린다(`ALIBABA GROUP HOLDING LTD SPON ADS …`). 출처를 잘못 고르면
 * 집계가 늘 0이 되어 **「의심 없음」으로 읽힌다.**
 */
export function looksLikeForeignIssuerName(name: string | null | undefined): boolean {
  return typeof name === 'string' && FOREIGN_ISSUER_NAME_HINT.test(name);
}

/** `exchange === 'NYSE'`(정확 일치)인 행만. SEC 파일의 순서를 **그대로 보존**한다(스캔 커서의 기준). */
export function nyseRows(rows: readonly SecListingRow[]): SecListingRow[] {
  return rows.filter((r) => r.exchange === 'NYSE');
}

/** 티커 → 행 목록(같은 티커가 두 거래소에 있을 수 있으므로 배열 — 2026-11-01 측정에서는 0건이었다). */
export function indexByTicker(rows: readonly SecListingRow[]): Map<string, SecListingRow[]> {
  const m = new Map<string, SecListingRow[]>();
  for (const r of rows) {
    const cur = m.get(r.ticker);
    if (cur) cur.push(r); else m.set(r.ticker, [r]);
  }
  return m;
}

/** CIK → 행 목록(같은 회사의 여러 티커 — 클래스주·ETN 발행사). */
export function indexByCik(rows: readonly SecListingRow[]): Map<number, SecListingRow[]> {
  const m = new Map<number, SecListingRow[]>();
  for (const r of rows) {
    const cur = m.get(r.cik);
    if (cur) cur.push(r); else m.set(r.cik, [r]);
  }
  return m;
}
