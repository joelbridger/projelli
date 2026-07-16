import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { PlatformFlagsMockState } from '@/testing/platform-flags';

const { mockPlatformFlags, resetPlatformFlagsOverrides, setPlatformFlagsOverrides } =
  await vi.hoisted(async () => import('@/testing/platform-flags'));

let shellEnabled = false;
const flagsMock = vi.hoisted(() => ({
  overrides: { useFlag: undefined } as PlatformFlagsMockState['overrides'],
}));

vi.mock('@/platform/flags', async (importOriginal) =>
  mockPlatformFlags(importOriginal, flagsMock)
);

vi.mock('@/app/shell/AppSurfaceRouter', () => ({
  AppSurfaceRouter: () => <div data-testid="app-surface-router" />,
}));

vi.mock('@/app/shell/layout/AppShellNav', () => ({
  AppShellNav: () => <div data-testid="legacy-app-shell-nav" />,
}));

vi.mock('@/app/lifecycle/useWorkspaceLifecycle', () => ({
  useWorkspaceLifecycle: () => ({
    handleWorkspaceSelected: vi.fn(),
    handleOpenRecentProject: vi.fn(),
    workspaceOpenError: null,
    dismissWorkspaceOpenError: vi.fn(),
  }),
}));

vi.mock('@/app/shell/AppDialogs', () => ({ AppDialogs: () => null }));
vi.mock('@/app/shell/runtime/AppSurfaceRuntimeProvider', () => ({
  AppSurfaceRuntimeProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));
vi.mock('@/features/meetings/RecordPill', () => ({ RecordPill: () => null }));
vi.mock('@/features/meetings/MeetingAutoJoinScheduler', () => ({
  MeetingAutoJoinScheduler: () => null,
}));
vi.mock('@/features/meetings/AutoJoinMeetingsPanel', () => ({
  AutoJoinMeetingsPanel: () => null,
}));
vi.mock('@/app/shell/layout/StatusBar', () => ({ StatusBar: () => null }));
vi.mock('@/platform/rag/ui/ModelDownloadCard', () => ({
  ModelDownloadCard: () => null,
}));
vi.mock('@/platform/rag/ui/LocalAiDownloadCard', () => ({
  LocalAiDownloadCard: () => null,
}));
vi.mock('@/platform/rag/ui/RagProgressBanner', () => ({
  RagProgressBanner: () => null,
}));
vi.mock('@/platform/rag/ui/ScopeUpdateBanner', () => ({
  ScopeUpdateBanner: () => null,
}));
vi.mock('@/features/account/trial', () => ({ TrialBanner: () => null }));

window.history.pushState({}, '', '/?testMode=true');
const { default: App } = await import('@/App');

describe('App v1 shell-frame flag switch', () => {
  beforeEach(() => {
    resetPlatformFlagsOverrides(flagsMock);
    setPlatformFlagsOverrides(flagsMock, { useFlag: () => shellEnabled });
  });

  afterEach(() => {
    resetPlatformFlagsOverrides(flagsMock);
  });

  it('keeps the legacy chrome when the flag is off', () => {
    shellEnabled = false;
    render(<App />);

    expect(screen.getByTestId('legacy-app-shell-nav')).toBeInTheDocument();
    expect(screen.queryByTestId('v1-shell-frame')).not.toBeInTheDocument();
  });

  it('renders the v1 frame branch when the flag is on', () => {
    shellEnabled = true;
    render(<App />);

    expect(screen.getByTestId('v1-shell-frame')).toBeInTheDocument();
    expect(
      screen.queryByTestId('legacy-app-shell-nav')
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('v1-shell-nav-matters'));
    // shared-client-bar flag ON → SharedClientBar renders ClientBarV1 in the slot.
    expect(screen.getByTestId('v1-shell-client-bar-slot')).toContainElement(
      screen.getByTestId('client-bar-v1')
    );
  });
});
