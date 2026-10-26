/**
 * T-096 OOS 원장(§B-3·§C-1) — 추가 전용, 전략(×시장)당 OOS 1회. 순수 함수(파일 읽기·쓰기는 러너).
 *  - 실행 전에 잠금 줄(lock)을 먼저 추가하고 파일에 쓴 뒤에만 OOS 를 계산한다 → 계산 도중 죽어도 두 번째 실행은 거부된다.
 *  - 결과는 같은 줄의 result 에 **한 번만** 채운다(null → 값). 줄 삭제·순서 변경·다른 필드 수정은 verifyAppendOnly 가 거부한다.
 */

export interface LedgerEntry {
  strategyId: string;
  market: 'US' | 'KR';
  params: Record<string, number | boolean>;
  sectionBSha256: string;
  isReport: string;
  lockedAt: string;
  /** IS 와 같은 지문 4종(registry 정본·H_r·엔진·IS 구간 데이터·유니버스) — 러너가 기록(v1.1 H-3). */
  fingerprints?: Record<string, unknown>;
  result: Record<string, unknown> | null;
}

export interface Ledger {
  schema: string;
  section_b_sha256: string;
  note?: string;
  entries: LedgerEntry[];
}

export function validateLedger(l: Ledger, expectedHash: string): string[] {
  const err: string[] = [];
  if (!l || l.schema !== 't096-oos-ledger@1') err.push('schema');
  if (!l || l.section_b_sha256 !== expectedHash) err.push('section_b_sha256');
  if (!l || !Array.isArray(l.entries)) { err.push('entries'); return err; }
  const seen = new Set<string>();
  for (const e of l.entries) {
    const k = `${e.market}|${e.strategyId}`;
    if (seen.has(k)) err.push(`중복 ${k}`);
    seen.add(k);
    if (e.sectionBSha256 !== expectedHash) err.push(`해시 불일치 ${k}`);
  }
  return err;
}

export function hasOosRun(l: Ledger, strategyId: string, market: 'US' | 'KR'): boolean {
  return l.entries.some((e) => e.strategyId === strategyId && e.market === market);
}

/** 잠금 줄 추가(새 객체). 이미 있거나 해시가 다르면 오류. */
export function appendLock(l: Ledger, entry: Omit<LedgerEntry, 'result'>): Ledger {
  if (entry.sectionBSha256 !== l.section_b_sha256) throw new Error('oos-ledger: 해시 불일치');
  if (hasOosRun(l, entry.strategyId, entry.market)) throw new Error(`oos-ledger: ${entry.market}|${entry.strategyId} 는 이미 OOS 를 실행했다(1회 제한)`);
  return { ...l, entries: [...l.entries, { ...entry, result: null }] };
}

/** 잠금 줄에 결과를 한 번만 채운다. */
export function recordResult(l: Ledger, strategyId: string, market: 'US' | 'KR', result: Record<string, unknown>): Ledger {
  const idx = l.entries.findIndex((e) => e.strategyId === strategyId && e.market === market);
  if (idx < 0) throw new Error('oos-ledger: 잠금 줄 없음');
  if (l.entries[idx].result !== null) throw new Error('oos-ledger: 결과가 이미 기록됐다');
  const entries = l.entries.map((e, i) => (i === idx ? { ...e, result } : e));
  return { ...l, entries };
}

const canon = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x)
  ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, (x as Record<string, unknown>)[k]])) : x));

/** prev → next 가 추가 전용인가: 앞 줄들이 그대로(결과 null → 값 한 번 채우기만 허용)이고 줄은 늘기만 한다. */
export function verifyAppendOnly(prev: Ledger, next: Ledger): boolean {
  if (prev.schema !== next.schema || prev.section_b_sha256 !== next.section_b_sha256) return false;
  if (next.entries.length < prev.entries.length) return false;
  for (let i = 0; i < prev.entries.length; i++) {
    const a = prev.entries[i], b = next.entries[i];
    if (a.result !== null) { if (canon(a) !== canon(b)) return false; continue; }
    if (canon({ ...a, result: null }) !== canon({ ...b, result: null })) return false;
  }
  return true;
}
