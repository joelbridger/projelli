import { describe, it, expect } from 'vitest';
import { withGuard } from '../checks/_util.mjs';
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
