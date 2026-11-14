/**
 * T-169 A1 — system·numCtx 옵션. 실제 home-m4-api·claude CLI·DB 호출 없음(fetch·spawn·getPool 모의).
 *
 * 고정하는 것
 *  ① system·numCtx 가 없으면(다른 모든 호출부) home-m4-api 요청 본문이 T-169 이전과 **바이트 단위로 같다**.
 *  ② system 이 있으면 [{system},{user}], numCtx 가 있으면 options.num_ctx.
 *  ③ claude CLI 는 system 이 있을 때만 `${system}\n\n${prompt}` 로 합친다(없으면 인자 그대로).
 *  ④ runLlm·runLlmOnce 는 두 필드를 통과시키기만 한다 — 안 넘기면 caller 가 받는 옵션·요청이 이전과 같다.
 *  ⑤ 채팅 route 밖의 runLlm/runLlmOnce 호출부는 system·numCtx 를 넘기지 않는다(정적 확인).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { EventEmitter } from 'node:events';

const mockSpawn = jest.fn();
jest.mock('node:child_process', () => ({ spawn: (...a: unknown[]) => mockSpawn(...a) }));
jest.mock('@/lib/api-usage', () => ({
  trackCall: (_a: string, _b: string, fn: () => Promise<unknown>) => fn(),
  trackChild: () => undefined,
}));
const mockQuery = jest.fn();
jest.mock('@/lib/db', () => ({ getPool: () => ({ query: (...a: unknown[]) => mockQuery(...a) }) }));

import { HomeM4ApiCaller } from '../home-m4-api';
import { ClaudeCliCaller } from '../claude-cli';
import { runLlm, runLlmOnce } from '../provider';

/** T-169 이전 home-m4-api.ts 가 만들던 본문(그대로 옮겨 적은 리터럴) */
const legacyBody = (model: string, prompt: string, temperature: number) =>
  JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], options: { temperature } });

let originalFetch: typeof globalThis.fetch;
let bodies: string[];
const originalApiKey = process.env.AI_API_KEY;
afterAll(() => {
  if (originalApiKey === undefined) delete process.env.AI_API_KEY;
  else process.env.AI_API_KEY = originalApiKey;
});

beforeEach(() => {
  originalFetch = globalThis.fetch;
  bodies = [];
  globalThis.fetch = jest.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
    bodies.push(String(init?.body));
    return { ok: true, json: async () => ({ message: { content: '응답' } }) } as Response;
  });
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  mockQuery.mockReset();
  mockSpawn.mockReset();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  jest.restoreAllMocks();
});

describe('HomeM4ApiCaller — system·numCtx', () => {
  const caller = new HomeM4ApiCaller('http://m4.local:8000', 'k', 'qwen2.5:14b-instruct', 0.3);

  test('옵션 없음·다른 호출부 옵션 → 요청 본문이 이전과 바이트 단위로 같다', async () => {
    await caller.call('프롬프트 "따옴표"\n줄바꿈');
    await caller.call('p2', { timeoutMs: 30_000, responseFormat: 'json', model: 'sonnet', toolFree: true });
    await caller.call('p3', { stage: 1, domain: 'overseas' });
    expect(bodies).toEqual([
      legacyBody('qwen2.5:14b-instruct', '프롬프트 "따옴표"\n줄바꿈', 0.3),
      legacyBody('qwen2.5:14b-instruct', 'p2', 0.3),
      legacyBody('qwen2.5:14b-instruct', 'p3', 0.3),
    ]);
  });

  test('빈 system·비정상 numCtx 는 "없음"과 같다', async () => {
    await caller.call('p', { system: '' });
    await caller.call('p', { numCtx: 0 });
    await caller.call('p', { numCtx: 1.5 });
    await caller.call('p', { numCtx: Number.NaN });
    expect(new Set(bodies)).toEqual(new Set([legacyBody('qwen2.5:14b-instruct', 'p', 0.3)]));
  });

  test('system 이 있으면 system 메시지가 먼저, user 는 프롬프트 그대로', async () => {
    await caller.call('질문 본문', { system: '대화형 지시' });
    const body = JSON.parse(bodies[0]);
    expect(body.messages).toEqual([
      { role: 'system', content: '대화형 지시' },
      { role: 'user', content: '질문 본문' },
    ]);
    expect(body.options).toEqual({ temperature: 0.3 });
  });

  test('numCtx 가 있으면 options.num_ctx — system 과 함께', async () => {
    await caller.call('q', { numCtx: 8192 });
    await caller.call('q', { system: 'S', numCtx: 8192 });
    expect(JSON.parse(bodies[0])).toEqual({
      model: 'qwen2.5:14b-instruct', messages: [{ role: 'user', content: 'q' }], options: { temperature: 0.3, num_ctx: 8192 },
    });
    expect(JSON.parse(bodies[1])).toEqual({
      model: 'qwen2.5:14b-instruct',
      messages: [{ role: 'system', content: 'S' }, { role: 'user', content: 'q' }],
      options: { temperature: 0.3, num_ctx: 8192 },
    });
  });
});

describe('ClaudeCliCaller — system 결합', () => {
  function fakeProc(stdout: string) {
    const proc = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter };
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    setImmediate(() => {
      proc.stdout.emit('data', Buffer.from(stdout));
      proc.emit('close', 0);
    });
    return proc;
  }

  test('system 없음 → --print 인자는 프롬프트 그대로 / system 있음 → system\\n\\nprompt', async () => {
    mockSpawn.mockImplementation(() => fakeProc('ok'));
    const c = new ClaudeCliCaller();
    await c.call('P', { model: 'haiku' });
    await c.call('P', { model: 'haiku', system: 'S', numCtx: 8192 });
    const args0 = mockSpawn.mock.calls[0][1] as string[];
    const args1 = mockSpawn.mock.calls[1][1] as string[];
    expect(args0[args0.indexOf('--print') + 1]).toBe('P');
    expect(args1[args1.indexOf('--print') + 1]).toBe('S\n\nP');
    // numCtx 는 claude 인자에 나타나지 않는다 — system 결합 말고는 인자 모양이 같다
    expect(args1.filter((_, i) => i !== args1.indexOf('--print') + 1)).toEqual(args0.filter((_, i) => i !== args0.indexOf('--print') + 1));
  });
});

describe('runLlm·runLlmOnce 통과', () => {
  /** system_config 모의 — hybrid + stage1 모델 */
  function configRows(map: Record<string, string>) {
    mockQuery.mockImplementation(async (_sql: string, params: unknown[]) => {
      const key = String(params?.[0]);
      return [key in map ? [{ value: map[key] }] : [], []];
    });
  }

  test('hybrid stage1 — system·numCtx 를 안 넘기면 본문이 이전과 같고, 넘기면 실린다', async () => {
    configRows({ llm_provider: 'hybrid', stage1_model: 'qwen2.5:14b-instruct', home_m4_api_base: 'http://m4.local:8000', home_m4_api_temperature: '0.3' });
    process.env.AI_API_KEY = 'test-key';
    await runLlm('엔진 프롬프트', { timeoutMs: 30_000, responseFormat: 'json', stage: 1, domain: 'overseas' });
    await runLlmOnce('stage1 프롬프트', { stage: 1, timeoutMs: 30_000, responseFormat: 'json' });
    await runLlm('채팅 질문', { system: '지시', numCtx: 8192, responseFormat: 'text' });
    await runLlmOnce('채팅 질문2', { system: '지시2', numCtx: 4096 });
    expect(bodies[0]).toBe(legacyBody('qwen2.5:14b-instruct', '엔진 프롬프트', 0.3));
    expect(bodies[1]).toBe(legacyBody('qwen2.5:14b-instruct', 'stage1 프롬프트', 0.3));
    expect(JSON.parse(bodies[2]).messages[0]).toEqual({ role: 'system', content: '지시' });
    expect(JSON.parse(bodies[2]).options).toEqual({ temperature: 0.3, num_ctx: 8192 });
    expect(JSON.parse(bodies[3]).messages[0]).toEqual({ role: 'system', content: '지시2' });
    expect(JSON.parse(bodies[3]).options).toEqual({ temperature: 0.3, num_ctx: 4096 });
  });

  test('caller 가 받는 옵션 객체 — 필드를 안 넘기면 system·numCtx 키 자체가 없다', async () => {
    configRows({ llm_provider: 'home-m4-api' });
    process.env.AI_API_KEY = 'test-key';
    const spy = jest.spyOn(HomeM4ApiCaller.prototype, 'call');
    await runLlm('p', { timeoutMs: 1000, responseFormat: 'json', toolFree: true });
    await runLlmOnce('p', { timeoutMs: 1000, responseFormat: 'json', toolFree: true });
    expect(spy.mock.calls[0][1]).toEqual({ timeoutMs: 1000, responseFormat: 'json', model: undefined, toolFree: true });
    expect(Object.keys(spy.mock.calls[0][1] ?? {}).sort()).toEqual(['model', 'responseFormat', 'timeoutMs', 'toolFree']);
    expect(Object.keys(spy.mock.calls[1][1] ?? {}).sort()).toEqual(['model', 'responseFormat', 'timeoutMs', 'toolFree']);
  });
});

describe('정적 확인 — 채팅 route 밖의 호출부는 system·numCtx 를 넘기지 않는다', () => {
  const SRC = join(__dirname, '..', '..', '..');
  const CHAT_ROUTES = new Set([
    join('app', 'api', 'chat', 'threads', '[id]', 'draft', 'route.ts'),
    join('app', 'api', 'chat', 'threads', '[id]', 'messages', 'route.ts'),
  ]);
  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name.startsWith('.') || name === '__tests__') continue;
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p, out);
      else if (/\.(ts|tsx)$/.test(name)) out.push(p);
    }
    return out;
  }

  test('runLlm( / runLlmOnce( 호출의 옵션에 system·numCtx 가 없다', () => {
    const calls: string[] = [];
    for (const f of walk(SRC)) {
      const rel = relative(SRC, f);
      // provider 자신·채팅 route 2곳·채팅 전용 모듈(src/lib/chat — 설명 주석에 사용 예가 있다)은 대상이 아니다
      if (rel === join('lib', 'llm', 'provider.ts') || CHAT_ROUTES.has(rel) || rel.startsWith(join('lib', 'chat') + '/')) continue;
      // 주석은 호출이 아니다 — 블록·줄 주석을 떼고 본다
      const src = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      for (const m of src.matchAll(/\brunLlm(?:Once)?\(/g)) {
        const rest = src.slice(m.index ?? 0);
        const end = rest.indexOf('})');
        const call = end >= 0 ? rest.slice(0, end + 2) : rest.slice(0, 400);
        calls.push(rel);
        expect({ rel, hasSystem: /\bsystem\s*[:,}]/.test(call), hasNumCtx: /\bnumCtx\b/.test(call) })
          .toEqual({ rel, hasSystem: false, hasNumCtx: false });
      }
    }
    expect(calls.length).toBeGreaterThanOrEqual(8);   // 빈 스캔 방지(2026-11-14 기준 9곳)
  });
});
