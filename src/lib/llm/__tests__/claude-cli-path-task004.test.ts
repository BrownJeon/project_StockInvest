/**
 * task-004 S-C1 — Claude CLI 실행 파일 결정(CLAUDE_CLI_PATH).
 *
 * spawn 을 대역으로 바꿔 **실행 파일과 argv 만** 본다(실제 CLI·shim·모델 호출 없음).
 *  - env 미설정·공백 → 기존 'claude'(PATH), argv 는 이전과 같다
 *  - env 설정 → 두 호출부(ClaudeCliCaller·ai-filter) 모두 그 경로, argv 는 env 미설정 때와 바이트 단위로 같다
 */
import { EventEmitter } from 'node:events';

const mockSpawnCalls: Array<{ file: unknown; args: unknown; opts: unknown }> = [];
const mockPlan: { code: number | null; stdout: string; errorCode?: string } = { code: 0, stdout: 'ok' };
jest.mock('node:child_process', () => ({
  spawn: (file: unknown, args: unknown, opts: unknown) => {
    mockSpawnCalls.push({ file, args, opts });
    const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; killed: boolean; pid: number };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.killed = false;
    child.pid = 4242;
    setImmediate(() => {
      if (mockPlan.errorCode) {
        child.emit('error', Object.assign(new Error('spawn failed'), { code: mockPlan.errorCode }));
        return;
      }
      if (mockPlan.stdout) child.stdout.emit('data', Buffer.from(mockPlan.stdout));
      child.emit('close', mockPlan.code, null);
    });
    return child;
  },
}));
jest.mock('@/lib/api-usage', () => ({ trackChild: jest.fn() }));
jest.mock('@/lib/credentials', () => ({ getCredential: jest.fn(async () => '') }));
jest.mock('@/lib/db', () => ({
  getPool: jest.fn(() => ({ query: jest.fn(async () => [[]]) })),
  getAccountId: jest.fn(async () => 1),
}));

import { ClaudeCliCaller } from '@/lib/llm/claude-cli';
import { aiSelectSignal } from '@/lib/strategy/ai-filter';

const SHIM = '/opt/cliclaude/current/shim.py';
const ORIGINAL = process.env.CLAUDE_CLI_PATH;

function setPath(v: string | undefined) {
  if (v === undefined) delete process.env.CLAUDE_CLI_PATH;
  else process.env.CLAUDE_CLI_PATH = v;
}

beforeEach(() => {
  mockSpawnCalls.length = 0;
  Object.assign(mockPlan, { code: 0, stdout: 'ok', errorCode: undefined });
});
afterAll(() => setPath(ORIGINAL));

async function callerArgv(env: string | undefined, toolFree = false) {
  setPath(env);
  mockSpawnCalls.length = 0;
  await new ClaudeCliCaller().call('합성 프롬프트', { model: 'opus', ...(toolFree ? { toolFree: true } : {}) });
  expect(mockSpawnCalls).toHaveLength(1);
  return mockSpawnCalls[0];
}

async function aiFilterArgv(env: string | undefined) {
  setPath(env);
  mockSpawnCalls.length = 0;
  Object.assign(mockPlan, { code: 1, stdout: '' }); // 결과 해석은 보지 않는다 — 실패 경로라도 spawn 1회는 일어난다
  const candles = Array.from({ length: 60 }, (_, i) => ({ ts: i, open: 100, high: 101, low: 99, close: 100 + (i % 3), volume: 1000 }));
  await aiSelectSignal('005930', [], candles, { symbol: '005930', price: 100, timestamp: 0 });
  expect(mockSpawnCalls.length).toBeGreaterThan(0);
  return mockSpawnCalls[0];
}

describe('ClaudeCliCaller — 실행 파일 결정', () => {
  it('env 미설정 → claude, 기존 argv 그대로', async () => {
    const c = await callerArgv(undefined);
    expect(c.file).toBe('claude');
    expect(c.args).toEqual(['--print', '합성 프롬프트', '--permission-mode', 'bypassPermissions', '--model', 'opus']);
    expect(c.opts).toMatchObject({ cwd: '/tmp', stdio: ['ignore', 'pipe', 'pipe'] });
  });

  it('env 가 빈 문자열·공백 → claude', async () => {
    expect((await callerArgv('')).file).toBe('claude');
    expect((await callerArgv('   ')).file).toBe('claude');
  });

  it('env 설정 → shim 경로, argv·옵션은 env 미설정과 같다(기본·toolFree)', async () => {
    for (const toolFree of [false, true]) {
      const base = await callerArgv(undefined, toolFree);
      const shim = await callerArgv(SHIM, toolFree);
      expect(shim.file).toBe(SHIM);
      expect(shim.args).toEqual(base.args);
      expect(JSON.stringify(shim.args)).toBe(JSON.stringify(base.args));
      expect((shim.opts as { cwd: string }).cwd).toBe((base.opts as { cwd: string }).cwd);
    }
  });

  it('env 설정 시 경로 앞뒤 공백은 지운다', async () => {
    expect((await callerArgv(`  ${SHIM}\n`)).file).toBe(SHIM);
  });

  it('ENOENT 문구는 경로와 무관하게 기존 그대로', async () => {
    setPath(SHIM);
    Object.assign(mockPlan, { errorCode: 'ENOENT' });
    await expect(new ClaudeCliCaller().call('p')).rejects.toThrow('claude CLI not found in PATH');
  });

  it('CLAUDECODE·ANTHROPIC_API_KEY 제거는 env 설정 시에도 유지', async () => {
    process.env.CLAUDECODE = '1';
    process.env.ANTHROPIC_API_KEY = 'synthetic-not-a-key';
    try {
      const c = await callerArgv(SHIM);
      const env = (c.opts as { env: NodeJS.ProcessEnv }).env;
      expect(env.CLAUDECODE).toBeUndefined();
      expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    } finally {
      delete process.env.CLAUDECODE;
      delete process.env.ANTHROPIC_API_KEY;
    }
  });
});

describe('ai-filter(runClaudeOnce) — 실행 파일 결정', () => {
  it('env 미설정 → claude, 기존 argv 그대로', async () => {
    const c = await aiFilterArgv(undefined);
    expect(c.file).toBe('claude');
    const args = c.args as string[];
    expect(args[0]).toBe('--print');
    expect(args.slice(2)).toEqual(['--permission-mode', 'bypassPermissions', '--model', 'sonnet']);
  });

  it('env 설정 → shim 경로, argv 는 env 미설정과 같다', async () => {
    const base = await aiFilterArgv(undefined);
    const shim = await aiFilterArgv(SHIM);
    expect(shim.file).toBe(SHIM);
    expect(JSON.stringify(shim.args)).toBe(JSON.stringify(base.args));
  });
});
