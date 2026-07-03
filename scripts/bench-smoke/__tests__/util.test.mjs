import { describe, it, expect, vi } from 'vitest';
import { withGuard, clickElement } from '../checks/_util.mjs';
import { DriverError } from '../driver.mjs';
import { makeResult, STATUS } from '../result.mjs';

describe('withGuard', () => {
  it('passes through a well-formed result unchanged (plus durationMs)', async () => {
    const check = withGuard('id', 'Section', async () => makeResult({ id: 'id', section: 'Section', status: STATUS.PASS, detail: 'ok' }));
    const result = await check({});
    expect(result.status).toBe(STATUS.PASS);
    expect(typeof result.durationMs).toBe('number');
  });

  it('turns a thrown DriverError into SETUP-BLOCKED, not FAIL', async () => {
    const check = withGuard('id', 'Section', async () => {
      throw new DriverError('bench unreachable');
    });
    const result = await check({});
    expect(result.status).toBe(STATUS.SETUP_BLOCKED);
    expect(result.detail).toMatch(/bench unreachable/);
  });

  it('turns any other thrown error into FAIL, not a crash', async () => {
    const check = withGuard('id', 'Section', async () => {
      throw new TypeError('unexpected shape');
    });
    const result = await check({});
    expect(result.status).toBe(STATUS.FAIL);
    expect(result.detail).toMatch(/unexpected shape/);
  });
});

describe('clickElement', () => {
  // Regression test: a prior version of the checks called
  // `driver.click(el.testid ?? undefined)`, which silently sent the literal
  // string "undefined" as a testid whenever an element was matched only by
  // text (no data-testid) — every such click timed out looking for
  // `[data-testid="undefined"]`. clickElement must route text-only matches
  // through clickByText instead of ever calling click(undefined).
  it('clicks by testid when the element has one', async () => {
    const driver = { click: vi.fn(), clickByText: vi.fn() };
    await clickElement(driver, { testid: 'sync-button', text: 'Sync now' });
    expect(driver.click).toHaveBeenCalledWith('sync-button');
    expect(driver.clickByText).not.toHaveBeenCalled();
  });

  it('falls back to clicking by text when the element has no testid', async () => {
    const driver = { click: vi.fn(), clickByText: vi.fn() };
    await clickElement(driver, { text: 'Sync now' });
    expect(driver.clickByText).toHaveBeenCalledWith('Sync now');
    expect(driver.click).not.toHaveBeenCalled();
  });

  it('never calls click() with an undefined testid', async () => {
    const driver = { click: vi.fn(), clickByText: vi.fn() };
    await clickElement(driver, { text: 'Approve 1 change' });
    for (const call of driver.click.mock.calls) {
      expect(call[0]).not.toBeUndefined();
    }
  });

  it('throws when the element has neither a testid nor text', async () => {
    const driver = { click: vi.fn(), clickByText: vi.fn() };
    await expect(clickElement(driver, {})).rejects.toThrow(/neither a testid nor visible text/);
  });

  it('throws when there is no element at all', async () => {
    const driver = { click: vi.fn(), clickByText: vi.fn() };
    await expect(clickElement(driver, undefined)).rejects.toThrow(/no element to click/);
  });
});
