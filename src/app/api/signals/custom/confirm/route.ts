/**
 * POST /api/signals/custom/confirm
 * 사용자가 최종 확정한 시나리오를 signals 테이블에 저장하고
 * 즉시 approved_pending_entry(진입 감시) 상태로 전환.
 * 분할(splits) 설정 시 N개의 시그널을 생성.
 *
 * Body: { symbol, direction, scenario, currentPrice?, entryZonePct?, splits?, amountKRW?, holdingQty? }
 * 반환: { ok: true, signalId, signalIds, splitCount, status: 'approved_pending_entry' }
 * 거절(T-052): 400 보유 마감일이 이미 지남 · 404 원본 시그널 없음 · 409 원본이 이미 처리됨 / 같은 구간 활성 시나리오 있음 /
 *             같은 (종목·방향) 확정이 처리 중 — 모두 `{ ok: false, error: <한국어 문장> }`
 */
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';
import type { ScenarioCard } from '@/lib/signals/scenario-builder';
import { calcSplitSlices } from '@/lib/signals/scenario-builder';
import { getMarketFromSymbol } from '@/lib/exchanges/kis-symbols';
import { getSymbolLabel, sendAlert } from '@/lib/notify';
import { AWAITING_APPROVAL_STATUSES, sqlStatusList } from '@/lib/signals/statuses';
import { toKstDatetime } from '@/lib/time';
import { invalidConfirmField, warnConfirmFieldRejected } from '@/lib/safety/scenario-confirm-fields';
import {
  CONFIRM_BUSY_MESSAGE,
  CONFIRM_LOCK_WAIT_SEC,
  activeDuplicateMessage,
  confirmLockName,
  findActiveZoneDuplicate,
  resolveConfirmExpiry,
  sourceAlreadyHandledMessage,
} from '@/lib/signals/custom-confirm-guard';

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
  /** AI 시그널 승인 시: 원본 시그널 ID — 같은 트랜잭션에서 **먼저** approved 로 선점한 뒤 생성한다(T-052) */
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

    // T-052 D-2: 만료 = min(지금 + 24h, 보유 마감일 23:59:59 KST). 마감이 이미 지났으면 진입 감시에 넣지 않는다 —
    //   넣으면 마감 뒤에 실주문이 나갈 수 있고 청산 엔진이 꺼져 있어 정리되지 않는다. 마감이 없거나 형식이 다르면 기존대로 24h.
    const expiry = resolveConfirmExpiry(scenario, Date.now());
    if (!expiry.ok) {
      console.warn(`[api/signals/custom/confirm POST] 지난 보유 마감 거절 — symbol=${String(symbol)} ${expiry.error}`);
      return Response.json({ ok: false, error: expiry.error }, { status: 400 });
    }
    // T-050: DB·앱 풀이 KST 인 DATETIME 컬럼이라 KST 벽시계로 넣는다. UTC 문자열이면 DB 가 9시간 앞선 시각으로 읽어 24시간이 아니라 15시간 만에 만료된다.
    const expiresAt = toKstDatetime(new Date(expiry.expiresAtMs));

    const pool = getPool();
    const groupId = crypto.randomUUID();

    // INSERT 값은 DB 를 잡기 전에 모두 계산한다(락·트랜잭션을 쥐는 시간을 줄인다). 열 순서·값은 T-052 이전과 같다.
    const insertParams: unknown[][] = [];
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

      insertParams.push([
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
      ]);
    }

    // 🔴 T-052 D-1 — 중복 확정 방지. 같은 시나리오가 두 번 확정되면(동시 요청·재시도·탭 두 개·재클릭) 서로 다른 signal 이
    //   둘 생기고 entry-watcher 선점(T-043)은 signal 단위라 실주문이 두 번 나갈 수 있었다.
    //   T-052 라운드3(Codex C2): **두 경로 모두** 같은 (종목·방향) 명명 락 아래에서 같은 활성 구간 중복 검사를 거친다 —
    //   경로마다 다르게 두면 직접 경로와 sourceSignalId 경로(또는 서로 다른 원본 둘)가 같은 구간을 각각 넣을 수 있었다.
    //   순서: GET_LOCK(대기 0) → BEGIN → [sourceSignalId 면 원본 조건부 선점] → 활성 구간 중복 검사 → 분할 INSERT → COMMIT → RELEASE_LOCK.
    //   - 원본 선점: affectedRows === 1 일 때만 계속. 동시 요청의 뒤쪽은 이미 'approved' 인 원본을 보고 0행 → 409/404.
    //   - 중복이면 rollback(원본 선점도 함께 되돌림) 후 409. 중복 조회는 scenario_source='user' 행만 보므로 AI 원본 행 자신은 잡히지 않는다.
    //   - 락은 트랜잭션 **시작 전에** 잡아 커밋 뒤에 푼다 — 뒤 요청의 조회 스냅숏이 앞 요청의 커밋 뒤에 만들어지게.
    //   - 락 대기는 0 이다: 못 잡으면 곧바로 연결을 풀에 돌려주고 409. 기다리는 동안 풀 연결을 쥐고 있으면 같은 키 요청 몇 개로
    //     풀(connectionLimit 10)이 차서 entry-watcher 등 다른 DB 작업이 줄을 섰다(Codex C2 medium).
    const sourceSignalId = body.sourceSignalId;
    const lockName = confirmLockName(symbol, direction);
    const signalIds: number[] = [];
    const conn = await pool.getConnection();
    let lockHeld = false;
    let discardConn = false;   // 락 해제·롤백이 실패한 연결은 풀에 돌려주지 않는다(락 누수·트랜잭션 잔존 방지)
    try {
      let lockRows: (RowDataPacket & { got: unknown })[];
      try {
        [lockRows] = await conn.query<(RowDataPacket & { got: unknown })[]>(
          'SELECT GET_LOCK(?, ?) AS got', [lockName, CONFIRM_LOCK_WAIT_SEC],
        );
      } catch (e) {
        // 서버에서는 락을 잡았는데 응답만 잃었을 수 있다 — 이 연결을 풀에 돌려주면 락이 남는다(Reviewer R-3). 닫아서 세션째 푼다.
        discardConn = true;
        throw e;
      }
      // 1 이 아니면(0 = 다른 요청이 쥐고 있음, NULL = 서버 오류) 락을 못 잡은 것 — 값을 정상 수신했으므로 연결은 그대로 반환한다.
      if (Number(lockRows[0]?.got) !== 1) {   // Number(null)=0, Number(undefined)=NaN → 둘 다 못 잡은 것
        return Response.json({ ok: false, error: CONFIRM_BUSY_MESSAGE }, { status: 409 });
      }
      lockHeld = true;

      await conn.beginTransaction();
      try {
        // ① sourceSignalId 경로: 원본 조건부 선점
        if (sourceSignalId) {
          const [claim] = await conn.query<ResultSetHeader>(
            `UPDATE signals SET status='approved', updated_at=NOW()
              WHERE id=? AND status IN (${sqlStatusList([...AWAITING_APPROVAL_STATUSES, 'detected'])})`,
            [sourceSignalId],
          );
          if (claim.affectedRows !== 1) {
            await conn.rollback();
            const [cur] = await conn.query<(RowDataPacket & { status: string })[]>(
              'SELECT status FROM signals WHERE id=?', [sourceSignalId],
            );
            if (cur.length === 0) {
              return Response.json({ ok: false, error: `원본 시그널 #${sourceSignalId} 을(를) 찾을 수 없습니다.` }, { status: 404 });
            }
            return Response.json(
              { ok: false, error: sourceAlreadyHandledMessage(sourceSignalId, cur[0].status) },
              { status: 409 },
            );
          }
        }

        // ② 활성 구간 중복 검사 — 두 경로 공통
        const [active] = await conn.query<(RowDataPacket & { id: number; indicators: unknown })[]>(
          `SELECT id, indicators FROM signals
            WHERE symbol = ? AND side = ? AND scenario_source = 'user'
              AND status IN ('approved_pending_entry', 'executing')
              AND consumed_order_id IS NULL
              AND (expires_at IS NULL OR expires_at > NOW())`,
          [symbol, direction],
        );
        const dup = findActiveZoneDuplicate(active, slices.map(s => s.priceZoneStr));
        if (dup) {
          await conn.rollback();   // sourceSignalId 경로면 ① 의 원본 선점도 여기서 되돌아간다
          return Response.json({ ok: false, error: activeDuplicateMessage(dup) }, { status: 409 });
        }

        // ③ 분할 INSERT → ④ COMMIT
        for (const params of insertParams) {
          const [ins] = await conn.query<ResultSetHeader>(
            `INSERT INTO signals
             (strategy_id, symbol, side, order_type, price, quantity, amount_krw,
              reasoning, indicators, status, expires_at, market, scenario_source)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            params,
          );
          signalIds.push(ins.insertId);
        }
        await conn.commit();
      } catch (e) {
        // 분할 INSERT 일부만 남거나 원본만 소비되는 일이 없게 통째로 되돌린다.
        await conn.rollback().catch(() => { discardConn = true; });
        throw e;
      }
    } finally {
      if (lockHeld) {
        try {
          const [rel] = await conn.query<(RowDataPacket & { rel: unknown })[]>('SELECT RELEASE_LOCK(?) AS rel', [lockName]);
          if (Number(rel[0]?.rel) !== 1) discardConn = true;
        } catch {
          discardConn = true;
        }
      }
      // 명명 락은 세션(연결)에 붙는다 — 풀려 있지 않을 수 있는 연결을 풀에 돌려주면 이후 같은 (종목·방향) 확정이 막힌다.
      // 연결을 닫으면 서버가 그 세션의 락을 함께 푼다.
      if (discardConn) conn.destroy(); else conn.release();
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
