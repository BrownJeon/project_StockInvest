/**
 * T-130 5번 — 주문 상세의 「차단 사유」 는 영문 분류 코드(`order_limit`)가 아니라 사전의 말(`1회 주문 한도 초과`).
 * `OrderDetail` 은 상세 데이터를 fetch 로 받아 useState 에 담는다 — useState 를 목으로 바꿔 상세가 이미 들어온 상태를 한 번 그린다.
 */
import * as ReactNS from 'react';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const mockStateQueue: unknown[] = [];
jest.mock('react', () => {
  const actual = jest.requireActual('react');
  return { ...actual, useState: (init: unknown) => (mockStateQueue.length > 0 ? [mockStateQueue.shift(), () => {}] : actual.useState(init)) };
});
jest.mock('@/lib/hooks/useSymbolMeta', () => ({ useSymbolMeta: () => ({ meta: {}, displaySymbol: (s: string) => `종목${s}`, marketFlag: () => '' }) }));
(globalThis as unknown as { React: typeof ReactNS }).React = ReactNS;

import { OrderDetail } from '@/components/OrderDetail';
import type { Order } from '@/types/order';

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

function render(order: Partial<Order>): string {
  const full: Order = {
    id: 1, client_order_id: 'c1', exchange_order_id: null, asset_class: 'stock', symbol: '005930', side: 'buy', type: 'limit',
    price: '70000', quantity: '1', amount_krw: null, status: 'blocked', blocked_by: null, source: 'manual',
    created_at: '2026-10-30T06:26:00.000Z', updated_at: '2026-10-30T06:26:00.000Z', ...order,
  };
  mockStateQueue.length = 0;
  mockStateQueue.push({ order: full, executions: [], logs: [] }, null, false, false);   // detail · signal · loading · cancelling
  return text(renderToStaticMarkup(h(OrderDetail, { orderId: 1, onClose: () => {}, onCancelDone: () => {} })));
}

describe('주문 상세 › 차단 사유 (T-130 5번)', () => {
  test.each([
    ['kill_switch', '모든거래차단 ON'], ['validation_gate', '검증 관문'], ['order_limit', '1회 주문 한도 초과'], ['daily_limit', '일일 누적 한도 초과'],
    ['symbol_not_allowed', '거래 차단 종목'], ['vol_block', '변동폭 가드 · 차단 임계'], ['vol_panic', '변동폭 가드 · 패닉 임계'], ['invalid_side', '주문 방향 오류'],
  ])('%s → 차단 사유: %s', (code, want) => {
    const t = render({ blocked_by: code });
    expect(t).toContain(`차단 사유: ${want}`);
    expect(t).not.toContain(code);
  });
  test('모르는 코드는 「알 수 없는 사유」 — 영문 코드를 그대로 보이지 않는다', () => {
    const t = render({ blocked_by: 'brand_new_code' });
    expect(t).toContain('차단 사유: 알 수 없는 사유');
    expect(t).not.toContain('brand_new_code');
  });
  test('차단 사유가 없는 주문(blocked_by 없음)에는 「차단 사유」 줄을 그리지 않는다(지금과 같음)', () => {
    expect(render({ blocked_by: null })).not.toContain('차단 사유');
  });
});
