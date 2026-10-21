import type { RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';
import { isEngineEnabled } from '@/lib/signals/router';
import { createSignal } from '@/lib/signals/service';
import { getMarketFromSymbol } from '@/lib/exchanges/kis-symbols';
import {
  invalidNumericField,
  numericFieldError,
  warnNumericFieldRejected,
} from '@/lib/safety/numeric-fields';
import { isDomesticOpen, isOverseasOpen } from '@/lib/strategy/market-hours';

export const dynamic = 'force-dynamic';

interface CreateBody {
  strategyId?: string;
  symbol: string;
  side: 'buy' | 'sell';
  orderType: 'limit' | 'market';
  price?: number;
  quantity?: number;
  amountKRW: number;
  reasoning?: string;
  indicators?: unknown;
  expiresAt?: string;
}

export async function POST(req: Request) {
  try {
    if (!(await isEngineEnabled())) {
      return Response.json({ ok: false, error: 'engine_disabled' }, { status: 403 });
    }
    const body = (await req.json()) as CreateBody;
    if (!body.symbol || !body.side || !body.orderType || !body.amountKRW) {
      return Response.json(
        { ok: false, error: 'symbol/side/orderType/amountKRW required' },
        { status: 400 },
      );
    }
    // 🔴 T-028 — required 검사는 truthiness 뿐이라 `'abc'` 같은 **truthy 비-number 는 통과**한다.
    //    (`NaN` 은 falsy 라 우연히 위에서 걸릴 뿐이고, 애초에 JSON 으로는 전송되지 않는다.)
    //    시그널은 `createSignal` → 자동제출 시 `submitOrder` 까지 이어지는 **주문 발원 경로**이므로
    //    `POST /api/orders` 와 **같은 규칙**을 같은 자리에 둔다 — 기존 계약의 연장이지 변경이 아니다.
    //    유효하지 않은 수치를 가진 요청은 애초에 유효한 시그널이 아니라, 행을 남겨 봐야 무의미한
    //    값이 든 `signals` 행이 아래로 흘러갈 뿐이다.
    const badField = invalidNumericField(body);
    if (badField) {
      warnNumericFieldRejected('api/signals POST', badField, body);
      return Response.json(
        { ok: false, error: numericFieldError(badField) },
        { status: 400 },
      );
    }
    // 시장별 개장 가드 — 폐장 시 시그널 생성 차단
    const symMarket = getMarketFromSymbol(body.symbol);
    const open = symMarket === 'overseas' ? await isOverseasOpen() : await isDomesticOpen();
    if (!open) {
      return Response.json(
        { ok: false, error: `${symMarket}_market_closed` },
        { status: 409 },
      );
    }
    // T-003 §1 `signal_create_failed` — createSignal 예외를 이 지점에서 분류해 응답한다.
    // (바깥 catch 로 흘려보내면 스키마 오류와 요청 파싱 오류가 같은 500 으로 뭉개진다)
    let result;
    try {
      result = await createSignal({
        strategyId: body.strategyId,
        symbol: body.symbol,
        side: body.side,
        orderType: body.orderType,
        price: body.price,
        quantity: body.quantity,
        amountKRW: body.amountKRW,
        reasoning: body.reasoning,
        indicators: body.indicators,
        expiresAt: body.expiresAt,
      });
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      console.error(`[api/signals POST] signal_create_failed ${body.symbol} ${body.side}: ${err}`);
      return Response.json({ ok: false, error: 'signal_create_failed', detail: err }, { status: 500 });
    }
    // T-058 — 현금 부족 건너뜀은 입력 오류가 아니라 정책 건너뜀이다: 200 + skipped 로 구분한다(다른 !ok 는 400 유지).
    if (!result.ok && result.errorCode === 'insufficient_cash') {
      return Response.json({ ok: false, skipped: true, reason: 'insufficient_cash', data: result }, { status: 200 });
    }
    return Response.json({ ok: result.ok, data: result }, { status: result.ok ? 200 : 400 });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error('[api/signals POST]', error);
    return Response.json({ ok: false, error }, { status: 500 });
  }
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? '50'), 1), 1000);
    const symbol = url.searchParams.get('symbol');
    const status = url.searchParams.get('status');
    const since  = url.searchParams.get('since'); // ISO datetime or epoch ms
    const consumedOrderId = url.searchParams.get('consumedOrderId');

    const scenarioSource = url.searchParams.get('scenarioSource');

    // T-049 — 대시보드 "내 결정" 섹션 전용 옵트인 2개. 값이 **정확히 '1'** 일 때만 켜진다.
    // 그 밖의 값·없음이면 아래 SQL·응답은 변경 전과 같다(다른 소비자 14곳 — signals-get.test.ts 가 고정).
    //  - includeExpired=1 : status 가 있을 때 붙던 만료 제외 절을 생략 — 결정 내역은 거의 전부 TTL 이 지났다.
    //  - withOrder=1      : 각 행에 order_status·order_blocked_by 를 붙인다(orders PK IN 2차 조회, JOIN 아님).
    const includeExpired = url.searchParams.get('includeExpired') === '1';
    const withOrder = url.searchParams.get('withOrder') === '1';

    const where: string[] = [];
    const params: unknown[] = [];
    if (symbol) { where.push('symbol = ?'); params.push(symbol); }
    if (consumedOrderId) { where.push('consumed_order_id = ?'); params.push(Number(consumedOrderId)); }
    if (scenarioSource) { where.push('scenario_source = ?'); params.push(scenarioSource); }
    if (since) {
      const d = new Date(isNaN(Number(since)) ? since : Number(since));
      if (!isNaN(d.getTime())) { where.push('created_at >= ?'); params.push(d); }
    }
    if (status) {
      const statuses = status.split(',').map(s => s.trim()).filter(Boolean);
      if (statuses.length === 1) {
        where.push('status = ?'); params.push(statuses[0]);
      } else if (statuses.length > 1) {
        where.push(`status IN (${statuses.map(() => '?').join(',')})`);
        params.push(...statuses);
      }
      // 만료 시각이 지난 시그널은 cron 처리 여부와 무관하게 제외 (includeExpired=1 일 때만 생략)
      if (!includeExpired) where.push('(expires_at IS NULL OR expires_at >= NOW())');
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const pool = getPool();
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id, strategy_id, symbol, side, order_type, price, quantity, amount_krw,
              reasoning, indicators, status, expires_at, valid_from, scenario_source,
              consumed_order_id, created_at, updated_at
       FROM signals
       ${whereSql}
       ORDER BY created_at DESC, id DESC
       LIMIT ?`,
      [...params, limit],
    );
    if (!withOrder) return Response.json({ ok: true, data: rows });

    // 2차 조회 — 번호가 있는 행만, 중복 제거. 실패하면 바깥 catch 로 500:
    // null 로 채워 성공시키면 번호 있는 카드가 전부 "주문 여부 확인 필요"로 바뀌어 거짓 경고가 된다.
    const orderIds = [...new Set(
      rows.map(r => r.consumed_order_id).filter(v => v != null).map(v => Number(v)),
    )];
    const orderById = new Map<number, { status: string | null; blocked_by: string | null }>();
    if (orderIds.length > 0) {
      const [orderRows] = await pool.query<RowDataPacket[]>(
        `SELECT id, status, blocked_by FROM orders WHERE id IN (${orderIds.map(() => '?').join(',')})`,
        orderIds,
      );
      for (const o of orderRows) {
        orderById.set(Number(o.id), { status: o.status ?? null, blocked_by: o.blocked_by ?? null });
      }
    }
    const data = rows.map(r => {
      const o = r.consumed_order_id != null ? orderById.get(Number(r.consumed_order_id)) : undefined;
      return { ...r, order_status: o?.status ?? null, order_blocked_by: o?.blocked_by ?? null };
    });
    return Response.json({ ok: true, data });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error('[api/signals GET]', error);
    return Response.json({ ok: false, error }, { status: 500 });
  }
}
