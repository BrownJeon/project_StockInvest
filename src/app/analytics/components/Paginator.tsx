export function Paginator({
  page,
  totalPages,
  onPage,
}: {
  page: number;
  totalPages: number;
  onPage: (p: number) => void;
}) {
  if (totalPages <= 1) return null;
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, paddingTop: 4 }}>
      <button
        onClick={() => onPage(Math.max(0, page - 1))}
        disabled={page === 0}
        style={{
          padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600,
          background: 'var(--bg3)',
          color: page === 0 ? 'var(--border)' : 'var(--muted)',
          border: '1px solid var(--border)',
          cursor: page === 0 ? 'not-allowed' : 'pointer',
        }}
      >
        ← 이전
      </button>
      <span style={{ fontSize: 12, color: 'var(--muted)', minWidth: 50, textAlign: 'center' }}>
        {page + 1} / {totalPages}
      </span>
      <button
        onClick={() => onPage(Math.min(totalPages - 1, page + 1))}
        disabled={page >= totalPages - 1}
        style={{
          padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600,
          background: 'var(--bg3)',
          color: page >= totalPages - 1 ? 'var(--border)' : 'var(--muted)',
          border: '1px solid var(--border)',
          cursor: page >= totalPages - 1 ? 'not-allowed' : 'pointer',
        }}
      >
        다음 →
      </button>
    </div>
  );
}
