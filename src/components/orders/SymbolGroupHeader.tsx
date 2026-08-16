'use client';

import { formatGroupSummary } from '@/lib/orders/group-orders';

/**
 * 종목 그룹 접기/펼치기 헤더 — 거래 이력·대시보드 최근 주문 공용.
 *
 * 모바일 우선: 최소 높이 44px 터치 타겟, 종목명은 남는 폭을 먹고 말줄임,
 * 요약(`3건 · 09:12~14:30`)은 `flexShrink:0`으로 412px에서도 잘리지 않는다.
 */
export function SymbolGroupHeader({
  flag, name, count, firstAt, lastAt, expanded, onToggle, controlsId, style, nameStyle,
}: {
  /** 시장 국기 이모지. 빈 문자열이면 렌더하지 않음 */
  flag?: string;
  /** 표시용 종목명 (`종목명 (코드)`) */
  name: string;
  count: number;
  firstAt: string | null;
  lastAt: string | null;
  expanded: boolean;
  onToggle: () => void;
  /** 펼쳐지는 영역의 DOM id — `aria-controls` 연결용 */
  controlsId: string;
  /** 화면별 여백·배경 override */
  style?: React.CSSProperties;
  nameStyle?: React.CSSProperties;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      aria-controls={controlsId}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        width: '100%', minHeight: 44, textAlign: 'left',
        background: 'transparent', border: 'none', color: 'var(--text)',
        cursor: 'pointer', ...style,
      }}
    >
      <span aria-hidden style={{
        flexShrink: 0, fontSize: 10, color: 'var(--muted)', width: 10,
        display: 'inline-block', transition: 'transform .15s',
        transform: expanded ? 'rotate(90deg)' : 'none',
      }}>▶</span>

      <span style={{
        flex: '1 1 auto', minWidth: 0, fontSize: 14, fontWeight: 700,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        ...nameStyle,
      }}>
        {flag && <span style={{ marginRight: 4 }} aria-hidden>{flag}</span>}
        {name}
      </span>

      <span className="num" style={{
        flexShrink: 0, fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap',
      }}>
        {formatGroupSummary({ count, firstAt, lastAt })}
      </span>
    </button>
  );
}
