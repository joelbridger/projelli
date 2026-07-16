import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SettingsV1Runtime } from './runtime';

const { useFlag, enabledFrame } = vi.hoisted(() => ({
  useFlag: vi.fn((_id: string) => false),
  enabledFrame: vi.fn(() => <div data-testid="settings-v1-enabled-frame" />),
}));

vi.mock('@/platform/flags', () => ({ useFlag }));
vi.mock('./SettingsV1FrameEnabled', () => ({
  SettingsV1FrameEnabled: enabledFrame,
}));

import { SettingsV1Surface } from './SettingsV1Surface';

const runtime = {
  legacy: { settings: () => <div data-testid="legacy-settings-body" /> },
} as SettingsV1Runtime;

describe('SettingsV1Surface', () => {
  afterEach(() => {
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
