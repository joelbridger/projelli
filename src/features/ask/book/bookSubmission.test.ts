import { describe, it, expect, vi } from 'vitest';
import { settleBookSubmission } from './bookSubmission';
import type { BookAskResult } from './bookFacts';

const result: BookAskResult & { model: string } = {
  answer: 'Alvarez matches.',
  model: 'test-model',
  matches: [{ matterId: 'm1', label: 'Alvarez', facts: [] }],
};

function handlers(isStale: () => boolean) {
  return {
    onResult: vi.fn(),
    onError: vi.fn(),
    onSettle: vi.fn(),
    restoreQuestion: vi.fn(),
    isStale,
  };
}

describe('settleBookSubmission', () => {
  it('commits the result and does not restore the question on success', async () => {
    const h = handlers(() => false);
    await settleBookSubmission(Promise.resolve(result), 'which clients mention 529 plans?', h);
    expect(h.onResult).toHaveBeenCalledWith(result);
    expect(h.onSettle).toHaveBeenCalledOnce();
    expect(h.restoreQuestion).not.toHaveBeenCalled();
  });

  it('restores the typed question on failure — e.g. the expected first-time consent block', async () => {
    const h = handlers(() => false);
    const asked = 'which clients mention 529 plans?';
    await settleBookSubmission(Promise.reject(new Error('Turn on file access for this conversation.')), asked, h);
    expect(h.onError).toHaveBeenCalledWith('Turn on file access for this conversation.');
    expect(h.restoreQuestion).toHaveBeenCalledWith(asked);
    expect(h.onResult).not.toHaveBeenCalled();
    expect(h.onSettle).toHaveBeenCalledOnce();
  });

  it('commits nothing when the request has gone stale (a newer submit or a workspace switch)', async () => {
    const h = handlers(() => true);
    await settleBookSubmission(Promise.resolve(result), 'anything', h);
    expect(h.onResult).not.toHaveBeenCalled();
    expect(h.onSettle).not.toHaveBeenCalled();

    const h2 = handlers(() => true);
    await settleBookSubmission(Promise.reject(new Error('boom')), 'anything', h2);
    expect(h2.onError).not.toHaveBeenCalled();
    expect(h2.restoreQuestion).not.toHaveBeenCalled();
    expect(h2.onSettle).not.toHaveBeenCalled();
  });
});
