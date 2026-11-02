/**
 * T-040 — KIS 밖 외부 호출 지점의 기록(`@/lib/api-usage` 경유).
 *
 * 각 지점에서 **줄의 api·op·ok·status·err** 가 규칙대로 나오고, 토큰·URL·본문·종목·오류 원문이
 * 줄에 섞이지 않는지 본다. 반환값·예외 동작 자체는 각 모듈의 기존 시험이 고정한다(이 파일은 기록만).
 * 외부 HTTP 는 부르지 않는다 — 전역 fetch(또는 주입 fetchImpl)를 대역으로 바꾼다.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { EventEmitter } from 'node:events';

/** claude CLI 대역 — 실제 프로세스를 띄우지 않는다. 시험마다 `mockSpawnPlan` 으로 결과를 정한다. */
const mockSpawnPlan: { stdout: string; code: number | null; killed: boolean } = { stdout: '', code: 0, killed: false };
const mockSpawnCalls: unknown[][] = [];
jest.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => {
    mockSpawnCalls.push(args);
    const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; killed: boolean; pid: number };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.killed = false;
    child.pid = 4242;
    setImmediate(() => {
      if (mockSpawnPlan.stdout) child.stdout.emit('data', Buffer.from(mockSpawnPlan.stdout));
      child.killed = mockSpawnPlan.killed;
      child.emit('close', mockSpawnPlan.code, mockSpawnPlan.killed ? 'SIGTERM' : null);
    });
    return child;
  },
}));

jest.mock('@/lib/credentials', () => ({
  getCredential: jest.fn(async (key: string) => {
    if (key === 'TELEGRAM_BOT_TOKEN') return '123456:SECRET-BOT-TOKEN';
    if (key === 'TELEGRAM_CHAT_ID') return '987654321';
    if (key === 'SLACK_WEBHOOK_URL') return 'https://hooks.slack.example/services/SECRET/HOOK';
    return '';
  }),
}));
jest.mock('@/lib/db', () => ({
  getPool: jest.fn(() => ({ query: jest.fn(async () => [[]]) })),
  getAccountId: jest.fn(async () => 1),
}));

import { _internal, checkOp } from '@workspace/api-usage';
import { getTelegramUpdates, sendTelegramMessage } from '@/lib/notify/telegram-api';
import { sendTelegramAlert } from '@/lib/notify/telegram';
import { sendSlackAlert } from '@/lib/notify/slack';
import { M4KbClient } from '@/lib/rag/m4-kb';
import { HomeM4ApiCaller } from '@/lib/llm/home-m4-api';
import { verifyKisCredentials } from '@/lib/auth/kis-verify';
import { fetchYahooDailyHistory } from '@/lib/research/data/yahoo-finance-source';
import { getUsdKrwRate, clearFxCache } from '@/lib/exchanges/fx';
import { fetchOAuthProfile } from '@/lib/auth/oauth/providers';
import { ClaudeCliCaller } from '@/lib/llm/claude-cli';
import { aiSelectSignal } from '@/lib/strategy/ai-filter';

const ORIGINAL_DIR = process.env.API_USAGE_LOG_DIR;
const originalFetch = global.fetch;
let tmpRoot: string;
let logDir: string;

function lines(): Array<Record<string, unknown>> {
  const f = path.join(logDir, `api-usage-${new Date().toISOString().slice(0, 10)}.jsonl`);
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean)
    .map((l) => {
      const o = JSON.parse(l) as Record<string, unknown>;
      delete o.ts;   // 시각·소요 시간은 실행마다 다르므로 비교에서 뺀다
      delete o.ms;
      return o;
    });
}
function raw(): string {
  const f = path.join(logDir, `api-usage-${new Date().toISOString().slice(0, 10)}.jsonl`);
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
}
function setFetch(impl: (url: string, init?: RequestInit) => Promise<Response>) {
  (global as unknown as { fetch: unknown }).fetch = jest.fn(impl);
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeAll(() => { tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 't040-sites-')); });
afterAll(() => {
  if (ORIGINAL_DIR === undefined) delete process.env.API_USAGE_LOG_DIR;
  else process.env.API_USAGE_LOG_DIR = ORIGINAL_DIR;
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});
beforeEach(() => {
  _internal.reset();
  logDir = fs.mkdtempSync(path.join(tmpRoot, 'logs-'));
  process.env.API_USAGE_LOG_DIR = logDir;
  for (const m of ['log', 'warn', 'error'] as const) jest.spyOn(console, m).mockImplementation(() => {});
  jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
});
afterEach(() => {
  (global as unknown as { fetch: unknown }).fetch = originalFetch;
  jest.restoreAllMocks();
});

describe('telegram — Bot API(telegram-api.ts)', () => {
  it('성공·HTTP 실패·본문 ok:false(→ other, status 200) 를 구분하고 시도마다 한 줄', async () => {
    setFetch(async () => json(200, { ok: true, result: [] }));
    await getTelegramUpdates(0, 1);
    setFetch(async () => json(409, { ok: false, description: 'Conflict: terminated by other getUpdates' }));
    await getTelegramUpdates(0, 1);
    setFetch(async () => json(200, { ok: false, description: 'Bad Request: chat not found' }));
    await sendTelegramMessage('<b>005930</b> 매수 승인?');
    expect(lines()).toEqual([
      { api: 'telegram', op: 'bot.get-updates', ok: true, status: 200 },
      { api: 'telegram', op: 'bot.get-updates', ok: false, status: 409, err: 'http' },
      { api: 'telegram', op: 'bot.send-message', ok: false, status: 200, err: 'other' },
    ]);
  });

  it('일시적 네트워크 오류 재시도는 시도마다 한 줄(network), 반환값은 기존과 같다', async () => {
    let n = 0;
    setFetch(async () => {
      n += 1;
      if (n === 1) throw new TypeError('fetch failed', { cause: Object.assign(new Error('x'), { code: 'ECONNRESET' }) });
      return json(200, { ok: true, result: { message_id: 7, chat: { id: 1 } } });
    });
    const r = await sendTelegramMessage('hello');
    expect(r).toEqual({ ok: true, result: { message_id: 7, chat: { id: 1 } } });
    expect(lines()).toEqual([
      { api: 'telegram', op: 'bot.send-message', ok: false, status: 0, err: 'network' },
      { api: 'telegram', op: 'bot.send-message', ok: true, status: 200 },
    ]);
  });

  it('알림 발송(telegram.ts)·슬랙 웹훅(slack.ts)', async () => {
    setFetch(async () => json(200, { ok: true }));
    await sendTelegramAlert('info', '제목', '본문 005930');
    setFetch(async () => new Response('invalid_payload', { status: 400 }));
    await sendSlackAlert('warning', '제목', '본문');
    expect(lines()).toEqual([
      { api: 'telegram', op: 'alert.send-message', ok: true, status: 200 },
      { api: 'slack', op: 'webhook.send', ok: false, status: 400, err: 'http' },
    ]);
  });
});

describe('m4 — KB·chat', () => {
  it('ensureCollection 409(이미 존재)는 성공으로 센다, search 500 은 http 실패', async () => {
    const kb = new M4KbClient('http://m4.example:8000', 'SECRET-KEY', 'SECRET-ADMIN');
    setFetch(async () => json(409, { detail: 'exists' }));
    await kb.ensureCollection('signals_005930');
    setFetch(async () => json(500, { detail: 'boom' }));
    await expect(kb.search('signals', '삼성전자 005930')).rejects.toThrow(/KB search HTTP 500/);
    expect(lines()).toEqual([
      { api: 'm4', op: 'kb.ensure-collection', ok: true, status: 409 },
      { api: 'm4', op: 'kb.search', ok: false, status: 500, err: 'http' },
    ]);
  });

  it('chat 자체 타이머 시간초과는 timeout(기존 예외 메시지 그대로)', async () => {
    const m4 = new HomeM4ApiCaller('http://m4.example:8000', 'SECRET-KEY', 'qwen', 0.2);
    setFetch((_u, init) => new Promise<Response>((_r, rej) => {
      // undici 가 내는 AbortError 와 같은 모양(이름으로 판정하는 기존 분기를 그대로 탄다)
      init?.signal?.addEventListener('abort', () => rej(Object.assign(new Error('This operation was aborted'), { name: 'AbortError' })));
    }));
    await expect(m4.call('프롬프트 005930', { timeoutMs: 20 })).rejects.toThrow('home-m4-api timeout after 20ms');
    expect(lines()).toEqual([{ api: 'm4', op: 'chat', ok: false, status: 0, err: 'timeout' }]);
  });
});

describe('kis 검증·yahoo·fx·oauth', () => {
  it('kis-verify(주입 fetchImpl) — 403 은 http 실패, 결과 메시지는 기존 고정 문구', async () => {
    const r = await verifyKisCredentials(
      { appKey: 'SECRET-APPKEY-123456', appSecret: 'SECRET-APPSECRET-123456', mock: true },
      (async () => json(403, { error_code: 'EGW00103' })) as typeof fetch,
    );
    expect(r.ok).toBe(false);
    expect(lines()).toEqual([{ api: 'kis', op: 'verify.token-p', ok: false, status: 403, err: 'http' }]);
  });

  it('yahoo(주입 fetchImpl) — 호스트별 시도 1번 = 한 줄', async () => {
    let n = 0;
    await expect(fetchYahooDailyHistory('AAPL', {
      fetchImpl: (async () => { n += 1; return json(429, {}); }) as typeof fetch,
    })).rejects.toThrow(/yahoo fetch failed/);
    expect(n).toBe(2);
    expect(lines()).toEqual([
      { api: 'yahoo-finance', op: 'chart.daily', ok: false, status: 429, err: 'http' },
      { api: 'yahoo-finance', op: 'chart.daily', ok: false, status: 429, err: 'http' },
    ]);
  });

  it('fx — 소스별 op 상수, 실패 후 다음 소스 성공', async () => {
    clearFxCache();
    let n = 0;
    setFetch(async () => { n += 1; return n === 1 ? json(503, {}) : json(200, { rates: { KRW: 1391.5 } }); });
    await expect(getUsdKrwRate(true)).resolves.toBe(1391.5);
    expect(lines()).toEqual([
      { api: 'fx', op: 'latest.frankfurter', ok: false, status: 503, err: 'http' },
      { api: 'fx', op: 'latest.open-er-api', ok: true, status: 200 },
    ]);
  });

  it('oauth(google) — 토큰 교환·프로필 각각 한 줄, 실패는 예외 그대로', async () => {
    setFetch(async (url) => (String(url).includes('token')
      ? json(200, { access_token: 'SECRET-ACCESS', token_type: 'Bearer' })
      : json(200, { id: 'g-1', email: 'someone@example.com', name: 'Kim', verified_email: true })));
    const p = await fetchOAuthProfile({
      provider: 'google', code: 'SECRET-CODE', clientId: 'cid', clientSecret: 'SECRET-CS', redirectUri: 'https://app.example/cb',
    });
    expect(p.email).toBe('someone@example.com');
    setFetch(async () => json(200, { error: 'invalid_grant' }));
    await expect(fetchOAuthProfile({
      provider: 'github', code: 'SECRET-CODE', clientId: 'cid', clientSecret: 'SECRET-CS', redirectUri: 'https://app.example/cb',
    })).rejects.toThrow(/invalid_grant/);
    expect(lines()).toEqual([
      { api: 'google-oauth', op: 'token.exchange', ok: true, status: 0 },
      { api: 'google-oauth', op: 'profile.get', ok: true, status: 0 },
      { api: 'github-oauth', op: 'token.exchange', ok: false, status: 0, err: 'other' },
    ]);
  });
});

describe('claude-cli — 자식 프로세스(spawn 대역)', () => {
  it('ClaudeCliCaller.call: 종료 코드 0 → 한 줄 ok, 결과 문자열 그대로', async () => {
    Object.assign(mockSpawnPlan, { stdout: '응답 005930', code: 0, killed: false });
    await expect(new ClaudeCliCaller().call('프롬프트 005930')).resolves.toBe('응답 005930');
    expect(lines()).toEqual([{ api: 'claude-cli', op: 'llm.call', ok: true, status: 0 }]);
  });

  it('ClaudeCliCaller.call: spawn timeout 으로 죽음(killed) → timeout, 기존 동작(종료 코드 null 은 resolve)은 그대로', async () => {
    Object.assign(mockSpawnPlan, { stdout: '', code: null, killed: true });
    await expect(new ClaudeCliCaller().call('p')).resolves.toBe('');
    expect(lines()).toEqual([{ api: 'claude-cli', op: 'llm.call', ok: false, status: 0, err: 'timeout' }]);
  });

  it('ai-filter(aiSelectSignal → runClaudeOnce): 종료 코드 1 → exit 실패 한 줄, 결과는 기존 ai_failed', async () => {
    Object.assign(mockSpawnPlan, { stdout: '', code: 1, killed: false });
    const candles = Array.from({ length: 60 }, (_, i) => ({ ts: i, open: 100, high: 101, low: 99, close: 100 + (i % 3), volume: 1000 }));
    const r = await aiSelectSignal('005930', [], candles, { symbol: '005930', price: 100, timestamp: 0 });
    expect(r.skipCategory).toBe('ai_failed');
    expect(mockSpawnCalls.length).toBeGreaterThan(0);
    expect(lines()).toEqual([{ api: 'claude-cli', op: 'ai-filter.select', ok: false, status: 1, err: 'exit' }]);
  });
});

describe('src 의 기록 지점 고정 — op 리터럴·배선이 바뀌면 깨진다(Reviewer M-2)', () => {
  /**
   * src(시험 제외)에서 기록 호출의 api·op 를 모은다. 리터럴이 아니면 `<var>` 로 남겨 배선 자체가 사라지는 것도 잡는다.
   *  - trackCall('<api>', '<op>' / trackChild('<api>', '<op>'
   *  - fetchWithRetry('<api>', '<op>'   (credentials/test — 안에서 trackCall(api, op) 로 넘김)
   *  - downloadMst(<url>, '<op>')        (kis-master — 안에서 trackCall('kis-master', op))
   *  - fx 소스 표의 op: '<op>' · telegram-api 의 BOT_OP 값 · logUsage({ api: '<api>', op: <expr> })
   */
  function collectSites(): string[] {
    const root = path.resolve(__dirname, '..', '..');   // src/
    const out: string[] = [];
    const lit = (s: string | undefined) => (s && s.startsWith("'") ? s.slice(1, -1) : '<var>');
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) { if (e.name !== '__tests__') walk(p); continue; }
        if (!/\.tsx?$/.test(e.name) || p.endsWith(path.join('lib', 'api-usage.ts'))) continue;
        const rel = path.relative(root, p);
        const src = fs.readFileSync(p, 'utf8');
        const tok = String.raw`('[^']*'|[A-Za-z_][\w.\[\]]*)`;
        for (const m of src.matchAll(new RegExp(String.raw`\b(trackCall|trackChild)\(\s*` + tok + String.raw`\s*,\s*` + tok, 'g'))) {
          out.push(`${rel} ${m[1]} ${lit(m[2])} ${lit(m[3])}`);
        }
        for (const m of src.matchAll(/\bfetchWithRetry\(\s*'([^']+)'\s*,\s*'([^']+)'/g)) out.push(`${rel} fetchWithRetry ${m[1]} ${m[2]}`);
        for (const m of src.matchAll(/\bdownloadMst\([^,()]+,\s*'([^']+)'/g)) out.push(`${rel} downloadMst - ${m[1]}`);
        if (rel.endsWith('fx.ts')) for (const m of src.matchAll(/^\s*op:\s*'([^']+)'/gm)) out.push(`${rel} source - ${m[1]}`);
        if (src.includes('BOT_OP')) for (const m of src.matchAll(/^\s*\w+:\s*'(bot\.[^']+)'/gm)) out.push(`${rel} BOT_OP - ${m[1]}`);
        for (const m of src.matchAll(/\blogUsage\(\{\s*api:\s*'([^']+)',\s*op(?:\s*:\s*([^,]+))?,/g)) out.push(`${rel} logUsage ${m[1]} ${(m[2] ?? 'op').trim()}`);
      }
    };
    walk(root);
    return out.sort();
  }

  const EXPECTED_SITES = [
    'app/api/cron/news-fetch/route.ts trackCall m4 news.fetch',
    'app/api/settings/credentials/test/route.ts fetchWithRetry slack test.webhook',
    'app/api/settings/credentials/test/route.ts fetchWithRetry telegram test.get-me',
    'app/api/settings/credentials/test/route.ts fetchWithRetry telegram test.send-message',
    'app/api/settings/credentials/test/route.ts trackCall <var> <var>',
    'lib/auth/kis-verify.ts trackCall kis verify.token-p',
    'lib/auth/oauth/providers.ts trackCall <var> profile.get',
    'lib/auth/oauth/providers.ts trackCall <var> token.exchange',
    'lib/exchanges/fx.ts source - latest.exchangerate-host',
    'lib/exchanges/fx.ts source - latest.frankfurter',
    'lib/exchanges/fx.ts source - latest.open-er-api',
    'lib/exchanges/fx.ts trackCall fx <var>',
    // kis-http: 시도 기록(http·레이트리밋 200·rt_cd·성공 4곳, op = opOf(label) 변수) + 예외 기록 1곳
    'lib/exchanges/kis-http.ts logUsage kis op',
    'lib/exchanges/kis-http.ts logUsage kis op',
    'lib/exchanges/kis-http.ts logUsage kis op',
    'lib/exchanges/kis-http.ts logUsage kis op',
    'lib/exchanges/kis-http.ts logUsage kis opOf(label)',
    'lib/exchanges/kis-master.ts downloadMst - download.kosdaq',
    'lib/exchanges/kis-master.ts downloadMst - download.kospi',
    'lib/exchanges/kis-master.ts trackCall kis-master <var>',
    'lib/llm/claude-cli.ts trackChild claude-cli llm.call',
    'lib/llm/home-m4-api.ts trackCall m4 chat',
    'lib/mail/send.ts trackCall smtp send-mail',
    'lib/notify/slack.ts trackCall slack webhook.send',
    'lib/notify/telegram-api.ts BOT_OP - bot.answer-callback-query',
    'lib/notify/telegram-api.ts BOT_OP - bot.edit-message-reply-markup',
    'lib/notify/telegram-api.ts BOT_OP - bot.edit-message-text',
    'lib/notify/telegram-api.ts BOT_OP - bot.get-updates',
    'lib/notify/telegram-api.ts BOT_OP - bot.send-message',
    'lib/notify/telegram-api.ts logUsage telegram BOT_OP[method]',
    'lib/notify/telegram.ts trackCall telegram alert.send-message',
    'lib/rag/m4-kb.ts trackCall m4 kb.ensure-collection',
    'lib/rag/m4-kb.ts trackCall m4 kb.search',
    'lib/rag/m4-kb.ts trackCall m4 kb.upsert',
    'lib/research/data/yahoo-finance-source.ts trackCall yahoo-finance chart.daily',
    'lib/strategy/ai-filter.ts trackChild claude-cli ai-filter.select',
    'lib/strategy/market-context-client.ts trackCall m4 market-context',
    'lib/universe/kis-overseas-master.ts trackCall kis-master download.nyse',
  ].sort();

  it('기록 지점 목록이 기대값과 정확히 같다(op 오타·호출 삭제·새 지점 추가 모두 여기서 깨진다)', () => {
    expect(collectSites()).toEqual(EXPECTED_SITES);
  });

  it('src 의 op 리터럴은 전부 OPS 목록에 있고 checkOp(식별자 모양 거부 포함)를 통과한다', () => {
    // 리터럴만 남긴다(<var>·op·opOf(label)·BOT_OP[method] 같은 식은 위 지점 목록 시험이 고정한다)
    const ops = collectSites().map((s) => s.split(' ')[3]).filter((op) => op !== '<var>' && op !== 'op' && !/[([]/.test(op));
    for (const op of ops) {
      expect(OPS).toContain(op);
      expect(checkOp(op)).toBeNull();
    }
    // 반대 방향: OPS 의 모든 op 가 src 에 실제로 있다(죽은 상수 없음)
    for (const op of OPS) expect(ops).toContain(op);
  });
});

describe('🔒 금지 정보 — 위 시험을 모두 돈 줄에 토큰·URL·본문·종목·이메일·오류 원문 0', () => {
  it('파일 전체 검사 + op 상수 전부 checkOp 통과', async () => {
    // 위 describe 들과 같은 호출을 한 파일에 몰아 쓴 뒤 검사한다.
    setFetch(async (url) => (String(url).includes('token')
      ? json(200, { access_token: 'SECRET-ACCESS' })
      : json(200, { ok: false, description: 'chat 987654321 not found', id: 'g', email: 'someone@example.com' })));
    await sendTelegramMessage('005930');
    await sendTelegramAlert('info', 't', 'b');
    await sendSlackAlert('info', 't', 'b');
    await fetchOAuthProfile({ provider: 'google', code: 'SECRET-CODE', clientId: 'c', clientSecret: 'SECRET-CS', redirectUri: 'https://x/cb' }).catch(() => {});
    const text = raw();
    expect(text.length).toBeGreaterThan(0);
    for (const frag of ['SECRET', '123456:', '987654321', '005930', 'example', 'https:', 'http:', 'Bearer', '@', 'not found', 'chat ']) {
      expect(text).not.toContain(frag);
    }
    const OPS_LOCAL = [
      'bot.send-message', 'bot.answer-callback-query', 'bot.edit-message-text', 'bot.edit-message-reply-markup',
      'bot.get-updates', 'alert.send-message', 'test.send-message', 'test.get-me', 'webhook.send', 'test.webhook',
      'market-context', 'news.fetch', 'chat', 'kb.upsert', 'kb.search', 'kb.ensure-collection', 'llm.call',
      'ai-filter.select', 'send-mail', 'chart.daily', 'token.exchange', 'profile.get', 'verify.token-p',
      'download.kospi', 'download.kosdaq', 'download.nyse', 'latest.frankfurter', 'latest.open-er-api', 'latest.exchangerate-host',
    ];
    for (const op of OPS_LOCAL) expect(checkOp(op)).toBeNull();
    expect([...OPS_LOCAL].sort()).toEqual([...OPS].sort());
  });
});

/** 기록에 쓰는 op 상수 전체(KIS label 변환분 제외 — 그쪽은 kis-http-usage.test.ts 의 KIS_LABELS). */
const OPS = [
  'bot.send-message', 'bot.answer-callback-query', 'bot.edit-message-text', 'bot.edit-message-reply-markup',
  'bot.get-updates', 'alert.send-message', 'test.send-message', 'test.get-me', 'webhook.send', 'test.webhook',
  'market-context', 'news.fetch', 'chat', 'kb.upsert', 'kb.search', 'kb.ensure-collection', 'llm.call',
  'ai-filter.select', 'send-mail', 'chart.daily', 'token.exchange', 'profile.get', 'verify.token-p',
  'download.kospi', 'download.kosdaq', 'download.nyse', 'latest.frankfurter', 'latest.open-er-api', 'latest.exchangerate-host',
];
