// Fix 1a (demo readiness) — selecting "On this computer only" is the
// clearest signal the user intends to use Local AI, so it should kick off the
// llama-server sidecar early rather than waiting for the first question.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const preStartLocalAiMock = vi.fn();
vi.mock('@/platform/providers/localAiPreStart', () => ({
  preStartLocalAi: (): void => { preStartLocalAiMock(); },
}));

import { useRecordConfidentialityChoice } from './useConfidentialityMode';
import { useSettingsStore } from '@/platform/settings/settingsStore';

afterEach(() => {
  preStartLocalAiMock.mockReset();
  useSettingsStore.getState().setSetting('confidentialityMode', 'direct');
  useSettingsStore.getState().setSetting('confidentialityChoiceMade', false);
});

describe('useRecordConfidentialityChoice pre-starts Local AI', () => {
  it('pre-starts the sidecar when the user picks local-only', () => {
    const { result } = renderHook(() => useRecordConfidentialityChoice());
    act(() => {
      result.current('local-only');
    });
    expect(preStartLocalAiMock).toHaveBeenCalledTimes(1);
  });

  it('does not pre-start for direct mode', () => {
    const { result } = renderHook(() => useRecordConfidentialityChoice());
    act(() => {
      result.current('direct');
    });
    expect(preStartLocalAiMock).not.toHaveBeenCalled();
  });

  it('does not pre-start for assured mode', () => {
    const { result } = renderHook(() => useRecordConfidentialityChoice());
    act(() => {
      result.current('assured');
    });
    expect(preStartLocalAiMock).not.toHaveBeenCalled();
  });
});
