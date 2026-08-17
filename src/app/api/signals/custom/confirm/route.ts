/**
 * POST /api/signals/custom/confirm
 * 사용자가 최종 확정한 시나리오를 signals 테이블에 저장하고
 * 즉시 approved_pending_entry(진입 감시) 상태로 전환.
 * 분할(splits) 설정 시 N개의 시그널을 생성.
 *
 * Body: { symbol, direction, scenario, currentPrice?, entryZonePct?, splits?, amountKRW?, holdingQty? }
 * 반환: { ok: true, signalId, signalIds, splitCount, status: 'approved_pending_entry' }
 */
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';
import type { ScenarioCard } from '@/lib/signals/scenario-builder';
import { calcSplitSlices } from '@/lib/signals/scenario-builder';
import { getMarketFromSymbol } from '@/lib/exchanges/kis-symbols';
import { getSymbolLabel, sendAlert } from '@/lib/notify';
import { AWAITING_APPROVAL_STATUSES, sqlStatusList } from '@/lib/signals/statuses';
import { invalidConfirmField, warnConfirmFieldRejected } from '@/lib/safety/scenario-confirm-fields';

async function isManualNotifyEnabled(pool: ReturnType<typeof import('@/lib/db')['getPool']>): Promise<boolean> {
  try {
    const [rows] = await pool.query<(RowDataPacket & { value: string })[]>(
      "SELECT value FROM system_config WHERE `key` = 'notify_signal_manual' LIMIT 1",
    );
    if (rows.length > 0) { try { return Boolean(JSON.parse(rows[0].value)); } catch { /* ignore */ } }
  } catch { /* DB 실패 시 기본 true */ }
  return true;
}

function fmtKrw(v: number): string { return Math.round(v).toLocaleString('ko-KR'); }

export const dynamic = 'force-dynamic';

function domesticTick(price: number): number {
  if (price < 2000)   return 1;
  if (price < 5000)   return 5;
  if (price < 20000)  return 10;
  if (price < 50000)  return 50;
  if (price < 200000) return 100;
  if (price < 500000) return 500;
  return 1000;
}

/** 호가단위 반올림 — 해외주식 price도 KRW 환산값이므로 국내 호가단위 적용 */
function roundToTick(price: number): number {
  const tick = domesticTick(price);
  return Math.round(price / tick) * tick;
}

/**
 * ⚠️ 아래 선언은 **타입일 뿐 런타임 가드가 아니다.** JSON body 는 무엇이든 담을 수 있다.
 * 실제 강제는 `invalidConfirmField`(@/lib/safety/scenario-confirm-fields)가 한다 — T-029.
 */
interface ManualSliceBody {
  zoneLo: number;
  zoneHi: number;
  qty: number; // 주문 수량(주) — 매수·매도 공통
}

interface ConfirmBody {
  market?: 'domestic' | 'overseas';
  symbol: string;
  direction: 'buy' | 'sell';
  scenario: ScenarioCard;
  currentPrice?: number;
  /** 레거시 호환: 진입 구간 % [lo, hi] */
  entryZonePct?: [number, number];
  splits?: number;
  holdingQty?: number;
  /** 슬라이스별 개별 입력값 */
  manualSlices?: ManualSliceBody[];
  /** AI 시그널 승인 시: 원본 시그널 ID — 생성 완료 후 approved로 마킹 */
  sourceSignalId?: number;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as ConfirmBody;
    const { symbol, direction, scenario } = body;

    if (!symbol || !direction || !scenario) {
      return Response.json({ ok: false, error: 'symbol/direction/scenario required' }, { status: 400 });
    }

    // 🔴 T-029 — 수치·배열 shape 런타임 가드. **required 검사 뒤**에 두어 기존 문구를 앞지르지 않는다.
    //
    //   이 라우트는 INSERT 직후 `approved_pending_entry`(진입 감시)로 전환된다 — 사람이 한 번 더
    //   볼 기회가 없다. 그리고 `manualSlices` 의 문자열 수치는 `NaN` 이 아니라 **유효해 보이는
    //   오염 가격**을 만든다(`'100' + '200'` → `'100200'` → /2 → 50100). 아래 단계(주문 한도
    //   fail-closed·어댑터 가드)는 유한수를 통과시키므로 그 무엇도 이걸 잡지 못한다.
    //   → 값이 들어온 이 경계에서 행 생성 이전에 되돌린다.
    const badField = invalidConfirmField(body);
    if (badField) {
      warnConfirmFieldRejected('api/signals/custom/confirm POST', badField, body);
      return Response.json({ ok: false, error: badField.message }, { status: 400 });
    }

    const cp = body.currentPrice ?? 0;
    // 위 가드가 배열 shape 를 실제로 확인했으므로 이 타입 표기는 런타임과 일치한다.
    // (기존의 `as [number, number]` 캐스트는 아무것도 보장하지 않았다 — T-029 에서 제거)
    const entryZonePct: [number, number] = body.entryZonePct ?? [-0.5, 0.5];
    const splits = body.splits ?? 1;
    const market = body.market ?? getMarketFromSymbol(symbol);

    // `cp <= 0` 이 아니라 `!(cp > 0)` — 비교 대상이 수가 아닐 때 조용히 통과하지 않는 관용구(T-027).
    // 위 가드가 이미 유한수를 보장하지만, 게이트 자체가 fail-closed 로 읽히게 둔다.
    if (!(cp > 0) && !scenario.entry?.price_zone) {
      return Response.json({ ok: false, error: 'currentPrice or scenario.entry.price_zone required' }, { status: 400 });
    }

    const slices = body.manualSlices && body.manualSlices.length > 0
      ? body.manualSlices.map((s, i) => {
          const priceMid = roundToTick((s.zoneLo + s.zoneHi) / 2);
          return {
            index: i + 1,
            priceZoneStr: `${s.zoneLo}~${s.zoneHi}`,
            zoneLo: s.zoneLo,
            zoneHi: s.zoneHi,
            priceMid,
            qty: s.qty,
            amountKRW: Math.round(s.qty * priceMid), // qty × priceMid 파생
          };
        })
      : cp > 0
        ? calcSplitSlices(direction, cp, entryZonePct, splits, undefined, body.holdingQty)
        : [{
            index: 1,
            priceZoneStr: scenario.entry?.price_zone ?? '0~0',
            zoneLo: 0, zoneHi: 0, priceMid: 0,
            qty: body.holdingQty ?? 0,
            amountKRW: 0,
          }];

    const pool = getPool();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000)
      .toISOString().replace('T', ' ').slice(0, 19);

    const signalIds: number[] = [];
    const groupId = crypto.randomUUID();

    for (const slice of slices) {
      const splitScenario = {
        ...scenario,
        entry: { ...(scenario.entry ?? {}), price_zone: slice.priceZoneStr },
      };
      // 현재가 대비 % — 표시용으로 저장
      const zoneLoPct = cp > 0 ? +((slice.zoneLo - cp) / cp * 100).toFixed(1) : undefined;
      const zoneHiPct = cp > 0 ? +((slice.zoneHi - cp) / cp * 100).toFixed(1) : undefined;

      const indicators = {
        ai: { scenario: splitScenario },
        split: { index: slice.index, total: slices.length, group_id: groupId },
        ...(zoneLoPct !== undefined && zoneHiPct !== undefined
          ? { zone: { loPct: zoneLoPct, hiPct: zoneHiPct } }
          : {}),
      };

      // T-029: `priceZoneStr` 은 `scenario.entry.price_zone`(사용자·LLM 생성 문자열)에서 올 수 있어
      // 수치 가드가 닿지 않는다. 파싱 결과가 유한수가 아니면 **기존의 `null`(가격 미상) 분기**로
      // 보낸다 — 그러지 않으면 `NaN` 이 그대로 price 컬럼 바인딩까지 흘러갔다.
      const priceMid = slice.priceMid > 0 ? slice.priceMid : (() => {
        const parts = slice.priceZoneStr.split('~').map(Number);
        return parts.length === 2 && parts.every(Number.isFinite)
          ? roundToTick(Math.round((parts[0] + parts[1]) / 2))
          : null;
      })();

      const [ins] = await pool.query<ResultSetHeader>(
        `INSERT INTO signals
         (strategy_id, symbol, side, order_type, price, quantity, amount_krw,
          reasoning, indicators, status, expires_at, market, scenario_source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          null,
          symbol,
          direction,
          'limit',
          priceMid,
          slice.qty ?? null,
          slice.amountKRW ?? 0,
          scenario.why_now ?? null,
          JSON.stringify(indicators),
          'approved_pending_entry',
          expiresAt,
          market,
          'user',
        ],
      );
      signalIds.push(ins.insertId);
    }

    // 원본 AI 시그널이 있으면 approved로 마킹 (소비됨)
    if (body.sourceSignalId) {
      await pool.query(
        `UPDATE signals SET status='approved', updated_at=NOW()
          WHERE id=? AND status IN (${sqlStatusList([...AWAITING_APPROVAL_STATUSES, 'detected'])})`,
        [body.sourceSignalId],
      );
    }

    // 수동 시나리오 등록 알람
    if (await isManualNotifyEnabled(pool)) {
      const sideLabel = direction === 'buy' ? '매수' : '매도';
      const totalAmountKRW = slices.reduce((s, sl) => s + (sl.amountKRW ?? 0), 0);
      const splitNote = slices.length > 1 ? ` (${slices.length}분할)` : '';
      sendAlert(
        'info',
        `📋 시나리오 등록: ${await getSymbolLabel(symbol)}`,
        `${sideLabel} 진입 대기${splitNote}\n구간: ${slices[0].priceZoneStr}${slices.length > 1 ? ' …' : ''} · 예상금액: ₩${fmtKrw(totalAmountKRW)}`,
      );
    }

    return Response.json({
      ok: true,
      signalId: signalIds[0],   // 하위호환
      signalIds,
      splitCount: slices.length,
      status: 'approved_pending_entry',
    });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error('[api/signals/custom/confirm POST]', error);
    return Response.json({ ok: false, error }, { status: 500 });
  }
}
