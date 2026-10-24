/**
 * T-074 시험용 합성 데이터 도우미 — **실제 계좌 값이 아니다**(데모와 같은 합성값: 기준 2,000만원·환율 1,250 등).
 */
import type { SnapshotRowLike } from '../../snapshots';

export interface SnapSpec {
  krw?: number;
  locked?: number;
  /** 달러 예수금($). 생략하면 USD 행 없음 */
  usd?: number;
  fx?: number;
  /** 종목 → [수량, 원화 단가] */
  holdings?: Record<string, [number, number]>;
  /** 총액을 직접 지정(생략하면 원화 free + 달러×환율 + 보유 평가) */
  total?: number;
}

/** portfolio_snapshots 1행(문자열 ts = KST 벽시계 — mysql2 dateStrings 와 같은 모양) */
export function snapRow(id: number, ts: string, s: SnapSpec): SnapshotRowLike {
  const positions: Record<string, unknown>[] = [];
  let total = 0;
  if (s.krw != null) {
    positions.push({ currency: 'KRW', qty: s.krw, price: 1, value_krw: s.krw, locked: s.locked ?? 0 });
    total += s.krw;
  }
  if (s.usd != null) {
    const fx = s.fx ?? 1250;
    positions.push({ currency: 'USD', qty: s.usd, price: fx, value_krw: s.usd * fx, locked: 0, src: 'CTRP6504R' });
    total += s.usd * fx;
  }
  for (const [sym, [qty, price]] of Object.entries(s.holdings ?? {})) {
    positions.push({ currency: sym, qty, price, value_krw: qty * price });
    total += qty * price;
  }
  return { id, ts: ts.length === 16 ? `${ts}:00` : ts, total_krw: s.total ?? Math.round(total), positions: JSON.stringify(positions) };
}

/** 데모와 같은 보유(합성): 국내 2종목 + 해외 1종목 */
export const HOLD: Record<string, [number, number]> = {
  AAA001: [100, 60_000],
  BBB001: [50, 80_000],
  'NAS:CCC': [20, 150_000],
};

/** 데모 흐름을 스냅샷으로 옮긴 합성 계열 (기준 #100 → 최신 #110) */
export function demoSnapshotRows(): SnapshotRowLike[] {
  const r = (id: number, ts: string, s: SnapSpec) => snapRow(id, ts, { holdings: HOLD, ...s });
  return [
    r(100, '2026-09-01 07:10', { krw: 1_200_000, usd: 1500, fx: 1240 }),          // 기준
    r(101, '2026-09-03 09:40', { krw: 1_200_000, usd: 1500, fx: 1250 }),
    r(102, '2026-09-03 10:40', { krw: 2_200_000, usd: 1500, fx: 1250 }),          // 원화 입금 +1,000,000
    r(103, '2026-09-05 12:40', { krw: 2_200_000, usd: 1500, fx: 1256.2 }),
    r(104, '2026-09-05 13:40', { krw: 940_000, usd: 2500, fx: 1256.2 }),          // 환전 −1,260,000 / +$1,000
    r(105, '2026-09-10 14:40', { krw: 640_000, usd: 2500, fx: 1250 }),            // 원화 출금 −300,000
    r(106, '2026-09-12 21:00', { krw: 640_000, usd: 2500, fx: 1250 }),
    r(107, '2026-09-12 22:00', { krw: 640_000, usd: 2700, fx: 1250 }),            // 달러 입금 +$200
    r(108, '2026-09-14 21:10', { krw: 640_000, usd: 2700, fx: 1250 }),
    r(109, '2026-09-14 22:20', { krw: 1_340_000, usd: 2700, fx: 1250 }),          // 기록 안 된 원화 +700,000 (후보)
    r(110, '2026-09-15 09:40', { krw: 1_340_000, usd: 2700, fx: 1250 }),          // 최신
  ];
}
