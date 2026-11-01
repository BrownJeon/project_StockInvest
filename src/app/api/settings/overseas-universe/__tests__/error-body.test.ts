/**
 * T-143 QA low-1 — **500 응답 본문에 오류 원문이 실리지 않는다.**
 *
 * 왜 시험으로 고정하나: `errText(e)`·`store` 의 `error` 에는 mysql2 메시지가 담겨 **DB 호스트·포트·사용자 이름**이
 * 섞일 수 있다(`connect ECONNREFUSED 192.168.0.5:3306`). 인증된 사용자만 보더라도 응답 본문은 브라우저
 * 개발자 도구·확장·프록시 로그에 남는다. 이 시험이 없으면 다음에 누가 「디버깅 편하게」 원문을 다시 싣는다.
 *
 * 함께 고정하는 것:
 *  - **원문은 `console.error` 로 간다**(로그에서는 볼 수 있어야 진단이 된다).
 *  - **400 의 사용자 문구는 그대로 둔다** — 그 값은 `store.ts` 가 직접 쓴 한국어 안내이고 내부 정보가 없다.
 *  - 저장 실패/저장됨 2갈래(Designer 확정)는 **화면 상수**(`view.ts`)가 쓰므로 이 변경에 영향받지 않는다.
 */
const mockReplace = jest.fn();
const mockAct = jest.fn();
const mockRead = jest.fn();

jest.mock('@/lib/universe/store', () => ({
  readUniverseScreen: (...a: unknown[]) => mockRead(...a),
  replaceManualList: (...a: unknown[]) => mockReplace(...a),
  actOnProposal: (...a: unknown[]) => mockAct(...a),
}));
jest.mock('@/lib/universe/actor', () => ({ actorLabel: async () => 'web' }));

import { GET } from '../route';
import { PUT } from '../manual/route';
import { POST } from '../proposals/[id]/route';

/** mysql2 가 실제로 내는 모양 — 호스트·포트가 들어 있다 */
const RAW = "connect ECONNREFUSED 192.168.0.5:3306 (user 'stockinvest'@'10.0.0.9')";

/** 본문에 내부 정보가 섞이지 않았는지 — 한 군데서 본다 */
function expectNoInternals(text: string) {
  expect(text).not.toContain('192.168.0.5');
  expect(text).not.toContain('3306');
  expect(text).not.toContain('ECONNREFUSED');
  expect(text).not.toContain('stockinvest');
  expect(text).not.toContain('10.0.0.9');
}

function req(body: unknown): Parameters<typeof PUT>[0] {
  return {
    async json() { return body; },
    cookies: { get: () => undefined },
  } as unknown as Parameters<typeof PUT>[0];
}

let errSpy: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => { errSpy.mockRestore(); });

describe('🔴 500 본문은 분류어만 — 원문은 로그로만', () => {
  it('PUT /manual — store 가 error 를 돌려줘도 본문에 원문이 없다', async () => {
    mockReplace.mockResolvedValue({ kind: 'error', error: RAW });
    const res = await PUT(req({ symbols: ['NAS:AAAA'], baseVersion: 0 }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ ok: false, error: 'internal_error' });
    expectNoInternals(JSON.stringify(body));
    // 원문은 로그로 간다(진단 가능성을 잃지 않는다)
    expect(errSpy.mock.calls.flat().join(' ')).toContain('ECONNREFUSED');
  });

  it('PUT /manual — 예기치 못한 예외도 같다', async () => {
    mockReplace.mockRejectedValue(new Error(RAW));
    const res = await PUT(req({ symbols: ['NAS:AAAA'], baseVersion: 0 }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ ok: false, error: 'internal_error' });
    expect(errSpy.mock.calls.flat().join(' ')).toContain('ECONNREFUSED');
  });

  it('POST /proposals/[id] — store error·예외 둘 다', async () => {
    const ctx = { params: Promise.resolve({ id: '7' }) };
    mockAct.mockResolvedValue({ kind: 'error', error: RAW });
    const a = await POST(req({ do: 'act', baseState: 'open' }), ctx);
    expect(a.status).toBe(500);
    expect(await a.json()).toEqual({ ok: false, error: 'internal_error' });

    mockAct.mockRejectedValue(new Error(RAW));
    const b = await POST(req({ do: 'act', baseState: 'open' }), { params: Promise.resolve({ id: '7' }) });
    expect(b.status).toBe(500);
    expect(await b.json()).toEqual({ ok: false, error: 'internal_error' });
    expect(errSpy.mock.calls.flat().join(' ')).toContain('ECONNREFUSED');
  });

  it('GET — 전체 실패도 같다(이 응답은 화면이 조회 오류로 받는다)', async () => {
    mockRead.mockRejectedValue(new Error(RAW));
    const res = await GET();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ ok: false, error: 'internal_error' });
    expectNoInternals(JSON.stringify(body));
  });
});

describe('바꾸지 않은 것 — 사용자 문구와 분류어는 그대로다', () => {
  it('400 의 한국어 안내는 유지된다(내부 정보가 없는 직접 쓴 문구다)', async () => {
    mockAct.mockResolvedValue({ kind: 'bad_request', error: '제안 id 가 올바르지 않습니다' });
    const res = await POST(req({ do: 'act', baseState: 'open' }), { params: Promise.resolve({ id: 'x' }) });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('제안 id 가 올바르지 않습니다');
  });

  it('503 not_migrated · 409 충돌 코드는 그대로다(화면이 「준비 중」·「이미 처리됨」을 가르는 값이다)', async () => {
    mockReplace.mockResolvedValue({ kind: 'not_migrated' });
    const a = await PUT(req({ symbols: [], baseVersion: 0 }));
    expect(a.status).toBe(503);
    expect(await a.json()).toMatchObject({ error: 'not_migrated', code: 'not_migrated' });

    mockReplace.mockResolvedValue({ kind: 'conflict', version: 3, summary: null });
    const b = await PUT(req({ symbols: [], baseVersion: 0 }));
    expect(b.status).toBe(409);
    expect(await b.json()).toMatchObject({ code: 'version_changed' });
  });

  it('저장은 됐고 조회만 실패한 경우는 **200** 이다(500 으로 섞이지 않는다 — Designer 2갈래 유지)', async () => {
    mockReplace.mockResolvedValue({ kind: 'saved_unreadable', version: 2, applied: { added: 1, removed: 0, kept: 0 } });
    const res = await PUT(req({ symbols: ['NAS:AAAA'], baseVersion: 1 }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, warning: 'summary_unavailable', data: { summary: null } });
  });
});
