import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  withCrmTimeout,
  CrmTimeoutError,
  CrmCancelledError,
  createCrmCancelGate,
  CRM_LIST_HOUSEHOLDS_TIMEOUT_MS,
} from '@/platform/connectors/crm/crmTimeout';

describe('withCrmTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('rejects with a CrmTimeoutError when the underlying call never settles (a sustained 429 retry storm)', async () => {
    const neverSettles = new Promise<string[]>(() => {
      /* intentionally never resolves */
    });

    const raced = withCrmTimeout(neverSettles, 'household list', CRM_LIST_HOUSEHOLDS_TIMEOUT_MS);
    const assertion = expect(raced).rejects.toMatchObject({ name: 'CrmTimeoutError' });

    await vi.advanceTimersByTimeAsync(CRM_LIST_HOUSEHOLDS_TIMEOUT_MS + 1);
    await assertion;
  });

  it('passes a value through untouched when it settles in time', async () => {
    await expect(
      withCrmTimeout(Promise.resolve(['household']), 'household list', CRM_LIST_HOUSEHOLDS_TIMEOUT_MS)
    ).resolves.toEqual(['household']);
  });

  it('propagates the underlying rejection (not a timeout) when the call fails fast', async () => {
    await expect(
      withCrmTimeout(Promise.reject(new Error('Wealthbox request failed (HTTP 500)')), 'household list', CRM_LIST_HOUSEHOLDS_TIMEOUT_MS)
    ).rejects.toThrow('Wealthbox request failed (HTTP 500)');
  });

  it('clears the timer once settled so no dangling timeout remains', async () => {
    await withCrmTimeout(Promise.resolve('ok'), 'household list', 1000);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('CrmTimeoutError carries the stage in its message', () => {
    const err = new CrmTimeoutError('household list', 90_000);
    expect(err.name).toBe('CrmTimeoutError');
    expect(err.message).toContain('household list');
  });
});

describe('createCrmCancelGate', () => {
  it('race() stays pending until cancel() fires, even though the underlying promise never settles', async () => {
    const gate = createCrmCancelGate('household list');
    const neverSettles = new Promise<string[]>(() => {});
    const raced = gate.race(neverSettles);

    // Real timers here — no fake-timer involvement needed for this gate.
    let settled = false;
    void raced.then(
      () => { settled = true; },
      () => { settled = true; },
    );
    await new Promise((r) => setTimeout(r, 10));
    expect(settled).toBe(false);

    gate.cancel();
    await expect(raced).rejects.toMatchObject({ name: 'CrmCancelledError' });
  });

  it('CrmCancelledError carries the stage in its message', () => {
    const err = new CrmCancelledError('household list');
    expect(err.name).toBe('CrmCancelledError');
    expect(err.message).toContain('household list');
  });

  it('does not reject when the underlying promise wins the race (cancel never called)', async () => {
    const gate = createCrmCancelGate('household list');
    await expect(gate.race(Promise.resolve('households'))).resolves.toBe('households');
  });
});
