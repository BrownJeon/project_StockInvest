import type { ReactNode } from 'react';

export type StatusKind = 'warn' | 'ok' | 'na' | 'info';

/**
 * 상태 어휘 — 색 + 기호 + 글자 (데모 v3 `st()`). 위험·미달·초과·오류는 amber.
 * 기호는 aria-hidden, 뜻은 글자로 전달한다.
 */
export function StatusText({ kind, icon, children }: { kind: StatusKind; icon: string; children: ReactNode }) {
  return (
    <span className={`st ${kind}`}>
      <i aria-hidden="true">{icon}</i>
      <span>{children}</span>
    </span>
  );
}

/** 표시·위험 계산·알림 배지 (T-068 데모 v5 — 손절가 도달 텔레그램 알림이 생겼지만 주문·매도는 없다) */
export function DisplayOnlyBadge() {
  return <span className="mode disp">◌ 표시·위험 계산·알림 (주문·매도 없음)</span>;
}
