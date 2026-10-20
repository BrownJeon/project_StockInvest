/**
 * T-056 — 거래 리포트의 현재 총자산을 모르면 "조회 불가"로 적는다.
 * 예전 호출부는 `getPortfolioTotalKRW(true).catch(() => 0)` 이라 "총 자산 ₩0 (…, -100.00%)" 이 발송될 수 있었다.
 */
import { buildTradeReport, formatReportMessage } from '../trade-report';

const T0 = new Date('2026-10-20T00:00:00Z').getTime();
const build = () => buildTradeReport({
  rangeStart: new Date(T0), rangeEnd: new Date(T0 + 3 * 3600_000), totalKRW: null, baselineKRW: 20_000_000, rows: [],
});

test('🔴 totalKRW=null → "조회 불가", 0원·-100% 를 적지 않는다', async () => {
  const msg = formatReportMessage(await build(), null, 20_000_000);
  expect(msg).toContain('총 자산: 조회 불가');
  expect(msg).toContain('기간 시작 ₩20,000,000');
  expect(msg).not.toContain('-100.00%');
  expect(msg).not.toMatch(/총 자산: ₩0/);
});

test('totalKRW=null + 기준선 없음 → 조회 불가만', async () => {
  const msg = formatReportMessage(await build(), null, null);
  expect(msg).toContain('총 자산: 조회 불가');
  expect(msg).not.toContain('기간 시작');
});

test('totalKRW 숫자 → 기존 형식 그대로', async () => {
  const msg = formatReportMessage(await build(), 21_000_000, 20_000_000);
  expect(msg).toMatch(/총 자산: ₩21,000,000/);
  expect(msg).toContain('+5.00%');
});
