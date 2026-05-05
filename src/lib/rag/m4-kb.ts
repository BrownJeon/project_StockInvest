/**
 * M4 home-m4-api `/v1/kb/*` 클라이언트 (Phase AB).
 *
 * 인터페이스:
 *   - upsert(collection, items): X-API-Key 인증, 1회 max 200건
 *   - search(collection, query, opts?): X-API-Key, 서버측 자동 임베딩
 *   - ensureCollection(name, model?): X-Admin-Token 인증, 1회성 collection 생성
 *
 * 임베딩 흐름: client는 텍스트만 전송. 서버측에서 ollama_client.embeddings() 호출.
 *
 * 실패 정책: 모든 메서드는 throw 가능. 호출자(retrieval.ts)가 try/catch로 fallback 처리.
 */

const DEFAULT_TIMEOUT_MS = 10_000;
/** upsert 전용 — bge-m3 200건 임베딩에 시간 걸림 */
const UPSERT_TIMEOUT_MS = 120_000;
const MAX_UPSERT_ITEMS = 200;

export interface KbHit {
  id: string;
  score: number;
  text: string;
  metadata: Record<string, unknown>;
}

export interface KbUpsertItem {
  id?: string;
  text: string;
  metadata?: Record<string, unknown>;
}

export interface KbSearchOptions {
  topK?: number;
  filter?: Record<string, unknown>;
  timeoutMs?: number;
}

export class M4KbClient {
  constructor(
    private readonly base: string,
    private readonly apiKey: string,
    private readonly adminToken?: string,
  ) {}

  /** Upsert items (server-side auto-embedding). 1회 max 200건. */
  async upsert(collection: string, items: KbUpsertItem[]): Promise<{ upserted: number; ids: string[] }> {
    if (!this.apiKey) throw new Error('AI_API_KEY not configured');
    if (items.length === 0) return { upserted: 0, ids: [] };
    if (items.length > MAX_UPSERT_ITEMS) {
      throw new Error(`upsert batch exceeds ${MAX_UPSERT_ITEMS} items (got ${items.length})`);
    }

    const url = `${this.base}/v1/kb/${encodeURIComponent(collection)}/upsert`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), UPSERT_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': this.apiKey },
        body: JSON.stringify({ items }),
        signal: ctrl.signal,
        cache: 'no-store',
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`KB upsert HTTP ${res.status}: ${body.slice(0, 200)}`);
      }
      return (await res.json()) as { upserted: number; ids: string[] };
    } finally {
      clearTimeout(timer);
    }
  }

  /** Search collection. 서버측 자동 query 임베딩. */
  async search(collection: string, query: string, opts: KbSearchOptions = {}): Promise<KbHit[]> {
    if (!this.apiKey) throw new Error('AI_API_KEY not configured');
    if (!query.trim()) return [];

    const url = `${this.base}/v1/kb/${encodeURIComponent(collection)}/search`;
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const body: Record<string, unknown> = { query };
      if (opts.topK != null) body.top_k = opts.topK;
      if (opts.filter) body.filter = opts.filter;

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': this.apiKey },
        body: JSON.stringify(body),
        signal: ctrl.signal,
        cache: 'no-store',
      });
      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        throw new Error(`KB search HTTP ${res.status}: ${errBody.slice(0, 200)}`);
      }
      const data = (await res.json()) as { hits?: KbHit[] };
      return data.hits ?? [];
    } finally {
      clearTimeout(timer);
    }
  }

  /** Collection이 없으면 생성 (X-Admin-Token). 이미 존재하면 무동작. */
  async ensureCollection(name: string, model = 'bge-m3'): Promise<void> {
    if (!this.adminToken) throw new Error('X-Admin-Token not configured');
    const url = `${this.base}/v1/kb/collections`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), DEFAULT_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Token': this.adminToken },
        body: JSON.stringify({ name, model }),
        signal: ctrl.signal,
        cache: 'no-store',
      });
      // 200 OK 또는 409 Conflict(이미 존재) 모두 성공
      if (!res.ok && res.status !== 409) {
        const body = await res.text().catch(() => '');
        // 일부 구현에선 400 + "already exists" 반환 — 멱등 처리
        if (/already exists|exists/i.test(body)) return;
        throw new Error(`ensureCollection HTTP ${res.status}: ${body.slice(0, 200)}`);
      }
    } finally {
      clearTimeout(timer);
    }
  }
}

let _cachedClient: M4KbClient | null = null;

/**
 * 환경변수·credentials에서 base+key 조회해 싱글톤 client 반환.
 * AI_API_BASE / AI_API_KEY / ADMIN_TOKEN env (또는 system_config에 저장된 값).
 */
export async function getKbClient(): Promise<M4KbClient> {
  if (_cachedClient) return _cachedClient;
  const base = process.env.AI_API_BASE ?? 'http://192.168.219.163:8000';
  const apiKey = process.env.AI_API_KEY ?? '';
  const adminToken = process.env.M4_ADMIN_TOKEN ?? process.env.ADMIN_TOKEN ?? '';
  _cachedClient = new M4KbClient(base, apiKey, adminToken);
  return _cachedClient;
}

/** 테스트용 캐시 리셋. */
export function _resetKbClientCache(): void {
  _cachedClient = null;
}
