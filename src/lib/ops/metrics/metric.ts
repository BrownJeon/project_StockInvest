/**
 * Metric 값 만들기 — 「확인된 0」과 「모름」을 섞지 않는 작은 도우미 (순수, type import 만).
 */
import type { Metric, MetricState } from './types';

/** value 가 null 이면 첫 오버로드 — T 는 never(또는 명시)로, Metric<never> 는 어떤 Metric<X> 자리에도 들어간다(값 없음). */
export function metric<T = never>(state: MetricState, value: null, asOf?: string | null, reason?: string): Metric<T>;
export function metric<T>(state: MetricState, value: T | null, asOf?: string | null, reason?: string): Metric<T>;
export function metric<T>(state: MetricState, value: T | null, asOf: string | null = null, reason?: string): Metric<T> {
  return reason ? { state, value, asOf, reason } : { state, value, asOf };
}

/** 조회가 **성공한** 건수 — 0 이면 zero, 아니면 available. 조회 실패·모름에는 쓰지 않는다. */
export function counted(n: number, asOf: string | null = null): Metric<number> {
  return metric(n > 0 ? 'available' : 'zero', n, asOf);
}

export function unknownMetric<T = never>(reason: string, asOf: string | null = null): Metric<T> {
  return metric<T>('unknown', null, asOf, reason);
}

export function prepMetric<T = never>(reason: string): Metric<T> {
  return metric<T>('prep', null, null, reason);
}

export function errorMetric<T = never>(reason: string): Metric<T> {
  return metric<T>('error', null, null, reason);
}

/** available·zero 를 stale 로 낮춘다(값은 그대로 — 화면이 회색으로). 그 밖 상태는 그대로. */
export function staleIf<T>(m: Metric<T>, stale: boolean, reason: string): Metric<T> {
  if (!stale) return m;
  if (m.state !== 'available' && m.state !== 'zero') return m;
  return { ...m, state: 'stale', reason };
}
