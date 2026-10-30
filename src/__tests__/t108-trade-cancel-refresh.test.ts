/**
 * T-108 R-UI-N2 — 진입 감시 취소 성공 직후 서버 집계(/api/ops/trade)도 바로 다시 읽는다.
 * 그러지 않으면 마지막 감시를 지운 뒤 60초 동안 「목록과 집계가 다릅니다 · 감시 중 1」이 「취소했습니다」 토스트와 모순된다.
 * 방식: useState·useEffect·useCallback 만 감싸 `TradeNowPanel()` 을 직접 불러(jsdom 없음) 대화상자 요소의 onCancelled 를 부른다.
 */
import * as ReactNS from 'react';

const hook: { queue: unknown[]; setters: jest.Mock[] } = { queue: [], setters: [] };
jest.mock('react', () => {
  const actual = jest.requireActual('react');
  return {
    ...actual,
    useState: (init: unknown) => {
      const v = hook.queue.length > 0 ? hook.queue.shift() : (typeof init === 'function' ? (init as () => unknown)() : init);
      const set = jest.fn(); hook.setters.push(set); return [v, set];
    },
    useEffect: () => undefined,
    useCallback: (fn: unknown) => fn,
    useRef: (init: unknown) => ({ current: init }),
  };
});
const toastShow = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn(), replace: jest.fn() }) }));
jest.mock('@/components/ui/Toast', () => ({ useToast: () => ({ show: toastShow }) }));
jest.mock('@/lib/hooks/useFxRate', () => ({ useFxRate: () => 1400 }));
jest.mock('@/lib/hooks/useSymbolMeta', () => ({ useSymbolMeta: () => ({ meta: {}, displaySymbol: (s: string) => s, marketFlag: () => '' }) }));
(globalThis as unknown as { React: typeof ReactNS }).React = ReactNS;

import { TradeNowPanel } from '@/app/recommend/TradeNowPanel';
import { WatchCancelSheet } from '@/app/recommend/WatchCancelSheet';

type El = { type: unknown; props: Record<string, unknown> & { children?: unknown } };
const isEl = (n: unknown): n is El => !!n && typeof n === 'object' && 'props' in (n as object);
function findType(n: unknown, t: unknown): El | null {
  if (Array.isArray(n)) { for (const x of n) { const f = findType(x, t); if (f) return f; } return null; }
  if (!isEl(n)) return null;
  if (n.type === t) return n;
  return findType(n.props.children, t);
}

test('취소 성공 → 목록에서 지우고·토스트·거래 지표 즉시 재조회(onRetryTrade) 1회', () => {
  const PENDING = [{ id: 7, symbol: '005930', side: 'buy', market: 'domestic', indicators: '{}', expires_at: '2026-10-31T06:30:00.000Z', created_at: '2026-10-30T00:00:00.000Z' }];
  // useState 순서: signals · pendingEntry · loading · blockBanner · listError · cancelTarget · pendingError
  hook.queue = [[], PENDING, false, null, null, { id: 7, name: '005930', market: 'domestic', side: 'buy' }, null];
  hook.setters = [];
  const onRetryTrade = jest.fn();
  const tree = TradeNowPanel({ stage: 'observe', onRetryTrade });
  const sheet = findType(tree, WatchCancelSheet);
  expect(sheet).not.toBeNull();
  (sheet!.props.onCancelled as (id: number) => void)(7);
  expect(onRetryTrade).toHaveBeenCalledTimes(1);
  expect(toastShow).toHaveBeenCalledWith('진입 감시를 취소했습니다', 'success');
  const setPending = hook.setters[1];
  const next = (setPending.mock.calls[0][0] as (p: unknown[]) => unknown[])(PENDING);
  expect(next).toEqual([]);
});
