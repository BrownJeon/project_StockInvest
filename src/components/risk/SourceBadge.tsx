import type { PolicySource } from '@/lib/risk/defaults';

/** 정책 값 출처 배지 (데모 v3 `src()`) */
export function SourceBadge({ source }: { source: PolicySource }) {
  if (source === 'user') return <span className="src user">✓ 사용자 확정</span>;
  if (source === 'proposal') return <span className="src prop">◇ 제안 · 승인 전</span>;
  return <span className="src doc">§ 문서 정책</span>;
}
