'use client';

/**
 * T-108 분석 탭(`/analytics`) — 짧은 머리 띠(MiniStrip) → 세그먼트(오늘 분석 · 검증·성과 · 데이터 상태) → 본문/상세 (가이드 §2.5·§1.2).
 *
 * 옛 8탭은 사라지지 않는다: 5개(리서치분석·주도주·놓친 기회·신호 진단·포트폴리오)는 세그먼트 안 「상세 보기」로 **수정 없이** 그리고,
 * 3개(거래 이력·투자일지·포지션 추적)는 거래 탭으로 옮겨 갔다 — 옛 `?tab=orders|notes|trailing` 은 거래 탭 상세로 `router.replace`.
 * 모르는 `?tab=` 은 조용히 오늘 분석.
 *
 * `?tab=` 딥링크: `useSearchParams()` 는 Suspense 경계를 요구하므로 화면 전체가 아니라 빈 조각(`UrlQuerySync`)만 감싸
 * 주소를 읽는다 — 본문은 hydration 불일치 없이 서버 렌더 그대로, 하단 탭 재탭·뒤로 가기에도 주소를 따른다.
 * 화면 안 이동은 상태 + `router.replace('?tab=…', { scroll: false })`.
 */
import { Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useSymbolMeta } from '@/lib/hooks/useSymbolMeta';
import { useSafetyState } from '@/components/ops/useSafetyState';
import { MiniStrip, SegmentControl } from '@/components/ops/ui';
import { ops } from '@/components/ops/ui/styles';
import { PortfolioTab }          from './components/PortfolioTab';
import { MissedOpportunityTab }  from './components/MissedOpportunityTab';
import { SignalDiagnosticsTab }  from './components/SignalDiagnosticsTab';
import { LeaderboardTab }        from './components/LeaderboardTab';
import { ResearchTab }           from './components/ResearchTab';
import { ANALYTICS_DETAILS, ANALYTICS_SEGMENTS, analyticsQuery, resolveAnalyticsRoute, type AnalyticsDetail, type AnalyticsSegment } from './route-resolve';
import { M40PaperPanel } from './M40PaperPanel';
import { TodayPanel } from './TodayPanel';
import { VerifyPanel } from './VerifyPanel';
import { DataPanel } from './DataPanel';
import { DetailHead, UrlQuerySync } from '@/app/recommend/InPageRow';

export const ANALYTICS_SEG_ID_PREFIX = 'ana-seg';

interface View { seg: AnalyticsSegment; detail: AnalyticsDetail | null }

function segText(seg: AnalyticsSegment): string {
  return ANALYTICS_SEGMENTS.find(s => s.id === seg)?.text ?? '';
}

export function AnalyticsPage() {
  const router = useRouter();
  const [view, setView] = useState<View>({ seg: 'today', detail: null });
  const [stripH, setStripH] = useState(0);
  const [m40SegmentH, setM40SegmentH] = useState(0);
  const m40Segments = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (view.detail !== 'm40') return;
    const node = m40Segments.current;
    if (!node) return;
    const measure = () => setM40SegmentH(node.getBoundingClientRect().height);
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(node);
    window.addEventListener('resize', measure);
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure); };
  }, [view.detail]);
  const previousDetail = useRef<AnalyticsDetail | null>(null);
  useEffect(() => {
    const previous = previousDetail.current;
    previousDetail.current = view.detail;
    if (view.detail === 'm40') {
      const heading = document.getElementById('m40-detail-title');
      if (!heading) return;
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
      const tabs = document.querySelector('[aria-label="분석 하위 화면"]')?.parentElement;
      const stickyBottom = tabs?.getBoundingClientRect().bottom ?? stripH + 60;
      window.scrollBy({ top: heading.getBoundingClientRect().top - stickyBottom - 12, behavior: 'auto' });
    } else if (previous === 'm40' && view.detail === null && view.seg === 'today') {
      document.querySelector<HTMLAnchorElement>('a[href="?tab=m40"]')?.focus();
    }
    // Focus changes only when entering/leaving this detail, not on safety-strip polls.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.detail, view.seg]);

  const safety = useSafetyState();
  const { displaySymbol } = useSymbolMeta();

  // 주소 → 화면: 처음 열 때·하단 「분석」 재탭·뒤로/앞으로 (UrlQuerySync). 거래로 옮겨 간 옛 탭은 거래 상세로 replace.
  const onQuery = useCallback((q: URLSearchParams) => {
    const r = resolveAnalyticsRoute(q.get('tab'));
    if (r.kind === 'redirect') { router.replace(r.href); return; }
    setView(r.kind === 'detail' ? { seg: r.seg, detail: r.detail } : { seg: r.seg, detail: null });
  }, [router]);

  const go = useCallback((next: View) => {
    setView(next);
    router.replace(analyticsQuery(next), { scroll: false });
  }, [router]);
  const goDetail = useCallback((detail: AnalyticsDetail) => go({ seg: ANALYTICS_DETAILS[detail].seg, detail }), [go]);

  const stage = safety.dto?.stage ?? (safety.view.kind === 'error' ? 'unknown' : null);

  let body: ReactNode;
  if (view.detail) {
    const d = ANALYTICS_DETAILS[view.detail];
    body = (
      <>
        <DetailHead id={view.detail === 'm40' ? 'm40-detail-title' : undefined} segText={segText(d.seg)} title={d.title} onBack={() => go({ seg: d.seg, detail: null })} />
        <div style={{ padding: view.detail === 'm40' ? 0 : '12px 16px' }}>
          {view.detail === 'm40' && <M40PaperPanel stickyTop={stripH + m40SegmentH} />}
          {view.detail === 'portfolio'   && <PortfolioTab />}
          {view.detail === 'leaderboard' && <LeaderboardTab />}
          {view.detail === 'research'    && <ResearchTab />}
          {view.detail === 'missed'      && <MissedOpportunityTab />}
          {view.detail === 'diagnostics' && <SignalDiagnosticsTab />}
          <div style={{ height: 16 }} />
        </div>
      </>
    );
  } else if (view.seg === 'verify') {
    body = <VerifyPanel stage={stage} onGoDetail={goDetail} />;
  } else if (view.seg === 'data') {
    body = <DataPanel />;
  } else {
    body = <TodayPanel stage={stage} displaySymbol={displaySymbol} onGoDetail={goDetail} />;
  }

  return (
    // --strip-h: 머리 띠 높이 — 세그먼트(.subnav sticky)가 띠 바로 아래에 붙는다(띠·세그먼트·본문을 같은 wrapper 에).
    <div style={{ display: 'flex', flexDirection: 'column', ['--strip-h' as string]: `${stripH}px` }}>
      <Suspense fallback={null}><UrlQuerySync onChange={onQuery} /></Suspense>
      <MiniStrip title="분석" state={safety.view} onHeightChange={setStripH} />
      {view.detail === 'm40' ? (
        <div ref={m40Segments} className={ops.subnav} style={{ position: 'sticky', top: stripH, zIndex: 5, background: 'var(--bg)' }}>
          <SegmentControl label="분석 하위 화면" idPrefix={ANALYTICS_SEG_ID_PREFIX}
            items={ANALYTICS_SEGMENTS} value={view.seg} onChange={(seg) => go({ seg, detail: null })} />
        </div>
      ) : (
      <SegmentControl
        label="분석 하위 화면" sticky idPrefix={ANALYTICS_SEG_ID_PREFIX}
        items={ANALYTICS_SEGMENTS} value={view.seg}
        onChange={(seg) => go({ seg, detail: null })}
      />
      )}
      {body}
    </div>
  );
}
