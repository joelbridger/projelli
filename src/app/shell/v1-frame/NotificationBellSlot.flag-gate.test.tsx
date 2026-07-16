import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { V1ShellFrameFlagGate } from '@/app/shell/v1-frame';
import type { PlatformFlagsMockState } from '@/testing/platform-flags';

const { mockPlatformFlags, resetPlatformFlagsOverrides, setPlatformFlagsOverrides } =
  await vi.hoisted(async () => import('@/testing/platform-flags'));

const shellFlag = vi.hoisted(() => ({ enabled: false }));
const flagsMock = vi.hoisted(() => ({
  overrides: { useFlag: undefined } as PlatformFlagsMockState['overrides'],
}));

vi.mock('@/platform/flags', async (importOriginal) =>
  mockPlatformFlags(importOriginal, flagsMock)
);

describe('notification-bell flag-gate pass-through', () => {
  beforeEach(() => {
    resetPlatformFlagsOverrides(flagsMock);
    setPlatformFlagsOverrides(flagsMock, { useFlag: () => shellFlag.enabled });
  });

  afterEach(() => {
    resetPlatformFlagsOverrides(flagsMock);
  });

  it('does not call the supplied renderer while the v1 frame is off', () => {
    shellFlag.enabled = false;
    const renderNotificationBell = vi.fn(() => (
      <button data-testid="gated-notification-button" type="button" />
    ));

    render(
      <V1ShellFrameFlagGate
        activeSurface="home"
        legacy={<div data-testid="exact-legacy-shell" />}
        notificationBellSlot={{ render: renderNotificationBell }}
        onOpenCommandPalette={vi.fn()}
        onSurfaceChange={vi.fn()}
      >
        <div />
      </V1ShellFrameFlagGate>
    );

    expect(screen.getByTestId('exact-legacy-shell')).toBeInTheDocument();
    expect(screen.queryByTestId('v1-shell-frame')).toBeNull();
    expect(screen.queryByTestId('gated-notification-button')).toBeNull();
    expect(renderNotificationBell).not.toHaveBeenCalled();
  });

  it('passes the supplied renderer to the one real v1 top-bar slot when on', () => {
    shellFlag.enabled = true;
    const renderNotificationBell = vi.fn(() => (
      <button data-testid="gated-notification-button" type="button" />
    ));

    render(
      <V1ShellFrameFlagGate
        activeSurface="home"
        legacy={<div data-testid="exact-legacy-shell" />}
        notificationBellSlot={{ render: renderNotificationBell }}
        onOpenCommandPalette={vi.fn()}
        onSurfaceChange={vi.fn()}
      >
        <div />
      </V1ShellFrameFlagGate>
    );

    const topbar = screen.getByTestId('v1-shell-topbar');
    const customButton = screen.getByTestId('gated-notification-button');
    expect(renderNotificationBell).toHaveBeenCalledOnce();
    expect(customButton.parentElement).toBe(topbar);
    expect(screen.queryByTestId('v1-shell-notification-slot')).toBeNull();
    expect(screen.queryByTestId('exact-legacy-shell')).toBeNull();
  });
});
