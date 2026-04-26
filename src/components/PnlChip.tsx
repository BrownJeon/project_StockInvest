import { fmtPnl, pnlColor } from '@/lib/format';

export function PnlChip({ value, size = 'sm' }: { value: number; size?: 'sm' | 'md' }) {
  const color = pnlColor(value);
  const fontSize = size === 'md' ? 13 : 12;
  return (
    <span className="num" style={{ color, fontSize, fontWeight: 600 }}>
      {fmtPnl(value)}
    </span>
  );
}
