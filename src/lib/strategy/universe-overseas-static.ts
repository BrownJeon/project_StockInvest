/**
 * 해외(미국주식) **분석 대상 목록** 판독기.
 *
 * 우선순위는 **DB > 환경변수 > 코드 하드코딩**이다(T-143 WP-B0, 구현 가이드 §8.1·부록 2 권고).
 *
 * ## 왜 이 함수가 DB 를 보게 됐나 (T-143 — 2026-11-01)
 * 설정 › 해외 분석 대상 화면이 수동 목록을 DB(`overseas_universe_revision`)에 저장하는데, **이 함수가 DB 를 읽지 않으면
 * 화면이 저장해도 분석 대상이 하나도 바뀌지 않는다.** 그런데 화면의 성공 문구는 「다음 「해외 장마감 분석」부터 반영됩니다」라고
 * 단정한다 → 읽는 쪽(이 파일)과 화면은 **같은 릴리스에 함께 나가야 한다**(가이드 §0.1 불편한 사실 1 · §8.4 완료 기준 ①).
 *
 * ## 폴백 규칙 — 절대 던지지 않는다
 * 결과는 늘 **「수동 쪽 목록」 ∪ 「자동 목록」**이고, 둘을 각자 따로 구한다.
 *  1. **수동 쪽** — 개정판이 있으면 그 목록, **없으면(행 0건)** 환경변수 `OVERSEAS_UNIVERSE_SYMBOLS`
 *     (호환 폴백 `ALLOWED_SYMBOLS_OVERSEAS`), 그것도 비어 있으면 코드 하드코딩 `SP500_TOP50`.
 *  2. **자동 쪽** — `overseas_universe_auto`(WP-A 가 채운다). 비어 있으면 빈 목록.
 *  3. **조회가 실패하면**(DB 오류·해석 불가·원소 손상) 그 쪽만 **마지막으로 제대로 읽은 값 → 환경변수 →
 *     코드 하드코딩** 순으로 대체하고 `degraded: true` 로 알린다. 손상된 값은 **캐시에 넣지 않는다**.
 *  4. 표 자체가 없으면(errno 1146) **언제나 `degraded: true`** 이고 **사유만** 가른다 — 본 적 없으면
 *     `not_migrated`(코드가 DDL 보다 먼저 떴다 = 순서 위반 신호), 한 번이라도 성공한 뒤면 `table_missing`
 *     (가동 중 소실). 자동 쪽은 `auto_not_migrated`·`auto_table_missing` 이다.
 *     **자동 조회를 건너뛰는 것은 이 1146 계열뿐**이다 — `bad_json`·`bad_symbols`·`db_error` 는 그 행·그 질의의
 *     문제라 자동 표가 멀쩡할 수 있어 따로 읽는다(②).
 *
 * 🔴 **개정판이 0건이어도 자동 목록은 반영한다**(W-3, Analyst WP-A 설계 교차 확인 2026-11-01).
 * 수동 목록은 12월 일괄 교체 전까지 비어 있으므로, 그 사이 WP-A 가 자동 목록을 채웠을 때
 * 「개정판이 없으니 폴백만」으로 끝내면 **자동 산출 결과가 분석에 영향을 주지 못한다.**
 *
 * **빈 목록과 「기록 없음」을 구분한다**: 사용자가 일부러 비운 개정판(빈 배열)은 수동 쪽을 **빈 목록 그대로** 둔다 —
 * 그때 환경변수로 되돌아가면 「전부 비우기」가 조용히 무시된다(화면이 그 결과를 확인 시트에서 말했는데 거짓이 된다).
 * 반대로 개정판 자체가 없으면(행 0건) 아직 전환 전이므로 수동 쪽은 종전 동작(환경변수·하드코딩)을 유지한다.
 *
 * DB 를 못 읽어도 분석을 멈추지 않는다 — 목록은 주문 안전장치가 아니라 **무엇을 들여다볼지**의 입력이고,
 * 멈추면 그날 분석이 통째로 비어 버린다. 대신 **실패마다** 경고를 남기고 `degraded: true` 로 호출자에게 알린다
 * (옛 구현은 프로세스당 경고 1회였다 — 장수 웹 프로세스에서 첫 실패 뒤 조용해져 침묵 구간이 생겼다).
 *
 * ## 프로세스 전역성이 성립하는 근거 (`tablesSeen`·`lastGood*` 이 모듈 전역인 이유)
 *
 * 이 모듈의 상태는 **한 프로세스 안에서만** 유효하다. 전제는 `kis-throttle.ts` 가 적어 둔 것과 같다:
 *  - pm2 `stockinvest` 는 `instances: 1`(`ecosystem.config.js`) — 목록을 읽는 JS 가 도는 Node 프로세스가 하나다
 *  - `stockinvest-cron` 은 bash 루프이며 DB 를 직접 읽지 않는다 — `curl http://localhost:3003/api/cron/*` 로
 *    위 단일 프로세스에 위임한다(`scripts/cron-runner.sh`) → 분석도 같은 프로세스 안에서 돈다
 *
 * ⚠️ **`instances` 를 2 이상으로 올리면 깃발·캐시가 워커마다 따로 생긴다.** 그러면 ① 「표가 사라졌다」와
 *    「아직 적용 전」의 **구분이 워커마다 달라진다**(C2 지적 ① 이후 1146 은 어느 워커에서도 저하로 울린다 — 조용한
 *    워커는 없고 `reason` 이름만 `table_missing`/`not_migrated` 로 갈린다) ② 마지막 성공 목록도 워커마다 달라
 *    같은 시각의 두 요청이 다른 목록으로 돌 수 있다. 스케일아웃이 필요해지면 이 상태를 프로세스 밖
 *    (DB·Redis)으로 옮겨야 한다.
 */
import type { RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';
import { isOverseasSymbol } from '@/lib/exchanges/kis-symbols';

export const SP500_TOP50: ReadonlyArray<string> = [
  // Mega cap (NASDAQ)
  'NAS:AAPL', 'NAS:MSFT', 'NAS:NVDA', 'NAS:GOOGL', 'NAS:GOOG',
  'NAS:META', 'NAS:AMZN', 'NAS:TSLA', 'NAS:AVGO', 'NAS:PEP',
  'NAS:COST', 'NAS:ADBE', 'NAS:NFLX', 'NAS:CSCO', 'NAS:AMD',
  'NAS:CMCSA', 'NAS:INTC', 'NAS:QCOM', 'NAS:AMGN', 'NAS:HON',
  'NAS:INTU', 'NAS:ISRG', 'NAS:BKNG', 'NAS:VRTX', 'NAS:GILD',
  // NYSE 대표주
  'NYS:BRK.B', 'NYS:LLY', 'NYS:JPM', 'NYS:V', 'NYS:UNH',
  // F-1(2026-11-01) — 월마트는 2024-12 에 나스닥으로 이전했다. 이 접두어가 틀려 KIS 조회가 매일 실패했고
  // `us_fundamentals_snapshot` 에 12일 내내 0행이었다(Leader 운영 DB 확인). SEC company_tickers_exchange.json 도 Nasdaq.
  // ⚠ `NYS:BRK.B` 는 손대지 않는다 — KIS 가 `.` 표기를 거부하는 것이고 올바른 표기를 아직 모른다(사용자 결정 대기).
  'NAS:WMT', 'NYS:XOM', 'NYS:JNJ', 'NYS:MA', 'NYS:PG',
  'NYS:HD', 'NYS:CVX', 'NYS:ABBV', 'NYS:KO', 'NYS:BAC',
  'NYS:MRK', 'NYS:ORCL', 'NYS:PFE', 'NYS:CRM', 'NYS:DIS',
  'NYS:NKE', 'NYS:MCD', 'NYS:WFC', 'NYS:TMO', 'NYS:ABT',
];

/** 최소 쿼리 인터페이스 — mysql2 Pool 과 시험 대역이 모두 만족한다(`us-data-db.Queryable` 과 같은 모양). */
export interface Queryable {
  query<T = unknown>(sql: string, params?: unknown[]): Promise<[T, unknown]>;
}

/** 환경변수 폴백(종전 동작 그대로). */
export function envOverseasUniverse(): string[] {
  const raw = process.env.OVERSEAS_UNIVERSE_SYMBOLS ?? process.env.ALLOWED_SYMBOLS_OVERSEAS ?? '';
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

/** 환경변수 → 없으면 코드 하드코딩. 호출자가 「폴백이 무엇인가」를 똑같이 계산할 수 있게 내보낸다(화면 합계 — high-2). */
export function fallbackOverseasUniverse(): string[] {
  const env = envOverseasUniverse();
  return env.length > 0 ? env : [...SP500_TOP50];
}

/** 어디서 온 목록인가 — 진단·기록용. */
export type OverseasUniverseSource = 'db' | 'last_good' | 'env' | 'builtin';

/** 폴백 값과 그 출처 — `'builtin'` 이 실제로 쓰이게 둘을 함께 돌려준다. */
function fallbackPart(): { symbols: string[]; source: OverseasUniverseSource } {
  const env = envOverseasUniverse();
  return env.length > 0 ? { symbols: env, source: 'env' } : { symbols: [...SP500_TOP50], source: 'builtin' };
}

export interface OverseasUniverseResult {
  symbols: string[];
  /**
   * 🔴 목록을 **제대로 읽지 못해** 대체 값으로 돌려줬다. 호출자는 이 값을 자기 실패 목록에 넣어야 한다
   * (`loadUsTargetSymbols` → `errors`에 `universe_list` → `post-market-overseas` 가 `symbol_source_fail:*` 로 기록).
   *
   * **표가 없는 것(errno 1146)도 degraded 다**(①). 정식 적용 순서는 **DDL 먼저 · 코드 나중**이라, 코드가 먼저 떠서
   * 표를 못 찾는 구간의 흔적은 거짓 경보가 아니라 **순서 위반 신호**다. 사유로만 가른다 —
   * `not_migrated`(표를 본 적 없음) · `table_missing`(본 적 있음 = 가동 중 소실).
   */
  degraded: boolean;
  /**
   * 짧은 분류어 — 전부 `degraded: true` 와 함께 온다. `null` 만 정상이다.
   *  - 수동 쪽: `not_migrated`(표 없음 · 본 적 없음) · `table_missing`(표 없음 · 본 적 있음) ·
   *    `bad_json`(열을 JSON 배열로 못 읽음) · `bad_symbols`(원소가 종목 코드가 아님) · `db_error` · `pool`
   *  - 자동 쪽: `auto_not_migrated` · `auto_table_missing` · `auto_db_error`
   */
  reason: string | null;
  manualSource: OverseasUniverseSource;
  /** 자동 목록을 못 읽었나(수동과 따로 실패한다) */
  autoDegraded: boolean;
}

/**
 * 🔴 **마지막으로 제대로 읽은 목록**(프로세스 메모리). 조회가 실패하면 환경변수·코드 하드코딩보다 **먼저** 이것을 쓴다.
 *
 * 왜: DB 블립 한 번에 사용자가 저장한 ~100종목이 코드 하드코딩 50종목으로 갈아타면 **분석 대상이 조용히 줄어든다**
 * (Leader 가 운영 DB 로 확인한 WMT·BRK.B 12일 침묵과 같은 유형 — 줄었는데 아무도 모른다).
 * 수동·자동을 **따로** 기억한다: 한쪽만 실패했을 때 성공한 쪽의 최신 값을 옛 값으로 되돌리지 않기 위해서다.
 * 캐시는 **폴백 전용**이다 — 성공한 조회는 늘 DB 값을 쓴다(캐시가 최신 값을 가리지 않는다).
 * 사용자가 일부러 비운 빈 목록도 그대로 기억한다(그것이 마지막 「제대로 읽은」 상태다).
 */
let lastGoodManual: string[] | null = null;
let lastGoodAuto: string[] | null = null;

/**
 * 🔴 **이 프로세스가 T-143 표를 한 번이라도 읽어 본 적이 있다.** 개정판이 0건이어도 조회가 성공했으면 참이다.
 *
 * 🔴 이 깃발은 **조용함을 만들지 않는다**(①). 표가 없으면 언제나 `degraded` 이고, 깃발은 **사유만** 가른다:
 *  - `tablesSeen === false` → `not_migrated` — 코드가 DDL 보다 먼저 떴다. 정식 순서는 **DDL 먼저**이므로 이 구간은
 *    그 자체로 **순서 위반 신호**다(거짓 경보가 아니다).
 *  - `tablesSeen === true` → `table_missing` — **가동 중 소실**이다(롤백 `DROP`·잘못된 DB·적용 전 백업 복원).
 *
 * 왜 깃발만으로 조용함을 만들 수 없나: 적용 **후** 세계에서 재시작은 일상이라(운영 릴리스·`max_memory_restart: 512M`)
 * 재시작 뒤 표가 없으면 깃발이 거짓이라 「본 적 없음」으로 보인다. 즉 깃발이 덮던 것은 가동 중 소실이라는
 * 소수 경우뿐이었고, 그 대가로 **적용 뒤 재시작 + 표 소실**이라는 흔한 조합이 조용해졌다.
 *
 * 영속 표식(`system_config` 한 줄·디스크 파일)은 **쓰지 않는다** — 같은 DB 표식은 「백업 복원」에서 표와 함께 사라지고,
 * 디스크 표식은 새 상태 관리를 들인다. 사유 구분만으로 충분하다.
 */
let tablesSeen = false;

/** 시험 전용 — 프로세스 메모리 초기화(마지막 성공 목록 + 표를 본 적 있다는 깃발). */
export function __resetUniverseCacheForTest(): void {
  lastGoodManual = null;
  lastGoodAuto = null;
  tablesSeen = false;
}

/**
 * 🔴 경고는 **실패마다** 남긴다(프로세스당 1회로 줄이지 않는다). 장수 웹 프로세스에서 첫 실패 뒤 조용해지면
 * 「대상이 줄어든 채 몇 주」가 흔적 없이 지나간다. 값·종목은 남기지 않고 분류어와 수만 남긴다.
 */
function warnDegraded(part: 'manual' | 'auto', reason: string, used: OverseasUniverseSource, count: number): void {
  console.warn(
    `[universe-overseas] ${part === 'manual' ? '수동' : '자동'} 목록 조회 실패(${reason}) — ` +
    `${used} 값 ${count}종목으로 진행합니다. 분석 대상이 실제 설정과 다를 수 있습니다.`,
  );
}

/**
 * 🔴 개정판의 `symbols` 열을 **원자적으로** 읽는다(③) — 하나라도 어긋나면 **null**(= 읽기 실패)이다.
 *
 * 왜 걸러 내지 않고 전부 버리나: 「개정판은 전부 아니면 전무」가 이 시스템의 쓰기 원칙이다(단일 INSERT).
 * 읽기도 같아야 한다 — 비문자열·형식 무효 원소를 **조용히 제거**하면 그 목록이 정상처럼 보이고 캐시에까지 들어가,
 * 손으로 넣은 시드(DDL 헤더가 안내하는 `change_source='seed'` INSERT)의 오타 하나가 분석 대상을 조용히 줄인다.
 *
 * 검사는 `isOverseasSymbol`(`NAS:AAPL` 꼴, import 0개의 순수 모듈)이고 **앱이 쓰는 좁은 패턴의 상위집합**이라
 * 앱이 만든 개정판은 늘 통과한다(쓰기 경로가 `OVERSEAS_LIST_PATTERN` 으로 이미 검증한다).
 *
 * `store.ts` 의 `readManualRevision` 이 **같은 함수**를 쓴다 — 두 곳이 같은 값을 다르게 읽으면
 * 화면은 「수동 0」, 판독기는 「저하」가 되고(3차 L-d) 그 위에서 제안 처리가 빈 목록을 확정한다(⑤).
 */
export function parseRevisionSymbols(v: unknown): string[] | null {
  let arr: unknown = v;
  if (typeof v === 'string') {
    try { arr = JSON.parse(v); } catch { return null; }
  }
  if (!Array.isArray(arr)) return null;
  const out: string[] = [];
  for (const x of arr) {
    if (typeof x !== 'string' || !isOverseasSymbol(x)) return null;
    out.push(x);
  }
  return out;
}

/** JSON 배열로 읽히긴 하는가 — 사유를 `bad_json`(해석 불가)과 `bad_symbols`(원소 손상)로 가르는 데만 쓴다. */
function isJsonArrayText(text: string): boolean {
  try { return Array.isArray(JSON.parse(text)); } catch { return false; }
}

/** 두 목록을 순서 보존으로 합친다(수동 먼저 — 사용자가 고른 것이 앞). */
function union(a: readonly string[], b: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of [...a, ...b]) {
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function errnoOf(e: unknown): number | null {
  const x = e as { errno?: unknown } | null;
  return typeof x?.errno === 'number' ? x.errno : null;
}
/**
 * 1146 = 표 없음. 적용 전(`not_migrated`)과 적용 뒤 소실(`table_missing`)을 **사유 이름으로만** 가르고
 * **둘 다 저하로 올린다** — 재시작을 넘어서는 구분이 불가능하므로 조용히 넘기면 소실이 묻힌다(C2 지적 ①).
 */
function isNotMigrated(e: unknown): boolean {
  return errnoOf(e) === 1146;
}

interface PartRead { symbols: string[]; source: OverseasUniverseSource; degraded: boolean; reason: string | null }

/** 수동 쪽 — 개정판 → (실패 시) 마지막 성공 → 환경변수 → 코드 하드코딩. */
async function readManualPart(conn: Queryable): Promise<PartRead> {
  try {
    const [out] = await conn.query<RowDataPacket[]>(
      'SELECT symbols FROM overseas_universe_revision ORDER BY revision_no DESC LIMIT 1',
    );
    const rows = Array.isArray(out) ? out : [];
    tablesSeen = true;   // 조회가 성공했다 — 행이 0건이어도 「표는 있다」(C-1)
    if (rows.length === 0) {
      // 행 0건 = 아직 DB 로 전환하지 않음(정상). 캐시를 덮지 않는다 — 「읽을 목록이 없다」는 상태다
      const fb = fallbackPart();
      return { symbols: fb.symbols, source: fb.source, degraded: false, reason: null };
    }
    const raw = rows[0]?.symbols;
    const parsed = parseRevisionSymbols(raw);
    if (parsed == null) {
      // 🔴 해석 불가·원소 손상은 「일부러 비움」이 아니라 **읽기 실패**다(빈 목록으로 보면 분석 대상이 조용히 사라진다).
      //   캐시는 **갱신하지 않는다** — 손상된 값이 마지막 성공 목록을 덮으면 복구할 기준이 사라진다
      const fb = fallbackPart();
      const used = lastGoodManual ?? fb.symbols;
      const source: OverseasUniverseSource = lastGoodManual ? 'last_good' : fb.source;
      // JSON 자체를 못 읽은 것과 원소가 어긋난 것을 사유로 구분한다(고치는 방법이 다르다)
      const reason = typeof raw === 'string' && !isJsonArrayText(raw) ? 'bad_json' : 'bad_symbols';
      warnDegraded('manual', reason, source, used.length);
      return { symbols: used, source, degraded: true, reason };
    }
    lastGoodManual = parsed;
    return { symbols: parsed, source: 'db', degraded: false, reason: null };
  } catch (e) {
    const fb = fallbackPart();
    // 🔴 ① — 표가 없으면 **언제나** degraded 다. 사유만 가른다: 표를 본 적이 있으면 `table_missing`(가동 중 소실),
    //   없으면 `not_migrated`(코드가 DDL 보다 먼저 떴다 = **순서 위반 신호**다 — 정식 순서는 DDL 먼저다).
    //   앞서 「본 적 없으면 조용」으로 두었던 것을 뒤집었다: 적용 후 세계에서 재시작은 일상이라
    //   (운영 릴리스·`max_memory_restart`) 깃발이 덮던 것은 「가동 중 소실」이라는 소수 경우뿐이었다.
    const reason = isNotMigrated(e) ? (tablesSeen ? 'table_missing' : 'not_migrated') : 'db_error';
    const used = lastGoodManual ?? fb.symbols;
    const source: OverseasUniverseSource = lastGoodManual ? 'last_good' : fb.source;
    warnDegraded('manual', reason, source, used.length);
    return { symbols: used, source, degraded: true, reason };
  }
}

/**
 * 자동 목록(NYSE 시총 상위 N) — WP-A 가 채운다. 실패하면 **마지막 성공 값**, 없으면 빈 배열이다.
 * 자동 쪽 실패가 사용자가 직접 정한 목록까지 지우면 한 표의 오류가 그날 분석 대상을 통째로 바꾼다.
 */
async function readAutoPart(conn: Queryable): Promise<PartRead> {
  try {
    const [out] = await conn.query<RowDataPacket[]>(
      'SELECT symbol FROM overseas_universe_auto ORDER BY rank_no ASC',
    );
    const symbols = (Array.isArray(out) ? out : [])
      .map((r) => String((r as RowDataPacket).symbol ?? ''))
      .filter(Boolean);
    tablesSeen = true;   // C-1
    lastGoodAuto = symbols;
    return { symbols, source: 'db', degraded: false, reason: null };
  } catch (e) {
    // ① 과 같은 규칙 — 1146 도 degraded 이고 사유만 가른다
    const reason = isNotMigrated(e)
      ? (tablesSeen ? 'auto_table_missing' : 'auto_not_migrated')
      : 'auto_db_error';
    const used = lastGoodAuto ?? [];
    const source: OverseasUniverseSource = lastGoodAuto ? 'last_good' : 'builtin';
    warnDegraded('auto', reason, source, used.length);
    return { symbols: used, source, degraded: true, reason };
  }
}

/**
 * 해외 분석 대상 목록 = **수동 ∪ 자동**(T-143) 또는 폴백. **절대 던지지 않는다.**
 *
 * `db` 를 넘기면 그 연결로 읽는다(호출자가 이미 연결·시험 대역을 들고 있을 때 — `loadUsTargetSymbols` 가 그렇다).
 * 넘기지 않으면 공용 풀을 쓴다.
 *
 * 🔴 `degraded` 를 **버리지 말고 호출자의 실패 목록에 넣는다**(high-1). 심볼만 필요한 호출자는
 * `getStaticOverseasUniverse()` 를 쓰지만, 분석·수집 대상을 정하는 경로는 이 함수를 써야 한다.
 */
export async function readOverseasUniverse(db?: Queryable): Promise<OverseasUniverseResult> {
  let conn: Queryable;
  try {
    conn = db ?? (getPool() as unknown as Queryable);
  } catch (e) {
    const fb = fallbackPart();
    const used = lastGoodManual ?? fb.symbols;
    const source: OverseasUniverseSource = lastGoodManual ? 'last_good' : fb.source;
    warnDegraded('manual', 'pool', source, used.length);
    return { symbols: union(used, lastGoodAuto ?? []), degraded: true, reason: 'pool', manualSource: source, autoDegraded: true };
  }

  const manual = await readManualPart(conn);
  // 🔴 ② — 자동 조회를 **건너뛰는 것은 1146 계열뿐**이다. 두 표는 같은 마이그레이션에 있으므로 「표가 없다」면
  //   자동 표도 없다(쓸모없는 질의를 보내지 않는다). 그러나 `bad_json`·`bad_symbols`·`db_error` 는 **그 행·그 질의의**
  //   문제라 자동 표가 멀쩡할 수 있다 — 거기서 건너뛰면 **WP-A 가 채운 자동 목록이 수동 쪽 손상 때문에 사라진다.**
  //   (앞서 「수동이 degraded 면 자동도 안 본다」로 두었던 것을 좁혔다.)
  if (manual.reason === 'not_migrated' || manual.reason === 'table_missing') {
    return {
      symbols: union(manual.symbols, lastGoodAuto ?? []),
      degraded: true,
      reason: manual.reason,
      manualSource: manual.source,
      autoDegraded: true,          // 읽지 않았으니 「정상」이라고 말하지 않는다
    };
  }

  const auto = await readAutoPart(conn);
  // degraded·reason 을 합성한다 — 수동 쪽 사유가 더 중대하므로 먼저 본다
  return {
    symbols: union(manual.symbols, auto.symbols),
    degraded: manual.degraded || auto.degraded,
    reason: manual.degraded ? manual.reason : (auto.degraded ? auto.reason : null),
    manualSource: manual.source,
    autoDegraded: auto.degraded,
  };
}

/** 심볼만 필요한 호출자용(거래대금 정렬·종목 이름 노출). 실패 사실을 쓰는 경로는 `readOverseasUniverse` 를 쓴다. */
export async function getStaticOverseasUniverse(db?: Queryable): Promise<string[]> {
  return (await readOverseasUniverse(db)).symbols;
}
