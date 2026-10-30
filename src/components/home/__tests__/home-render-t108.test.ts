/**
 * T-108 B-2 — 홈 화면(승인 데모 v3 `homeScreen()` · 가이드 §2.2~§2.3.7).
 * 합성 DTO × 단계 4(관찰·중지·혼합·실거래) × 데이터 상태 6(정상·첫 배포·빈·로딩·조회 실패·오래됨) → renderToStaticMarkup.
 * 본다: 섹션 순서 · 데모 핵심 문구 · 「0」은 zero 일 때만 · 관찰 단계에 손익 숫자 없음 · 띠 unknown 문구 · 용어(옛 표기 0건).
 * 클릭·포커스·스크롤·가로 넘침은 jest 로 못 본다 → QA 브라우저 확인.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as ReactNS from 'react';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

(globalThis as unknown as { React: typeof ReactNS }).React = ReactNS;
jest.mock('next/navigation', () => ({ usePathname: () => '/', useRouter: () => ({ push: jest.fn(), replace: jest.fn() }) }));

import { HomeView, type HomePoll } from '@/components/home/HomeScreen';
import { AnalysisStageTable } from '@/components/home/AnalysisSection';
import { checkLines, CHECK_ORDER } from '@/components/home/check-copy';
import { buildStripModel, safetyViewFromPoll, type SafetyStateView } from '@/components/ops/safety-view';
import type { AnalysisRunRow, CheckItem, HomeDTO, OpsStage } from '@/lib/ops/metrics/types';
import { emptySentence } from '@/components/home/CheckSection';
import { activitySub } from '@/components/home/ActivitySection';
import { NOW, analysis, homeDTO, safety, type Mode, type Stage4 } from './home-fixtures';

const SRC = path.resolve(__dirname, '../../..');
const STAGES: Stage4[] = ['observe', 'halt', 'mixed', 'live'];
type DataState = Mode | 'loading' | 'error' | 'stale';
const DATA: DataState[] = ['ok', 'first', 'empty', 'loading', 'error', 'stale'];

const textOf = (html: string) => html.replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#x27;/g, "'");
const ok = (stage: Stage4): SafetyStateView => ({ kind: 'ok', dto: safety(stage) });

function poll(stage: Stage4, d: DataState): HomePoll {
  if (d === 'loading') return { status: 'loading', data: null, lastOkAt: null, error: null };
  if (d === 'error') return { status: 'error', data: null, lastOkAt: null, error: 'http_503' };
  if (d === 'stale') return { status: 'stale', data: { ...homeDTO(stage, 'ok'), generatedAt: '2026-10-29T16:05:00+09:00' }, lastOkAt: NOW - 86_000_000, error: 'network' };
  return { status: 'ok', data: homeDTO(stage, d), lastOkAt: NOW, error: null };
}
function render(stage: Stage4, d: DataState, sv?: SafetyStateView) {
  return renderToStaticMarkup(h(HomeView, { safety: sv ?? (d === 'loading' ? { kind: 'loading' } : ok(stage)), home: poll(stage, d), nowMs: NOW }));
}
/** 섹션 하나의 마크업(aria-labelledby 로 찾는다) */
function section(html: string, id: string): string {
  const start = html.indexOf(`aria-labelledby="${id}"`);
  if (start < 0) return '';
  const open = html.lastIndexOf('<section', start);
  const end = html.indexOf('</section>', start);
  return html.slice(open, end + '</section>'.length);
}
const ORDER = ['h-check', 'h-ops', 'h-exit', 'h-ana', 'h-act'];

describe('B-2 섹션 순서 — 띠 → 확인 필요 → 운용현황 → 청산 로직 → 오늘의 분석 → 최근 활동 (24 조합 모두)', () => {
  test.each(STAGES.flatMap((s) => DATA.map((d) => [s, d] as const)))('%s × %s', (s, d) => {
    const html = render(s, d);
    const strip = html.indexOf('class="strip');
    const idx = ORDER.map((id) => html.indexOf(`aria-labelledby="${id}"`));
    expect(html.startsWith('<div class="strip"')).toBe(true);
    expect(idx.every((i) => i > strip)).toBe(true);
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
    // ≥900px 두 열: 왼쪽 = 확인 필요·운용현황·청산, 오른쪽 = 분석·활동
    const cols = html.split('<div class="col">');
    expect(cols).toHaveLength(3);
    expect(cols[1]).toContain('h-check'); expect(cols[1]).toContain('h-ops'); expect(cols[1]).toContain('h-exit');
    expect(cols[2]).toContain('h-ana'); expect(cols[2]).toContain('h-act');
  });
});

describe('B-2 안전 상태 띠 (§2.2)', () => {
  test('관찰: 배지·요약·칩 5개 순서', () => {
    const t = textOf(render('observe', 'ok'));
    expect(t).toContain('관찰 (실거래 차단)');
    expect(t).toContain('신규 매수 차단 — 검증 통과 전략 0/16 · 주문은 기록만(실거래여부 OFF)');
    const html = render('observe', 'ok');
    const chips = [...html.matchAll(/<span role="listitem" class="([^"]*)"><i>([^<]*)<\/i>([^<]*)<\/span>/g)].map((m) => [m[1], m[2], m[3]]);
    expect(chips).toEqual([
      ['sw', '실거래여부', 'OFF · 실거래 차단'], ['sw', '모든거래차단', 'OFF'], ['sw warn', '검증 통과', '0/16'],
      ['sw sep', '청산 엔진', 'ON'], ['sw sep warn', '손실한도 손절', 'OFF'],
    ]);
    expect(html).toContain('<a class="strip-go" aria-label="안전장치 설정 보기" href="/settings">설정 ›</a>');
  });
  test('중지: 모든거래차단 칩이 맨 앞(bad) · 청산 엔진 「ON (송신 차단)」', () => {
    const html = render('halt', 'ok');
    expect(textOf(html)).toContain('중지 (모든거래차단)모든 주문 차단 — 매수·매도·청산 송신 안 함');
    expect(html).toMatch(/<div class="sws" role="list" aria-label="안전 스위치"><span role="listitem" class="sw bad"><i>모든거래차단<\/i>ON · 모든 주문 차단<\/span>/);
    expect(html).toContain('<i>청산 엔진</i>ON (송신 차단)');
  });
  test('혼합: 「실거래 준비 — 매수 차단」 · 청산 엔진 ON · 실주문(bad) · 빨간 줄', () => {
    const html = render('mixed', 'ok');
    const t = textOf(html);
    expect(t).toContain('실거래 준비 — 매수 차단검증 통과 전략 0/16 이라 신규 매수 차단');
    expect(html).toContain('<span role="listitem" class="sw bad"><i>실거래여부</i>ON · 실거래 가능</span>');
    expect(html).toContain('<span role="listitem" class="sw sep bad"><i>청산 엔진</i>ON · 실주문</span>');
    expect(html).toContain('<div class="strip-alert" role="note"><b>청산 주문은 실제로 송신됩니다.</b> 청산 엔진은 검증 관문과 무관합니다 — 원치 않으면 설정 › 안전장치.</div>');
  });
  test('실거래: 「실거래 가능 — 검증 통과 2/16 전략만 신규 매수」 · 빨간 줄 없음', () => {
    const html = render('live', 'ok');
    expect(textOf(html)).toContain('실거래실거래 가능 — 검증 통과 2/16 전략만 신규 매수');
    expect(html).not.toContain('strip-alert');
    expect(html).toContain('<span role="listitem" class="sw"><i>검증 통과</i>2/16</span>');
  });
  test('관찰 + 검증 통과 ≥1 → 「신규 매수 기록만」', () => {
    const dto = { ...safety('observe'), strategies: { total: 16, enabled: 8, validated: 1, validatedEnabled: 1 } };
    expect(buildStripModel(dto)!.summary.bold).toBe('신규 매수 기록만');
  });
  test('청산 엔진 OFF → 「OFF · 자동 청산 없음」(bad) · 손실한도 손절 「— (엔진 OFF)」 · db_error → —', () => {
    const off = buildStripModel({ ...safety('observe'), exitEngine: { enabled: false, hardStopEnabled: false, source: 'config' } })!;
    expect(off.chips.slice(3)).toEqual([
      { name: '청산 엔진', value: 'OFF · 자동 청산 없음', tone: ['sep', 'bad'] },
      { name: '손실한도 손절', value: '— (엔진 OFF)', tone: ['sep'] },
    ]);
    const dbe = buildStripModel({ ...safety('observe'), exitEngine: { enabled: true, hardStopEnabled: false, source: 'db_error' } })!;
    expect(dbe.chips.slice(3).map((c) => c.value)).toEqual(['—', '—']);
    // 혼합 + 엔진 OFF → 빨간 줄 없음(청산 엔진 ON 일 때만)
    expect(buildStripModel({ ...safety('mixed'), exitEngine: { enabled: false, hardStopEnabled: true, source: 'config' } })!.exitLiveAlert).toBe(false);
  });
  test('확인 실패(서버 stage=unknown): 「! 확인 실패」 · 칩 4개 — · [다시] · role=alert · 마지막 확인 시각', () => {
    const sv = safetyViewFromPoll({ status: 'ok', data: safety('unknown'), lastOkAt: NOW, error: null }, '2026-10-30T16:12:00+09:00');
    const html = render('observe', 'ok', sv);
    expect(html).toMatch(/^<div class="strip" role="alert"><div class="strip-h"><span class="stage err"><span class="dot" aria-hidden="true"><\/span>! 확인 실패<\/span>/);
    expect(textOf(html)).toContain('안전 상태를 불러오지 못했습니다 — 주문 송신 여부를 알 수 없습니다 · 마지막 확인 16:12');
    expect(html).toContain('<button type="button" class="strip-go">다시</button>');
    expect(html).toContain('<div class="sws"><span class="sw sep"><i>실거래여부</i>—</span><span class="sw sep"><i>모든거래차단</i>—</span><span class="sw sep"><i>검증 통과</i>—</span><span class="sw sep"><i>청산 엔진</i>—</span></div>');
    expect(html).not.toContain('관찰 (실거래 차단)');
  });
  test('띠 조회 실패(네트워크) → 마지막 값 대신 확인 실패(오래된 안전 값을 보이지 않음) · 확인한 적 없으면 —', () => {
    const sv = safetyViewFromPoll({ status: 'error', data: null, lastOkAt: null, error: 'network' }, null);
    expect(sv).toEqual({ kind: 'error', lastGoodAt: null, code: 'network' });
    expect(textOf(render('observe', 'ok', sv))).toContain('마지막 확인 —');
  });
  test('로딩: 스피너 + 「안전 상태 확인 중…」(aria-busy)', () => {
    const html = render('observe', 'loading');
    expect(html.startsWith('<div class="strip" aria-busy="true"><div class="strip-h"><span class="spin" aria-hidden="true"></span><span class="strip-sum">안전 상태 확인 중…</span>')).toBe(true);
  });
  test('띠 조회 전이면 같은 홈 응답의 안전 상태로 첫 렌더', () => {
    const html = renderToStaticMarkup(h(HomeView, { safety: { kind: 'loading' }, home: poll('halt', 'ok'), nowMs: NOW }));
    expect(textOf(html)).toContain('중지 (모든거래차단)');
  });
});

describe('B-2 확인 필요 (§2.3.2)', () => {
  test('관찰·정상: 표 순서로 다시 정렬 — 손실한도 손절 OFF → 가상 청산 → 데이터 이상', () => {
    const s = section(render('observe', 'ok'), 'h-check');
    const t = textOf(s);
    const a = t.indexOf('손실한도 손절 OFF — 한도 도달 1종목 · 1일째');
    const b = t.indexOf('가상 청산 1건 — 오늘 15:26 장마감 전 손절');
    const c = t.indexOf('국내 뉴스 0건 2일 연속');
    expect(a).toBeGreaterThan(-1); expect(b).toBeGreaterThan(a); expect(c).toBeGreaterThan(b);
    expect(t).toContain('손실 한도에 닿았지만 스위치가 꺼져 손절 시그널을 만들지 않습니다');
    expect(t).toContain('주문은 기록만, 송신 없음 · 텔레그램 자동 제출 알림은 꺼져 있음');
    expect(t).toContain('장마감 분석 입력 품질 저하(degraded)');
    expect(t).toContain('승인 대기 0 · 주문 오류 0 · 기준 16:20');
    expect(s).toContain('<h2 id="h-check">확인 필요<small>3건</small></h2>');
    // 줄은 링크(56px 행) — 이동만
    expect(s).toContain('<a class="rowl" href="/analytics?tab=verify">');
    expect(s).toContain('<a class="rowl" href="/recommend?tab=log">');
    expect(s).not.toMatch(/<button[^>]*>(승인|거절|취소)/);
  });
  test('중지: 첫 줄 「모든거래차단 ON — 모든 주문 차단」 / 「오늘 09:08 부터 · 청산 시그널 1건도 송신 안 됨」', () => {
    const t = textOf(section(render('halt', 'ok'), 'h-check'));
    expect(t.indexOf('모든거래차단 ON — 모든 주문 차단')).toBeLessThan(t.indexOf('손실한도 손절 OFF'));
    expect(t).toContain('오늘 09:08 부터 · 청산 시그널 1건도 송신 안 됨');
    expect(t).not.toContain('가상 청산');
  });
  test('혼합: 청산 실송신 → 신규 매수 차단 순 · foot 「기준 16:20」', () => {
    const t = textOf(section(render('mixed', 'ok'), 'h-check'));
    expect(t.indexOf('청산 주문이 실제로 송신됩니다')).toBeLessThan(t.indexOf('신규 매수 차단 — 검증 통과 전략 0/16'));
    expect(t).toContain('실거래여부 ON · 오늘 청산 체결 1건');
    expect(t).toContain('매수 시그널은 차단 기록으로만 남습니다');
    expect(t).toMatch(/기준 16:20$/);
  });
  test('실거래: 승인 대기 3건 — 국내 1 · 해외 2 / 가장 빨리 만료 · 주문 거부 1건 — 000660 매수 / 증권사 거부 · 재시도하지 않음(분류코드 영문 노출 없음)', () => {
    const s = section(render('live', 'ok'), 'h-check');
    const t = textOf(s);
    expect(t).toContain('승인 대기 3건 — 국내 1 · 해외 2');
    expect(t).toContain('가장 빨리 만료: BBBB 10-31 09:00');
    expect(t).toContain('주문 거부 1건 — 000660 매수');
    expect(t).toContain('증권사 거부 · 재시도하지 않음');
    expect(t).not.toContain('kis_rejected');
    expect(s).toContain('<span class="ic w" aria-hidden="true">3</span>');
  });
  test('첫 배포: 「분석 실패 여부는 아직 알 수 없습니다」 한 줄(시장 2개 → 1줄)', () => {
    const t = textOf(section(render('observe', 'first'), 'h-check'));
    expect(t.match(/분석 실패 여부는 아직 알 수 없습니다/g)).toHaveLength(1);
    expect(t).toContain('실행 기록(T-112)이 쌓인 뒤부터 보입니다');
  });
  test('빈: 「지금 확인할 것 없음 — …」 · small 에 0건 없음', () => {
    const s = section(render('observe', 'empty'), 'h-check');
    expect(textOf(s)).toContain('지금 확인할 것 없음 — 승인 대기 0 · 주문 오류 0 · 데이터 이상 0 · 청산 조건 해당 없음');
    expect(s).toContain('<h2 id="h-check">확인 필요</h2>');
  });
  test('조회 실패: 「확인 필요 목록을 불러오지 못했습니다 / http_503 · 비어 있는 것이 아닙니다」 + [다시 시도]', () => {
    const s = section(render('observe', 'error'), 'h-check');
    expect(textOf(s)).toContain('확인 필요 목록을 불러오지 못했습니다http_503 · 비어 있는 것이 아닙니다');
    expect(s).toContain('<button type="button" class="retry">다시 시도</button>');
    expect(textOf(s)).not.toContain('지금 확인할 것 없음');
  });
  test('오래됨: foot 「기준 10-29 16:05 · 오래됨 — 새로 고치지 못했습니다」', () => {
    expect(textOf(section(render('observe', 'stale'), 'h-check'))).toContain('기준 10-29 16:05 · 오래됨 — 새로 고치지 못했습니다');
  });
  test('401 → 「! 조회 실패 · unauthorized」 + 「다시 로그인해 주세요」(/login)', () => {
    const html = renderToStaticMarkup(h(HomeView, { safety: ok('observe'), home: { status: 'error', data: null, lastOkAt: null, error: 'unauthorized' }, nowMs: NOW }));
    expect(textOf(section(html, 'h-check'))).toContain('unauthorized · 비어 있는 것이 아닙니다');
    expect(section(html, 'h-check')).toContain('<a href="/login">다시 로그인해 주세요</a>');
    expect(textOf(section(html, 'h-ops'))).toContain('! 조회 실패 · unauthorized');
  });
  test('문구 함수: 표 순서(가이드 9종 + WP-A 추가 safety_unknown 맨 앞 · order_blocked 거부 뒤) · 데이터 이상 최대 3줄(넘치면 마지막 줄 「외 n건」) · null 빈칸은 구절째 뺀다', () => {
    expect(CHECK_ORDER).toEqual(['safety_unknown', 'kill_switch_on', 'exit_live_orders', 'buy_blocked', 'awaiting_approval', 'order_rejected', 'order_blocked', 'hard_stop_off_hit', 'virtual_exit', 'data_anomaly', 'analysis_unknown']);
    const an = (i: number, more: number | null = null): CheckItem => ({ kind: 'data_anomaly', severity: 'w', params: { source: 'fx_usdkrw', label: `이상 ${i}`, state: 'stale', streak: null, more }, href: '/analytics?tab=data' });
    const four = checkLines([an(1), an(2), an(3), an(4)], NOW);
    expect(four.map((l) => l.title)).toEqual(['이상 1 오래됨', '이상 2 오래됨', '외 2건']);
    const cut = checkLines([an(1), an(2), an(3, 4)], NOW);
    expect(cut.map((l) => l.title)).toEqual(['이상 1 오래됨', '이상 2 오래됨', '외 5건']);
    // 실행 기록 잡(source=job_run, label=job_id 원문) → 표시 이름 + 상태 말 · 뉴스 0건 연속 → 데모 문구
    const job = checkLines([{ kind: 'data_anomaly', severity: 'w', params: { source: 'job_run', label: 'post-market-domestic', state: 'error', streak: null, jobId: 'post-market-domestic', jobStatus: 'failed', more: null }, href: '/analytics?tab=data' }], NOW)[0];
    expect([job.title, job.sub]).toEqual(['국내 장마감 분석 실패', null]);
    const other = checkLines([{ kind: 'data_anomaly', severity: 'w', params: { source: 'job_run', label: 'news-collect', state: 'partial', streak: null, jobId: 'news-collect', jobStatus: 'degraded', more: null }, href: '/analytics?tab=data' }], NOW)[0];
    expect(other.title).toBe('news-collect 입력 품질 저하(degraded)');
    const news = checkLines([{ kind: 'data_anomaly', severity: 'w', params: { source: 'news_overseas', label: '뉴스 해외', state: 'partial', streak: 3, more: null }, href: '/analytics?tab=data' }], NOW)[0];
    expect([news.title, news.sub]).toEqual(['해외 뉴스 0건 3일 연속', '장마감 분석 입력 품질 저하(degraded)']);
    const kill = checkLines([{ kind: 'kill_switch_on', severity: 'e', params: { since: null, exitSignalsBlocked: null }, href: '/settings' }], NOW)[0];
    expect(kill.sub).toBeNull();
    const capped = checkLines([{ kind: 'hard_stop_off_hit', severity: 'w', count: 2, params: { symbols: 2, days: 30, daysCapped: 1 }, href: '/analytics?tab=verify' }], NOW)[0];
    expect(capped.title).toBe('손실한도 손절 OFF — 한도 도달 2종목 · 30일 이상');
    const ve = checkLines([{ kind: 'virtual_exit', severity: 'i', count: 1, params: { at: '2026-10-30T15:26:00+09:00', exitKind: 'hard_stop', notifyAutoSubmit: null }, href: '/recommend?tab=log' }], NOW)[0];
    expect(ve.title).toBe('가상 청산 1건 — 오늘 15:26 손실한도 손절');
    expect(ve.sub).toBe('주문은 기록만, 송신 없음');
  });
});

describe('B-2 운용현황 — 관찰 세트 A (§2.3.3)', () => {
  test('정상: A1 국내 44종목 · 10-30 16:00 / 해외 51종목 · ET 10-29 · 08:00 · A2 후보 5 → 시그널 1 + ⊘ 시그널 2건 모두 차단', () => {
    const s = section(render('observe', 'ok'), 'h-ops');
    expect(s).toContain('<h2 id="h-ops">운용현황<small>관찰 기간</small></h2><a class="lnk" aria-label="분석 탭 오늘 분석 보기" href="/analytics?tab=today">분석 ›</a>');
    expect(s).toContain('<span class="mk"><i>국내</i>44종목 · 10-30 16:00</span><span class="mk"><i>해외</i>51종목 · ET 10-29 · 08:00</span>');
    expect(s).toContain('<span class="meta">장마감 AI 분석 · D0 확정봉 기준</span>');
    expect(s).toContain('<span class="mk"><i>국내</i>후보 5 → 시그널 1</span><span class="mk"><i>해외</i>후보 3 → 시그널 1</span><span class="st blocked">⊘ 시그널 2건 모두 차단</span>');
    expect(s).toContain('차단 = 검증 관문(전략 미검증)');
    const t = textOf(s);
    expect(t).toContain('사후 결과 추적8건추적 완료 2 · 추적 중 6건수 적음 (30건 미만)30건 이상 쌓여야 성과를 판단할 수 있어 지금은 참고용 · 진입 d1open · D+1·3·5·10');
    expect(t).toContain('데이터 이상·분석 실패1건국내 뉴스 0건 2일 연속원천 6개 중 1 · degraded');
    expect(textOf(s)).toContain('손익은 표시하지 않습니다 — 실거래 전환일 첫 스냅샷에서 기준을 잡습니다(D5). 가상 진입(paper_fills)은 분석 › 검증·성과에 따로.');
  });
  test('첫 배포: A1 —/◌ 미수집 — 실행 기록 전 · A2 부분 — 시그널만 · A3 AI 매수 판단 시그널 한정 · A4 부분 — 원천 4개만 확인', () => {
    const s = section(render('observe', 'first'), 'h-ops');
    expect(s).toContain('<span class="lb">분석 완료 종목</span><span class="v">—</span><span class="st unknown">◌ 미수집 — 실행 기록 전</span><span class="meta">지금은 응답·로그에만 남아 셀 수 없음(T-112)</span>');
    expect(s).toContain('<span class="mk"><i>국내</i>시그널 1 · 차단 1</span>');
    expect(s).toContain('<span class="st partial">부분 — 시그널만</span><span class="meta">규칙 후보 수는 T-112 기록 뒤</span>');
    expect(textOf(s)).toContain('D+1·3·5·10 · AI 매수 판단 시그널 한정');
    expect(s).toContain('<span class="st partial">부분 — 원천 4개만 확인</span><span class="meta">분석 실패는 실행 기록 뒤</span>');
  });
  test('빈: 확인된 0 은 zero 지표에만 — A2 후보 0·0 ✓ · A3 0건 ✓ 추적할 시그널 없음 · A4 0건 ✓ 이상 없음', () => {
    const s = section(render('observe', 'empty'), 'h-ops');
    expect(s).toContain('<span class="mk"><i>국내</i>후보 0</span><span class="mk"><i>해외</i>후보 0</span><span class="st zero">✓ 확인된 0</span><span class="meta">분석이 정상 완료된 날에만 0</span>');
    expect(textOf(s)).toContain('사후 결과 추적0건✓ 확인된 0추적할 시그널 없음');
    expect(textOf(s)).toContain('데이터 이상·분석 실패0건✓ 이상 없음원천 6개 정상');
  });
  test('로딩: 칸 4개 스켈레톤(aria-hidden) · 섹션 aria-busy', () => {
    const s = section(render('observe', 'loading'), 'h-ops');
    expect(s).toContain('aria-busy="true"');
    expect(s.match(/<div class="tile" aria-hidden="true">/g)).toHaveLength(4);
  });
  test('조회 실패: 칸마다 — + ! 조회 실패 · http_503 · foot [다시 시도]', () => {
    const s = section(render('observe', 'error'), 'h-ops');
    expect(s.match(/<span class="v">—<\/span><span class="st error">! 조회 실패 · http_503<\/span>/g)).toHaveLength(4);
    expect(s).toContain('<div class="sec-foot"><button type="button" class="retry">다시 시도</button></div>');
  });
  test('오래됨: 칸 회색(tile dim) + 「오래됨 · 기준 10-29 16:05」', () => {
    const s = section(render('observe', 'stale'), 'h-ops');
    expect(s.match(/<div class="tile dim">/g)).toHaveLength(4);
    expect(s.match(/<span class="st stale">오래됨 · 기준 10-29 16:05<\/span>/g)).toHaveLength(4);
  });
});

describe('B-2 관찰·중지 단계에는 손익 숫자가 없다(D5)', () => {
  test.each((['observe', 'halt'] as const).flatMap((s) => DATA.map((d) => [s, d] as const)))('%s × %s', (s, d) => {
    const html = render(s, d);
    const t = textOf(html);
    expect(t).not.toMatch(/\(이익\)|\(손실\)/);
    expect(t).not.toContain('자동매매 손익');
    expect(t).not.toContain('계좌 전체 손익');
    expect(t).not.toMatch(/₩\d/);
    expect(t).not.toMatch(/[+−-]\d+(\.\d+)?%/);
  });
});

describe('B-2 운용현황 — 실거래 세트 B (§2.3.4)', () => {
  test('실거래: B1 → B2 → B3 → B6 → B4(wide) → B7 순 · 손익 숫자 없음(v1 기준 미설정) · B5 는 링크', () => {
    const s = section(render('live', 'ok'), 'h-ops');
    const labels = [...s.matchAll(/<span class="lb">([^<]*)<\/span>/g)].map((m) => m[1]);
    expect(labels).toEqual(['진입 감시', '운용 포지션', '오늘 실체결', '운용액 (배정)', '자동매매 손익', '신규 매수 가능']);
    expect(s).toContain('<h2 id="h-ops">운용현황<small>실거래</small></h2><a class="lnk" aria-label="거래 탭 운용 현황 보기" href="/recommend?tab=now">거래 ›</a>');
    expect(s).toContain('<span class="mk"><i>국내</i>1 감시 중</span><span class="mk"><i>해외</i>0 · 주문 선점 1</span><span class="meta">다음 세션 예정 0 · 서버 COUNT</span>');
    expect(s).toContain('<span class="mk"><i>자동</i>2종목 · ₩1,240,000</span><span class="mk"><i>계좌</i>보유 6종목</span><span class="meta">평가 16:15 스냅샷 · 수동 보유는 자동 관리 아님(D3)</span>');
    expect(s).toContain('<span class="mk"><i>국내</i>1건 · 10-30 세션</span><span class="mk"><i>해외</i>0건 · ET 10-29</span>');
    expect(s).toContain('<span class="lb">운용액 (배정)</span><span class="v">미설정</span><span class="st unknown">◌ 설정에서 배정</span><span class="meta">사용자가 정한 금액만 씀(D4)</span>');
    expect(s).toContain('<div class="tile wide"><span class="lb">자동매매 손익</span><span class="v">—</span><span class="st unknown">◌ 기준 미설정</span><span class="meta">기준은 실거래 전환일 첫 스냅샷(D5) — 자동 귀속 손익(원가·대사)은 연결 뒤</span></div>');
    expect(s).toContain('<span class="mk"><i>국내</i>₩480,000</span><span class="mk"><i>해외</i>$310.00 ≈ ₩431,600</span><span class="meta">결제 완료 예수금 · 1회 한도 · 환율 16:15</span>');
    expect(s).toContain('<a href="/settings/cash-ledger">계좌 전체 손익(보조) — 자산 기록에서 보기 ›</a>');
    expect(textOf(s)).not.toMatch(/\(이익\)|\(손실\)/);
  });
  test('혼합: B1 ⊘ 매수 차단 · B2 ✓ 자동 운용 0 · B3 청산 매도 · B4 혼합 문구 · B7 ⊘ 차단 · foot 기준 미설정', () => {
    const s = section(render('mixed', 'ok'), 'h-ops');
    expect(s).toContain('<small>실거래 준비</small>');
    expect(s).toContain('<span class="lb">진입 감시</span><span class="v">—</span><span class="st blocked">⊘ 매수 차단</span><span class="meta">검증 통과 전략 0</span>');
    expect(s).toContain('<span class="mk"><i>자동</i>운용 0</span><span class="mk"><i>계좌</i>보유 6종목</span><span class="st zero">✓ 자동 운용 0</span>');
    expect(s).toContain('<span class="mk"><i>국내</i>1건 · 청산 매도</span>');
    expect(textOf(s)).toContain('혼합 단계는 전환으로 볼지 결정 전');
    expect(s).toContain('<span class="st blocked">⊘ 차단 — 검증 통과 0</span><span class="meta">금액 대신 사유를 표시</span>');
    expect(textOf(s)).toContain('계좌 전체 손익(보조): 기준 미설정');
  });
  test('빈: 진입 감시 0 ✓ · 오늘 실체결 0건·0건 ✓', () => {
    const s = section(render('live', 'empty'), 'h-ops');
    expect(s).toContain('<span class="lb">진입 감시</span><span class="v">0</span><span class="st zero">✓ 확인된 0</span>');
    expect(s).toContain('<span class="mk"><i>국내</i>0건 · 10-30</span><span class="mk"><i>해외</i>0건 · ET 10-29</span><span class="st zero">✓ 확인된 0</span>');
  });
  test('USD 환율 fallback → 환산 숨김 + 사유(기본 환율로 원화를 지어내지 않음)', () => {
    const dto = homeDTO('live', 'ok') as HomeDTO;
    const live = dto.live!;
    if (live.state !== 'ok') throw new Error('fixture');
    live.data.buyable.overseas = { state: 'available', value: { native: 310, currency: 'USD', krw: 427800, fxAt: null, fxSource: 'fallback' }, asOf: null };
    const html = renderToStaticMarkup(h(HomeView, { safety: ok('live'), home: { status: 'ok', data: dto, lastOkAt: NOW, error: null }, nowMs: NOW }));
    const s = section(html, 'h-ops');
    expect(s).toContain('<span class="mk"><i>해외</i>$310.00</span><span class="meta">환율 기본값(fallback) — 원화 환산 숨김</span>');
    expect(s).not.toContain('427,800');
  });
});

describe('B-2 청산 로직 3줄 (§2.3.5) — 0 이어도 항상', () => {
  test('관찰: 가동 손실한도 손절 OFF(굵게) + 국내 15:21(장 마감) · 해외 장외 개장 22:30 KST (11-02부터 23:30) / 판정 한도 도달 1종목 / 가상 청산 1건', () => {
    const s = section(render('observe', 'ok'), 'h-exit');
    expect(s).toContain('<h2 id="h-exit">청산 로직<small>감사 관찰 대상</small></h2><a class="lnk" aria-label="청산 로직 상세 보기" href="/analytics?tab=verify">상세 ›</a>');
    const t = textOf(s);
    expect(s).toContain('<b>손실한도 손절 OFF</b>');
    expect(t).toContain('국내 마지막 평가 15:21(장 마감) · 해외 장외 개장 22:30 KST (11-02부터 23:30)');
    expect(s).toContain('<span class="st off">장외</span>');
    expect(t).toContain('손실한도 손절 OFF — 한도 도달 1종목 · 1일째');
    expect(t).toContain('해당 없음 1종목 · 데이터 이상 0 · 해외 미평가(장외)');
    expect(t).toContain('가상 청산 1건 — 장마감 전 손절 15:26');
    expect(t).toContain('승인 대기 청산 0 · 실 송신 0');
    // 틱 수(57)는 홈에 쓰지 않는다(D12)
    expect(t).not.toContain('57');
  });
  test('첫 배포(30일 한정 partial) → 「30일 보존(영구 기록은 T-126)」', () => {
    expect(textOf(section(render('observe', 'first'), 'h-exit'))).toContain('30일 보존(영구 기록은 T-126)');
  });
  test('중지: 청산 시그널 1건 — 주문 차단(모든거래차단)', () => {
    const s = section(render('halt', 'ok'), 'h-exit');
    expect(textOf(s)).toContain('청산 시그널 1건 — 주문 차단(모든거래차단)');
    expect(s).toContain('<b>주문 차단</b>');
  });
  test('혼합: 실주문 칩 · 청산 시그널 생성 1종목 · 청산 주문 1건 송신 → 체결 1', () => {
    const s = section(render('mixed', 'ok'), 'h-exit');
    expect(s).toContain('청산 엔진 ON · 손실한도 손절 ON · <span class="st blocked">실주문</span>');
    expect(textOf(s)).toContain('청산 시그널 생성 1종목 · 해당 없음 2종목');
    expect(textOf(s)).not.toContain('발동');
    expect(textOf(s)).toContain('청산 주문 1건 송신 → 체결 1');
  });
  test('실거래: 해당 없음 4종목 · 트레일링 활성 1 · 청산 주문 0 · 승인 대기 청산 1 / 익절 조건', () => {
    const t = textOf(section(render('live', 'ok'), 'h-exit'));
    expect(t).toContain('해당 없음 4종목 · 트레일링 활성 1');
    expect(t).toContain('청산 주문 0 · 승인 대기 청산 1익절 조건 — 거래 › 운용 현황에서 승인');
  });
  test('빈: 「청산 조건 해당 없음 2종목 ✓ 확인된 0」 · 「청산 제안 0 ✓ 확인된 0」', () => {
    const t = textOf(section(render('observe', 'empty'), 'h-exit'));
    expect(t).toContain('청산 조건 해당 없음 2종목 ✓ 확인된 0');
    expect(t).toContain('청산 제안 0 ✓ 확인된 0');
  });
  test('조회 실패: 「— ! 조회 실패」 + 「청산 엔진이 꺼진 것이 아닙니다 — 상태를 모릅니다」, 판정·청산 —', () => {
    const t = textOf(section(render('observe', 'error'), 'h-exit'));
    expect(t).toContain('가동— ! 조회 실패청산 엔진이 꺼진 것이 아닙니다 — 상태를 모릅니다판정—청산—');
  });
  test('엔진 OFF: 「청산 엔진 OFF — 자동 손절·익절 없음」, 판정·청산 —(0 아님)', () => {
    const dto = homeDTO('observe', 'ok');
    if (dto.exit.state !== 'ok') throw new Error('fixture');
    dto.exit.data.engine = { state: 'available', value: { enabled: false, hardStopEnabled: false }, asOf: null };
    const t = textOf(section(renderToStaticMarkup(h(HomeView, { safety: ok('observe'), home: { status: 'ok', data: dto, lastOkAt: NOW, error: null }, nowMs: NOW })), 'h-exit'));
    expect(t).toContain('청산 엔진 OFF — 자동 손절·익절 없음');
    expect(t).toMatch(/판정— \(엔진 꺼짐\)청산— \(엔진 꺼짐\)$/);
    expect(t).not.toContain('확인된 0');
  });
  test('청산 시그널 생성 실패 종목이 있으면 「확인된 0」 을 쓰지 않고 따로 보인다', () => {
    const dto = homeDTO('observe', 'empty');
    if (dto.exit.state !== 'ok') throw new Error('fixture');
    const j = dto.exit.data.judgments.domestic;
    dto.exit.data.judgments.domestic = { ...j, state: 'available', value: { ...j.value!, createFailed: 1 } };
    const t = textOf(section(renderToStaticMarkup(h(HomeView, { safety: ok('observe'), home: { status: 'ok', data: dto, lastOkAt: NOW, error: null }, nowMs: NOW })), 'h-exit'));
    expect(t).not.toContain('청산 조건 해당 없음 2종목 ✓ 확인된 0');
    // 판정 줄 맨 앞 빨간 칩 — 회색 보조 줄(.m)에 섞지 않는다(designer 필수 1)
    const html = section(renderToStaticMarkup(h(HomeView, { safety: ok('observe'), home: { status: 'ok', data: dto, lastOkAt: NOW, error: null }, nowMs: NOW })), 'h-exit');
    expect(html).toMatch(/<span class="k">판정<\/span><span class="d"><span class="st error">! 청산 시그널 생성 실패 1종목<\/span> /);
    expect(html).not.toMatch(/<span class="m">[^<]*청산 시그널 생성 실패/);
  });
  test('손실한도 손절 OFF 한도 도달 분기에서도 생성 실패는 판정 줄 맨 앞 빨간 칩(보조 줄 아님)', () => {
    const dto = homeDTO('observe', 'ok');
    if (dto.exit.state !== 'ok') throw new Error('fixture');
    const j = dto.exit.data.judgments.domestic;
    dto.exit.data.judgments.domestic = { ...j, state: 'available', value: { ...j.value!, createFailed: 2 } };
    const html = section(renderToStaticMarkup(h(HomeView, { safety: ok('observe'), home: { status: 'ok', data: dto, lastOkAt: NOW, error: null }, nowMs: NOW })), 'h-exit');
    expect(html).toMatch(/<span class="k">판정<\/span><span class="d"><span class="st error">! 청산 시그널 생성 실패 2종목<\/span> 손실한도 손절 OFF — 한도 도달 <b>1종목<\/b>/);
    expect(html).not.toMatch(/<span class="m">[^<]*청산 시그널 생성 실패/);
  });
  test('두 시장 모두 장외 → 판정 「장외」(이상 없음과 다르게, 0 아님)', () => {
    const dto = homeDTO('observe', 'empty');
    if (dto.exit.state !== 'ok') throw new Error('fixture');
    dto.exit.data.judgments.domestic = { state: 'off_hours', value: null, asOf: null };
    const s = section(renderToStaticMarkup(h(HomeView, { safety: ok('observe'), home: { status: 'ok', data: dto, lastOkAt: NOW, error: null }, nowMs: NOW })), 'h-exit');
    expect(s).toMatch(/<span class="k">판정<\/span><span class="d"><span class="st off">장외<\/span><\/span>/);
  });
});

describe('B-2 오늘의 분석·판단 (§2.3.6)', () => {
  test('정상: 머리 국내 10-30 · 16:00 실행 / 해외 ET 10-29 · 08:00 실행 · 행 6개 · caption 다음 분석', () => {
    const s = section(render('observe', 'ok'), 'h-ana');
    expect(s).toContain('<th scope="col">국내<small>10-30 · 16:00 실행</small></th><th scope="col">해외<small>ET 10-29 · 08:00 실행</small></th>');
    const rows = [...s.matchAll(/<tr><th scope="row">([^<]*)<\/th><td>([^<]*)<\/td><td>([^<]*)<\/td><\/tr>/g)].map((m) => [m[1], m[2], m[3]]);
    expect(rows).toEqual([
      ['평가 종목', '44', '51'], ['규칙 후보', '5', '3'], ['AI 매수 판단', '1', '1'], ['시그널 생성', '1', '1'], ['검증 차단', '1', '1'],
      ['제외 사유 1위', '신뢰도 60 미만 3', '진입 구간 없음 2'],
    ]);
    expect(textOf(s)).toContain('AI 매수 판단 = AI 가 「지금 살 만하다」고 본 종목 수(그 외는 「매수 안 함」) · 장마감 AI 분석만(D1) · 국내 = KST 세션일, 해외 = ET 세션일 ·');
    expect(textOf(s)).toContain('다음 분석 국내 10-31 16:00 · 해외 10-31 08:00 KST(스케줄 표에서 읽음)');
  });
  test('첫 배포: 평가·후보 ◌ · AI 매수 판단·제외 사유 준비 중 · 시그널은 값', () => {
    const s = section(render('observe', 'first'), 'h-ana');
    expect(s).toMatch(/<th scope="row">평가 종목<\/th><td><span class="st unknown">◌<\/span><\/td><td><span class="st unknown">◌<\/span><\/td>/);
    expect(s).toMatch(/<th scope="row">AI 매수 판단<\/th><td><span class="st prep">준비 중<\/span><\/td>/);
    expect(s).toMatch(/<th scope="row">제외 사유<\/th><td><span class="st prep">준비 중<\/span><\/td>/);
    expect(s).toMatch(/<th scope="row">시그널 생성<\/th><td>1<\/td><td>1<\/td>/);
  });
  test('실거래·혼합: 5번째 행 「승인 대기」', () => {
    const s = section(render('live', 'ok'), 'h-ana');
    expect(s).toMatch(/<th scope="row">승인 대기<\/th><td>1<\/td><td>0<\/td>/);
    expect(s).not.toContain('검증 차단');
  });
  test('AnalysisStageTable(분석 › 오늘 분석 공용) — 섹션 틀 없이 표만 · 오래됨 caption', () => {
    const html = renderToStaticMarkup(h(AnalysisStageTable, { runs: analysis('ok'), stage: 'observe', staleBase: '10-29 16:05' }));
    expect(html.startsWith('<table class="mt"><caption>')).toBe(true);
    expect(html).not.toContain('<section');
    expect(textOf(html)).toContain(' · 오래됨: 기준 10-29 16:05');
    expect(html).toContain('<td class="dim">44</td>');
  });
  test('조회 실패: ! 조회 실패 · http_503 + [다시 시도]', () => {
    const s = section(render('observe', 'error'), 'h-ana');
    expect(s).toContain('<span class="st error">! 조회 실패 · http_503</span>');
    expect(s).toContain('class="retry"');
  });
});

describe('B-2 최근 활동 (§2.3.7)', () => {
  test('최대 4건 · 최신순 · 오늘이 아니면 MM-DD HH:MM', () => {
    const s = section(render('observe', 'ok'), 'h-act');
    const times = [...s.matchAll(/<span class="tm">([^<]*)<\/span>/g)].map((m) => m[1]);
    expect(times).toEqual(['16:00', '15:26', '13:32', '10-29 16:05']);
    expect(textOf(s)).toContain('국내 장마감 분석 완료44종목 · 시그널 1건 → 검증 관문 차단');
    expect(textOf(s)).toContain('가상 청산 기록 — 종목 A 매도장마감 전 손절 · 주문 송신 없음');
    expect(textOf(s)).not.toContain('다섯째');
    expect(s).toContain('<a class="lnk" aria-label="거래 탭 운영 기록 보기" href="/recommend?tab=log">기록 ›</a>');
  });
  test('첫 배포: 분석 완료 줄 없이 orders·signals 만', () => {
    const t = textOf(section(render('observe', 'first'), 'h-act'));
    expect(t).not.toContain('장마감 분석 완료');
    expect(t).toContain('장중 매수 시그널 차단');
  });
});

describe('B-2 「0」 은 확인된 0(zero) 일 때만 — 첫 배포·로딩·조회 실패에는 「✓ 확인된 0」 이 없다', () => {
  test.each(STAGES)('%s × 첫 배포: 운용현황·분석 표에 확인된 0 없음', (s) => {
    const html = render(s, 'first');
    const ana = section(html, 'h-ana');
    expect(ana).not.toContain('✓ 확인된 0');
    // 첫 배포에서 값이 없는 칸은 — 이지 0 이 아니다
    expect(ana).not.toMatch(/<th scope="row">(평가 종목|규칙 후보|AI 매수 판단)<\/th><td>0<\/td>/);
    if (s === 'observe' || s === 'halt') expect(section(html, 'h-ops')).not.toContain('✓ 확인된 0');
  });
  test.each(STAGES.flatMap((s) => (['loading', 'error'] as const).map((d) => [s, d] as const)))('%s × %s', (s, d) => {
    const html = render(s, d);
    expect(html).not.toContain('✓ 확인된 0');
    expect(html).not.toContain('✓ 이상 없음');
    expect(html).not.toContain('지금 확인할 것 없음');
    expect(html).not.toMatch(/<span class="v">0/);
  });
});

describe('B-2 용어 — 옛 표기 0건 · 위험 동작 없음 · 데이터 경로', () => {
  const OLD = /DRY_RUN|DRY RUN|킬스위치|KILL_SWITCH|Kill Switch|하드 ?손절|EOD ?손절|장마감 손실 차단|표본 ?부족|AI BUY|AI SKIP|실거래 여부/;
  test.each(STAGES.flatMap((s) => DATA.map((d) => [s, d] as const)))('%s × %s 화면 글자', (s, d) => {
    const t = textOf(render(s, d));
    expect(t).not.toMatch(OLD);
  });
  test('홈 소스: 옛 표기 0 · !dryRun 뒤집기 0 · 쓰기 API·KIS·티커 호출 0 · /api/settings/safety GET 0 · Dashboard import 0', () => {
    const files = [
      'components/home/HomeScreen.tsx', 'components/home/CheckSection.tsx', 'components/home/OpsSection.tsx', 'components/home/ExitLogicSection.tsx',
      'components/home/AnalysisSection.tsx', 'components/home/ActivitySection.tsx', 'components/home/check-copy.ts', 'components/home/home-ctx.tsx',
      'components/ops/safety-view.ts', 'components/ops/useSafetyState.ts', 'components/ops/useOpsPoll.ts', 'components/ops/format.ts',
      'components/BottomTabs.tsx', 'app/page.tsx',
    ];
    for (const f of files) {
      const code = fs.readFileSync(path.join(SRC, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
      expect([f, OLD.test(code)]).toEqual([f, false]);
      expect([f, /!\s*(safety\??\.)?dryRun/.test(code)]).toEqual([f, false]);
      expect([f, /method:\s*['"](POST|PATCH|PUT|DELETE)['"]/.test(code)]).toEqual([f, false]);
      expect([f, /\/api\/(ticker|portfolio|candles|settings\/safety|signals)/.test(code)]).toEqual([f, false]);
      expect([f, /@\/lib\/exchanges|submitOrder|createOrder/.test(code)]).toEqual([f, false]);
    }
    const page = fs.readFileSync(path.join(SRC, 'app/page.tsx'), 'utf8');
    expect(page).toContain("import { HomeScreen } from '@/components/home/HomeScreen';");
    expect(page).not.toMatch(/import[^\n]*Dashboard/);
    expect(fs.existsSync(path.join(SRC, 'components/dashboard/Dashboard.tsx'))).toBe(true);
    const screen = fs.readFileSync(path.join(SRC, 'components/home/HomeScreen.tsx'), 'utf8');
    expect(screen).toContain("export const HOME_URL = '/api/ops/home';");
    expect(fs.readFileSync(path.join(SRC, 'components/ops/useSafetyState.ts'), 'utf8')).toContain("export const SAFETY_STATE_URL = '/api/ops/safety-state';");
  });
});


// ── Reviewer 결함 수정 (2026-10-30 R-DATA Major-1·2 · R-UI M2·M3 · Minor ②③⑨) ───────────────────────────────

function renderDTO(dto: HomeDTO, sv?: SafetyStateView) {
  return renderToStaticMarkup(h(HomeView, { safety: sv ?? ok(dto.stage === 'unknown' ? 'observe' : dto.stage as Stage4), home: { status: 'ok', data: dto, lastOkAt: NOW, error: null }, nowMs: NOW }));
}
const exitOf = (dto: HomeDTO) => { if (dto.exit.state !== 'ok') throw new Error('fixture'); return dto.exit.data; };
/** 청산 로직 3줄 중 한 줄의 글자(가동·판정·청산) */
const lineOf = (html: string, k: '가동' | '판정' | '청산') => {
  const m = new RegExp(`<span class="k">${k}</span><span class="d">([\\s\\S]*?)</span></div>`).exec(section(html, 'h-exit'));
  return m ? textOf(m[1]) : '';
};
const zp = { total: 0, virtual: 0, awaitingApproval: 0, submittedLive: 0, blockedByKill: 0, filled: 0, firstKind: null, firstAt: null, expired: 0, rejected: 0, other: 0 };

describe('수정 1 — 청산 제안 「확인된 0」 은 서버가 zero(total=0)일 때만 (R-DATA Major-1)', () => {
  test.each(STAGES)('%s: 만료 1건만 있는 날 → 확인된 0 아님 · 「만료 1」', (stage) => {
    const dto = homeDTO(stage, 'empty');
    exitOf(dto).proposals = { state: 'available', value: { ...zp, total: 1, expired: 1 }, asOf: null };
    const close = lineOf(renderDTO(dto), '청산');
    expect(close).not.toContain('확인된 0');
    expect(close).toContain('만료 1');
  });
  test('관찰: 거절 1 · 그 밖 1 → 「청산 제안 2건」 + 「거절 1 · 그 밖 1」', () => {
    const dto = homeDTO('observe', 'empty');
    exitOf(dto).proposals = { state: 'available', value: { ...zp, total: 2, rejected: 1, other: 1 }, asOf: null };
    const t = textOf(section(renderDTO(dto), 'h-exit'));
    expect(t).toContain('청산 제안 2건승인 대기 청산 0 · 실 송신 0 · 거절 1 · 그 밖 1');
  });
  test('서버 zero(total=0) → 「청산 제안 0 ✓ 확인된 0」 그대로', () => {
    expect(textOf(section(render('observe', 'empty'), 'h-exit'))).toContain('청산 제안 0 ✓ 확인된 0');
  });
});

describe('수정 4 — 중지 단계 「주문 차단」 은 blocked_by=kill_switch 주문이 있을 때만 (R-UI Minor ②)', () => {
  test('중지 + 가상 청산만 → 「가상 청산 1건」, 「주문 차단(모든거래차단)」 아님', () => {
    const dto = homeDTO('halt', 'ok');
    exitOf(dto).proposals = { state: 'available', value: { ...zp, total: 1, virtual: 1, firstKind: 'eod_loss_cut', firstAt: '2026-10-30T15:26:00+09:00' }, asOf: null };
    const t = textOf(section(renderDTO(dto), 'h-exit'));
    expect(t).toContain('가상 청산 1건 — 장마감 전 손절 15:26');
    expect(t).not.toContain('주문 차단');
  });
  test('중지 + 모든거래차단 차단 1 → 「청산 시그널 1건 — 주문 차단(모든거래차단)」', () => {
    expect(textOf(section(render('halt', 'ok'), 'h-exit'))).toContain('청산 시그널 1건 — 주문 차단(모든거래차단)');
  });
});

describe('수정 4 — 판정 줄: 개장 중 실행 기록 없음은 「장외」 가 아니다 (R-UI Minor ③)', () => {
  test('국내 판정 있음 + 해외 개장 중 기록 없음(unknown no_runs_yet) → 「해외 ◌ 미수집」, 「해외 미평가(장외)」 아님', () => {
    const dto = homeDTO('observe', 'ok');
    exitOf(dto).judgments.overseas = { state: 'unknown', value: null, asOf: null, reason: 'no_runs_yet' };
    const t = textOf(section(renderDTO(dto), 'h-exit'));
    expect(t).toContain('해외 ◌ 미수집');
    expect(t).not.toContain('해외 미평가(장외)');
  });
  test('두 시장 모두 판정 모름(국내 stale · 해외 unknown) → 「— 국내 오래됨 · 해외 ◌ 미수집」, 장외·확인된 0 아님', () => {
    const dto = homeDTO('observe', 'ok');
    exitOf(dto).judgments.domestic = { state: 'stale', value: null, asOf: null, reason: 'no_runs' };
    exitOf(dto).judgments.overseas = { state: 'unknown', value: null, asOf: null, reason: 'no_runs_yet' };
    const judge = lineOf(renderDTO(dto), '판정');
    expect(judge).toBe('— 국내 오래됨 · 해외 ◌ 미수집');
    expect(judge).not.toContain('장외');
    expect(judge).not.toContain('확인된 0');
  });
  test('정책 스킵(엔진 꺼짐 중 조건 충족 · 쿨다운)이 있으면 확인된 0 아님', () => {
    const dto = homeDTO('observe', 'empty');
    const j = exitOf(dto).judgments.domestic;
    exitOf(dto).judgments.domestic = { ...j, state: 'available', value: { ...j.value!, engineOffHit: 1, cooldown: 2 } };
    const t = textOf(section(renderDTO(dto), 'h-exit'));
    expect(t).toContain('엔진 꺼짐 중 조건 충족 1종목 · 쿨다운 2종목');
    expect(t).not.toContain('청산 조건 해당 없음 2종목 ✓ 확인된 0');
  });
  test('엔진 꺼짐(state=blocked reason=engine_off) → 「— (엔진 꺼짐)」', () => {
    const dto = homeDTO('observe', 'ok');
    const x = exitOf(dto);
    x.judgments.domestic = { state: 'blocked', value: null, asOf: null, reason: 'engine_off' };
    x.judgments.overseas = { state: 'blocked', value: null, asOf: null, reason: 'engine_off' };
    x.proposals = { state: 'blocked', value: null, asOf: null, reason: 'engine_off' };
    const t = textOf(section(renderDTO(dto), 'h-exit'));
    expect(t).toMatch(/판정— \(엔진 꺼짐\)청산— \(엔진 꺼짐\)$/);
  });
});

describe('수정 2 — 확인 필요 빈 상태는 평가한 항목만 0 · 안전 상태 모름이면 「지금 확인할 것 없음」 금지 (R-DATA Major-2 · R-UI M3)', () => {
  const COV_ALL = { approval: true, orders: true, anomalies: true, exitConditions: true, safety: true };
  const withCov = (stage: Stage4, cov: Partial<typeof COV_ALL>) => {
    const dto = homeDTO(stage, 'empty');
    dto.checkCoverage = { ...COV_ALL, ...cov };
    return dto;
  };
  test.each((['live', 'mixed', 'observe'] as Stage4[]).flatMap((s) => (['approval', 'orders', 'anomalies', 'exitConditions'] as const).map((k) => [s, k] as const)))(
    '%s × %s 평가 못 함 → 「확인한 범위에서는 없음」 + 그 항목 「확인하지 못함」', (stage, k) => {
      const t = textOf(section(renderDTO(withCov(stage, { [k]: false })), 'h-check'));
      expect(t).not.toContain('지금 확인할 것 없음');
      expect(t).toContain('확인한 범위에서는 없음 — ');
      const label = { approval: '승인 대기', orders: '주문 오류', anomalies: '데이터 이상', exitConditions: '청산 조건' }[k];
      expect(t).toContain(`${label} 확인하지 못함`);
      expect(t).not.toContain(k === 'exitConditions' ? '청산 조건 해당 없음' : `${label} 0`);
    });
  test('전부 평가함 → 데모 문구 그대로', () => {
    expect(textOf(renderToStaticMarkup(emptySentence(COV_ALL)))).toBe('지금 확인할 것 없음 — 승인 대기 0 · 주문 오류 0 · 데이터 이상 0 · 청산 조건 해당 없음');
  });
  test.each(['live', 'mixed', 'observe', 'halt'] as Stage4[])('%s × coverage.safety=false (서버 줄 없음) → 「안전 상태를 읽지 못해 확인할 수 없습니다」 + [다시 시도]', (stage) => {
    const s = section(renderDTO(withCov(stage, { safety: false })), 'h-check');
    expect(textOf(s)).toContain('안전 상태를 불러오지 못해 확인할 수 없습니다비어 있는 것이 아닙니다');
    expect(textOf(s)).not.toContain('지금 확인할 것 없음');
    expect(textOf(s)).not.toContain('확인한 범위에서는 없음');
    expect(s).toContain('class="retry"');
  });
  test('단계 unknown + 서버 safety_unknown 줄 → 맨 앞 줄 · 오류 코드는 한글 · [다시 시도] · 「지금 확인할 것 없음」 없음', () => {
    const dto = homeDTO('observe', 'empty');
    dto.stage = 'unknown' as OpsStage;
    dto.checkCoverage = { ...COV_ALL, safety: false };
    if (dto.checks.state !== 'ok') throw new Error('fixture');
    dto.checks.data = [{ kind: 'safety_unknown', severity: 'e', params: { errors: 'strategies_error, weird_code' }, href: '/settings' }];
    const s = section(renderDTO(dto), 'h-check');
    const t = textOf(s);
    expect(t).toContain('안전 상태를 불러오지 못해 확인할 수 없습니다전략 목록 읽기 실패 · 사유 코드 weird_code · 주문 송신 여부를 알 수 없습니다');
    expect(t.match(/안전 상태를 불러오지 못해 확인할 수 없습니다/g)).toHaveLength(1);
    expect(t).not.toContain('지금 확인할 것 없음');
    expect(s).toContain('<a class="rowl" href="/settings">');
    expect(s).toContain('class="retry"');
  });
  test('checkCoverage 없음(null)인데 checks ok → 안전하게 「확인할 수 없습니다」 쪽', () => {
    const dto = homeDTO('live', 'empty');
    dto.checkCoverage = null;
    expect(textOf(section(renderDTO(dto), 'h-check'))).not.toContain('지금 확인할 것 없음');
  });
});

describe('수정 3 — 건너뜀 사유를 「휴장」 으로 단정하지 않는다 (R-UI M2)', () => {
  const withRuns = (dom: Partial<AnalysisRunRow>, ovs: Partial<AnalysisRunRow>) => {
    const dto = homeDTO('observe', 'ok');
    const a = analysis('ok');
    const runs = { domestic: { ...a.domestic, ...dom }, overseas: { ...a.overseas, ...ovs } };
    dto.analysis = { state: 'ok', data: runs };
    if (dto.observe && dto.observe.state === 'ok') dto.observe.data.analysis = runs;
    return dto;
  };
  const skipped = (skipReason: string | null): Partial<AnalysisRunRow> => ({ runStatus: 'skipped', skipReason, evaluated: { state: 'off_hours', value: null, asOf: null, ...(skipReason ? { reason: skipReason } : {}) } });
  test.each([
    ['weekend', '건너뜀 · 주말'], ['overseas_disabled', '건너뜀 · 해외 장마감 후 분석 꺼짐'], ['overseas_market_disabled', '건너뜀 · 해외 시장 꺼짐(서버 환경 설정)'],
    ['us_session_open', '건너뜀 · 미국 장 진행 중'], ['no_new_session', '건너뜀 · 새 세션 없음'], ['brand_new_code', '건너뜀 · 사유 코드 brand_new_code'], [null, '건너뜀 · 사유 모름'],
  ] as const)('%s → 「%s」 (A1 줄 · 표 머리), 「휴장」 없음', (code, want) => {
    const html = renderDTO(withRuns(skipped(code), {}));
    const ops = section(html, 'h-ops');
    const ana = section(html, 'h-ana');
    expect(ops).toContain(`<span class="mk"><i>국내</i>${want}</span>`);
    expect(ana).toContain(`<th scope="col">국내<small>10-30 · ${want}</small></th>`);
    expect(ana).toMatch(/<th scope="row">평가 종목<\/th><td><span class="st off">건너뜀<\/span><\/td>/);
    expect(textOf(ops + ana)).not.toContain('휴장');
  });
  test('옛 표기 Metric.reason=skip:<코드> 도 읽는다', () => {
    const html = renderDTO(withRuns({ runStatus: 'skipped', skipReason: null, evaluated: { state: 'off_hours', value: null, asOf: null, reason: 'skip:weekend' } }, {}));
    expect(section(html, 'h-ops')).toContain('<i>국내</i>건너뜀 · 주말');
  });
  test('실패 사유(failReason) — 데이터 모름 503 은 실패로: 「! 분석 실패 · 환율 모름」 · 모르는 코드는 사유 코드', () => {
    const html = renderDTO(withRuns({}, { runStatus: 'failed', failReason: 'fx_unknown', evaluated: { state: 'error', value: null, asOf: null } }));
    expect(section(html, 'h-ops')).toContain('<span class="mk"><i>해외</i><span class="st error">! 분석 실패 · 환율 모름</span></span>');
    const html2 = renderDTO(withRuns({}, { runStatus: 'failed', failReason: 'rag_fail', evaluated: { state: 'error', value: null, asOf: null } }));
    expect(textOf(section(html2, 'h-ops'))).toContain('! 분석 실패 · 사유 코드 rag_fail');
  });
});

describe('수정 6 — 분류코드를 영문 그대로 보이지 않는다 (R-UI Minor ⑨ · 표 #8)', () => {
  const line = (kind: 'order_rejected' | 'order_blocked', reason: string | null) =>
    checkLines([{ kind, severity: kind === 'order_rejected' ? 'e' : 'w', count: 1, params: { symbol: 'NAS:AAPL', side: 'sell', reason, market: 'overseas' }, href: '/recommend?tab=log' }], NOW)[0];
  test.each([
    ['insufficient_balance', '주문 가능 금액 부족 · 재시도하지 않음'], ['kis_5xx', '증권사 서버 오류 — 결과 확인 필요 · 재시도하지 않음'],
    ['market_closed', '장 마감·시간 외 · 재시도하지 않음'], ['totally_new', '사유 코드 totally_new · 재시도하지 않음'],
    // T-128 A3(c) — 사유가 비면(blocked_by IS NULL) 주문 차단 줄과 같이 「사유 기록 없음」 을 붙인다(예전 「재시도하지 않음」 만)
    [null, '사유 기록 없음 · 재시도하지 않음'], ['', '사유 기록 없음 · 재시도하지 않음'],
  ] as const)('주문 거부 %s → %s', (code, want) => {
    const l = line('order_rejected', code);
    expect(l.title).toBe('주문 거부 1건 — AAPL 매도');
    expect(l.sub).toBe(want);
  });
  test('주문 차단 사유가 비어 있으면(blocked_by IS NULL) 「사유 기록 없음 · 송신 안 됨」 — 「송신 안 됨」 만 남기지 않는다', () => {
    expect(line('order_blocked', null).sub).toBe('사유 기록 없음 · 송신 안 됨');
    expect(line('order_blocked', '').sub).toBe('사유 기록 없음 · 송신 안 됨');
  });
  test('주문 차단(안전장치 — 모든거래차단 제외): 「주문 차단 1건 — AAPL 매도」 / 「1일 주문 한도 · 송신 안 됨」 · 순서는 주문 거부 바로 뒤', () => {
    const l = line('order_blocked', 'daily_limit');
    expect([l.title, l.sub, l.severity, l.glyph]).toEqual(['주문 차단 1건 — AAPL 매도', '1일 주문 한도 · 송신 안 됨', 'w', '⊘']);
    const order = checkLines([
      { kind: 'order_blocked', severity: 'w', count: 1, params: { symbol: '005930', side: 'buy', reason: 'validation_gate', market: 'domestic' }, href: '/recommend?tab=log' },
      { kind: 'order_rejected', severity: 'e', count: 1, params: { symbol: '005930', side: 'buy', reason: 'kis_rejected', market: 'domestic' }, href: '/recommend?tab=log' },
      { kind: 'safety_unknown', severity: 'e', params: { errors: 'db_unreachable' }, href: '/settings' },
    ], NOW).map((x) => x.key);
    expect(order).toEqual(['safety-unknown', 'rejected', 'order-blocked']);
  });
});


describe('수정 3 — 최근 활동의 분석 건너뜀·실패 부제도 화면 사전과 같은 말', () => {
  const item = (params: Record<string, string | number | null>, sub: string) => ({ at: '2026-10-31T08:00:00+09:00', kind: 'analysis' as const, title: '해외 장마감 분석 건너뜀', sub, params });
  test('건너뜀 → 「건너뜀 · {사유}」(서버 사전 표기가 달라도 화면 사전으로) · 코드 없음 → 사유 모름', () => {
    expect(activitySub(item({ status: 'skipped', skipReason: 'overseas_disabled', failReason: null }, '건너뜀 · 해외 분석 꺼짐'))).toBe('건너뜀 · 해외 장마감 후 분석 꺼짐');
    expect(activitySub(item({ status: 'skipped', skipReason: null, failReason: null }, '건너뜀 · 사유 기록 없음'))).toBe('건너뜀 · 사유 모름');
    expect(activitySub(item({ status: 'skipped', skipReason: 'zz', failReason: null }, '건너뜀 · 사유 zz'))).toBe('건너뜀 · 사유 코드 zz');
  });
  test('실패 → 「실행 실패 · {사유}」 · 사유 없으면 서버 문구 · 그 밖 상태·종류는 서버 문구 그대로', () => {
    expect(activitySub(item({ status: 'failed', skipReason: null, failReason: 'holidays_unknown' }, 'x'))).toBe('실행 실패 · 휴장표 모름');
    expect(activitySub(item({ status: 'failed', skipReason: null, failReason: null }, '실행 실패 — 데이터 상태에서 확인'))).toBe('실행 실패 — 데이터 상태에서 확인');
    expect(activitySub(item({ status: 'ok', skipReason: null, failReason: null }, '44종목 · 시그널 1건'))).toBe('44종목 · 시그널 1건');
    expect(activitySub({ at: 'x', kind: 'order', title: 't', sub: '장마감 전 손절 · 주문 송신 없음', params: { status: 'skipped' } })).toBe('장마감 전 손절 · 주문 송신 없음');
  });
});
