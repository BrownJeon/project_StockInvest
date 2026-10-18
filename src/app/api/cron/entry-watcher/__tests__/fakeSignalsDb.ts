/**
 * T-043 — entry-watcher 테스트용 **상태를 가진** 가짜 `signals` 테이블.
 *
 * 단순 목은 "UPDATE 가 불렸다"만 확인해서 경합(두 실행이 같은 행을 본다)을 재현하지 못한다. 이 가짜는 선점·복귀·기록
 * UPDATE 의 WHERE 조건을 실제처럼 평가해 행 상태를 바꾸고, 조회(SELECT)가 그 상태를 반영한다.
 * 이 파일은 `*.test.ts` 가 아니라 jest 가 테스트로 실행하지 않는다.
 */
export interface FakeSignal {
  id: number;
  status: string;
  consumed_order_id: number | null;
  expires_at: Date | null;
  /** 마지막 갱신(선점 시각) — 멈춘 executing 점검에 쓴다 */
  updated_at: Date;
  symbol: string;
  side: 'buy' | 'sell';
  order_type: 'limit' | 'market';
  price: string | null;
  quantity: string | null;
  amount_krw: string;
  indicators: string | null;
  reasoning: string | null;
  market: string | null;
}

const ZONE = { ai: { scenario: { entry: { price_zone: '1 ~ 99999999' } } } };

export function fakeSignal(id: number, over: Partial<FakeSignal> = {}): FakeSignal {
  return {
    id, status: 'approved_pending_entry', consumed_order_id: null, expires_at: null, updated_at: new Date(),
    symbol: '005930', side: 'buy', order_type: 'limit', price: '6540', quantity: null, amount_krw: '100000',
    indicators: JSON.stringify(ZONE), reasoning: null, market: 'domestic', ...over,
  };
}

export class FakeSignalsDb {
  rows = new Map<number, FakeSignal>();
  /** 실행 순서 기록: 'select' | 'claim:<id>:won|lost' | 'release:<id>:ok|noop' | 'record:<id>:<orderId>' | 'expire:<id>' */
  events: string[] = [];
  /** 이 정규식에 걸리는(공백 정규화된) SQL 은 던진다 — DB 장애 모사 */
  failOn: RegExp[] = [];
  /** 만료 판정에 쓰는 "DB 의 지금" */
  nowFn: () => Date = () => new Date();
  /** UPDATE 하나가 끝나기까지 걸리는 시간(ms). `await` 가 빠진 호출을 드러내려고 쓴다 */
  delayMs = 0;
  /** SELECT 가 돌려줄 스냅샷을 가로채고 싶을 때(경합 재현). 기본은 현재 상태 */
  selectHook?: (rows: FakeSignal[]) => FakeSignal[];

  add(sig: FakeSignal): void { this.rows.set(sig.id, sig); }
  statusOf(id: number): string | undefined { return this.rows.get(id)?.status; }
  orderOf(id: number): number | null | undefined { return this.rows.get(id)?.consumed_order_id; }

  /** `getPool()` 이 돌려줄 객체 */
  get pool(): { query: (sql: unknown, params?: unknown[]) => Promise<unknown> } {
    return { query: (sql, params) => this.handle(sql, params ?? []) };
  }

  private async handle(sqlArg: unknown, params: unknown[]): Promise<unknown> {
    const sql = String(sqlArg).replace(/\s+/g, ' ').trim();
    for (const f of this.failOn) if (f.test(sql)) throw new Error('db gone');
    if (this.delayMs > 0 && /^UPDATE/.test(sql)) await new Promise((r) => setTimeout(r, this.delayMs));

    // 선점: 주문 직전 (T-043)
    if (/^UPDATE signals SET status='executing', updated_at=NOW\(\) WHERE id=\? AND status='approved_pending_entry' AND \(expires_at IS NULL OR expires_at > NOW\(\)\)$/.test(sql)) {
      const id = Number(params[0]);
      const r = this.rows.get(id);
      const alive = r && r.status === 'approved_pending_entry' && (r.expires_at == null || r.expires_at.getTime() > this.nowFn().getTime());
      if (alive) { r!.status = 'executing'; r!.updated_at = this.nowFn(); }
      this.events.push(`claim:${id}:${alive ? 'won' : 'lost'}`);
      return [{ affectedRows: alive ? 1 : 0 }];
    }
    // 선점 복귀: 확정 거부·송신 전 예외
    if (/^UPDATE signals SET status='approved_pending_entry', updated_at=NOW\(\) WHERE id=\? AND status='executing' AND consumed_order_id IS NULL$/.test(sql)) {
      const id = Number(params[0]);
      const r = this.rows.get(id);
      const ok = !!r && r.status === 'executing' && r.consumed_order_id == null;
      if (ok) r!.status = 'approved_pending_entry';
      this.events.push(`release:${id}:${ok ? 'ok' : 'noop'}`);
      return [{ affectedRows: ok ? 1 : 0 }];
    }
    // 주문 번호 연결
    if (/^UPDATE signals SET consumed_order_id=\?, updated_at=NOW\(\) WHERE id=\? AND status='executing'$/.test(sql)) {
      const orderId = params[0] as number | null;
      const id = Number(params[1]);
      const r = this.rows.get(id);
      const ok = !!r && r.status === 'executing';
      if (ok) r!.consumed_order_id = orderId;
      this.events.push(`record:${id}:${orderId}`);
      return [{ affectedRows: ok ? 1 : 0 }];
    }
    // 만료 — SQL 에 있는 조건(상태 `AND status='approved_pending_entry'`, DB 시각 `AND expires_at IS NOT NULL AND expires_at <= NOW()`)을
    // 그대로 평가하고, 없는 조건은 평가하지 않는다(조건을 지운 변이가 행을 덮어쓰게 만들어 테스트가 잡도록).
    if (/^UPDATE signals SET status='expired', updated_at=NOW\(\) WHERE id=\?( AND status='approved_pending_entry')?( AND expires_at IS NOT NULL AND expires_at <= NOW\(\))?$/.test(sql)) {
      const id = Number(params[0]);
      const r = this.rows.get(id);
      const statusGuard = /AND status='approved_pending_entry'/.test(sql);
      const timeGuard = /AND expires_at <= NOW\(\)$/.test(sql);
      const ok = !!r
        && (!statusGuard || r.status === 'approved_pending_entry')
        && (!timeGuard || (r.expires_at != null && r.expires_at.getTime() <= this.nowFn().getTime()));
      if (ok) r!.status = 'expired';
      this.events.push(`${ok ? 'expire' : 'expire-noop'}:${id}`);
      return [{ affectedRows: ok ? 1 : 0 }];
    }
    // 분할 진입 게이트: 같은 group 의 이전 회차 중 approved_pending_entry 가 있는가
    if (/^SELECT id, status FROM signals WHERE JSON_EXTRACT\(indicators, '\$\.split\.group_id'\) = \? AND JSON_EXTRACT\(indicators, '\$\.split\.index'\) < \? AND status = 'approved_pending_entry'$/.test(sql)) {
      const [groupId, index] = params as [string, number];
      const prior = [...this.rows.values()].filter((r) => {
        if (r.status !== 'approved_pending_entry' || !r.indicators) return false;
        const sp = (JSON.parse(r.indicators) as { split?: { group_id?: string; index?: number } }).split;
        return !!sp && sp.group_id === groupId && Number(sp.index) < Number(index);
      }).map((r) => ({ id: r.id, status: r.status }));
      return [prior];
    }
    // 멈춘 executing 점검 (T-046 C): executing + 주문 번호 없음 + 마지막 갱신이 N분보다 오래됨
    if (/^SELECT id, symbol, side, updated_at FROM signals WHERE status='executing' AND consumed_order_id IS NULL AND updated_at < NOW\(\) - INTERVAL \? MINUTE ORDER BY id LIMIT \?$/.test(sql)) {
      const [minutes, limit] = params as [number, number];
      this.events.push('stuck-check');
      const cutoff = this.nowFn().getTime() - minutes * 60_000;
      const rows = [...this.rows.values()]
        .filter((r) => r.status === 'executing' && r.consumed_order_id == null && r.updated_at.getTime() < cutoff)
        .sort((a, b) => a.id - b.id).slice(0, limit)
        .map((r) => ({ id: r.id, symbol: r.symbol, side: r.side, updated_at: r.updated_at }));
      return [rows];
    }
    // 조회
    if (/FROM signals WHERE status = 'approved_pending_entry'/.test(sql)) {
      this.events.push('select');
      const live = [...this.rows.values()].filter((r) => r.status === 'approved_pending_entry').map((r) => ({ ...r }));
      return [this.selectHook ? this.selectHook(live) : live];
    }
    // 그 밖의 UPDATE signals 는 예상 밖 — 테스트가 조용히 통과하지 않게 던진다
    if (/^UPDATE signals/.test(sql)) throw new Error(`예상하지 못한 signals UPDATE: ${sql}`);
    if (/INSERT INTO trade_logs/i.test(sql)) return [{ insertId: 1 }];
    return [[]];
  }
}
