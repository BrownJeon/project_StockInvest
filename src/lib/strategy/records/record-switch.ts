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
 *
 * ## 연결 상한·조회 합치기 (T-139)
 * - 스위치 SELECT 는 풀 `query()` 가 아니라 {@link withBoundedConn}(T-135 헬퍼)으로 보낸다 — 풀에서 연결 하나를 받아 그 연결로 SELECT 를 보내고,
 *   2초 상한에 걸리면 그 연결을 **그 자리에서 destroy** 한다(풀 슬롯이 돌아오고, 서버는 끊긴 연결의 대기 SELECT 를 거둔다). 상한이 연결을
 *   기다리는 중에 오면 나중에 받은 연결로는 SELECT 를 보내지 않고 release 한다. 상한 전의 문장 오류도 그 연결은 destroy(상태를 믿지 않는다 —
 *   bounded-conn 규칙), 결과는 예전과 같은 read_error 다.
 *   왜: 예전 `withDeadline(pool.query(…))` 는 **호출자의 기다림만** 끊었다. `system_config` 가 잠기면(표 잠금·메타데이터 잠금 …) 2초 뒤 꺼짐으로
 *   돌아와도 그 SELECT 를 보낸 풀 연결은 응답이 올 때까지 풀에 돌아오지 않았다(운영 `lock_wait_timeout` 86400초). 독립 Reviewer 재현(일회용
 *   MariaDB 10.11 · 실 mysql2 풀 10개): 단일 호출 busy 1 유지, 같은 키 10건 동시 busy 10·free 0 — 공용 풀은 주문 승인·`submitOrder`·UI 와 같이 쓴다.
 * - 같은 키의 진행 중 조회를 합친다(single-flight): 캐시가 빈 동안 같은 키로 N번 불러도 조회는 1번, 모두 같은 결과를 받는다(상한도 그 한 조회
 *   기준 — 늦게 합류한 호출은 남은 시간만 기다린다). 진행 중 표지는 값·오류·시간 초과 어느 쪽으로 끝나도 **반드시** 지운다(지우지 않으면 그 키가
 *   영구히 같은 결과를 돌려준다). 결과는 조회가 끝난 시각으로 캐시에 한 번 쓴다.
 * - 판정(위 규칙)·반환 모양·`RecordSwitchSource` 5값·키별 30초 캐시·경고 문구는 그대로다. 동시 호출이 합쳐지므로 같은 키의 초과·오류 경고는
 *   동시 호출 수만큼이 아니라 조회마다 한 줄이다.
 * - 범위 밖(T-139 「하지 않는 것」): 엔진·주문·`/api/health` 의 스위치 읽기(`readExitEngineSwitch`·`isKillSwitchActive`·`isDryRun` 등)는 이 모듈이
 *   아니다 — 상한을 걸면 타임아웃이 어느 쪽(자동 매도 안 함 / 계속 진행)으로 떨어질지를 정해야 하는 별도 설계 결정이다.
 */
import { getPool } from '@/lib/db';
import { withBoundedConn, type BoundedConnUse, type BoundedPool } from './bounded-conn';

/** T-126 — `exit_judgment_record_enabled`(청산 판단 기록, `exit-judgment.ts`)도 같은 판정·같은 30초 캐시를 쓴다. 기존 두 키의 동작은 그대로다. */
export type RecordSwitchKey = 'job_run_log_enabled' | 'judgment_record_enabled' | 'exit_judgment_record_enabled';
export const RECORD_SWITCH_KEYS: readonly RecordSwitchKey[] = ['job_run_log_enabled', 'judgment_record_enabled', 'exit_judgment_record_enabled'];
export const RECORD_SWITCH_TIMEOUT_MS = 2000;
export const RECORD_SWITCH_CACHE_MS = 30_000;

const LOG = '[strategy/records/switch]';
const SWITCH_SQL = 'SELECT value FROM system_config WHERE `key` = ? LIMIT 1';

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
/** (T-139) 같은 키의 진행 중 조회 — 끝나면(값·오류·초과) 반드시 지운다. */
const inflight = new Map<RecordSwitchKey, Promise<RecordSwitchState>>();
/** (T-139) 시험용 초기화 세대 — 초기화 전에 시작한 조회가 늦게 끝나도 초기화 뒤의 캐시에 쓰지 않게. */
let generation = 0;

/** 시험 전용 — 캐시를 비운다. (T-139) 진행 중 조회 표지도 지운다 — 초기화 뒤의 호출이 그 전에 시작한 조회에 합류하지 않게. */
export function resetRecordSwitchCacheForTest(): void {
  cache.clear();
  inflight.clear();
  generation += 1;
}

function isKnownKey(key: unknown): key is RecordSwitchKey {
  return typeof key === 'string' && (RECORD_SWITCH_KEYS as readonly string[]).includes(key);
}

function warn(msg: string): void {
  try { console.warn(`${LOG} ${msg}`); } catch { /* 로그 실패도 흡수 */ }
}

/**
 * (T-139) 스위치 SELECT 1문장 — {@link withBoundedConn} 이 준 창구(풀에서 받은 연결 하나)로 보낸다. 연결 끝내기(release·destroy)는 그 헬퍼가 맡는다.
 * 결과 해석은 예전 `pool.query(…).then(([rows]) => …)` 와 같다(행 묶음이 배열이 아니거나 첫 행이 없으면 키 없음, 응답을 풀 수 없으면 던진다 → read_error).
 * `getPool()` 은 이 안에서 부른다 — 던지면 예전처럼 read_error 로 간다.
 */
async function selectSwitch(bc: BoundedConnUse, key: RecordSwitchKey): Promise<RecordSwitchState> {
  const db = bc.use(getPool() as unknown as BoundedPool);
  const [rows] = (await db.query(SWITCH_SQL, [key])) as [unknown, unknown];
  const row: unknown = Array.isArray(rows) ? rows[0] : undefined;
  if (!row) return { enabled: false, source: 'missing' };            // 키 없음 = 꺼짐
  return { enabled: recordSwitchValueEnabled((row as { value?: unknown }).value), source: 'value' };
}

async function readOnce(key: RecordSwitchKey): Promise<RecordSwitchState> {
  try {
    // (T-139) 상한·예외면 withBoundedConn 이 SELECT 연결을 그 자리에서 풀에서 뺀다(받는 중이었으면 도착하는 대로 SELECT 없이 release).
    const v = await withBoundedConn(RECORD_SWITCH_TIMEOUT_MS, (bc) => selectSwitch(bc, key));
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
 * (T-139) 같은 키의 진행 중 조회를 합친다 — 진행 중이면 그 약속을 같이 기다린다. 결과는 조회가 끝난 시각으로 캐시에 한 번 쓴다(초기화 뒤면 쓰지 않는다).
 * 진행 중 표지는 값·오류·초과 어느 쪽으로 끝나도 finally 에서 지운다 — 자기 표지일 때만(초기화 뒤 새 조회의 표지를 지우지 않게).
 * `readOnce` 는 던지지 않으므로 조회 약속은 값으로 끝난다(캐시 쓰기가 던지는 경우만 거부 — 호출자의 catch 가 read_error 로 받는다).
 */
function readShared(key: RecordSwitchKey): Promise<RecordSwitchState> {
  const running = inflight.get(key);
  if (running) return running;
  const gen = generation;
  const flight: Promise<RecordSwitchState> = readOnce(key)
    .then((state) => {
      if (gen === generation) cache.set(key, { state, at: Date.now() });
      return state;
    })
    .finally(() => {
      if (inflight.get(key) === flight) inflight.delete(key);
    });
  inflight.set(key, flight);
  return flight;
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
    return await readShared(key);                                     // (T-139) 같은 키 진행 중 조회에 합류 — 캐시 쓰기는 조회 쪽에서 한 번
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
