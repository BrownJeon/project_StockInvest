/** Real TradeNowPanel SSR, synthetic data only. Optional HTML output for browser QA. */
import * as ReactNS from 'react';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const mockStateQueue: unknown[] = [];
jest.mock('react', () => {
  const actual = jest.requireActual('react');
  return { ...actual, useState: (init: unknown) => mockStateQueue.length ? [mockStateQueue.shift(), () => {}] : actual.useState(init) };
});
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('@/components/ui/Toast', () => ({ useToast: () => ({ show: jest.fn() }) }));
jest.mock('@/lib/hooks/useFxRate', () => ({ useFxRate: () => 1400 }));
jest.mock('@/lib/hooks/useSymbolMeta', () => ({ useSymbolMeta: () => ({ displaySymbol: (s: string) => s, marketFlag: () => '' }) }));
(globalThis as unknown as { React: typeof ReactNS }).React = ReactNS;
import { TradeNowPanel, type TradeNowProps } from '@/app/recommend/TradeNowPanel';
import type { TradeDTO } from '@/lib/ops/metrics/types';
import { HINT_TEXT } from '@/components/dashboard/decision-outcome';
const NOW = Date.parse('2026-11-08T15:00:00+09:00');
type Row = Extract<TradeDTO['executing'], {state:'ok'}>['data'][number];
const row = (orderStatus?: string | null, consumedOrderId: number | null = 92001, since: string | null = null): Row => ({
  id: consumedOrderId ?? 9, symbol:'샘플 델타', market:'overseas', side:'buy', since, orderStatus, consumedOrderId,
});
function trade(rows: Row[] = []): TradeDTO {
  return { generatedAt:new Date(NOW).toISOString(),
    counts:{state:'ok',data:{approval:{domestic:0,overseas:0},detected:0,watching:{domestic:0,overseas:0},executing:rows.length,nextSession:0,preOrderBlockedToday:0}},
    executing:{state:'ok',data:rows},blockedPostMarket:{state:'ok',data:[]},holdings:{state:'error',error:'fixture'},openOrders:{state:'ok',data:[]},
  };
}
function render(tr: TradeDTO | null, over: Partial<TradeNowProps> = {}, states: unknown[] = [[],[],false,null,null,null,null]): string {
  mockStateQueue.length=0; mockStateQueue.push(...states);
  return renderToStaticMarkup(h(TradeNowPanel,{stage:'observe',trade:tr,tradeStatus:'ok',onRetryTrade:()=>{},...over}));
}
const text=(html:string)=>html.replace(/<[^>]+>/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ');
const watch=(html:string)=>{const t=text(html);return t.slice(t.indexOf('진입 감시'),t.indexOf('전략 상태'));};
beforeEach(()=>jest.spyOn(Date,'now').mockReturnValue(NOW));
afterEach(()=>jest.restoreAllMocks());

test.each([['accepted','주문 접수됨 #92001'],['partially_filled','부분체결 #92001'],['dry_run','테스트 #92001 · 실주문 아님']])('%s uses recorded result without entry-zone claim', (status,label)=>{
 const html=render(trade([row(status)]));expect(text(html)).toContain(label);expect(html).not.toContain('진입 구간 도달');expect(html).not.toContain('감시 취소');
});
test.each(['pending','unknown','rejected','failed','blocked',null,undefined])('number with %s never asserts acceptance',status=>{
 const w=watch(render(trade([row(status)]))); expect(w).toContain('주문 여부 확인 필요 #92001');expect(w).toContain(HINT_TEXT);expect(w).not.toContain('주문 접수됨');
});
test.each([[9,'주문 처리 중…'],[10,'주문 처리 중…'],[11,'주문 여부 확인 필요 · 11분째'],[-5,'주문 처리 중…'],[-6,'주문 여부 확인 필요']])('no number boundary %s minutes', (minutes,label)=>{
 expect(watch(render(trade([row(null,null,new Date(NOW-Number(minutes)*60000).toISOString())])))).toContain(label);
});
test('old DTO fields and unknown timestamp remain check; zero requires successful counts',()=>{
 const old={id:9,symbol:'구버전',market:'domestic',side:'buy',since:null} as Row;
 expect(watch(render(trade([old])))).toContain('주문 여부 확인 필요');
 const tr=trade();tr.counts={state:'error',error:'timeout'};
 const w=watch(render(tr));expect(w).toContain('집계를 확인하지 못했습니다');expect(w).toContain('비어 있는 것이 아닙니다');expect(w).not.toContain('✓ 확인된 0');expect(w).toContain('다시 시도');
});
test('summary includes exact approved order-claim and next-session counts; errors are unknown',()=>{
 const tr=trade([row('accepted')]);if(tr.counts.state!=='ok')throw new Error('fixture');tr.counts.data.nextSession=4;
 expect(watch(render(tr))).toContain('감시 중 0 · 주문 선점 1 · 다음 세션 4');
 tr.counts={state:'error',error:'timeout'};expect(watch(render(tr))).toContain('감시 중 — · 주문 선점 — · 다음 세션 —');
});
test('count error preserves visible rows; list error/loading/unauthorized never means zero',()=>{
 const tr=trade([row('accepted')]);tr.counts={state:'error',error:'db_error'};
 expect(watch(render(tr))).toContain('주문 접수됨');expect(watch(render(tr))).toContain('집계를 확인하지 못했습니다');
 for(const code of ['timeout','unauthorized']){
  const bad=trade();bad.executing={state:'error',error:code};expect(watch(render(bad))).not.toContain('✓ 확인된 0');
 }
 expect(watch(render(null,{tradeStatus:'loading'},[[],[],true,null,null,null,null]))).toContain('확인 중…');
});
test.each(['stale','error'] as const)('retained response %s shows update failure alongside rows',status=>{
 const w=watch(render(trade([row('accepted')]),{tradeStatus:status,tradeError:'timeout'}));expect(w).toContain('주문 접수됨');expect(w).toContain('새로 고치지 못했습니다');
 expect(watch(render(trade(),{tradeStatus:status,tradeError:'timeout'}))).not.toContain('✓ 확인된 0');
});
test('next poll replaces accepted with partial, then terminal-filtered empty DTO; source fixtures preserved',()=>{
 const first=trade([row('accepted')]); const before=JSON.stringify(first);
 expect(watch(render(first))).toContain('주문 접수됨');
 expect(watch(render(trade([row('partially_filled')]),{reloadKey:1}))).toContain('부분체결');
 const done=watch(render(trade(),{reloadKey:2}));expect(done).toContain('진입 감시 없음');expect(done).toContain('✓ 확인된 0');expect(done).not.toContain('샘플 델타');
 expect(JSON.stringify(first)).toBe(before);
});
test('optional browser fixtures render real component and actual global/ops CSS, no app server/API',()=>{
 const out=process.env.T162_FIXTURE_OUTPUT;if(!out)return;
 mkdirSync(out,{recursive:true});
 const fixtures:Record<string,()=>string>={
  closed:()=>render(trade()),
  active:()=>render(trade([row('accepted',92001),{...row('partially_filled',92002),symbol:'샘플 엡실론'},{...row('dry_run',92003),symbol:'샘플 제타'}])),
  unknown:()=>render(trade([row('pending',93001),{...row(null,93002),symbol:'샘플 세타'}])),
  boundary:()=>render(trade([9,10,11,null,-6].map((n,i)=>({...row(null,null,n===null?null:new Date(NOW-n*60000).toISOString()),id:i,symbol:`시간 경계 ${i+1}`})))),
  countsError:()=>{const tr=trade();tr.counts={state:'error',error:'timeout'};return render(tr);},
  error:()=>{const tr=trade();tr.executing={state:'error',error:'timeout'};return render(tr);},
  unauthorized:()=>{const tr=trade();tr.executing={state:'error',error:'unauthorized'};return render(tr);},
  loading:()=>render(null,{tradeStatus:'loading'},[[],[],true,null,null,null,null]),
 };
 const css=readFileSync(join(process.cwd(),'src/app/globals.css'),'utf8')+'\n'+readFileSync(join(process.cwd(),'src/components/ops/ops.module.css'),'utf8').replace(/:global\(([^)]+)\)/g,'$1');
 const links=Object.keys(fixtures).map(k=>`<a href="${k}.html">${k}</a>`).join(' · ');
 for(const [name,fn]of Object.entries(fixtures))writeFileSync(join(out,`${name}.html`),`<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>T-162 ${name}</title><style>${css}</style><body><nav style="padding:16px">합성 SSR 검증 · ${links}</nav><main>${fn()}</main></body></html>`);
 writeFileSync(join(out,'index.html'),`<!doctype html><meta charset="utf-8"><h1>T-162 synthetic SSR fixtures</h1>${links}`);
});
