/**
 * T-174 N1 — 두 route 가 cleanDraftPrompt 에 허용 심볼(인식 + 명시 첨부)을 넘기는지, 사용자 body.draftPrompt 는 손대지 않는지.
 * 모의 구성은 chat-routes-t169 와 같다.
 */
import { NextRequest } from 'next/server';

const mockAuth = jest.fn();
const mockQuery = jest.fn();
const mockGetConnection = jest.fn();
const mockLlm = jest.fn();
jest.mock('@/lib/auth/current-user', () => ({ requireUserId: (...a: unknown[]) => mockAuth(...a) }));
jest.mock('@/lib/auth/users', () => ({ findUserById: async () => ({ id: 7 }) }));
jest.mock('@/lib/db', () => ({ getPool: () => ({ query: mockQuery, getConnection: mockGetConnection }) }));
jest.mock('@/lib/llm/provider', () => ({
  runLlm: (...a: unknown[]) => mockLlm(...a),
  getActiveProvider: async () => 'hybrid',
  getProviderConfig: async () => ({ provider: 'hybrid', homeM4ApiModel: 'qwen-home', stage1Model: 'qwen-stage1' }),
}));
jest.mock('@/lib/chat/symbol-resolver', () => ({
  resolveSymbolsInText: async () => [{ symbol: 'NAS:NVDA', name: '엔비디아', matchedText: '엔비디아' }],
}));
jest.mock('@/lib/chat/context-builder', () => ({
  buildSymbolContexts: async (m: { symbol: string }[]) => m.map((x) => ({ symbol: x.symbol, name: x.symbol })),
  formatSymbolContextsAsText: () => '',
}));
jest.mock('@/lib/strategy/style', () => ({
  ANALYST_STYLE_LABEL: 'aggressive',
  getStyleConfig: async () => ({ holdingPeriodDays: { min: 1, max: 10 }, targetProfitPct: 2.5 }),
}));
jest.mock('@/lib/chat/overview-context', () => ({ buildOverviewContext: async () => ({ text: '', sections: [] }) }));

const messages = require('@/app/api/chat/threads/[id]/messages/route') as typeof import('@/app/api/chat/threads/[id]/messages/route');
const draft = require('@/app/api/chat/threads/[id]/draft/route') as typeof import('@/app/api/chat/threads/[id]/draft/route');

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (body: object) => new NextRequest('http://localhost/api/chat/threads/2/messages', {
  method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
});
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
const INVENTED = 'NVIDIA (NVIDIA, 210140) 분석해 주세요 NAS:NVDA';

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.mockResolvedValue({ ok: true, userId: 7 });
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('T-174 N1 route 연결', () => {
  test('draft POST — 지어낸 코드는 지우고 인식·첨부 심볼은 보존', async () => {
    mockQuery.mockResolvedValueOnce([[{ id: 2 }], []]).mockResolvedValueOnce([[], []]).mockResolvedValueOnce([[{ id: 2 }], []]);
    mockLlm.mockResolvedValue(`${INVENTED} 와 NAS:AAPL`);
    const body = await (await draft.POST(req({ content: '엔비디아 어때?', attachedSymbols: ['NAS:AAPL'] }), ctx('2'))).json();
    expect(body.draftPrompt).toBe('NVIDIA (NVIDIA) 분석해 주세요 NAS:NVDA 와 NAS:AAPL');
  });

  test('messages POST 즉석 drafter — 같은 정리, 저장되는 draft_prompt 에 반영', async () => {
    mockQuery.mockResolvedValueOnce([[{ id: 2 }], []]).mockResolvedValueOnce([[], []]);
    const c = conn();
    mockGetConnection.mockResolvedValue(c);
    mockLlm.mockResolvedValueOnce(INVENTED).mockResolvedValueOnce('답');
    await messages.POST(req({ content: '엔비디아 어때?', skipDraftStage: true }), ctx('2'));
    const params = c.query.mock.calls[1][1] as unknown[];
    expect(params[2]).toBe('NVIDIA (NVIDIA) 분석해 주세요 NAS:NVDA');
  });

  test('messages POST — 사용자가 보낸 draftPrompt 는 손대지 않음', async () => {
    mockQuery.mockResolvedValueOnce([[{ id: 2 }], []]).mockResolvedValueOnce([[], []]);
    const c = conn();
    mockGetConnection.mockResolvedValue(c);
    mockLlm.mockResolvedValueOnce('답');
    await messages.POST(req({ content: '엔비디아 어때?', draftPrompt: '내가 쓴 글 210140' }), ctx('2'));
    expect(mockLlm).toHaveBeenCalledTimes(1);
    expect((c.query.mock.calls[1][1] as unknown[])[2]).toBe('내가 쓴 글 210140');
  });

  test('최근 대화(historyRows)에 있는 식별자는 두 route 모두 허용', async () => {
    const hist = [{ role: 'assistant', content: '삼성전자(005930) 흐름' }];
    mockQuery.mockResolvedValueOnce([[{ id: 2 }], []]).mockResolvedValueOnce([hist, []]).mockResolvedValueOnce([[{ id: 2 }], []]);
    mockLlm.mockResolvedValue('삼성전자(005930) 와 NVIDIA(210140) 비교');
    const body = await (await draft.POST(req({ content: '그거 비교' }), ctx('2'))).json();
    expect(body.draftPrompt).toBe('삼성전자(005930) 와 NVIDIA 비교');

    jest.clearAllMocks();
    mockAuth.mockResolvedValue({ ok: true, userId: 7 });
    mockQuery.mockResolvedValueOnce([[{ id: 2 }], []]).mockResolvedValueOnce([hist, []]);
    const c = conn();
    mockGetConnection.mockResolvedValue(c);
    mockLlm.mockResolvedValueOnce('삼성전자(005930) 와 NVIDIA(210140) 비교').mockResolvedValueOnce('답');
    await messages.POST(req({ content: '그거 비교', skipDraftStage: true }), ctx('2'));
    expect((c.query.mock.calls[1][1] as unknown[])[2]).toBe('삼성전자(005930) 와 NVIDIA 비교');
  });
});
