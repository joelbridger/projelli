import { describe, it, expect, beforeEach } from 'vitest';
import { useMailStore } from '@/features/email/mailStore';

// Regression: a single global `progress` object meant the Microsoft 365 and Gmail
// connector panels (rendered together) both read the same status/count, so one
// provider's import count or error appeared on the other. Progress is now keyed by
// provider; these tests pin that the keys stay independent.
describe('mailStore per-provider progress', () => {
  beforeEach(() => {
    useMailStore.setState({ progressByProvider: {} });
  });

  it('keys progress by provider', () => {
    useMailStore.getState().setProgress({ provider: 'gmail', status: 'syncing', written: 368, removed: 0 });
    const map = useMailStore.getState().progressByProvider;
    expect(map.gmail?.written).toBe(368);
    // The other provider has NOT inherited Gmail's count.
    expect(map.m365).toBeUndefined();
  });

  it('updates one provider without disturbing another', () => {
    const { setProgress } = useMailStore.getState();
    setProgress({ provider: 'gmail', status: 'syncing', written: 368, removed: 0 });
    setProgress({ provider: 'm365', status: 'error', written: 0, removed: 0 });
    const map = useMailStore.getState().progressByProvider;
    expect(map.m365?.status).toBe('error');
    // Gmail's in-progress count survives an unrelated Microsoft 365 error.
    expect(map.gmail?.written).toBe(368);
    expect(map.gmail?.status).toBe('syncing');
  });
});
