/**
 * PATCH /api/settings/safety — 열거형 설정 값 검증 (2026-08-06).
 *
 * UI `<select>` 는 4개 값으로 제한하지만 PATCH 는 아무 문자열이나 받아 그대로 저장했다.
 * `report_trade_channel` 이 손상되면 /api/cron/trade-report 가 전송 대상 채널 0개 상태로
 * 빠져 **아무것도 안 보내고 정상 종료**한다 — 흔적 없는 리포트 유실.
 * 라우트 쪽 방어 게이트와 별개로, 손상된 값이 애초에 써지지 못하게 막는다.
 */
import type { NextRequest } from 'next/server';

const writes: { key: string; value: string }[] = [];

jest.mock('@/lib/db', () => ({
  getPool: () => ({
    query: async (sql: string, params?: unknown[]) => {
      if (/INSERT INTO system_config/i.test(sql)) {
        const [key, value] = params as [string, string];
        writes.push({ key, value });
      }
      return [[]];
    },
  }),
}));
jest.mock('@/lib/safety/dry-run', () => ({ isDryRun: async () => true }));
jest.mock('@/lib/signals/router', () => ({ syncEngineSwitchesFromLegacy: async () => undefined }));

import { PATCH } from '@/app/api/settings/safety/route';

function makeReq(body: Record<string, unknown>): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

const wrote = (key: string) => writes.filter(w => w.key === key);

beforeEach(() => { writes.length = 0; });

describe('reportChannel 검증', () => {
  test.each(['slack', 'telegram', 'both', 'none'])('허용 값 %p 는 저장된다', async (ch) => {
    const res = await PATCH(makeReq({ reportChannel: ch }));
    expect(res.status).toBe(200);
    expect(wrote('report_trade_channel')).toEqual([{ key: 'report_trade_channel', value: JSON.stringify(ch) }]);
  });

  test.each(['sms', '', 'BOTH', 'slack,telegram', 'none ', 'kakao'])(
    '허용 밖 값 %p 는 400 으로 거절하고 아무것도 쓰지 않는다',
    async (bad) => {
      const res = await PATCH(makeReq({ reportChannel: bad }));
      expect(res.status).toBe(400);
      const body = await res.json() as { ok: boolean; error: string };
      expect(body.ok).toBe(false);
      expect(body.error).toContain('reportChannel');
      expect(body.error).toContain('slack|telegram|both|none');
      expect(writes).toHaveLength(0);
    },
  );
});

describe('reportMode 검증', () => {
  test.each(['rolling', 'fixed'])('허용 값 %p 는 저장된다', async (mode) => {
    const res = await PATCH(makeReq({ reportMode: mode }));
    expect(res.status).toBe(200);
    expect(wrote('report_trade_mode')).toHaveLength(1);
  });

  test('허용 밖 값은 400', async () => {
    const res = await PATCH(makeReq({ reportMode: 'anchor' }));
    expect(res.status).toBe(400);
    expect(writes).toHaveLength(0);
  });
});

describe('원자성 — 부분 반영 상태를 남기지 않는다', () => {
  test('같은 요청의 유효 필드도 함께 거절된다', async () => {
    const res = await PATCH(makeReq({ reportEnabled: true, reportIntervalMin: 60, reportChannel: 'sms' }));
    expect(res.status).toBe(400);
    expect(writes).toHaveLength(0);            // reportEnabled·IntervalMin 도 저장되지 않음
  });

  test('두 필드가 모두 잘못되면 둘 다 오류 메시지에 담긴다', async () => {
    const res = await PATCH(makeReq({ reportChannel: 'sms', reportMode: 'anchor' }));
    const body = await res.json() as { error: string };
    expect(body.error).toContain('reportChannel');
    expect(body.error).toContain('reportMode');
  });
});

describe('검증 대상이 아닌 필드는 기존 동작 유지', () => {
  test('열거형 필드를 보내지 않으면 검증에 걸리지 않는다', async () => {
    const res = await PATCH(makeReq({ reportEnabled: true, reportAnchorKst: '08:00' }));
    expect(res.status).toBe(200);
    expect(wrote('report_trade_enabled')).toHaveLength(1);
    expect(wrote('report_trade_anchor_kst')).toHaveLength(1);
  });

  test('허용 키 목록에 없는 필드는 무시된다 (기존 화이트리스트 동작)', async () => {
    const res = await PATCH(makeReq({ someUnknownField: 'x' }));
    expect(res.status).toBe(200);
    expect(writes).toHaveLength(0);
  });
});
