/**
 * T-116 — 뉴스 최초 관측 캡처(raw-capture.ts·status.ts) 시험.
 *
 * DB 는 목(풀·쿼리 스텁)이다 — 운영 DB 접속 없음. 검증 범위:
 *  - 스위치: 키 없음·읽기 오류·true 아닌 값 = 꺼짐(스위치 읽기 1회 외 DB 0), 정확히 JSON true 만 켜짐
 *  - 🔴 first_seen_at 보존: 갱신 절은 last_seen_at 만(SQL 단언), 신규 행은 first_seen_at = last_seen_at = 지금(KST)
 *  - 중복 계산(info 의 Duplicates · affectedRows 추정 · 한 묶음 안 중복)
 *  - 테이블 없음 → skipped_no_table + 프로세스당 경고 1회 · DB 오류 → failed · 4초 상한 · getPool 예외 — 전부 던지지 않음
 *  - 항목 검증: 제어문자·유니코드 서식 문자(M4 Reviewer LOW)·짝 없는 서로게이트·링크(스킴·사용자 정보·IP 리터럴·포트·localhost)·
 *    길이·발행시각·빈 항목·상한 초과
 *  - captureFetchOutcome + 상태 기록(ci_capture_status:<market> — 연속 실패 증가·초기화, 꺼짐이면 기록 안 함)
 */
import {
  CI_CAPTURE_MAX_ITEMS,
  CI_CAPTURE_TIMEOUT_MS,
  CI_RAW_ITEM_UPSERT_SQL,
  CI_RSS_PARSER_VERSION,
  captureFetchOutcome,
  captureNewsItems,
  captureSwitchValueEnabled,
  countUpsert,
  readCaptureSwitch,
  resetCaptureWarningsForTest,
  validateLink,
  validateNewsItem,
} from '../raw-capture';
import { CI_STATUS_TIMEOUT_MS, recordCaptureStatus } from '../status';
import { CI_FEED_PREV_NEWEST_SQL } from '../feed-check';
import * as fs from 'fs';
import * as path from 'path';
import { rssSourceKey } from '../keys';

const mockQuery = jest.fn();
let mockPoolThrows: Error | null = null;
jest.mock('@/lib/db', () => ({
  getPool: () => {
    if (mockPoolThrows) throw mockPoolThrows;
    return { query: (...a: unknown[]) => mockQuery(...a) };
  },
}));

const MISSING = Symbol('missing');
interface DbOpts {
  switchValue?: unknown;
  switchError?: Error;
  statusValue?: unknown;
  statusReadError?: Error;
  insertResult?: { affectedRows?: number; info?: string };
  insertError?: unknown;
  statusWriteError?: Error;
  /** (T-118) 겹침 검사 조회 결과 행(기본 없음 = bootstrap) */
  feedRows?: { feed_host: string; newest: unknown }[];
  feedError?: Error;
}
/** SQL 로 갈라 응답하는 가짜 풀. 호출 기록은 mockQuery.mock.calls. */
function db(o: DbOpts = {}) {
  mockQuery.mockImplementation(async (sql: string, params: unknown[]) => {
    if (sql.startsWith('SELECT value FROM system_config')) {
      const key = String(params[0]);
      if (key === 'ci_capture_enabled') {
        if (o.switchError) throw o.switchError;
        const v = 'switchValue' in o ? o.switchValue : true;
        return [v === MISSING ? [] : [{ value: v }]];
      }
      if (key.startsWith('ci_capture_status:')) {
        if (o.statusReadError) throw o.statusReadError;
        return [o.statusValue === undefined ? [] : [{ value: o.statusValue }]];
      }
      throw new Error(`unexpected key ${key}`);
    }
    if (sql === CI_FEED_PREV_NEWEST_SQL) {
      if (o.feedError) throw o.feedError;
      return [o.feedRows ?? []];
    }
    if (sql === CI_RAW_ITEM_UPSERT_SQL) {
      if (o.insertError) throw o.insertError;
      const n = (params[0] as unknown[][]).length;
      return [o.insertResult ?? { affectedRows: n, info: `Records: ${n}  Duplicates: 0  Warnings: 0` }];
    }
    if (sql.startsWith('INSERT INTO system_config')) {
      if (o.statusWriteError) throw o.statusWriteError;
      return [{ affectedRows: 1 }];
    }
    throw new Error(`unexpected sql ${sql}`);
  });
}
const calls = () => mockQuery.mock.calls as [string, unknown[]][];
const upserts = () => calls().filter(([s]) => s === CI_RAW_ITEM_UPSERT_SQL);
const statusWrites = () => calls().filter(([s]) => s.startsWith('INSERT INTO system_config'));
const rowsOf = (i = 0) => upserts()[i][1][0] as unknown[][];

const NOW = new Date('2026-10-28T03:04:05Z'); // KST 2026-10-28 12:04:05
const KST_NOW = '2026-10-28 12:04:05';
const item = (n: number, extra: Record<string, unknown> = {}) => ({
  guid: `https://www.yna.co.kr/view/AKR${n}`,
  link: `https://www.yna.co.kr/view/AKR${n}`,
  title: `기사 ${n}`,
  published_at: '2026-10-28T01:02:03+00:00',
  pub_date_raw: 'Tue, 28 Oct 2026 10:02:03 +0900',
  feed_host: 'www.yna.co.kr',
  ...extra,
});
// 금지 문자는 String.fromCharCode 로 만든다(소스 파일에 보이지 않는 문자를 두지 않는다).
const ch = (code: number) => String.fromCharCode(code);

let warn: jest.SpyInstance;
let log: jest.SpyInstance;
beforeEach(() => {
  mockQuery.mockReset();
  mockPoolThrows = null;
  resetCaptureWarningsForTest();
  warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  log = jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  jest.useRealTimers();
  warn.mockRestore();
  log.mockRestore();
});

describe('스위치 ci_capture_enabled — 키 없음 = 꺼짐', () => {
  test.each([
    [true, true], ['true', true], [' true ', true],
    ['false', false], [false, false], ['1', false], [1, false], ['TRUE', false], ['"true"', false], ['', false], [null, false], [{}, false],
  ])('값 %p → 켜짐 %p', (v, on) => {
    expect(captureSwitchValueEnabled(v)).toBe(on);
  });

  test('🔴 키 없음 → skipped_disabled, 스위치 읽기 1회 외 DB 0', async () => {
    db({ switchValue: MISSING });
    const r = await captureNewsItems('domestic', [item(1)], { now: NOW });
    expect(r).toEqual({ status: 'skipped_disabled', inserted: 0, duplicates: 0, rejected: 0 });
    expect(calls()).toHaveLength(1);
    expect(calls()[0][1]).toEqual(['ci_capture_enabled']);
  });

  test('값이 false 면 꺼짐 — INSERT 0', async () => {
    db({ switchValue: 'false' });
    expect((await captureNewsItems('overseas', [item(1)])).status).toBe('skipped_disabled');
    expect(upserts()).toHaveLength(0);
  });

  test('읽기 오류 → 꺼짐(던지지 않음)', async () => {
    db({ switchError: new Error('db down') });
    expect(await readCaptureSwitch()).toEqual({ enabled: false, source: 'read_error' });
    expect((await captureNewsItems('domestic', [item(1)])).status).toBe('skipped_disabled');
    expect(upserts()).toHaveLength(0);
  });

  test('getPool 이 던져도 꺼짐', async () => {
    mockPoolThrows = new Error('setup fatal');
    expect(await readCaptureSwitch()).toEqual({ enabled: false, source: 'read_error' });
  });

  test('스위치 읽기도 4초 상한 — 멈추면 꺼짐(timeout)', async () => {
    jest.useFakeTimers();
    mockQuery.mockImplementation(() => new Promise(() => {}));
    const p = readCaptureSwitch();
    await jest.advanceTimersByTimeAsync(CI_CAPTURE_TIMEOUT_MS + 1);
    expect(await p).toEqual({ enabled: false, source: 'timeout' });
  });

  test('assumeEnabled 이면 스위치를 다시 읽지 않는다', async () => {
    db({ switchValue: MISSING });
    const r = await captureNewsItems('domestic', [item(1)], { now: NOW, assumeEnabled: true });
    expect(r.status).toBe('ok');
    expect(calls().some(([, p]) => p[0] === 'ci_capture_enabled')).toBe(false);
  });
});

describe('저장 — first_seen_at 보존 SQL', () => {
  test('🔴 갱신 절은 last_seen_at 하나뿐 — first_seen_at 을 덮어쓰지 않는다', () => {
    const [, update] = CI_RAW_ITEM_UPSERT_SQL.split('ON DUPLICATE KEY UPDATE');
    expect(update.trim()).toBe('last_seen_at = VALUES(last_seen_at)');
    expect(update).not.toMatch(/first_seen_at/);
    expect(CI_RAW_ITEM_UPSERT_SQL).toMatch(/^INSERT INTO ci_raw_item \(/);
    expect(CI_RAW_ITEM_UPSERT_SQL).not.toMatch(/INSERT IGNORE|REPLACE/i);
  });

  test('신규 행 값 — rss·키·version 1·captured·발행시각 KST·first=last=지금 KST·parser_version', async () => {
    db();
    const r = await captureNewsItems('domestic', [item(1)], { now: NOW });
    expect(r).toEqual({ status: 'ok', inserted: 1, duplicates: 0, rejected: 0 });
    expect(upserts()).toHaveLength(1);
    const [row] = rowsOf();
    const it = item(1);
    expect(row).toEqual([
      'rss',
      rssSourceKey({ feedHost: it.feed_host, guid: it.guid, link: it.link, title: it.title, publishedAt: it.published_at }),
      1,
      expect.stringMatching(/^[0-9a-f]{64}$/),
      'captured',
      '2026-10-28 10:02:03',
      KST_NOW,
      KST_NOW,
      it.link,
      it.guid,
      'www.yna.co.kr',
      '기사 1',
      CI_RSS_PARSER_VERSION,
    ]);
    expect(CI_RSS_PARSER_VERSION.length).toBeLessThanOrEqual(24);
  });

  test('같은 항목을 두 번 캡처하면 두 번째는 같은 키 — 서버 Duplicates 로 중복 1', async () => {
    db();
    await captureNewsItems('domestic', [item(1)], { now: NOW, assumeEnabled: true });
    db({ insertResult: { affectedRows: 2, info: '' } });
    const r2 = await captureNewsItems('domestic', [item(1)], { now: new Date(NOW.getTime() + 3600_000), assumeEnabled: true });
    expect(r2).toEqual({ status: 'ok', inserted: 0, duplicates: 1, rejected: 0 });
    expect(upserts()).toHaveLength(2);
    expect(rowsOf(1)[0][1]).toBe(rowsOf(0)[0][1]);          // 같은 source_key
    expect(rowsOf(1)[0][6]).toBe('2026-10-28 13:04:05');    // 두 번째 값의 first_seen_at 은 보내지만 갱신 절이 쓰지 않는다(위 SQL 단언)
    expect(rowsOf(1)[0][7]).toBe('2026-10-28 13:04:05');    // last_seen_at = 두 번째 관측 시각
  });

  test('여러 행 — info 의 Duplicates 가 정본', async () => {
    db({ insertResult: { affectedRows: 4, info: 'Records: 3  Duplicates: 1  Warnings: 0' } });
    const r = await captureNewsItems('overseas', [item(1), item(2), item(3)], { now: NOW, assumeEnabled: true });
    expect(r).toEqual({ status: 'ok', inserted: 2, duplicates: 1, rejected: 0 });
  });

  test('한 묶음 안 같은 키는 한 행으로 보내고 중복으로 센다', async () => {
    db({ insertResult: { affectedRows: 1, info: '' } });
    const r = await captureNewsItems('overseas', [item(1), item(1)], { now: NOW, assumeEnabled: true });
    expect(rowsOf()).toHaveLength(1);
    expect(r).toEqual({ status: 'ok', inserted: 1, duplicates: 1, rejected: 0 });
  });

  test('빈 목록·전부 무효면 INSERT 하지 않는다', async () => {
    db();
    expect(await captureNewsItems('domestic', [], { assumeEnabled: true })).toEqual({ status: 'ok', inserted: 0, duplicates: 0, rejected: 0 });
    expect(await captureNewsItems('domestic', [{}, 5, null], { assumeEnabled: true })).toEqual({ status: 'ok', inserted: 0, duplicates: 0, rejected: 3 });
    expect(await captureNewsItems('domestic', 'not-array', { assumeEnabled: true })).toEqual({ status: 'ok', inserted: 0, duplicates: 0, rejected: 0 });
    expect(upserts()).toHaveLength(0);
  });

  test.each([
    [3, { affectedRows: 3, info: 'Records: 3  Duplicates: 0  Warnings: 0' }, { inserted: 3, duplicates: 0 }],
    [3, { affectedRows: 5, info: 'Records: 3  Duplicates: 2  Warnings: 0' }, { inserted: 1, duplicates: 2 }],
    [1, { affectedRows: 1, info: '' }, { inserted: 1, duplicates: 0 }],
    [1, { affectedRows: 2, info: '' }, { inserted: 0, duplicates: 1 }],
    [1, { affectedRows: 0, info: '' }, { inserted: 0, duplicates: 1 }],
    [3, { affectedRows: 4 }, { inserted: 2, duplicates: 1 }],
    [3, null, { inserted: 3, duplicates: 0 }],
  ])('countUpsert(%p, %p) → %p', (n, res, out) => {
    expect(countUpsert(n, res)).toEqual(out);
  });
});

describe('실패 — 절대 던지지 않는다', () => {
  test('🔴 ER_NO_SUCH_TABLE → skipped_no_table, 경고는 프로세스당 1회', async () => {
    const e = Object.assign(new Error("Table 'x.ci_raw_item' doesn't exist"), { code: 'ER_NO_SUCH_TABLE', errno: 1146 });
    db({ insertError: e });
    const r1 = await captureNewsItems('domestic', [item(1)], { assumeEnabled: true });
    const r2 = await captureNewsItems('overseas', [item(2)], { assumeEnabled: true });
    expect(r1).toEqual({ status: 'skipped_no_table', inserted: 0, duplicates: 0, rejected: 0 });
    expect(r2.status).toBe('skipped_no_table');
    expect(warn.mock.calls.filter((c) => String(c[0]).includes('테이블 없음'))).toHaveLength(1);
  });

  test('errno 1146 만 있어도 테이블 없음으로 본다', async () => {
    db({ insertError: { errno: 1146 } });
    expect((await captureNewsItems('domestic', [item(1)], { assumeEnabled: true })).status).toBe('skipped_no_table');
  });

  test('그 밖의 DB 오류 → failed', async () => {
    db({ insertError: new Error('Deadlock') });
    expect(await captureNewsItems('domestic', [item(1)], { assumeEnabled: true }))
      .toEqual({ status: 'failed', inserted: 0, duplicates: 0, rejected: 0 });
  });

  test('getPool 이 던지면 failed', async () => {
    mockPoolThrows = new Error('setup fatal');
    expect((await captureNewsItems('domestic', [item(1)], { assumeEnabled: true })).status).toBe('failed');
  });

  test('🔴 4초 상한 — INSERT 가 멈추면 4초 뒤 failed, 늦은 거부는 흡수', async () => {
    jest.useFakeTimers();
    let rejectLate: (e: Error) => void = () => {};
    mockQuery.mockImplementation(() => new Promise((_, rej) => { rejectLate = rej; }));
    const p = captureNewsItems('domestic', [item(1)], { assumeEnabled: true });
    await jest.advanceTimersByTimeAsync(CI_CAPTURE_TIMEOUT_MS - 1);
    let settled = false;
    void p.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    await jest.advanceTimersByTimeAsync(2);
    expect(await p).toEqual({ status: 'failed', inserted: 0, duplicates: 0, rejected: 0, reason: 'deadline' });
    rejectLate(new Error('late'));
    await Promise.resolve();
  });
});

describe('항목 검증 — M4 Reviewer LOW 2건(제어문자·서식 문자) 포함', () => {
  test.each([
    ['ZWSP U+200B', 0x200b], ['RLM U+200F', 0x200f], ['LS U+2028', 0x2028], ['RLO U+202E', 0x202e],
    ['WJ U+2060', 0x2060], ['U+2064', 0x2064], ['BOM U+FEFF', 0xfeff],
  ])('🔴 title 의 서식 문자(%s)는 삭제하고 rejected 로 센다 — 항목은 저장', (_n, code) => {
    const { row, flagged } = validateNewsItem(item(1, { title: `삼성${ch(code)}전자 실적` }));
    expect(flagged).toBe(true);
    expect(row?.title).toBe('삼성전자 실적');
  });

  test.each([
    ['NUL', 0x00], ['LF', 0x0a], ['ESC', 0x1b], ['DEL', 0x7f], ['C1 U+0085', 0x85], ['C1 U+009F', 0x9f],
  ])('🔴 title 의 제어문자(%s)는 공백으로 바꾸고 접는다 + rejected', (_n, code) => {
    const { row, flagged } = validateNewsItem(item(1, { title: `A${ch(code)}B` }));
    expect(flagged).toBe(true);
    expect(row?.title).toBe('A B');
  });

  test.each([
    ['ZWSP', 0x200b], ['RLO', 0x202e], ['BOM', 0xfeff], ['NUL', 0x00], ['DEL', 0x7f], ['C1', 0x85],
  ])('🔴 link·guid 에 금지 문자(%s)가 있으면 그 값만 버린다(NULL) + rejected', (_n, code) => {
    const bad = `https://www.yna.co.kr/view/A${ch(code)}1`;
    const r = validateNewsItem(item(1, { link: bad, guid: bad }));
    expect(r.flagged).toBe(true);
    expect(r.row).not.toBeNull();
    expect(r.row!.url).toBeNull();
    expect(r.row!.title).toBe('기사 1');
  });

  test('짝 없는 서로게이트 — title 에서는 삭제, guid 는 버림', () => {
    const r = validateNewsItem(item(1, { title: `가${ch(0xd800)}나`, guid: `g${ch(0xdc00)}` }));
    expect(r.flagged).toBe(true);
    expect(r.row!.title).toBe('가나');
    // 정상 서로게이트 쌍(이모지)은 그대로
    const ok = validateNewsItem(item(2, { title: `실적 ${ch(0xd83d)}${ch(0xde00)}` }));
    expect(ok.flagged).toBe(false);
    expect(ok.row!.title).toBe(`실적 ${ch(0xd83d)}${ch(0xde00)}`);
  });

  test.each([
    ['https 정상', 'https://www.reuters.com/markets/x?a=1#f', true],
    ['http 정상', 'http://feeds.marketwatch.com/x', true],
    ['기본 포트 443 은 URL 이 지운다', 'https://www.cnbc.com:443/x', true],
    ['ftp', 'ftp://www.example.com/x', false],
    ['javascript', 'javascript:alert(1)', false],
    ['data', 'data:text/html,<script>1</script>', false],
    ['상대 경로', '/view/AKR1', false],
    ['사용자 정보', 'https://user:pw@www.example.com/x', false],
    ['사용자 이름만', 'https://user@www.example.com/x', false],
    ['IPv4 리터럴', 'http://127.0.0.1/x', false],
    ['IPv4 사설', 'http://192.168.219.100:8000/v1/kb', false],
    ['10진 IPv4', 'http://2130706433/x', false],
    ['16진 IPv4', 'http://0x7f.0.0.1/x', false],
    ['IPv6', 'http://[::1]/x', false],
    ['localhost', 'http://localhost/x', false],
    ['*.localhost', 'http://api.localhost/x', false],
    ['점 없는 호스트', 'http://intranet/x', false],
    ['명시 포트', 'https://www.example.com:8443/x', false],
    ['기본이 아닌 80 on https', 'https://www.example.com:80/x', false],
    ['공백 포함', 'https://www.example.com/a b', false],
    ['513자', `https://www.example.com/${'a'.repeat(513 - 24)}`, false],
    ['512자', `https://www.example.com/${'a'.repeat(512 - 24)}`, true],
  ])('링크 %s → 저장 %p', (_n, link, keep) => {
    const r = validateLink(link);
    expect(r.value === null).toBe(!keep);
    expect(r.flagged).toBe(!keep);
  });

  test.each([
    ['역슬래시 앞 사용자 정보(파서 불일치)', 'http://example.com\\@127.0.0.1/'],
    ['역슬래시 호스트 끝', 'https://www.example.com\\x'],
    ['역슬래시 경로(WHATWG 는 / 로 고쳐 읽음 — 규칙 ① 만 잡는다)', 'https://www.example.com/a\\b'],
    ['역슬래시 쿼리', 'https://www.example.com/x?q=a\\b'],
    ['localhost 끝 점', 'http://localhost./x'],
    ['*.localhost 끝 점', 'http://foo.localhost./'],
    ['슬래시 없는 스킴', 'http:example.com/x'],
    ['슬래시 셋', 'http:///example.com/'],
    ['슬래시 하나', 'http:/example.com/'],
    ['점 없는 호스트 끝 점', 'http://intranet./x'],
    ['IPv4 끝 점', 'http://127.0.0.1./x'],
    ['퍼센트 인코딩 호스트(정규화가 호스트를 바꿈)', 'http://www.exa%6dple.com/x'],
  ])('🔴 (M-1) %s → 링크 값만 버림', (_n, link) => {
    const r = validateLink(link);
    expect(r).toEqual({ value: null, flagged: true });
  });

  test.each([
    ['연합 기사', 'https://www.yna.co.kr/view/AKR20261028123400008', 'https://www.yna.co.kr/view/AKR20261028123400008'],
    ['CNBC 기사', 'https://www.cnbc.com/2026/10/28/stocks-making-the-biggest-moves.html', 'https://www.cnbc.com/2026/10/28/stocks-making-the-biggest-moves.html'],
    ['쿼리스트링·조각', 'https://www.marketwatch.com/story/x-1a2b?mod=rss_markets&utm_source=feed#top', 'https://www.marketwatch.com/story/x-1a2b?mod=rss_markets&utm_source=feed#top'],
    ['대문자 스킴·호스트 → 정규화', 'HTTPS://WWW.Example.COM/A?B=1', 'https://www.example.com/A?B=1'],
    ['기본 포트 제거', 'https://www.cnbc.com:443/x', 'https://www.cnbc.com/x'],
    ['경로 없는 링크 → 끝 슬래시', 'https://finance.yahoo.com', 'https://finance.yahoo.com/'],
  ])('(M-1) 정상 링크 %s → WHATWG href 로 저장', (_n, link, href) => {
    expect(validateLink(link)).toEqual({ value: href, flagged: false });
  });

  test('링크를 버려도 guid·title 이 있으면 저장 — 키는 guid 기준', () => {
    const r = validateNewsItem(item(1, { link: 'http://127.0.0.1/x' }));
    expect(r.flagged).toBe(true);
    expect(r.row!.url).toBeNull();
  });

  test('guid 300자 초과는 버리고 link 로 키를 만든다', () => {
    const it = item(1, { guid: 'g'.repeat(301) });
    const r = validateNewsItem(it);
    expect(r.flagged).toBe(true);
    expect(r.row!.sourceKey).toBe(rssSourceKey({ feedHost: it.feed_host, guid: null, link: it.link, title: it.title, publishedAt: it.published_at }));
  });

  test('title 400자(코드 포인트) 초과는 400자로 자르고 rejected', () => {
    const r = validateNewsItem(item(1, { title: '가'.repeat(401) }));
    expect(r.flagged).toBe(true);
    expect([...r.row!.title!].length).toBe(400);
    const ok = validateNewsItem(item(1, { title: '가'.repeat(400) }));
    expect(ok.flagged).toBe(false);
  });

  test.each([
    ['2026-10-28T01:02:03Z', '2026-10-28 10:02:03', false],
    ['2026-10-28T01:02:03+00:00', '2026-10-28 10:02:03', false],
    ['2026-10-28T10:02:03+09:00', '2026-10-28 10:02:03', false],
    ['2026-10-28T01:02:03.123456Z', '2026-10-28 10:02:03', false],
    ['2026-10-28T01:02Z', '2026-10-28 10:02:00', false],
    [null, null, false],
    ['', null, false],
    ['Tue, 28 Oct 2026 10:02:03 +0900', null, true],
    ['2026-10-28', null, true],
    ['2026-10-28T01:02:03', null, true],
    ['2026-13-40T01:02:03Z', null, true],
    ['1969-12-31T23:00:00Z', null, true],
    [12345, null, true],
  ])('published_at %p → %p (rejected %p)', (v, kst, flagged) => {
    const r = validateNewsItem(item(1, { published_at: v }));
    expect(r.row!.publishedAt).toBe(kst);
    expect(r.flagged).toBe(flagged);
  });

  test.each([
    ['2월 30일', '2026-02-30T00:00:00Z'], ['24시', '2026-10-28T24:00:00Z'], ['60분', '2026-10-28T10:60:00Z'], ['윤년 아님 2월 29일', '2025-02-29T12:00:00Z'],
  ])('🔴 (L-3) 불가능한 발행시각(%s)은 롤오버하지 않고 published_at 만 NULL — 다른 필드는 저장', (_n, v) => {
    const r = validateNewsItem(item(1, { published_at: v }));
    expect(r.flagged).toBe(true);
    expect(r.row).not.toBeNull();
    expect(r.row!.publishedAt).toBeNull();
    expect(r.row!.title).toBe('기사 1');
    expect(r.row!.url).toBe(item(1).link);
  });

  test('🔴 (M-3) 발행시각 표기만 다른 같은 기사는 같은 source_key·같은 published_at', () => {
    const rows = ['2026-10-28T09:42:03+00:00', '2026-10-28T09:42:03Z', '2026-10-28T18:42:03+09:00', '2026-10-28T09:42:03.000Z']
      .map((v) => validateNewsItem(item(1, { published_at: v })).row!);
    expect(new Set(rows.map((r) => r.sourceKey)).size).toBe(1);
    expect(new Set(rows.map((r) => r.contentSha256)).size).toBe(1);
    expect(new Set(rows.map((r) => r.publishedAt))).toEqual(new Set(['2026-10-28 18:42:03']));
    expect(validateNewsItem(item(1, { published_at: '2026-10-28T09:42:04Z' })).row!.sourceKey).not.toBe(rows[0].sourceKey);
  });

  test.each([
    ['LRI U+2066', 0x2066], ['RLI U+2067', 0x2067], ['FSI U+2068', 0x2068], ['PDI U+2069', 0x2069],
    ['ALM U+061C', 0x061c], ['MVS U+180E', 0x180e], ['SHY U+00AD', 0x00ad],
  ])('🔴 (L-4) title 의 %s 는 삭제 + rejected, link·guid 에 있으면 값 버림', (_n, code) => {
    const r = validateNewsItem(item(1, { title: `삼성${ch(code)}전자` }));
    expect(r.flagged).toBe(true);
    expect(r.row!.title).toBe('삼성전자');
    const bad = `https://www.yna.co.kr/view/A${ch(code)}1`;
    const r2 = validateNewsItem(item(1, { link: bad, guid: bad }));
    expect(r2.flagged).toBe(true);
    expect(r2.row!.url).toBeNull();
    expect(r2.row!.title).toBe('기사 1');
  });

  test('feed_host 꼴 검사 — 대문자는 소문자로, 이상한 값은 버림', () => {
    expect(validateNewsItem(item(1, { feed_host: 'WWW.YNA.CO.KR' })).row!.feedHost).toBe('www.yna.co.kr');
    const bad = validateNewsItem(item(1, { feed_host: 'evil host/../' }));
    expect(bad.flagged).toBe(true);
    expect(bad.row!.feedHost).toBeNull();
  });

  test('guid·link·title 이 모두 없으면 저장하지 않는다(rejected)', () => {
    expect(validateNewsItem({ guid: null, link: null, title: '   ', feed_host: 'a.com' })).toEqual({ row: null, flagged: true });
    expect(validateNewsItem({ link: 'http://10.0.0.1/', title: ch(0x200b) })).toEqual({ row: null, flagged: true });
  });

  test('문자열이 아닌 필드 → 그 값만 버리고 rejected', () => {
    const r = validateNewsItem(item(1, { title: 123 }));
    expect(r.flagged).toBe(true);
    expect(r.row!.title).toBeNull();
  });

  test('정상 항목은 rejected 가 아니다', () => {
    expect(validateNewsItem(item(1)).flagged).toBe(false);
  });

  test(`한 번에 ${CI_CAPTURE_MAX_ITEMS}개 초과분은 저장하지 않고 rejected`, async () => {
    db({ insertResult: { affectedRows: CI_CAPTURE_MAX_ITEMS, info: `Records: ${CI_CAPTURE_MAX_ITEMS}  Duplicates: 0  Warnings: 0` } });
    const list = Array.from({ length: CI_CAPTURE_MAX_ITEMS + 5 }, (_, i) => item(i));
    const r = await captureNewsItems('overseas', list, { assumeEnabled: true });
    expect(rowsOf()).toHaveLength(CI_CAPTURE_MAX_ITEMS);
    expect(r).toEqual({ status: 'ok', inserted: CI_CAPTURE_MAX_ITEMS, duplicates: 0, rejected: 5 });
  });

  test('묶음 집계 — 서식 문자 제목 1·무효 1·정상 1', async () => {
    db({ insertResult: { affectedRows: 2, info: 'Records: 2  Duplicates: 0  Warnings: 0' } });
    const r = await captureNewsItems('domestic', [item(1, { title: `a${ch(0x2028)}b` }), 7, item(2)], { assumeEnabled: true });
    expect(r).toEqual({ status: 'ok', inserted: 2, duplicates: 0, rejected: 2 });
  });
});

describe('captureFetchOutcome + 상태 기록(ci_capture_status:<market>)', () => {
  const statusOf = (i = 0) => JSON.parse(String(statusWrites()[i][1][1]));

  test('🔴 스위치 꺼짐 → 저장·상태 기록 모두 없음(스위치 읽기 1회뿐)', async () => {
    db({ switchValue: MISSING });
    const r = await captureFetchOutcome({ market: 'domestic', mode: 'ingest', ok: true, items: [item(1)], now: NOW });
    expect(r).toEqual({ capture: { status: 'skipped_disabled', inserted: 0, duplicates: 0, rejected: 0 }, status: null, deadline: 'ok' });
    expect(calls()).toHaveLength(1);
  });

  test('켜짐 + items → 저장 + 상태 {lastAt, mode, status ok, fetched, inserted, duplicates, rejected, consecutiveFailures 0}', async () => {
    db({ statusValue: JSON.stringify({ consecutiveFailures: 4 }) });
    const r = await captureFetchOutcome({ market: 'overseas', mode: 'peek', ok: true, items: [item(1), item(2)], now: NOW });
    expect(r.capture).toEqual({ status: 'ok', inserted: 2, duplicates: 0, rejected: 0 });
    expect(statusWrites()).toHaveLength(1);
    expect(statusWrites()[0][1][0]).toBe('ci_capture_status:overseas');
    expect(statusOf()).toEqual({
      lastAt: KST_NOW, mode: 'peek', status: 'ok', fetched: 2, inserted: 2, duplicates: 0, rejected: 0, consecutiveFailures: 0,
      // (T-118) 피드별 겹침 검사 — 직전 행 없음(첫 캡처) = bootstrap
      feeds: { 'www.yna.co.kr': { oldestPub: '2026-10-28 10:02:03', newestPub: '2026-10-28 10:02:03', items: 2, gap: 'bootstrap', consecutiveGaps: 0 } },
    });
    expect(r.status).toEqual(statusOf());
  });

  test('M4 실패(fetch_failed) → 저장 없음, 연속 실패 +1(이전 값 JSON 문자열·객체 모두 읽음)', async () => {
    db({ statusValue: JSON.stringify({ consecutiveFailures: 2 }) });
    await captureFetchOutcome({ market: 'domestic', mode: 'peek', ok: false, assumeEnabled: true, now: NOW });
    expect(upserts()).toHaveLength(0);
    expect(statusOf()).toMatchObject({ status: 'fetch_failed', fetched: 0, consecutiveFailures: 3, mode: 'peek' });
    mockQuery.mockReset();
    db({ statusValue: { consecutiveFailures: 7 } });
    await captureFetchOutcome({ market: 'domestic', mode: 'peek', ok: false, assumeEnabled: true, now: NOW });
    expect(statusOf()).toMatchObject({ consecutiveFailures: 8 });
  });

  test('items 배열 없음(구 M4) → no_items 로 실패 1, 저장 없음', async () => {
    db();
    const r = await captureFetchOutcome({ market: 'domestic', mode: 'peek', ok: true, items: undefined, assumeEnabled: true, now: NOW });
    expect(r.capture).toBeNull();
    expect(upserts()).toHaveLength(0);
    expect(statusOf()).toMatchObject({ status: 'no_items', consecutiveFailures: 1 });
  });

  test('테이블 없음 → 상태 skipped_no_table 로 실패 1', async () => {
    db({ insertError: { code: 'ER_NO_SUCH_TABLE' } });
    await captureFetchOutcome({ market: 'overseas', mode: 'ingest', ok: true, items: [item(1)], now: NOW });
    expect(statusOf()).toMatchObject({ status: 'skipped_no_table', fetched: 1, consecutiveFailures: 1 });
  });

  test('손상된 이전 상태는 0 에서 센다 · 상태 읽기 실패도 0 에서 센다', async () => {
    db({ statusValue: '{not json' });
    await captureFetchOutcome({ market: 'domestic', mode: 'peek', ok: false, assumeEnabled: true, now: NOW });
    expect(statusOf()).toMatchObject({ consecutiveFailures: 1 });
    mockQuery.mockReset();
    db({ statusReadError: new Error('read fail') });
    await captureFetchOutcome({ market: 'domestic', mode: 'peek', ok: false, assumeEnabled: true, now: NOW });
    expect(statusOf()).toMatchObject({ consecutiveFailures: 1 });
  });

  test('상태 쓰기 실패는 삼킨다(캡처 결과는 그대로)', async () => {
    db({ statusWriteError: new Error('write fail') });
    const r = await captureFetchOutcome({ market: 'domestic', mode: 'peek', ok: true, items: [item(1)], assumeEnabled: true, now: NOW });
    expect(r.capture?.status).toBe('ok');
    expect(r.status).toBeNull();
  });

  test('알 수 없는 시장·모드 → 아무것도 하지 않음(던지지 않음)', async () => {
    db();
    expect(await captureFetchOutcome({ market: 'kr' as never, mode: 'peek', ok: true, items: [] })).toEqual({ capture: null, status: null, deadline: 'ok' });
    expect(await captureFetchOutcome({ market: 'domestic', mode: 'x' as never, ok: true, items: [] })).toEqual({ capture: null, status: null, deadline: 'ok' });
    expect(calls()).toHaveLength(0);
  });

  test('getPool 이 던져도 던지지 않는다', async () => {
    mockPoolThrows = new Error('fatal');
    await expect(captureFetchOutcome({ market: 'domestic', mode: 'peek', ok: true, items: [item(1)], assumeEnabled: true })).resolves.toBeDefined();
  });

  test('recordCaptureStatus — skipped_disabled 는 기록하지 않음', async () => {
    db();
    expect(await recordCaptureStatus('domestic', { mode: 'peek', status: 'skipped_disabled', fetched: 0, inserted: 0, duplicates: 0, rejected: 0 })).toBeNull();
    expect(calls()).toHaveLength(0);
  });
});

describe('(Leader 결정 Q1) guid 열 — DDL·INSERT 일치, 저장 규칙', () => {
  const ddl = fs.readFileSync(path.resolve(__dirname, '../../../../scripts/migrations/T-116-ci-raw-item.sql'), 'utf8');
  const ddlCols = [...ddl.matchAll(/^ {2}([a-z_0-9]+)\s+(?:BIGINT|ENUM|VARCHAR|INT|CHAR|DATETIME|TEXT)\b/gm)].map((m) => m[1]);
  const insertCols = /INSERT INTO ci_raw_item \(([^)]*)\)/.exec(CI_RAW_ITEM_UPSERT_SQL)![1].split(',').map((x) => x.trim());

  test('🔴 DDL 에 guid VARCHAR(300) NULL 이 url 바로 뒤에 있다', () => {
    expect(ddl).toMatch(/^ {2}guid {11}VARCHAR\(300\) NULL,/m);
    expect(ddlCols.indexOf('guid')).toBe(ddlCols.indexOf('url') + 1);
  });

  test('🔴 INSERT 열은 전부 DDL 에 있고 guid 를 포함한다(url 바로 뒤) · 값 개수 = 열 개수', async () => {
    for (const c of insertCols) expect(ddlCols).toContain(c);
    expect(insertCols).toContain('guid');
    expect(insertCols.indexOf('guid')).toBe(insertCols.indexOf('url') + 1);
    db();
    await captureNewsItems('domestic', [item(1)], { now: NOW, assumeEnabled: true });
    expect(rowsOf()[0]).toHaveLength(insertCols.length);
  });

  test('guid 가 그 열에 저장된다', async () => {
    db();
    await captureNewsItems('domestic', [item(1, { guid: 'urn:yna:AKR1' })], { now: NOW, assumeEnabled: true });
    expect(rowsOf()[0][insertCols.indexOf('guid')]).toBe('urn:yna:AKR1');
  });

  test('🔴 링크가 버려져도(IP 리터럴) guid 는 저장된다', async () => {
    db();
    const r = await captureNewsItems('domestic', [item(1, { link: 'http://10.0.0.1/x', guid: 'urn:yna:AKR9' })], { now: NOW, assumeEnabled: true });
    expect(r.rejected).toBe(1);
    const row = rowsOf()[0];
    expect(row[insertCols.indexOf('url')]).toBeNull();
    expect(row[insertCols.indexOf('guid')]).toBe('urn:yna:AKR9');
  });

  test('guid 없는 항목은 NULL · 금지 문자 든 guid 도 NULL(링크는 남음)', async () => {
    db();
    await captureNewsItems('domestic', [item(1, { guid: null }), item(2, { guid: `g${ch(0x200b)}2` })], { now: NOW, assumeEnabled: true });
    const gi = insertCols.indexOf('guid');
    expect(rowsOf().map((r) => r[gi])).toEqual([null, null]);
    expect(rowsOf().map((r) => r[insertCols.indexOf('url')])).toEqual([item(1).link, item(2).link]);
  });
});

describe('(Leader 결정 Q8) 캡처 전체 4초 — 스위치·INSERT·상태 기록이 마감 하나를 공유', () => {
  /** SQL 별 지연(ms)을 주는 가짜 풀 — 가짜 타이머로 흘린다. */
  function slowDb(delay: { switch?: number; insert?: number; statusRead?: number; statusWrite?: number; feedCheck?: number }) {
    const later = <T>(ms: number | undefined, v: T) => (ms ? new Promise<T>((res) => setTimeout(() => res(v), ms)) : Promise.resolve(v));
    mockQuery.mockImplementation((sql: string, params: unknown[]) => {
      if (sql.startsWith('SELECT value FROM system_config')) {
        return params[0] === 'ci_capture_enabled' ? later(delay.switch, [[{ value: true }]]) : later(delay.statusRead, [[]]);
      }
      if (sql === CI_FEED_PREV_NEWEST_SQL) return later(delay.feedCheck, [[]]);   // (T-118) 겹침 검사 조회
      if (sql === CI_RAW_ITEM_UPSERT_SQL) return later(delay.insert, [{ affectedRows: 1, info: '' }]);
      return later(delay.statusWrite, [{ affectedRows: 1 }]);
    });
  }
  /** captureFetchOutcome 을 돌리고 끝난 시각(가짜 시계 ms)을 잰다. */
  async function timed(input: Parameters<typeof captureFetchOutcome>[0]) {
    const t0 = Date.now();
    let doneAt = -1;
    const p = captureFetchOutcome(input).then((r) => { doneAt = Date.now() - t0; return r; });
    await jest.advanceTimersByTimeAsync(20_000);
    return { r: await p, ms: doneAt };
  }

  test('상수 — 캡처·상태 상한 모두 4초(8초 아님)', () => {
    expect(CI_CAPTURE_TIMEOUT_MS).toBe(4000);
    expect(CI_STATUS_TIMEOUT_MS).toBe(4000);
    expect(Object.keys(jest.requireActual('../raw-capture'))).not.toContain('CI_CAPTURE_TOTAL_TIMEOUT_MS');
  });

  test('🔴 정상 경로 — 각 단계가 빨리 끝나면 4초 안에 끝나고 건너뛴 것 없음(deadline ok)', async () => {
    jest.useFakeTimers();
    slowDb({ switch: 300, insert: 500, statusRead: 200, statusWrite: 200 });
    const { r, ms } = await timed({ market: 'domestic', mode: 'ingest', ok: true, items: [item(1)], now: NOW });
    expect(ms).toBe(1200);
    expect(r.deadline).toBe('ok');
    expect(r.capture).toEqual({ status: 'ok', inserted: 1, duplicates: 0, rejected: 0 });
    expect(r.status).toMatchObject({ status: 'ok', consecutiveFailures: 0 });
  });

  test('🔴 마감 공유 — 스위치 3초 + INSERT 2초면 INSERT 는 남은 1초만 기다려 4초에 끝난다(5초 아님), 저장 failed(deadline)·상태 건너뜀', async () => {
    jest.useFakeTimers();
    slowDb({ switch: 3000, insert: 2000 });
    const { r, ms } = await timed({ market: 'overseas', mode: 'peek', ok: true, items: [item(1)], now: NOW });
    expect(ms).toBe(4000);
    expect(r.capture).toEqual({ status: 'failed', inserted: 0, duplicates: 0, rejected: 0, reason: 'deadline' });
    expect(r.deadline).toBe('insert_skipped');
    expect(r.status).toBeNull();
    expect(statusWrites()).toHaveLength(0);
  });

  test('🔴 마감 초과면 다음 단계를 건너뜀 — 스위치 읽기가 마감까지 끝나지 않으면 INSERT·상태 쿼리를 보내지 않는다', async () => {
    jest.useFakeTimers();
    slowDb({ switch: 4500 });
    const { r, ms } = await timed({ market: 'domestic', mode: 'peek', ok: true, items: [item(1)], now: NOW });
    expect(ms).toBe(4000);
    expect(r.capture?.status).toBe('skipped_disabled');   // 켜졌는지 모르면 쓰지 않는다
    expect(upserts()).toHaveLength(0);
    expect(statusWrites()).toHaveLength(0);
  });

  test('🔴 INSERT 가 마감 직전(3.9초)에 끝나면 상태 기록은 남은 0.1초만 — 넘으면 건너뛰고 deadline status_skipped(partial)', async () => {
    jest.useFakeTimers();
    slowDb({ insert: 3900, statusRead: 500 });
    const { r, ms } = await timed({ market: 'domestic', mode: 'peek', ok: true, items: [item(1)], assumeEnabled: true, now: NOW });
    expect(ms).toBe(4000);
    expect(r.capture).toEqual({ status: 'ok', inserted: 1, duplicates: 0, rejected: 0 });
    expect(r.deadline).toBe('status_skipped');
    expect(r.status).toBeNull();
    expect(statusWrites()).toHaveLength(0);
  });

  test('🔴 남은 시간이 0 이면 INSERT 쿼리 자체를 보내지 않는다(captureNewsItems 에 지난 마감)', async () => {
    db();
    const r = await captureNewsItems('domestic', [item(1)], { assumeEnabled: true, deadline: Date.now() - 1 });
    expect(r).toEqual({ status: 'failed', inserted: 0, duplicates: 0, rejected: 0, reason: 'deadline' });
    expect(calls()).toHaveLength(0);
  });

  test('남은 시간이 0 이면 상태 기록도 DB 를 건드리지 않는다 · 스위치 읽기도 마감이 지났으면 쿼리 없이 timeout', async () => {
    db();
    expect(await recordCaptureStatus('domestic', { mode: 'peek', status: 'ok', fetched: 1, inserted: 1, duplicates: 0, rejected: 0 }, Date.now() - 1)).toBeNull();
    expect(await readCaptureSwitch(Date.now() - 1)).toEqual({ enabled: false, source: 'timeout' });
    expect(calls()).toHaveLength(0);
  });

  test('M4 실패 경로도 같은 마감 — 스위치 3.5초 + 상태 읽기 1초면 상태 기록을 건너뛰고 4초에 끝난다', async () => {
    jest.useFakeTimers();
    slowDb({ switch: 3500, statusRead: 1000 });
    const { r, ms } = await timed({ market: 'domestic', mode: 'peek', ok: false, now: NOW });
    expect(ms).toBe(4000);
    expect(r.deadline).toBe('status_skipped');
    expect(statusWrites()).toHaveLength(0);
  });
});
