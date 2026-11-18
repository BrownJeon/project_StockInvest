/**
 * T-042 — `instrumentation.ts` 의 **빌드타임 분기 형태**를 고정한다.
 *
 * 이 프로젝트에는 Edge 미들웨어가 있어 Next 가 instrumentation 을 Node·Edge 양쪽 번들로 컴파일한다.
 * `if (process.env.NEXT_RUNTIME === 'nodejs') { …import()… }` (양수 조건 블록)만 Edge 컴파일에서 블록째 제거된다.
 * 조기 `return` 형태는 `import()` 가 모듈 그래프에 남아 `mysql2`·`crypto`·`node:fs` 때문에 **빌드가 통째로 깨진다**
 * (T-037 재순환에서 실제로 발생). 텔레그램 폴러가 같은 파일에 추가되므로 형태를 소스 텍스트로 못박는다.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(__dirname, '..', 'instrumentation.ts'), 'utf8')
  // 주석 안의 예시 코드가 검사를 속이지 않도록 주석을 지운다
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

/** `needle` 이 처음 나오는 `{` 부터 짝이 맞는 `}` 까지의 본문 */
function blockAfter(text: string, needle: string): string {
  const at = text.indexOf(needle);
  if (at < 0) return '';
  const open = text.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth === 0) return text.slice(open + 1, i);
  }
  return '';
}

describe('instrumentation.ts — 빌드타임 분기', () => {
  const guarded = blockAfter(src, "if (process.env.NEXT_RUNTIME === 'nodejs')");

  test('🔴 양수 조건 블록이 있다', () => {
    expect(guarded.length).toBeGreaterThan(0);
  });

  test('🔴 조기 return 형태(`!== \'nodejs\'`)를 쓰지 않는다', () => {
    expect(src).not.toMatch(/NEXT_RUNTIME\s*!==\s*['"]nodejs['"]/);
    expect(src).not.toMatch(/NEXT_RUNTIME\s*!=\s*['"]nodejs['"]/);
  });

  test.each(['@/lib/ops/cron-watchdog', '@/lib/signals/telegram-poller'])('🔴 %s 는 블록 안에서만 동적 import 된다', (mod) => {
    expect(guarded).toContain(`import('${mod}')`);
    expect(src.split(`import('${mod}')`).length - 1).toBe(1);        // 블록 밖에 중복 import 없음
  });

  test('모듈 최상단에서 Node 전용 모듈을 정적 import 하지 않는다', () => {
    expect(src).not.toMatch(/^import\s/m);
  });

  test('🔴 각 기동은 서로 독립된 try/catch 로 감싸져 있다 — 하나가 실패해도 다른 하나·서버 기동은 계속', () => {
    const tries = guarded.match(/\btry\s*\{/g) ?? [];
    const catches = guarded.match(/\bcatch\s*\(/g) ?? [];
    expect(tries.length).toBeGreaterThanOrEqual(3);   // T-175 연결 시도 시간 설정 + 워치독 + 폴러
    expect(catches.length).toBe(tries.length);
  });
});

/**
 * T-175 WP-1 — 외부 접속의 주소당 연결 시도 시간(Happy Eyeballs)을 웹 프로세스 시작 때 2000ms 로 올린다.
 * 기본 250ms 는 IPv6 경로가 없는 이 서버에서 IPv4 연결을 0.25초에 끊어 `fetch failed`(ETIMEDOUT + ENETUNREACH)를 만들었다.
 */
describe('instrumentation.ts — T-175 연결 시도 시간', () => {
  const guarded = blockAfter(src, "if (process.env.NEXT_RUNTIME === 'nodejs')");

  test('🔴 node:net 은 nodejs 블록 안에서만 동적 import 되고, 설정 호출도 블록 안에 한 번뿐이다', () => {
    expect(guarded).toContain("import('node:net')");
    expect(src.split("import('node:net')").length - 1).toBe(1);
    expect(guarded).toMatch(/setDefaultAutoSelectFamilyAttemptTimeout\(OUTBOUND_CONNECT_ATTEMPT_TIMEOUT_MS\)/);
    expect(src.split('setDefaultAutoSelectFamilyAttemptTimeout(').length - 1).toBe(1);
  });

  test('🔴 값은 2000ms 상수 하나다(NODE_OPTIONS 와 이중 정본 금지)', () => {
    expect(src).toMatch(/const OUTBOUND_CONNECT_ATTEMPT_TIMEOUT_MS = 2000;/);
    const eco = readFileSync(join(__dirname, '..', '..', 'ecosystem.config.js'), 'utf8');
    const nodeOptions = eco.match(/NODE_OPTIONS:\s*'([^']*)'/g) ?? [];
    expect(nodeOptions.length).toBeGreaterThan(0);
    for (const v of nodeOptions) expect(v).not.toMatch(/network-family-autoselection/);
  });

  test('🔴 설정은 워치독·폴러 기동보다 먼저다 — 그 둘의 첫 fetch 도 새 값으로 연결한다', () => {
    const at = guarded.indexOf('setDefaultAutoSelectFamilyAttemptTimeout(');
    expect(at).toBeGreaterThanOrEqual(0);
    expect(at).toBeLessThan(guarded.indexOf("import('@/lib/ops/cron-watchdog')"));
    expect(at).toBeLessThan(guarded.indexOf("import('@/lib/signals/telegram-poller')"));
  });
});

describe('instrumentation.ts — T-175 register() 실제 실행', () => {
  const ORIGINAL_RUNTIME = process.env.NEXT_RUNTIME;
  let net: typeof import('node:net');
  let before: number;

  beforeAll(async () => {
    net = await import('node:net');
    before = net.getDefaultAutoSelectFamilyAttemptTimeout();
  });
  afterEach(() => {
    // 이 워커 프로세스의 다른 시험에 새지 않게 되돌린다
    net.setDefaultAutoSelectFamilyAttemptTimeout(before);
    if (ORIGINAL_RUNTIME === undefined) delete process.env.NEXT_RUNTIME; else process.env.NEXT_RUNTIME = ORIGINAL_RUNTIME;
    jest.resetModules();
    jest.dontMock('@/lib/ops/cron-watchdog');
    jest.dontMock('@/lib/signals/telegram-poller');
  });

  function mockStarters(opts: { watchdogThrows?: boolean } = {}) {
    const order: string[] = [];
    jest.doMock('@/lib/ops/cron-watchdog', () => ({
      startCronWatchdog: () => {
        order.push(`watchdog@${net.getDefaultAutoSelectFamilyAttemptTimeout()}`);
        if (opts.watchdogThrows) throw new Error('boom');
      },
    }));
    jest.doMock('@/lib/signals/telegram-poller', () => ({
      startTelegramApprovalPoller: () => { order.push(`poller@${net.getDefaultAutoSelectFamilyAttemptTimeout()}`); },
    }));
    return order;
  }

  test('🔴 nodejs 런타임: 전역 연결 시도 시간이 2000 이 되고, 워치독·폴러는 그 뒤에 뜬다', async () => {
    expect(before).toBe(250);   // Node 기본값 — 바뀌면 이 시험의 전제를 다시 볼 것
    process.env.NEXT_RUNTIME = 'nodejs';
    const order = mockStarters();
    const { register } = await import('@/instrumentation');
    await register();
    expect(net.getDefaultAutoSelectFamilyAttemptTimeout()).toBe(2000);
    expect(order).toEqual(['watchdog@2000', 'poller@2000']);
  });

  test('edge 런타임(또는 미지정)이면 건드리지 않는다', async () => {
    process.env.NEXT_RUNTIME = 'edge';
    const order = mockStarters();
    const { register } = await import('@/instrumentation');
    await register();
    expect(net.getDefaultAutoSelectFamilyAttemptTimeout()).toBe(before);
    expect(order).toEqual([]);
  });

  test('워치독 기동이 던져도 설정은 남고 폴러는 뜬다', async () => {
    process.env.NEXT_RUNTIME = 'nodejs';
    const order = mockStarters({ watchdogThrows: true });
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const { register } = await import('@/instrumentation');
    await expect(register()).resolves.toBeUndefined();
    expect(net.getDefaultAutoSelectFamilyAttemptTimeout()).toBe(2000);
    expect(order).toEqual(['watchdog@2000', 'poller@2000']);
    (console.error as jest.Mock).mockRestore();
  });
});
