/**
 * T-042 — 텔레그램 폴러의 순수 부분: 한 번의 폴링 단계·백오프·단일 소비자 락.
 *
 * 지킬 것: (1) 처리 **후** 오프셋 저장(최소 한 번) (2) 독이 든 업데이트에서 멈추지 않는다
 * (3) 409/429/미설정/오류를 서로 다른 대기로 구분 (4) 락을 못 잡으면 폴링하지 않는다.
 */
import {
  backoffMs,
  LONG_POLL_SEC,
  pollOnce,
  POLLER_LOCK_NAME,
  releaseLock,
  stillHoldsLock,
  tryAcquireLock,
  type LockConn,
  type PollDeps,
} from '../telegram-poller';
import type { BotCallResult, TelegramUpdate } from '@/lib/notify/telegram-api';

const cb = (update_id: number, data = `si1:a:${update_id}:0000000000000000`): TelegramUpdate => ({
  update_id,
  callback_query: { id: `q${update_id}`, from: { id: 1 }, data, message: { message_id: 9, chat: { id: 1 } } },
});

function deps(res: BotCallResult<TelegramUpdate[]>, over: Partial<PollDeps> = {}) {
  const log: string[] = [];
  const saved: number[] = [];
  const handled: string[] = [];
  const d: PollDeps = {
    loadOffset: async () => 100,
    saveOffset: async (n) => { saved.push(n); log.push(`save:${n}`); },
    getUpdates: jest.fn(async () => res),
    handle: async (cq) => { handled.push(cq.id); log.push(`handle:${cq.id}`); },
    ...over,
  };
  return { d, log, saved, handled };
}

describe('pollOnce — 한 번의 폴링 단계', () => {
  test('저장된 오프셋으로 getUpdates 를 부르고, 업데이트가 없으면 idle', async () => {
    const { d } = deps({ ok: true, result: [] });
    const step = await pollOnce(d);
    expect(step).toEqual({ kind: 'idle', handled: 0, waitMs: 0 });
    expect(d.getUpdates).toHaveBeenCalledWith(100, LONG_POLL_SEC);
  });

  test('🔴 처리한 뒤에 오프셋을 저장하고, update_id + 1 로 넘긴다 (최소 한 번 처리)', async () => {
    const { d, log } = deps({ ok: true, result: [cb(101), cb(102)] });
    const step = await pollOnce(d);
    expect(step).toEqual({ kind: 'processed', handled: 2, waitMs: 0 });
    expect(log).toEqual(['handle:q101', 'save:102', 'handle:q102', 'save:103']);   // 처리 → 저장 순서
  });

  test('순서가 뒤섞여 와도 update_id 순으로 처리한다', async () => {
    const { d, handled } = deps({ ok: true, result: [cb(105), cb(103), cb(104)] });
    await pollOnce(d);
    expect(handled).toEqual(['q103', 'q104', 'q105']);
  });

  test('🔴 독이 든 업데이트(처리기가 던짐)에서도 오프셋은 넘어간다 — 같은 입력에서 영원히 멈추지 않는다', async () => {
    const poison = jest.fn();
    const { d, saved, handled } = deps({ ok: true, result: [cb(101), cb(102), cb(103)] }, {
      handle: async (cq) => { if (cq.id === 'q102') throw new Error('boom'); handled2.push(cq.id); },
      onPoison: poison,
    });
    const handled2: string[] = [];
    const step = await pollOnce(d);
    expect(step).toMatchObject({ kind: 'processed', handled: 2 });     // 던진 건 handled 에 세지 않는다
    expect(handled2).toEqual(['q101', 'q103']);                       // 뒤의 정상 입력은 계속 처리된다
    expect(saved).toEqual([102, 103, 104]);                            // 던진 102 도 오프셋은 넘어갔다
    expect(poison).toHaveBeenCalledTimes(1);
    expect(handled).toEqual([]);                                       // (기본 handle 은 쓰이지 않음)
  });

  test('callback_query 가 없는 업데이트도 오프셋은 넘긴다', async () => {
    const { d, saved, handled } = deps({ ok: true, result: [{ update_id: 200 }] });
    expect(await pollOnce(d)).toMatchObject({ kind: 'processed', handled: 0 });
    expect(saved).toEqual([201]);
    expect(handled).toEqual([]);
  });

  test('🔴 오프셋 저장이 실패하면 예외를 전파한다 (조용히 같은 입력을 다시 처리하지 않도록 루프가 재시도·경보한다)', async () => {
    const { d } = deps({ ok: true, result: [cb(101)] }, { saveOffset: async () => { throw new Error('db down'); } });
    await expect(pollOnce(d)).rejects.toThrow('db down');
  });

  test('409 → conflict + 긴 대기, 입력은 건드리지 않는다', async () => {
    const { d, log } = deps({ ok: false, status: 409, conflict: true, error: 'HTTP 409' });
    expect(await pollOnce(d)).toEqual({ kind: 'conflict', handled: 0, waitMs: 15_000 });
    expect(log).toEqual([]);
  });

  test('429 → retry_after 만큼 (최소 1초)', async () => {
    expect(await pollOnce(deps({ ok: false, status: 429, retryAfterSec: 7, error: 'HTTP 429' }).d)).toEqual({ kind: 'rate_limited', handled: 0, waitMs: 7000 });
    expect(await pollOnce(deps({ ok: false, status: 429, error: 'HTTP 429' }).d)).toMatchObject({ kind: 'rate_limited', waitMs: 5000 });
    expect(await pollOnce(deps({ ok: false, status: 429, retryAfterSec: 0, error: 'HTTP 429' }).d)).toMatchObject({ waitMs: 1000 });
  });

  test('토큰 미설정 → unconfigured + 5분 대기 (조용히 바쁘게 돌지 않는다)', async () => {
    expect(await pollOnce(deps({ ok: false, skipped: true, error: 'telegram_not_configured' }).d))
      .toEqual({ kind: 'unconfigured', handled: 0, waitMs: 300_000 });
  });

  test('그 밖의 오류는 error 로 돌려주고 호출처가 백오프한다', async () => {
    expect(await pollOnce(deps({ ok: false, error: 'fetch failed (ETIMEDOUT)' }).d))
      .toEqual({ kind: 'error', handled: 0, waitMs: 0, error: 'fetch failed (ETIMEDOUT)' });
  });
});

describe('backoffMs', () => {
  test('2s, 4s, 8s … 최대 60s', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 50].map(backoffMs)).toEqual([2000, 4000, 8000, 16000, 32000, 60000, 60000, 60000]);
  });
  test('이상한 입력에도 유한한 값', () => {
    for (const n of [0, -3, NaN, 1.7]) {
      const v = backoffMs(n);
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(2000);
      expect(v).toBeLessThanOrEqual(60_000);
    }
  });
});

describe('단일 소비자 락', () => {
  const conn = (row: Record<string, unknown> | undefined): LockConn & { sqls: string[]; params: unknown[][] } => {
    const sqls: string[] = [];
    const params: unknown[][] = [];
    return {
      sqls, params,
      async query(sql: string, p: unknown[] = []) { sqls.push(sql); params.push(p); return [row ? [row] : [], []]; },
    };
  };

  test('GET_LOCK 이 1 이면 획득, 0/NULL 이면 못 잡은 것 (대기 0초)', async () => {
    const ok = conn({ got: 1 });
    expect(await tryAcquireLock(ok)).toBe(true);
    expect(ok.sqls[0]).toMatch(/GET_LOCK\(\?, 0\)/);
    expect(ok.params[0]).toEqual([POLLER_LOCK_NAME]);
    expect(await tryAcquireLock(conn({ got: 0 }))).toBe(false);
    expect(await tryAcquireLock(conn({ got: null }))).toBe(false);
    expect(await tryAcquireLock(conn(undefined))).toBe(false);
  });

  test('🔴 락을 잃었는지 확인한다 — 연결 ID 가 락 소유자와 다르면 false', async () => {
    expect(await stillHoldsLock(conn({ held: 1 }))).toBe(true);
    expect(await stillHoldsLock(conn({ held: 0 }))).toBe(false);
    expect(await stillHoldsLock(conn({ held: null }))).toBe(false);
    expect(await stillHoldsLock(conn(undefined))).toBe(false);          // 행이 없다 = 락 정보를 읽지 못했다 → 쥐고 있다고 믿지 않는다
    expect(await stillHoldsLock(conn({ held: 2 }))).toBe(false);         // 1(참)만 참이다
    const c = conn({ held: 1 });
    await stillHoldsLock(c);
    expect(c.sqls[0]).toMatch(/IS_USED_LOCK\(\?\) = CONNECTION_ID\(\)/);
  });

  test('락 해제는 연결이 이미 죽었어도 던지지 않는다', async () => {
    await expect(releaseLock({ query: async () => { throw new Error('gone'); } })).resolves.toBeUndefined();
  });
});
