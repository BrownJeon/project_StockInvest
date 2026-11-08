/** Bounded, value-free boot observations. Query duration includes pool acquisition and SQL execution. */
type Phase = 'ensure_setup' | 'setup_db' | 'health_setup_wait' | 'health_config_fanout';
type Fields = Record<string, string | number | boolean>;
const SLOW_MS = 5000;
const PENDING_MS = 30000;
let remaining = 240; // Per process, including repeated health requests; no retained span registry.
const codes = new Set(['ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET', 'PROTOCOL_CONNECTION_LOST', 'ER_LOCK_WAIT_TIMEOUT', 'ER_LOCK_DEADLOCK', 'ER_ACCESS_DENIED_ERROR', 'ER_BAD_DB_ERROR']);
function errorCode(error: unknown): string {
  try {
    const code = (error as { code?: unknown } | null)?.code;
    return typeof code === 'string' && codes.has(code) ? code : 'OTHER';
  } catch { return 'OTHER'; }
}
function emit(fields: Fields): void {
  if (remaining <= 0) return;
  remaining--;
  try { console.info('[boot-diagnostics]', JSON.stringify(fields)); } catch { /* Observation cannot affect boot. */ }
}
function unsafeSpan(phase: Phase, fields: Fields = {}, quiet = false) {
  const started = performance.now();
  let done = false;
  const elapsed = () => Math.max(0, Math.round(performance.now() - started));
  if (!quiet) emit({ phase, event: 'start', ...fields });
  const timer = setTimeout(() => {
    try {
      if (!done) emit({ phase, event: 'pending', ...fields, elapsed_ms: elapsed() });
    } catch { /* A watchdog must never throw into the process event loop. */ }
  }, PENDING_MS);
  try { timer.unref?.(); } catch { /* Retain timer cleanup even if unref is unavailable. */ }
  return (error?: unknown, failed = false) => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    const ms = elapsed();
    if (!quiet || failed || ms >= SLOW_MS) {
      emit({ phase, event: failed ? 'failed' : 'complete', ...fields, elapsed_ms: ms,
        ...(failed ? { error_code: errorCode(error) } : {}) });
    }
  };
}
function span(phase: Phase, fields: Fields = {}, quiet = false): (error?: unknown, failed?: boolean) => void {
  try {
    const finish = unsafeSpan(phase, fields, quiet);
    return (error, failed) => { try { finish(error, failed); } catch { /* Diagnostic only. */ } };
  } catch { return () => {}; }
}
function observeResult(result: unknown, finish: (error?: unknown, failed?: boolean) => void): void {
  try {
    const promise = result as Promise<unknown>;
    if (typeof promise?.then === 'function') {
      const observation = promise.then(() => finish(), error => finish(error, true));
      void observation?.catch(() => {});
    } else finish();
  } catch { /* Retain the original return value even when observation is unavailable. */ }
}
/** Observes without replacing the original promise, result, or rejection object. */
export function observeBootPromise<T>(phase: Phase, promise: Promise<T>): Promise<T> {
  const finish = span(phase, {}, phase.startsWith('health_'));
  observeResult(promise, finish);
  return promise;
}

/** Setup-local facade. No methods or prototypes on the real pool are modified. */
export function observeSetupPool<T extends object>(raw: T): { pool: T; close: () => void } {
  let ordinal = 0;
  const source = raw as T & { on?: (event: string, listener: () => void) => unknown; removeListener?: (event: string, listener: () => void) => unknown };
  const onEnqueue = () => { emit({ phase: 'setup_db', event: 'pool_enqueue_observed' }); };
  // Public mysql2 event: reports pool-wide queue activity, not attribution to an individual query.
  let subscribed = false;
  try {
    if (typeof source.on === 'function' && typeof source.removeListener === 'function') {
      source.on('enqueue', onEnqueue);
      subscribed = true;
    }
  } catch { /* Diagnostic only. */ }
  const methods = new Map<PropertyKey, unknown>();
  const facade = new Proxy(raw, {
    get(target, key) {
      const value = Reflect.get(target, key, target);
      if (typeof value !== 'function') return value;
      if (methods.has(key)) return methods.get(key);
      const method = key === 'query' || key === 'execute' ? (...args: unknown[]) => {
        const sql = typeof args[0] === 'string' ? args[0] : '';
        const token = /^\s*(CREATE|ALTER|SELECT|INSERT|UPDATE|DELETE|SHOW|DROP)\b/i.exec(sql)?.[1]?.toUpperCase() ?? 'OTHER';
        const fields = { ordinal: ++ordinal, sql_class: token, timing: 'pool_and_execution' };
        const finish = span('setup_db', fields, true);
        try {
          const result = Reflect.apply(value, target, args);
          observeResult(result, finish);
          return result;
        } catch (error) { finish(error, true); throw error; }
      } : value.bind(target);
      methods.set(key, method);
      return method;
    },
  });
  let closed = false;
  return { pool: facade, close: () => {
    if (closed) return;
    closed = true;
    try { if (subscribed) source.removeListener!('enqueue', onEnqueue); } catch { /* Diagnostic only. */ }
  } };
}
