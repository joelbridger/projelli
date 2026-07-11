import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const { assertNavigation, egressFetch, shellOpen, isTauri } = vi.hoisted(() => ({
  assertNavigation: vi.fn(),
  egressFetch: vi.fn(),
  shellOpen: vi.fn(),
  isTauri: vi.fn(),
}));

vi.mock('@/platform/privacy/networkClient', () => ({
  assertEgressNavigationAllowed: assertNavigation,
  egressFetch,
}));
vi.mock('@/platform/fs/BackendFactory', () => ({ isTauriEnvironment: isTauri }));
vi.mock('@tauri-apps/plugin-shell', () => ({ open: shellOpen }));

import { openExternal } from '@/platform/utils/openExternal';
import { BugReportDialog } from '@/app/shell/common/BugReportDialog';

describe('Offline Mode external actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isTauri.mockReturnValue(true);
    assertNavigation.mockResolvedValue(undefined);
    egressFetch.mockResolvedValue({ ok: true, status: 200 });
  });

  it('checks the external-navigation operation before handing a URL to the OS', async () => {
    await openExternal('https://example.com/help');
    expect(assertNavigation).toHaveBeenCalledWith(
      'external-navigation',
      'https://example.com/help',
    );
    expect(shellOpen).toHaveBeenCalledWith('https://example.com/help');
  });

  it('does not open a URL when Offline Mode blocks the navigation', async () => {
    assertNavigation.mockRejectedValueOnce(new Error('Offline Mode is on.'));
    await expect(openExternal('https://example.com/help')).rejects.toThrow('Offline Mode is on.');
    expect(shellOpen).not.toHaveBeenCalled();
  });

  it('sends a bug report through the registered egress operation', async () => {
    render(<BugReportDialog open onOpenChange={vi.fn()} />);
    fireEvent.change(screen.getByTestId('bug-report-message'), {
      target: { value: 'The document list did not load.' },
    });
    fireEvent.click(screen.getByTestId('bug-report-submit'));

    await waitFor(() => expect(egressFetch).toHaveBeenCalledTimes(1));
    expect(egressFetch.mock.calls[0]?.[0]).toBe('bug-report');
  });

  it('surfaces an Offline Mode support-form block instead of attempting a raw fetch', async () => {
    egressFetch.mockRejectedValueOnce(new Error('Offline Mode is on. Lantern cannot connect to the internet.'));
    render(<BugReportDialog open onOpenChange={vi.fn()} />);
    fireEvent.change(screen.getByTestId('bug-report-message'), {
      target: { value: 'The document list did not load.' },
    });
    fireEvent.click(screen.getByTestId('bug-report-submit'));

    await screen.findByTestId('bug-report-error');
    expect(egressFetch.mock.calls[0]?.[0]).toBe('bug-report');
  });
});
