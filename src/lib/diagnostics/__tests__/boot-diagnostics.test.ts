import { EventEmitter } from 'events';
import { observeBootPromise, observeSetupPool } from '../boot-diagnostics';

describe('value-free boot observations', () => {
  let output: jest.SpyInstance;
  beforeEach(() => { jest.useFakeTimers(); output = jest.spyOn(console, 'info').mockImplementation(() => {}); });
  afterEach(() => { jest.useRealTimers(); output.mockRestore(); });
  const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

  it('retains promise, result, receiver and argument identity; cleans pending timers', async () => {
    const params = ['secret-account'];
    let resolve!: (value: object) => void;
    const result = new Promise<object>(r => { resolve = r; });
    const raw = Object.assign(new EventEmitter(), { query: jest.fn(function(this: unknown, ...args: unknown[]) {
      expect(this).toBe(raw); expect(args).toEqual(['SELECT secret-email', params]); return result;
    }) });
    const observation = observeSetupPool(raw);
    expect(observation.pool.query('SELECT secret-email', params)).toBe(result);
    jest.advanceTimersByTime(30000);
    expect(output.mock.calls.some(call => String(call[1]).includes('pending'))).toBe(true);
    const value = {}; resolve(value); await flush();
    expect(await result).toBe(value); expect(jest.getTimerCount()).toBe(0);
    observation.close(); observation.close(); expect(raw.listenerCount('enqueue')).toBe(0);
    expect(JSON.stringify(output.mock.calls)).not.toMatch(/secret-email|secret-account/);
  });

  it('preserves the original rejection and emits only an allowlisted error code', async () => {
    const error = Object.assign(new Error('secret-password'), { code: 'SECRET_KEY' });
    const promise = Promise.reject(error);
    expect(observeBootPromise('ensure_setup', promise)).toBe(promise);
    await expect(promise).rejects.toBe(error); await flush();
    expect(jest.getTimerCount()).toBe(0);
    expect(JSON.stringify(output.mock.calls)).toContain('OTHER');
    expect(JSON.stringify(output.mock.calls)).not.toMatch(/secret-password|SECRET_KEY/);
  });

  it('keeps concurrent operations independent and reports pool-wide enqueue without attributing acquisition time', async () => {
    let finish!: () => void;
    const pending = new Promise<void>(r => { finish = r; });
    const raw = Object.assign(new EventEmitter(), { query: jest.fn().mockReturnValueOnce(pending).mockResolvedValueOnce([]) });
    const observation = observeSetupPool(raw);
    observation.pool.query(); observation.pool.query(); await flush();
    expect(jest.getTimerCount()).toBe(1);
    raw.emit('enqueue'); jest.advanceTimersByTime(30000);
    const records = output.mock.calls.map(call => JSON.parse(call[1]));
    expect(records.find(record => record.event === 'pool_enqueue_observed')).toEqual({phase: 'setup_db', event: 'pool_enqueue_observed'});
    expect(records.filter(record => record.event === 'pending')).toEqual([expect.objectContaining({ordinal: 1, timing: 'pool_and_execution'})]);
    finish(); await flush(); observation.close(); expect(jest.getTimerCount()).toBe(0);
  });

  it('isolates watchdog clock failures and still settles the original promise', async () => {
    let finish!: () => void;
    const promise = new Promise<void>(resolve => { finish = resolve; });
    expect(observeBootPromise('ensure_setup', promise)).toBe(promise);
    const clock = jest.spyOn(performance, 'now').mockImplementation(() => { throw new Error('clock failed'); });
    expect(() => jest.advanceTimersByTime(30000)).not.toThrow();
    finish(); await flush();
    expect(jest.getTimerCount()).toBe(0);
    clock.mockRestore();
    await expect(promise).resolves.toBeUndefined();
  });

  it('does not replace synchronous throws or let a broken logger change results', () => {
    output.mockImplementation(() => { throw new Error('logger failed'); });
    const error = {};
    const raw = { query: () => { throw error; }, other: function() { return this; } };
    const observation = observeSetupPool(raw);
    expect(observation.pool.other()).toBe(raw);
    try { observation.pool.query(); throw new Error('expected throw'); } catch (caught) { expect(caught).toBe(error); }
    observation.close(); expect(jest.getTimerCount()).toBe(0);
  });
});
