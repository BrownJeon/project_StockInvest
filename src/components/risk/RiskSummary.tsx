import type { RiskComputed } from '@/lib/risk/compute';
import type { RiskPolicyEditable } from '@/lib/risk/defaults';
import { StatusText } from './StatusText';
import { basisLabel } from './draft';
import { kstHm, kstMdHm, p2, pv, won } from './fmt';

/** 안전장치 영역 요약 행의 본문 (데모 v3 `sumHtml`) */
export function RiskSummary({ state, c, eff, policySaved, snapshotAt, stale, saving = false, dirty = false }: {
  state: 'loading' | 'error' | 'ready';
  c: RiskComputed | null;
  eff: RiskPolicyEditable;
  policySaved: boolean;
  snapshotAt: string | null;
  stale: boolean;
  saving?: boolean;
  dirty?: boolean;
}) {
  if (state === 'loading') return <span role="status">불러오는 중…</span>;
  if (state === 'error' || !c) return <StatusText kind="warn" icon="!">불러오지 못했습니다 — 눌러서 다시 확인</StatusText>;
  const tag = saving ? <> <span className="pv">저장 중</span></> : (dirty || !policySaved) ? <> <span className="pv">저장 전 값</span></> : null;
  return (
    <>
      <div className="l1">
        <span>
          손절폭 <b className="num">{pv(eff.stopPct)}%</b> ({basisLabel(eff.stopBasis)} 기준) · 손절 합 한도 <b className="num">{pv(eff.heatCapPct)}%</b>
        </span>
        {!policySaved && <StatusText kind="warn" icon="!">정책 미저장</StatusText>}
      </div>
      <div aria-live="polite">
        {c.heatPct === null
          ? <StatusText kind="na" icon="—">손절 합 — 총자산을 몰라 계산 불가</StatusText>
          : c.over
            ? <StatusText kind="warn" icon="!">손절 합 {p2(c.heatPct)} — 한도 초과</StatusText>
            : <StatusText kind="ok" icon="✓">손절 합 {p2(c.heatPct)} — 한도 이내</StatusText>}{' '}
        <span className="num" style={{ color: 'var(--muted)' }}>(≈{won(c.heatKrw)})</span>
        {tag}
      </div>
      {c.belowCount > 0 && (
        <div>
          <StatusText kind="warn" icon="!">이미 손절가 아래 {c.belowCount}종목</StatusText>{' '}
          <span style={{ color: 'var(--muted)' }}>평가손 {won(c.belowLossKrw)}</span>
        </div>
      )}
      {c.partial && <div><StatusText kind="na" icon="—">일부 계산 불가 {c.rows.length - c.computableCount}종목</StatusText></div>}
      <div style={{ color: 'var(--muted)' }}>
        {snapshotAt ? `현재가 기준 ${stale ? `${kstMdHm(snapshotAt)} (오래됨)` : `${kstHm(snapshotAt)} 스냅샷`}` : '포트폴리오 스냅샷 없음'}
      </div>
    </>
  );
}
