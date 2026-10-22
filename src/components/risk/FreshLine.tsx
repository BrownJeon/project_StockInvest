'use client';

import { useEffect, useState } from 'react';
import type { PollState } from './useRiskPolicyFeed';
import { kstHm, kstHms, kstMdHm } from './fmt';

/**
 * 현재가·총자산 기준 시각 + 재조회 상태 (데모 v3 `freshHtml`).
 * 다음 확인까지 남은 초는 이 줄만 1초마다 다시 그린다.
 */
export function FreshLine({ snapshotAt, stale, poll, lastCheckAt, nextAt }: {
  snapshotAt: string | null;
  stale: boolean;
  poll: PollState;
  lastCheckAt: number | null;
  nextAt: number | null;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const snap = snapshotAt ? `${stale ? kstMdHm(snapshotAt) : kstHm(snapshotAt)} 스냅샷` : '스냅샷 없음';
  const left = nextAt ? Math.max(0, Math.ceil((nextAt - now) / 1000)) : null;
  const dot = poll === 'busy' ? <span className="dot busy">◌ 갱신 중…</span>
    : poll === 'fail' ? <span className="dot warn">! 재조회 실패 — 마지막 값 유지</span>
    : !snapshotAt ? <span className="dot warn">! 스냅샷 없음</span>
    : stale ? <span className="dot warn">! 오래됨</span>
    : <span className="dot live">● 최신</span>;
  return (
    <div className="fresh">
      <span>
        현재가·총자산 기준 <b className="num" style={{ color: 'var(--text)' }}>{snap}</b>{' '}
        (포트폴리오 스냅샷 · 약 1시간마다 · 3시간 넘으면 오래됨 표시)
      </span>
      <span>
        {dot}
        {lastCheckAt ? ` · ${kstHms(lastCheckAt)} 확인` : ''}
        {left !== null ? <> · 다음 확인 <span className="num">{left}</span>초</> : ' · 화면이 숨겨져 재조회 멈춤'}
      </span>
    </div>
  );
}
