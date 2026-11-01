/**
 * T-143 WP-B — 제안의 말·효과 계산 (구현 가이드 §2.4). 순수 함수 시험.
 *
 * 🔴 `applyProposalToManual` 은 효과 숫자의 근거다 — 더하기·빼기로 추정하지 않고 **적용 뒤 목록을 실제로 만들어** 센다.
 * 중복을 만들지 않는 것이 핵심이다(중복이 생기면 수동 목록 수가 늘고 분석 대상 수가 틀어진다).
 */
import {
  UNKNOWN_PROPOSAL_KIND, actionLabel, actionVerb, applyProposalToManual, heldWarnText, proposalDoneText,
  proposalEffect, proposalKindLabel,
} from '../proposal-copy';

describe('proposalKindLabel', () => {
  it('아는 종류는 한국어로', () => {
    expect(proposalKindLabel('delisting')).toBe('상장폐지 예정');
    expect(proposalKindLabel('acquisition')).toBe('인수 합의');
  });
  it('거래소 이동은 바꿀 코드의 거래소를 덧붙인다 — 데모 「거래소 이동 (→ NYSE)」', () => {
    expect(proposalKindLabel('exchange_move', 'NYS:AJJJ')).toBe('거래소 이동 (→ NYSE)');
    expect(proposalKindLabel('exchange_move', 'AMS:AJJJ')).toBe('거래소 이동 (→ AMEX)');
    expect(proposalKindLabel('exchange_move', null)).toBe('거래소 이동');          // 모르면 덧붙이지 않는다
    expect(proposalKindLabel('exchange_move', 'XXX:AJJJ')).toBe('거래소 이동');     // 모르는 거래소도 추측하지 않는다
  });
  it('W-2 — WP-A 가 만드는 두 종류도 이름이 있다(장외 이전·KIS 조회 불가)', () => {
    expect(proposalKindLabel('otc_move')).toBe('장외 이전');
    expect(proposalKindLabel('kis_unavailable')).toBe('KIS 조회 불가');
    // 영문 코드가 새어 나오지 않는다
    for (const k of ['otc_move', 'kis_unavailable']) expect(proposalKindLabel(k)).not.toContain(k);
  });
  it('모르는 종류·빈 값은 「알 수 없는 변경」 — 영문 코드를 그대로 보이지 않는다', () => {
    for (const k of ['weird_kind', '', null, undefined, 'constructor']) {
      expect(proposalKindLabel(k)).toBe(UNKNOWN_PROPOSAL_KIND);
    }
  });
});

describe('버튼 글자', () => {
  it('주 버튼 — 코드 바꾸기는 두 코드를 다 보인다(접두사가 뜻을 가진다)', () => {
    expect(actionLabel('remove', 'NAS:AAAA', null)).toBe('목록에서 빼기');
    expect(actionLabel('add', 'NAS:AAAA', null)).toBe('목록에 넣기');
    expect(actionLabel('recode', 'NAS:AJJJ', 'NYS:AJJJ')).toBe('코드 바꾸기 NAS:AJJJ → NYS:AJJJ');
    expect(actionLabel('recode', 'NAS:AJJJ', null)).toBe('코드 바꾸기');
  });
  it('확인 버튼 — 빼기·넣기·바꾸기', () => {
    expect([actionVerb('remove'), actionVerb('add'), actionVerb('recode')]).toEqual(['빼기', '넣기', '바꾸기']);
  });
});

describe('🔴 보유 중 경고·완료 문구 (§2.4.2 — 4곳 전부 남아야 한다)', () => {
  it('보유 중인 종목을 빼면 완료 문구가 「분석은 계속」으로 끝난다 — 「뺐으니 끝」으로 오해하지 않게', () => {
    expect(proposalDoneText('remove', true)).toBe('목록에서 뺐습니다 (보유 중이라 분석은 계속)');
    expect(proposalDoneText('remove', false)).toBe('목록에서 뺐습니다');
    expect(proposalDoneText('add', true)).toBe('목록에 넣었습니다');
    expect(proposalDoneText('recode', true)).toBe('코드를 바꿨습니다');
  });
  it('경고 줄은 빼기 + 보유일 때만 — 분석 대상 합집합을 글로 말한다', () => {
    const w = heldWarnText('remove', true);
    expect(w).toContain('분석은 계속됩니다');
    expect(w).toContain('보유 ∪ 즐겨찾기 ∪ 목록');
    expect(w).toContain('먼저 매도해야');
    expect(heldWarnText('remove', false)).toBeNull();
    expect(heldWarnText('add', true)).toBeNull();        // 넣기는 분석이 계속되는 것이 당연하다
    expect(heldWarnText('recode', true)).toBeNull();
  });
});

describe('applyProposalToManual — 효과 숫자의 근거', () => {
  const M = ['NAS:AAAA', 'NAS:ABBB', 'NAS:AJJJ'];

  it('remove — 그 코드만 빠진다. 목록에 없으면 그대로', () => {
    expect(applyProposalToManual(M, { type: 'remove', symbol: 'NAS:ABBB', nextSymbol: null })).toEqual(['NAS:AAAA', 'NAS:AJJJ']);
    expect(applyProposalToManual(M, { type: 'remove', symbol: 'NAS:ZZZZ', nextSymbol: null })).toEqual(M);
  });

  it('add — 없을 때만 끝에 넣는다. 이미 있으면 **중복을 만들지 않는다**', () => {
    expect(applyProposalToManual(M, { type: 'add', symbol: 'NAS:ACCC', nextSymbol: null })).toEqual([...M, 'NAS:ACCC']);
    expect(applyProposalToManual(M, { type: 'add', symbol: 'NAS:AAAA', nextSymbol: null })).toEqual(M);
  });

  it('recode — 자리를 지키며 바꾼다(순서 보존)', () => {
    expect(applyProposalToManual(M, { type: 'recode', symbol: 'NAS:AJJJ', nextSymbol: 'NYS:AJJJ' }))
      .toEqual(['NAS:AAAA', 'NAS:ABBB', 'NYS:AJJJ']);
  });

  it('🔴 recode — 새 코드가 이미 있으면 옛 코드만 빠진다(중복 금지, 수가 1 줄어든다)', () => {
    const m = ['NAS:AJJJ', 'NYS:AJJJ', 'NAS:AAAA'];
    expect(applyProposalToManual(m, { type: 'recode', symbol: 'NAS:AJJJ', nextSymbol: 'NYS:AJJJ' }))
      .toEqual(['NYS:AJJJ', 'NAS:AAAA']);
  });

  it('recode — 옛 코드가 목록에 없으면 새 코드를 넣는다(자동 목록에서 온 종목)', () => {
    expect(applyProposalToManual(M, { type: 'recode', symbol: 'NAS:ZZZZ', nextSymbol: 'NYS:ZZZZ' }))
      .toEqual([...M, 'NYS:ZZZZ']);
  });

  it('recode — 바꿀 코드를 모르면 아무것도 하지 않는다(추측하지 않는다)', () => {
    expect(applyProposalToManual(M, { type: 'recode', symbol: 'NAS:AJJJ', nextSymbol: null })).toEqual(M);
  });

  it('원본 배열을 바꾸지 않는다', () => {
    const m = [...M];
    applyProposalToManual(m, { type: 'remove', symbol: 'NAS:AAAA', nextSymbol: null });
    expect(m).toEqual(M);
  });
});

describe('proposalEffect — heldKeepsAnalysis', () => {
  it('수동은 줄었는데 분석 대상 수는 그대로면 참 — 「보유 중이라 150 그대로」가 그때만 사실이다', () => {
    expect(proposalEffect({ manualFrom: 98, manualTo: 97, totalFrom: 150, totalTo: 150 }).heldKeepsAnalysis).toBe(true);
  });
  it('분석 대상 수도 줄면 거짓', () => {
    expect(proposalEffect({ manualFrom: 98, manualTo: 97, totalFrom: 150, totalTo: 149 }).heldKeepsAnalysis).toBe(false);
  });
  it('수동이 늘거나 그대로면 거짓(넣기·코드 바꾸기)', () => {
    expect(proposalEffect({ manualFrom: 98, manualTo: 99, totalFrom: 150, totalTo: 150 }).heldKeepsAnalysis).toBe(false);
    expect(proposalEffect({ manualFrom: 98, manualTo: 98, totalFrom: 150, totalTo: 150 }).heldKeepsAnalysis).toBe(false);
  });
});
