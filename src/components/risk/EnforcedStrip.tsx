/**
 * 설정 > 안전장치 카드 맨 위 '● 집행 중' 띠 (T-066 데모 v3 `enforcedCard` 의 strip).
 * 안전장치 카드는 실제 주문에 적용되고, 리스크 정책은 표시·위험 계산·알림(주문·매도 없음)임을 나란히 구분하기 위한 표식.
 * SettingsPage 는 인라인 스타일 패턴이라 이 띠도 인라인 스타일로 자립시킨다.
 */
export function EnforcedStrip() {
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
        padding: '8px 16px', borderBottom: '1px solid var(--border)',
        fontSize: 12, color: 'var(--muted)', lineHeight: 1.5,
      }}
    >
      <span
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 700,
          padding: '2px 8px', borderRadius: 6, whiteSpace: 'nowrap', lineHeight: 1.5,
          color: 'var(--ok)', border: '1px solid rgba(34,197,94,.55)', background: 'rgba(34,197,94,.10)',
        }}
      >
        ● 집행 중
      </span>
      <span>이 카드의 설정은 실제 주문에 바로 적용됩니다</span>
    </div>
  );
}
