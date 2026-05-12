/**
 * Signal RAG 인덱싱 헬퍼 (Phase AB).
 *
 * createSignal 성공 후 fire-and-forget로 호출 → Qdrant에 upsert.
 * signal-followup cron에서 hit_x/pnl_x 라벨 갱신 시에도 동일 ID로 재upsert (server-side deterministic UUID).
 *
 * 실패는 throw 하지 않음 — RAG는 보조적이라 main flow를 차단하지 않음.
 */
import { getKbClient } from './m4-kb';
import { buildSignalText, buildSignalMetadata, type SignalForEmbedding } from './format';

const COLLECTION_NAME = 'signals.stockinvest';

/**
 * D-3: collection 자동 보장 (lazy, idempotent).
 * 첫 upsert 호출 시 ensureCollection 1회만 실행 — 이후엔 noop.
 * 신규 환경에서 백필 라우트 미실행 시에도 첫 시그널이 404 로 떨어지는 사고 방지.
 *
 * 실패 시 재시도 가능하도록 promise 자체를 캐시하지 않고, success flag 만 캐시.
 * (실패 → 다음 호출 때 다시 시도. 성공 → 영구 skip)
 */
let _collectionEnsured = false;

async function ensureCollectionOnce(): Promise<void> {
  if (_collectionEnsured) return;
  const client = await getKbClient();
  // M4_DEFAULT_EMBED_MODEL 우선, 미설정 시 bge-m3 (한국어 RAG default)
  const model = process.env.M4_DEFAULT_EMBED_MODEL || 'bge-m3';
  await client.ensureCollection(COLLECTION_NAME, model);
  _collectionEnsured = true;
}

/** 테스트용 — 캐시 리셋 */
export function _resetEnsureCollectionCache(): void {
  _collectionEnsured = false;
}

/**
 * 정수 signal_id → 유효 UUID 형식 (Qdrant point id 요구사항).
 * 형식: 00000000-0000-5000-8000-{12-hex(id)}
 * 1:1 결정적 매핑이라 동일 id는 항상 동일 UUID — 재upsert 시 기존 벡터 갱신.
 */
function signalIdToUuid(id: number | string): string {
  const n = typeof id === 'number' ? id : parseInt(String(id), 10);
  if (!Number.isFinite(n) || n < 0) throw new Error(`invalid signal id: ${id}`);
  const hex = n.toString(16).padStart(12, '0').slice(-12);
  return `00000000-0000-5000-8000-${hex}`;
}

/** 단일 시그널 비동기 upsert (fire-and-forget). 에러는 로깅만. */
export function fireAndForgetUpsertSignal(s: SignalForEmbedding & { id?: number | string }): void {
  // 다음 microtask에 실행 — main response 차단 없음
  queueMicrotask(async () => {
    try {
      await upsertSignal(s);
    } catch (e) {
      console.warn(`[rag-upsert] signal upsert failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  });
}

export async function upsertSignal(s: SignalForEmbedding & { id?: number | string }): Promise<void> {
  await ensureCollectionOnce();   // D-3: 신규 환경 첫 호출 404 방지
  const client = await getKbClient();
  const text = buildSignalText(s);
  const metadata = buildSignalMetadata(s);
  // id 명시 시 안정적 갱신 (UUID 형식). 미명시 시 server측 sha256(text) 기반 UUID
  const upsertId = s.id != null ? signalIdToUuid(s.id) : undefined;
  await client.upsert(COLLECTION_NAME, [{ id: upsertId, text, metadata }]);
}

/** 배치 upsert — 백필용. 1회 max 200건. */
export async function upsertSignalsBatch(signals: (SignalForEmbedding & { id?: number | string })[]): Promise<{ upserted: number }> {
  await ensureCollectionOnce();   // D-3: 백필 시점에도 컬렉션 보장
  const client = await getKbClient();
  const items = signals.map(s => ({
    id: s.id != null ? signalIdToUuid(s.id) : undefined,
    text: buildSignalText(s),
    metadata: buildSignalMetadata(s),
  }));
  const res = await client.upsert(COLLECTION_NAME, items);
  return { upserted: res.upserted };
}

export const SIGNALS_COLLECTION = COLLECTION_NAME;
