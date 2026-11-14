/**
 * T-169 ⑥ — 채팅 route 가 지시를 `system` 으로 넘기고(user 와 분리), 수집 데이터 요약을 붙이고, 답을 저장 전에 정규화하고,
 * hybrid 의 실제 모델을 기록하는지. DB·LLM·KIS 모의 — 실제 호출 없음. system-prompt·chat-request·answer-format 은 실물.
 */
import { NextRequest } from 'next/server';

const mockAuth = jest.fn();
const mockQuery = jest.fn();
const mockGetConnection = jest.fn();
const mockLlm = jest.fn();
const mockProvider = jest.fn();
const mockConfig = jest.fn();
const mockOverview = jest.fn();
jest.mock('@/lib/auth/current-user', () => ({ requireUserId: (...a: unknown[]) => mockAuth(...a) }));
jest.mock('@/lib/auth/users', () => ({ findUserById: async () => ({ id: 7 }) }));
jest.mock('@/lib/db', () => ({ getPool: () => ({ query: mockQuery, getConnection: mockGetConnection }) }));
jest.mock('@/lib/llm/provider', () => ({
  runLlm: (...a: unknown[]) => mockLlm(...a),
  getActiveProvider: () => mockProvider(),
  getProviderConfig: () => mockConfig(),
}));
jest.mock('@/lib/chat/symbol-resolver', () => ({ resolveSymbolsInText: async () => [] }));
const mockBuildContexts = jest.fn();
jest.mock('@/lib/chat/context-builder', () => ({
  buildSymbolContexts: (...a: unknown[]) => mockBuildContexts(...a),
  formatSymbolContextsAsText: () => '- NVIDIA CORP(엔비디아, NAS:NVDA): 현재 $161.11',
}));
jest.mock('@/lib/strategy/style', () => ({
  ANALYST_STYLE_LABEL: 'aggressive',
  getStyleConfig: async () => ({ holdingPeriodDays: { min: 1, max: 10 }, targetProfitPct: 2.5 }),
}));
jest.mock('@/lib/chat/overview-context', () => ({ buildOverviewContext: (...a: unknown[]) => mockOverview(...a) }));

import { CHAT_ANSWER_FALLBACK } from '../answer-format';
import { CHAT_NUM_CTX } from '../chat-request';
import { CHAT_TEXT_MAX_CHARS } from '../request-guard';
import { buildAnalystSystemPrompt, buildDrafterSystemPrompt, CHAT_DISCLAIMER } from '../system-prompt';

const messages = require('@/app/api/chat/threads/[id]/messages/route') as typeof import('@/app/api/chat/threads/[id]/messages/route');
const draft = require('@/app/api/chat/threads/[id]/draft/route') as typeof import('@/app/api/chat/threads/[id]/draft/route');

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (method = 'GET', body?: object) => new NextRequest('http://localhost/api/chat/threads/2/messages', {
  method, ...(body ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}),
});
const STYLE_CTX = {
  analystStyle: 'aggressive' as const,
  style: { holdingPeriodDays: { min: 1, max: 10 }, targetProfitPct: 2.5 } as never,
  attachedSummary: '', recentMessages: '',
};
const OVERVIEW_TEXT = '[수집 데이터 요약 · 조회 2026-11-14 19:20 KST · 보유 종목·주문 내역은 포함하지 않음]\n\n경제 흐름 · 미국 물가·금리 (기준 2026-11-14 05:55 KST)\n- 소비자물가(CPI) 전년 대비 3.7%';
const JSON_ANSWER = '{"selectedIndices":[],"confidence":0,"reasoning":"데이터가 부족합니다.","warnings":["데이터 부족"]}';

function conn() {
  return {
    beginTransaction: jest.fn(),
    query: jest.fn()
      .mockResolvedValueOnce([[{ id: 2, title: '새 대화' }], []])
      .mockResolvedValueOnce([{ insertId: 10 }, []])
      .mockResolvedValueOnce([{ insertId: 11 }, []])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []]),
    rollback: jest.fn(), commit: jest.fn(), release: jest.fn(),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.mockResolvedValue({ ok: true, userId: 7 });
  mockProvider.mockResolvedValue('hybrid');
  mockConfig.mockResolvedValue({ provider: 'hybrid', homeM4ApiModel: 'qwen-home', stage1Model: 'qwen-stage1' });
  mockOverview.mockResolvedValue({ text: OVERVIEW_TEXT, sections: ['macro'] });
  mockBuildContexts.mockResolvedValue([]);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('messages POST', () => {
  test('지시는 system 으로, 본문은 user 로 분리 — 요약·첨부·질문이 user 에, numCtx 8192', async () => {
    mockQuery.mockResolvedValueOnce([[{ id: 2 }], []]).mockResolvedValueOnce([[], []]);
    mockGetConnection.mockResolvedValue(conn());
    mockLlm.mockResolvedValue('지금 자료로는 과매도 후보가 많습니다.\n\n' + CHAT_DISCLAIMER);
    const res = await messages.POST(req('POST', { content: '추천 5개', draftPrompt: '다듬은 질문' }), ctx('2'));
    expect(res.status).toBe(200);
    expect(mockLlm).toHaveBeenCalledTimes(1);
    const [user, opts] = mockLlm.mock.calls[0] as [string, Record<string, unknown>];
    expect(opts.system).toBe(buildAnalystSystemPrompt(STYLE_CTX));
    expect(opts).toMatchObject({ numCtx: CHAT_NUM_CTX, responseFormat: 'text', timeoutMs: 120_000 });
    expect(CHAT_NUM_CTX).toBe(8192);
    expect(user).toContain(OVERVIEW_TEXT);
    expect(user).toContain('[첨부 종목 — 질문 시점 KIS 시세·일봉 지표]\n- NVIDIA CORP(엔비디아, NAS:NVDA): 현재 $161.11');
    expect(user.endsWith('[질문]\n다듬은 질문')).toBe(true);
    expect(user).not.toContain('투자 정보 비서');   // 지시가 user 본문에 섞이지 않는다
    expect(mockOverview).toHaveBeenCalledWith(expect.objectContaining({ userId: 7 }));
  });

  test('LLM 이 JSON 으로 답하면 저장 전에 문장으로 — DB·응답 모두 JSON 아님', async () => {
    mockQuery.mockResolvedValueOnce([[{ id: 2 }], []]).mockResolvedValueOnce([[], []]);
    const c = conn();
    mockGetConnection.mockResolvedValue(c);
    mockLlm.mockResolvedValue(JSON_ANSWER);
    const res = await messages.POST(req('POST', { content: '추천', draftPrompt: 'x' }), ctx('2'));
    const body = await res.json();
    expect(body.response).toBe(`데이터가 부족합니다.\n\n참고: 데이터 부족\n\n${CHAT_DISCLAIMER}`);
    const asstInsert = c.query.mock.calls[2];
    expect(asstInsert[0]).toMatch(/INSERT INTO chat_messages .*'assistant'/s);
    expect(asstInsert[1][1]).toBe(`데이터가 부족합니다.\n\n참고: 데이터 부족\n\n${CHAT_DISCLAIMER}`);
    expect(String(asstInsert[1][1])).not.toMatch(/selectedIndices|\{/);
  });

  test('새 답 후처리 — 굵게·제목 기호를 떼고 끝 줄 고지를 보장해 저장·응답', async () => {
    mockQuery.mockResolvedValueOnce([[{ id: 2 }], []]).mockResolvedValueOnce([[], []]);
    const c = conn();
    mockGetConnection.mockResolvedValue(c);
    mockLlm.mockResolvedValue('## 결론\n**MICROCHIP TECHNOLOGY(NAS:MCHP)** — 상태: 미등록 전략·가상 체결만');
    const body = await (await messages.POST(req('POST', { content: 'q', draftPrompt: 'x' }), ctx('2'))).json();
    const want = `결론\nMICROCHIP TECHNOLOGY(NAS:MCHP) — 상태: 미등록 전략·가상 체결만\n\n${CHAT_DISCLAIMER}`;
    expect(body.response).toBe(want);
    expect(c.query.mock.calls[2][1][1]).toBe(want);
  });

  test('언급한 엔진 후보의 상태 줄 — 요약을 만들 때 쓴 후보 목록을 후처리에 넘긴다', async () => {
    mockOverview.mockResolvedValue({
      text: OVERVIEW_TEXT, sections: ['macro', 'candidates'],
      candidates: [
        { symbol: 'NAS:MCHP', name: 'MICROCHIP TECHNOLOGY', status: '미등록 전략·가상 체결만' },
        { symbol: 'NAS:FTNT', name: 'FORTINET INC', status: 'AI 보류' },
      ],
    });
    mockQuery.mockResolvedValueOnce([[{ id: 2 }], []]).mockResolvedValueOnce([[], []]);
    const c = conn();
    mockGetConnection.mockResolvedValue(c);
    mockLlm.mockResolvedValue('MCHP 와 FORTINET INC 를 검토 후보로 봅니다.');
    const body = await (await messages.POST(req('POST', { content: 'q', draftPrompt: 'x' }), ctx('2'))).json();
    const want = `MCHP 와 FORTINET INC 를 검토 후보로 봅니다.\n\n언급한 후보의 상태: MCHP 미등록 전략·가상 체결만, FTNT AI 보류\n${CHAT_DISCLAIMER}`;
    expect(body.response).toBe(want);
    expect(c.query.mock.calls[2][1][1]).toBe(want);
  });

  test('자료 기준 시각 줄(QA F4) — 요약 빌더가 준 기준 시각을 후처리에 넘긴다', async () => {
    mockOverview.mockResolvedValue({
      text: OVERVIEW_TEXT, sections: ['macro', 'news'], candidates: [],
      sourceTimes: [{ label: '경제 지표', at: '2026-11-14 05:55' }, { label: '뉴스', at: '2026-11-14 17:00' }],
    });
    mockQuery.mockResolvedValueOnce([[{ id: 2 }], []]).mockResolvedValueOnce([[], []]);
    const c = conn();
    mockGetConnection.mockResolvedValue(c);
    mockLlm.mockResolvedValue('CPI 는 3.7% 입니다.');
    const body = await (await messages.POST(req('POST', { content: 'q', draftPrompt: 'x' }), ctx('2'))).json();
    const want = `CPI 는 3.7% 입니다.\n\n자료 기준: 경제 지표 11-14 05:55 · 뉴스 11-14 17:00 (KST)\n${CHAT_DISCLAIMER}`;
    expect(body.response).toBe(want);
    expect(c.query.mock.calls[2][1][1]).toBe(want);
  });

  test('파싱 안 되는 JSON 은 고정 안내문으로 저장(고지·후처리 없음)', async () => {
    mockQuery.mockResolvedValueOnce([[{ id: 2 }], []]).mockResolvedValueOnce([[], []]);
    const c = conn();
    mockGetConnection.mockResolvedValue(c);
    mockLlm.mockResolvedValue('{"selectedIndices": [');
    await messages.POST(req('POST', { content: '추천', draftPrompt: 'x' }), ctx('2'));
    expect(c.query.mock.calls[2][1][1]).toBe(CHAT_ANSWER_FALLBACK);
  });

  test('hybrid — llm_model 에 실제 호출 모델(stage1_model)을 기록·응답', async () => {
    mockQuery.mockResolvedValueOnce([[{ id: 2 }], []]).mockResolvedValueOnce([[], []]);
    const c = conn();
    mockGetConnection.mockResolvedValue(c);
    mockLlm.mockResolvedValue('답');
    const res = await messages.POST(req('POST', { content: 'q', draftPrompt: 'x' }), ctx('2'));
    expect((await res.json()).llmModel).toBe('qwen-stage1');
    expect(c.query.mock.calls[2][1]).toEqual([2, `답\n\n${CHAT_DISCLAIMER}`, 'hybrid', 'qwen-stage1', expect.any(Number)]);
  });

  test('home-m4-api·claude 는 이전과 같은 모델 이름', async () => {
    for (const [prov, cfg, want] of [
      ['home-m4-api', { homeM4ApiModel: 'qwen-home', stage1Model: 'qwen-stage1' }, 'qwen-home'],
      ['claude', {}, 'sonnet'],
    ] as const) {
      mockProvider.mockResolvedValue(prov);
      mockConfig.mockResolvedValue(cfg);
      mockQuery.mockResolvedValueOnce([[{ id: 2 }], []]).mockResolvedValueOnce([[], []]);
      mockGetConnection.mockResolvedValue(conn());
      mockLlm.mockResolvedValue('답');
      const res = await messages.POST(req('POST', { content: 'q', draftPrompt: 'x' }), ctx('2'));
      expect((await res.json()).llmModel).toBe(want);
    }
  });

  test('draftPrompt 없음 — drafter 도 system 분리, JSON drafter 결과는 원문 질문으로 대체', async () => {
    mockQuery.mockResolvedValueOnce([[{ id: 2 }], []]).mockResolvedValueOnce([[], []]);
    const c = conn();
    mockGetConnection.mockResolvedValue(c);
    mockLlm.mockResolvedValueOnce('{"reasoning":"메타 설명"}').mockResolvedValueOnce('답');
    await messages.POST(req('POST', { content: '원래 질문', skipDraftStage: true }), ctx('2'));
    expect(mockLlm).toHaveBeenCalledTimes(2);
    const [drafterUser, drafterOpts] = mockLlm.mock.calls[0] as [string, Record<string, unknown>];
    expect(drafterOpts.system).toBe(buildDrafterSystemPrompt(STYLE_CTX));
    expect(drafterOpts.numCtx).toBe(CHAT_NUM_CTX);
    expect(drafterUser.startsWith('[사용자 원문]\n원래 질문')).toBe(true);
    // 사용자 행: draft_prompt = 원문, draft_prompt_raw = 모델 원문(감사용)
    expect(c.query.mock.calls[1][1]).toEqual([2, '원래 질문', '원래 질문', '{"reasoning":"메타 설명"}', null]);
    expect((mockLlm.mock.calls[1][0] as string).endsWith('[질문]\n원래 질문')).toBe(true);
  });

  test('최근 대화 — 예전 JSON 답은 문장으로 바꿔 넣고, 메시지당 300자', async () => {
    const longUser = '가'.repeat(400);
    mockQuery.mockResolvedValueOnce([[{ id: 2 }], []]).mockResolvedValueOnce([[
      { role: 'assistant', content: JSON_ANSWER },
      { role: 'user', content: longUser },
    ], []]);
    mockGetConnection.mockResolvedValue(conn());
    mockLlm.mockResolvedValue('답');
    await messages.POST(req('POST', { content: 'q', draftPrompt: 'x' }), ctx('2'));
    const user = mockLlm.mock.calls[0][0] as string;
    expect(user).toContain(`[최근 대화]\n사용자: ${'가'.repeat(300)}\n비서: 데이터가 부족합니다.`);
    expect(user).not.toContain('가'.repeat(301));
    expect(user).not.toMatch(/selectedIndices/);
  });
});

describe('messages GET — 표시용 변환(DB 원본 불변)', () => {
  test('assistant JSON 은 문장만(안내 문구 없음), user 내용은 그대로', async () => {
    mockQuery.mockResolvedValueOnce([[{ id: 2 }], []]).mockResolvedValueOnce([[
      { id: 41, role: 'user', content: '{"내가 쓴": "JSON 모양 질문"}', draft_prompt: null, draft_prompt_raw: null, context_attached: null,
        llm_provider: null, llm_model: null, latency_ms: null, created_at: '2026-11-14 17:32:00' },
      { id: 42, role: 'assistant', content: JSON_ANSWER, draft_prompt: null, draft_prompt_raw: null, context_attached: null,
        llm_provider: 'hybrid', llm_model: 'qwen2.5:14b-instruct', latency_ms: 9900, created_at: '2026-11-14 17:32:10' },
      { id: 43, role: 'assistant', content: '일반 문장 답', draft_prompt: null, draft_prompt_raw: null, context_attached: null,
        llm_provider: 'claude', llm_model: 'sonnet', latency_ms: 1, created_at: '2026-11-14 17:33:00' },
    ], []]);
    const res = await messages.GET(req(), ctx('2'));
    const body = await res.json();
    expect(body.messages.map((m: { content: string }) => m.content)).toEqual([
      '{"내가 쓴": "JSON 모양 질문"}',
      '데이터가 부족합니다.\n\n참고: 데이터 부족',
      '일반 문장 답',
    ]);
    // GET 은 SELECT 2번뿐 — 쓰기 없음
    expect(mockQuery).toHaveBeenCalledTimes(2);
    expect(mockQuery.mock.calls.every(([sql]) => /^\s*SELECT/.test(String(sql)))).toBe(true);
    expect(mockGetConnection).not.toHaveBeenCalled();
  });
});

describe('draft POST', () => {
  test('system 분리·numCtx, 일반 문장은 그대로, hybrid draftModel 은 stage1', async () => {
    mockQuery.mockResolvedValueOnce([[{ id: 2 }], []]).mockResolvedValueOnce([[], []]).mockResolvedValueOnce([[{ id: 2 }], []]);
    mockLlm.mockResolvedValue('  투자 성향: aggressive\n\n수집 데이터를 근거로 검토할 종목 5개를 추천해 주세요.  ');
    const res = await draft.POST(req('POST', { content: '추천 5개' }), ctx('2'));
    const body = await res.json();
    const [user, opts] = mockLlm.mock.calls[0] as [string, Record<string, unknown>];
    expect(opts.system).toBe(buildDrafterSystemPrompt(STYLE_CTX));
    expect(opts).toMatchObject({ numCtx: CHAT_NUM_CTX, responseFormat: 'text', timeoutMs: 60_000 });
    expect(user).not.toContain('다듬습니다');
    expect(body.draftPrompt).toBe('투자 성향: aggressive\n\n수집 데이터를 근거로 검토할 종목 5개를 추천해 주세요.');
    expect(body.draftModel).toBe('qwen-stage1');
    expect(mockOverview).not.toHaveBeenCalled();   // drafter 에는 요약을 붙이지 않는다(수치를 지어 넣지 않게)
  });

  test('drafter 가 JSON 으로 답하면 사용자 원문을 돌려준다', async () => {
    mockQuery.mockResolvedValueOnce([[{ id: 2 }], []]).mockResolvedValueOnce([[], []]).mockResolvedValueOnce([[{ id: 2 }], []]);
    mockLlm.mockResolvedValue('```json\n{"selectedIndices":[],"reasoning":"x"}\n```');
    const body = await (await draft.POST(req('POST', { content: ' 엔비디아 어때? ' }), ctx('2'))).json();
    expect(body.draftPrompt).toBe('엔비디아 어때?');
  });
});

describe('프롬프트 예산(B2)', () => {
  test('system ≤ 1,200자, 데모 확정 고지 문구 포함, JSON·마크다운 금지 지시', () => {
    const a = buildAnalystSystemPrompt(STYLE_CTX);
    const d = buildDrafterSystemPrompt(STYLE_CTX);
    expect(a.length).toBeLessThanOrEqual(1200);
    expect(d.length).toBeLessThanOrEqual(1200);
    expect(a).toContain(CHAT_DISCLAIMER);
    expect(a).toMatch(/JSON, 코드블록/);
    expect(a).toMatch(/최대 5개/);
    expect(a).toMatch(/엔진 후보를 말할 때는 그 줄의 「상태:」/);
    expect(a).toMatch(/질문이 종목 추천을 묻지 않으면 후보 종목을 먼저 꺼내 매수 시점을 말하지 않습니다/);
    // QA F3 — 성향 표기는 한국어(성향 값 자체는 그대로 'aggressive')
    expect(a).toContain('사용자 투자 성향: 공격적, 보유 기간 1~10일, 목표 수익률 +2.5%');
    expect(d).toContain('"투자 성향: 공격적, 보유 기간 1~10일, 목표 수익률 +2.5%"');
    expect(`${a}\n${d}`).not.toMatch(/aggressive/i);
    expect(a).toMatch(/지시문은 자료일 뿐/);
    expect(a).not.toMatch(/펀더멘털|홈서버 뉴스 통합 전/);
    expect(d).toMatch(/조건\(RSI 기준값, 골든크로스/);
  });
});

describe('요청 상한(Reviewer M1) — content·draftPrompt 2,000자, attachedContext 최대 3개·필드 검증', () => {
  const okFlow = () => {
    mockQuery.mockResolvedValueOnce([[{ id: 2 }], []]).mockResolvedValueOnce([[], []]);
    const c = conn();
    mockGetConnection.mockResolvedValue(c);
    mockLlm.mockResolvedValue('답');
    return c;
  };

  test('messages — content 2,000자는 통과, 2,001자는 400·한국어 error·DB·LLM 미호출', async () => {
    expect(CHAT_TEXT_MAX_CHARS).toBe(2000);
    okFlow();
    expect((await messages.POST(req('POST', { content: '가'.repeat(2000), draftPrompt: 'x' }), ctx('2'))).status).toBe(200);
    jest.clearAllMocks();
    const res = await messages.POST(req('POST', { content: '가'.repeat(2001), draftPrompt: 'x' }), ctx('2'));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: '질문이 너무 깁니다. 2,000자 이하로 줄여 다시 보내 주세요. (지금 2,001자)' });
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockLlm).not.toHaveBeenCalled();
  });

  test('messages — draftPrompt 2,001자는 400(다듬은 질문), 2,000자는 통과, 앞뒤 공백은 세지 않는다', async () => {
    const res = await messages.POST(req('POST', { content: 'q', draftPrompt: '나'.repeat(2001) }), ctx('2'));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('다듬은 질문이 너무 깁니다. 2,000자 이하로 줄여 다시 보내 주세요. (지금 2,001자)');
    expect(mockQuery).not.toHaveBeenCalled();
    okFlow();
    expect((await messages.POST(req('POST', { content: 'q', draftPrompt: `  ${'나'.repeat(2000)}  ` }), ctx('2'))).status).toBe(200);
  });

  test('글자 수는 유니코드 글자 단위 — 이모지 2,000개는 통과', async () => {
    okFlow();
    expect((await messages.POST(req('POST', { content: '📈'.repeat(2000), draftPrompt: 'x' }), ctx('2'))).status).toBe(200);
  });

  test('draft — content 2,001자는 400, 2,000자는 통과', async () => {
    const res = await draft.POST(req('POST', { content: '가'.repeat(2001) }), ctx('2'));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/^질문이 너무 깁니다\. 2,000자 이하로/);
    expect(mockQuery).not.toHaveBeenCalled();
    mockQuery.mockResolvedValueOnce([[{ id: 2 }], []]).mockResolvedValueOnce([[], []]).mockResolvedValueOnce([[{ id: 2 }], []]);
    mockLlm.mockResolvedValue('다듬은 질문');
    expect((await draft.POST(req('POST', { content: '가'.repeat(2000) }), ctx('2'))).status).toBe(200);
  });

  test('문자열이 아닌 content 는 500 이 아니라 400(content required)', async () => {
    for (const content of [123, { a: 1 }, ['x']]) {
      expect((await messages.POST(req('POST', { content }), ctx('2'))).status).toBe(400);
      expect((await draft.POST(req('POST', { content }), ctx('2'))).status).toBe(400);
    }
    expect(mockLlm).not.toHaveBeenCalled();
  });

  const item = (over: Record<string, unknown> = {}) => ({
    symbol: 'NAS:NVDA', name: 'NVIDIA CORP', matchedText: '엔비디아', price: 215420.6, priceUsd: 161.11, priceChange5: -13.7,
    rsi14: 25, ema20: 1, ema60: 2, macdHistogram: null, atrPct: 3.2, high24h: null, low24h: null, ...over,
  });

  test('attachedContext 3개 이하·타입이 맞으면 그대로 쓰고(재계산 없음) 알려진 필드만 저장', async () => {
    const c = okFlow();
    await messages.POST(req('POST', { content: 'q', draftPrompt: 'x', attachedContext: [item({ extra: 'x'.repeat(5000) })] }), ctx('2'));
    expect(mockBuildContexts).not.toHaveBeenCalled();
    const saved = JSON.parse(c.query.mock.calls[1][1][4] as string);
    expect(saved).toEqual([{
      symbol: 'NAS:NVDA', name: 'NVIDIA CORP', matchedText: '엔비디아', price: 215420.6, priceUsd: 161.11, priceChange5: -13.7,
      rsi14: 25, ema20: 1, ema60: 2, macdHistogram: null, atrPct: 3.2,
    }]);
  });

  test.each([
    ['4개', [item(), item(), item(), item()]],
    ['symbol 이 숫자', [item({ symbol: 5930 })]],
    ['price 가 문자열', [item({ price: '1000' })]],
    ['rsi14 가 문자열', [item({ rsi14: '25' })]],
    ['priceChange5 가 null', [item({ priceChange5: null })]],
    ['name 이 없음', [item({ name: undefined })]],
    ['항목이 배열이 아님', ['NAS:NVDA']],
    ['배열이 아님', { symbol: 'NAS:NVDA' }],
  ])('attachedContext %s → 무시하고 서버에서 재계산(500 아님)', async (_n, attachedContext) => {
    okFlow();
    const res = await messages.POST(req('POST', { content: 'q', draftPrompt: 'x', attachedContext }), ctx('2'));
    expect(res.status).toBe(200);
    expect(mockBuildContexts).toHaveBeenCalledTimes(1);
  });

  test('attachedSymbols 가 배열이 아니어도 500 이 아니다, 문자열·32자 이하만 최대 3개', async () => {
    okFlow();
    expect((await messages.POST(req('POST', { content: 'q', draftPrompt: 'x', attachedSymbols: 'NAS:NVDA' }), ctx('2'))).status).toBe(200);
    okFlow();
    await messages.POST(req('POST', { content: 'q', draftPrompt: 'x', attachedSymbols: ['A', 1, 'B', 'x'.repeat(40), 'C', 'D'] }), ctx('2'));
    expect((mockBuildContexts.mock.calls.at(-1)?.[0] as { symbol: string }[]).map((r) => r.symbol)).toEqual(['A', 'B', 'C']);
  });
});
