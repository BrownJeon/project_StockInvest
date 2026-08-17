/**
 * T-029 — `POST /api/signals/custom` 의 `currentPrice` 수치 가드.
 *
 * Leader 지시 6항("confirm 이전 단계도 같은 클래스인지 조사") 결과 **같은 클래스였다.**
 * 이 라우트는 DB 에 쓰지 않지만, 반환하는 `aiSuggestedScenario.entry.price_zone` 이
 * `POST /api/signals/custom/confirm` 의 `scenario` 로 실려 가고, 거기서 그 문자열은
 * **confirm 의 수치 가드가 닿지 않는 유일한 가격 원천**이다.
 */
jest.mock('@/lib/exchanges/kis', () => ({
  kis: {
    getCandles: jest.fn(async () => []),
    getTicker: jest.fn(async () => ({ price: 70000 })),
  },
}));
jest.mock('@/lib/llm/provider', () => ({
  runLlm: jest.fn(),
  getActiveProvider: jest.fn(async () => null),
}));

import { POST } from '../route';

function req(body: unknown) {
  return new Request('http://x/api/signals/custom', { method: 'POST', body: JSON.stringify(body) });
}

/** `src/app/recommend/build/page.tsx:42` 가 실제로 보내는 형태. */
function buildPagePayload(over: Record<string, unknown> = {}) {
  return {
    market: 'domestic',
    symbol: '005930',
    direction: 'buy',
    currentPrice: 70000,
    splits: 2,
    holdingDeadline: '2026-08-21',
    ...over,
  };
}

beforeEach(() => jest.clearAllMocks());

describe('POST /api/signals/custom — 과도차단 회귀 방지', () => {
  test('UI 호출자 페이로드는 그대로 200', async () => {
    const res = await POST(req(buildPagePayload()));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true });
  });

  test('currentPrice 미지정 → ticker 폴백 경로가 유지된다', async () => {
    const body = buildPagePayload() as Record<string, unknown>;
    delete body.currentPrice;

    const res = await POST(req(body));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true, currentPrice: 70000 });
  });

  test('currentPrice: null 도 "미지정"으로 통과한다', async () => {
    const res = await POST(req(buildPagePayload({ currentPrice: null })));

    expect(res.status).toBe(200);
  });

  test('currentPrice 0 은 통과한다', async () => {
    const res = await POST(req(buildPagePayload({ currentPrice: 0 })));

    expect(res.status).toBe(200);
  });

  test('정상 값의 price_zone 은 현재가 근처의 정상 구간이다', async () => {
    const res = await POST(req(buildPagePayload()));
    const data = await res.json();

    const [lo, hi] = String(data.aiSuggestedScenario.entry.price_zone).split('~').map(Number);
    expect(lo).toBeGreaterThan(69000);
    expect(hi).toBeLessThan(71000);
  });
});

describe('POST /api/signals/custom — 문자열 currentPrice 가드 (T-029)', () => {
  test('가드가 없으면 만들어졌을 오염 구간 — 사실 고정', () => {
    const cp = '70000' as unknown as number;
    const aiDelta = Math.round(cp * 0.003);     // `*` 는 강제변환된다 → 210

    expect(Math.round(cp - aiDelta)).toBe(69790);      // `-` 도 강제변환
    expect(Math.round(cp + aiDelta)).toBe(70000210);   // 🔴 `+` 는 연결이다
  });

  test.each([['70000'], ['abc'], [true], [{ v: 1 }], [[70000]]])(
    'currentPrice=%p → 400',
    async (value) => {
      const res = await POST(req(buildPagePayload({ currentPrice: value })));

      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toMatchObject({
        ok: false, error: 'currentPrice must be a finite number',
      });
    },
  );

  test('거절은 console.warn 으로 흔적을 남긴다 (DB 행이 없는 라우트다)', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await POST(req(buildPagePayload({ currentPrice: '70000' })));

      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain('api/signals/custom POST');
      expect(warn.mock.calls[0][0]).toContain('005930');
    } finally {
      warn.mockRestore();
    }
  });

  test('required 누락은 여전히 기존 문구로 400 — 수치 가드가 앞지르지 않는다', async () => {
    const res = await POST(req({ symbol: '', direction: 'buy', currentPrice: 'abc' }));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: 'symbol/direction required' });
  });
});
