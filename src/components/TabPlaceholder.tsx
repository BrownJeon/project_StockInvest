export function TabPlaceholder({ title, phase, items }: { title: string; phase: string; items: string[] }) {
  return (
    <main style={{ padding: '20px 16px' }}>
      <h1 style={{ fontSize: 20, margin: '8px 0 4px' }}>{title}</h1>
      <p style={{ color: 'var(--muted)', fontSize: 12, margin: 0 }}>{phase}</p>
      <ul style={{ marginTop: 20, padding: 0, listStyle: 'none', display: 'grid', gap: 10 }}>
        {items.map((it) => (
          <li key={it} style={{
            padding: '12px 14px', background: 'var(--bg2)', border: '1px solid var(--border)',
            borderRadius: 10, fontSize: 13, color: 'var(--muted)',
          }}>
            {it}
          </li>
        ))}
      </ul>
    </main>
  );
}
