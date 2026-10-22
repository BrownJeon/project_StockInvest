import type { RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';
import { kis } from '@/lib/exchanges/kis';
import { getMarketFromSymbol } from '@/lib/exchanges/kis-symbols';
import type { OrderRequest } from '@/lib/exchanges/types';
import { submitOrder } from '@/lib/safety/dry-run';
import {
  invalidNumericField,
  numericFieldError,
  warnNumericFieldRejected,
} from '@/lib/safety/numeric-fields';
import { sizeOrderQuantity } from '@/lib/signals/service';
import { INVALID_SIDE_USER_MESSAGE, normalizeOrderSide } from '@/lib/safety/validation-gate';

export const dynamic = 'force-dynamic';

interface CreateBody {
  symbol: string;
  side: 'buy' | 'sell';
  type: 'limit' | 'market';
  price?: number;
  quantity?: number;
  amountKRW?: number;
  clientOrderId?: string;
  source?: 'manual' | 'signal' | 'auto';
}

/**
 * 🔴 T-027 — `CreateBody` 의 `price?: number` 류 선언은 **타입일 뿐 런타임 가드가 아니다.**
 * 규칙 본문과 그 근거는 `@/lib/safety/numeric-fields` 에 한 벌만 둔다 (T-028 공용화 —
 * `POST /api/signals` 가 같은 규칙을 쓰므로, 복붙하면 한쪽만 바뀌는 상태가 결함의 구조가 된다).
 *
 * 이 라우트에 고유한 근거 하나: 여기는 사람이 직접 만든 JSON 이 들어오는 자리고 현재
 * 리포지토리 안에 호출자가 전무하므로(계정 소유자의 직접 curl 만 도달) 엄격하게 잡아도 끊길
 * 정상 트래픽이 없다. 호출자가 생기면 이 전제를 다시 확인해야 한다.
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as CreateBody;

    if (!body.symbol || !body.side || !body.type) {
      return Response.json({ ok: false, error: 'symbol/side/type required' }, { status: 400 });
    }

    const badField = invalidNumericField(body);
    if (badField) {
      warnNumericFieldRejected('api/orders POST', badField, body);
      return Response.json(
        { ok: false, error: numericFieldError(badField) },
        { status: 400 },
      );
    }

    // 🔴 T-072 WP-2d — side 정규화. 대소문자·앞뒤 공백 변형은 받아 정확한 값으로 바꾸고, buy/sell 이 아니면 400.
    //    (`submitOrder` 도 맨 앞에서 정규화하지만 — 최후 방어선 — 입구에서 사람이 읽는 400 으로 먼저 돌려준다.)
    const side = normalizeOrderSide(body.side);
    if (side === null) {
      return Response.json({ ok: false, error: INVALID_SIDE_USER_MESSAGE }, { status: 400 });
    }

    // 클라이언트가 보낸 quantity를 그대로 신뢰하지 않는다 — 소수점이 들어오면 T-020이
    // entry-watcher/service.ts 두 엔진 경로에서 없앤 문제(소수점 주문 → KIS가 조용히 축소집행
    // 하거나 절삭돼 0주가 되는 문제)가 이 수동 주문 경로로 재현될 수 있었다. 같은 정수화
    // 로직(sizeOrderQuantity)을 여기서도 통과시켜 API 스스로를 방어한다.
    const market = getMarketFromSymbol(body.symbol);
    const sized = sizeOrderQuantity({
      market,
      orderType: body.type,
      requestedQuantity: body.quantity,
      amountKRW: body.amountKRW ?? 0,
      price: body.price,
    });

    const orderReq: OrderRequest = {
      exchange: 'kis',
      symbol: body.symbol,
      side,
      type: body.type,
      price: body.price,
      quantity: sized.quantity ?? body.quantity,
      amountKRW: body.amountKRW,
      clientOrderId: body.clientOrderId,
    };

    const result = await submitOrder(orderReq, kis.createOrder, {
      assetClass: 'stock',
      source: body.source ?? 'manual',
      clientOrderId: body.clientOrderId,
      // 🔴 T-072 F-1 — 사람이 직접 만든 주문은 **전략 귀속이 없다** → 매수는 submitOrder 관문(G6)이 막는다(사용자 결정 D-1 "전부 차단").
      //    매도(보호 청산)는 관문과 무관하게 그대로 나간다. `source` 는 클라이언트가 고르는 값이라 판정 근거가 아니다.
      //    미지정이어도 같은 결과지만(fail-closed) 의도를 코드로 남기려고 명시한다 — 정적 시험이 모든 호출부의 명시를 단언한다.
      attribution: { kind: 'strategy', strategyId: null, signalId: null },
    });

    return Response.json({ ok: result.ok, data: result }, { status: result.ok ? 200 : 400 });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error('[api/orders POST]', error);
    return Response.json({ ok: false, error }, { status: 500 });
  }
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? '50'), 1), 200);
    const symbol = url.searchParams.get('symbol');
    const status = url.searchParams.get('status');

    const where: string[] = [];
    const params: unknown[] = [];
    if (symbol) { where.push('symbol = ?'); params.push(symbol); }
    if (status) { where.push('status = ?'); params.push(status); }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const pool = getPool();
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id, account_id, client_order_id, exchange_order_id, asset_class,
              symbol, side, type, price, quantity, amount_krw,
              status, blocked_by, source, market, created_at, updated_at
       FROM orders
       ${whereSql}
       ORDER BY created_at DESC
       LIMIT ?`,
      [...params, limit],
    );
    return Response.json({ ok: true, data: rows });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error('[api/orders GET]', error);
    return Response.json({ ok: false, error }, { status: 500 });
  }
}
