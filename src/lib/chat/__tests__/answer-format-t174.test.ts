/**
 * T-174 — N1(다듬은 질문의 지어낸 종목 식별자 제거) · N2(본문 안 참고용 고지 문장 제거) 단위 시험.
 */
import { CHAT_DISCLAIMER, cleanDraftPrompt, finalizeNewChatAnswer } from '../answer-format';

describe('N1 cleanDraftPrompt — 허용 목록 밖 종목 식별자 제거', () => {
  test('QA 재현: 원문에 없는 국내 6자리 코드를 지우고 구두점을 정리', () => {
    expect(cleanDraftPrompt('NVIDIA (NVIDIA, 210140) 의 현재 상황을 분석해 주세요.', '엔비디아 어때?', ['NAS:NVDA']))
      .toBe('NVIDIA (NVIDIA) 의 현재 상황을 분석해 주세요.');
  });
  test('괄호 안 단독 코드·코드가 앞에 오는 괄호', () => {
    expect(cleanDraftPrompt('삼성전자(999999) 전망', '삼성전자 전망', [])).toBe('삼성전자 전망');
    expect(cleanDraftPrompt('(210140, NVIDIA) 분석', '엔비디아', [])).toBe('(NVIDIA) 분석');
  });
  test('허용 목록의 코드는 보존', () => {
    expect(cleanDraftPrompt('삼성전자(005930) 전망', '삼성전자 전망', ['005930'])).toBe('삼성전자(005930) 전망');
  });
  test('사용자 원문에 글자 그대로 있는 코드는 보존', () => {
    expect(cleanDraftPrompt('종목 005930 전망', '005930 어때?', [])).toBe('종목 005930 전망');
  });
  test('금액·날짜·수량·소수·천단위 숫자는 건드리지 않음', () => {
    const t = '평단 (100000원), (123456주) 보유, (202611월) 기준, (1,234,567) 와 (3.141592) 및 (500000%) 와 (123456 달러) 변동을 확인해 주세요.';
    expect(cleanDraftPrompt(t, '질문', [])).toBe(t);
  });
  test('코드가 문장 끝에 있어도(마침표) 지움', () => {
    expect(cleanDraftPrompt('NVIDIA 분석(210140).', '엔비디아', [])).toBe('NVIDIA 분석.');
  });
  test('NAS:·NYS:·AMS: 꼴 — 대소문자 무시, 허용·원문은 보존', () => {
    expect(cleanDraftPrompt('애플(NAS:AAPL)과 nas:msft 비교', '애플 비교', ['NAS:AAPL'])).toBe('애플(NAS:AAPL)과 비교');
    expect(cleanDraftPrompt('코카콜라 (NYS:KO) 전망', '코카콜라 전망', [])).toBe('코카콜라 전망');
    expect(cleanDraftPrompt('SPY (AMS:SPY) 흐름', 'ams:spy 흐름', [])).toBe('SPY (AMS:SPY) 흐름');
  });
  test('회사 이름·단독 티커는 지우지 않음', () => {
    expect(cleanDraftPrompt('NVDA 와 엔비디아, 삼성전자 비교', '비교', [])).toBe('NVDA 와 엔비디아, 삼성전자 비교');
  });
  test('줄바꿈 구조는 유지', () => {
    expect(cleanDraftPrompt('투자 성향: aggressive\n\nNVIDIA(210140) 검토해 주세요.', '엔비디아', []))
      .toBe('투자 성향: aggressive\n\nNVIDIA 검토해 주세요.');
  });
  test('다 지워져 비면 사용자 원문으로 대체', () => {
    expect(cleanDraftPrompt('(210140)', ' 엔비디아 어때? ', [])).toBe('엔비디아 어때?');
  });
  test('인자 없으면 기존과 같음(코드도 그대로)', () => {
    expect(cleanDraftPrompt('NVIDIA (NVIDIA, 210140) 분석', '엔비디아')).toBe('NVIDIA (NVIDIA, 210140) 분석');
    expect(cleanDraftPrompt('{"reasoning":"x"}', ' 원문 ')).toBe('원문');
  });
  test('JSON 이 섞이면 허용 목록이 있어도 원문 대체', () => {
    expect(cleanDraftPrompt('{"reasoning":"x"}', ' 원문 ', ['NAS:NVDA'])).toBe('원문');
  });
});

describe('N2 finalizeNewChatAnswer — 본문 안 고지 문장 제거', () => {
  const countDisclaimer = (t: string) => t.split(CHAT_DISCLAIMER).length - 1;

  test('단락 안 고지 문장 제거, 같은 줄 다른 문장 보존, 끝 줄 1회', () => {
    const out = finalizeNewChatAnswer('RSI 는 30 입니다. 이 내용은 이 시스템의 검증된 전략 판정이 아니라 참고용입니다. 추가 확인이 필요합니다.');
    expect(out).toBe(`RSI 는 30 입니다. 추가 확인이 필요합니다.\n\n${CHAT_DISCLAIMER}`);
    expect(countDisclaimer(out)).toBe(1);
  });
  test('변형 문구(아닌 참고용) — 목록에 없는 끝맺음은 내용으로 보아 보존(중복 수용)', () => {
    const out = finalizeNewChatAnswer('결론은 보유입니다. 검증된 전략 판정이 아닌 참고용으로 보시기 바랍니다.');
    expect(out).toBe(`결론은 보유입니다. 검증된 전략 판정이 아닌 참고용으로 보시기 바랍니다.\n\n${CHAT_DISCLAIMER}`);
  });
  test('목록 기호는 유지하고 고지 문장만 제거', () => {
    const out = finalizeNewChatAnswer('- 검증된 전략 판정이 아니라 참고용입니다. 매수 근거는 약합니다.');
    expect(out).toBe(`- 매수 근거는 약합니다.\n\n${CHAT_DISCLAIMER}`);
  });
  test('고지만 있던 줄은 사라지고 빈 줄이 정리됨', () => {
    const out = finalizeNewChatAnswer('첫 단락.\n\n이 내용은 검증된 전략 판정이 아니라 참고용입니다 라고 덧붙입니다.\n\n마지막 단락.');
    expect(out).toBe(`첫 단락.\n\n마지막 단락.\n\n${CHAT_DISCLAIMER}`);
    expect(countDisclaimer(out)).toBe(1);
  });
  test('120자를 넘는 문장은 다른 내용이 섞인 것으로 보고 둔다', () => {
    const long = `${'가'.repeat(130)} 검증된 전략 판정이 아니라 참고용입니다.`;
    const out = finalizeNewChatAnswer(long);
    expect(out.startsWith('가')).toBe(true);
    expect(out.endsWith(CHAT_DISCLAIMER)).toBe(true);
  });
  test('코드 펜스 안은 보존(고지 문장이 든 긴 코드 줄)', () => {
    const codeLine = `print("검증된 전략 판정이 아니라 참고용입니다. 그리고 다음 문장입니다."); ${'x'.repeat(60)}`;
    const out = finalizeNewChatAnswer(`설명입니다.\n\`\`\`\n${codeLine}\n\`\`\``);
    expect(out).toContain(codeLine);
    expect(out.endsWith(CHAT_DISCLAIMER)).toBe(true);
  });
  test('기존: 홀로 선 고지 줄 제거 + 끝 줄 1회', () => {
    const out = finalizeNewChatAnswer(`본문입니다.\n${CHAT_DISCLAIMER}`);
    expect(out).toBe(`본문입니다.\n\n${CHAT_DISCLAIMER}`);
  });
  test('고지가 없는 본문은 그대로 + 끝 줄', () => {
    expect(finalizeNewChatAnswer('일반 문장입니다. 두 번째 문장입니다.')).toBe(`일반 문장입니다. 두 번째 문장입니다.\n\n${CHAT_DISCLAIMER}`);
  });
});

describe('T-174 2차 — Reviewer 재현 입력', () => {
  test('M1: 허용 식별자 뒤 마침표·하이픈은 토큰이 아님', () => {
    expect(cleanDraftPrompt('엔비디아는 NAS:NVDA.', '엔비디아', ['NAS:NVDA'])).toBe('엔비디아는 NAS:NVDA.');
    expect(cleanDraftPrompt('NAS:NVDA. 어때?', '엔비디아', ['NAS:NVDA'])).toBe('NAS:NVDA. 어때?');
    expect(cleanDraftPrompt('비교: NAS:NVDA-미국 반도체', '엔비디아', ['NAS:NVDA'])).toBe('비교: NAS:NVDA-미국 반도체');
    expect(cleanDraftPrompt('버크셔 NYS:BRK.B 전망', '버크셔', ['NYS:BRK.B'])).toBe('버크셔 NYS:BRK.B 전망');
  });
  test('M1: 허용 밖이면 마침표는 남기고 식별자만 지움', () => {
    expect(cleanDraftPrompt('분석은 NAS:MSFT.', '엔비디아', ['NAS:NVDA'])).toBe('분석은.');
  });
  test('M2: 쉼표 목록에서 지워도 구분자 하나 유지', () => {
    expect(cleanDraftPrompt('(삼성전자, 123456, SK하이닉스)', '삼성전자 하이닉스', [])).toBe('(삼성전자, SK하이닉스)');
    expect(cleanDraftPrompt('삼성전자, 123456, SK하이닉스 비교', '삼성전자 하이닉스', [])).toBe('삼성전자, 123456, SK하이닉스 비교');
    expect(cleanDraftPrompt('삼성전자, NAS:ZZZZ, SK하이닉스 비교', '삼성전자 하이닉스', [])).toBe('삼성전자, SK하이닉스 비교');
  });
  test('M3: 60자 상한 — 긴 혼합 문장은 분석 내용을 보존', () => {
    const mixed = '삼성전자는 PER 12배로 저평가 상태이고 영업이익이 30% 늘었지만 검증된 전략 판정이 아니라 참고용 의견이다. 다음 문장.';
    const out = finalizeNewChatAnswer(mixed);
    expect(out).toContain('PER 12배');
    expect(out).toContain('영업이익이 30% 늘었지만');
    expect(out).toContain('다음 문장.');
    expect(out.endsWith(CHAT_DISCLAIMER)).toBe(true);
  });
  test('L1: 괄호 밖 맨 6자리 숫자는 지우지 않음', () => {
    for (const t of ['매수가 100000 이하로 봅니다', '시각 093000 기준', '2026년 202611 기준', '종목 123456번 확인']) {
      expect(cleanDraftPrompt(t, '질문', [])).toBe(t);
    }
  });
  test('L1: 괄호 안·「코드」「종목코드」 뒤 6자리는 코드로 봄', () => {
    expect(cleanDraftPrompt('NVIDIA (NVIDIA, 210140)', '엔비디아', [])).toBe('NVIDIA (NVIDIA)');
    expect(cleanDraftPrompt('삼성전자(005930) 전망', '엔비디아', [])).toBe('삼성전자 전망');
    expect(cleanDraftPrompt('종목코드: 210140 분석', '엔비디아', [])).toBe('종목코드: 분석');
    expect(cleanDraftPrompt('코드 210140 분석', '엔비디아', [])).toBe('코드 분석');
  });
  test('L2: 코드 펜스 안은 지우지 않음', () => {
    const t = '질문입니다.\n```\nsym = "NAS:ZZZZ"; code = (210140)\n```\nNAS:QQQQ 확인';
    expect(cleanDraftPrompt(t, '질문', [])).toBe('질문입니다.\n```\nsym = "NAS:ZZZZ"; code = (210140)\n```\n확인');
  });
  test('L3: 최근 대화에 글자 그대로 있는 식별자는 허용', () => {
    const hist = '엔비디아 NAS:NVDA 얘기\n삼성전자(005930)';
    expect(cleanDraftPrompt('NAS:NVDA 와 삼성전자(005930) 비교, NAS:AMD', '그거 비교', [], hist)).toBe('NAS:NVDA 와 삼성전자(005930) 비교');
    expect(cleanDraftPrompt('NAS:NVDA 비교', '그거 비교', [])).toBe('비교');
  });
});

describe('T-174 2b — 홀로 선 고지 줄 상한 60', () => {
  const countD = (t: string) => t.split(CHAT_DISCLAIMER).length - 1;
  test('정식 고지 줄은 지우고 끝 줄 하나', () => {
    const out = finalizeNewChatAnswer(`본문입니다.\n${CHAT_DISCLAIMER}\n마무리.`);
    expect(out).toBe(`본문입니다.\n마무리.\n\n${CHAT_DISCLAIMER}`);
    expect(countD(out)).toBe(1);
  });
  test('61~80자 순수 고지 변형은 남는다(중복 수용)', () => {
    const v = '참고로 말씀드리면 이 내용은 이 시스템의 검증된 전략 판정이 아닌 참고용입니다 라고 다시 한 번 정중하게 안내드립니다.';
    expect(v.length).toBeGreaterThan(60);
    expect(v.length).toBeLessThanOrEqual(80);
    const out = finalizeNewChatAnswer(`본문입니다.\n${v}`);
    expect(out).toContain(v);
    expect(out.endsWith(CHAT_DISCLAIMER)).toBe(true);
  });
  test('분석 + 고지 혼합 한 문장(60자 이하)은 통째로 보존(고지 중복 수용)', () => {
    const mixed = '단기 반등 가능성은 있으나, 이는 검증된 전략 판정이 아니라 참고용입니다.';
    expect(mixed.length).toBeLessThanOrEqual(60);
    expect(finalizeNewChatAnswer(mixed)).toBe(`${mixed}\n\n${CHAT_DISCLAIMER}`);
  });
  test('상한을 넘는 혼합 한 문장은 통째로 보존', () => {
    const long = '단기 반등 가능성은 있으나 거래량이 부족하고 추세가 약해서 신중해야 하며, 이는 검증된 전략 판정이 아니라 참고용입니다.';
    expect(long.length).toBeGreaterThan(60);
    const out = finalizeNewChatAnswer(long);
    expect(out.startsWith(long)).toBe(true);
  });
  test('Reviewer M3 입력은 분석 문구를 유지', () => {
    const out = finalizeNewChatAnswer('삼성전자는 PER 12배로 저평가 상태이고 영업이익이 30% 늘었지만 검증된 전략 판정이 아니라 참고용 의견이다. 다음 문장.');
    expect(out).toContain('PER 12배로 저평가 상태이고 영업이익이 30% 늘었지만');
    expect(out).toContain('다음 문장.');
  });
});

describe('T-174 3차 — Reviewer 2차 재현 입력', () => {
  test('R2-M1: 쉼표 없는 혼합 문장은 통째 보존', () => {
    const out = finalizeNewChatAnswer('영업이익이 30% 늘었으나 검증된 전략 판정이 아니라 참고용입니다. 다음.');
    expect(out).toContain('영업이익이 30% 늘었으나 검증된 전략 판정이 아니라 참고용입니다.');
    expect(out).toContain('다음.');
  });
  test('R2-M1: 고지 뒤에 분석이 이어진 한 줄 답은 실패 안내문으로 바뀌지 않음', () => {
    const t = '검증된 전략 판정이 아니라 참고용입니다만 PER 12배 매력적, 결론 매수.';
    expect(finalizeNewChatAnswer(t)).toBe(`${t}\n\n${CHAT_DISCLAIMER}`);
  });
  test('R2-M2: 고지가 앞, 분석이 쉼표 뒤인 문장도 보존', () => {
    const out = finalizeNewChatAnswer('검증된 전략 판정이 아니라 참고용이며, PER은 12배입니다. 다음.');
    expect(out).toContain('검증된 전략 판정이 아니라 참고용이며, PER은 12배입니다.');
    expect(out).toContain('다음.');
  });
  test('분류: 정식 고지·머리말 변형은 순수 고지로 제거', () => {
    for (const d of [
      CHAT_DISCLAIMER,
      '본 답변은 검증된 전략 판정이 아닌 참고용입니다.',
      '다만, 위 내용은 검증된 전략 판정이 아니라 참고용일 뿐입니다.',
    ]) {
      expect(finalizeNewChatAnswer(`본문입니다.\n${d}`)).toBe(`본문입니다.\n\n${CHAT_DISCLAIMER}`);
    }
  });
  test('R2-L1: 괄호 안이라도 목록 항목으로 홀로 선 6자리만 코드', () => {
    expect(cleanDraftPrompt('(목표가 100000 이하)', '질문', [])).toBe('(목표가 100000 이하)');
    expect(cleanDraftPrompt('(2026년 202611 기준)', '질문', [])).toBe('(2026년 202611 기준)');
    expect(cleanDraftPrompt('(NVIDIA, 210140)', '엔비디아', [])).toBe('(NVIDIA)');
    expect(cleanDraftPrompt('삼성전자(005930)', '엔비디아', [])).toBe('삼성전자');
    expect(cleanDraftPrompt('삼성전자(005930)', '엔비디아', ['005930'])).toBe('삼성전자(005930)');
  });
  test('R2-L2: 빈 괄호를 지운 뒤 겹친 쉼표는 하나로', () => {
    expect(cleanDraftPrompt('삼성전자, (123456), SK', '질문', [])).toBe('삼성전자, SK');
  });
  test('R2-L3: 최근 대화 허용은 토큰 경계 일치 — 부분 문자열은 허용 아님', () => {
    expect(cleanDraftPrompt('삼성전자(005930)', '그거', [], '지난 번 1005930 얘기')).toBe('삼성전자');
    expect(cleanDraftPrompt('삼성전자(005930)', '그거', [], '지난 번 삼성전자(005930) 얘기')).toBe('삼성전자(005930)');
  });
});
