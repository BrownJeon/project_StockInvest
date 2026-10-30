'use client';

/**
 * T-108 거래 탭(`/recommend`) 틀 — 안전 상태 띠 → 세그먼트(운용 현황 · 보유·주문 · 운영 기록) → 본문/상세 (가이드 §2.4·§1.2).
 *
 *  - 주소: `UrlQuerySync`(Suspense 로 감싼 빈 조각 — `useSearchParams`)가 처음 열 때·하단 「거래」 재탭·뒤로/앞으로 때 주소를 읽어
 *    `resolveTradeRoute` 로 맞춘다. 세그먼트·상세 이동은 상태를 바꾸고 `router.replace('?tab=…', { scroll: false })`(이력 안 쌓음).
 *  - 데이터: 안전 상태 `/api/ops/safety-state`(30초, 실패하면 마지막 값을 버림 — useSafetyState)와 거래 지표 `/api/ops/trade`(60초)를
 *    **여기서 한 번만** 읽어 패널에 넘긴다. `/api/settings/safety` GET 은 부르지 않는다(비어 있으면 INSERT 하는 라우트 — §0.1-6).
 *  - 상세 보기는 옛 분석 탭 컴포넌트를 **수정 없이** 그린다(주문 기록 전체·투자일지·포지션 추적).
 */
import { Suspense, useCallback, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useSymbolMeta } from '@/lib/hooks/useSymbolMeta';
import type { TradeDTO } from '@/lib/ops/metrics/types';
import { useOpsPoll } from '@/components/ops/useOpsPoll';
import { useSafetyState } from '@/components/ops/useSafetyState';
import { SafetyStrip, SegmentControl } from '@/components/ops/ui';
import { OrderHistoryTab } from '@/app/analytics/components/OrderHistoryTab';
import { TradeJournalTab } from '@/app/analytics/components/TradeJournalTab';
import { TrailingStopTab } from '@/app/analytics/components/TrailingStopTab';
import { TRADE_DETAILS, TRADE_SEGMENTS, resolveTradeRoute, tradeQuery, type TradeRoute, type TradeSegment } from './route-resolve';
import { TradeNowPanel } from './TradeNowPanel';
import { TradeHoldPanel } from './TradeHoldPanel';
import { TradeLogPanel } from './TradeLogPanel';
import { DetailHead, UrlQuerySync } from './InPageRow';

export const TRADE_URL = '/api/ops/trade';
export const TRADE_POLL_MS = 60_000;
export const TRADE_SEG_ID_PREFIX = 'trade-seg';

function segText(seg: TradeSegment): string {
  return TRADE_SEGMENTS.find(s => s.id === seg)?.text ?? '';
}

export function TradePage() {
  const router = useRouter();
  const [route, setRoute] = useState<TradeRoute>({ seg: 'now', detail: null });
  const [stripH, setStripH] = useState(0);
  const safety = useSafetyState();
  const trade = useOpsPoll<TradeDTO>(TRADE_URL, { intervalMs: TRADE_POLL_MS });
  const { displaySymbol } = useSymbolMeta();

  // 주소 → 화면: 처음 열 때·하단 「거래」 재탭·뒤로/앞으로 (UrlQuerySync, Suspense 로 감싼 빈 조각)
  const onQuery = useCallback((q: URLSearchParams) => setRoute(resolveTradeRoute(q.get('tab'), q.get('detail'))), []);

  const go = useCallback((next: TradeRoute) => {
    setRoute(next);
    router.replace(tradeQuery(next), { scroll: false });
  }, [router]);

  const stage = safety.dto?.stage ?? (safety.view.kind === 'error' ? 'unknown' : null);
  const safetyStatus = safety.view.kind;
  // 거래 지표가 새로 읽힐 때마다 목록(승인 대기·진입 감시·주문 기록·내 결정)도 다시 읽는다 — 숫자와 목록이 같은 시점을 보게.
  const reloadKey = trade.lastOkAt ?? 0;

  let body: ReactNode;
  if (route.detail) {
    const d = TRADE_DETAILS[route.detail];
    body = (
      <>
        <DetailHead segText={segText(d.seg)} title={d.title} onBack={() => go({ seg: d.seg, detail: null })} />
        <div style={{ padding: '12px 16px' }}>
          {route.detail === 'orders' && <OrderHistoryTab />}
          {route.detail === 'notes' && <TradeJournalTab />}
          {route.detail === 'trailing' && <TrailingStopTab />}
          <div style={{ height: 16 }} />
        </div>
      </>
    );
  } else if (route.seg === 'hold') {
    body = (
      <TradeHoldPanel
        trade={trade.data} tradeStatus={trade.status} tradeError={trade.error} safety={safety.dto}
        displaySymbol={displaySymbol} onRetry={trade.refresh}
        onGoTrailing={() => go({ seg: 'hold', detail: 'trailing' })}
      />
    );
  } else if (route.seg === 'log') {
    body = (
      <TradeLogPanel
        trade={trade.data} displaySymbol={displaySymbol} reloadKey={reloadKey}
        onGoOrders={() => go({ seg: 'log', detail: 'orders' })}
        onGoNotes={() => go({ seg: 'log', detail: 'notes' })}
      />
    );
  } else {
    body = (
      <TradeNowPanel
        stage={stage} safety={safety.dto} safetyStatus={safetyStatus}
        trade={trade.data} tradeStatus={trade.status} tradeError={trade.error} onRetryTrade={trade.refresh}
        reloadKey={reloadKey}
        returnFocusIds={() => [`${TRADE_SEG_ID_PREFIX}-now`]}
      />
    );
  }

  return (
    // --strip-h: 띠 높이 — 세그먼트(.subnav)가 띠 바로 아래에 붙는다. 띠·세그먼트·본문을 모두 같은 wrapper 안에 둔다.
    <div style={{ display: 'flex', flexDirection: 'column', ['--strip-h' as string]: `${stripH}px` }}>
      <Suspense fallback={null}><UrlQuerySync onChange={onQuery} /></Suspense>
      <SafetyStrip state={safety.view} onRetry={safety.refresh} onHeightChange={setStripH} />
      <SegmentControl
        label="거래 하위 화면" sticky idPrefix={TRADE_SEG_ID_PREFIX}
        items={TRADE_SEGMENTS} value={route.seg}
        onChange={(seg) => go({ seg, detail: null })}
      />
      {body}
    </div>
  );
}
