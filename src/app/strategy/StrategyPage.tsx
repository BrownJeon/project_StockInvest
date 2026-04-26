'use client';

import { useState } from 'react';
import { AnalystStatusBanner }   from './components/AnalystStatusBanner';
import { SignalDecisionLog }     from './components/SignalDecisionLog';
import { StrategyList }          from './components/StrategyList';
import { ActiveOrdersSection }   from './components/ActiveOrdersSection';
import { SkippedSignalLog }      from './components/SkippedSignalLog';
import { TopSymbolsSection }     from './components/TopSymbolsSection';

export default function StrategyPage() {
  const [mgmtOpen, setMgmtOpen] = useState(false);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', paddingBottom: 16 }}>
      {/* Top bar */}
      <div style={{
        padding: '12px 16px 10px', position: 'sticky', top: 0,
        background: 'var(--bg)', zIndex: 10, borderBottom: '1px solid var(--border)',
        flexShrink: 0,
      }}>
        <span style={{ fontSize: 17, fontWeight: 700 }}>🎯 분석가 운영 현황</span>
      </div>

      {/* Analyst status banner */}
      <AnalystStatusBanner />

      {/* Section 1: 시간별 주목 종목 TOP 3 */}
      <TopSymbolsSection />

      {/* Section 2: 운영 이력 */}
      <div style={{ borderTop: '1px solid var(--border)', marginTop: 4 }}>
        <div style={{ padding: '12px 16px 4px', fontSize: 13, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase' as const, letterSpacing: '.5px' }}>
          운영 이력
        </div>
        <SignalDecisionLog />
      </div>

      {/* Section 2: 주문 중 이력 */}
      <ActiveOrdersSection />

      {/* Section 3: Strategy management (collapsible) */}
      <div style={{ borderTop: '1px solid var(--border)', marginTop: 4 }}>
        <button
          onClick={() => setMgmtOpen(v => !v)}
          style={{
            width: '100%', padding: '14px 16px', textAlign: 'left',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            background: 'transparent', border: 'none', cursor: 'pointer',
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase' as const, letterSpacing: '.5px' }}>
            전략 관리
          </span>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>{mgmtOpen ? '▲ 접기' : '▼ 펼치기'}</span>
        </button>

        {mgmtOpen && (
          <div style={{ padding: '0 16px 16px' }}>
            <StrategyList />
          </div>
        )}
      </div>

      {/* AI 스킵 이력 */}
      <SkippedSignalLog />
    </div>
  );
}
