'use client';

import { useState } from 'react';
import { PortfolioTab }       from './components/PortfolioTab';
import { StrategyTab }        from './components/StrategyTab';
import { StrategyHistoryTab } from './components/StrategyHistoryTab';
import { AuditLog }           from './components/AuditLog';
import { OrderHistoryTab }    from './components/OrderHistoryTab';
import { VolatilityTab }          from './components/VolatilityTab';
import { MissedOpportunityTab }  from './components/MissedOpportunityTab';
import { SignalDiagnosticsTab }  from './components/SignalDiagnosticsTab';
import { MyDecisionTab }         from './components/MyDecisionTab';

type Tab = 'portfolio' | 'orders' | 'strategy' | 'strategy-history' | 'audit' | 'volatility' | 'missed' | 'diagnostics' | 'my-decisions';

const TABS: { id: Tab; label: string }[] = [
  { id: 'portfolio',        label: '포트폴리오' },
  { id: 'my-decisions',     label: '내 결정'    },
  { id: 'missed',           label: '놓친 기회'  },
  { id: 'orders',           label: '거래 이력'  },
  { id: 'volatility',       label: '변동폭'     },
  { id: 'strategy',         label: '전략 성과'  },
  { id: 'strategy-history', label: '분석 이력'  },
  { id: 'diagnostics',      label: '신호 진단'  },
  { id: 'audit',            label: '거래 로그'  },
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
        {tab === 'portfolio'        && <PortfolioTab />}
        {tab === 'orders'           && <OrderHistoryTab />}
        {tab === 'strategy'         && <StrategyTab />}
        {tab === 'strategy-history' && <StrategyHistoryTab />}
        {tab === 'audit'            && <AuditLog />}
        {tab === 'volatility'       && <VolatilityTab />}
        {tab === 'missed'           && <MissedOpportunityTab />}
        {tab === 'diagnostics'      && <SignalDiagnosticsTab />}
        {tab === 'my-decisions'     && <MyDecisionTab />}
        <div style={{ height: 16 }} />
      </div>
    </div>
  );
}
