import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const { assertNavigation, egressFetch, shellOpen, isTauri, callOrder } = vi.hoisted(() => ({
  assertNavigation: vi.fn(),
  egressFetch: vi.fn(),
  shellOpen: vi.fn(),
  isTauri: vi.fn(),
  callOrder: [] as string[],
}));

vi.mock('@/platform/privacy/networkClient', () => ({
  assertEgressNavigationAllowed: assertNavigation,
  egressFetch,
}));
vi.mock('@/platform/fs/BackendFactory', () => ({ isTauriEnvironment: isTauri }));
vi.mock('@tauri-apps/plugin-shell', () => ({
  // A dynamic `import()` of an already-mocked module resolves without
  // re-running this factory, so record the import as its own call-order
  // event here instead of relying on the factory body re-executing.
  get open() {
    callOrder.push('import');
    return shellOpen;
  },
}));

import { openExternal } from '@/platform/utils/openExternal';
import { BugReportDialog } from '@/app/shell/common/BugReportDialog';

describe('Offline Mode external actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    callOrder.length = 0;
    isTauri.mockReturnValue(true);
    assertNavigation.mockImplementation(async () => {
      callOrder.push('check');
    });
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

  it('imports the shell bridge before its final policy check, so the check is the last thing before opening', async () => {
    await openExternal('https://example.com/help');
    // The dynamic import of @tauri-apps/plugin-shell must resolve before the
    // policy check runs, so an Offline Mode flip during that import's await
    // is caught by the check that follows it rather than racing past it.
    expect(callOrder).toEqual(['import', 'check']);
    expect(shellOpen).toHaveBeenCalledWith('https://example.com/help');
  });

  it('does not open a URL when the final check rejects, even though the import already happened', async () => {
    assertNavigation.mockImplementation(async () => {
      callOrder.push('check');
      throw new Error('Offline Mode is on.');
    });

    await expect(openExternal('https://example.com/help')).rejects.toThrow('Offline Mode is on.');
    expect(callOrder).toEqual(['import', 'check']);
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
