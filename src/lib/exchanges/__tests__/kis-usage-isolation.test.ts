/**
 * T-040 🔴 절대 조건 1 — **기록 함수가 던져도 영향 0.**
 *
 * `@workspace/api-usage` 를 스위치가 달린 대역으로 바꾼다: 스위치를 켜면 패키지의 **모든 함수가 던진다**
 * (잘못된 배포·패키지 버그를 흉내). 같은 시나리오를 세 조건에서 돌려 결과가 서로 같은지 직접 비교한다.
 *   A. 정상 기록(쓰기 가능한 임시 디렉터리)
 *   B. 쓸 수 없는 `API_USAGE_LOG_DIR`
 *   C. 패키지 함수 전부 throw
 * 대상: `kisFetch` 시나리오 9종(반환값·예외·재시도·스로틀) + 주문 경로(`submitOrder` → 국내 `createOrder`)
 * + 앱 래퍼(`trackCall`·`trackChild`)가 본 호출의 값·예외·child 를 그대로 넘기는지.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { EventEmitter } from 'node:events';

const mockState = { broken: false };
jest.mock('@workspace/api-usage', () => {
  const real = jest.requireActual('@workspace/api-usage') as Record<string, unknown>;
  const wrapped: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(real)) {
    wrapped[k] = typeof v === 'function'
      ? (...args: unknown[]) => {
          if (mockState.broken) throw new Error(`api-usage broken: ${k}`);
          return (v as (...a: unknown[]) => unknown)(...args);
        }
      : v;
  }
  return wrapped;
});

jest.mock('@/lib/db', () => ({ getPool: jest.fn(), getAccountId: jest.fn() }));
jest.mock('../kis-auth', () => ({
  getKisToken: jest.fn(async () => 'SECRET-TOKEN'),
  invalidateKisToken: jest.fn(async () => {}),
  kisBaseUrl: jest.fn(() => 'https://kis.example'),
}));
jest.mock('@/lib/credentials', () => ({
  getCredential: jest.fn(async (key: string) => {
    if (key === 'KIS_ACCOUNT_NO') return '12345678';
    if (key === 'KIS_ACCOUNT_PRODUCT') return '01';
    return '';   // 텔레그램·슬랙 미설정 → 알림은 skipped (외부 호출 0)
  }),
}));

import { getAccountId, getPool } from '@/lib/db';
import { _internal } from '@workspace/api-usage';
import { trackCall, trackChild, logUsage, usageErrKind, opOf } from '@/lib/api-usage';
import { submitOrder } from '@/lib/safety/dry-run';
import { createOrder } from '../kis-domestic';
import { EXPECTED_OUTCOMES, runAll } from './kis-usage-scenarios';
import { ORDER_REPLIES, runOrderPath, type OrderPathCapture } from './kis-order-usage-scenario';

const ORIGINAL_DIR = process.env.API_USAGE_LOG_DIR;
const ORIGINAL_ENV = { ...process.env };
let tmpRoot: string;

type Cond = 'A-writable' | 'B-unwritable' | 'C-throwing';
function enter(cond: Cond): string {
  _internal.reset();
  mockState.broken = false;
  if (cond === 'B-unwritable') {
    const blocker = path.join(tmpRoot, `blocker-${Math.random().toString(36).slice(2)}`);
    fs.writeFileSync(blocker, 'x');
    process.env.API_USAGE_LOG_DIR = path.join(blocker, 'logs');
  } else {
    process.env.API_USAGE_LOG_DIR = fs.mkdtempSync(path.join(tmpRoot, 'logs-'));
  }
  if (cond === 'C-throwing') mockState.broken = true;
  return process.env.API_USAGE_LOG_DIR;
}

beforeAll(() => { tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 't040-iso-')); });
afterAll(() => {
  mockState.broken = false;
  if (ORIGINAL_DIR === undefined) delete process.env.API_USAGE_LOG_DIR;
  else process.env.API_USAGE_LOG_DIR = ORIGINAL_DIR;
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});
beforeEach(() => {
  process.env.KILL_SWITCH = 'false';
  process.env.KIS_MOCK = 'false';
  process.env.BLOCKED_SYMBOLS_DOMESTIC = '';
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
});
afterEach(() => {
  mockState.broken = false;
  process.env = { ...ORIGINAL_ENV, API_USAGE_LOG_DIR: process.env.API_USAGE_LOG_DIR };
  jest.restoreAllMocks();
});

const CONDS: Cond[] = ['A-writable', 'B-unwritable', 'C-throwing'];

describe('대역 확인 — C 조건에서 패키지 함수는 실제로 던진다', () => {
  it('log·classifyError·interpretResult·recordChild 가 throw', () => {
    enter('C-throwing');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pkg = require('@workspace/api-usage') as Record<string, (...a: unknown[]) => unknown>;
    for (const k of ['log', 'classifyError', 'interpretResult', 'recordChild', 'record', 'checkOp']) {
      expect(() => pkg[k]()).toThrow(/api-usage broken/);
    }
  });
});

describe('kisFetch — 세 조건에서 반환값·예외·재시도·스로틀이 같다', () => {
  it('A·B·C 모두 EXPECTED_OUTCOMES 와 같다', async () => {
    const results: Record<string, unknown> = {};
    for (const c of CONDS) {
      enter(c);
      results[c] = await runAll();
    }
    for (const c of CONDS) expect(results[c]).toEqual(EXPECTED_OUTCOMES);
    expect(results['B-unwritable']).toEqual(results['A-writable']);
    expect(results['C-throwing']).toEqual(results['A-writable']);
  });
});

describe('주문 경로 submitOrder → 국내 createOrder — 세 조건에서 결과·DB 감사 기록이 같다', () => {
  async function run(cond: Cond, dryRun: boolean, reply: keyof typeof ORDER_REPLIES): Promise<OrderPathCapture> {
    enter(cond);
    return runOrderPath({
      submitOrder, createOrder,
      getPool: getPool as jest.Mock, getAccountId: getAccountId as jest.Mock,
      dryRun, reply: ORDER_REPLIES[reply],
    });
  }

  it.each(['accepted', 'rejected', 'http500', 'network'] as const)('실송신(DRY_RUN off) — KIS 응답 %s', async (reply) => {
    const a = await run('A-writable', false, reply);
    const b = await run('B-unwritable', false, reply);
    const c = await run('C-throwing', false, reply);
    expect(a.fetchCalls).toBe(1);   // 주문은 정확히 1번 송신(기록이 재시도를 만들지 않는다)
    expect(b).toEqual(a);
    expect(c).toEqual(a);
    // 결과의 의미도 고정 — 기록이 결과를 바꾸지 않았다는 비교의 기준점
    if (reply === 'accepted') expect(a.result).toMatchObject({ ok: true, exchangeOrderId: '0000123456' });
    else expect(a.result.ok).toBe(false);
  });

  it('DRY_RUN on — 세 조건 모두 KIS 를 부르지 않고 dry_run 으로 끝난다', async () => {
    const a = await run('A-writable', true, 'accepted');
    const b = await run('B-unwritable', true, 'accepted');
    const c = await run('C-throwing', true, 'accepted');
    expect(a.fetchCalls).toBe(0);
    expect(a.result).toMatchObject({ ok: true, dryRun: true, blockedBy: 'dry_run' });
    expect(b).toEqual(a);
    expect(c).toEqual(a);
  });

  it('KILL_SWITCH on — 세 조건 모두 차단되고 KIS 를 부르지 않는다', async () => {
    const out: OrderPathCapture[] = [];
    for (const c of CONDS) {
      enter(c);
      out.push(await runOrderPath({
        submitOrder, createOrder, getPool: getPool as jest.Mock, getAccountId: getAccountId as jest.Mock,
        dryRun: false, killSwitch: true, reply: ORDER_REPLIES.accepted,
      }));
    }
    expect(out[0].fetchCalls).toBe(0);
    expect(out[0].result).toMatchObject({ ok: false, blockedBy: 'kill_switch' });
    expect(out[1]).toEqual(out[0]);
    expect(out[2]).toEqual(out[0]);
  });
});

describe('앱 래퍼 — 본 호출의 값·예외·child 를 그대로 넘긴다(C 조건 포함)', () => {
  it.each(CONDS)('%s: trackCall 은 같은 값 객체를 돌려주고 같은 예외 객체를 다시 던진다', async (c) => {
    enter(c);
    const value = { status: 503, secret: 'x' };
    await expect(trackCall('m4', 'chat', async () => value)).resolves.toBe(value);
    const resp = new Response('{"ok":true}', { status: 201 });
    await expect(trackCall('m4', 'chat', async () => resp)).resolves.toBe(resp);
    const err = new Error('boom');
    await expect(trackCall('m4', 'chat', async () => { throw err; })).rejects.toBe(err);
    // opts 함수가 던져도 결과는 같다
    await expect(trackCall('m4', 'chat', async () => resp, {
      ok: () => { throw new Error('ok-fn'); }, err: () => { throw new Error('err-fn'); },
    })).resolves.toBe(resp);
    await expect(trackCall('m4', 'chat', async () => { throw err; }, {
      err: () => { throw new Error('err-fn'); },
    })).rejects.toBe(err);
  });

  it.each(CONDS)('%s: trackChild 는 같은 child 를 돌려주고 기존 리스너 동작을 바꾸지 않는다', (c) => {
    enter(c);
    const child = new EventEmitter() as EventEmitter & { pid?: number; killed?: boolean };
    const seen: unknown[] = [];
    child.on('close', (code: unknown) => seen.push(code));
    expect(trackChild('claude-cli', 'llm.call', child)).toBe(child);
    child.emit('close', 0, null);
    expect(seen).toEqual([0]);
  });

  it.each(CONDS)('%s: logUsage·usageErrKind·opOf 는 던지지 않는다', (c) => {
    enter(c);
    expect(() => logUsage({ api: 'kis', op: 'x', ok: true })).not.toThrow();
    expect(usageErrKind(new Error('x'))).toBe('other');   // A·B: 자동 분류, C: 분류 함수가 던져도 other
    expect(opOf('domestic getTicker')).toBe('domestic.get-ticker');
  });
});
