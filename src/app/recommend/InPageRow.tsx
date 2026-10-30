'use client';

/**
 * T-108 §1.2 — 거래·분석 화면 안의 「상세 보기」 입구와 상세 머리.
 *
 * 화면은 마운트 때 `window.location.search` 를 한 번 읽고(hydration 이유 — `AnalyticsPage` 기존 주석), 그 뒤로는 상태로 움직인다.
 * 그래서 화면 안 입구는 Next `<Link>` 대신 **진짜 주소를 가진 `<a>`** 로 두고, 보통 클릭만 가로채 부모의 `onGo`(상태 변경 +
 * `router.replace`)를 부른다 — 새 탭·주소 복사는 그대로 된다. 모양은 데모 `row()`(56px 줄) 그대로(`ops.rowl`).
 */
import { useEffect, useRef, type MouseEvent, type ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';
import { cx, ops } from '@/components/ops/ui';

/**
 * 주소 쿼리 → 화면 상태 동기화(R-UI). 마운트 때 한 번뿐 아니라 하단 탭 재탭(`/recommend` 로 이동)·뒤로/앞으로 때도
 * 세그먼트가 주소를 따른다. `useSearchParams()` 는 Suspense 경계가 필요하므로 **이 빈 조각만** `<Suspense>` 로 감싸
 * 쓴다(화면 본문은 서버 렌더 그대로 — 옛 「마운트 후 1회 읽기」의 hydration 이유를 지킨다).
 */
export function UrlQuerySync({ onChange }: { onChange: (q: URLSearchParams) => void }) {
  const sp = useSearchParams();
  const key = sp ? sp.toString() : '';
  const cb = useRef(onChange);
  cb.current = onChange;
  useEffect(() => { cb.current(new URLSearchParams(key)); }, [key]);
  return null;
}

function plainClick(e: MouseEvent<HTMLElement>): boolean {
  return !e.defaultPrevented && e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
}

export function InPageRow(p: { href: string; onGo: () => void; glyph: ReactNode; title: ReactNode; sub?: ReactNode; severity?: 'e' | 'w' | 'i' | 'n' }) {
  const sev = !p.severity || p.severity === 'n' ? null : ops[p.severity];
  return (
    <a
      href={p.href}
      className={ops.rowl}
      onClick={(e) => { if (plainClick(e)) { e.preventDefault(); p.onGo(); } }}
    >
      <span className={cx(ops.ic, sev)} aria-hidden="true">{p.glyph}</span>
      <span>
        <span className={ops.t}>{p.title}</span>
        {p.sub ? <span className={ops.s}>{p.sub}</span> : null}
      </span>
      <span className={ops.r}>›</span>
    </a>
  );
}

/** 섹션 머리 오른쪽 「전체 ›」 같은 화면 안 이동(데모 `lnk()` 모양, 44px). */
export function InPageLink(p: { href: string; onGo: () => void; children: ReactNode; ariaLabel?: string }) {
  return (
    <a
      href={p.href}
      className={ops.lnk}
      aria-label={p.ariaLabel}
      onClick={(e) => { if (plainClick(e)) { e.preventDefault(); p.onGo(); } }}
    >
      {p.children} ›
    </a>
  );
}

/** 상세 보기 머리 — `‹ {세그먼트 이름}`(44px, 누르면 그 세그먼트 목록) + 제목. */
export function DetailHead(p: { segText: string; title: string; onBack: () => void; id?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 12px 4px 4px', borderBottom: '1px solid var(--border)', background: 'var(--bg)' }}>
      <button
        type="button"
        onClick={p.onBack}
        aria-label={`${p.segText} 목록으로`}
        style={{ minHeight: 44, minWidth: 44, padding: '0 10px', fontSize: 13, fontWeight: 600, color: 'var(--muted)', whiteSpace: 'nowrap' }}
      >
        ‹ {p.segText}
      </button>
      <h2 id={p.id} style={{ margin: 0, fontSize: 15, fontWeight: 700, minWidth: 0, overflowWrap: 'anywhere' }}>{p.title}</h2>
    </div>
  );
}
