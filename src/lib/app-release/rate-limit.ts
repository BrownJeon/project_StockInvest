/**
 * T-084 — 공개 다운로드 경로용 단순 고정 창 요청 제한(프로세스 메모리).
 *
 * 한계(의도적으로 단순하게 둔다):
 *  - **프로세스마다 따로 센다.** pm2 `stockinvest` 는 instances:1 이라 지금은 하나지만, 늘리면 한도가 인스턴스 수만큼 늘어난다.
 *  - **재시작·배포(blue/green 전환) 때 초기화된다.**
 *  - 고정 창이라 창 경계에서 최대 2배까지 몰릴 수 있다.
 *  - IP 키는 `clientIpKey`(x-real-ip → x-forwarded-for 마지막) 를 쓴다. 헤더 없이 :3003 직결이면 전부 'unknown' 한 버킷.
 *  - 키 수가 `maxKeys` 를 넘으면 만료된 키를 지우고, 그래도 넘으면 전부 비운다(메모리 상한 우선 — 그 순간만 제한이 느슨해진다).
 * 더 강한 제한이 필요하면 nginx `limit_req` 로 올린다(HOME-SERVER 영역).
 */
export interface FixedWindowLimiter {
  /** 1회 요청을 센다. 한도 안이면 ok:true, 넘으면 다음 창까지 남은 초. */
  hit(key: string, now?: number): { ok: true } | { ok: false; retryAfterSec: number };
  /** 시험용. */
  reset(): void;
  /** 시험용. */
  size(): number;
}

export function createFixedWindowLimiter(opts: { limit: number; windowMs: number; maxKeys?: number }): FixedWindowLimiter {
  const { limit, windowMs } = opts;
  const maxKeys = opts.maxKeys ?? 10_000;
  const buckets = new Map<string, { start: number; count: number }>();

  function prune(now: number): void {
    for (const [k, b] of buckets) if (now - b.start >= windowMs) buckets.delete(k);
    if (buckets.size >= maxKeys) buckets.clear();
  }

  return {
    hit(key: string, now: number = Date.now()) {
      let b = buckets.get(key);
      if (!b || now - b.start >= windowMs) {
        if (!b && buckets.size >= maxKeys) prune(now);
        b = { start: now, count: 0 };
        buckets.set(key, b);
      }
      b.count += 1;
      if (b.count > limit) {
        return { ok: false as const, retryAfterSec: Math.max(1, Math.ceil((b.start + windowMs - now) / 1000)) };
      }
      return { ok: true as const };
    },
    reset() {
      buckets.clear();
    },
    size() {
      return buckets.size;
    },
  };
}
