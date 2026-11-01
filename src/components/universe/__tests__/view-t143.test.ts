/**
 * T-143 WP-B — 화면 문구 (구현 가이드 §2.2·§2.4.3·§2.6·§2.7). 순수 함수 시험.
 *
 * 🔴 이 시험이 지키는 두 가지(가이드 §8.4 완료 기준 ②):
 *   ① **보유 중이면 분석이 계속된다**는 사실이 보유 칩·대조 줄·효과 문장에 남는다.
 *   ② **12월 정기 재구성은 공시에 나오지 않는다**는 경고가 빈 상태에도 남는다 — 알림이 조용한 것은 목록이 맞다는 뜻이 아니다.
 * 그리고 **「3곳 모두 확인」은 서버가 그렇게 말할 때만** 쓴다(확인하지 않은 것을 확인했다고 쓰지 않는다).
 */
import {
  APPLY_TIMING_TEXT, BULK_FAIL_TEXT, BULK_SHEET_TAIL, DECEMBER_NOTE, DIFF_OK_NOTE, LIST_FOOT_FALLBACK_LEAD,
  PROPOSAL_FAILED_TEXT, PROPOSAL_SAVED_UNREADABLE_TEXT, SHEET_TAIL, autoTileLabel, autoTileMeta, bulkConfirmVerb,
  bulkEmptyConfirmText, bulkHint2, bulkRemovedExplainText, bulkSaveLabel, bulkSavedUnreadableText, bulkSheetLead,
  bulkSheetTitle, bulkSuccessText, diffEmptyNote, diffHeldNote, effectText, emptyLeadText, heldChipText, listFoot,
  manualSourceLabel, manualTileLabel, manualTileMeta, md, mdhm, partialWatchRow, proposalHeldText, proposalTileMeta,
  summaryRowSub, watchSummaryText, ymd, PROPOSAL_DONE_TAIL,
} from '../view';
import type { ProposalEffect, UniverseSummary, UniverseWatch } from '@/lib/universe/types';

const SUMMARY: UniverseSummary = {
  total: 150, manual: 98, auto: 50, favorites: 7, held: 4,
  manualUpdatedAt: '2025-12-19T21:40:00+09:00', manualUpdatedDaysAgo: 349, manualVersion: 7,
  autoRefreshedAt: '2026-12-01T02:40:00+09:00', autoNextAt: '2027-01-01T02:00:00+09:00',
  autoTopN: 50, heldOrFavoritesOnlyCount: 11,
};

describe('시각 자르기 — 서버가 만든 KST ISO 를 자리만 잘라 쓴다', () => {
  it('md · mdhm · ymd', () => {
    expect(md('2026-12-02T09:14:00+09:00')).toBe('12-02');
    expect(mdhm('2026-12-02T09:14:00+09:00')).toBe('12-02 09:14');
    expect(ymd('2025-12-19T21:40:00+09:00')).toBe('2025-12-19');
  });
  it('해석 불가·null 은 null — 오늘로 꾸미지 않는다', () => {
    for (const v of [null, undefined, '', 'nope', '2026-12-02']) {
      expect(md(v)).toBeNull();
      expect(mdhm(v)).toBeNull();
    }
  });
});

describe('머리 숫자 4칸 (§2.2)', () => {
  it('🔴 자동 칸 라벨에 50 을 박지 않는다 — 서버가 준 개수(Q4)로 만든다', () => {
    expect(autoTileLabel(50)).toBe('자동 — NYSE 상위 50');
    expect(autoTileLabel(30)).toBe('자동 — NYSE 상위 30');
    expect(autoTileLabel(null)).toBe('자동 — NYSE 상위');
  });
  it('🔴 「수동 갱신 N일 전」 — 12월 재구성을 놓쳤는지 보는 유일한 단서(§8.3 T-2)', () => {
    expect(manualTileMeta(SUMMARY)).toBe('갱신 2025-12-19 · 349일 전');
    expect(manualTileMeta({ manualUpdatedAt: SUMMARY.manualUpdatedAt, manualUpdatedDaysAgo: null })).toBe('갱신 2025-12-19');
    expect(manualTileMeta({ manualUpdatedAt: null, manualUpdatedDaysAgo: null })).toBe('갱신 기록 없음');
  });
  it('자동 칸 meta — 산출 기록이 없으면 「다음」을 말하지 않는다(돌지 않는 작업의 예정은 약속이 아니다)', () => {
    expect(autoTileMeta(SUMMARY)).toBe('산출 12-01 02:40 · 다음 01-01');
    expect(autoTileMeta({ autoRefreshedAt: SUMMARY.autoRefreshedAt, autoNextAt: null })).toBe('산출 12-01 02:40');
    expect(autoTileMeta({ autoRefreshedAt: null, autoNextAt: '2027-01-01T02:00:00+09:00' })).toBe('아직 산출하지 않았습니다');
  });
  it('변경 제안 칸 meta', () => {
    expect(proposalTileMeta(3)).toBe('확인 필요');
    expect(proposalTileMeta(0)).toBe('지금 확인할 것 없음');
  });
  it('설정 요약 행 부제 — 갱신 기록이 없으면 그 구절을 뺀다', () => {
    expect(summaryRowSub(SUMMARY)).toBe('150종목 · 수동 98 · 자동 50 · 수동 갱신 2025-12-19');
    expect(summaryRowSub({ ...SUMMARY, manualUpdatedAt: null })).toBe('150종목 · 수동 98 · 자동 50');
  });
});

describe('🔴 보유 (§2.4.2)', () => {
  it('수량을 모르면 「보유」 — 0 으로 채우지 않는다', () => {
    expect(heldChipText(2)).toBe('보유 2주');
    expect(heldChipText(null)).toBe('보유');
    expect(heldChipText(0)).toBe('보유');
    expect(heldChipText(1.5)).toBe('보유 1.5주');
  });
  it('일괄 교체 대조의 빼는 줄에도 「빼도 분석은 계속」이 남는다(4곳 중 넷째)', () => {
    expect(diffHeldNote(2, true)).toBe('· 보유 2주 — 빼도 분석은 계속');
    expect(diffHeldNote(null, true)).toBe('· 보유 — 빼도 분석은 계속');
    expect(diffHeldNote(2, false)).toBeNull();
  });
});

describe('확인 시트 효과 문장 (§2.4.3)', () => {
  const e = (o: Partial<ProposalEffect>): ProposalEffect =>
    ({ manualFrom: 98, manualTo: 97, totalFrom: 150, totalTo: 149, heldKeepsAnalysis: false, ...o });

  it('빼기 — 수동·분석 대상 둘 다 줄어드는 경우', () => {
    expect(effectText('remove', e({}))).toBe('수동 목록에서 빼면 98 → 97 종목, 분석 대상 150 → 149 종목.');
  });
  it('🔴 빼기 — 보유 중이면 분석 대상 수가 그대로라고 말한다', () => {
    expect(effectText('remove', e({ totalTo: 150, heldKeepsAnalysis: true })))
      .toBe('수동 목록에서 빼면 98 → 97 종목. 보유 중이라 분석 대상 수는 150 그대로입니다.');
  });
  it('넣기 — 이미 분석 대상이면 그 사실을 말한다', () => {
    expect(effectText('add', e({ manualTo: 99, totalTo: 150 })))
      .toBe('수동 목록에 넣으면 98 → 99 종목. 분석 대상 수는 150 그대로입니다.');
    expect(effectText('add', e({ manualTo: 99, totalTo: 151 })))
      .toBe('수동 목록에 넣으면 98 → 99 종목, 분석 대상 150 → 151 종목.');
  });
  it('코드 바꾸기 — 수가 그대로면 「그대로」, 줄면 숫자를 말한다. 안 바꾸면 매일 실패한다는 경고를 남긴다', () => {
    const same = effectText('recode', e({ manualTo: 98, totalTo: 150 }));
    expect(same).toContain('98 종목 그대로');
    expect(same).toContain('KIS 조회가 매일 실패');
    expect(effectText('recode', e({ manualTo: 97, totalTo: 149 }))).toContain('98 → 97 종목');
  });
  it('🔴 effect 가 null 이면 그 줄을 뺀다 — 숫자를 추측해 만들지 않는다(목록 조회 실패)', () => {
    expect(effectText('remove', null)).toBeNull();
  });
  it('꼬리말이 주문이 아니라는 사실을 말한다', () => {
    expect(SHEET_TAIL).toContain('주문이 아닙니다');
    expect(SHEET_TAIL).toContain('실거래여부·모든거래차단과 무관');
  });
  it('🔴 일괄 교체 꼬리말은 「되돌릴 수 있습니다」를 약속하지 않는다(L-4) — 이력에 남는다고만 말한다', () => {
    expect(BULK_SHEET_TAIL).toContain('변경 이력에 남습니다');
    expect(BULK_SHEET_TAIL).not.toContain('되돌릴 수 있습니다');
  });
});

describe('보류 줄 (D4)', () => {
  it('해제 시각을 서버 값으로 말한다 — 화면이 날짜를 계산하지 않는다', () => {
    expect(proposalHeldText('2027-01-01T02:00:00+09:00'))
      .toBe('보류 — 다음 「해외 분석 대상 갱신」(01-01)까지 숨깁니다. 공시가 갱신되면 그때 다시 올라옵니다.');
  });
  it('모르면 날짜를 꾸미지 않는다', () => {
    expect(proposalHeldText(null)).toBe('보류 — 다음 「해외 분석 대상 갱신」까지 숨깁니다. 공시가 갱신되면 그때 다시 올라옵니다.');
  });
});

describe('🔴 빈 상태 (§2.7) — 확인하지 않은 것을 확인했다고 쓰지 않는다', () => {
  const watch = (over: Partial<UniverseWatch> = {}): UniverseWatch => ({
    lastCheckedAt: '2026-12-02T02:10:00+09:00',
    coverage: [
      { source: 'us_filings', ok: true, failedAt: null },
      { source: 'news_overseas', ok: true, failedAt: null },
      { source: 'listing', ok: true, failedAt: null },
    ],
    allChecked: true,
    ...over,
  });

  it('allChecked 가 참일 때만 「3곳 모두 확인」을 쓴다', () => {
    expect(watchSummaryText(watch())).toBe('마지막 확인 12-02 02:10 — 미국 공시 · 해외 뉴스 · 상장 목록 3곳 모두 확인했습니다.');
  });
  it('한 곳이라도 못 읽으면 「일부만 확인」으로 바뀌고 어느 원천인지 말한다', () => {
    const w = watch({ allChecked: false, coverage: [
      { source: 'us_filings', ok: false, failedAt: '2026-12-02T02:10:00+09:00' },
      { source: 'news_overseas', ok: true, failedAt: null },
      { source: 'listing', ok: true, failedAt: null },
    ] });
    expect(watchSummaryText(w)).toBe('마지막 확인 12-02 02:10 — 미국 공시 확인 실패로 일부만 확인했습니다.');
    expect(partialWatchRow(w)).toEqual({
      title: '변경 확인이 일부만 끝났습니다',
      sub: '미국 공시 확인 실패 (12-02 02:10) — 인수·합병·상장폐지를 놓쳤을 수 있습니다',
    });
  });
  it('확인 기록이 아예 없으면 그 사실을 말한다 — 「3곳 모두 확인」을 쓰지 않는다(WP-A 미착수 상태)', () => {
    const t = watchSummaryText({ lastCheckedAt: null, coverage: [], allChecked: false });
    expect(t).toContain('아직 변경 확인 기록이 없습니다');
    expect(t).not.toContain('3곳 모두 확인');
    expect(watchSummaryText(null)).toBe(t);
    expect(partialWatchRow({ lastCheckedAt: null, coverage: [], allChecked: false })).toBeNull();
    expect(partialWatchRow(watch())).toBeNull();     // 모두 확인했으면 경고 줄이 없다
  });
  it('🔴 12월 안내는 제안 0건에도 남는다 — 알림이 조용한 것은 목록이 맞다는 뜻이 아니다', () => {
    expect(DECEMBER_NOTE).toContain('공시에 나오지 않습니다');
    expect(DECEMBER_NOTE).toContain('12-19');
    expect(DECEMBER_NOTE).toContain('직접 확인');
  });
  it('첫 줄 — 전부 처리했으면 말을 바꾼다', () => {
    expect(emptyLeadText(0)).toBe('지금 확인할 변경 없음.');
    expect(emptyLeadText(3)).toBe('확인할 변경을 모두 처리했습니다.');
  });
});

describe('일괄 교체 문구 (§2.6.3·§2.6.4)', () => {
  it('🔴 빈 목록은 막지 않되 버튼 글자를 바꾼다', () => {
    expect(bulkSaveLabel(0)).toBe('목록 전부 비우기');
    expect(bulkSaveLabel(97)).toBe('이 내용으로 바꾸기');
    expect(bulkConfirmVerb(0)).toBe('전부 비우기');
    expect(bulkConfirmVerb(97)).toBe('바꾸기');
  });
  it('🔴 「약 11종목」은 서버 값으로만 — 모르면 그 구절을 뺀다(데모의 11 은 합성값이다)', () => {
    expect(diffEmptyNote(11)).toContain('약 11종목으로 떨어집니다');
    expect(diffEmptyNote(null)).toBe('목록이 비어 있습니다. 이대로 저장하면 해외 분석은 보유·즐겨찾기만 남습니다.');
    expect(diffEmptyNote(null)).not.toContain('11');
    expect(bulkEmptyConfirmText(11)).toContain('약 11종목이 됩니다');
    expect(bulkEmptyConfirmText(null)).not.toContain('약');
  });
});

// ── 부록 B 회귀 시험 (B.6) ──────────────────────────────────────────────────

describe('🔴 B-1 — 저장 전(manualSource: fallback) 에는 「수동」이 한 번도 나오지 않는다', () => {
  const FB: UniverseSummary = {
    ...SUMMARY, manual: 50, manualSource: 'fallback', total: 54, auto: 0,
    manualUpdatedAt: null, manualUpdatedDaysAgo: null, manualVersion: 0,
    autoRefreshedAt: null, autoNextAt: null, heldOrFavoritesOnlyCount: 11,
  };

  it('칸 이름·meta·요약 행 부제·칩 글자', () => {
    expect(manualTileLabel('fallback')).toBe('기본 목록');
    expect(manualSourceLabel('fallback')).toBe('기본');
    expect(summaryRowSub(FB)).toBe('54종목 · 기본 50 · 자동 0');
    for (const t of [manualTileLabel('fallback'), manualTileMeta(FB), summaryRowSub(FB), manualSourceLabel('fallback')]) {
      expect(t).not.toContain('수동');
    }
  });

  it('🔴 meta 가 「갱신 기록 없음」이 아니다 — 아무 일도 안 일어난다고 읽히면 안 된다', () => {
    expect(manualTileMeta(FB)).toBe('저장 전 — 저장한 목록이 없는 동안 쓰는 목록입니다');
    expect(manualTileMeta(FB)).not.toContain('갱신 기록 없음');
  });

  it('🔴 meta 는 「지금 이 목록으로 분석합니다」라고 단정하지 않는다 — 규칙을 말해 저하 구간에서도 틀리지 않는 문장이다', () => {
    expect(manualTileMeta(FB)).not.toContain('지금 이 목록으로 분석');
  });

  it('갱신 기록이 있어도 fallback 이면 같은 문장이다(저장한 목록이 없다는 사실이 먼저다)', () => {
    expect(manualTileMeta({ ...FB, manualUpdatedAt: '2025-12-19T21:40:00+09:00', manualUpdatedDaysAgo: 349 }))
      .toBe('저장 전 — 저장한 목록이 없는 동안 쓰는 목록입니다');
  });

  it('목록 꼬리 설명에 「바꾸는 길」이 맨 앞에 붙고, 「4가지가 섞이기」는 그대로다', () => {
    const foot = listFoot('fallback');
    expect(foot.startsWith(LIST_FOOT_FALLBACK_LEAD)).toBe(true);
    expect(foot).toContain('12월 정기 재구성');
    expect(foot).toContain('4가지가 섞이기 때문입니다');
  });
});

describe('🔴 B-2 — 저장된 뒤(manualSource: db) 문구는 그대로다(회귀 금지)', () => {
  it('칸 이름·meta·부제·칩·꼬리', () => {
    expect(manualTileLabel('db')).toBe('수동 — 나스닥100');
    expect(manualSourceLabel('db')).toBe('수동');
    expect(manualTileMeta(SUMMARY)).toBe('갱신 2025-12-19 · 349일 전');
    expect(summaryRowSub(SUMMARY)).toBe('150종목 · 수동 98 · 자동 50 · 수동 갱신 2025-12-19');
    expect(listFoot('db').startsWith('종목마다 출처가 보입니다')).toBe(true);
    expect(listFoot('db')).not.toContain(LIST_FOOT_FALLBACK_LEAD);
  });
  it('저장된 상태에서는 「기본」을 쓰지 않는다', () => {
    for (const t of [manualTileLabel('db'), manualTileMeta(SUMMARY), summaryRowSub(SUMMARY), bulkHint2('db')]) {
      expect(t).not.toContain('기본');
    }
  });
});

describe('🔴 B-3 — 저장 성공·조회 실패 문장(B·C)', () => {
  it('일괄 교체(B): 「목록은 바뀌지 않았습니다」가 없고 「다시 저장하지 않아도」가 있다', () => {
    const t = bulkSavedUnreadableText(97, 3, 5);
    expect(t).not.toContain('바뀌지 않았습니다');
    expect(t).toContain('다시 저장하지 않아도 됩니다');
    expect(t).toContain('저장은 끝났고 변경 이력에 남았습니다');
    expect(t).toContain('97종목');          // 보낸 목록·확정 수는 읽기 실패와 무관한 사실이다
    expect(t).toContain('넣기 3 · 빼기 5');
  });
  it('제안 1건(C): 같은 규칙 + 「위 칸의 숫자는 아직 옛 값」', () => {
    expect(PROPOSAL_SAVED_UNREADABLE_TEXT).not.toContain('바뀌지 않았습니다');
    expect(PROPOSAL_SAVED_UNREADABLE_TEXT).not.toContain('처리되지 않았');
    expect(PROPOSAL_SAVED_UNREADABLE_TEXT).toContain('다시 누르지 않아도 됩니다');
    expect(PROPOSAL_SAVED_UNREADABLE_TEXT).toContain('옛 값');
  });
});

describe('🔴 B-4 — 저장 실패 문장(A)은 그대로다', () => {
  it('두 문구에 「목록은 바뀌지 않았습니다」가 남아 있고 「다시 해 보세요」로 안내한다', () => {
    expect(BULK_FAIL_TEXT).toContain('목록은 바뀌지 않았습니다');
    expect(BULK_FAIL_TEXT).toContain('다시 저장해 보세요');
    expect(PROPOSAL_FAILED_TEXT).toContain('목록은 바뀌지 않았습니다');
    expect(PROPOSAL_FAILED_TEXT).toContain('다시 해 보세요');
  });
});

describe('🔴 B-5 — 반영 시점은 상수 하나다(한 곳만 고쳐지는 것을 막는다)', () => {
  it('세 문자열이 같은 문장을 포함한다', () => {
    for (const t of [SHEET_TAIL, PROPOSAL_DONE_TAIL, bulkSuccessText(97, 3, 5), BULK_SHEET_TAIL]) {
      expect(t).toContain(APPLY_TIMING_TEXT);
    }
  });
  it('「다음 「해외 장마감 분석」부터」로 끝나지 않는다 — 장중 전략 평가가 먼저일 수 있다', () => {
    for (const t of [SHEET_TAIL, PROPOSAL_DONE_TAIL, bulkSuccessText(97, 3, 5)]) {
      expect(t).not.toMatch(/다음 「해외 장마감 분석」부터 (쓰입니다|반영됩니다)\.?$/);
      expect(t).toContain('장중 전략 평가');
      expect(t).toContain('먼저일 수 있습니다');     // 단정하지 않는다(운영 엔진 스위치 미확인)
    }
  });
  it('동사를 섞지 않는다 — 상수 하나이므로 「쓰입니다」 하나다', () => {
    expect(APPLY_TIMING_TEXT).toContain('쓰입니다');
    expect(APPLY_TIMING_TEXT).not.toContain('반영됩니다');
  });
  it('L-4 로 낮춘 일괄 교체 꼬리말은 그대로다', () => {
    expect(BULK_SHEET_TAIL).toContain('직전 목록이 변경 이력에 남습니다');
    expect(BULK_SHEET_TAIL).not.toContain('되돌릴 수 있습니다');
  });
});

describe('🔴 B-6 — 저장 전 + 빈 입력', () => {
  it('「기본 목록도 더 쓰이지 않습니다」가 있다(안전망으로 남는다고 읽히지 않게)', () => {
    const t = bulkEmptyConfirmText(11, 'fallback');
    expect(t).toContain('약 11종목이 됩니다');
    expect(t).toContain('지금 쓰이는 기본 목록도 더 쓰이지 않습니다');
  });
  it('저장된 뒤에는 그 문장을 붙이지 않는다', () => {
    expect(bulkEmptyConfirmText(11, 'db')).not.toContain('기본 목록도');
  });
  it('시트 제목 4갈래', () => {
    expect(bulkSheetTitle(false, 'fallback')).toBe('기본 목록을 내 목록으로 바꿀까요?');
    expect(bulkSheetTitle(true, 'fallback')).toBe('기본 목록을 비우고 내 목록도 두지 않을까요?');
    expect(bulkSheetTitle(false, 'db')).toBe('수동 목록을 바꿀까요?');
    expect(bulkSheetTitle(true, 'db')).toBe('수동 목록을 전부 비울까요?');
  });
});

describe('🔴 B-7 — 저장 전 + 뺄 것이 있는 시트', () => {
  it('「분석에서 빠집니다」와 「보유·즐겨찾기인 것은 계속 분석됩니다」가 둘 다 있다', () => {
    const t = bulkRemovedExplainText(25);
    expect(t).toContain('뺄 것 25종목');
    expect(t).toContain('기본 목록에는 있지만 새 목록에는 없는');
    expect(t).toContain('분석에서 빠집니다');
    expect(t).toContain('보유·즐겨찾기인 것은 계속 분석됩니다');
  });
  it('본문 첫 줄이 **교체**라고 말한다(「0 → 100」으로 쓰지 않는다)', () => {
    const t = bulkSheetLead(50, 100);
    expect(t).toContain('기본 목록 50종목으로 분석하고 있습니다');
    expect(t).toContain('그 자리를 여기 붙여넣은 100종목이 대신합니다');
  });
  it('대조 메모·입력 힌트도 두 기준을 섞지 않는다(권고 2곳)', () => {
    expect(DIFF_OK_NOTE(50, 100, 'fallback')).toBe('저장하면 기본 목록 50종목 대신 내 목록 100종목으로 분석합니다. 즐겨찾기·보유는 건드리지 않습니다.');
    expect(DIFF_OK_NOTE(50, 100, 'db')).toBe('저장하면 수동 목록이 50 → 100종목이 됩니다. 즐겨찾기·보유는 건드리지 않습니다.');
    expect(bulkHint2('fallback')).toContain('지금 쓰이는 기본 목록을 대신합니다');
  });
});
