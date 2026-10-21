/**
 * /api/cron/post-market-analysis — T-062 S-2·S-3: **해외 결과가 ok:false 일 때만** 비-200. 국내 응답은 그대로 항상 200.
 * SAFETY_PATHS(`^src/app/api/cron/`) 대상.
 */
import { NextResponse, type NextRequest } from 'next/server';

const authMock = jest.fn<NextResponse | undefined, unknown[]>();
const runMock = jest.fn();
jest.mock('@/lib/cron-auth', () => ({ checkCronAuth: (...a: unknown[]) => authMock(...a) }));
jest.mock('@/lib/strategy/post-market-engine', () => ({ runPostMarketAnalysis: (...a: unknown[]) => runMock(...a) }));

const req = (market?: string) =>
  ({ nextUrl: new URL(`http://localhost/api/cron/post-market-analysis${market ? `?market=${market}` : ''}`) }) as unknown as NextRequest;
const load = () => import('../post-market-analysis/route');

beforeEach(() => {
  authMock.mockReset(); runMock.mockReset();
  authMock.mockReturnValue(undefined);
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

const DOMESTIC = { market: 'domestic', symbolsEvaluated: 4, candidatesFound: 3, signalsCreated: 1, signalsSkipped: 5, errors: [], validFrom: '2026-10-19 09:00:00', duplicatesSkipped: 1, unaffordableSkipped: 1 };

test('🔴 인증 실패면 본체를 실행하지 않고 401', async () => {
  authMock.mockReturnValue(NextResponse.json({ ok: false }, { status: 401 }));
  const { POST } = await load();
  expect((await POST(req('overseas'))).status).toBe(401);
  expect(runMock).not.toHaveBeenCalled();
});

test('market 값이 이상하면 400', async () => {
  const { POST } = await load();
  expect((await POST(req('crypto'))).status).toBe(400);
});

test('🔴 국내: 응답 형태 불변 — 200 + { ok:true, ...result } (market 미지정 = 국내)', async () => {
  runMock.mockResolvedValue(DOMESTIC);
  const { POST } = await load();
  const res = await POST(req());
  expect(runMock).toHaveBeenCalledWith('domestic');
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true, ...DOMESTIC });
});

test('국내: 결과에 ok:false 가 섞여 와도(국내 엔진은 싣지 않는다) 기존대로 200', async () => {
  runMock.mockResolvedValue({ ...DOMESTIC, errors: ['ai_fail:x'], ok: false, status: 'ai_fail' });
  const { POST } = await load();
  expect((await POST(req('domestic'))).status).toBe(200);
});

test.each([
  ['스위치 꺼짐', 200, { market: 'overseas', ok: true, status: 'ok', skipped: 'overseas_disabled' }],
  ['정상', 200, { market: 'overseas', ok: true, status: 'ok', signalsCreated: 1 }],
  ['정상 0건', 200, { market: 'overseas', ok: true, status: 'ok', signalsCreated: 0 }],
  ['🔴 AI 응답 해석 실패', 502, { market: 'overseas', ok: false, status: 'ai_parse_fail', errors: ['ai_parse_fail:json_parse'] }],
  ['🔴 LLM 호출 실패', 502, { market: 'overseas', ok: false, status: 'ai_fail', errors: ['ai_fail:timeout'] }],
  ['🔴 카드 저장 실패(전부 ROLLBACK)', 500, { market: 'overseas', ok: false, status: 'insert_fail', errors: ['insert_fail:deadlock'] }],
  ['🔴 휴장 표 모름', 503, { market: 'overseas', ok: false, status: 'data_unknown', skipped: 'holidays_unknown' }],
  ['🔴 환율 모름', 503, { market: 'overseas', ok: false, status: 'data_unknown', skipped: 'fx_unknown' }],
  ['🔴 환율 전후 불일치', 503, { market: 'overseas', ok: false, status: 'data_unknown', skipped: 'fx_inconsistent' }],
  ['🔴 실적 일정 모름', 503, { market: 'overseas', ok: false, status: 'data_unknown', skipped: 'earnings_unknown' }],
  ['🔴 일봉 전부 조회 실패(KIS 장애)', 503, { market: 'overseas', ok: false, status: 'data_unknown', skipped: 'candles_unavailable' }],
  ['🔴 환산 스케일 의심(KRW 종가 < R×$1)', 503, { market: 'overseas', ok: false, status: 'data_unknown', skipped: 'candle_scale_suspect' }],
  ['🔴 같은 세션 분석 진행 중(single-flight)', 503, { market: 'overseas', ok: false, status: 'in_progress' }],
  ['새 세션 없음(주말·휴장)', 200, { market: 'overseas', ok: true, status: 'ok', skipped: 'no_new_session' }],
  ['정규장 진행 중', 200, { market: 'overseas', ok: true, status: 'ok', skipped: 'us_session_open' }],
])('해외 %s → HTTP %s', async (_n, code, result) => {
  runMock.mockResolvedValue({ symbolsEvaluated: 0, candidatesFound: 0, signalsSkipped: 0, validFrom: '', errors: [], ...result });
  const { POST } = await load();
  const res = await POST(req('overseas'));
  expect(res.status).toBe(code);
  expect((await res.json()).ok).toBe(code === 200);
});

test('본체 예외는 500', async () => {
  runMock.mockRejectedValue(new Error('boom'));
  const { POST } = await load();
  const res = await POST(req('overseas'));
  expect(res.status).toBe(500);
  expect(await res.json()).toEqual({ ok: false, error: 'boom' });
});
