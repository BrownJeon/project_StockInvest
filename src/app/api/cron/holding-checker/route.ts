/**
 * holding-checker cron — 보유기간 초과 포지션 텔레그램 알림.
 *
 * 흐름:
 *  1. position_state에서 holding_deadline < NOW() 인 행 조회
 *  2. 각 포지션에 대해 텔레그램 ⚠️ 알림 발송
 *  3. holding_deadline = NULL 로 초기화 (중복 알림 방지 — 다음 진입 시 재설정)
 *
 * 호출 주기: 1분 cron (stockinvest-cron 프로세스가 매 틱 /api/cron/* 일괄 호출)
 */
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import { getPool } from '@/lib/db';
import { checkCronAuth } from '@/lib/cron-auth';
import { sendAlert } from '@/lib/notify';

export const dynamic = 'force-dynamic';

interface ExpiredRow extends RowDataPacket {
  symbol: string;
  market: string;
  entry_price: string | number;
  holding_deadline: Date;
}

export async function POST(req: NextRequest) {
  const authErr = checkCronAuth(req);
  if (authErr) return authErr;

  const pool = getPool();

  const [rows] = await pool.query<ExpiredRow[]>(
    `SELECT symbol, market, entry_price, holding_deadline
       FROM position_state
      WHERE holding_deadline IS NOT NULL AND holding_deadline < NOW()`,
  );

  if (rows.length === 0) {
    return NextResponse.json({ ok: true, alerted: 0 });
  }

  const alerted: string[] = [];

  for (const row of rows) {
    const symbol = row.symbol;
    const market = row.market === 'overseas' ? '해외' : '국내';
    const entryPrice = Number(row.entry_price);
    const deadline = new Date(row.holding_deadline).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });

    // 텔레그램 알림
    try {
      sendAlert(
        'warning',
        `보유기간 초과 — ${symbol}`,
        `${market} 종목 <b>${symbol}</b>의 보유기간이 초과되었습니다.\n` +
        `진입가: ${entryPrice.toLocaleString('ko-KR')}\n` +
        `예정 만료: ${deadline} KST\n` +
        `포지션 검토 후 청산 여부를 결정하세요.`,
      );
    } catch (e) {
      console.error(`[holding-checker] sendAlert failed ${symbol}:`, e);
    }

    // holding_deadline 초기화 (중복 알림 방지)
    await pool.query<ResultSetHeader>(
      `UPDATE position_state SET holding_deadline = NULL WHERE symbol = ? AND market = ?`,
      [symbol, row.market],
    ).catch(e => console.error(`[holding-checker] deadline clear failed ${symbol}:`, e));

    alerted.push(symbol);
    console.log(`[holding-checker] 보유기간 초과 알림: ${symbol} (${market})`);
  }

  return NextResponse.json({ ok: true, alerted: alerted.length, symbols: alerted });
}
