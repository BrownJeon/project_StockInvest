/**
 * 텔레그램 콜백 폴러 (T-042) — `getUpdates` 롱폴링으로 버튼 입력을 앱 **안으로 가져온다.**
 *
 * ## 왜 웹훅이 아니라 폴링인가
 * 웹훅은 텔레그램이 우리 서버로 들어오는 **새 공개 경로**가 필요하다(미들웨어 무인증 목록 변경 = 인증 게이트 변경).
 * 그리고 이 봇은 TradingInvest 와 공유라 **봇당 하나뿐인 웹훅을 우리가 차지**하게 된다. 폴링은 바깥으로 나가는 요청만 쓰고
 * 공개 경로가 0개다.
 *
 * ## 안전 설계
 *  - **단일 소비자**: DB 락(`GET_LOCK`)을 쥔 프로세스만 폴링한다. 블루/그린 전환 중 두 릴리스가 잠깐 함께 떠도 한쪽만 읽는다.
 *    락을 잃으면(연결 끊김) 폴링을 멈추고 다시 잡는다. 같은 업데이트가 두 번 처리돼도 승인은 원자적 전이로 한 번만 일어난다(이중 방어).
 *  - **오프셋 영속**: 재기동 후 이미 처리한 입력을 다시 읽지 않는다. 처리 **후** 저장하므로 최소 한 번(at-least-once) 처리 — 처리기가 멱등이다.
 *  - **독이 든 업데이트**: 처리기가 던져도 오프셋은 넘어간다(같은 입력에서 영원히 멈추지 않는다).
 *  - **409(다른 소비자)**: 백오프하고, 반복되면 critical 경보 — TradingInvest 를 되살리면서 수신 코드를 넣었다는 신호다.
 *  - **서버 기동·주문 경로와 격리**: `instrumentation.ts` 에서 지연 기동하고 모든 예외를 삼킨다. 이 루프가 죽어도 앱은 산다(웹 승인 경로가 남는다).
 *  - 두 스위치: `telegram_poller_enabled`(폴링 자체, 자가 점검 가능) → `telegram_approval_enabled`(거래 동작). 기본 둘 다 꺼짐.
 */
import type { BotCallResult, InlineKeyboard, TelegramCallbackQuery, TelegramUpdate } from '../notify/telegram-api';
import type { ApprovalDeps, ApprovalSignalView } from './telegram-approval';
import type { ApprovalPath } from './approval-transitions';

// ─────────────────────────────────────────────────────────────────────────────
// 순수 부분 — 한 번의 폴링 단계
// ─────────────────────────────────────────────────────────────────────────────

export interface PollDeps {
  loadOffset(): Promise<number>;
  saveOffset(offset: number): Promise<void>;
  getUpdates(offset: number, timeoutSec: number): Promise<BotCallResult<TelegramUpdate[]>>;
  handle(cq: TelegramCallbackQuery): Promise<unknown>;
  /**
   * 이 소비자가 아직 단일 소비자 락을 쥐고 있는가 (T-047). 롱폴링·처리 도중 락을 잃었을 수 있다 —
   * 그 사이 다른 소비자가 같은 배치를 처리하고 더 큰 오프셋을 저장했을 수 있으므로, 잃었으면 배치를 버린다.
   * 던지면(연결 끊김) 쥐고 있다고 믿지 않는다: 예외가 그대로 전파되고 아무것도 저장하지 않는다.
   */
  stillHoldsLock(): Promise<boolean>;
  /** 처리기가 던진 업데이트(오프셋은 넘어간다) */
  onPoison?(update: TelegramUpdate, error: unknown): void;
}

export type PollStep =
  | { kind: 'processed'; handled: number; waitMs: 0 }
  /** 락을 잃어 배치의 나머지를 버렸다. 처리가 끝난 업데이트의 오프셋까지는 저장했다(단조 SQL 이라 역행 없음), 남은 것은 미처리·미저장 */
  | { kind: 'lock_lost'; handled: number; waitMs: 0 }
  | { kind: 'idle'; handled: 0; waitMs: 0 }
  | { kind: 'conflict'; handled: 0; waitMs: number }
  | { kind: 'rate_limited'; handled: 0; waitMs: number }
  | { kind: 'unconfigured'; handled: 0; waitMs: number }
  | { kind: 'error'; handled: 0; waitMs: number; error: string };

export const LONG_POLL_SEC = 25;
const CONFLICT_WAIT_MS = 15_000;
const UNCONFIGURED_WAIT_MS = 5 * 60_000;

/** 연속 실패 횟수 → 대기 시간: 2s, 4s, 8s … 최대 60s */
export function backoffMs(consecutiveFailures: number): number {
  // NaN 이 새면 setTimeout(NaN) 이 즉시 실행돼 실패가 이어지는 동안 대기 없이 요청을 연타한다 — 항상 유한한 값을 돌려준다.
  const n = Number.isFinite(consecutiveFailures) ? Math.max(1, Math.floor(consecutiveFailures)) : 1;
  return Math.min(60_000, 1000 * 2 ** Math.min(n, 6));
}

export async function pollOnce(d: PollDeps): Promise<PollStep> {
  const offset = await d.loadOffset();
  const res = await d.getUpdates(offset, LONG_POLL_SEC);

  if (!res.ok) {
    if (res.skipped) return { kind: 'unconfigured', handled: 0, waitMs: UNCONFIGURED_WAIT_MS };
    if (res.conflict) return { kind: 'conflict', handled: 0, waitMs: CONFLICT_WAIT_MS };
    if (res.status === 429) return { kind: 'rate_limited', handled: 0, waitMs: Math.max(1, res.retryAfterSec ?? 5) * 1000 };
    return { kind: 'error', handled: 0, waitMs: 0, error: res.error };
  }

  const updates = [...res.result].sort((a, b) => a.update_id - b.update_id);
  if (updates.length === 0) return { kind: 'idle', handled: 0, waitMs: 0 };

  // T-047: 롱폴링(최대 25초) 도중 락을 잃었을 수 있다 — 그러면 이 배치는 이미 다른 소비자 몫이다.
  // 이 확인이 첫 업데이트의 "처리 전" 확인을 겸한다(둘 사이에 아무 일도 없다).
  if (!(await d.stillHoldsLock())) return { kind: 'lock_lost', handled: 0, waitMs: 0 };

  let handled = 0;
  for (const u of updates) {
    if (u.callback_query) {
      try {
        await d.handle(u.callback_query);
        handled++;
      } catch (e) {
        // 같은 입력에서 영원히 멈추지 않도록 오프셋은 넘긴다 — 처리기는 던지지 않게 설계돼 있어 이 분기는 방어용이다.
        d.onPoison?.(u, e);
      }
    }
    // 처리 후 저장 — 최소 한 번 처리. 🔴 순서는 **저장 → 락 확인** (T-047 Codex C2):
    //  - 처리(handle·독·무시)가 끝난 업데이트는 락을 잃었어도 오프셋을 저장한다. 저장하지 않으면 새 소유자가 같은 콜백을
    //    다시 받고, 확정 거부로 선점이 풀린(releaseClaim) 시그널은 원자적 전이가 다시 성공해 **재승인 없이 두 번째 주문**이 나간다
    //    (순차 재처리는 조건부 전이가 막지 못한다 — 이 경로에서는 처리기가 멱등이 아니다).
    //  - 락을 잃은 뒤 저장해도 안전하다: 저장 SQL 이 단조 증가라 다른 소비자가 저장한 더 큰 값을 되돌리지 못한다.
    //  - 저장이 던지면 그대로 전파한다(루프가 백오프).
    await d.saveOffset(u.update_id + 1);
    // 그다음 확인 — 잃었으면 남은 업데이트는 처리하지 않는다. 이 확인이 다음 업데이트의 "처리 전" 확인을 겸한다(둘 사이에 아무 일도 없다).
    if (!(await d.stillHoldsLock())) return { kind: 'lock_lost', handled, waitMs: 0 };
  }
  return { kind: 'processed', handled, waitMs: 0 };
}

// ─────────────────────────────────────────────────────────────────────────────
// 단일 소비자 락
// ─────────────────────────────────────────────────────────────────────────────

export const POLLER_LOCK_NAME = 'stockinvest:telegram-poller';

/** 락 전용 연결의 최소 면 — mysql2 `PoolConnection` 이 구조적으로 만족한다. */
export interface LockConn {
  query(sql: string, params?: unknown[]): Promise<unknown>;
}

function firstRow(res: unknown): Record<string, unknown> | undefined {
  const rows = Array.isArray(res) ? res[0] : res;
  return Array.isArray(rows) ? (rows[0] as Record<string, unknown> | undefined) : undefined;
}

/** 락을 즉시(대기 0초) 시도한다. 다른 프로세스가 쥐고 있으면 false. */
export async function tryAcquireLock(conn: LockConn): Promise<boolean> {
  const row = firstRow(await conn.query('SELECT GET_LOCK(?, 0) AS got', [POLLER_LOCK_NAME]));
  return Number(row?.got) === 1;
}

/** 이 연결이 아직 락을 쥐고 있는가 (연결이 끊겼다 되살아나면 락은 사라진다) */
export async function stillHoldsLock(conn: LockConn): Promise<boolean> {
  const row = firstRow(await conn.query('SELECT IS_USED_LOCK(?) = CONNECTION_ID() AS held', [POLLER_LOCK_NAME]));
  return Number(row?.held) === 1;
}

export async function releaseLock(conn: LockConn): Promise<void> {
  try { await conn.query('SELECT RELEASE_LOCK(?)', [POLLER_LOCK_NAME]); } catch { /* 연결이 이미 죽었으면 락도 없다 */ }
}

// ─────────────────────────────────────────────────────────────────────────────
// 승인 처리기 배선 — 의존성 주입 (T-042 감사 D-5)
//
// 이 층은 "누가 승인할 수 있는가"를 정한다(허용 채팅·허용 사용자·서명 키·하이브리드 판정·승인 경로 매핑).
// 순수 처리기(`telegram-approval.ts`)가 아무리 잘 시험돼도 여기가 틀리면 권한이 틀린다 — 그래서 모든 협력자를
// `ApprovalIO` 로 주입받아 테스트가 끝까지 돌려 볼 수 있게 한다. 기본 구현(`defaultApprovalIO`)만 실제 모듈을 불러온다.
// ─────────────────────────────────────────────────────────────────────────────

export interface ApprovalIO {
  readConfig(key: string): Promise<unknown>;
  getCredential(key: string): Promise<string>;
  getSessionSecret(): string | undefined;
  deriveKey(secret: string | undefined): Buffer | null;
  service: {
    getSignalById(id: number): Promise<{ id: unknown; status: unknown; symbol: unknown; side: 'buy' | 'sell'; amount_krw: unknown; indicators: unknown; expires_at: unknown } | null>;
    approveSignal(id: number): Promise<{ ok: boolean; orderId?: number; error?: string; errorCode?: string; orderResult?: unknown }>;
    approveSignalHybrid(id: number): Promise<{ ok: boolean; error?: string; errorCode?: string }>;
    rejectSignal(id: number): Promise<{ ok: boolean; error?: string }>;
  };
  tg: {
    answerCallbackQuery(id: string, text?: string, showAlert?: boolean): Promise<unknown>;
    editTelegramMessage(chatId: number, messageId: number, text: string, keyboard?: InlineKeyboard): Promise<unknown>;
    clearTelegramKeyboard(chatId: number, messageId: number): Promise<unknown>;
    sendTelegramMessage(text: string, keyboard?: InlineKeyboard): Promise<unknown>;
  };
  getSymbolLabel(symbol: string): Promise<string>;
  isKillSwitchActive(): Promise<boolean>;
  isHybridModeEnabled(): Promise<boolean>;
  insertAudit(event: string, payload: Record<string, unknown>): Promise<void>;
  alertThrottled(key: string, level: 'critical' | 'warning' | 'info', title: string, body: string, ttlMs: number): void;
  now(): Date;
}

/** 호출 시점에 읽는다 — 운영자가 끈 스위치가 캐시 때문에 더 살아 있으면 안 된다 */
export function buildApprovalDepsFrom(io: ApprovalIO): ApprovalDeps {
  const readFlagIO = async (key: string): Promise<boolean> => (await io.readConfig(key).catch(() => undefined)) === true;
  const ownerChatId = async (): Promise<string> => String((await io.getCredential('TELEGRAM_CHAT_ID')) ?? '').trim();

  return {
    key: io.deriveKey(io.getSessionSecret()),
    now: () => io.now(),
    enabled: () => readFlagIO('telegram_approval_enabled'),
    allowedChatIds: async () => {
      const id = await ownerChatId();
      return new Set(id ? [id] : []);
    },
    allowedUserIds: async () => {
      const explicit = await io.readConfig('telegram_approval_user_ids').catch(() => undefined);
      if (Array.isArray(explicit) && explicit.length > 0) {
        // 허용 목록은 엄격하게: 양의 정수 ID(숫자 또는 숫자 문자열)만. `null`·객체·빈 문자열이 "null" 같은 문자열로 새지 않게 한다.
        const ids = explicit
          .map((x) => (typeof x === 'number' && Number.isSafeInteger(x) ? String(x) : typeof x === 'string' ? x.trim() : ''))
          .filter((v) => /^\d+$/.test(v));
        // 명시 설정이 있는데 쓸 수 있는 값이 하나도 없으면 폴백하지 않고 *아무도 허용하지 않는다* (잘못 쓴 설정이 조용히 기본값으로 넓어지지 않게)
        return new Set(ids);
      }
      // 개인 채팅이면 채팅 ID == 사용자 ID. 그룹(음수)이면 명시 설정이 없는 한 아무도 허용하지 않는다(fail-closed).
      const id = await ownerChatId();
      return new Set(/^\d+$/.test(id) ? [id] : []);
    },
    getSignal: async (id): Promise<ApprovalSignalView | null> => {
      const row = await io.service.getSignalById(id);
      return row ? {
        id: Number(row.id), status: String(row.status), symbol: String(row.symbol), side: row.side,
        amount_krw: row.amount_krw as string | number, indicators: row.indicators, expires_at: row.expires_at as Date | string | null,
      } : null;
    },
    isKillSwitchActive: () => io.isKillSwitchActive(),
    isHybridEnabled: () => io.isHybridModeEnabled(),
    approve: async (id, path: ApprovalPath) => {
      if (path === 'hybrid') {
        const r = await io.service.approveSignalHybrid(id);
        // T-072 G4 — 하이브리드 승인도 검증 관문 코드를 넘긴다(그래야 mapFailure 가 한국어 문구로 바꾼다)
        return { ok: r.ok, error: r.error, errorCode: r.errorCode };
      }
      const r = await io.service.approveSignal(id);
      return {
        ok: r.ok, orderId: r.orderId, error: r.error, errorCode: r.errorCode,
        dryRun: (r.orderResult as { dryRun?: boolean } | undefined)?.dryRun,
      };
    },
    reject: (id) => io.service.rejectSignal(id),
    label: (symbol) => io.getSymbolLabel(symbol),
    appUrl: async () => {
      const v = await io.readConfig('app_public_url').catch(() => undefined);
      return typeof v === 'string' && v.trim() ? v.trim() : null;
    },
    audit: (event, payload) => io.insertAudit(event, payload),
    onUnauthorized: ({ fromId, chatId, action }) => {
      io.alertThrottled(
        'telegram-approval:unauthorized', 'critical', '🚨 텔레그램 승인 버튼을 허용 목록 밖에서 눌렀습니다',
        `발신자 ${fromId} · 채팅 ${chatId ?? '-'} · 동작 ${action}. 소유자가 아니라면 봇 토큰 유출을 의심하세요 (공유 봇).`,
        60 * 60_000,
      );
    },
    telegram: {
      answer: (queryId, text, showAlert) => io.tg.answerCallbackQuery(queryId, text, showAlert),
      edit: (chatId, messageId, text, keyboard) => io.tg.editTelegramMessage(chatId, messageId, text, keyboard),
      clearKeyboard: (chatId, messageId) => io.tg.clearTelegramKeyboard(chatId, messageId),
      send: (text, keyboard) => io.tg.sendTelegramMessage(text, keyboard),
    },
  };
}

/** 실제 모듈을 지연 import 한다 (서버 기동 경로에서 무거운 모듈을 끌어오지 않으려고 호출 시점에). */
export async function defaultApprovalIO(): Promise<ApprovalIO> {
  const [{ getSessionSecret }, { deriveApprovalKey }, { getCredential }, service, tg, notify, { isKillSwitchActive }, { getPool }, transitions, { sendAlertThrottled }] =
    await Promise.all([
      import('@/lib/auth/session'),
      import('./telegram-callback-data'),
      import('@/lib/credentials'),
      import('./service'),
      import('../notify/telegram-api'),
      import('@/lib/notify'),
      import('@/lib/safety/kill-switch'),
      import('@/lib/db'),
      import('./approval-transitions'),
      import('@/lib/notify/throttle'),
    ]);

  const readConfig = async (key: string): Promise<unknown> => {
    const [rows] = await getPool().query<import('mysql2').RowDataPacket[]>(
      'SELECT value FROM system_config WHERE `key` = ? LIMIT 1', [key],
    );
    if (rows.length === 0) return undefined;
    try { return JSON.parse(rows[0].value as string); } catch { return rows[0].value; }
  };

  return {
    readConfig,
    getCredential,
    getSessionSecret,
    deriveKey: deriveApprovalKey,
    service: {
      getSignalById: (id) => service.getSignalById(id),
      approveSignal: (id) => service.approveSignal(id),
      approveSignalHybrid: (id) => service.approveSignalHybrid(id),
      rejectSignal: (id) => service.rejectSignal(id),
    },
    tg: {
      answerCallbackQuery: tg.answerCallbackQuery,
      editTelegramMessage: tg.editTelegramMessage,
      clearTelegramKeyboard: tg.clearTelegramKeyboard,
      sendTelegramMessage: tg.sendTelegramMessage,
    },
    getSymbolLabel: notify.getSymbolLabel,
    isKillSwitchActive,
    isHybridModeEnabled: () => transitions.readHybridModeEnabled(getPool()),
    insertAudit: async (event, payload) => {
      await getPool().query('INSERT INTO trade_logs (order_id, event, payload) VALUES (?, ?, ?)', [null, event, JSON.stringify(payload)]);
    },
    alertThrottled: (key, level, title, body, ttl) => { sendAlertThrottled(key, level, title, body, ttl); },
    now: () => new Date(),
  };
}

export async function buildApprovalDeps(): Promise<ApprovalDeps> {
  return buildApprovalDepsFrom(await defaultApprovalIO());
}

// ─────────────────────────────────────────────────────────────────────────────
// 루프 — 의존성 주입 (`LoopIO`)
// ─────────────────────────────────────────────────────────────────────────────

export interface PollerHandle { stopped: boolean; startedAt: number }

/** 서버 기동 직후 DB·네트워크 경합을 피하려고 늦춰 시작한다 */
export const START_DELAY_MS = 30_000;
export const DISABLED_RECHECK_MS = 30_000;
export const LOCK_RETRY_MS = 30_000;
/** 폴링 중 락을 잃은 뒤 재획득을 시도하기 전 최소 대기 (T-047 R-1) */
export const LOCK_LOST_WAIT_MS = 1_000;
const FAILURE_ALERT_AT = 10;
const CONFLICT_ALERT_AT = 3;

export interface LoopIO {
  readFlag(key: string): Promise<boolean>;
  /** 락 전용으로 풀에서 연결을 하나 빌린다. 반납은 루프가 `finally` 에서 **한 번만** 한다 */
  getConnection(): Promise<LockConn & { release(): void }>;
  buildDeps(): Promise<ApprovalDeps>;
  loadOffset(): Promise<number>;
  saveOffset(offset: number): Promise<void>;
  getUpdates: PollDeps['getUpdates'];
  handle(cq: TelegramCallbackQuery, deps: ApprovalDeps): Promise<unknown>;
  alert(key: string, level: 'critical' | 'warning', title: string, body: string, ttlMs: number): void;
  sleep(ms: number): Promise<void>;
  info(msg: string): void;
  error(msg: string): void;
}

export async function runLoop(io: LoopIO, handle: PollerHandle): Promise<void> {
  let failures = 0;
  let conflicts = 0;

  while (!handle.stopped) {
    if (!(await io.readFlag('telegram_poller_enabled'))) { await io.sleep(DISABLED_RECHECK_MS); continue; }

    // 연결은 **여기서 한 번 빌리고 finally 에서 한 번만 반납**한다 (두 번 반납하면 mysql2 풀에 같은 연결이 중복 등록돼
    // 서로 다른 쿼리가 한 연결을 나눠 쓴다). 대기(sleep)는 반납한 **뒤**에 한다 — 쉬는 동안 풀 슬롯을 쥐지 않는다.
    let waitAfter = 0;
    const conn = await io.getConnection();
    let held = false;
    try {
      held = await tryAcquireLock(conn);
      if (!held) {
        waitAfter = LOCK_RETRY_MS;
      } else {
        io.info('[telegram-poller] 락 획득 — 폴링 시작');
        const deps = await io.buildDeps();
        const pollDeps: PollDeps = {
          loadOffset: () => io.loadOffset(),
          saveOffset: (n) => io.saveOffset(n),
          getUpdates: (offset, t) => io.getUpdates(offset, t),
          handle: (cq) => io.handle(cq, deps),
          stillHoldsLock: () => stillHoldsLock(conn),
          onPoison: (u, e) => io.error(`[telegram-poller] 업데이트 ${u.update_id} 처리 중 예외(건너뜀): ${e instanceof Error ? e.message : String(e)}`),
        };

        while (!handle.stopped && (await io.readFlag('telegram_poller_enabled')) && (await stillHoldsLock(conn))) {
          const step = await pollOnce(pollDeps);
          if (step.kind === 'error') {
            failures++;
            conflicts = 0;
            io.error(`[telegram-poller] getUpdates 실패(${failures}회 연속): ${step.error}`);
            if (failures >= FAILURE_ALERT_AT) {
              io.alert('telegram-poller:failing', 'warning', '텔레그램 폴러가 계속 실패합니다',
                `getUpdates 가 ${failures}회 연속 실패했습니다. 마지막 오류: ${step.error.slice(0, 200)}\n버튼 승인이 동작하지 않을 수 있습니다 — 앱에서 처리하세요.`, 60 * 60_000);
            }
            await io.sleep(backoffMs(failures));
          } else if (step.kind === 'conflict') {
            conflicts++;
            failures = 0;
            if (conflicts >= CONFLICT_ALERT_AT) {
              io.alert('telegram-poller:conflict', 'critical', '🚨 텔레그램 getUpdates 충돌(409)',
                '다른 프로세스가 같은 봇의 getUpdates 를 소비하거나 웹훅이 걸려 있습니다. 공유 봇(TradingInvest)에 수신 코드가 생겼는지 확인하세요. 그동안 버튼 승인은 동작하지 않습니다.', 60 * 60_000);
            }
            await io.sleep(step.waitMs);
          } else if (step.kind === 'lock_lost') {
            // 실패가 아니다(백오프·경보 없음). 락을 내려놓고 연결을 반납한 뒤 다시 잡으러 간다 — 다른 소비자가 쥐고 있으면 그쪽이 계속한다.
            io.info(`[telegram-poller] 락 상실 — 배치를 버리고 재획득을 시도합니다 (처리 ${step.handled}건)`);
            // T-047 R-1: 재획득이 성공한 직후 다시 잃는 일이 반복돼도 대기 없이 getUpdates 를 연타하지 않게 최소 대기를 둔다.
            // 대기는 아래 공통 경로에서 락 해제·연결 반납 **뒤에** 한다. 재획득이 실패하면 그때는 기존 LOCK_RETRY_MS 대기를 탄다.
            waitAfter = LOCK_LOST_WAIT_MS;
            break;
          } else {
            failures = 0;
            conflicts = 0;
            if (step.waitMs > 0) await io.sleep(step.waitMs);
          }
        }
      }
    } catch (e) {
      io.error(`[telegram-poller] 루프 예외(재시도): ${e instanceof Error ? e.message : String(e)}`);
      waitAfter = backoffMs(++failures);
    } finally {
      if (held) await releaseLock(conn);
      try { conn.release(); } catch { /* 이미 반납됨 */ }
    }
    if (waitAfter > 0) await io.sleep(waitAfter);
  }
}

export async function defaultLoopIO(): Promise<LoopIO> {
  const [{ getPool }, tg, { handleCallbackQuery }, { sendAlertThrottled }] = await Promise.all([
    import('@/lib/db'),
    import('../notify/telegram-api'),
    import('./telegram-approval'),
    import('@/lib/notify/throttle'),
  ]);
  const readConfig = async (key: string): Promise<unknown> => {
    const [rows] = await getPool().query<import('mysql2').RowDataPacket[]>('SELECT value FROM system_config WHERE `key` = ? LIMIT 1', [key]);
    if (rows.length === 0) return undefined;
    try { return JSON.parse(rows[0].value as string); } catch { return rows[0].value; }
  };
  return {
    readFlag: async (key) => (await readConfig(key).catch(() => undefined)) === true,
    getConnection: () => getPool().getConnection() as unknown as Promise<LockConn & { release(): void }>,
    buildDeps: () => buildApprovalDeps(),
    loadOffset: async () => { const v = await readConfig('telegram_poll_offset').catch(() => 0); return Number.isInteger(v) && (v as number) >= 0 ? (v as number) : 0; },
    saveOffset: async (n) => {
      // 숫자 문자열만 SQL 로 보낸다 — 아니면 CAST 가 엄격 모드에서 오류가 되거나, NaN 이 "null" 로 저장된다
      if (!Number.isSafeInteger(n) || n < 0) throw new Error(`invalid_offset: ${String(n)}`);
      // T-047: **단조 증가**. 락을 잃은 옛 소비자가 늦게 저장해도 더 큰 값을 되돌리지 못한다(110 → 103 회귀 방지).
      // `value` 는 LONGTEXT 라 CAST 로 숫자 비교한다(문자열 비교면 '99' > '110'). 지금 값이 숫자가 아니면(손상) 새 값으로 고친다 —
      // loadOffset 도 그 값을 0 으로 읽으므로 같은 판단이다. ODKU 안의 `value` 는 기존 행의 값, VALUES(value) 는 새 값이다.
      await getPool().query(
        'INSERT INTO system_config (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = '
          + "IF(value NOT REGEXP '^[0-9]+$' OR CAST(VALUES(value) AS UNSIGNED) > CAST(value AS UNSIGNED), VALUES(value), value)",
        ['telegram_poll_offset', JSON.stringify(n)],
      );
    },
    getUpdates: (offset, t) => tg.getTelegramUpdates(offset, t),
    handle: (cq, deps) => handleCallbackQuery(cq, deps),
    alert: (key, level, title, body, ttl) => { sendAlertThrottled(key, level, title, body, ttl); },
    sleep: (ms) => new Promise<void>((r) => { const t = setTimeout(r, ms); t.unref?.(); }),
    info: (m) => console.log(m),
    error: (m) => console.error(m),
  };
}

const HANDLE_KEY = Symbol.for('stockinvest.telegramPoller');

/** 멱등 — 이미 돌고 있으면 아무것도 하지 않는다. 서버 기동을 막지 않는다(지연 시작, 모든 예외를 삼킴). */
export function startTelegramApprovalPoller(): boolean {
  const g = globalThis as Record<symbol, unknown>;
  if (g[HANDLE_KEY]) return false;
  const handle: PollerHandle = { stopped: false, startedAt: Date.now() };
  g[HANDLE_KEY] = handle;

  const t = setTimeout(() => {
    const loop = (): void => {
      defaultLoopIO()
        .then((io) => runLoop(io, handle))
        .catch((e) => {
          console.error('[telegram-poller] 치명적 예외 — 30초 뒤 재시작:', e instanceof Error ? e.message : String(e));
          if (!handle.stopped) setTimeout(loop, 30_000).unref?.();
        });
    };
    loop();
  }, START_DELAY_MS);
  t.unref?.();
  return true;
}

export function stopTelegramApprovalPoller(): void {
  const g = globalThis as Record<symbol, unknown>;
  const h = g[HANDLE_KEY] as PollerHandle | undefined;
  if (h) { h.stopped = true; g[HANDLE_KEY] = null; }
}
