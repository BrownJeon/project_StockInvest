'use client';

import { useEffect, useState } from 'react';
import { PortfolioTab }          from './components/PortfolioTab';
import { OrderHistoryTab }       from './components/OrderHistoryTab';
import { MissedOpportunityTab }  from './components/MissedOpportunityTab';
import { SignalDiagnosticsTab }  from './components/SignalDiagnosticsTab';
import { TradeJournalTab }       from './components/TradeJournalTab';
import { TrailingStopTab }       from './components/TrailingStopTab';
import { LeaderboardTab }        from './components/LeaderboardTab';
import { ResearchTab }           from './components/ResearchTab';

type Tab = 'portfolio' | 'trailing' | 'leaderboard' | 'notes' | 'research' | 'missed' | 'orders' | 'diagnostics';

const TABS: { id: Tab; label: string }[] = [
  { id: 'research',    label: '리서치분석'  },
  { id: 'portfolio',   label: '포트폴리오'  },
  { id: 'trailing',    label: '포지션 추적' },
  { id: 'leaderboard', label: '주도주'      },
  { id: 'notes',       label: '투자일지'    },
  { id: 'missed',      label: '놓친 기회'   },
  { id: 'orders',      label: '거래 이력'   },
  { id: 'diagnostics', label: '신호 진단'   },
];

const TAB_IDS = new Set<string>(TABS.map(t => t.id));

export function AnalyticsPage() {
  const [tab, setTab] = useState<Tab>('research');

  /* `?tab=orders` 딥링크 (대시보드 "최근 주문 → 전체 보기").
     `useSearchParams()`는 Suspense 경계를 요구하므로, 마운트 후 1회 읽어
     hydration mismatch 없이 초기 탭만 맞춘다. */
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get('tab');
    if (requested && TAB_IDS.has(requested)) setTab(requested as Tab);
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {/* Sub-nav */}
      <div style={{
        display: 'flex', gap: 6, padding: '10px 16px',
        borderBottom: '1px solid var(--border)',
        overflowX: 'auto', scrollbarWidth: 'none', minWidth: 0,
        position: 'sticky', top: 0, zIndex: 5, background: 'var(--bg)',
      }}>
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              flexShrink: 0, padding: '6px 14px', borderRadius: 20, fontSize: 13, fontWeight: 600,
              background: tab === t.id ? 'var(--accent)' : 'var(--bg3)',
              color: tab === t.id ? '#000' : 'var(--muted)',
              border: 'none', cursor: 'pointer',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ padding: '12px 16px' }}>
        {tab === 'portfolio'   && <PortfolioTab />}
        {tab === 'trailing'    && <TrailingStopTab />}
        {tab === 'leaderboard' && <LeaderboardTab />}
        {tab === 'notes'       && <TradeJournalTab />}
        {tab === 'research'    && <ResearchTab />}
        {tab === 'missed'      && <MissedOpportunityTab />}
        {tab === 'orders'      && <OrderHistoryTab />}
        {tab === 'diagnostics' && <SignalDiagnosticsTab />}
        <div style={{ height: 16 }} />
      </div>
    </div>
  );
}
