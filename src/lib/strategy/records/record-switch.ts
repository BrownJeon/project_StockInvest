/**
 * T-112 기록 스위치 — `system_config.job_run_log_enabled`(크론 실행 기록) · `judgment_record_enabled`(장마감 분석 판단 기록).
 *
 * ## 규칙 (T-112 「구현 규칙」 스위치 행 — fail-closed)
 * - **키 없음 = 꺼짐.** 정확히 JSON `true`(드라이버가 이미 파싱한 `true` 포함)일 때만 켜짐. `"1"`·`1`·`"yes"`·해석 불가 값 = 꺼짐.
 * - DB 오류·테이블 없음·**2초 초과** = 꺼짐. 던지지 않는다.
 * - 배포 시점에는 두 키가 없다(꺼짐). 켜기는 DDL 적용 사용자 승인 뒤 Leader 가 한다.
 * - 판정 규칙은 시그널 현금 관문 스위치의 `gateSwitchValueEnabled`(`src/lib/signals/signal-cash-gate.ts`)와 같다(T-116 뉴스 캡처 스위치도
 *   같은 규칙을 복제해 쓴다). 기록 모듈이 다른 영역을 import 하지 않도록 4줄을 복제했다 — **원본 규칙이 바뀌면 여기도 같이 고칠 것.**
 *
 * ## 캐시
 * 키마다 결과를 30초 기억한다(크론 기록 라우트는 매 분 불린다 — 스위치 읽기가 DB 를 매 분 두드리지 않게). 오류·시간 초과로 꺼짐이 된 결과도
 * 30초 기억한다(아픈 DB 를 거듭 두드리지 않는다 — 그동안 기록은 건너뛴다, 관찰 전용이라 흐름 영향 0). 켠 뒤 최대 30초 늦게 반영된다.
 */
import type { RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';
import { withDeadline } from './safe-text';

/** T-126 — `exit_judgment_record_enabled`(청산 판단 기록, `exit-judgment.ts`)도 같은 판정·같은 30초 캐시를 쓴다. 기존 두 키의 동작은 그대로다. */
export type RecordSwitchKey = 'job_run_log_enabled' | 'judgment_record_enabled' | 'exit_judgment_record_enabled';
export const RECORD_SWITCH_KEYS: readonly RecordSwitchKey[] = ['job_run_log_enabled', 'judgment_record_enabled', 'exit_judgment_record_enabled'];
export const RECORD_SWITCH_TIMEOUT_MS = 2000;
export const RECORD_SWITCH_CACHE_MS = 30_000;

const LOG = '[strategy/records/switch]';

/** 정확히 JSON `true` 만 켜짐(위 머리 주석). */
export function recordSwitchValueEnabled(raw: unknown): boolean {
  if (raw === true) return true;
  if (typeof raw !== 'string') return false;
  try { return JSON.parse(raw) === true; } catch { return false; }
}

/** 읽은 결과의 출처 — missing(키 없음)·value(값을 읽음)·read_error·timeout·unknown_key(허용 목록 밖). */
export type RecordSwitchSource = 'missing' | 'value' | 'read_error' | 'timeout' | 'unknown_key';
export interface RecordSwitchState { enabled: boolean; source: RecordSwitchSource }

interface CacheEntry { state: RecordSwitchState; at: number }
const cache = new Map<RecordSwitchKey, CacheEntry>();

/** 시험 전용 — 캐시를 비운다. */
export function resetRecordSwitchCacheForTest(): void {
  cache.clear();
}

function isKnownKey(key: unknown): key is RecordSwitchKey {
  return typeof key === 'string' && (RECORD_SWITCH_KEYS as readonly string[]).includes(key);
}

function warn(msg: string): void {
  try { console.warn(`${LOG} ${msg}`); } catch { /* 로그 실패도 흡수 */ }
}

async function readOnce(key: RecordSwitchKey): Promise<RecordSwitchState> {
  try {
    const q = getPool().query<(RowDataPacket & { value: unknown })[]>(
      'SELECT value FROM system_config WHERE `key` = ? LIMIT 1',
      [key],
    ).then(([rows]): RecordSwitchState => {
      const row = Array.isArray(rows) ? rows[0] : undefined;
      if (!row) return { enabled: false, source: 'missing' };          // 키 없음 = 꺼짐
      return { enabled: recordSwitchValueEnabled(row.value), source: 'value' };
    });
    const v = await withDeadline(q, RECORD_SWITCH_TIMEOUT_MS);
    if (v === undefined) {
      warn(`스위치(${key}) 읽기 ${RECORD_SWITCH_TIMEOUT_MS}ms 초과 — 꺼짐으로 본다`);
      return { enabled: false, source: 'timeout' };
    }
    return v;
  } catch (e) {
    warn(`스위치(${key}) 읽기 실패 — 꺼짐으로 본다: ${e instanceof Error ? e.message : String(e)}`);
    return { enabled: false, source: 'read_error' };
  }
}

/**
 * 기록 스위치 상태 — `enabled` 는 {@link readRecordSwitch} 와 같고, `source` 로 "꺼져 있다(missing·value)"와 "읽지 못했다
 * (read_error·timeout)"를 가른다(크론 기록 라우트가 읽지 못했을 때 러너 스풀을 버리지 않게 하려는 것). 절대 던지지 않는다.
 */
export async function readRecordSwitchState(key: RecordSwitchKey): Promise<RecordSwitchState> {
  try {
    if (!isKnownKey(key)) return { enabled: false, source: 'unknown_key' };
    const now = Date.now();
    const hit = cache.get(key);
    if (hit && now - hit.at >= 0 && now - hit.at < RECORD_SWITCH_CACHE_MS) return hit.state;
    const state = await readOnce(key);
    cache.set(key, { state, at: Date.now() });
    return state;
  } catch (e) {
    warn(`스위치(${String(key)}) 읽기 예외 — 꺼짐으로 본다: ${e instanceof Error ? e.message : String(e)}`);
    return { enabled: false, source: 'read_error' };
  }
}

/**
 * 기록 스위치 읽기 — 켜짐이면 true. 키 없음·해석 불가·DB 오류·2초 초과 = false(fail-closed). 절대 던지지 않는다.
 * 허용 목록 밖 키는 DB 를 건드리지 않고 false.
 */
export async function readRecordSwitch(key: RecordSwitchKey): Promise<boolean> {
  return (await readRecordSwitchState(key)).enabled;
}
