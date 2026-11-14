/** T-169 A4 — normalizeChatAnswer: LLM JSON 을 그대로 내보내는 경로가 없다. 순수 함수 시험. */
import {
  CHAT_ANSWER_FALLBACK,
  CHAT_DISCLAIMER,
  candidateStatusLine,
  cleanDraftPrompt,
  sourceTimeLine,
  finalizeNewChatAnswer,
  normalizeChatAnswer,
  normalizeChatAnswerDetailed,
  normalizeNewChatAnswer,
} from '../answer-format';

/** 운영 DB chat_messages id=42 에 실제로 저장된 답(데모 v1 장면 ④와 같은 원문) */
const STORED_42 = '{\n  "selectedIndices": [],\n  "confidence": 0,\n  "ev": {\n    "pWin": 0,\n    "rWin": 0,\n    "rLoss": 0,\n    "evPct": 0\n  },\n  "reasoning": "현재 제공된 데이터로는 RSI와 골든크로스, 브레이크아웃, 역전략 등이 성립되는 종목을 구체적으로 추천하기 어렵습니다. RSI, 이동평균, MACD, 5봉 변화율 등과 같은 지표의 구체적인 값이 필요합니다. 이를 통해 더 정확한 추천이 가능합니다.",\n  "warnings": ["데이터 부족으로 구체적인 추천 불가"]\n}';

describe('JSON → 문장', () => {
  test('저장된 시그널 평가 JSON(id 42) → reasoning 본문 + 참고 줄, 안내 문구 없음(데모 장면 ④·사용자 결정 「문장만」)', () => {
    const r = normalizeChatAnswerDetailed(STORED_42);
    expect(r.source).toBe('json');
    expect(r.text).toBe(
      '현재 제공된 데이터로는 RSI와 골든크로스, 브레이크아웃, 역전략 등이 성립되는 종목을 구체적으로 추천하기 어렵습니다. '
      + 'RSI, 이동평균, MACD, 5봉 변화율 등과 같은 지표의 구체적인 값이 필요합니다. 이를 통해 더 정확한 추천이 가능합니다.'
      + '\n\n참고: 데이터 부족으로 구체적인 추천 불가',
    );
    expect(r.text).not.toMatch(/selectedIndices|confidence|evPct|\{|\}/);
    expect(r.text).not.toMatch(/예전 형식/);
  });

  test('본문 키 우선순위 answer > response > message > content > text > reasoning, 수치 키는 노출 안 함', () => {
    expect(normalizeChatAnswer('{"reasoning":"R","answer":"A","confidence":72}')).toBe('A');
    expect(normalizeChatAnswer('{"text":"T","reasoning":"R"}')).toBe('T');
    expect(normalizeChatAnswer('{"message":{"content":"중첩 본문"},"selectedIndices":[1]}')).toBe('중첩 본문');
    expect(normalizeChatAnswer('{"answer":"답","warnings":["w1",2,"w2"]}')).toBe('답\n\n참고: w1 / w2');
  });

  test('코드펜스 안의 JSON', () => {
    expect(normalizeChatAnswerDetailed('```json\n{"answer":"펜스 답"}\n```')).toEqual({ text: '펜스 답', source: 'json' });
    expect(normalizeChatAnswer('```\n{"response":"펜스 답2"}\n```')).toBe('펜스 답2');
  });

  test('파싱되지만 쓸 문자열이 없으면 고정 안내문', () => {
    for (const raw of ['{"selectedIndices":[],"confidence":0}', '[]', '[0,1]', '{"answer":""}', '{"warnings":["경고만"]}', '{}']) {
      expect(normalizeChatAnswerDetailed(raw)).toEqual({ text: CHAT_ANSWER_FALLBACK, source: 'fallback' });
    }
  });

  test('`{` 로 시작하지만 파싱 실패(잘린 JSON) → 고정 안내문', () => {
    expect(normalizeChatAnswer('{"selectedIndices": [], "reasoning": "잘린')).toBe(CHAT_ANSWER_FALLBACK);
    expect(normalizeChatAnswer('```json\n{"answer": \n```')).toBe(CHAT_ANSWER_FALLBACK);
  });

  test('본문 문자열이 또 JSON 이면 다시 문장으로, 깨졌으면 버린다', () => {
    expect(normalizeChatAnswer('{"answer":"{\\"answer\\":\\"안쪽 답\\"}"}')).toBe('안쪽 답');
    expect(normalizeChatAnswer('{"answer":"{\\"broken","reasoning":"대체 본문"}')).toBe('대체 본문');
  });

  test('배열 — 문자열·객체 원소를 줄로', () => {
    expect(normalizeChatAnswer('["첫 줄", {"answer":"둘째 줄"}, 3]')).toBe('첫 줄\n둘째 줄');
  });
});

describe('일반 문장은 그대로', () => {
  test('앞뒤 공백만 정리, 목록·문단 유지', () => {
    const text = '  지금 데이터로는 과매도 반등 후보가 많습니다.\n\n1. 마이크로칩(NAS:MCHP) $62.25\n   근거: RSI 34\n\n이 내용은 이 시스템의 검증된 전략 판정이 아니라 참고용입니다.  ';
    expect(normalizeChatAnswerDetailed(text)).toEqual({ text: text.trim(), source: 'text' });
  });

  test('`[` 로 시작하는 일반 문장은 JSON 이 아니다', () => {
    expect(normalizeChatAnswerDetailed('[요약] 금리 상단 4.00%')).toEqual({ text: '[요약] 금리 상단 4.00%', source: 'text' });
    expect(normalizeChatAnswerDetailed('[1] 첫째 후보는 …')).toEqual({ text: '[1] 첫째 후보는 …', source: 'text' });
  });

  test('마크다운 기호는 지우지 않는다(지시로 막는다)', () => {
    expect(normalizeChatAnswer('**굵게** 답')).toBe('**굵게** 답');
  });

  test('문자열이 아니거나 비면 고정 안내문', () => {
    expect(normalizeChatAnswer(undefined)).toBe(CHAT_ANSWER_FALLBACK);
    expect(normalizeChatAnswer(null)).toBe(CHAT_ANSWER_FALLBACK);
    expect(normalizeChatAnswer('   ')).toBe(CHAT_ANSWER_FALLBACK);
    expect(normalizeChatAnswer('```\n```')).toBe(CHAT_ANSWER_FALLBACK);
  });
});

describe('문장 사이에 끼인 JSON', () => {
  test('문장 + 펜스 JSON → 펜스 자리를 문장으로', () => {
    const r = normalizeChatAnswerDetailed('요약입니다.\n```json\n{"answer":"세부 답","confidence":3}\n```\n끝.');
    expect(r.source).toBe('json');
    expect(r.text).toBe('요약입니다.\n세부 답\n끝.');
  });

  test('문장 + 펜스 안 일반 코드 → 정규화는 그대로 둔다(새 답 후처리가 펜스 줄만 뗀다)', () => {
    expect(normalizeChatAnswerDetailed('설명\n```\nRSI 34\n```')).toEqual({ text: '설명\n```\nRSI 34\n```', source: 'text' });
    expect(normalizeChatAnswerDetailed('```\n일반 답\n```')).toEqual({ text: '```\n일반 답\n```', source: 'text' });
  });

  test('펜스 안 코드의 `{` 줄은 JSON 블록으로 보지 않는다, 닫히지 않은 json 펜스 뒤 잘린 JSON 은 버린다', () => {
    const code = '예시\n```ts\nconst a = 1;\n{"x": 1}\n```';
    expect(normalizeChatAnswerDetailed(code)).toEqual({ text: code, source: 'text' });
    const r = normalizeChatAnswerDetailed('설명\n```json\n{"selectedIndices": [1],\n"reasoning": "잘');
    expect(r).toEqual({ text: '설명', source: 'json' });
  });

  test('문장 뒤·사이에 줄 머리 JSON 블록', () => {
    expect(normalizeChatAnswer('앞 문장\n{"selectedIndices":[],"reasoning":"뒤 본문"}')).toBe('앞 문장\n뒤 본문');
    expect(normalizeChatAnswer('앞\n{\n  "answer": "가운데",\n  "ev": {"pWin": 0}\n}\n뒤')).toBe('앞\n가운데\n뒤');
    expect(normalizeChatAnswer('앞\n{"confidence":0}\n뒤')).toBe('앞\n뒤');
  });

  test('문장 뒤의 잘린 JSON 은 문단 끝까지 버린다', () => {
    expect(normalizeChatAnswer('앞 문장\n{"selectedIndices": [],\n"reasoning": "잘')).toBe('앞 문장');
    expect(normalizeChatAnswer('앞 문장\n{\n  "ev": {\n\n다음 문단')).toBe('앞 문장\n\n다음 문단');
  });
});

describe('원본 JSON 을 그대로 돌려주는 경로가 없다', () => {
  const samples = [
    STORED_42,
    '{"selectedIndices":[0],"confidence":62,"ev":{"pWin":0.5}}',
    '```json\n{"selectedIndices":[],"warnings":["w"]}\n```',
    '[{"selectedIndices":[]}]',
    '{"selectedIndices":',
    '설명\n{"selectedIndices":[1],"confidence":5}',
    '설명\n```json\n{"selectedIndices":[1]}\n```',
    '결과는 {"selectedIndices":[],"confidence":0.1} 입니다',   // Reviewer M2
    '추천: [{"symbol":"A"}]',                                // Reviewer M2
  ];
  test.each(samples)('%#', (raw) => {
    const out = normalizeChatAnswer(raw);
    expect(out).not.toMatch(/selectedIndices|"confidence"|"ev"|\{\s*"/);
    expect(out).not.toBe(raw);
  });
});

describe('cleanDraftPrompt', () => {
  test('일반 문장 → 정리한 문장, JSON·빈 값 → 사용자 원문', () => {
    expect(cleanDraftPrompt('  투자 성향: aggressive\n\n질문  ', '원문')).toBe('투자 성향: aggressive\n\n질문');
    expect(cleanDraftPrompt('{"reasoning":"메타 설명"}', ' 원문 질문 ')).toBe('원문 질문');
    expect(cleanDraftPrompt('', '원문')).toBe('원문');
    expect(cleanDraftPrompt('다듬음\n```json\n{"a":1}\n```', '원문')).toBe('원문');
  });
});

describe('새 답 전용 후처리 — 데모 구조 보장(Leader 결정 2026-11-14)', () => {
  const D = CHAT_DISCLAIMER;

  test('고지 문구는 승인 데모 v1 문구 그대로', () => {
    expect(D).toBe('이 내용은 이 시스템의 검증된 전략 판정이 아니라 참고용입니다.');
  });

  test('굵게 표시(**·__)를 떼고 글자는 남긴다, 줄 머리 # 제목 기호를 뗀다', () => {
    expect(finalizeNewChatAnswer('# 요약\n1. **MICROCHIP TECHNOLOGY(NAS:MCHP)** — RSI __34.0__\n### 위험\n- 하락 추세'))
      .toBe(`요약\n1. MICROCHIP TECHNOLOGY(NAS:MCHP) — RSI 34.0\n위험\n- 하락 추세\n\n${D}`);
    expect(finalizeNewChatAnswer('종목은 **삼성전자**와 **SK하이닉스**입니다.')).toBe(`종목은 삼성전자와 SK하이닉스입니다.\n\n${D}`);
  });

  test('수식·곱셈의 * 와 해시는 건드리지 않는다', () => {
    const math = '수익률 = (매도가 - 매수가) / 매수가 * 100\n면적 a*b, 거듭제곱 x**2 + y**2, 2**3 = 8, a ** b\n#1 후보, 이슈#3';
    expect(finalizeNewChatAnswer(math)).toBe(`${math}\n\n${D}`);
    expect(finalizeNewChatAnswer('이름 a__b__c 와 snake__case')).toBe(`이름 a__b__c 와 snake__case\n\n${D}`);
  });

  test('코드 블록 안 내용(**·#·*)은 그대로, 펜스 줄만 뗀다 — 인라인 코드도 그대로', () => {
    const code = 'const r = x ** 2; // **굵게 아님**\n# 주석처럼 보이는 줄\nlet s = a * b;';
    expect(finalizeNewChatAnswer(`계산 예:\n\`\`\`ts\n${code}\n\`\`\`\n**끝**`))
      .toBe(`계산 예:\n${code}\n끝\n\n${D}`);
    expect(finalizeNewChatAnswer('인라인 `a**b**c` 와 **굵게**')).toBe(`인라인 \`a**b**c\` 와 굵게\n\n${D}`);
  });

  test('끝 줄 고지 — 없으면 덧붙이고, 이미 끝에 있으면 한 번만, 가운데·변형 고지는 끝으로 모아 정확한 문구로', () => {
    expect(finalizeNewChatAnswer('답')).toBe(`답\n\n${D}`);
    expect(finalizeNewChatAnswer(`답\n\n${D}`)).toBe(`답\n\n${D}`);
    expect(finalizeNewChatAnswer(`${D}\n답 본문`)).toBe(`답 본문\n\n${D}`);
    expect(finalizeNewChatAnswer('답\n**이 내용은 검증된 전략 판정이 아닌 참고용입니다.**')).toBe(`답\n\n${D}`);
    expect(finalizeNewChatAnswer(`답\n\n${D}\n\n${D}`).split(D).length - 1).toBe(1);
  });

  test('닫히지 않은 펜스 줄은 기호만 지운다', () => {
    expect(finalizeNewChatAnswer('설명\n```\n남은 줄')).toBe(`설명\n\n남은 줄\n\n${D}`);
  });

  test('normalizeNewChatAnswer — JSON 답도 문장 + 고지, 고정 안내문에는 고지를 붙이지 않는다, 기호만 남으면 안내문', () => {
    expect(normalizeNewChatAnswer(STORED_42).text.endsWith(`참고: 데이터 부족으로 구체적인 추천 불가\n\n${D}`)).toBe(true);
    expect(normalizeNewChatAnswer('{"selectedIndices":[]}')).toEqual({ text: CHAT_ANSWER_FALLBACK, source: 'fallback' });
    expect(normalizeNewChatAnswer('##\n# ')).toEqual({ text: CHAT_ANSWER_FALLBACK, source: 'fallback' });   // 제목 기호만 있던 답
    expect(normalizeNewChatAnswer('## 제목\n**본문**')).toEqual({ text: `제목\n본문\n\n${D}`, source: 'text' });
  });

  test('예전 답 표시용 정규화(normalizeChatAnswer)에는 후처리가 없다 — 굵게·고지 그대로(사용자 결정 D2)', () => {
    expect(normalizeChatAnswer('**굵게** 답')).toBe('**굵게** 답');
    expect(normalizeChatAnswer(STORED_42)).not.toContain(D);
  });
});

describe('언급한 엔진 후보의 상태 줄 — 새 답만, 요약에 들어간 후보 목록 기준(Leader 2차 결정)', () => {
  const D = CHAT_DISCLAIMER;
  const CANDS = [
    { symbol: 'NAS:MCHP', name: 'MICROCHIP TECHNOLOGY', status: '미등록 전략·가상 체결만' },
    { symbol: 'NAS:FTNT', name: 'FORTINET INC', status: '미검증 전략·가상 체결만' },
    { symbol: '042660', name: '한화오션', status: 'AI 보류' },
    { symbol: 'NAS:MU', name: 'MICRON TECHNOLOGY INC', status: '승인 대기' },
  ];

  test('이름만 언급 — 영문 이름 전체·첫 낱말(대문자), 국내 한글 이름', () => {
    expect(candidateStatusLine('MICROCHIP TECHNOLOGY 는 RSI 34 로 과매도입니다.', CANDS)).toBe('언급한 후보의 상태: MCHP 미등록 전략·가상 체결만');
    expect(candidateStatusLine('Fortinet Inc 를 보세요', CANDS)).toBe('언급한 후보의 상태: FTNT 미검증 전략·가상 체결만');   // 이름 전체는 대소문자 무시
    expect(candidateStatusLine('MICROCHIP 이 반등 중', CANDS)).toBe('언급한 후보의 상태: MCHP 미등록 전략·가상 체결만');
    expect(candidateStatusLine('한화오션은 일봉이 낡았습니다.', CANDS)).toBe('언급한 후보의 상태: 한화오션 AI 보류');
  });

  test('티커만 언급 — 거래소 접두어 유무·국내 코드, 후보 목록 순서로 묶는다', () => {
    expect(candidateStatusLine('FTNT 와 NAS:MCHP, 그리고 042660', CANDS))
      .toBe('언급한 후보의 상태: MCHP 미등록 전략·가상 체결만, FTNT 미검증 전략·가상 체결만, 한화오션 AI 보류');
    expect(candidateStatusLine('MU는 메모리 업황', CANDS)).toBe('언급한 후보의 상태: MU 승인 대기');
  });

  test('상태를 이미 말한 후보는 다시 적지 않는다(쉼표·띄어쓰기·끝 「만」 차이 허용)', () => {
    expect(candidateStatusLine('MCHP 는 미등록 전략·가상 체결만 상태입니다.', CANDS)).toBeNull();
    expect(candidateStatusLine('MCHP 는 미등록 전략, 가상 체결로만 기록됐습니다.', CANDS)).toBeNull();
    expect(candidateStatusLine('MCHP(미등록 전략·가상 체결만)와 FTNT', CANDS)).toBe('언급한 후보의 상태: FTNT 미검증 전략·가상 체결만');
  });

  test('후보가 아닌 종목만 언급하면 줄을 붙이지 않는다 — 비슷한 낱말 오탐 없음', () => {
    expect(candidateStatusLine('삼성전자와 NVDA, 그리고 MUST 와 EMU, MCHPX', CANDS)).toBeNull();
    expect(candidateStatusLine('금리 4.00% 와 CPI 3.7%', CANDS)).toBeNull();
    expect(candidateStatusLine('MCHP 언급', [])).toBeNull();
  });

  test('finalize — 상태 줄은 고지 끝 줄 바로 앞, 언급이 없으면 없음', () => {
    expect(finalizeNewChatAnswer('**MCHP** 는 반등 후보입니다.', { candidates: CANDS }))
      .toBe(`MCHP 는 반등 후보입니다.\n\n언급한 후보의 상태: MCHP 미등록 전략·가상 체결만\n${D}`);
    expect(finalizeNewChatAnswer(`MCHP 는 미등록 전략·가상 체결만입니다.\n\n${D}`, { candidates: CANDS }))
      .toBe(`MCHP 는 미등록 전략·가상 체결만입니다.\n\n${D}`);
    expect(finalizeNewChatAnswer('다음 금리 결정일은 12월 9일입니다.', { candidates: CANDS })).toBe(`다음 금리 결정일은 12월 9일입니다.\n\n${D}`);
    expect(normalizeNewChatAnswer('{"answer":"FTNT 를 보세요"}', { candidates: CANDS }).text)
      .toBe(`FTNT 를 보세요\n\n언급한 후보의 상태: FTNT 미검증 전략·가상 체결만\n${D}`);
  });

  test('예전 답 표시용 정규화에는 상태 줄이 없다', () => {
    expect(normalizeChatAnswer('MCHP 는 반등 후보입니다.')).toBe('MCHP 는 반등 후보입니다.');
  });
});

describe('문장 중간 JSON 조각(Reviewer M2) — 예전 답 표시·새 답 모두', () => {
  const D = CHAT_DISCLAIMER;

  test('Reviewer 입력 두 개 — 쓸 문자열이 없으면 조각을 지우고 앞뒤 공백·남은 「라벨:」을 정리', () => {
    expect(normalizeChatAnswerDetailed('결과는 {"selectedIndices":[],"confidence":0.1} 입니다')).toEqual({ text: '결과는 입니다', source: 'json' });
    expect(normalizeChatAnswerDetailed('추천: [{"symbol":"A"}]')).toEqual({ text: '추천', source: 'json' });
    // 새 답 경로도 같은 정규화를 거친 뒤 후처리
    expect(normalizeNewChatAnswer('결과는 {"selectedIndices":[],"confidence":0.1} 입니다').text).toBe(`결과는 입니다\n\n${D}`);
    expect(normalizeNewChatAnswer('추천: [{"symbol":"A"}]').text).toBe(`추천\n\n${D}`);
  });

  test('쓸 문자열 필드가 있으면 그 문장으로(여러 줄은 한 줄로)', () => {
    expect(normalizeChatAnswer('결과: {"answer":"검토 후보는 MCHP 입니다"} 참고하세요.')).toBe('결과: 검토 후보는 MCHP 입니다 참고하세요.');
    expect(normalizeChatAnswer('목록 [{"reasoning":"가"},{"reasoning":"나"}] 끝')).toBe('목록 가 나 끝');
    expect(normalizeChatAnswer('요약 {"answer":"본문","warnings":["주의"]} 끝')).toBe('요약 본문 참고: 주의 끝');
  });

  test('문장부호·괄호·줄 머리 정리', () => {
    expect(normalizeChatAnswer('값은 {"confidence":0.1}.')).toBe('값은.');
    expect(normalizeChatAnswer('(참고 {"ev":1}) 다음')).toBe('(참고) 다음');
    expect(normalizeChatAnswer('설명 ({"ev":{"pWin":0}}) 끝')).toBe('설명 끝');
    expect(normalizeChatAnswer('앞 문장\n{"confidence":0} 뒤 문장')).toBe('앞 문장\n뒤 문장');
    expect(normalizeChatAnswer('두 개 {"a":1} 와 {"b":2} 끝')).toBe('두 개 와 끝');
  });

  test('오탐 방지 — 파싱 안 되는 중괄호·수식·숫자 배열·빈 객체는 그대로', () => {
    for (const t of ['RSI {RSI 30} 이하', '집합 f(x) = {x | x > 0}', '구간 [1, 2] 과 ["a", "b"]', '빈 {} 표시', '중괄호 { 하나만', '[요약] 금리 4.00%']) {
      expect(normalizeChatAnswerDetailed(t)).toEqual({ text: t, source: 'text' });
    }
  });

  test('코드 블록 안 JSON·인라인 코드 안 JSON 은 그대로(기존 규칙: 펜스 전체가 JSON 이면 그 규칙대로 바뀐다)', () => {
    const code = '예시\n```ts\nconst a = {"x": 1};\nconst b = [{"y": 2}];\n```\n끝';
    expect(normalizeChatAnswerDetailed(code)).toEqual({ text: code, source: 'text' });
    expect(normalizeChatAnswerDetailed('형식은 `{"a":1}` 입니다')).toEqual({ text: '형식은 `{"a":1}` 입니다', source: 'text' });
    expect(normalizeChatAnswer('설명\n```json\n{"answer":"펜스 전체가 JSON"}\n```')).toBe('설명\n펜스 전체가 JSON');
  });

  test('원문에 섞인 제어문자 표시는 결과에 남지 않는다', () => {
    const odd = `가${String.fromCharCode(1)}나 {"confidence":1} 다`;
    expect(normalizeChatAnswer(odd)).toBe('가나 다');
    // JSON 문자열의 \u0001·\u0004 이스케이프도 표시와 섞이지 않는다
    expect(normalizeChatAnswer('앞 {"answer":"x\\u0001y\\u0004z"} 뒤 {"ev":1} 끝')).toBe('앞 xyz 뒤 끝');
  });
});

describe('짧은 영문 국내 종목명(Reviewer L2) — 단어 경계 필요', () => {
  const CANDS = [
    { symbol: '034730', name: 'SK', status: 'AI 보류' },
    { symbol: '003550', name: 'LG', status: '승인 대기' },
  ];
  test('영어 낱말 안의 sk·lg 는 언급이 아니다', () => {
    expect(candidateStatusLine('risk 관리가 중요하고 algebra 같은 skill 이 필요합니다. SKT·LGES 도 아님', CANDS)).toBeNull();
  });
  test('경계가 맞으면 언급(한글 조사는 경계)', () => {
    expect(candidateStatusLine('SK는 지주사, LG 도 봅니다', CANDS)).toBe('언급한 후보의 상태: SK AI 보류, LG 승인 대기');
    expect(candidateStatusLine('(sk) 소문자', CANDS)).toBe('언급한 후보의 상태: SK AI 보류');
  });
});

describe('잘린 문장 중간 JSON(QA F1) — 그 위치부터 줄 끝까지 지우고 다음 줄은 남긴다', () => {
  const D = CHAT_DISCLAIMER;

  test('QA 입력 두 개 — 새 답·예전 답 표시 모두 JSON 조각이 남지 않는다', () => {
    expect(normalizeNewChatAnswer('결과는 {"selectedIndices":[', { candidates: [] }).text).toBe(`결과는\n\n${D}`);
    expect(normalizeNewChatAnswer('결과 {"selectedIndices":[],"confidence":0.1', { candidates: [] }).text).toBe(`결과\n\n${D}`);
    expect(normalizeChatAnswerDetailed('결과는 {"selectedIndices":[')).toEqual({ text: '결과는', source: 'json' });
    expect(normalizeChatAnswer('결과 {"selectedIndices":[],"confidence":0.1')).toBe('결과');
  });

  test('다음 줄은 남긴다 — 문장 중간·줄 머리 모두', () => {
    expect(normalizeChatAnswer('결과는 {"selectedIndices":[\n다음 줄 문장은 남는다')).toBe('결과는\n다음 줄 문장은 남는다');
    expect(normalizeChatAnswer('앞 문장\n{"selectedIndices": [\n다음 줄 문장')).toBe('앞 문장\n다음 줄 문장');
    // 줄 머리 잘린 JSON 뒤의 「JSON 이어짐」 줄(따옴표 키·괄호·값만)은 같이 버린다
    expect(normalizeChatAnswer('앞\n{\n  "ev": {\n    "pWin": 0,\n    0.5,\n    true\n그 뒤 문장')).toBe('앞\n그 뒤 문장');
  });

  test('`[{` 시작·괄호 짝은 맞지만 파싱 안 되는 JSON 모양', () => {
    expect(normalizeChatAnswer('추천: [{"symbol":"A"')).toBe('추천');
    expect(normalizeChatAnswer('값 {"a": } 끝')).toBe('값 끝');
  });

  test('drafter 정리도 같은 규칙 — JSON 이 섞였으면 원문 질문', () => {
    expect(cleanDraftPrompt('다듬은 질문 {"selectedIndices":[', '원문')).toBe('원문');
  });

  test('오탐 방지 — 따옴표 키가 없는 닫히지 않은 중괄호, 코드 블록 안은 그대로', () => {
    for (const t of ['RSI {RSI 30 이하에서', '조건 { 가격 > 100 일 때', '{RSI 30 이하에서 반등', '집합 {x | x > 0', '[참고 {1, 2']) {
      expect(normalizeChatAnswerDetailed(t)).toEqual({ text: t, source: 'text' });
    }
    const code = "코드\n```ts\nconst s = '{\"a\": [';\n```\n끝";
    expect(normalizeChatAnswerDetailed(code)).toEqual({ text: code, source: 'text' });
    expect(normalizeChatAnswerDetailed('형식 `{"a": [` 처럼')).toEqual({ text: '형식 `{"a": [` 처럼', source: 'text' });
  });
});

describe('JSON 으로 시작하는 답(QA F5) — 선행 조각만 지우고 뒤 문장을 살린다', () => {
  test('닫힌 선행 조각 + 뒤 문장', () => {
    expect(normalizeChatAnswerDetailed('{"selectedIndices":[],"confidence":0.1} 그리고 다음 문장')).toEqual({ text: '그리고 다음 문장', source: 'json' });
    expect(normalizeChatAnswer('{"answer":"앞 답"} 뒤 문장')).toBe('앞 답 뒤 문장');
  });
  test('잘린 선행 조각 + 다음 줄 문장', () => {
    expect(normalizeChatAnswerDetailed('{"selectedIndices":[\n그래도 이 문장은 남는다')).toEqual({ text: '그래도 이 문장은 남는다', source: 'json' });
  });
  test('남는 문장이 없을 때만 고정 안내문', () => {
    expect(normalizeChatAnswer('{"selectedIndices":[')).toBe(CHAT_ANSWER_FALLBACK);
    expect(normalizeChatAnswer('{"selectedIndices":[],"confidence":0.1}')).toBe(CHAT_ANSWER_FALLBACK);
    expect(normalizeNewChatAnswer('{"selectedIndices":[], "x":').text).toBe(CHAT_ANSWER_FALLBACK);
  });
});

describe('자료 기준 시각 줄(QA F4) — 새 답만, 요약 빌더가 넘긴 기준 시각', () => {
  const D = CHAT_DISCLAIMER;
  const TIMES = [
    { label: '경제 지표', at: '2026-11-14 05:55' },
    { label: '엔진 후보', at: '2026-11-14 08:01' },
    { label: '일봉', at: '2026-11-13' },
    { label: '뉴스', at: '2026-11-14 17:00' },
  ];
  const LINE = '자료 기준: 경제 지표 11-14 05:55 · 엔진 후보 11-14 08:01 · 일봉 11-13 · 뉴스 11-14 17:00 (KST)';

  test('숫자는 있는데 기준 날짜·시각이 없으면 줄을 붙인다(고지·상태 줄 앞)', () => {
    expect(sourceTimeLine('CPI 3.7%, 금리 4.00% 입니다.', TIMES)).toBe(LINE);
    expect(finalizeNewChatAnswer('CPI 3.7% 입니다.', { sourceTimes: TIMES })).toBe(`CPI 3.7% 입니다.\n\n${LINE}\n${D}`);
    expect(finalizeNewChatAnswer('MCHP RSI 34.0', {
      sourceTimes: TIMES, candidates: [{ symbol: 'NAS:MCHP', name: 'MICROCHIP TECHNOLOGY', status: '미등록 전략·가상 체결만' }],
    })).toBe(`MCHP RSI 34.0\n\n${LINE}\n언급한 후보의 상태: MCHP 미등록 전략·가상 체결만\n${D}`);
  });

  test('기준 날짜·시각을 이미 적었으면 붙이지 않는다 — 11-14·2026-11-14·11월 14일·11/14·05:55·5:55·일봉 날짜', () => {
    for (const body of [
      'CPI 3.7% (11-14 05:55 기준)', '2026-11-14 자료로 CPI 3.7%', '11월 14일 기준 CPI 3.7%', '11/14 기준 3.7%',
      '05:55 기준 3.7%', '5:55 기준 3.7%', '11-13 종가 $62.25', '2026. 11. 14 기준 3.7%',
    ]) expect(sourceTimeLine(body, TIMES)).toBeNull();
  });

  test('다른 날짜(다음 금리 결정일 12월 9일)만 적었으면 기준 시각이 아니라 붙인다', () => {
    expect(sourceTimeLine('다음 금리 결정일은 12월 9일, CPI 3.7%', TIMES)).toBe(LINE);
  });

  test('숫자가 없는 답(인사 등)·요약이 없던 답에는 붙이지 않는다', () => {
    expect(sourceTimeLine('안녕하세요, 무엇을 도와드릴까요?', TIMES)).toBeNull();
    expect(finalizeNewChatAnswer('안녕하세요', { sourceTimes: TIMES })).toBe(`안녕하세요\n\n${D}`);
    expect(sourceTimeLine('CPI 3.7%', [])).toBeNull();
  });

  test('예전 답 표시에는 없다', () => {
    expect(normalizeChatAnswer('CPI 3.7% 입니다.')).toBe('CPI 3.7% 입니다.');
  });
});
