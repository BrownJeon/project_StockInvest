/** T-113: route handlers with stubbed pool and LLM; no live database or model. */
import { NextRequest, NextResponse } from 'next/server';

const mockAuth = jest.fn();
const mockFindUser = jest.fn();
const mockQuery = jest.fn();
const mockGetConnection = jest.fn();
const mockLlm = jest.fn();
const mockSymbols = jest.fn();
const mockContexts = jest.fn();
jest.mock('@/lib/auth/current-user', () => ({ requireUserId: (...a: unknown[]) => mockAuth(...a) }));
jest.mock('@/lib/auth/users', () => ({ findUserById: (...a: unknown[]) => mockFindUser(...a) }));
jest.mock('@/lib/db', () => ({ getPool: () => ({ query: mockQuery, getConnection: mockGetConnection }) }));
jest.mock('@/lib/llm/provider', () => ({
  runLlm: (...a: unknown[]) => mockLlm(...a),
  getActiveProvider: async () => 'claude', getProviderConfig: async () => ({}),
}));
jest.mock('@/lib/chat/symbol-resolver', () => ({ resolveSymbolsInText: (...a: unknown[]) => mockSymbols(...a) }));
jest.mock('@/lib/chat/context-builder', () => ({
  buildSymbolContexts: (...a: unknown[]) => mockContexts(...a), formatSymbolContextsAsText: () => '',
}));
jest.mock('@/lib/strategy/style', () => ({ ANALYST_STYLE_LABEL: 'test', getStyleConfig: async () => ({}) }));
jest.mock('@/lib/chat/system-prompt', () => ({
  buildAnalystSystemPrompt: () => '', buildAnalystUserMessage: () => '',
  buildDrafterSystemPrompt: () => '', buildDrafterUserMessage: () => '',
}));

const threads = require('@/app/api/chat/threads/route') as typeof import('@/app/api/chat/threads/route');
const thread = require('@/app/api/chat/threads/[id]/route') as typeof import('@/app/api/chat/threads/[id]/route');
const messages = require('@/app/api/chat/threads/[id]/messages/route') as typeof import('@/app/api/chat/threads/[id]/messages/route');
const draft = require('@/app/api/chat/threads/[id]/draft/route') as typeof import('@/app/api/chat/threads/[id]/draft/route');
const models = require('@/app/api/chat/models/route') as typeof import('@/app/api/chat/models/route');
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (method = 'GET', body?: object) => new NextRequest('http://localhost/api/chat/threads', {
  method, ...(body ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}),
});

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.mockResolvedValue({ ok: true, userId: 7 });
  mockFindUser.mockResolvedValue({ id: 7 });
  mockSymbols.mockResolvedValue([]);
  mockContexts.mockResolvedValue([]);
  mockLlm.mockResolvedValue('모의 답변');
});

test('missing authentication returns 401 before any database or provider use', async () => {
  mockAuth.mockResolvedValue({ ok: false, res: NextResponse.json({ ok: false }, { status: 401 }) });
  for (const action of [
    () => threads.GET(req()), () => threads.POST(req('POST', {})),
    () => thread.PATCH(req('PATCH', { title: 'x' }), ctx('1')),
    () => thread.DELETE(req('DELETE'), ctx('1')),
    () => messages.GET(req(), ctx('1')), () => messages.POST(req('POST', { content: 'x' }), ctx('1')),
    () => draft.POST(req('POST', { content: 'x' }), ctx('1')), () => models.GET(req()),
  ]) expect((await action()).status).toBe(401);
  expect(mockQuery).not.toHaveBeenCalled();
  expect(mockLlm).not.toHaveBeenCalled();
});

test('list and creation use verified session owner, ignoring body user_id', async () => {
  mockQuery.mockResolvedValueOnce([[], []]);
  const conn = { beginTransaction: jest.fn(), query: jest.fn().mockResolvedValue([{ insertId: 23, affectedRows: 1 }, []]),
    rollback: jest.fn(), commit: jest.fn(), release: jest.fn() };
  mockGetConnection.mockResolvedValue(conn);
  expect((await threads.GET(req())).status).toBe(200);
  const [sql, args] = mockQuery.mock.calls[0];
  expect(sql).toMatch(/user_id\s*=\s*\?/);
  expect(args).toEqual([0, 7]);
  expect((await threads.POST(req('POST', { title: 'x', user_id: 99 }))).status).toBe(200);
  expect(conn.query.mock.calls[0][0]).toMatch(/user_id/);
  expect(conn.query.mock.calls[0][1]).toEqual(['x', null, 7]);
  expect(conn.commit).toHaveBeenCalledTimes(1);
});

test.each(['0', '-1', '1.1', '1e2', '9007199254740992'])('rejects unsafe thread ID %s', async id => {
  expect((await messages.GET(req(), ctx(id))).status).toBe(400);
  expect(mockQuery).not.toHaveBeenCalled();
});

test('non-owned and unassigned thread cannot read, mutate, invoke draft or send messages', async () => {
  mockQuery.mockResolvedValue([[], []]);
  expect((await messages.GET(req(), ctx('2'))).status).toBe(404);
  expect((await draft.POST(req('POST', { content: 'hello' }), ctx('2'))).status).toBe(404);
  expect((await messages.POST(req('POST', { content: 'hello' }), ctx('2'))).status).toBe(404);
  expect(mockQuery.mock.calls.every(([sql, values]) => /user_id\s*=\s*\?/.test(sql) && values.includes(7))).toBe(true);
  expect(mockLlm).not.toHaveBeenCalled();
  expect(mockSymbols).not.toHaveBeenCalled();
  mockQuery.mockResolvedValue([{ affectedRows: 0 }, []]);
  expect((await thread.PATCH(req('PATCH', { title: 'new' }), ctx('2'))).status).toBe(404);
  expect((await thread.DELETE(req('DELETE'), ctx('2'))).status).toBe(404);
  expect(mockQuery.mock.calls.slice(-2).every(([sql, values]) => /user_id\s*=\s*\?/.test(sql) && values.includes(7))).toBe(true);
});

test('message history query is scoped to the same session user', async () => {
  mockQuery.mockResolvedValueOnce([[{ id: 2 }], []]).mockResolvedValueOnce([[], []]);
  expect((await messages.GET(req(), ctx('2'))).status).toBe(200);
  expect(mockQuery.mock.calls[1][0]).toMatch(/t\.user_id\s*=\s*\?/);
  expect(mockQuery.mock.calls[1][1]).toEqual([2, 7]);
});

test('ownership revoked while LLM runs rolls back and saves no messages', async () => {
  mockQuery.mockResolvedValueOnce([[{ id: 2 }], []]).mockResolvedValueOnce([[], []]);
  const conn = { beginTransaction: jest.fn(), query: jest.fn().mockResolvedValue([[], []]),
    rollback: jest.fn(), commit: jest.fn(), release: jest.fn() };
  mockGetConnection.mockResolvedValue(conn);
  const res = await messages.POST(req('POST', { content: 'hello', draftPrompt: 'x' }), ctx('2'));
  expect(res.status).toBe(404);
  expect(mockLlm).toHaveBeenCalledTimes(1);
  expect(conn.query).toHaveBeenCalledTimes(1);
  expect(conn.query.mock.calls[0][0]).toMatch(/user_id\s*=\s*\?\s+FOR UPDATE/);
  expect(conn.query.mock.calls[0][1]).toEqual([2, 7]);
  expect(conn.rollback).toHaveBeenCalledTimes(1);
  expect(conn.commit).not.toHaveBeenCalled();
  expect(conn.release).toHaveBeenCalledTimes(1);
});

test('partial message insert failure rolls back transaction', async () => {
  mockQuery.mockResolvedValueOnce([[{ id: 2 }], []]).mockResolvedValueOnce([[], []]);
  const conn = { beginTransaction: jest.fn(), query: jest.fn()
    .mockResolvedValueOnce([[{ id: 2, title: '새 대화' }], []])
    .mockResolvedValueOnce([{ insertId: 10 }, []])
    .mockRejectedValueOnce(new Error('insert failure')),
    rollback: jest.fn(), commit: jest.fn(), release: jest.fn() };
  mockGetConnection.mockResolvedValue(conn);
  await expect(messages.POST(req('POST', { content: 'hello', draftPrompt: 'x' }), ctx('2'))).rejects.toThrow('insert failure');
  expect(conn.rollback).toHaveBeenCalledTimes(1);
  expect(conn.commit).not.toHaveBeenCalled();
  expect(conn.release).toHaveBeenCalledTimes(1);
});

test('successful reply is saved atomically after the LLM, under owner row lock', async () => {
  const order: string[] = [];
  mockQuery.mockResolvedValueOnce([[{ id: 2 }], []]).mockResolvedValueOnce([[], []]);
  mockLlm.mockImplementation(async () => { order.push('llm'); return 'answer'; });
  const conn = {
    beginTransaction: jest.fn(async () => { order.push('begin'); }),
    query: jest.fn().mockResolvedValueOnce([[{ id: 2, title: '새 대화' }], []])
      .mockResolvedValueOnce([{ insertId: 10 }, []]).mockResolvedValueOnce([{ insertId: 11 }, []])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []]),
    rollback: jest.fn(), commit: jest.fn(async () => { order.push('commit'); }), release: jest.fn(),
  };
  mockGetConnection.mockResolvedValue(conn);
  const res = await messages.POST(req('POST', { content: 'hello', draftPrompt: 'x' }), ctx('2'));
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ userMessageId: 10, assistantMessageId: 11, response: 'answer' });
  expect(order).toEqual(['llm', 'begin', 'commit']);
  expect(conn.query.mock.calls[0][1]).toEqual([2, 7]);
  expect(conn.query.mock.calls[3][1]).toEqual(['hello', 2, 7]);
  expect(conn.rollback).not.toHaveBeenCalled();
  expect(conn.release).toHaveBeenCalledTimes(1);
});

test('draft response is withheld if owner changes during model execution', async () => {
  mockQuery.mockResolvedValueOnce([[{ id: 2 }], []])
    .mockResolvedValueOnce([[], []])
    .mockResolvedValueOnce([[], []]);
  const res = await draft.POST(req('POST', { content: 'hello' }), ctx('2'));
  expect(res.status).toBe(404);
  expect(mockLlm).toHaveBeenCalledTimes(1);
  expect(mockQuery.mock.calls[1][0]).toMatch(/t\.user_id\s*=\s*\?/);
  expect(mockQuery.mock.calls[2][1]).toEqual([2, 7]);
});

test('missing ownership schema does not fall back to unscoped queries', async () => {
  mockQuery.mockRejectedValueOnce(Object.assign(new Error('Unknown column user_id'), { code: 'ER_BAD_FIELD_ERROR' }));
  await expect(threads.GET(req())).rejects.toMatchObject({ code: 'ER_BAD_FIELD_ERROR' });
  expect(mockQuery).toHaveBeenCalledTimes(1);
  expect(mockQuery.mock.calls[0][0]).toMatch(/user_id\s*=\s*\?/);
});


test('unsafe thread BIGINT in list is rejected rather than rounded', async () => {
  mockQuery.mockResolvedValueOnce([[{ id: '9007199254740993' }], []]);
  expect((await threads.GET(req())).status).toBe(503);
});

test('unsafe newly assigned thread ID rolls back creation', async () => {
  const conn = { beginTransaction: jest.fn(), query: jest.fn().mockResolvedValue([{ insertId: '9007199254740993', affectedRows: 1 }, []]),
    rollback: jest.fn(), commit: jest.fn(), release: jest.fn() };
  mockGetConnection.mockResolvedValue(conn);
  expect((await threads.POST(req('POST', { title: 'test' }))).status).toBe(503);
  expect(conn.rollback).toHaveBeenCalledTimes(1);
  expect(conn.commit).not.toHaveBeenCalled();
  expect(conn.release).toHaveBeenCalledTimes(1);
});

test('unsafe message BIGINT in history is rejected rather than rounded', async () => {
  mockQuery.mockResolvedValueOnce([[{ id: 2 }], []])
    .mockResolvedValueOnce([[{ id: '9007199254740993' }], []]);
  expect((await messages.GET(req(), ctx('2'))).status).toBe(503);
});

test('unsafe new message ID rolls back both inserts and thread update', async () => {
  mockQuery.mockResolvedValueOnce([[{ id: 2 }], []]).mockResolvedValueOnce([[], []]);
  const conn = { beginTransaction: jest.fn(), query: jest.fn()
    .mockResolvedValueOnce([[{ id: 2, title: '새 대화' }], []])
    .mockResolvedValueOnce([{ insertId: 10 }, []])
    .mockResolvedValueOnce([{ insertId: '9007199254740993' }, []])
    .mockResolvedValueOnce([{ affectedRows: 1 }, []]),
    rollback: jest.fn(), commit: jest.fn(), release: jest.fn() };
  mockGetConnection.mockResolvedValue(conn);
  const res = await messages.POST(req('POST', { content: 'hello', draftPrompt: 'x' }), ctx('2'));
  expect(res.status).toBe(503);
  expect(conn.rollback).toHaveBeenCalledTimes(1);
  expect(conn.commit).not.toHaveBeenCalled();
  expect(conn.release).toHaveBeenCalledTimes(1);
});


test('deleted user with otherwise valid session cannot use any chat endpoint', async () => {
  mockFindUser.mockResolvedValue(null);
  for (const action of [
    () => threads.GET(req()), () => threads.POST(req('POST', {})),
    () => thread.PATCH(req('PATCH', { title: 'x' }), ctx('1')),
    () => thread.DELETE(req('DELETE'), ctx('1')),
    () => messages.GET(req(), ctx('1')), () => messages.POST(req('POST', { content: 'x' }), ctx('1')),
    () => draft.POST(req('POST', { content: 'x' }), ctx('1')), () => models.GET(req()),
  ]) expect((await action()).status).toBe(401);
  expect(mockQuery).not.toHaveBeenCalled();
  expect(mockLlm).not.toHaveBeenCalled();
});

test('user lookup DB failure does not fall back to chat or model calls', async () => {
  mockFindUser.mockRejectedValue(new Error('user store unavailable'));
  await expect(messages.GET(req(), ctx('2'))).rejects.toThrow('user store unavailable');
  expect(mockQuery).not.toHaveBeenCalled();
  expect(mockLlm).not.toHaveBeenCalled();
});

test('account deleted after session check cannot create a new thread', async () => {
  const conn = { beginTransaction: jest.fn(), query: jest.fn().mockResolvedValue([{ affectedRows: 0, insertId: 0 }, []]),
    rollback: jest.fn(), commit: jest.fn(), release: jest.fn() };
  mockGetConnection.mockResolvedValue(conn);
  expect((await threads.POST(req('POST', { title: 'x' }))).status).toBe(401);
  expect(conn.query.mock.calls[0][0]).toMatch(/SELECT.*FROM users/);
  expect(conn.rollback).toHaveBeenCalled();
  expect(conn.commit).not.toHaveBeenCalled();
});
