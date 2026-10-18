/**
 * entry-watcher cron — 승인 대기 시그널의 진입 구간 도달 여부를 감시해 자동 주문 실행.
 *
 * 흐름:
 *  1. checkCronAuth 인증
 *  2. 장중 여부 확인 (국내 09:00~15:30 KST) — 장외이면 즉시 종료
 *  3. approved_pending_entry 상태 시그널 전체 조회
 *  4. 각 시그널: price_zone 파싱 → KIS 현재가 조회 → 구간 내이면 submitOrder 호출
 *  5. 구간 도달 → **주문 직전에 조건부 UPDATE 로 executing 선점**(T-043) — 이긴 쪽만 submitOrder 호출
 *  6. 성공·결과 불명 → executing 유지 / 확정 거부·송신 전 예외 → approved_pending_entry 복귀(다음 틱 재시도) /
 *     expiresAt 초과 → status=expired
 */
import { NextRequest, NextResponse } from 'next/server';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';
import { checkCronAuth } from '@/lib/cron-auth';
import { kis } from '@/lib/exchanges/kis';
import { submitOrder } from '@/lib/safety/dry-run';
import { isDomesticOpen, isOverseasOpen } from '@/lib/strategy/market-hours';
import { parsePriceZone } from '@/lib/signals/scenario-builder';
import { recordBelowMinQty, sizeOrderQuantity } from '@/lib/signals/service';
import { getStyleConfig } from '@/lib/strategy/style';
import { setPositionScenarioExit } from '@/lib/strategy/position-state';
import type { ScenarioExitParams } from '@/lib/strategy/position-state';
import { getSymbolLabel, sendAlert } from '@/lib/notify';
import { escapeAlertText } from '@/lib/notify/escape';
import { claimEntrySignal, findStuckExecutions, recordEntryOrder, releaseEntryClaim } from '@/lib/signals/entry-claim';
import { sendAlertThrottled } from '@/lib/notify/throttle';

// notify_signal_entry 플래그 캐시 (30초 TTL)
let entryNotifyCache: { enabled: boolean; ts: number } | null = null;
async function isEntryNotifyEnabled(): Promise<boolean> {
  if (entryNotifyCache && Date.now() - entryNotifyCache.ts < 30_000) return entryNotifyCache.enabled;
  let enabled = true;
  try {
    const pool = getPool();
    const [rows] = await pool.query<(RowDataPacket & { value: string })[]>(
      "SELECT value FROM system_config WHERE `key` = 'notify_signal_entry' LIMIT 1",
    );
    if (rows.length > 0) { try { enabled = Boolean(JSON.parse(rows[0].value)); } catch { /* ignore */ } }
  } catch { /* DB 실패 시 기본 true */ }
  entryNotifyCache = { enabled, ts: Date.now() };
  return enabled;
}

function fmtKrw(v: number): string { return Math.round(v).toLocaleString('ko-KR'); }

/** holding_deadline (YYYY-MM-DD) 또는 holding_days 문자열 → Date */
function resolveHoldingDeadline(exitObj: Record<string, unknown>): Date | null {
  const dl = exitObj['holding_deadline'];
  if (typeof dl === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dl)) {
    const d = new Date(`${dl}T23:59:59+09:00`); // KST 당일 마감
    return Number.isFinite(d.getTime()) ? d : null;
  }
  // 구형 호환: holding_days 문자열 파싱
  const hd = String(exitObj['holding_days'] ?? '');
  if (hd === '당일') return new Date(Date.now() + 1 * 86400000);
  if (hd === '1주')  return new Date(Date.now() + 7 * 86400000);
  const m = hd.match(/(\d+)일/g);
  if (m) return new Date(Date.now() + Math.max(...m.map(s => parseInt(s, 10))) * 86400000);
  return null;
}

export const dynamic = 'force-dynamic';

interface PendingEntryRow {
  id: number;
  symbol: string;
  side: 'buy' | 'sell';
  order_type: 'limit' | 'market';
  price: string | null;
  quantity: string | null;
  amount_krw: string;
  indicators: string | null;
  reasoning: string | null;
  expires_at: Date | null;
  market: string | null;
}

interface WatchResult {
  signalId: number;
  symbol: string;
  outcome: 'submitted' | 'expired' | 'out_of_zone' | 'no_zone' | 'price_fetch_failed' | 'order_failed'
    | 'blocked_by_prior_split'
    /** T-020 — 사이징 결과가 1주 미만이라 주문을 내지 않았다 (실패가 아니라 정책 스킵) */
    | 'quantity_below_min'
    /** T-042 — 주문이 접수됐는지 알 수 없다(송신 중 예외·5xx). 같은 주문을 다시 내지 않도록 시그널을 잠갔다 */
    | 'order_uncertain'
    /** T-043 — 주문 직전 선점에 지지 않았다(다른 실행이 먼저 가져갔거나 그 사이 만료). 주문하지 않았다 */
    | 'claim_lost';
  detail?: string;
}

function getEffectiveChasePctSync(stylePct: number): number {
  // cron 컨텍스트에서는 동기 폴백만 사용 — DB 체크는 service.ts의 getEffectiveChasePct와 동일 원칙이나
  // cron은 단순화해서 style 값을 그대로 사용 (safety_limit_chase_disabled는 submitOrder 내부 안전장치가 아님).
  return stylePct;
}

/**
 * 주문이 나가지 않은 것이 확실할 때 선점을 되돌린다(확정 거부·송신 전 예외). 되돌리지 못해도 **재주문 위험은 없다** —
 * 시그널이 `executing` 에 남아 더 이상 감시되지 않을 뿐이다. 그 경우 사람이 알도록 경보한다.
 */
async function giveBackEntryClaim(pool: ReturnType<typeof getPool>, signalId: number, symbol: string): Promise<void> {
  try {
    const restored = await releaseEntryClaim(pool, signalId);
    if (!restored) console.warn(`[entry-watcher] 선점 복귀 대상 없음(이미 다른 상태) signal=${signalId}`);
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    console.error(`[entry-watcher] 선점 복귀 실패 signal=${signalId}:`, why);
    sendAlert(
      'warning',
      `⚠️ 진입 감시 선점 복귀 실패: ${escapeAlertText(symbol)}`,
      `시그널 #${signalId} 의 주문은 나가지 않았지만 executing 에서 되돌리지 못했습니다(${escapeAlertText(why.slice(0, 160))}). `
      + '재주문 위험은 없으나 더는 감시되지 않습니다. 주문이 없음을 확인한 뒤 DB 에서 status=\'approved_pending_entry\' 로 되돌리세요 (docs/telegram-approval.md §6.1).',
    );
  }
}

/** 선점 뒤 멈춘 `executing` 시그널이 있으면 1시간에 한 번 critical 경보한다. 던지지 않는다. */
async function alertStuckExecutions(pool: ReturnType<typeof getPool>): Promise<void> {
  try {
    const stuck = await findStuckExecutions(pool);
    if (stuck.length === 0) return;
    const lines = stuck.slice(0, 10).map((s) => `#${s.id} ${escapeAlertText(s.symbol)} ${s.side === 'buy' ? '매수' : '매도'} · 선점 ${escapeAlertText(s.updatedAt.replace('T', ' ').slice(0, 19))} KST`);
    // 키에 멈춘 ID 집합을 넣는다: 같은 집합은 1시간 스로틀하되, 새 시그널이 추가로 멈추면 TTL 과 무관하게 즉시 경보한다
    // (고정 키면 먼저 난 사고의 경보가 이후 독립 사고를 최대 1시간 가린다 — T-046 Codex C2). 집합이 바뀌는 경우(일부 정리 포함)에는
    // 남은 건에 대해 한 번 더 알린다. 멈춤은 드문 사고라 키 개수·알림 수는 문제되지 않는다.
    sendAlertThrottled(
      `entry-watcher:stuck-executing:${stuck.map((s) => s.id).join(',')}`,
      'critical',
      `⚠️ 주문 번호 없는 executing 시그널 ${stuck.length}건 — 확인 필요`,
      `${lines.join('\n')}${stuck.length > 10 ? `\n… 외 ${stuck.length - 10}건` : ''}\n`
      + '주문 직전에 선점된 뒤 10분 넘게 주문 번호가 연결되지 않았습니다(프로세스 중단·기록 실패 가능). 같은 주문이 다시 나가지는 않지만 주문 누락일 수 있습니다. '
      + 'KIS 체결/미체결 내역을 확인한 뒤 docs/telegram-approval.md §6.1 절차로 정리하세요.',
      60 * 60 * 1000,
    );
  } catch (e) {
    console.error('[entry-watcher] 멈춘 executing 점검 실패(주문 경로는 계속):', e instanceof Error ? e.message : String(e));
  }
}

export async function POST(req: NextRequest) {
  const authErr = checkCronAuth(req);
  if (authErr) return authErr;

  // 국내·해외 개장 여부를 병렬 조회 — 둘 다 닫혀있으면 스킵
  const [domOpen, ovsOpen] = await Promise.all([isDomesticOpen(), isOverseasOpen()]);
  if (!domOpen && !ovsOpen) {
    return NextResponse.json({ ok: true, skipped: true, reason: 'market_closed', processed: 0 });
  }

  const pool = getPool();
  const now = new Date();

  // T-046 C(T-043 감사 R-1) — 선점 뒤 멈춘 시그널(`executing` + 주문 번호 없음 + 10분 이상)을 틱마다 점검해 경보한다.
  // 조회할 대기 시그널이 없어도 돌아야 하므로 아래 `rows.length === 0` 조기 반환보다 앞에 둔다. 점검이 실패해도 주문 경로는 계속된다.
  await alertStuckExecutions(pool);

  // approved_pending_entry 상태 시그널 조회 — valid_from 미래인 것은 제외 (익일 시나리오 사전 등록 대응)
  const [rows] = await pool.query<(RowDataPacket & PendingEntryRow)[]>(
    `SELECT id, symbol, side, order_type, price, quantity, amount_krw,
            indicators, reasoning, expires_at, market
     FROM signals
     WHERE status = 'approved_pending_entry'
       AND (valid_from IS NULL OR valid_from <= NOW())
     ORDER BY created_at ASC`,
  );

  if (rows.length === 0) {
    return NextResponse.json({ ok: true, processed: 0, results: [] });
  }

  const style = await getStyleConfig();
  const chasePct = getEffectiveChasePctSync(style.limitChasePct);

  const results: WatchResult[] = [];

  for (const row of rows) {
    const signalId = row.id;

    // 만료 체크 — 앱 시계로 후보를 걸러내되, **확정은 DB 시각 조건부 UPDATE 의 결과**로 한다(T-043 감사 R-2 + Codex C2).
    // 선점 쪽 만료 비교(`expires_at > NOW()`)와 같은 기준(DB 시각)을 써야 앱·DB 시계 편차로 아직 유효한 시그널을 조기에 만료시키지 않고,
    // 상태 조건을 걸어 다른 실행이 방금 선점(`executing`)한 행을 덮지 않으며, 0행이면 `expired` 로 거짓 보고하지 않는다.
    if (row.expires_at && new Date(row.expires_at) < now) {
      try {
        const [res] = await pool.query<ResultSetHeader>(
          `UPDATE signals SET status='expired', updated_at=NOW()
            WHERE id=? AND status='approved_pending_entry' AND expires_at IS NOT NULL AND expires_at <= NOW()`,
          [signalId],
        );
        if (res.affectedRows === 1) {
          results.push({ signalId, symbol: row.symbol, outcome: 'expired' });
        } else {
          console.warn(`[entry-watcher] 만료 처리 대상 아님 signal=${signalId} (다른 실행이 이미 처리했거나 DB 시각 기준 아직 유효)`);
          results.push({ signalId, symbol: row.symbol, outcome: 'claim_lost', detail: '만료 처리 대상 아님(다른 실행이 이미 처리했거나 DB 시각 기준 아직 유효)' });
        }
      } catch (e) {
        console.error(`[entry-watcher] expire update failed signal=${signalId}:`, e);
        results.push({ signalId, symbol: row.symbol, outcome: 'expired', detail: `expire update failed: ${e instanceof Error ? e.message : String(e)}` });
      }
      continue;
    }

    // 시그널 시장 개장 여부 확인 — 해당 시장이 닫혀 있으면 스킵
    const { getMarketFromSymbol: gmfs } = await import('@/lib/exchanges/kis-symbols');
    const sigMarket = (row.market as 'domestic' | 'overseas') ?? gmfs(row.symbol);
    const sigMarketOpen = sigMarket === 'overseas' ? ovsOpen : domOpen;
    if (!sigMarketOpen) {
      results.push({
        signalId,
        symbol: row.symbol,
        outcome: 'out_of_zone',
        detail: `${sigMarket === 'overseas' ? '해외' : '국내'} 장외 시간`,
      });
      continue;
    }

    // indicators.ai.scenario.entry.price_zone 파싱
    let priceZone: [number, number] | null = null;
    try {
      const ind: unknown = typeof row.indicators === 'string'
        ? JSON.parse(row.indicators)
        : row.indicators;
      if (ind != null && typeof ind === 'object') {
        const ai = (ind as Record<string, unknown>)['ai'];
        if (ai != null && typeof ai === 'object') {
          const scenario = (ai as Record<string, unknown>)['scenario'];
          if (scenario != null && typeof scenario === 'object') {
            const entry = (scenario as Record<string, unknown>)['entry'];
            if (entry != null && typeof entry === 'object') {
              const pzRaw = (entry as Record<string, unknown>)['price_zone'];
              if (typeof pzRaw === 'string') {
                priceZone = parsePriceZone(pzRaw);
              }
            }
          }
        }
      }
    } catch {
      // indicators 파싱 실패 — no_zone으로 처리
    }

    if (priceZone === null) {
      results.push({ signalId, symbol: row.symbol, outcome: 'no_zone', detail: 'price_zone 없음' });
      continue;
    }

    // KIS 현재가 조회
    let currentPrice: number;
    try {
      const ticker = await kis.getTicker(row.symbol);
      currentPrice = ticker.price;
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      console.warn(`[entry-watcher] getTicker failed signal=${signalId} symbol=${row.symbol}:`, detail);
      results.push({ signalId, symbol: row.symbol, outcome: 'price_fetch_failed', detail });
      continue;
    }

    const [zoneLo, zoneHi] = priceZone;
    if (currentPrice < zoneLo || currentPrice > zoneHi) {
      results.push({
        signalId,
        symbol: row.symbol,
        outcome: 'out_of_zone',
        detail: `현재가=${currentPrice} zone=${zoneLo}~${zoneHi}`,
      });
      continue;
    }

    // 순차 트리거 게이트: 같은 group의 이전 회차 중 pending이 있으면 skip
    let splitIndex: number | undefined;
    let splitTotal: number | undefined;
    let splitGroupId: string | undefined;
    try {
      const ind = typeof row.indicators === 'string' ? JSON.parse(row.indicators) : row.indicators;
      if (ind?.split) {
        splitIndex = ind.split.index;
        splitTotal = ind.split.total;
        splitGroupId = ind.split.group_id;
      }
    } catch { /* indicators 파싱 실패 무시 */ }

    if (splitGroupId && splitIndex !== undefined && splitIndex > 1) {
      const [priorRows] = await pool.query<RowDataPacket[]>(
        `SELECT id, status FROM signals
         WHERE JSON_EXTRACT(indicators, '$.split.group_id') = ?
           AND JSON_EXTRACT(indicators, '$.split.index') < ?
           AND status = 'approved_pending_entry'`,
        [splitGroupId, splitIndex],
      );
      if (priorRows.length > 0) {
        results.push({ signalId, symbol: row.symbol, outcome: 'blocked_by_prior_split', detail: `waiting for index<${splitIndex}` });
        continue;
      }
    }
    // splitTotal은 현재 사용되지 않으나 향후 확장을 위해 파싱해 둠
    void splitTotal;

    // 진입 구간 도달 — 주문 실행 (submitOrder 내부에서 DRY_RUN·KILL_SWITCH 동작)
    const basePrice = row.price != null ? Number(row.price) : currentPrice;
    let chasedPrice: number | undefined = basePrice;
    if (chasePct > 0 && row.order_type === 'limit' && basePrice > 0) {
      const factor = row.side === 'buy' ? 1 + chasePct : 1 - chasePct;
      chasedPrice = basePrice * factor;
    }

    const market = sigMarket;

    // 🔴 T-020 — 사이징은 `signals/service.ts` 의 `sizeOrderQuantity` **하나**를 쓴다.
    // 여기와 `buildOrderRequest` 두 곳에서 각자 계산하던 것이 결함의 구조였다 —
    // 한쪽만 고치면 다른 경로로 계속 소수점 수량이 만들어진다(T-018 reviewer 지적).
    const sized = sizeOrderQuantity({
      market,
      orderType: row.order_type,
      requestedQuantity: row.quantity != null ? Number(row.quantity) : undefined,
      amountKRW: Number(row.amount_krw),
      price: chasedPrice,
    });
    const quantity = sized.quantity;

    // 1주도 살 수 없으면 주문을 내지 않는다 — 집계 가능한 outcome 으로 남긴다.
    // 시그널 상태는 그대로 둔다: 이 라우트는 **감시자**라 가격이 움직이면 다음 틱에
    // 성립할 수 있고, 끝내 성립하지 않으면 `expires_at` 으로 만료된다.
    if (quantity === 0) {
      const detail = await recordBelowMinQty({
        where: 'entry-watcher', signalId, symbol: row.symbol, side: row.side,
        amountKRW: Number(row.amount_krw), price: chasedPrice, raw: sized.raw,
      });
      results.push({ signalId, symbol: row.symbol, outcome: 'quantity_below_min', detail });
      continue;
    }

    const orderReq = {
      exchange: 'kis' as const,
      symbol: row.symbol,
      side: row.side,
      type: row.order_type,
      price: chasedPrice,
      quantity,
      amountKRW: Number(row.amount_krw),
      market,
      currency: market === 'overseas' ? 'USD' as const : 'KRW' as const,
    };

    // 🔴 T-043 — 주문 직전 **조건부 선점**. 이 UPDATE 를 이긴 실행만 submitOrder 를 부른다.
    //    조회(SELECT)와 주문 사이에 선점이 없으면, 같은 시그널을 보는 실행이 둘일 때(cron 앱 2개·수동 호출·배포 중 끊김 후 새
    //    인스턴스) 둘 다 실주문을 낸다. `client_order_id` 가 호출마다 랜덤이라 DB 멱등성도 없다. 선점 UPDATE 가 실패하면
    //    (DB 장애 포함) **주문하지 않는다** — 다음 틱에 다시 본다.
    let claimed: boolean;
    try {
      claimed = await claimEntrySignal(pool, signalId);
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      console.error(`[entry-watcher] 선점 UPDATE 실패 — 주문하지 않음 signal=${signalId}:`, detail);
      results.push({ signalId, symbol: row.symbol, outcome: 'order_failed', detail: `claim_failed: ${detail}` });
      continue;
    }
    if (!claimed) {
      console.warn(`[entry-watcher] 선점 패배 — 주문하지 않음 signal=${signalId} symbol=${row.symbol} (다른 실행이 먼저 가져갔거나 만료)`);
      results.push({ signalId, symbol: row.symbol, outcome: 'claim_lost', detail: '다른 실행이 먼저 선점했거나 그 사이 만료됨' });
      continue;
    }

    // submitOrder 호출 **하나만** try 로 감싼다. 주문 결과를 받은 뒤의 후처리 예외가 "송신 전 실패"로 오인돼 선점이 풀리면
    // 이미 나간 주문이 재주문된다(아래 후처리 catch 참고).
    let orderResult: Awaited<ReturnType<typeof submitOrder>>;
    try {
      orderResult = await submitOrder(orderReq, kis.createOrder, {
        assetClass: 'stock',
        source: 'auto',
      });
    } catch (e) {
      // submitOrder 가 **던졌다**. 송신 이후의 예외는 submitOrder 가 `outcomeUnknown` 결과로 돌려주므로(T-042) 여기는 송신 전 실패다
      // — 주문이 나가지 않았으니 선점을 되돌린다.
      const detail = e instanceof Error ? e.message : String(e);
      console.error(`[entry-watcher] submitOrder failed signal=${signalId}:`, detail);
      await giveBackEntryClaim(pool, signalId, row.symbol);
      results.push({ signalId, symbol: row.symbol, outcome: 'order_failed', detail });
      continue;
    }

    try {
      if (orderResult.ok || orderResult.dryRun) {
        // 주문은 이미 접수됐다. 시그널은 주문 전에 `executing` 으로 선점돼 있어 이 기록이 실패해도 **재주문은 없다**(T-043).
        // 주문 번호만 연결하고, 실패하면 사람이 맞추도록 경보한다.
        try {
          if (!(await recordEntryOrder(pool, signalId, orderResult.orderId ?? null))) {
            throw new Error('연결할 행이 없습니다(시그널이 더는 executing 이 아님)');
          }
        } catch (e) {
          const why = e instanceof Error ? e.message : String(e);
          console.error(`[entry-watcher] 주문 접수 후 주문 번호 기록 실패 signal=${signalId} order=${orderResult.orderId ?? '-'}:`, why);
          sendAlert(
            'warning',
            `⚠️ 진입 주문은 접수됐으나 주문 번호 기록 실패: ${await getSymbolLabel(row.symbol)}`,
            `시그널 #${signalId} · 주문 #${orderResult.orderId ?? '-'}\n사유: ${escapeAlertText(why.slice(0, 160))}\n`
            + '시그널은 executing 으로 잠겨 있어 같은 주문이 다시 나가지는 않습니다. DB 에서 consumed_order_id 를 맞추세요.',
          );
        }

        // 진입 알람 발송 (notify_signal_entry=true 이고 DRY_RUN이 아닌 경우에만)
        if (!orderResult.dryRun && await isEntryNotifyEnabled()) {
          const sideLabel = row.side === 'buy' ? '매수' : '매도';
          const entryReasonLine = (() => {
            if (!row.reasoning) return undefined;
            const lines = row.reasoning.split('\n').map(l => l.trim()).filter(Boolean);
            const aiLine = lines.find(l => l.startsWith('[AI '));
            return (aiLine ?? lines[0])?.slice(0, 100);
          })();
          const entryBodyLines = [
            `${sideLabel} 진입 구간 도달 → 주문 실행`,
            `현재가: ${fmtKrw(currentPrice)}원 · 구간: ${fmtKrw(zoneLo)}~${fmtKrw(zoneHi)}원`,
            `주문번호: ${orderResult.orderId ?? '-'}`,
            entryReasonLine ? `사유: ${entryReasonLine}` : undefined,
          ].filter(Boolean);
          sendAlert('info', `🎯 진입 실행: ${await getSymbolLabel(row.symbol)}`, entryBodyLines.join('\n'));
        }

        // 사용자 시나리오 진입: position_state에 scenario_exit·holding_deadline 기록
        if (row.indicators) {
          try {
            const ind = (typeof row.indicators === 'string'
              ? JSON.parse(row.indicators) : row.indicators) as Record<string, unknown>;
            const aiBlock = ind?.['ai'] as Record<string, unknown> | undefined;
            const scenarioBlock = aiBlock?.['scenario'] as Record<string, unknown> | undefined;
            const exitObj = scenarioBlock?.['exit'] as Record<string, unknown> | undefined;
            if (exitObj) {
              const targetLo = Number(exitObj['target_pct']    ?? exitObj['target_pct_lo']  ?? 0);
              const targetHi = Number(exitObj['target_pct_hi'] ?? targetLo);
              const stopLo   = Math.abs(Number(exitObj['stop_pct']    ?? exitObj['stop_pct_lo']  ?? 0));
              const stopHi   = Math.abs(Number(exitObj['stop_pct_hi'] ?? stopLo));
              if (targetLo > 0 && stopLo > 0) {
                const sc: ScenarioExitParams = { targetLo, targetHi, stopLo, stopHi };
                const holdingDeadline = resolveHoldingDeadline(exitObj);
                await setPositionScenarioExit(row.symbol, sigMarket, sc, holdingDeadline).catch(e =>
                  console.warn(`[entry-watcher] setPositionScenarioExit failed ${row.symbol}:`, e),
                );
              }
            }
          } catch { /* indicators 파싱 실패 무시 */ }
        }

        results.push({
          signalId,
          symbol: row.symbol,
          outcome: 'submitted',
          detail: `orderId=${orderResult.orderId ?? 'dry_run'} price=${currentPrice}`,
        });
      } else if (orderResult.outcomeUnknown === true) {
        // 🔴 T-042/T-043 — 접수 여부를 알 수 없는 실패(송신 중 예외·연결 끊김·5xx, 접수 직후 DB 갱신 실패).
        //    시그널은 **주문 전에 이미 `executing` 으로 선점**돼 있어 다음 틱에 같은 주문이 다시 나가지 않는다 — 되돌리지 않는다.
        //    확인용으로 주문 번호만 연결하고, 사람에게 체결내역 확인을 요청한다.
        let recordNote = '';
        try {
          if (!(await recordEntryOrder(pool, signalId, orderResult.orderId ?? null))) {
            throw new Error('연결할 행이 없습니다(시그널이 더는 executing 이 아님)');
          }
        } catch (e) {
          recordNote = ' (주문 번호 연결에는 실패했으니 consumed_order_id 도 직접 맞추세요)';
          console.error(`[entry-watcher] 결과 불명 주문 번호 기록 실패 signal=${signalId}:`, e instanceof Error ? e.message : String(e));
        }
        const uncertainDetail = orderResult.error ?? 'unknown';
        sendAlert(
          'critical',
          `⚠️ 진입 주문 결과 불명 — 체결내역 확인 필요: ${await getSymbolLabel(row.symbol)}`,
          `시그널 #${signalId} ${row.side === 'buy' ? '매수' : '매도'} · 주문 #${orderResult.orderId ?? '-'}\n`
          + `사유: ${escapeAlertText(String(uncertainDetail).slice(0, 160))}\n`
          + `거래소에 주문이 접수됐는지 알 수 없어 같은 주문이 다시 나가지 않도록 시그널을 주문 전에 잠가 두었습니다${recordNote}. `
          + 'KIS 체결/미체결 내역을 확인하세요 (docs/telegram-approval.md §6.1).',
        );
        results.push({ signalId, symbol: row.symbol, outcome: 'order_uncertain', detail: uncertainDetail });
      } else {
        // 확정 거부(킬스위치·한도·심볼 차단·잔고 부족 등) — 주문이 나가지 않았다. 선점을 되돌려 다음 틱에 다시 본다(가격·잔고가 바뀔 수 있다).
        await giveBackEntryClaim(pool, signalId, row.symbol);
        results.push({
          signalId,
          symbol: row.symbol,
          outcome: 'order_failed',
          detail: orderResult.error ?? orderResult.blockedBy ?? 'unknown',
        });
      }
    } catch (e) {
      // 🔴 T-043 — 주문 **결과를 받은 뒤** 후처리(알림·포지션 기록 등)에서 난 예외. 주문은 나갔을 수 있으므로 **선점을 되돌리지 않는다**
      // (되돌리면 다음 틱에 같은 주문이 다시 나간다). 결과에 따라 분류하고 사람이 확인하도록 경보한다.
      const why = e instanceof Error ? e.message : String(e);
      console.error(`[entry-watcher] 주문 후처리 예외(선점 유지) signal=${signalId} order=${orderResult.orderId ?? '-'}:`, why);
      const outcome: WatchResult['outcome'] = (orderResult.ok || orderResult.dryRun)
        ? 'submitted'
        : (orderResult.outcomeUnknown === true ? 'order_uncertain' : 'order_failed');
      results.push({ signalId, symbol: row.symbol, outcome, detail: `post_order_error: ${why}` });
      if (outcome !== 'order_failed') {
        // 라벨 조회 등 추가 비동기 호출 없이 보낸다 — 이 분기에서 다시 던지면 틱 전체가 중단된다.
        sendAlert(
          'warning',
          `⚠️ 진입 주문 후처리 예외: ${escapeAlertText(row.symbol)}`,
          `시그널 #${signalId} · 주문 #${orderResult.orderId ?? '-'}\n사유: ${escapeAlertText(why.slice(0, 160))}\n`
          + '주문 결과는 받았고 시그널은 executing 으로 잠겨 있습니다(재주문 없음). 알림·포지션 기록이 빠졌을 수 있으니 확인하세요.',
        );
      }
    }
  }

  const submitted = results.filter(r => r.outcome === 'submitted').length;
  const expired   = results.filter(r => r.outcome === 'expired').length;
  const blocked   = results.filter(r => r.outcome === 'blocked_by_prior_split').length;
  // T-020 — 1주 미만 스킵을 회차 요약에 싣는다. 개별 로그(`SIZING_BELOW_MIN_QTY`)만 있으면
  // "이번 틱에 몇 건이 그렇게 빠졌는가"를 세려면 로그 전체를 훑어야 한다.
  const belowMin  = results.filter(r => r.outcome === 'quantity_below_min').length;
  // T-043 — 선점 패배·결과 불명도 회차 요약에 싣는다(둘 다 평소엔 0 이라 보이면 눈에 띈다).
  const claimLost = results.filter(r => r.outcome === 'claim_lost').length;
  const uncertain = results.filter(r => r.outcome === 'order_uncertain').length;
  console.log(
    `[cron/entry-watcher] total=${rows.length} submitted=${submitted} expired=${expired} ` +
    `out_of_zone=${results.filter(r => r.outcome === 'out_of_zone').length} blocked_prior=${blocked}` +
    (belowMin > 0 ? ` below_min_qty=${belowMin}` : '') +
    (claimLost > 0 ? ` claim_lost=${claimLost}` : '') +
    (uncertain > 0 ? ` order_uncertain=${uncertain}` : ''),
  );

  return NextResponse.json({ ok: true, processed: rows.length, results });
}
