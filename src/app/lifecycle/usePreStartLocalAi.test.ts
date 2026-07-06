// Fix 1a (demo readiness) — on boot, if Local-only is already the persisted
// confidentiality mode, pre-start the llama-server sidecar right away instead
// of waiting for the first post-launch question.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

const getConfidentialityModeMock = vi.fn();
vi.mock('@/platform/hooks/useConfidentialityMode', () => ({
  getConfidentialityMode: (): unknown => getConfidentialityModeMock(),
}));

const preStartLocalAiMock = vi.fn();
vi.mock('@/platform/providers/localAiPreStart', () => ({
  preStartLocalAi: (): void => { preStartLocalAiMock(); },
}));

import { usePreStartLocalAi } from './usePreStartLocalAi';

afterEach(() => {
  getConfidentialityModeMock.mockReset();
  preStartLocalAiMock.mockReset();
});

describe('usePreStartLocalAi', () => {
  it('does nothing before settings have hydrated', () => {
    getConfidentialityModeMock.mockReturnValue('local-only');
    renderHook(() => { usePreStartLocalAi(false); });
    expect(preStartLocalAiMock).not.toHaveBeenCalled();
  });

  it('pre-starts once hydrated when local-only is the persisted mode', () => {
    getConfidentialityModeMock.mockReturnValue('local-only');
    const { rerender } = renderHook(({ hydrated }) => { usePreStartLocalAi(hydrated); }, {
      initialProps: { hydrated: false },
    });
    expect(preStartLocalAiMock).not.toHaveBeenCalled();

    rerender({ hydrated: true });
    expect(preStartLocalAiMock).toHaveBeenCalledTimes(1);

    // Further hydration-state churn must not re-trigger it.
    rerender({ hydrated: true });
    expect(preStartLocalAiMock).toHaveBeenCalledTimes(1);
  });

  it('does not pre-start when the persisted mode is not local-only', () => {
    getConfidentialityModeMock.mockReturnValue('direct');
    const { rerender } = renderHook(({ hydrated }) => { usePreStartLocalAi(hydrated); }, {
      initialProps: { hydrated: false },
    });
    rerender({ hydrated: true });
    expect(preStartLocalAiMock).not.toHaveBeenCalled();
  });
});
