/**
 * T-108 C-5 — 진입 감시 취소 확인 대화상자(가이드 §2.4.2). 요청은 이전과 같은 `DELETE /api/signals/{id}`(본문 없음).
 * `window.confirm`·`alert` 는 더 쓰지 않는다. 주문 선점 중(executing) 줄에는 취소 버튼이 없다.
 */
import * as ReactNS from 'react';
import { createElement as h } from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

(globalThis as unknown as { React: typeof ReactNS }).React = ReactNS;
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn(), replace: jest.fn() }) }));
jest.mock('@/components/ui/Toast', () => ({ useToast: () => ({ show: jest.fn() }) }));
jest.mock('@/lib/hooks/useFxRate', () => ({ useFxRate: () => 1400 }));
jest.mock('@/lib/hooks/useSymbolMeta', () => ({ useSymbolMeta: () => ({ meta: {}, displaySymbol: (s: string) => s, marketFlag: () => '' }) }));

import {
  cancelWatch, watchCancelBody, watchCancelErrorText, WatchCancelBody, WatchCancelButtons, WATCH_CANCEL_TITLE,
} from '@/app/recommend/WatchCancelSheet';
import { SheetFrame } from '@/components/ui/Sheet';
import { TradeNowPanel } from '@/app/recommend/TradeNowPanel';

const res = (body: unknown, bad = false, status = 200) => ({ status, json: bad ? async () => { throw new SyntaxError('x'); } : async () => body });
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

describe('cancelWatch — 요청 불변 + 결과 3갈래', () => {
  test('DELETE /api/signals/{id} (본문 없음) · ok → ok', async () => {
    const f = jest.fn().mockResolvedValue(res({ ok: true }));
    await expect(cancelWatch(401, f as unknown as typeof fetch)).resolves.toEqual({ kind: 'ok' });
    expect(f.mock.calls).toEqual([['/api/signals/401', { method: 'DELETE' }]]);
  });
  test('404(not found or not cancellable) → gone · 그 밖 4xx → fail · 5xx → unknown (서버 원문은 결과에 싣지 않는다)', async () => {
    const f = (status: number, body: unknown) => jest.fn().mockResolvedValue(res(body, false, status)) as unknown as typeof fetch;
    await expect(cancelWatch(1, f(404, { ok: false, error: 'not found or not cancellable' }))).resolves.toEqual({ kind: 'gone' });
    await expect(cancelWatch(1, f(400, { ok: false, error: 'invalid id' }))).resolves.toEqual({ kind: 'fail' });
    await expect(cancelWatch(1, f(500, { ok: false, error: 'ER_LOCK' }))).resolves.toEqual({ kind: 'unknown' });
  });
  test('fetch throw · JSON 아님 → unknown(「그대로」라고 말하지 않는다)', async () => {
    await expect(cancelWatch(1, jest.fn().mockRejectedValue(new TypeError('x')) as unknown as typeof fetch)).resolves.toEqual({ kind: 'unknown' });
    await expect(cancelWatch(1, jest.fn().mockResolvedValue(res(null, true)) as unknown as typeof fetch)).resolves.toEqual({ kind: 'unknown' });
  });
});

describe('문구', () => {
  test('제목·본문·버튼', () => {
    expect(WATCH_CANCEL_TITLE).toBe('진입 감시를 취소하고 시나리오를 삭제할까요?');
    expect(watchCancelBody({ name: '삼성전자', market: 'domestic', side: 'buy' })).toBe('삼성전자 국내 매수 감시 · 취소하면 이 시나리오로는 주문이 나가지 않습니다.');
    expect(watchCancelBody({ name: 'INTC', market: 'overseas', side: 'sell' })).toBe('INTC 해외 매도 감시 · 취소하면 이 시나리오로는 주문이 나가지 않습니다.');
    const html = renderToStaticMarkup(h(SheetFrame, {
      title: WATCH_CANCEL_TITLE, onClose: () => {}, busy: false,
      footer: h(WatchCancelButtons, { busy: false, onKeep: () => {}, onConfirm: () => {} }),
      children: h(WatchCancelBody, { target: { id: 1, name: 'A', market: 'domestic', side: 'buy' }, busy: false, error: null }),
    }));
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(text(html)).toContain('진입 감시를 취소하고 시나리오를 삭제할까요?');
    expect(html).toContain('<button type="button" class="btn">취소하지 않음</button>');
    expect(html).toContain('<button type="button" class="btn dz">감시 취소</button>');
  });
  test('실패·사라짐·알 수 없음 문구 — 영문 원문 없음, 사라진 감시에 「그대로」라고 하지 않음', () => {
    expect(watchCancelErrorText({ kind: 'fail' })).toBe('! 취소하지 못했습니다 · 잠시 후 다시 시도하세요 — 감시는 그대로입니다');
    expect(watchCancelErrorText({ kind: 'gone' })).toBe('이미 사라졌거나 주문 처리 중이라 취소할 수 없는 감시입니다 — 목록을 새로 고쳤습니다.');
    expect(watchCancelErrorText({ kind: 'gone' })).not.toContain('그대로');
    expect(watchCancelErrorText({ kind: 'unknown' })).toBe('! 연결이 끊겼습니다 — 취소됐는지 알 수 없습니다. 목록을 새로 고쳐 확인하세요.');
    for (const k of ['fail', 'gone', 'unknown'] as const) expect(watchCancelErrorText({ kind: k })).not.toMatch(/[A-Za-z]{3,}/);
  });
  test('처리 중 — 두 버튼 비활성 + 「처리 중…」', () => {
    const b = renderToStaticMarkup(h(WatchCancelButtons, { busy: true, onKeep: () => {}, onConfirm: () => {} }));
    expect(b.match(/disabled=""/g)).toHaveLength(2);
    const body = renderToStaticMarkup(h(WatchCancelBody, { target: { id: 1, name: 'A', market: 'domestic', side: 'buy' }, busy: true, error: null }));
    expect(text(body)).toContain('처리 중… (다시 누를 수 없음)');
  });
});

describe('운용 현황 배선', () => {
  // 주석은 코드가 아니다 — TypeScript 파서로 주석을 뺀 출력을 본다(t108-terms-fence 와 같은 방식)
  const path = join(__dirname, '..', 'app', 'recommend', 'TradeNowPanel.tsx');
  const SRC = ts.createPrinter({ removeComments: true }).printFile(ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX));
  test('window.confirm·alert 를 쓰지 않는다 · DELETE 는 cancelWatch 한 곳', () => {
    expect(SRC).not.toMatch(/window\.confirm|\balert\(/);
    expect(SRC).not.toMatch(/method:\s*'DELETE'/);
  });
  test('주문 선점 중(executing) 줄에는 감시 취소 버튼이 없다', () => {
    const trade = {
      generatedAt: '2026-10-30T16:20:00+09:00',
      counts: { state: 'ok', data: { approval: { domestic: 0, overseas: 0 }, detected: 0, watching: { domestic: 0, overseas: 0 }, executing: 1, nextSession: 0, preOrderBlockedToday: 0 } },
      executing: { state: 'ok', data: [{ id: 9, symbol: 'NAS:MU', market: 'overseas', side: 'buy', since: null }] },
      blockedPostMarket: { state: 'ok', data: [] },
      holdings: { state: 'error', error: 'x' }, openOrders: { state: 'ok', data: [] },
    };
    const html = renderToStaticMarkup(h(TradeNowPanel, { stage: 'live', trade: trade as never, tradeStatus: 'ok' }));
    expect(text(html)).toContain('NAS:MU 해외 · 주문 여부 확인 필요');
    expect(text(html)).toContain('KIS 체결 내역 먼저 확인 · 확인 전 재주문 금지');
    expect(html).not.toContain('감시 취소');
  });
});
