/**
 * T-062 WP-U — 렌더 시험 (react-dom/server 정적 마크업, jsdom 불필요).
 * 승인 데모 v2 장면 1(추천 탭 카드)·2(내일 탭)·3(승인 화면 조각)·4(하단 고정 문구)·Q-g(폴백)의
 * **문구·순서·존재 여부**를 fixture(G10)로 고정한다. 픽셀·폭(360/412)은 QA 캡처 몫.
 */
import * as ReactNS from 'react';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// jest 의 swc 변환은 고전 JSX 런타임(`React.createElement`)으로 컴파일한다 — 앱 파일은 React 를 import 하지
// 않으므로(Next 는 자동 런타임) 시험에서만 전역으로 넣어 준다. 렌더 시점에 참조되므로 import 호이스팅과 무관.
(globalThis as unknown as { React: typeof ReactNS }).React = ReactNS;

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn(), back: jest.fn() }) }));
// Dashboard.tsx 가 함께 import 하는 무거운 화면 모듈 — TomorrowScenarioTab 렌더에는 쓰지 않는다.
jest.mock('@/components/CandleChart', () => ({ CandleChart: () => null }));
jest.mock('@/components/TradingBoard', () => ({ TradingBoard: () => null }));
jest.mock('@/components/dashboard/EvalFunnelCard', () => ({ EvalFunnelCard: () => null }));
jest.mock('@/components/dashboard/MyDecisionSection', () => ({ MyDecisionSection: () => null }));
jest.mock('@/components/dashboard/RecentExecutionsSection', () => ({ RecentExecutionsSection: () => null }));
jest.mock('@/components/ui/Toast', () => ({ useToast: () => ({ show: jest.fn() }) }));

import { ScenarioCard, type SignalWithScenario } from '@/components/ScenarioCard';
import { TomorrowScenarioTab, type TomorrowSignal } from '@/components/dashboard/Dashboard';
import { OverseasDetailLines, AiEntryZoneBox } from '@/components/ScenarioDetail';
import { sortScenarioCards, gradeOf, confidenceOf, parseIndicators } from '@/components/scenario-card-display';
import { T062_FIXTURE, T062_TOMORROW, T062_SCENE4, cmcsaWithoutUsd, type FixtureRow } from './fixtures/t062-signals-fixture';
import { useForeignHost } from './fixtures/host-sim';

// R-5: 로컬 시각 = UTC, 기본 로케일 = de-DE 흉내 아래에서 렌더한다(host-sim.ts).
useForeignHost();

/** 태그를 지운 화면 글자(공백 정규화). */
function text(html: string): string {
  return html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
}

function card(row: FixtureRow, extra: Partial<SignalWithScenario> = {}): string {
  const signal = { ...row, marketFlag: row.market === 'overseas' ? '🇺🇸' : '🇰🇷', displayName: row.symbol, ...extra } as unknown as SignalWithScenario;
  return renderToStaticMarkup(h(ScenarioCard, { signal }));
}

const byId = (id: number) => T062_FIXTURE.find(r => r.id === id)!;

describe('장면 1 — 추천 탭 ScenarioCard', () => {
  test('해외 CMCSA (indicators 문자열): 미국 배지·약 100,000원·B+ 74%·정규장 줄·노랑 실적 줄·목표', () => {
    const html = card(byId(106), { displayName: 'CMCSA' });
    const t = text(html);
    expect(t).toContain('매수· 약 100,000원');
    expect(t).toContain('🇺🇸미국');
    expect(t).toContain('B+ 74%');
    expect(t).toContain('+4% 목표');
    expect(t).toContain('price_zone· 3일'); // G11-⑤: 트리거 내부 값 노출은 v2 그대로(후속 후보)
    expect(t).toContain('미국 정규장 10-21(수) 22:30 ~ 10-22(목) 05:00 KST');
    expect(t).toContain('⚠ 실적 발표 추정 기간과 겹침 · 10-24 ~ 10-31 (추정, 미확정)');
    expect(html).toContain('<span aria-hidden="true">🇺🇸</span>미국');
    expect(html).toContain('<span aria-hidden="true">⚠</span>');
    expect(html).toContain('color:var(--warn)');
    expect(t).not.toContain('100000.00');
  });
  test('해외 BAC: 회색 실적 "없음" 줄, A 82%', () => {
    const t = text(card(byId(105)));
    expect(t).toContain('A 82%');
    expect(t).toContain('실적 일정: 앞으로 5거래일 안 없음 (추정치 기준 · 확정일 미입력)');
  });
  test('해외 전략 시그널 PFE (indicators null): 배지·금액만, 등급·정규장·실적 없음', () => {
    const html = card(byId(107));
    const t = text(html);
    expect(t).toContain('🇺🇸미국');
    expect(t).toContain('약 100,000원');
    expect(t).not.toMatch(/미국 정규장|실적|%/);
  });
  test('국내 005930: 🇰🇷 국기·미국 배지 없음·정규장/실적 줄 없음, 금액·신뢰도만 추가', () => {
    const html = card(byId(103), { displayName: '삼성전자 (005930)' });
    const t = text(html);
    expect(html).toContain('<span aria-hidden="true" style="flex-shrink:0">🇰🇷</span>');
    expect(t).not.toContain('미국');
    expect(t).not.toContain('실적');
    expect(t).toContain('A 81%');
    expect(t).toContain('약 100,000원');
    expect(t).toContain('+3% 목표');
  });
  test('R-4 등급은 있고 ai.confidence 가 없는 카드 → 배지는 "B+" 만 ("B+ %"·"B+ null%" 아님)', () => {
    const row: FixtureRow = {
      ...byId(102),
      indicators: { ai: { scenario: { grade: 'B+' } } }, // 목표% 줄이 없도록 exit 없음 — '%' 는 배지에서만 나올 수 있다
    };
    const html = card(row, { displayName: 'LG전자 (066570)' });
    expect(html).toMatch(/border:1px solid rgba\(99,102,241,\.4\)">B\+<\/span>/);
    expect(text(html)).not.toContain('%');
    expect(text(html)).not.toContain('null');
    // 신뢰도가 정의 밖 값("74" 문자열)이어도 같은 모양
    const html2 = card({ ...row, indicators: { ai: { confidence: '74', scenario: { grade: 'B+' } } } });
    expect(text(html2)).not.toMatch(/%|74/);
  });
  test('market 없는 구 응답(=배포 전 API)도 심볼로 해외 판정', () => {
    const { market: _m, ...noMarket } = byId(105);
    void _m;
    expect(text(card(noMarket as FixtureRow))).toContain('🇺🇸미국');
  });
});

describe('장면 2 — "내일" 탭 TomorrowScenarioTab', () => {
  function tab(rows: FixtureRow[], meta: Record<string, string> = { '005930': '삼성전자' }): string {
    return renderToStaticMarkup(h(TomorrowScenarioTab, {
      signals: rows as unknown as TomorrowSignal[], symbolMeta: meta, onSelectSymbol: () => {},
    }));
  }
  test('정렬 라벨 1줄 + 순서 BAC, 삼성전자, CMCSA, LG전자(066570), NFLX, 카카오(035720)', () => {
    const t = text(tab(T062_TOMORROW));
    expect(t.startsWith('정렬: 평가등급순 (같은 등급은 신뢰도 높은 순)')).toBe(true);
    const order = ['BAC', '삼성전자 (005930)', 'CMCSA', '066570', 'NFLX', '035720'].map(s => t.indexOf(s));
    expect(order.every(i => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(t).not.toContain('PFE');
  });
  test('해외 카드: 미국 배지·짧은 심볼·진입 $ ≈ 원·정규장 줄·실적 줄', () => {
    const t = text(tab(T062_TOMORROW));
    expect(t).toContain('🇺🇸미국CMCSA');
    expect(t).not.toContain('NAS:CMCSA');
    expect(t).toContain('진입 $27.20 ~ $27.60 ≈ 36,176 ~ 36,708원');
    expect(t).toContain('진입 $41.30 ~ $41.90 ≈ 54,929 ~ 55,727원');
    expect(t).toContain('미국 정규장 10-21(수) 22:30 ~ 10-22(목) 05:00 KST');
    expect(t).toContain('⚠ 실적 발표 추정 기간과 겹침 · 10-24 ~ 10-31 (추정, 미확정)');
  });
  test('국내 카드: "진입 가능: … KST" 줄·원 구간 문자열 그대로', () => {
    const html = tab(T062_TOMORROW);
    const t = text(html);
    expect(t).toContain('진입 71200~72500');
    expect((t.match(/진입 가능: /g) ?? []).length).toBe(3); // 국내 3장만 — 해외는 정규장 줄로 교체
  });
  test('해외 카드가 없으면 하단 고정 문구 없음, 있으면(장면 4) 있음', () => {
    const domesticOnly = T062_TOMORROW.filter(r => r.market === 'domestic');
    expect(text(tab(domesticOnly))).not.toContain('미국 카드는');
    const t4 = text(tab(T062_SCENE4));
    expect(t4.endsWith('미국 카드는 매일 08:00 분석 · 1주 가격이 100,000원 이하인 종목만 만들어집니다(보유·관심 종목 중 비싼 종목은 나오지 않음).')).toBe(true);
  });
  test('Q-g 폴백: price_zone_usd 없는 CMCSA → "진입 36,176 ~ 36,708원"', () => {
    const t = text(tab([cmcsaWithoutUsd()]));
    expect(t).toContain('진입 36,176 ~ 36,708원');
    expect(t).not.toContain('$');
  });
  test('빈 상태 문구 변화 없음', () => {
    const t = text(tab([]));
    expect(t).toBe('📭내일 시나리오 시그널이 없습니다.장 마감 후 (KST 16:00) 자동으로 분석됩니다.');
  });
  test('indicators 를 객체로 줘도(문자열 아님) 같은 화면', () => {
    const asObj = T062_TOMORROW.map(r => ({ ...r, indicators: parseIndicators(r.indicators) }));
    expect(text(tab(asObj))).toBe(text(tab(T062_TOMORROW)));
  });
});

describe('장면 3 — 승인 화면 조각 (ScenarioDetail)', () => {
  const cmcsa = byId(106);
  test('해외 CMCSA: 유효 줄 + 노랑 실적 줄', () => {
    const t = text(renderToStaticMarkup(h(OverseasDetailLines, { validFrom: cmcsa.valid_from, expiresAt: cmcsa.expires_at, indicators: parseIndicators(cmcsa.indicators) })));
    expect(t).toBe('유효: 미국 정규장 10-21(수) 22:30 ~ 10-22(목) 05:00 KST⚠ 실적 발표 추정 기간과 겹침 · 10-24 ~ 10-31 (추정, 미확정)');
  });
  test('해외 CMCSA: AI 권장 진입 구간 달러 + 원화 보조 줄', () => {
    const t = text(renderToStaticMarkup(h(AiEntryZoneBox, { overseas: true, indicators: cmcsa.indicators, domesticZone: '36176~36708' })));
    expect(t).toBe('AI 권장 진입 구간: $27.20 ~ $27.60≈ 36,176 ~ 36,708원 · 카드 환율 1,330 (10-21 08:00) · 자동 진입은 이 원화 구간으로 판단');
  });
  test('G11-② 해외 전략 시그널(price_zone_usd 없음) → 원화 단위 표기 폴백', () => {
    const t = text(renderToStaticMarkup(h(AiEntryZoneBox, { overseas: true, indicators: cmcsaWithoutUsd().indicators, domesticZone: '36176~36708' })));
    expect(t).toBe('AI 권장 진입 구간: 36,176 ~ 36,708원');
  });
  test('국내: 기존 마크업 그대로', () => {
    const html = renderToStaticMarkup(h(AiEntryZoneBox, { overseas: false, indicators: byId(103).indicators, domesticZone: '71200~72500' }));
    expect(html).toBe('<div style="font-size:12px;color:var(--muted);padding:6px 10px;border-radius:8px;background:var(--bg2);border:1px solid var(--border)">AI 권장 진입 구간: <span class="num" style="color:var(--accent);font-weight:700">71200~72500</span></div>');
    expect(renderToStaticMarkup(h(AiEntryZoneBox, { overseas: false, indicators: null, domesticZone: null }))).toBe('');
  });
  test('키 없음 → 아무것도 그리지 않음', () => {
    expect(renderToStaticMarkup(h(OverseasDetailLines, { validFrom: null, expiresAt: null, indicators: null }))).toBe('');
    expect(renderToStaticMarkup(h(AiEntryZoneBox, { overseas: true, indicators: null, domesticZone: null }))).toBe('');
  });
});

describe('추천 탭 정렬 결과 (page.tsx 와 같은 호출) — Q-a', () => {
  test('BAC, 삼성전자, CMCSA, LG전자, NFLX, 카카오, PFE', () => {
    const sorted = sortScenarioCards(T062_FIXTURE, s => ({ grade: gradeOf(s.indicators), confidence: confidenceOf(s.indicators) }));
    expect(sorted.map(s => s.id)).toEqual([105, 103, 106, 102, 104, 101, 107]);
  });
});
