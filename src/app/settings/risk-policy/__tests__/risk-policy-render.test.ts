/**
 * T-066 — 리스크 정책 화면 렌더 시험 (react-dom/server 정적 마크업, jsdom 불필요).
 * 승인 데모 v3(+승인 수정)·T-068 데모 v5 의 **문구·상태 표현·계산 결과**를 상태별로 고정한다. 픽셀·폭(360/412)은 브라우저 확인 몫.
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
import { DEFAULT_EDITABLE, POLICY_SOURCES, READ_ONLY_POLICY, type RiskExecutionLimits } from '@/lib/risk/defaults';
import { checkDraft, dirtyCount, draftFrom, type Draft, type SavedPolicy } from '@/components/risk/draft';
import type { RiskPolicyFeed } from '@/components/risk/useRiskPolicyFeed';
import type { RiskPolicyData } from '@/app/api/settings/risk-policy/route';
import type { SaveState } from '@/components/risk/RiskSettingsForm';
import { STOP_ALERT_EXAMPLE, stopAlertExamples } from '@/components/risk/StopAlertNotice';
import { emptyStopAlertState, formatStopAlert, planStopAlerts, symbolKey, type StopAlertPolicy } from '@/lib/risk/stop-alert';

const FX = 1250;
const H: HoldingInput[] = [
  { symbol: 'NAS:AAA', market: 'overseas', qty: 80, avgKrw: 132 * FX, peakKrw: 140 * FX, priceKrw: 124 * FX },
  { symbol: 'NAS:BBB', market: 'overseas', qty: 20, avgKrw: 60 * FX, peakKrw: 62 * FX, priceKrw: 48 * FX },
  { symbol: 'CCC001', market: 'domestic', qty: 50, avgKrw: 72000, peakKrw: 75000, priceKrw: 60000 },
  { symbol: 'DDD001', market: 'domestic', qty: 40, avgKrw: 62500, peakKrw: 66000, priceKrw: 50000 },
  { symbol: 'EEE001', market: 'domestic', qty: 20, avgKrw: 80000, peakKrw: 82000, priceKrw: 40000 },
];
const SAVED: SavedPolicy = { stopPct: 3, heatCapPct: 2, stopBasis: 'avg', version: 7, updatedAt: '2026-10-22T00:40:00.000Z' };

const EXEC_OK: RiskExecutionLimits = { scenarioSplitCap: 4, domesticMaxBuysPerSymbol24h: 4 };

function makeData(o: { policy?: SavedPolicy | null; holdings?: HoldingInput[]; ageMs?: number; stale?: boolean; noSnapshot?: boolean; execution?: RiskExecutionLimits } = {}): RiskPolicyData {
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
    execution: o.execution ?? EXEC_OK,
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

/** 말풍선 텍스트(공백 정리) — 렌더 순서대로 [도달 알림, 처음 요약] */
function bubbles(html: string): string[] {
  return html.split('<div class="bubble"').slice(1).map(b => {
    const end = b.indexOf('</span>', b.indexOf('<span class="tm">')) + '</span>'.length; // 말풍선 마지막 요소 = 시각
    return text('<div' + b.slice(0, end));
  });
}
const msgText = (m: { title: string; body: string }, time: string) => `${m.title} ${m.body.split('\n').filter(l => l !== '').join(' ')} ${time}`.replace(/\s+/g, ' ').trim();

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
    // 읽기 전용 정책표 — T-068 v5: 분할 매수 최대 4회 · 사용자 확정 · 비율 표기 없음 · 집행 중인 제한(둘 다 4 = 정책과 같음)
    expect(t).toContain('분할 매수 ✓ 사용자 확정 최대 4회 비율 고정 없음 · 구간·수량은 시나리오에서 정함 집행 중인 제한 '
      + 'ⓘ 확정 1회당 조각 최대 4개 시나리오 확정 요청마다 서버가 검사 · 시장 무관 '
      + 'ⓘ 국내 자동 매수 같은 종목 24시간 내 4건 국내 룰 엔진만 · 체결·접수된 매수 주문 수 '
      + '여러 번에 나눠 확정하는 누적 횟수는 아직 제한이 없습니다(후속 결정).');
    expect(t).toContain('보유 종목 최대 수 ✓ 사용자 확정 10종목 ✓ 5종목 5개 더 가능');
    expect(t).toContain('심볼당 최대 비중 ◇ 제안 · 승인 전 15% 문서 정책은 30% ! 초과 — AAA 62.0%');
    // T-068 v5: 현금은 정보 — 경고·미달·초록 ✓ 없이 중립 숫자
    expect(t).toContain('현금 비중 (정보 표시, 하한 없음) ✓ 사용자 확정 하한 없음 규칙 아님 · 표시만 3.0% 총자산 대비 현금');
    expect(t).toContain('미국 → 국내');
    expect(t).toContain('미국 70% · 국내 30%');
    expect(t).toContain('위 정책 값은 읽기 전용입니다. 변경은 사용자 승인 후 반영됩니다.');
    expect(t).toContain('자동 청산 엔진(지금 OFF, 기본 하드 손절 1.5%)');
    expect(t).not.toContain('변경 1건');
    expect(html).not.toContain('class="savebar');
    expect(html).not.toContain('최대 2회');
    expect(html).not.toContain('최대 3회');
    // 위험 표시는 amber — 손익 뜻 색(빨강/파랑)을 쓰지 않는다
    expect(html).not.toMatch(/var\(--(up|down)\)/);
    // T-068 v5: 현금 행은 경고·상태 기호 없음 → 정책표 경고(!)는 2건 → 1건(심볼당 최대 비중 초과만)
    const table = html.slice(html.indexOf('<table class="pol">'), html.indexOf('</table>', html.indexOf('<table class="pol">')));
    expect(table.match(/class="st warn"/g) ?? []).toHaveLength(1);
    const cashRow = table.slice(table.indexOf('현금 비중'), table.indexOf('</tr>', table.indexOf('현금 비중')));
    expect(cashRow).not.toMatch(/class="st (warn|ok)"/);
    expect(text(cashRow)).not.toMatch(/미달|!|✓ 3\.0%/);
    expect(t).not.toContain('현금 하한');
    // 알림 안내 블록은 손절 합 결과 바로 아래, 엔진 안내(ⓘ) 앞
    const iRes = t.indexOf('손절 합 — 모든 종목이'), iAlert = t.indexOf('🔔 손절가 도달 알림 — 텔레그램'), iInfo = t.indexOf('예상 손절가는 표시·위험 계산·알림용 입니다');
    expect(iRes).toBeGreaterThan(-1);
    expect(iAlert).toBeGreaterThan(iRes);
    expect(iInfo).toBeGreaterThan(iAlert);
    expect(t).toContain('이 화면은 주문을 만들지 않습니다. 손절가 도달 알림은 엔진과 별개라, 엔진이 꺼져 있어도 옵니다.');
  });

  test('입력 변경(저장 전): 손절폭 1.5% → 1.68% 한도 이내 · 미리보기 배지 · 변경 1건', () => {
    const t = text(body({ draft: { stopPct: '1.5', heatCapPct: '2', stopBasis: 'avg' } }));
    expect(t).toContain('◌ 저장 전 값 기준 미리보기');
    expect(t).toContain('1.68% (≈336,000원) ✓ 한도 이내');
    expect(t).toContain('한도 사용률 84% · 여유 64,000원');
    expect(t).toContain('변경 1 건 · 아래 값은 저장 전 값 기준입니다');
    expect(t).toContain('저장해도 매도 주문은 만들지 않습니다. 예상 손절가에 닿으면 텔레그램으로 알림만 보냅니다. 이 저장은 안전장치 저장과 별개입니다.');
    expect(t).not.toContain('매도 주문·알림은 만들지 않습니다');
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
    expect(t).toContain('최대 4회');
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
    expect(t).toContain('매도 주문은 만들지 않았습니다. 바뀐 손절가로 첫 확인 때는 알림 없이 기준만 새로 맞추고, 그다음부터 새 손절가에 닿으면 알립니다.');
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

describe('분할 매수 — 집행 중인 제한 (T-068 데모 v5 의 4가지 상태)', () => {
  const split = (execution: RiskExecutionLimits) => {
    const t = text(body({ data: makeData({ execution }) }));
    return t.slice(t.indexOf('분할 매수 ✓'), t.indexOf('시장 시장 우선순위'));
  };

  test('둘 다 4 (정책과 같음): ⓘ 2줄 · 경고 없음', () => {
    const t = split(EXEC_OK);
    expect(t).toContain('ⓘ 확정 1회당 조각 최대 4개');
    expect(t).toContain('ⓘ 국내 자동 매수 같은 종목 24시간 내 4건');
    expect(t).not.toContain('정책(4회)과 다름');
  });

  test('국내 한도 5 (WP-B 전·DB 덮어쓰기): 그 줄만 ! 정책과 다름', () => {
    const t = split({ scenarioSplitCap: 4, domesticMaxBuysPerSymbol24h: 5 });
    expect(t).toContain('ⓘ 확정 1회당 조각 최대 4개');
    expect(t).toContain('! 국내 자동 매수 같은 종목 24시간 내 5건 — 정책(4회)과 다름 국내 룰 엔진만 · 체결·접수된 매수 주문 수');
    expect(t.match(/정책\(4회\)과 다름/g)).toHaveLength(1);
  });

  test('확정 상한 3 (코드 상수가 다름): 그 줄만 ! 정책과 다름', () => {
    const t = split({ scenarioSplitCap: 3, domesticMaxBuysPerSymbol24h: 4 });
    expect(t).toContain('! 확정 1회당 조각 최대 3개 — 정책(4회)과 다름 시나리오 확정 요청마다 서버가 검사 · 시장 무관');
    expect(t).toContain('ⓘ 국내 자동 매수 같은 종목 24시간 내 4건');
    expect(t.match(/정책\(4회\)과 다름/g)).toHaveLength(1);
  });

  test('국내 한도 읽기 실패(null): — 확인 불가 · 확정 상한 줄은 그대로', () => {
    const t = split({ scenarioSplitCap: 4, domesticMaxBuysPerSymbol24h: null });
    expect(t).toContain('ⓘ 확정 1회당 조각 최대 4개');
    expect(t).toContain('— 국내 자동 매수 한도 확인 불가 엔진 설정을 읽지 못했습니다');
    expect(t).not.toContain('정책(4회)과 다름');
  });

  test.each([EXEC_OK, { scenarioSplitCap: 3, domesticMaxBuysPerSymbol24h: null }])('누적 제한 없음 문구는 상태와 무관하게 항상 — %p', (execution) => {
    expect(split(execution)).toContain('여러 번에 나눠 확정하는 누적 횟수는 아직 제한이 없습니다(후속 결정).');
  });

  test('초록 ● 집행 중 배지는 쓰지 않는다(안전장치 카드 전용)', () => {
    const html = body();
    const table = html.slice(html.indexOf('<table class="pol">'), html.indexOf('</table>'));
    expect(table).not.toContain('mode live');
    expect(table).not.toContain('● 집행 중');
  });
});

describe('손절가 도달 알림 안내 (T-068 데모 v5 — 정적 안내, 상태·토글 없음)', () => {
  test('규칙 4줄 · 시장별 요약 건수 · 도달 알림/요약 예시', () => {
    const html = body();
    const t = text(html);
    expect(t).toContain('🔔 손절가 도달 알림 — 텔레그램 주문·매도 없음');
    expect(t).toContain('보유 종목 현재가가 예상 손절가에 닿거나 아래로 내려가면 텔레그램으로 알립니다(장이 열린 시장만, 약 1분마다 확인).');
    expect(t).toContain('평가를 처음 시작할 때 이미 손절가 아래에 있는 보유 종목은 시장별로 요약 1건 만 알리고, 그 뒤에는 손절가 위로 올라갔다가 다시 내려올 때 종목별로 알립니다.');
    // WA-1: 시점 의존 표현(처음 켜지면·한 번 보냅니다) 없음 — WP-C 배포 후에도 참인 규칙 서술
    expect(t).not.toMatch(/처음 켜|한 번 보냅니다|한 번만 알립니다/);
    expect(t).toContain('같은 종목은 60분 안에 다시 알리지 않습니다 · 하루 최대 20건 .');
    expect(t).toContain('손절 설정을 저장한 직후 첫 확인은 알림 없이 기준만 새로 맞춥니다.');
    expect(t).toContain('현재 입력 기준 예상: 손절가 아래 5 종목(미국 2 · 국내 3). 평가를 처음 시작할 때 이런 종목은 종목별이 아니라 시장별 요약 2건 으로 알립니다.');
    // 말풍선 = 실제 발송 문구(formatStopAlert) — 합성 AAA(평균단가 $132.00) × (1 − 3%) = $128.04, 현재가 = 손절가 − $0.10
    expect(t).toContain('메시지 예시 — AAA 가 손절가 위에 있다가 막 닿은 경우 (합성값 · 지금 입력한 손절폭 3% 기준)');
    const [b1, b2] = bubbles(html);
    // 문구 고정(결합 시험) — formatStopAlert 문구가 바뀌면 여기서 깨진다
    expect(b1).toBe('🔻 손절가 도달 — 가상종목A (AAA) 현재가: $127.94 (159,925원) 예상 손절가: $128.04 (160,050원) (평균단가 기준 −3%) '
      + '평균단가: $132.00 (165,000원) 평가손익률: −3.08% 손절 시 손익: −396,000원 (−3.00%, 80주) 주문은 자동으로 나가지 않습니다. 직접 판단하세요. 10:31');
    expect(b2).toBe('🔻 이미 손절가 아래 — 미국 2종목 현재 2종목이 이미 예상 손절가 아래입니다 (평균단가 기준 −3%). '
      + '• 가상종목B (BBB): 현재가 $45.00 (56,250원) / 예상 손절가 $58.20 (72,750원) (손절가보다 22.68% 낮음) '
      + '• 가상종목C (CCC): 현재가 $36.00 (45,000원) / 예상 손절가 $48.50 (60,625원) (손절가보다 25.77% 낮음) '
      + '손절가 위로 다시 올라왔다가 내려오면 그때 종목별로 알립니다. 주문은 자동으로 나가지 않습니다. 직접 판단하세요. 09:31');
    // 실제 보유 종목명(AAA·BBB 는 makeData 의 NAS:AAA·NAS:BBB)·금액이 말풍선에 새지 않는다 — 합성 라벨만
    expect(b2).not.toMatch(/CCC001|DDD001|EEE001/);
    // 정적 안내 — 켜짐·꺼짐 상태 표시·토글 없음(결정 D3 = A)
    const box = html.slice(html.indexOf('<section class="alertbox"'), html.indexOf('</section>', html.indexOf('<section class="alertbox"')));
    expect(box).not.toMatch(/<input|<button|켜짐|꺼짐/);
    expect(box).not.toMatch(/var\(--(up|down)\)/);
  });

  test('입력한 손절폭·기준가로 예시 손절가가 바뀐다 (고점 기준 5%)', () => {
    const html = body({ draft: { stopPct: '5', heatCapPct: '2', stopBasis: 'peak' } });
    // 고점 $140.00 × 0.95 = $133.00 → 현재가 $132.90
    expect(bubbles(html)[0]).toContain('현재가: $132.90 (166,125원) 예상 손절가: $133.00 (166,250원) (보유 중 고점 기준 −5%) 보유 중 고점: $140.00 (175,000원)');
    expect(text(html)).toContain('지금 입력한 손절폭 5% 기준');
  });

  test('손절가 아래 종목이 없으면: 처음 닿는 종목부터 1건씩', () => {
    const above = H.map(x => ({ ...x, priceKrw: (x.avgKrw as number) * 1.01 }));
    const t = text(body({ data: makeData({ holdings: above }) }));
    expect(t).toContain('현재 입력 기준 예상: 손절가 아래 종목은 없습니다. 손절가에 처음 닿는 종목부터 1건씩 알립니다.');
    expect(t).toContain('🔻 이미 손절가 아래 — 미국 2종목'); // 예시는 실제 보유와 무관한 합성값 고정
  });

  test('국내만 아래: 시장별 요약 1건', () => {
    const mixed = H.map(x => (x.market === 'overseas' ? { ...x, priceKrw: (x.avgKrw as number) * 1.01 } : x));
    const t = text(body({ data: makeData({ holdings: mixed }) }));
    expect(t).toContain('현재 입력 기준 예상: 손절가 아래 3 종목(미국 0 · 국내 3). 평가를 처음 시작할 때 이런 종목은 종목별이 아니라 시장별 요약 1건 으로 알립니다.');
  });
});

describe('알림 말풍선 = 실제 발송 포맷 출력 (Leader 결정 10-22, 결합 시험)', () => {
  const E = STOP_ALERT_EXAMPLE;
  const labels = Object.fromEntries([E.cross, ...E.summary].map(x => [symbolKey('overseas', x.symbol), x.label]));
  const hold = (symbol: string, qty: number, avg: number, peak: number, price: number) =>
    ({ symbol, market: 'overseas' as const, qty, avgKrw: avg * E.fx, peakKrw: peak * E.fx, priceKrw: price * E.fx, fx: E.fx });

  /** 화면 코드와 독립적으로 판정·포맷을 직접 돌린다 — 화면이 문구를 복제하거나 입력을 바꾸면 불일치로 깨진다 */
  function direct(stopPct: number, stopBasis: 'avg' | 'peak') {
    const now = new Date(E.now);
    const policy: StopAlertPolicy = { stopPct, heatCapPct: 2, stopBasis, version: 1 };
    const ref = stopBasis === 'avg' ? E.cross.avgUsd : E.cross.peakUsd;
    const price = Math.round(ref * (1 - stopPct / 100) * 100) / 100 - 0.1;
    const prev = emptyStopAlertState(now);
    prev.policyVersion = 1;
    prev.symbols[symbolKey('overseas', E.cross.symbol)] = { state: 'above', since: '2026-10-22T00:00:00.000Z', lastAlertAt: null, rearm: 0, pv: 1 };
    const cross = planStopAlerts({ now, policy, prev, holdings: [hold(E.cross.symbol, E.cross.qty, E.cross.avgUsd, E.cross.peakUsd, price)] }).alerts;
    const sum = planStopAlerts({ now, policy, prev: null, holdings: E.summary.map(x => hold(x.symbol, x.qty, x.avgUsd, x.peakUsd, x.pxUsd)) }).alerts;
    expect(cross.map(a => a.kind)).toEqual(['cross']);
    expect(sum.map(a => a.kind)).toEqual(['summary']);
    return { cross: formatStopAlert(cross[0], labels), summary: formatStopAlert(sum[0], labels) };
  }

  test.each([[3, 'avg'], [0.5, 'avg'], [20, 'avg'], [5, 'peak'], [20, 'peak'], [12.34, 'peak']] as [number, 'avg' | 'peak'][])(
    '손절폭 %p · %s — 화면 말풍선 텍스트가 판정+포맷 직접 호출 결과와 같다', (stopPct, stopBasis) => {
      const want = direct(stopPct, stopBasis);
      expect(stopAlertExamples({ stopPct, heatCapPct: 2, stopBasis })).toEqual(want);
      const html = body({ draft: { stopPct: String(stopPct), heatCapPct: '2', stopBasis } });
      expect(bubbles(html)).toEqual([msgText(want.cross, '10:31'), msgText(want.summary, '09:31')]);
      // 본문 줄 구분 유지 — 빈 줄 앞은 줄 단위, 뒤(안내·주의)는 .foot
      expect(html).toContain('<div class="foot"><div>주문은 자동으로 나가지 않습니다. 직접 판단하세요.</div></div>');
    });

  test('말풍선 모양·접근성은 데모 v5 그대로 (role=img · aria-label · 시각)', () => {
    const html = body();
    expect(html.match(/<div class="bubble" role="img" aria-label="텔레그램 손절가 도달 알림 예시">/g)).toHaveLength(1);
    expect(html.match(/<div class="bubble" role="img" aria-label="텔레그램 첫 평가 요약 알림 예시">/g)).toHaveLength(1);
  });

  test('예시 입력은 합성값 고정 — 실제 보유가 바뀌어도 말풍선은 같다', () => {
    const a = bubbles(body());
    const other = bubbles(body({ data: makeData({ holdings: H.map(x => ({ ...x, symbol: x.symbol + 'X' })) }) }));
    expect(other).toEqual(a);
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
    expect(t).toContain('리스크 정책 ◌ 표시·위험 계산·알림 (주문·매도 없음)');
    expect(t).not.toContain('표시·위험 계산 전용');
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
    expect(t).toContain('‹ 설정 리스크 정책 ◌ 표시·위험 계산·알림 (주문·매도 없음)');
    expect(t).toContain('이 정책은 아직 주문을 막지 않습니다 . 예상 손절가는 계산·표시·알림용이고 자동으로 팔지 않습니다 .');
    expect(t).toContain('리스크 정책을 불러오는 중…');
  });
});
