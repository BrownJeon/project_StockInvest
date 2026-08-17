import type { RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';
import { kis } from '@/lib/exchanges/kis';
import { getMarketFromSymbol } from '@/lib/exchanges/kis-symbols';
import type { OrderRequest } from '@/lib/exchanges/types';
import { submitOrder } from '@/lib/safety/dry-run';
import { sizeOrderQuantity } from '@/lib/signals/service';

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
 *
 * JSON 본문은 무엇이든 담을 수 있고, 비-number 수치는 아래로 흘러가며 조용히 통과했다:
 *  - `quantity: '3.7'` → `sizeOrderQuantity` 가 값을 만들지 못해(`undefined`) 원본이 그대로
 *    `orderReq.quantity` 에 남고, 어댑터의 `quantity <= 0` 이 `'3.7' <= 0 → false` 로
 *    통과시켜 **라이브 KIS 주문 호출까지** 도달했다.
 *  - `price: 'abc'` → `resolveOrderAmountKRW` 가 `NaN` 을 만들고, `checkOrderMax` 의
 *    `amount <= 0` 도 `amount > max` 도 NaN 비교라 **둘 다 false** → 1회·일일 한도가 통째로
 *    무력화됐다.
 *
 * 어댑터와 한도 검사 쪽도 각각 fail-closed 로 고쳤지만(방어 이중화), **원인을 가장 잘 설명할
 * 수 있는 자리는 값이 들어온 API 경계**다. 여기서 400 으로 되돌려 주면 호출자가 무엇을 잘못
 * 보냈는지 즉시 안다.
 *
 * `undefined`/`null` 은 정상 입력이다 — 하위 사이징·어댑터가 금액에서 파생한다.
 *
 * ⚠️ **이 경계는 `price` 도 예외적으로 엄격하다**(어댑터는 느슨하다 — `Number(x)` 로 판정해
 * `'70000'` 같은 숫자 문자열을 통과시킨다). 비대칭이 의도적인 이유: 느슨함이 필요한 근거는
 * mysql2 가 DECIMAL 을 문자열로 돌려주는 **DB 경유 경로**(`POST /api/signals`·entry-watcher)에만
 * 해당하는데, 여기는 사람이 직접 만든 JSON 이 들어오는 자리라 그 사정이 없다. 그리고 이
 * 엔드포인트에는 현재 리포지토리 안에 호출자가 전무하므로(계정 소유자의 직접 curl 만 도달)
 * 엄격하게 잡아도 끊길 정상 트래픽이 없다. 호출자가 생기면 이 전제를 다시 확인해야 한다.
 */
const NUMERIC_FIELDS = ['price', 'quantity', 'amountKRW'] as const;

function invalidNumericField(body: CreateBody): (typeof NUMERIC_FIELDS)[number] | null {
  for (const field of NUMERIC_FIELDS) {
    const v = body[field];
    if (v === undefined || v === null) continue;
    // Number.isFinite 는 non-number 에 대해 강제변환 없이 false 를 돌려준다
    // (`Number.isFinite('3.7') === false`) — 전역 isFinite 와 다른 지점이자 이 가드의 핵심.
    if (!Number.isFinite(v)) return field;
  }
  return null;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as CreateBody;

    if (!body.symbol || !body.side || !body.type) {
      return Response.json({ ok: false, error: 'symbol/side/type required' }, { status: 400 });
    }

    const badField = invalidNumericField(body);
    if (badField) {
      // 흔적 없는 거절을 남기지 않는다. 여기서 막힌 요청은 `orders` 행이 생기기 전이라
      // 감사 로그에 남지 않으므로(= 정상 400 과 동일 취급), 최소한 서버 로그에는 남긴다.
      console.warn(
        `[api/orders POST] 비-number ${badField} 거절 — symbol=${body.symbol} ` +
        `type=${typeof body[badField]} value=${JSON.stringify(body[badField])}`,
      );
      return Response.json(
        { ok: false, error: `${badField} must be a finite number` },
        { status: 400 },
      );
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
      side: body.side,
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
