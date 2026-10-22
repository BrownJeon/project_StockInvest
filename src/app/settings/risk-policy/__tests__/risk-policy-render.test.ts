/**
 * T-066 — 리스크 정책 화면 렌더 시험 (react-dom/server 정적 마크업, jsdom 불필요).
 * 승인 데모 v3(+승인 수정)의 **문구·상태 표현·계산 결과**를 상태별로 고정한다. 픽셀·폭(360/412)은 브라우저 확인 몫.
 * 숫자는 데모 합성값(AAA~EEE, 환율 1,250, 총자산 2,000만원)이다.
 */
import * as ReactNS from 'react';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

(globalThis as unknown as { React: typeof ReactNS }).React = ReactNS;

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn(), back: jest.fn() }), usePathname: () => '/settings/risk-policy' }));

import { RiskBody, RiskPolicyPage } from '@/app/settings/risk-policy/RiskPolicyPage';
import { RiskPolicySummaryRow } from '@/app/settings/RiskPolicySummaryRow';
import { RiskSummary } from '@/components/risk/RiskSummary';
import { EnforcedStrip } from '@/components/risk/EnforcedStrip';
import { computeRisk, type HoldingInput } from '@/lib/risk/compute';
import { DEFAULT_EDITABLE, POLICY_SOURCES, READ_ONLY_POLICY } from '@/lib/risk/defaults';
import { checkDraft, dirtyCount, draftFrom, type Draft, type SavedPolicy } from '@/components/risk/draft';
import type { RiskPolicyFeed } from '@/components/risk/useRiskPolicyFeed';
import type { RiskPolicyData } from '@/app/api/settings/risk-policy/route';
import type { SaveState } from '@/components/risk/RiskSettingsForm';

const FX = 1250;
const H: HoldingInput[] = [
  { symbol: 'NAS:AAA', market: 'overseas', qty: 80, avgKrw: 132 * FX, peakKrw: 140 * FX, priceKrw: 124 * FX },
  { symbol: 'NAS:BBB', market: 'overseas', qty: 20, avgKrw: 60 * FX, peakKrw: 62 * FX, priceKrw: 48 * FX },
  { symbol: 'CCC001', market: 'domestic', qty: 50, avgKrw: 72000, peakKrw: 75000, priceKrw: 60000 },
  { symbol: 'DDD001', market: 'domestic', qty: 40, avgKrw: 62500, peakKrw: 66000, priceKrw: 50000 },
  { symbol: 'EEE001', market: 'domestic', qty: 20, avgKrw: 80000, peakKrw: 82000, priceKrw: 40000 },
];
const SAVED: SavedPolicy = { stopPct: 3, heatCapPct: 2, stopBasis: 'avg', version: 7, updatedAt: '2026-10-22T00:40:00.000Z' };

function makeData(o: { policy?: SavedPolicy | null; holdings?: HoldingInput[]; ageMs?: number; stale?: boolean; noSnapshot?: boolean } = {}): RiskPolicyData {
  const policy = o.policy === undefined ? SAVED : o.policy;
  const holdings = o.holdings ?? H;
  const at = new Date(Date.now() - (o.ageMs ?? 10 * 60 * 1000)).toISOString();
  const snapshot = o.noSnapshot ? null : { at, stale: !!o.stale, totalKrw: 20_000_000, cashKrw: 600_000, fx: FX };
  return {
    enforcement: 'display_only',
    policy: policy ? { ...policy, history: [], readOnly: READ_ONLY_POLICY, sources: POLICY_SOURCES } : null,
    defaults: { ...DEFAULT_EDITABLE },
    readOnly: READ_ONLY_POLICY,
    sources: POLICY_SOURCES,
    snapshot,
    holdings: o.noSnapshot ? [] : holdings,
    computed: computeRisk(o.noSnapshot ? [] : holdings, snapshot?.totalKrw ?? 0, policy ?? DEFAULT_EDITABLE, 600_000),
    exitEngine: { enabled: false },
  } as RiskPolicyData;
}

function feedOf(data: RiskPolicyData | null, load: RiskPolicyFeed['load'] = 'ready', extra: Partial<RiskPolicyFeed> = {}): RiskPolicyFeed {
  return {
    data, load, loadError: load === 'error' ? '서버 응답 503' : null, poll: 'live',
    lastCheckAt: Date.now(), nextAt: Date.now() + 42_000, reload: () => undefined, replace: () => undefined, ...extra,
  };
}

function body(o: {
  data?: RiskPolicyData | null; load?: RiskPolicyFeed['load']; saved?: SavedPolicy | null; draft?: Draft;
  saveState?: SaveState; saveError?: string | null; remote?: SavedPolicy | null; syncNote?: string | null; feedExtra?: Partial<RiskPolicyFeed>;
} = {}): string {
  const saved = o.saved === undefined ? SAVED : o.saved;
  const data = o.data === undefined ? makeData({ policy: saved }) : o.data;
  const draft = o.draft ?? draftFrom(saved);
  const check = checkDraft(draft, saved);
  const c = data ? computeRisk(data.holdings, data.snapshot?.totalKrw ?? 0, check.eff, data.snapshot?.cashKrw ?? null) : null;
  const noop = () => undefined;
  return renderToStaticMarkup(h(RiskBody, {
    feed: feedOf(data, o.load ?? 'ready', o.feedExtra), c, draft, check, saved, dirty: dirtyCount(draft, saved),
    saveState: o.saveState ?? 'idle', saveError: o.saveError ?? null, savedAtText: '13:30',
    remote: o.remote ?? null, syncNote: o.syncNote ?? null,
    onChange: noop, onSave: noop, onCancel: noop, onTakeServer: noop, onKeepMine: noop,
  }));
}

function text(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#x27;/g, "'").replace(/\s+/g, ' ').trim();
}

describe('리스크 정책 화면 — 상태별', () => {
  test('로딩: 스켈레톤 + 읽어 주는 상태 문구', () => {
    const html = body({ data: null, load: 'loading' });
    expect(html).toContain('aria-busy="true"');
    expect(text(html)).toContain('리스크 정책을 불러오는 중…');
  });

  test('조회 오류: 정책이 없어진 게 아님을 밝히고 다시 시도', () => {
    const t = text(body({ data: null, load: 'error' }));
    expect(t).toContain('리스크 정책·보유 종목을 불러오지 못했습니다');
    expect(t).toContain('저장된 정책이 없어진 것이 아닙니다. 오류: 서버 응답 503');
    expect(t).toContain('다시 시도');
  });

  test('정상(저장된 값 = 입력값): 손절 합 3.36% 한도 초과 · 역산 1.78% · 5종목 손절가 아래 · 저장 바 없음', () => {
    const html = body();
    const t = text(html);
    expect(t).toContain('손절 설정 — 여기서만 변경');
    expect(t).toContain('저장된 버전 7 · 10-22 09:40');
    expect(t).toContain('저장된 값 기준');
    expect(t).toContain('3.36% (≈672,000원) ! 한도 초과');
    expect(t).toContain('한도 사용률 168% · 초과 272,000원');
    expect(t).toContain('지금 보유 규모로는 한도를 넘습니다');
    expect(t).toContain('손절폭 ≤ 1.78%');
    expect(t).toContain('= 한도 2% × 총자산 20,000,000원 ÷ 취득원가 합 22,400,000원');
    expect(t).toContain('! 이미 손절가 아래 5종목 · 평가손 합계 -3,000,000원 (총자산의 15.00%)');
    expect(t).toContain('AAA · BBB · CCC001 · DDD001 · EEE001 — 현재가가 예상 손절가보다 낮습니다');
    expect(t).toContain('자동 매도는 없습니다 — 직접 판단하세요.');
    // 종목 행 — 미국은 $ (원화 ÷ 환율), 국내는 원
    expect(t).toContain('예상 손절가 $128.04');
    expect(t).toContain('현재가 $124.00');
    expect(t).toContain('손절가보다 3.2% 낮음');
    expect(t).toContain('손절 시 손익 -396,000원 -3.0%');
    expect(t).toContain('69,840원'); // CCC 72,000 × 0.97
    expect(t).toContain('평균단가 × (1 − 3%) · 실시간 계산 · 읽기 전용');
    // 읽기 전용 정책표 — 승인 수정: 분할 매수 최대 3회 · 사용자 확정 · 비율 40/30/30 제안
    expect(t).toContain('분할 매수 ✓ 사용자 확정 최대 3회 40 / 30 / 30 (비율은 제안)');
    expect(t).toContain('보유 종목 최대 수 ✓ 사용자 확정 10종목 ✓ 5종목 5개 더 가능');
    expect(t).toContain('심볼당 최대 비중 ◇ 제안 · 승인 전 15% 문서 정책은 30% ! 초과 — AAA 62.0%');
    expect(t).toContain('현금 하한 § 문서 정책 총자산의 10% ≈2,000,000원 ! 미달 — 3.0%');
    expect(t).toContain('미국 → 국내');
    expect(t).toContain('미국 70% · 국내 30%');
    expect(t).toContain('위 정책 값은 읽기 전용입니다. 변경은 사용자 승인 후 반영됩니다.');
    expect(t).toContain('자동 청산 엔진(지금 OFF, 기본 하드 손절 1.5%)');
    expect(t).not.toContain('변경 1건');
    expect(html).not.toContain('class="savebar');
    expect(html).not.toContain('최대 2회');
    // 위험 표시는 amber — 손익 뜻 색(빨강/파랑)을 쓰지 않는다
    expect(html).not.toMatch(/var\(--(up|down)\)/);
  });

  test('입력 변경(저장 전): 손절폭 1.5% → 1.68% 한도 이내 · 미리보기 배지 · 변경 1건', () => {
    const t = text(body({ draft: { stopPct: '1.5', heatCapPct: '2', stopBasis: 'avg' } }));
    expect(t).toContain('◌ 저장 전 값 기준 미리보기');
    expect(t).toContain('1.68% (≈336,000원) ✓ 한도 이내');
    expect(t).toContain('한도 사용률 84% · 여유 64,000원');
    expect(t).toContain('변경 1 건 · 아래 값은 저장 전 값 기준입니다');
    expect(t).toContain('저장해도 매도 주문·알림은 만들지 않습니다. 이 저장은 안전장치 저장과 별개입니다.');
    expect(t).toContain('평균단가 × (1 − 1.5%)');
  });

  test('잘못된 입력(25): 오류 문구 · aria-invalid · 저장 막힘 · 계산은 저장된 값', () => {
    const html = body({ draft: { stopPct: '25', heatCapPct: '2', stopBasis: 'avg' } });
    const t = text(html);
    expect(t).toContain('0.5% ~ 20% 사이로 넣어 주세요.');
    expect(t).toContain('잘못된 값 1건을 고쳐야 저장할 수 있습니다');
    expect(t).toContain('잘못된 입력값은 계산에 쓰지 않고 저장된 값으로 계산했습니다');
    expect(t).toContain('3.36%');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toMatch(/<button type="button" class="btn pri" disabled="" aria-disabled="true">저장<\/button>/);
  });

  test('10% 초과는 경고만 (저장 가능)', () => {
    const html = body({ draft: { stopPct: '12', heatCapPct: '2', stopBasis: 'avg' } });
    expect(text(html)).toContain('10%보다 크면 손절이 늦어져 한 번에 잃는 돈이 커집니다.');
    expect(html).toMatch(/<button type="button" class="btn pri">저장<\/button>/);
  });

  test('고점 기준: 표 제목·기준가 열이 고점으로 바뀌고 이익 구간은 손절 합에서 빠짐', () => {
    const t = text(body({ draft: { stopPct: '3', heatCapPct: '2', stopBasis: 'peak' } }));
    expect(t).toContain('고점 × (1 − 3%)');
    expect(t).toContain('0.05% (≈9,200원) ✓ 한도 이내');
    expect(t).toContain('(고점 기준, 수치 계산)');
  });

  test('정책 미저장(처음 설정): 제안값 안내 · 처음 저장 · 아직 저장 안 됨', () => {
    const t = text(body({ saved: null, data: makeData({ policy: null }) }));
    expect(t).toContain('! 아직 저장된 리스크 정책이 없습니다. 아래 값은 제안값(손절폭 3% · 한도 2% · 평균단가 기준)으로 미리 계산한 것입니다. 저장해야 정책이 됩니다.');
    expect(t).toContain('아직 저장 안 됨');
    expect(t).toContain('정책을 처음 저장합니다');
    expect(t).toContain('◌ 저장 전 값 기준 미리보기');
    expect(t).not.toContain('취소');
    // 읽기 전용 표는 정책이 없어도 defaults 로 보인다
    expect(t).toContain('최대 3회');
  });

  test('저장 중: 입력 잠금 · 서버 확인 전 표시', () => {
    const html = body({ saveState: 'saving', draft: draftFrom(SAVED) });
    const t = text(html);
    expect(t).toContain('◌ 저장 중 — 서버 확인 전');
    expect(t).toContain('저장 중… 화면에는 먼저 반영했습니다(서버 확인 전).');
    expect(html).toMatch(/<input[^>]*disabled=""[^>]*value="3"/);
  });

  test('저장됨: 서버 확정 버전', () => {
    const t = text(body({ saveState: 'saved', saved: { ...SAVED, version: 8 } }));
    expect(t).toContain('✓ 저장됨 13:30 서버 확정값(버전 8)으로 갱신했습니다.');
    expect(t).toContain('매도 주문·알림은 만들지 않았습니다.');
  });

  test('저장 실패: 되돌림 · 입력 유지 · 다시 시도', () => {
    const t = text(body({ saveState: 'failed', saveError: '서버 응답 500', draft: { stopPct: '2', heatCapPct: '2', stopBasis: 'avg' } }));
    expect(t).toContain('저장하지 못했습니다 — 서버 응답 500');
    expect(t).toContain('저장된 값으로 되돌렸고, 입력한 값은 그대로 있습니다.');
    expect(t).toContain('입력 취소');
    expect(t).toContain('다시 시도');
  });

  test('409 충돌: 최신 저장값 · 서버 값 쓰기 / 내 값으로 저장', () => {
    const latest = { ...SAVED, stopPct: 2.5, version: 8 };
    const t = text(body({ saveState: 'conflict', saved: latest, draft: { stopPct: '4', heatCapPct: '2', stopBasis: 'avg' } }));
    expect(t).toContain('저장하지 않았습니다 — 다른 기기에서 먼저 바뀌었습니다');
    expect(t).toContain('최신 저장값(손절폭 2.5% · 손절 합 한도 2% · 평균단가 기준, 버전 8)을 불러왔습니다.');
    expect(t).toContain('서버 값 쓰기');
    expect(t).toContain('내 값으로 저장');
  });

  test('편집 중 다른 기기 저장 감지: 덮어쓰기 경고 + 선택', () => {
    const t = text(body({ remote: { ...SAVED, stopPct: 2.5, version: 8 }, draft: { stopPct: '4', heatCapPct: '2', stopBasis: 'avg' } }));
    expect(t).toContain('! 다른 기기에서 저장됐습니다(버전 8) — 손절폭 2.5%. 지금 바꾸는 값을 저장하면 그 값을 덮어씁니다.');
    expect(t).toContain('내 값 유지');
  });

  test('재조회 실패: 마지막 값 유지 표시', () => {
    const t = text(body({ feedExtra: { poll: 'fail' } }));
    expect(t).toContain('! 재조회 실패 — 마지막 값 유지');
    expect(t).toContain('다음 확인 42 초');
  });

  test('스냅샷 오래됨(3시간 초과)', () => {
    const t = text(body({ data: makeData({ ageMs: 18 * 3600 * 1000 + 60_000, stale: true }) }));
    expect(t).toContain('! 스냅샷이 18시간 전(');
    expect(t).toContain('현재가·총자산·금액 환산이 실제와 다를 수 있습니다.');
    expect(t).toContain('! 오래됨');
  });

  test('스냅샷 없음', () => {
    const t = text(body({ data: makeData({ noSnapshot: true }) }));
    expect(t).toContain('! 포트폴리오 스냅샷이 아직 없습니다.');
    expect(t).toContain('보유 종목이 없습니다.');
  });

  test('평균단가 없는 종목: 계산 불가 + 일부 계산 불가', () => {
    const hs = H.map((x, i) => (i === 0 ? { ...x, avgKrw: null } : x));
    const t = text(body({ data: makeData({ holdings: hs }) }));
    expect(t).toContain('— 계산 불가');
    expect(t).toContain('평균단가 없음');
    expect(t).toContain('일부 계산 불가 — 1종목은');
  });
});

describe('안전장치 영역 요약 (구조 A)', () => {
  test('저장된 정책: 손절폭·한도·손절 합·손절가 아래·스냅샷 시각', () => {
    const d = makeData();
    const t = text(renderToStaticMarkup(h(RiskSummary, {
      state: 'ready', c: d.computed, eff: SAVED, policySaved: true, snapshotAt: '2026-10-22T01:00:00.000Z', stale: false,
    })));
    expect(t).toContain('손절폭 3% (평균단가 기준) · 손절 합 한도 2%');
    expect(t).toContain('! 손절 합 3.36% — 한도 초과 (≈672,000원)');
    expect(t).toContain('! 이미 손절가 아래 5종목 평가손 -3,000,000원');
    expect(t).toContain('현재가 기준 10:00 스냅샷');
    expect(t).not.toContain('정책 미저장');
  });

  test('정책 미저장: 배지 + 저장 전 값', () => {
    const d = makeData({ policy: null });
    const t = text(renderToStaticMarkup(h(RiskSummary, {
      state: 'ready', c: d.computed, eff: DEFAULT_EDITABLE, policySaved: false, snapshotAt: d.snapshot!.at, stale: false,
    })));
    expect(t).toContain('! 정책 미저장');
    expect(t).toContain('저장 전 값');
  });

  test('오래됨·오류·로딩', () => {
    const d = makeData();
    expect(text(renderToStaticMarkup(h(RiskSummary, { state: 'ready', c: d.computed, eff: SAVED, policySaved: true, snapshotAt: '2026-10-21T07:00:00.000Z', stale: true }))))
      .toContain('현재가 기준 10-21 16:00 (오래됨)');
    expect(text(renderToStaticMarkup(h(RiskSummary, { state: 'error', c: null, eff: SAVED, policySaved: false, snapshotAt: null, stale: false }))))
      .toContain('불러오지 못했습니다 — 눌러서 다시 확인');
    expect(text(renderToStaticMarkup(h(RiskSummary, { state: 'loading', c: null, eff: SAVED, policySaved: false, snapshotAt: null, stale: false }))))
      .toBe('불러오는 중…');
  });

  test('요약 행 첫 렌더: 리스크 정책 화면으로 가는 링크 · 표시 전용 배지 · 불러오는 중', () => {
    const html = renderToStaticMarkup(h(RiskPolicySummaryRow));
    expect(html).toContain('href="/settings/risk-policy"');
    const t = text(html);
    expect(t).toContain('리스크 정책 ◌ 표시·위험 계산 전용');
    expect(t).toContain('불러오는 중…');
    expect(t).toContain('손절 설정·예상 손절가 보기');
  });

  test('집행 중 띠', () => {
    expect(text(renderToStaticMarkup(h(EnforcedStrip)))).toBe('● 집행 중 이 카드의 설정은 실제 주문에 바로 적용됩니다');
  });

  test('리스크 정책 페이지 첫 렌더: 머리글·안내 띠·로딩', () => {
    const html = renderToStaticMarkup(h(RiskPolicyPage));
    const t = text(html);
    expect(html).toContain('href="/settings"');
    expect(t).toContain('‹ 설정 리스크 정책 ◌ 표시·위험 계산 전용');
    expect(t).toContain('이 정책은 아직 주문을 막지 않습니다 . 예상 손절가는 계산·표시용이고 자동으로 팔지 않습니다 .');
    expect(t).toContain('리스크 정책을 불러오는 중…');
  });
});
