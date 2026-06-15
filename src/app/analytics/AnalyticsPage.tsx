'use client';

import { useState } from 'react';
import { PortfolioTab }          from './components/PortfolioTab';
import { OrderHistoryTab }       from './components/OrderHistoryTab';
import { MissedOpportunityTab }  from './components/MissedOpportunityTab';
import { SignalDiagnosticsTab }  from './components/SignalDiagnosticsTab';
import { TradeJournalTab }       from './components/TradeJournalTab';
import { TrailingStopTab }       from './components/TrailingStopTab';
import { LeaderboardTab }        from './components/LeaderboardTab';

type Tab = 'portfolio' | 'trailing' | 'leaderboard' | 'notes' | 'missed' | 'orders' | 'diagnostics';

const TABS: { id: Tab; label: string }[] = [
  { id: 'portfolio',   label: '포트폴리오' },
  { id: 'trailing',    label: '포지션 추적' },
  { id: 'leaderboard', label: '주도주'      },
  { id: 'notes',       label: '투자일지'    },
  { id: 'missed',      label: '놓친 기회'  },
  { id: 'orders',      label: '거래 이력'  },
  { id: 'diagnostics', label: '신호 진단'  },
];

export function AnalyticsPage() {
  const [tab, setTab] = useState<Tab>('portfolio');

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
        {tab === 'missed'      && <MissedOpportunityTab />}
        {tab === 'orders'      && <OrderHistoryTab />}
        {tab === 'diagnostics' && <SignalDiagnosticsTab />}
        <div style={{ height: 16 }} />
      </div>
    </div>
  );
}
