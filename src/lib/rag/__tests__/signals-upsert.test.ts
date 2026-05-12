/**
 * D-3 회귀 — signals-upsert.ts ensureCollection lazy-init 검증.
 *
 * 보장 사항:
 *   1. 첫 upsertSignal 호출 시 ensureCollection 1회만 실행
 *   2. 두 번째 호출에는 ensureCollection skip
 *   3. _resetEnsureCollectionCache 후 다시 1회 실행
 *   4. 환경변수 M4_DEFAULT_EMBED_MODEL 우선 적용 (없으면 'bge-m3')
 *   5. ensureCollection 실패 시 cache 되지 않음 (다음 호출에서 재시도)
 */
import {
  upsertSignal,
  upsertSignalsBatch,
  _resetEnsureCollectionCache,
  SIGNALS_COLLECTION,
} from '../signals-upsert';
import * as kbModule from '../m4-kb';

jest.mock('@/lib/db', () => ({ getPool: jest.fn() }));
jest.mock('@/lib/credentials', () => ({ getCredential: jest.fn() }));

describe('signals-upsert ensureCollection lazy-init', () => {
  let ensureMock: jest.SpyInstance;
  let upsertMock: jest.SpyInstance;

  beforeEach(() => {
    kbModule._resetKbClientCache();
    _resetEnsureCollectionCache();
    process.env.AI_API_BASE = 'http://m4api.local:8000';
    process.env.AI_API_KEY = 'test-key';
    process.env.M4_ADMIN_TOKEN = 'admin-token';
    delete process.env.M4_DEFAULT_EMBED_MODEL;

    ensureMock = jest.spyOn(kbModule.M4KbClient.prototype, 'ensureCollection')
      .mockResolvedValue(undefined);
    upsertMock = jest.spyOn(kbModule.M4KbClient.prototype, 'upsert')
      .mockResolvedValue({ upserted: 1, ids: ['x'] });
  });

  afterEach(() => {
    ensureMock.mockRestore();
    upsertMock.mockRestore();
    kbModule._resetKbClientCache();
    _resetEnsureCollectionCache();
  });

  const sampleSignal = {
    id: 12345,
    symbol: '005930',
    side: 'buy' as const,
    price: 70000,
    createdAt: '2026-05-07T10:00:00Z',
  };

  test('D-3: 첫 upsertSignal → ensureCollection 1회 호출', async () => {
    await upsertSignal(sampleSignal);
    expect(ensureMock).toHaveBeenCalledTimes(1);
    expect(ensureMock).toHaveBeenCalledWith(SIGNALS_COLLECTION, 'bge-m3');
    expect(upsertMock).toHaveBeenCalledTimes(1);
  });

  test('D-3: 두 번째 upsertSignal → ensureCollection skip', async () => {
    await upsertSignal(sampleSignal);
    await upsertSignal({ ...sampleSignal, id: 12346 });
    expect(ensureMock).toHaveBeenCalledTimes(1);     // 1회만
    expect(upsertMock).toHaveBeenCalledTimes(2);     // upsert 는 매번
  });

  test('D-3: _resetEnsureCollectionCache 후 다시 1회 호출', async () => {
    await upsertSignal(sampleSignal);
    _resetEnsureCollectionCache();
    await upsertSignal(sampleSignal);
    expect(ensureMock).toHaveBeenCalledTimes(2);
  });

  test('D-3: M4_DEFAULT_EMBED_MODEL env 우선 적용', async () => {
    process.env.M4_DEFAULT_EMBED_MODEL = 'snowflake-arctic-embed2';
    await upsertSignal(sampleSignal);
    expect(ensureMock).toHaveBeenCalledWith(SIGNALS_COLLECTION, 'snowflake-arctic-embed2');
  });

  // D-8: m4-kb.ts 자체 ensureCollection default — model 미지정 시 env 우선
  // ensureMock 을 일시 해제하고 fetch 만 spy 해서 실 메서드의 model 처리 로직 검증
  test('D-8: ensureCollection model 미지정 시 env(M4_DEFAULT_EMBED_MODEL) 적용', async () => {
    ensureMock.mockRestore();   // 진짜 메서드로 복원
    process.env.M4_DEFAULT_EMBED_MODEL = 'paraphrase-multilingual';
    const client = await kbModule.getKbClient();
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(null, { status: 200 }) as any
    );
    await client.ensureCollection('test.col');   // model 미지정
    const callBody = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(callBody.model).toBe('paraphrase-multilingual');
    fetchSpy.mockRestore();
  });

  test('D-8: ensureCollection model·env 모두 미지정 시 bge-m3 default', async () => {
    ensureMock.mockRestore();
    delete process.env.M4_DEFAULT_EMBED_MODEL;
    const client = await kbModule.getKbClient();
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(null, { status: 200 }) as any
    );
    await client.ensureCollection('test.col');
    const callBody = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(callBody.model).toBe('bge-m3');
    fetchSpy.mockRestore();
  });

  test('D-3: upsertSignalsBatch 도 ensureCollection 보장', async () => {
    await upsertSignalsBatch([sampleSignal, { ...sampleSignal, id: 2 }]);
    expect(ensureMock).toHaveBeenCalledTimes(1);
    expect(upsertMock).toHaveBeenCalledTimes(1);     // batch 는 1회 호출로 묶임
    expect(upsertMock.mock.calls[0][1]).toHaveLength(2);
  });

  test('D-3: ensureCollection 실패 시 cache 미적용 (다음 호출에서 재시도)', async () => {
    ensureMock.mockRejectedValueOnce(new Error('qdrant down'));
    // 첫 호출은 실패해도 throw 만 하고 cache 안 됨
    await expect(upsertSignal(sampleSignal)).rejects.toThrow('qdrant down');

    // 두 번째 호출 시 다시 시도 (이번엔 mock 이 success 로 돌아옴)
    await upsertSignal(sampleSignal);
    expect(ensureMock).toHaveBeenCalledTimes(2);
  });
});
