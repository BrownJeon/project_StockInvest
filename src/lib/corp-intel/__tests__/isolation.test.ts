/**
 * T-116 경계 시험 — corp-intel 은 **관찰·증거 보존 전용**이다(설계서 §6.8, profit-engine/__tests__/isolation.test.ts 패턴).
 *  1. corp-intel 은 주문·안전장치·시그널·전략·거래소·알림·LLM·RAG 경로를 import 하지 않는다 — DB·시간 헬퍼·mysql2 타입·node:crypto·
 *     같은 폴더 상대경로만. 동적 import·require·네트워크 호출(fetch·http) 없음(링크로 요청을 보내지 않는다).
 *  2. src 의 corp-intel 참조자는 허용 목록뿐: `app/api/cron/news-fetch/route.ts` 와 그 시험 폴더.
 *  3. corp-intel 의 쓰기 SQL 은 `ci_raw_item` 과 `system_config` 뿐, DDL 없음, DELETE·REPLACE·TRUNCATE 없음.
 *     `system_config` 쓰기는 `ci_capture_status:<market>` 키뿐 — 정적(키 함수·리터럴)과 동작(가짜 풀로 모든 분기를 돌려 실제로
 *     나간 쓰기 문장·키를 모은다) 두 방향으로 확인한다.
 *  4. 라우트가 corp-intel 에서 가져오는 이름은 둘(captureFetchOutcome·readCaptureSwitch)과 타입 하나뿐.
 */
import * as fs from 'fs';
import * as path from 'path';

const SRC = path.resolve(__dirname, '../../..');
const rel = (f: string) => path.relative(SRC, f).split(path.sep).join('/');
function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : walk(p);
    return /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(e.name) ? [p] : [];
  });
}
const ALL = walk(SRC);
const isTest = (r: string) => /(^|\/)__tests__\//.test(r) || /\.test\.tsx?$/.test(r);
const OWN = /^lib\/corp-intel\//;
const ROUTE = 'app/api/cron/news-fetch/route.ts';
const ROUTE_TESTS = /^app\/api\/cron\/news-fetch\/__tests__\//;
const read = (f: string) => fs.readFileSync(f, 'utf8');
const importsOf = (src: string) => [...src.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);

const ownFiles = ALL.filter((f) => OWN.test(rel(f)) && !isTest(rel(f)));

describe('corp-intel → 거래·안전장치 경로를 쓰지 않는다', () => {
  test('검사 대상 존재', () => {
    expect(ownFiles.map(rel).sort()).toEqual(['lib/corp-intel/keys.ts', 'lib/corp-intel/raw-capture.ts', 'lib/corp-intel/status.ts']);
  });

  test('import 는 허용 목록뿐(DB·시간·mysql2 타입·node:crypto·같은 폴더)', () => {
    const allowed = new Set(['@/lib/db', '@/lib/time', 'mysql2', 'node:crypto']);
    const bad = ownFiles.flatMap((f) => importsOf(read(f))
      .filter((m) => !(allowed.has(m) || /^\.\/[\w-]+$/.test(m)))
      .map((m) => `${rel(f)} → ${m}`));
    expect(bad).toEqual([]);
  });

  // 모듈 경로 바늘은 '@/lib/' + 이름 으로 만든다 — 이 시험 파일 자체가 다른 모듈의 격리 시험(예: profit-engine 격리 시험의 "src 의 다른
  // 파일은 그 모듈 경로 문자열을 쓰지 않는다")에 걸리지 않게.
  test.each([
    ...['safety', 'signals', 'strategy', 'exchanges', 'orders', 'notify', 'llm', 'analyst', 'rag', 'profit-engine', 'broker-ledger',
      'ledger', 'credentials', 'api-usage'].map((m) => '@/lib/' + m),
    'submitOrder', 'createOrder', 'cancelOrder', 'sendAlert', 'sendTelegram', 'kis', 'trading/', 'orders', 'signals',
  ])('%p 참조 0건', (needle) => {
    // 'kis'·'orders'·'signals' 는 단어 경계로 본다(주석의 다른 낱말에 섞여 걸리지 않게)
    const re = /^[a-z]+$/.test(needle) ? new RegExp(`\\b${needle}\\b`) : null;
    const hits = ownFiles.filter((f) => {
      const src = read(f);
      return re ? re.test(src.replace(/^\s*(\/\/|\*|\/\*).*$/gm, '')) : src.includes(needle);
    }).map(rel);
    expect(hits).toEqual([]);
  });

  test('동적 import·require·네트워크 호출 없음(링크로 요청을 보내지 않는다)', () => {
    for (const f of ownFiles) {
      const src = read(f);
      expect(src).not.toMatch(/\bimport\(|\brequire\(/);
      expect(src).not.toMatch(/\bfetch\(|['"](node:)?(http|https|net|dns|child_process)['"]|XMLHttpRequest|WebSocket/);
      expect(src).not.toMatch(/process\.env/);
    }
  });

  test('🔴 쓰기 SQL 대상은 ci_raw_item·system_config 뿐, DDL·DELETE·REPLACE·TRUNCATE 없음', () => {
    const sql = ownFiles.map(read).join('\n');
    const writeVerb = ['INSERT INTO', 'INSERT IGNORE INTO', 'UPDATE', 'DELETE FROM', 'REPLACE INTO'].join('|');
    const writes = [...sql.matchAll(new RegExp(`(?<!KEY )(${writeVerb})\\s+\`?(\\w+)`, 'g'))].map((m) => m[2]);
    expect(new Set(writes)).toEqual(new Set(['ci_raw_item', 'system_config']));
    expect(sql).not.toMatch(/DELETE FROM|REPLACE INTO|TRUNCATE/i);
    const ddl = ['CREATE', 'ALTER', 'DR' + 'OP', 'RENAME'].join('|');
    expect(sql).not.toMatch(new RegExp(`\\b(${ddl})\\s+(TABLE|DATABASE|INDEX)\\b`, 'i'));
  });

  test('🔴 system_config 키 리터럴은 ci_capture_enabled(읽기)·ci_capture_status:(쓰기 접두)뿐 — 쓰기 키는 captureStatusKey 하나로만 만든다', () => {
    const all = ownFiles.map(read).join('\n');
    const keyLits = [...all.matchAll(/['"`](ci_[a-z_]+:?)/g)].map((m) => m[1]);
    expect(new Set(keyLits)).toEqual(new Set(['ci_capture_enabled', 'ci_capture_status:', 'ci_raw_item']));
    const status = read(path.join(SRC, 'lib/corp-intel/status.ts'));
    // system_config INSERT 는 status.ts 한 곳, 그 매개변수 첫 값은 captureStatusKey() 결과(key 변수)
    expect((all.match(/INSERT INTO system_config/g) ?? []).length).toBe(1);
    expect(status).toMatch(/const key = captureStatusKey\(market\);/);
    expect(status).toMatch(/'INSERT INTO system_config \(`key`, value\) VALUES \(\?, \?\) ON DUPLICATE KEY UPDATE value = VALUES\(value\)',\s*\[key, JSON\.stringify\(next\)\],/);
  });
});

describe('🔴 동작으로 확인 — 모든 분기에서 나간 쓰기 문장·키', () => {
  const mockQuery = jest.fn();
  jest.doMock('@/lib/db', () => ({ getPool: () => ({ query: (...a: unknown[]) => mockQuery(...a) }) }));

  test('스위치 켜짐·꺼짐 × 성공·실패·테이블 없음·구 M4 × 두 시장·두 모드 — 쓰기는 ci_raw_item 과 ci_capture_status:<market> 뿐', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('../raw-capture') as typeof import('../raw-capture');
    const item = { guid: 'g', link: 'https://a.example.com/x', title: 't', published_at: '2026-10-28T00:00:00Z', feed_host: 'a.example.com' };
    const writes: string[] = [];
    for (const sw of [true, 'false', null]) {
      for (const insert of ['ok', 'no_table', 'error'] as const) {
        mockQuery.mockReset();
        mockQuery.mockImplementation(async (sql: string, params: unknown[]) => {
          if (/^\s*SELECT\b/i.test(sql)) {
            if (params[0] === 'ci_capture_enabled') return [sw === null ? [] : [{ value: sw }]];
            return [[]];
          }
          writes.push(`${sql.split(' (')[0]} ${sql.includes('system_config') ? String(params[0]) : ''}`.trim());
          if (sql.startsWith('INSERT INTO ci_raw_item')) {
            if (insert === 'no_table') throw Object.assign(new Error('x'), { code: 'ER_NO_SUCH_TABLE' });
            if (insert === 'error') throw new Error('deadlock');
          }
          return [{ affectedRows: 1, info: '' }];
        });
        for (const market of ['domestic', 'overseas'] as const) {
          for (const mode of ['peek', 'ingest'] as const) {
            await mod.captureFetchOutcome({ market, mode, ok: true, items: [item] });
            await mod.captureFetchOutcome({ market, mode, ok: false });
            await mod.captureFetchOutcome({ market, mode, ok: true, items: undefined });
            await mod.captureFetchOutcome({ market, mode, ok: true, items: [item], assumeEnabled: true });
            await mod.captureNewsItems(market, [item]);
          }
        }
      }
    }
    expect(writes.length).toBeGreaterThan(0);
    expect(new Set(writes)).toEqual(new Set([
      'INSERT INTO ci_raw_item', 'INSERT INTO system_config ci_capture_status:domestic', 'INSERT INTO system_config ci_capture_status:overseas',
    ]));
    jest.restoreAllMocks();
  });
});

describe('src → corp-intel 참조는 허용 목록뿐', () => {
  const others = ALL.filter((f) => !OWN.test(rel(f)));

  test('검사 대상이 src 대부분이다(주문·안전장치·전략·cron 포함)', () => {
    const r = others.map(rel);
    expect(r.length).toBeGreaterThan(200);
    for (const must of ['lib/safety/dry-run.ts', 'lib/strategy/engine.ts', 'lib/signals/service.ts', 'lib/exchanges/kis.ts',
      'app/api/cron/entry-watcher/route.ts', 'app/api/cron/post-market-analysis/route.ts', 'instrumentation.ts', 'middleware.ts']) {
      expect(r).toContain(must);
    }
  });

  test('🔴 corp-intel·ci_raw_item·ci_capture_ 를 언급하는 src 파일 = 라우트와 그 시험뿐', () => {
    const hits = others.filter((f) => /corp-intel|\bci_raw_item\b|\bci_capture_/.test(read(f))).map(rel);
    expect(hits.filter((r) => !(r === ROUTE || ROUTE_TESTS.test(r)))).toEqual([]);
    expect(hits).toContain(ROUTE);
  });

  test('라우트가 가져오는 이름 — captureFetchOutcome·readCaptureSwitch·타입 CaptureFetchOutcomeResult 뿐, 동적 import 없음', () => {
    const src = read(path.join(SRC, ROUTE));
    const m = /import\s*\{([^}]*)\}\s*from\s*['"]@\/lib\/corp-intel\/raw-capture['"]/.exec(src);
    expect(m).not.toBeNull();
    const names = m![1].split(',').map((x) => x.trim()).filter(Boolean).sort();
    expect(names).toEqual(['captureFetchOutcome', 'readCaptureSwitch', 'type CaptureFetchOutcomeResult']);
    expect(importsOf(src).filter((x) => x.startsWith('@/lib/corp-intel'))).toEqual(['@/lib/corp-intel/raw-capture']);
    expect(src).not.toMatch(/import\(|require\(/);
  });
});
