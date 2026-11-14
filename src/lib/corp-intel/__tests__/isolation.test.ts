/**
 * T-116 경계 시험 — corp-intel 은 **관찰·증거 보존 전용**이다(설계서 §6.8, profit-engine/__tests__/isolation.test.ts 패턴).
 *  1. corp-intel 은 주문·안전장치·시그널·전략·거래소·알림·LLM·RAG 경로를 import 하지 않는다 — DB·시간 헬퍼·mysql2 타입·node:crypto·
 *     같은 폴더 상대경로만. 동적 import·require·네트워크 호출(fetch·http) 없음(링크로 요청을 보내지 않는다).
 *  2. src 의 corp-intel 참조자는 허용 목록뿐: `app/api/cron/news-fetch/route.ts` 와 그 시험 폴더.
 *  3. corp-intel 의 쓰기 SQL 은 `ci_raw_item` 과 `system_config` 뿐, DDL 없음, DELETE·REPLACE·TRUNCATE 없음.
 *     `system_config` 쓰기는 `ci_capture_status:<market>` 키뿐 — 정적(키 함수·리터럴)과 동작(가짜 풀로 모든 분기를 돌려 실제로
 *     나간 쓰기 문장·키를 모은다) 두 방향으로 확인한다.
 *  4. 라우트가 corp-intel 에서 가져오는 이름은 둘(captureFetchOutcome·readCaptureSwitch)과 타입 하나뿐.
 *  5. (T-118) 읽기 SQL 대상도 `system_config`·`ci_raw_item` 뿐 — 피드별 겹침 검사(feed-check.ts)는 `ci_raw_item` 읽기 1문장만 더하고 쓰기는
 *     더하지 않는다. 동작 시험에서 실제로 나간 읽기 문장·대상도 모은다.
 * T-119 — 보유 종목 개장 전 공시(`holdings-premarket.ts`)가 더해졌다. 허용 목록을 그만큼만 넓힌다:
 *  - 참조자: `app/api/cron/holdings-premarket/route.ts` 와 그 시험 폴더(2.)
 *  - system_config 쓰기 키: `holdings_premarket_status` 하나 더(3.) — 스위치 `holdings_premarket_enabled` 는 읽기만
 *  - 그 라우트의 import 는 허용 목록뿐 — 거래소(KIS)·안전장치·시그널·전략·주문·LLM·RAG 없음, 직접 fetch 없음, us_filings 쓰기 없음(6.)
 *  - 읽기 SQL(5.): `us_filings` 읽기는 holdings-premarket.ts 의 존재 확인 1문장·그 파일 하나뿐, `ci_raw_item` 읽기 파일은 feed-check.ts·
 *    holdings-premarket.ts 둘뿐이고 각 1문장(sec_filing 사전 SELECT). us_filings 쓰기 금지는 3.·6. 이 그대로 본다.
 *  6. (T-119) holdings-premarket 라우트의 import·직접 fetch·쓰기 금지 — 'holdings-premarket 라우트 import = 허용 목록뿐' 시험.
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
const HP_ROUTE = 'app/api/cron/holdings-premarket/route.ts';   // (T-119)
const HP_ROUTE_TESTS = /^app\/api\/cron\/holdings-premarket\/__tests__\//;
/**
 * (T-169, 사용자 승인 2026-11-14 — 비서 채팅 B 범위 「뉴스 제목」) RSS 뉴스 제목을 `ci_raw_item` 에서 **SELECT 만** 하는 읽기 전용 채팅 요약 —
 * 정확 일치 1개. 매매·판정 경로가 아니라 답변 프롬프트의 「뉴스 제목」 절이다. corp-intel 모듈은 import 하지 않는다(아래 T-169 시험이 고정).
 */
const CHAT_NEWS_READER = 'lib/chat/overview-context.ts';
// (T-112) 잡 이름표 — 크론 러너가 부르는 이름 "holdings-premarket" 을 문자열로 적은 파일 3개(슬롯 표 1·그 시험 2). corp-intel 상수·키·모듈이 아니다.
// (T-130) +2개: 홈·분석 화면의 잡 이름 한국어 라벨표(`lib/ops/reason-dictionary.ts` 의 JOB_NAME_KO)와 그 표 고정 시험 — 잡 이름 문자열을 키로만 쓴다.
//   아래 두 번째 단언이 이름표 파일 전부에 그대로 적용된다: `holdings_premarket_*` 설정 키·`corp-intel` 참조가 들어오면 이 허용도 철회된다(약화 없음).
const HP_LABEL_FILES = /^lib\/(strategy\/records\/(job-slots\.ts|__tests__\/(job-slots|job-run-log-disposable-mariadb)\.test\.ts)|ops\/(reason-dictionary\.ts|__tests__\/reason-dictionary-t130\.test\.ts))$/;
const read = (f: string) => fs.readFileSync(f, 'utf8');
const importsOf = (src: string) => [...src.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);

const ownFiles = ALL.filter((f) => OWN.test(rel(f)) && !isTest(rel(f)));

describe('corp-intel → 거래·안전장치 경로를 쓰지 않는다', () => {
  test('검사 대상 존재', () => {
    expect(ownFiles.map(rel).sort()).toEqual([
      'lib/corp-intel/feed-check.ts', 'lib/corp-intel/holdings-premarket.ts', 'lib/corp-intel/keys.ts',
      'lib/corp-intel/raw-capture.ts', 'lib/corp-intel/status.ts',
    ]);
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

  test('🔴 (T-118) 읽기 SQL 대상은 system_config·ci_raw_item 뿐 — ci_raw_item 읽기는 feed-check.ts 의 겹침 검사 1문장뿐 · (T-119) + holdings-premarket.ts 의 us_filings·ci_raw_item 각 1문장', () => {
    const sql = ownFiles.map(read).join('\n');
    const froms = [...sql.matchAll(/\bFROM\s+`?(\w+)/g)].map((m) => m[1]);
    expect(new Set(froms)).toEqual(new Set(['system_config', 'ci_raw_item', 'us_filings']));   // (T-119) us_filings 읽기 추가 — 아래에서 파일·문장 수를 고정
    const rawReads = ownFiles.filter((f) => /\bFROM\s+ci_raw_item\b/.test(read(f))).map(rel);
    expect(rawReads).toEqual(['lib/corp-intel/feed-check.ts', 'lib/corp-intel/holdings-premarket.ts']);   // (T-119) holdings-premarket.ts 추가
    expect((read(path.join(SRC, 'lib/corp-intel/feed-check.ts')).match(/\bFROM\s+ci_raw_item\b/g) ?? []).length).toBe(1);
    // (T-119) holdings-premarket.ts: ci_raw_item 읽기는 sec_filing 사전 SELECT 1문장, us_filings 읽기는 존재 확인 1문장뿐 — us_filings 를 읽는 corp-intel 파일은 이것 하나
    const hpSrc = read(path.join(SRC, 'lib/corp-intel/holdings-premarket.ts'));
    expect((hpSrc.match(/\bFROM\s+ci_raw_item\b/g) ?? []).length).toBe(1);
    expect((hpSrc.match(/\bFROM\s+us_filings\b/g) ?? []).length).toBe(1);
    expect(ownFiles.filter((f) => /\bFROM\s+us_filings\b/.test(read(f))).map(rel)).toEqual(['lib/corp-intel/holdings-premarket.ts']);
    // feed-check.ts 는 쓰기 문장을 하나도 갖지 않는다(주석을 뺀 코드 기준 — 주석은 저장(INSERT)을 설명한다)
    const code = read(path.join(SRC, 'lib/corp-intel/feed-check.ts')).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/\b(INSERT|UPDATE|DELETE|REPLACE|TRUNCATE)\b/);
    expect(code).toMatch(/SELECT feed_host/);
  });

  test('🔴 system_config 키 리터럴은 ci_capture_enabled(읽기)·ci_capture_status:(쓰기 접두)뿐 — 쓰기 키는 captureStatusKey 하나로만 만든다', () => {
    const all = ownFiles.map(read).join('\n');
    const keyLits = [...all.matchAll(/['"`](ci_[a-z_]+:?)/g)].map((m) => m[1]);
    expect(new Set(keyLits)).toEqual(new Set(['ci_capture_enabled', 'ci_capture_status:', 'ci_raw_item']));
    const status = read(path.join(SRC, 'lib/corp-intel/status.ts'));
    // system_config INSERT 는 status.ts 한 곳 + (T-119) holdings-premarket.ts 한 곳. status.ts 의 매개변수 첫 값은 captureStatusKey() 결과(key 변수)
    expect((all.match(/INSERT INTO system_config/g) ?? []).length).toBe(2);
    expect((status.match(/INSERT INTO system_config/g) ?? []).length).toBe(1);
    expect(status).toMatch(/const key = captureStatusKey\(market\);/);
    expect(status).toMatch(/'INSERT INTO system_config \(`key`, value\) VALUES \(\?, \?\) ON DUPLICATE KEY UPDATE value = VALUES\(value\)',\s*\[key, JSON\.stringify\(next\)\],/);
  });

  test('🔴 (T-119) holdings-premarket.ts — system_config 키 리터럴은 스위치·상태 둘뿐, INSERT 는 상태 키 상수 하나로만', () => {
    const hp = read(path.join(SRC, 'lib/corp-intel/holdings-premarket.ts'));
    const keyLits = [...hp.matchAll(/['"`](holdings_premarket_[a-z_]+)/g)].map((m) => m[1]);
    expect(new Set(keyLits)).toEqual(new Set(['holdings_premarket_enabled', 'holdings_premarket_status']));
    expect(hp).toMatch(/export const HP_SWITCH_KEY = 'holdings_premarket_enabled';/);
    expect(hp).toMatch(/export const HP_STATUS_KEY = 'holdings_premarket_status';/);
    expect((hp.match(/INSERT INTO system_config/g) ?? []).length).toBe(1);
    expect(hp).toMatch(/'INSERT INTO system_config \(`key`, value\) VALUES \(\?, \?\) ON DUPLICATE KEY UPDATE value = VALUES\(value\)',\s*\[HP_STATUS_KEY, JSON\.stringify\(value\)\],/);
    // ci_raw_item 쓰기는 T-116 의 UPSERT 상수를 그대로 쓴다(first_seen_at 덮어쓰기 없음) — 자체 INSERT 문장 없음
    expect(hp).not.toMatch(/INSERT (IGNORE )?INTO ci_raw_item/);
    expect(hp).toMatch(/query<ResultSetHeader>\(CI_RAW_ITEM_UPSERT_SQL,/);
    // 🔴 us_filings 는 SELECT 만
    expect(hp).not.toMatch(/(INSERT|UPDATE|DELETE|REPLACE)[^'"`]*us_filings/i);
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
    const reads: string[] = [];
    for (const sw of [true, 'false', null]) {
      for (const insert of ['ok', 'no_table', 'error'] as const) {
        mockQuery.mockReset();
        mockQuery.mockImplementation(async (sql: string, params: unknown[]) => {
          if (/^\s*SELECT\b/i.test(sql)) {
            // (T-118) 실제로 나간 읽기 — 대상 테이블 + system_config 면 키
            const from = /\bFROM\s+(\w+)/.exec(sql)?.[1] ?? '?';
            reads.push(from === 'system_config' ? `${from} ${String(params[0])}` : from);
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
    // (T-118) 읽기도 허용 목록 안 — 스위치·상태 키(system_config)와 겹침 검사(ci_raw_item)
    expect(new Set(reads)).toEqual(new Set([
      'system_config ci_capture_enabled', 'system_config ci_capture_status:domestic', 'system_config ci_capture_status:overseas', 'ci_raw_item',
    ]));
    jest.restoreAllMocks();
  });

  test('🔴 (T-119) holdings-premarket — 스위치·기록(us_filings 있음/없음·ci 있음/없음·테이블 없음·오류)·상태 쓰기 전 분기에서 쓰기는 ci_raw_item 과 holdings_premarket_status 뿐', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const hp = require('../holdings-premarket') as typeof import('../holdings-premarket');
    const now = new Date('2026-10-28T12:00:00Z');
    const cands = hp.selectPremarketCandidates([1, 2].map((i) => ({
      symbols: ['NAS:AAPL'], cik: 320193, accession: `0000320193-26-00000${i}`, form: '8-K', items: '2.02', filed: '2026-10-28',
      acceptedAtUtc: '2026-10-28T11:00:00Z', primaryDocUrl: null,
    })), now).candidates;
    const writes: string[] = [];
    for (const mode of ['ok', 'in_us', 'in_ci', 'no_table', 'error'] as const) {
      mockQuery.mockReset();
      mockQuery.mockImplementation(async (sql: string, params: unknown[]) => {
        if (/^\s*SELECT\b/i.test(sql)) {
          if (mode === 'no_table' && /ci_raw_item/.test(sql)) throw Object.assign(new Error('x'), { code: 'ER_NO_SUCH_TABLE' });
          if (/us_filings/.test(sql)) return [mode === 'in_us' ? [{ accession: cands[0].accession }] : []];
          if (/FROM ci_raw_item/.test(sql)) return [mode === 'in_ci' ? [{ source_key: cands[1].accession }] : []];
          return [[{ value: 'true' }]];
        }
        writes.push(`${sql.split(' (')[0]} ${sql.includes('system_config') ? String(params[0]) : ''}`.trim());
        if (mode === 'error') throw new Error('deadlock');
        return [{ affectedRows: 1 }];
      });
      await hp.readPremarketSwitch();
      await hp.recordPremarketFilings(cands, now);
      await hp.readHpStatus();
      await hp.writeHpStatus(hp.nextHpStatus(null, { status: 'ok', holdings: 1, checked: 1, newFilings: 0, alerted: 0 }, now));
    }
    expect(new Set(writes)).toEqual(new Set(['INSERT INTO ci_raw_item', 'INSERT INTO system_config holdings_premarket_status']));
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

  test('🔴 corp-intel·ci_raw_item·ci_capture_ 를 언급하는 src 파일 = 라우트 둘(news-fetch·holdings-premarket)과 그 시험뿐', () => {
    const hits = others.filter((f) => /corp-intel|\bci_raw_item\b|\bci_capture_/.test(read(f))).map(rel);
    expect(hits.filter((r) => !(r === ROUTE || ROUTE_TESTS.test(r) || r === HP_ROUTE || HP_ROUTE_TESTS.test(r) || r === CHAT_NEWS_READER))).toEqual([]);
    expect(hits).toContain(ROUTE);
    expect(hits).toContain(HP_ROUTE);
  });

  test('🔴 (T-169) 허용된 채팅 뉴스 reader — lib/chat 의 참조는 그 파일 하나, ci_raw_item 은 SELECT 1문장뿐(쓰기·DDL 0), corp-intel 언급·import 0, ci_capture_ 0', () => {
    // 위 「…라우트 둘과 그 시험뿐」은 base 의 다른 미등록 파일 때문에 실패할 수 있어 T-169 추가분만 따로 고정한다
    expect(others.filter((f) => rel(f).startsWith('lib/chat/') && /corp-intel|\bci_raw_item\b|\bci_capture_/.test(read(f))).map(rel))
      .toEqual([CHAT_NEWS_READER]);
    const src = read(path.join(SRC, CHAT_NEWS_READER));
    expect(src).not.toMatch(/corp-intel|\bci_capture_/);
    expect(importsOf(src).filter((m) => /corp-intel|profit-engine/.test(m))).toEqual([]);
    expect(src.match(/\bFROM ci_raw_item\b/g)).toHaveLength(1);
    expect([...src.matchAll(/\b(\w+)\s+ci_raw_item\b/g)].map((m) => m[1].toUpperCase()).filter((w) => w !== 'FROM')).toEqual([]);
    // 이 파일은 문자열 메서드 `.replace()` 를 써서 낱말 /i 검사는 오탐 — 대문자 SQL 키워드와 SQL 문장 모양을 따로 본다
    expect(src).not.toMatch(/\b(INSERT|UPDATE|DELETE|REPLACE|TRUNCATE|CREATE|ALTER|DROP)\b/);
    expect(src).not.toMatch(/\b(insert\s+into|update\s+\w+\s+set|delete\s+from|replace\s+into|truncate\s+table|create\s+table|alter\s+table|drop\s+table)\b/i);
    expect(src).not.toMatch(/\bsystem_config\b/);
    // corp-intel 은 그 파일을 참조하지 않는다
    expect(ownFiles.filter((f) => /lib\/chat|overview-context/.test(read(f))).map(rel)).toEqual([]);
  });

  test('🔴 (T-119) holdings-premarket 상수·키를 쓰는 src 파일 = corp-intel 과 그 라우트·시험뿐 (+ 잡 이름표 5파일 — T-112 3·T-130 2, 이름표 파일은 상수·키 0)', () => {
    const hits = others.filter((f) => /holdings_premarket_|holdings-premarket/.test(read(f))).map(rel);
    expect(hits.filter((r) => !(r === HP_ROUTE || HP_ROUTE_TESTS.test(r) || HP_LABEL_FILES.test(r)))).toEqual([]);
    // 이름표 파일은 이름 문자열만 쓴다 — 설정 키(holdings_premarket_*)·corp-intel 참조가 들어오면 허용을 철회한다
    expect(hits.filter((r) => HP_LABEL_FILES.test(r)).filter((r) => /holdings_premarket_|corp-intel/.test(read(path.join(SRC, r))))).toEqual([]);
  });

  test('🔴 (T-119) holdings-premarket 라우트 import = 허용 목록뿐 — KIS·안전장치·시그널·전략·주문·LLM·RAG 없음, 직접 fetch·us_filings 쓰기 없음', () => {
    const src = read(path.join(SRC, HP_ROUTE));
    expect(importsOf(src).sort()).toEqual([
      '@/lib/corp-intel/holdings-premarket', '@/lib/cron-auth', '@/lib/data/us-edgar/parse', '@/lib/data/us-edgar/sec-client', '@/lib/db',
      '@/lib/notify', 'mysql2', 'next/server',
    ]);
    for (const m of ['exchanges', 'safety', 'signals', 'strategy', 'orders', 'llm', 'analyst', 'rag', 'profit-engine', 'broker-ledger', 'ledger', 'risk']) {
      expect(importsOf(src).filter((x) => x.startsWith('@/lib/' + m))).toEqual([]);
    }
    expect(src).not.toMatch(/import\(|require\(/);
    expect(src).not.toMatch(/\bfetch\(/);                                   // SEC 는 SecClient 로만
    expect(src).not.toMatch(/\b(submitOrder|createOrder|cancelOrder|getBalances|getTicker)\b/);
    expect(src).not.toMatch(/(INSERT|UPDATE|DELETE|REPLACE)[^'"`]*\b(us_filings|portfolio_snapshots|symbol_cik_map|signals|orders|position_state)\b/i);
    // corp-intel 에서 가져오는 것은 holdings-premarket 하나(raw-capture·status 직접 사용 없음)
    expect(importsOf(src).filter((x) => x.startsWith('@/lib/corp-intel'))).toEqual(['@/lib/corp-intel/holdings-premarket']);
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
