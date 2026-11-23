import { runStockChat } from '../model';

const mockCall = jest.fn<Promise<string>, unknown[]>().mockResolvedValue('완료');
const mockCaller = jest.fn<unknown, unknown[]>().mockImplementation(() => ({ call: mockCall }));
jest.mock('@/lib/llm/home-m4-api', () => ({
  HomeM4ApiCaller: function (...args: unknown[]) { return mockCaller(...args); },
}));
jest.mock('@/lib/llm/provider', () => ({ getHomeM4ApiBase: async () => 'http://fixture.local/' }));

test.each([
  ['draft', true, false, 60000, 2048],
  ['answer', false, false, 120000, 2048],
  ['answer', true, true, 180000, 6144],
] as const)('챗봇 %s의 모델과 모드, 제한을 요청 단위로 고정한다', async (stage, complex, think, timeoutMs, outputTokens) => {
  await expect(runStockChat({ system: '지침', user: '질문' }, stage, complex)).resolves.toBe('완료');
  expect(mockCaller).toHaveBeenLastCalledWith('http://fixture.local', expect.any(String), 'gemma4:12b', 0.3);
  expect(mockCall).toHaveBeenLastCalledWith('질문', { timeoutMs, responseFormat: 'text' }, {
    system: '지침', think, contextTokens: 8192, outputTokens,
  });
});
