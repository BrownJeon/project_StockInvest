/**
 * 일봉 로더 — 국내 KOSPI/KOSDAQ 접미어 판별이 핵심 (T-032).
 *
 * 실측 배경: Yahoo는 틀린 접미어에도 200 + 껍데기 시계열(close 대부분 null)을 준다.
 * 파싱 단계에서 null 봉이 버려지므로 **파싱 후 캔들 수**가 올바른 접미어의 판별자다.
 *   · 086520(에코프로, KOSDAQ): `.KS` → 23봉 껍데기 / `.KQ` → 1220봉
 * "첫 성공"을 채택하면 KOSDAQ 종목이 껍데기로 분석되므로 반드시 최다 캔들을 고른다.
 */
import { loadDailyHistory } from '../data/history-source';
import type { DailyCandle } from '../types';

function candles(n: number): DailyCandle[] {
  return Array.from({ length: n }, (_, i) => ({
    date: new Date(Date.UTC(2024, 0, 1) + i * 86400000).toISOString().slice(0, 10),
    open: 100, high: 101, low: 99, close: 100, volume: 1000,
  }));
}

describe('loadDailyHistory — 후보 선택', () => {
  test('🔴 KOSDAQ 종목: .KS 껍데기(23봉) 대신 .KQ(1220봉)를 채택한다', async () => {
    const loader = jest.fn(async (sym: string) =>
      sym.endsWith('.KS') ? candles(23) : candles(1220),
    );
    const r = await loadDailyHistory('086520', { loader });
    expect(r.sourceSymbol).toBe('086520.KQ');
    expect(r.candles).toHaveLength(1220);
    expect(r.market).toBe('domestic');
  });

  test('KOSPI 종목: .KS 가 더 많으면 .KS 를 채택한다', async () => {
    const loader = jest.fn(async (sym: string) =>
      sym.endsWith('.KS') ? candles(1220) : candles(5),
    );
    const r = await loadDailyHistory('000660', { loader });
    expect(r.sourceSymbol).toBe('000660.KS');
  });

  test('동률이면 먼저 나열된 후보(.KS)를 결정적으로 채택한다', async () => {
    const loader = jest.fn(async () => candles(1220));
    const r = await loadDailyHistory('000660', { loader });
    expect(r.sourceSymbol).toBe('000660.KS');
  });

  test('후보를 병렬로 조회한다 (심볼 예산 8초 초과 방지)', async () => {
    const started: number[] = [];
    const loader = jest.fn(async () => {
      started.push(Date.now());
      await new Promise((res) => setTimeout(res, 20));
      return candles(10);
    });
    await loadDailyHistory('005930', { loader });
    expect(loader).toHaveBeenCalledTimes(2);
    // 순차라면 두 번째 시작이 첫 완료(20ms) 이후여야 한다 — 병렬이면 거의 동시
    expect(started[1] - started[0]).toBeLessThan(15);
  });

  test('한 후보가 실패해도 다른 후보로 성공한다', async () => {
    const loader = jest.fn(async (sym: string) => {
      if (sym.endsWith('.KS')) throw new Error('HTTP 404');
      return candles(300);
    });
    const r = await loadDailyHistory('086520', { loader });
    expect(r.sourceSymbol).toBe('086520.KQ');
  });

  test('해외 심볼은 후보 1개만 조회한다', async () => {
    const loader = jest.fn(async () => candles(500));
    const r = await loadDailyHistory('NAS:MU', { loader });
    expect(loader).toHaveBeenCalledTimes(1);
    expect(loader.mock.calls[0][0]).toBe('MU');
    expect(r.market).toBe('overseas');
    expect(r.symbol).toBe('NAS:MU');
  });
});

describe('loadDailyHistory — 실패 경로', () => {
  test('모든 후보가 실패하면 사유를 모아 던진다', async () => {
    const loader = jest.fn(async () => { throw new Error('ECONNRESET'); });
    await expect(loadDailyHistory('005930', { loader })).rejects.toThrow(
      /no daily history for 005930.*ECONNRESET/s,
    );
  });

  test('모든 후보가 빈 시계열이면 실패로 처리한다', async () => {
    const loader = jest.fn(async () => [] as DailyCandle[]);
    await expect(loadDailyHistory('005930', { loader })).rejects.toThrow(/empty/);
  });

  test('검증 실패 심볼은 로더를 호출하지 않는다', async () => {
    const loader = jest.fn();
    await expect(loadDailyHistory('bogus symbol', { loader })).rejects.toThrow(
      /invalid research symbol/,
    );
    expect(loader).not.toHaveBeenCalled();
  });
});
