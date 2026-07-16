import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SettingsV1Runtime } from './runtime';
import type { PlatformFlagsMockState } from '@/testing/platform-flags';

const { mockPlatformFlags, resetPlatformFlagsOverrides, setPlatformFlagsOverrides } =
  await vi.hoisted(async () => import('@/testing/platform-flags'));

const { flagsMock, useFlag, enabledFrame } = vi.hoisted(() => {
  const useFlag = vi.fn((_id: string) => false);
  return {
    flagsMock: { overrides: { useFlag } } as PlatformFlagsMockState,
    useFlag,
    enabledFrame: vi.fn(() => <div data-testid="settings-v1-enabled-frame" />),
  };
});

vi.mock('@/platform/flags', async (importOriginal) =>
  mockPlatformFlags(importOriginal, flagsMock)
);
vi.mock('./SettingsV1FrameEnabled', () => ({
  SettingsV1FrameEnabled: enabledFrame,
}));

import { SettingsV1Surface } from './SettingsV1Surface';

const runtime = {
  legacy: { settings: () => <div data-testid="legacy-settings-body" /> },
} as unknown as SettingsV1Runtime;

describe('SettingsV1Surface', () => {
  beforeEach(() => {
    resetPlatformFlagsOverrides(flagsMock);
    setPlatformFlagsOverrides(flagsMock, { useFlag });
  });

  afterEach(() => {
    resetPlatformFlagsOverrides(flagsMock);
    useFlag.mockReset().mockReturnValue(false);
    enabledFrame.mockClear();
  });

  it('does not load the enabled settings frame while the flag is off', () => {
    render(<SettingsV1Surface runtime={runtime} />);

    expect(screen.getByTestId('legacy-settings-body')).toBeInTheDocument();
    expect(enabledFrame).not.toHaveBeenCalled();
    expect(useFlag).toHaveBeenCalledWith('settings-shell-v1');
  });

  it('mounts the enabled settings frame only while the flag is on', async () => {
    useFlag.mockReturnValue(true);

    render(<SettingsV1Surface runtime={runtime} />);

    expect(
      await screen.findByTestId('settings-v1-enabled-frame')
    ).toBeInTheDocument();
    expect(enabledFrame).toHaveBeenCalledWith(
      expect.objectContaining({ runtime }),
      expect.any(Object)
    );
  });
});
