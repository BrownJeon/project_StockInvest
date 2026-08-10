/**
 * T-017 reviewer HIGH-1 회귀 방지 — **`strategy-eval` 은 안전 경로를 강등하지 않는다.**
 *
 * ## 무엇이 잘못됐었나
 *
 * "전략 평가 틱은 가장 무거우니 통째로 `bulk`" 라는 판단으로 라우트가 `runAll` 전체를
 * `withKisPriority('bulk')` 로 감쌌다. 그런데 `runAll` 안의 **무거운 배치는 이미 자기
 * 함수에서 스스로 `bulk` 를 선언**한다(`refreshUniverse`, `updateRsRatings`).
 * 따라서 그 래퍼가 실제로 강등시킨 대상은 배치가 아니라 안전 경로뿐이었다:
 *
 *  - `getHeldAmounts()` — T-014 가 "모름을 0으로 읽지 않게" 굳힌 잔고 조회
 *  - `runExitEngine()`  — 하드손절·EOD손절·트레일링스탑 발화 판단
 *
 * ## 왜 "지금 exit-engine 이 꺼져 있다"가 변명이 안 되는가
 *
 * T-015 는 재활성화를 `system_config.exit_engine_enabled` **런타임 판독**으로 만들었다.
 * 값 하나만 바꾸면 배포 없이 즉시 살아나므로, 이 결함을 걸러낼 배포 게이트가 **없다.**
 * 보호를 되살렸다고 믿는 그 순간에 손절 평가가 최하위 lane 에서 돌게 된다.
 * 그래서 이 테스트는 exit-engine 의 on/off 와 **무관하게** lane 을 고정한다.
 */
const runAllMock = jest.fn();

jest.mock('@/lib/strategy/engine', () => ({
  runAll: (...a: unknown[]) => runAllMock(...a),
}));
jest.mock('@/lib/safety/order-sync', () => ({
  syncPendingOrders: jest.fn(async () => ({ synced: 0, errors: [] })),
}));
jest.mock('@/lib/cron-auth', () => ({
  checkCronAuth: jest.fn(() => null),
}));

import { POST } from '@/app/api/cron/strategy-eval/route';
import { currentKisPriority, withKisPriority } from '@/lib/exchanges/kis-throttle';
import { NextRequest } from 'next/server';

const EMPTY_RESULT = {
  ran: 0, skipped: 0, skippedStrategyIds: [], results: [], errors: [], universeRefreshed: false,
};

const req = () => new NextRequest('http://localhost:3003/api/cron/strategy-eval', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: '{}',
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('strategy-eval 라우트의 KIS lane', () => {
  it('🔑 runAll 은 `bulk` 가 아닌 lane 에서 실행된다 (손절·잔고 조회 강등 금지)', async () => {
    let laneInsideRunAll: string | undefined;
    runAllMock.mockImplementation(async () => {
      laneInsideRunAll = currentKisPriority();
      return EMPTY_RESULT;
    });

    await POST(req());

    expect(laneInsideRunAll).toBe('normal');
    expect(laneInsideRunAll).not.toBe('bulk');
  });

  it('배치 작업은 여전히 자기 함수 안에서 bulk 를 선언할 수 있다 (잃는 것이 없음)', async () => {
    // refreshUniverse/updateRsRatings 가 하는 것과 같은 모양.
    let laneInsideBatch: string | undefined;
    runAllMock.mockImplementation(async () => {
      await withKisPriority('bulk', async () => { laneInsideBatch = currentKisPriority(); });
      return EMPTY_RESULT;
    });

    await POST(req());

    expect(laneInsideBatch).toBe('bulk');
  });

  it('정상 응답 형태는 그대로다', async () => {
    runAllMock.mockResolvedValue({ ...EMPTY_RESULT, ran: 7 });
    const res = await POST(req());
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true, ran: 7 });
  });
});
