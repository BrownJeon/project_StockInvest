/**
 * T-143 — 자동 산출 설정(`system_config.overseas_universe_refresh`) 판독. **이 표 한 줄만 읽는다.**
 *
 * ## 왜 `store.ts` 에서 떼어냈나 (T-145 ③)
 * 분석 쪽 판독기 `readOverseasUniverse`(`src/lib/strategy/universe-overseas-static.ts`)가 자동 목록을 읽기
 * **전에** 이 스위치를 봐야 한다. 그런데 `store.ts` 는 그 판독기를 **거꾸로** import 하므로
 * (`fallbackOverseasUniverse`·`parseRevisionSymbols` — `store.ts:17`) 판독기가 `store.ts` 를 부르면
 * `strategy → universe/store → strategy` 순환이 된다. 그래서 **설정 판독만** 이 모듈로 가른다.
 *
 * 🔴 `AUTO_REFRESH_CONFIG_KEY` 와 `enabled` 해석은 **여기 한 벌뿐**이고 `store.ts` 가 그대로 재수출한다.
 * 두 벌이 되면 한쪽만 고쳐 어긋나고, 「스위치가 거짓말을 한다」가 바로 ③ 이 고치는 결함이다.
 *
 * 이 모듈은 주문·시그널·안전장치와 무관하다 — `src/lib/safety/**` 를 import 하지 않고 SELECT 한 문장만 보낸다.
 */
import type { RowDataPacket } from 'mysql2/promise';
import { getPool } from '@/lib/db';
import { MANUAL_LIST_MAX } from './parse-manual-list';

/**
 * 최소 쿼리 인터페이스 — mysql2 Pool 과 시험 대역이 모두 만족한다.
 * `store.Queryable`·`us-data-db.Queryable`·`universe-overseas-static.Queryable` 과 **구조가 같다**
 * (이 프로젝트의 기존 방식 — 타입을 `store.ts` 에서 가져오면 그 모듈과 다시 엮인다).
 */
export interface Queryable {
  query<T = unknown>(sql: string, params?: unknown[]): Promise<[T, unknown]>;
}

function pool(): Queryable {
  return getPool() as unknown as Queryable;
}
function rowsOf<T>(out: unknown): T[] {
  return Array.isArray(out) ? (out as T[]) : [];
}
function intOf(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? Math.trunc(v) : null;
  if (typeof v === 'bigint') return Number(v);
  if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim())) return Math.trunc(Number(v.trim()));
  return null;
}

export interface AutoRefreshConfig {
  /** 자동 산출을 돌리나 — WP-A 의 관문. 분석 쪽 판독기도 이 값을 본다(T-145 ③) */
  enabled: boolean;
  /** 자동 목록 개수(Q4) */
  topN: number;
  /** KST 요일 0=일 … 6=토 */
  weekday: number;
  /** 그 달의 몇 번째 그 요일(1 = 첫째) */
  nth: number;
  /** 창 시작·끝 'HH:MM'(KST) — 산출은 이 창 안에서만 돈다(WP-A) */
  windowStart: string;
  windowEnd: string;
  /** DR(주식예탁증서) 종목 제외 — WP-A 가 쓴다 */
  excludeDr: boolean;
}

/**
 * `system_config.overseas_universe_refresh` — 키가 없거나 해석 불가면 이 기본값(재배포 없이 값만 바꿔 조정한다).
 *
 * 🔴 **매월 1일 02시 KST 를 쓰지 않는다**(W-1, Analyst WP-A 설계 교차 확인 2026-11-01). 그 시각은 평일이면
 * **미국 정규장 한가운데**(정규장 = KST 23:30~06:00)이고 KIS 유량이 가장 빡빡하다. 산출이 1시간 넘게 이어지면
 * 종목마다 **다른 시각의 가격**으로 순위를 매기게 된다.
 * 그래서 **그 달 첫째 일요일 01:10~05:50 KST** 다 — 미국·국내 모두 휴장이고, 금요일 종가 하나로 가격 단면이
 * 통일되며, 06~08시 무거운 틱과 겹치지 않는다.
 *
 * `enabled` 는 **꺼짐이 기본**이다(새 기능 = 꺼짐 — `post_market_overseas_enabled` 와 같은 방향).
 */
export const AUTO_REFRESH_DEFAULT: AutoRefreshConfig = {
  enabled: false, topN: 50, weekday: 0, nth: 1, windowStart: '01:10', windowEnd: '05:50', excludeDr: true,
};
export const AUTO_REFRESH_CONFIG_KEY = 'overseas_universe_refresh';

/** 숫자 설정 하나를 범위 안으로. 범위 밖·숫자 아님은 기본값(설정 실수로 화면이 깨지지 않게). */
function clampInt(v: unknown, def: number, min: number, max: number): number {
  const n = intOf(v);
  return n != null && n >= min && n <= max ? n : def;
}
/** 'HH:MM'(24시) 만 받는다. 그 밖은 기본값 — 창 문자열이 깨지면 예정 시각이 엉뚱해진다. */
export function parseHhmm(v: unknown, def: string): string {
  const t = typeof v === 'string' ? v.trim() : '';
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(t) ? t : def;
}

/** 설정 한 줄의 원값과 **판독에 실패했는지**. 두 호출자가 같은 질의·같은 해석을 쓰게 한다. */
interface RawRead { value: unknown; failed: boolean }

async function fetchRaw(db: Queryable): Promise<RawRead> {
  try {
    const [out] = await db.query<RowDataPacket[]>(
      'SELECT value FROM system_config WHERE `key` = ?', [AUTO_REFRESH_CONFIG_KEY],
    );
    return { value: rowsOf<RowDataPacket>(out)[0]?.value ?? null, failed: false };
  } catch (e) {
    /**
     * 🔴 **판독 실패를 조용히 삼키지 않는다**(Codex C2 지적 1 — 전에는 로그가 0줄이었다).
     * 오류 `code`/`name` 만 남긴다 — 설정 **값**은 어떤 경우에도 로그에 적지 않는다.
     */
    const x = e as { code?: string; name?: string } | null;
    console.warn(
      `[universe/refresh-config] 자동 산출 설정(${AUTO_REFRESH_CONFIG_KEY}) 판독 실패: `
      + `${String(x?.code ?? x?.name ?? 'unknown').slice(0, 60)} — 「꺼짐」과 구별해 호출부에 알린다`,
    );
    return { value: null, failed: true };
  }
}

/** 원값 → 설정 객체. 비-JSON·배열·널은 `null`(= 기본값으로). */
function asObject(raw: unknown): Record<string, unknown> | null {
  if (raw == null) return null;
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch { /* 손으로 넣은 비-JSON 값 — 기본값으로 */ }
  return null;
}

/** 정확히 `true` 일 때만 켜짐으로 본다(키 없음·`'on'` 같은 값·해석 불가 = 꺼짐). */
function enabledOf(o: Record<string, unknown> | null): boolean {
  return o?.enabled === true;
}

export interface AutoRefreshConfigRead {
  /** 설정값. 판독에 실패하면 기본값(= `enabled:false`)이다 — 그대로 쓰면 「꺼짐」과 구별할 수 없다. */
  cfg: AutoRefreshConfig;
  /**
   * 🔴 설정을 **읽지 못했다**(Codex C2 지적 1). 「사용자가 껐다」와 반드시 가른다 —
   * 전자는 정상이고 후자는 **모르는 것**이다. 실행 여부를 정하는 쪽(크론 관문)은 이 값을 `enabled` 보다
   * **먼저** 봐야 한다. 그러지 않으면 DB 판독 장애가 정상 비활성과 글자 그대로 같은 응답이 되어
   * 그 달 산출 누락과 미완 경고 누락이 **조용히** 지나간다.
   */
  readFailed: boolean;
}

/**
 * 🔴 설정을 **한 번 읽어** 값과 「판독했는지」를 함께 돌려준다. **던지지 않는다.**
 *
 * 왜 한 번인가: 관문 판정(`enabled`)과 창 설정(`windowStart`·`windowEnd`·`weekday`·`nth`·`topN`)이
 * **서로 다른 읽기**에서 나오면 그 사이 설정이 바뀌어 「켜짐인데 창은 옛 값」 같은 어긋남이 생긴다.
 * 질의·해석은 계속 한 벌이고(`fetchRaw`·`asObject`·`enabledOf`) 아래 두 함수가 이 결과에서 파생된다.
 */
export async function readAutoRefreshConfigChecked(db: Queryable = pool()): Promise<AutoRefreshConfigRead> {
  const raw = await fetchRaw(db);
  if (raw.failed) return { cfg: { ...AUTO_REFRESH_DEFAULT }, readFailed: true };
  const o = asObject(raw.value);
  return {
    cfg: {
      enabled: enabledOf(o),
      topN: clampInt(o?.topN, AUTO_REFRESH_DEFAULT.topN, 1, MANUAL_LIST_MAX),
      weekday: clampInt(o?.weekday, AUTO_REFRESH_DEFAULT.weekday, 0, 6),
      nth: clampInt(o?.nth, AUTO_REFRESH_DEFAULT.nth, 1, 5),
      windowStart: parseHhmm(o?.windowStart, AUTO_REFRESH_DEFAULT.windowStart),
      windowEnd: parseHhmm(o?.windowEnd, AUTO_REFRESH_DEFAULT.windowEnd),
      excludeDr: o?.excludeDr !== false,
    },
    readFailed: false,
  };
}

/**
 * 설정값만. **던지지 않는다** — DB 오류·키 없음은 기본값이다.
 *
 * ⚠ 이 함수는 판독 실패를 **삼킨다**(기본값으로 축약한다). 표시·예정 계산에는 그게 맞지만
 * **실행 여부를 정하는 데 쓰면 안 된다** — `readAutoRefreshConfigChecked` 를 쓴다(Codex C2 지적 1).
 */
export async function readAutoRefreshConfig(db: Queryable = pool()): Promise<AutoRefreshConfig> {
  return (await readAutoRefreshConfigChecked(db)).cfg;
}

export interface AutoRefreshSwitch {
  /** 자동 산출이 켜져 있나. 판독에 실패하면 **꺼짐**이다(보수적 — 자동 목록은 대상을 더하는 쪽이다). */
  enabled: boolean;
  /**
   * 🔴 설정을 **읽지 못했다**. 「꺼짐」과 가른다 — 꺼짐은 사용자가 그렇게 둔 상태라 고장이 아니고,
   * 판독 실패는 모르는 것이라 **반드시 저하로 알려야 한다**(조용히 빠지면 대상이 줄어든 줄 아무도 모른다).
   */
  readFailed: boolean;
}

/**
 * 스위치만 — **꺼짐과 판독 실패를 가른다**(T-145 ③-4). **던지지 않는다.**
 *
 * 왜 `readAutoRefreshConfig` 로 대신할 수 없나: 그쪽은 판독 실패를 **기본값으로 삼켜서**
 * (표시·예정 계산용이라 그게 맞다) `enabled:false` 가 「사용자가 껐다」인지 「못 읽었다」인지 알 수 없다.
 * 분석 대상을 정하는 쪽은 그 구분이 필요하다 — 전자는 정상, 후자는 저하다.
 * 질의와 `enabled` 해석은 `readAutoRefreshConfig` 와 **같은 함수**를 쓴다(두 곳이 다르게 읽으면 안 된다).
 */
export async function readAutoRefreshSwitch(db: Queryable = pool()): Promise<AutoRefreshSwitch> {
  // 같은 **한 번의 읽기**에서 파생한다(위 `readAutoRefreshConfigChecked` 주석) — 두 곳이 다르게 읽으면 안 된다
  const r = await readAutoRefreshConfigChecked(db);
  return { enabled: r.readFailed ? false : r.cfg.enabled, readFailed: r.readFailed };
}
