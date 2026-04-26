import { Dashboard } from '@/components/dashboard/Dashboard';
import { getAllowedSymbols } from '@/lib/symbols';

export const dynamic = 'force-dynamic';

export default function HomePage() {
  const allowed = getAllowedSymbols();
  const defaultSymbol = allowed[0] ?? '005930';
  return <Dashboard allowedSymbols={allowed} defaultSymbol={defaultSymbol} />;
}
