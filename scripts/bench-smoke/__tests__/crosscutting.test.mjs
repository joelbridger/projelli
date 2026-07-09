import { describe, it, expect, vi } from 'vitest';
import { checkLocalOnlyEgressTripwire } from '../checks/crosscutting.mjs';
import { STATUS } from '../result.mjs';

describe('checkLocalOnlyEgressTripwire', () => {
  it('PASSes when the local-only walk touches no cloud AI endpoint', async () => {
    const driver = {
      localOnlyEgressWalk: vi.fn().mockResolvedValue({
        localLabel: 'On this computer only',
        walked: ['Ask', 'Workflows', 'Clients'],
        violations: [],
      }),
    };

    const result = await checkLocalOnlyEgressTripwire({ driver });

    expect(result.status).toBe(STATUS.PASS);
    expect(result.detail).toMatch(/zero cloud AI requests/);
  });

  it('FAILs when the local-only walk records any cloud AI endpoint', async () => {
    const driver = {
      localOnlyEgressWalk: vi.fn().mockResolvedValue({
        localLabel: 'On this computer only',
        walked: ['Ask'],
        violations: ['https://api.openai.com/v1/chat/completions'],
      }),
    };

    const result = await checkLocalOnlyEgressTripwire({ driver });

    expect(result.status).toBe(STATUS.FAIL);
    expect(result.detail).toMatch(/cloud AI request/);
    expect(result.detail).toMatch(/api\.openai\.com/);
  });
});
