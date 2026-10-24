/**
 * T-074 WP-B — 쓰기 응답 판정(WP-A 응답 규약)·요청 래퍼(시간 초과·네트워크)·중복 제출 방지·조회 래퍼.
 */
import { classifyWrite, createSubmitter, sendJson, urls, write } from '@/components/ledger/actions';
import { fetchLedgerFeed, isNotMigrated, loadErrorText } from '@/components/ledger/useLedgerFeed';
import { feedOf } from './fixtures';

const feed = feedOf();

describe('classifyWrite — 응답 → 시트 상태', () => {
  test('200 ok', () => {
    expect(classifyWrite(200, { ok: true, data: feed }, false)).toEqual({ kind: 'ok', body: { ok: true, data: feed } });
  });
  test('200 이어도 본문 ok:false 면 성공이 아니다', () => {
    expect(classifyWrite(200, { ok: false, error: 'x' }, false).kind).toBe('fail');
  });
  test('409 duplicate → dup(existingId) · baseline_version → baseConflict(latest.version) · version → versionConflict(latest·data)', () => {
    expect(classifyWrite(409, { ok: false, code: 'duplicate', error: 'd', existingId: 5 }, false)).toEqual({ kind: 'dup', existingId: 5, message: 'd' });
    expect(classifyWrite(409, { ok: false, code: 'baseline_version', error: 'b', latest: { version: 4 } }, false)).toEqual({ kind: 'baseConflict', latestVersion: 4, message: 'b' });
    expect(classifyWrite(409, { ok: false, code: 'version', error: 'v', latest: { version: 9 }, data: feed }, false)).toMatchObject({ kind: 'versionConflict', data: feed, latest: { version: 9 } });
  });
  test('🔴 409 client_entry_conflict → clientConflict(existingId·data) — duplicate 와 구분', () => {
    expect(classifyWrite(409, { ok: false, code: 'client_entry_conflict', error: 'c', existingId: 7, data: feed }, false)).toEqual({ kind: 'clientConflict', existingId: 7, data: feed, message: 'c' });
    expect(classifyWrite(409, { ok: false, code: 'client_entry_conflict', error: 'c' }, false)).toEqual({ kind: 'clientConflict', existingId: null, data: null, message: 'c' });
  });
  test('409 already_voided·not_voided·already_handled·not_dismissed → handledElsewhere(data)', () => {
    for (const code of ['already_voided', 'not_voided', 'already_handled', 'not_dismissed']) {
      expect(classifyWrite(409, { ok: false, code, error: 'e', data: feed }, false)).toEqual({ kind: 'handledElsewhere', code, data: feed, message: 'e' });
    }
  });
  test('409 superseded·no_baseline · 404 → conflict', () => {
    expect(classifyWrite(409, { ok: false, code: 'superseded', error: 's' }, false)).toEqual({ kind: 'conflict', code: 'superseded', data: null, message: 's' });
    expect(classifyWrite(404, { ok: false, code: 'not_found', error: '기록을 찾을 수 없습니다' }, false)).toMatchObject({ kind: 'conflict', code: 'not_found' });
    expect(classifyWrite(404, null, false)).toMatchObject({ kind: 'conflict', message: '기록을 찾을 수 없습니다' });
  });
  test('422 → 첫 필드 오류 문장', () => {
    expect(classifyWrite(422, { ok: false, code: 'validation', error: 'top', fieldErrors: { occurredAt: { code: 'future', message: '아직 오지 않은 시각입니다.' } } }, false))
      .toEqual({ kind: 'invalid', message: '아직 오지 않은 시각입니다.' });
    expect(classifyWrite(422, { ok: false, code: 'validation', error: 'top' }, false)).toEqual({ kind: 'invalid', message: 'top' });
  });
  test('🔴 500·503(not_migrated)·401·400·네트워크·시간 초과 → fail(입력 유지)', () => {
    expect(classifyWrite(500, { ok: false, code: 'server_error', error: '서버 오류', retrySafe: true }, false)).toEqual({ kind: 'fail', reason: '서버 응답 500' });
    expect(classifyWrite(503, { ok: false, code: 'not_migrated', error: 'x' }, false)).toEqual({ kind: 'fail', reason: '서버 응답 503' });
    expect(classifyWrite(401, { ok: false, error: 'unauthorized' }, false)).toEqual({ kind: 'fail', reason: '서버 응답 401' });
    expect(classifyWrite(400, { ok: false, code: 'bad_request' }, false)).toEqual({ kind: 'fail', reason: '서버 응답 400' });
    expect(classifyWrite(0, null, false)).toEqual({ kind: 'fail', reason: '네트워크 오류로 요청하지 못했습니다' });
    expect(classifyWrite(0, null, true)).toEqual({ kind: 'fail', reason: '응답이 15초 안에 오지 않아 중단했습니다' });
  });
});

describe('sendJson·write — 요청 래퍼', () => {
  test('메서드·헤더·본문·no-store, JSON 본문 판정', async () => {
    const f = jest.fn(async () => ({ status: 200, json: async () => ({ ok: true, data: feed }) })) as unknown as typeof fetch;
    const out = await write('POST', urls.entries(), { a: 1 }, f);
    expect(out.kind).toBe('ok');
    const [url, init] = (f as unknown as jest.Mock).mock.calls[0];
    expect(url).toBe('/api/cash-ledger/entries');
    expect(init).toMatchObject({ method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: '{"a":1}' });
  });
  test('네트워크 예외 → status 0 · 비JSON 본문 → body null', async () => {
    const boom = jest.fn(async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    expect(await sendJson('PUT', '/x', {}, boom)).toEqual({ status: 0, body: null, timedOut: false });
    const html = jest.fn(async () => ({ status: 502, json: async () => { throw new Error('html'); } })) as unknown as typeof fetch;
    expect(await sendJson('PUT', '/x', {}, html)).toEqual({ status: 502, body: null, timedOut: false });
  });
  test('🔴 시간 초과 → 중단하고 timedOut', async () => {
    const hang = jest.fn((_u: string, init: { signal: AbortSignal }) => new Promise((_res, rej) => {
      init.signal.addEventListener('abort', () => rej(new Error('aborted')));
    })) as unknown as typeof fetch;
    const r = await sendJson('POST', '/x', {}, hang, 20);
    expect(r).toEqual({ status: 0, body: null, timedOut: true });
  });
  test('경로 — 후보 키는 인코딩', () => {
    expect(urls.correct(5)).toBe('/api/cash-ledger/entries/5/correct');
    expect(urls.cancel(5)).toBe('/api/cash-ledger/entries/5/cancel');
    expect(urls.restore(5)).toBe('/api/cash-ledger/entries/5/restore');
    expect(urls.baseline()).toBe('/api/cash-ledger/baseline');
    expect(urls.dismiss('1340-KRW')).toBe('/api/cash-ledger/candidates/1340-KRW/dismiss');
    expect(urls.reopen('a/b')).toBe('/api/cash-ledger/candidates/a%2Fb/reopen');
  });
});

describe('🔴 중복 제출 방지 — 응답을 기다리는 동안 다시 눌러도 요청은 한 번', () => {
  test('진행 중 두 번째 run 은 요청을 보내지 않고 null, 끝나면 다시 보낼 수 있다', async () => {
    const s = createSubmitter();
    let release!: (v: string) => void;
    const send = jest.fn(() => new Promise<string>((r) => { release = r; }));
    const first = s.run(send);
    expect(s.busy).toBe(true);
    expect(await s.run(send)).toBeNull();
    expect(send).toHaveBeenCalledTimes(1);
    release('ok');
    expect(await first).toBe('ok');
    expect(s.busy).toBe(false);
    const again = s.run(async () => 'second');
    expect(await again).toBe('second');
  });
  test('요청이 예외로 끝나도 잠금이 풀린다', async () => {
    const s = createSubmitter();
    await expect(s.run(async () => { throw new Error('x'); })).rejects.toThrow('x');
    expect(s.busy).toBe(false);
  });
});

describe('조회 — fetchLedgerFeed', () => {
  test('성공 · 🔴 마이그레이션 전 503 not_migrated → 오류 문장(서버 응답 503 — …)', async () => {
    const ok = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true, data: feed }) })) as unknown as typeof fetch;
    expect(await fetchLedgerFeed(ok)).toEqual({ ok: true, data: feed });
    const nm = jest.fn(async () => ({ ok: false, status: 503, json: async () => ({ ok: false, code: 'not_migrated', error: '입출금 원장 테이블이 아직 없습니다' }) })) as unknown as typeof fetch;
    expect(await fetchLedgerFeed(nm)).toEqual({ ok: false, error: '서버 응답 503 — 입출금 원장 테이블이 아직 없습니다', code: 'not_migrated' });
    const net = jest.fn(async () => { throw new Error('x'); }) as unknown as typeof fetch;
    expect(await fetchLedgerFeed(net)).toEqual({ ok: false, error: '네트워크 오류로 요청하지 못했습니다', code: null });
    expect(loadErrorText(500, null)).toBe('서버 응답 500');
  });
  test('🔴 준비 중 판정은 503 + not_migrated 둘 다일 때만 — 다른 원인의 503·다른 상태의 같은 코드는 일반 오류', async () => {
    const res = (status: number, body: unknown) => jest.fn(async () => ({ ok: false, status, json: async () => body })) as unknown as typeof fetch;
    expect(await fetchLedgerFeed(res(503, { ok: false, error: 'auth_not_configured', detail: 'x' }))).toMatchObject({ ok: false, code: null });
    expect(await fetchLedgerFeed(res(503, { ok: false, code: 'other_503', error: 'y' }))).toMatchObject({ ok: false, code: 'other_503' });
    expect(await fetchLedgerFeed(res(500, { ok: false, code: 'not_migrated', error: 'z' }))).toMatchObject({ ok: false, code: null });
    expect(isNotMigrated(503, 'not_migrated')).toBe(true);
    expect(isNotMigrated(503, 'server_error')).toBe(false);
    expect(isNotMigrated(500, 'not_migrated')).toBe(false);
  });
});
