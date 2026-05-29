/**
 * McpSettingsSection + McpApprovalModal — RTL tests for the M4 in-app UX.
 *
 * Verifies:
 *   - Settings panel renders with the three required testids
 *     (`mcp-settings-section`, `mcp-download-mcpb`, `mcp-server-status`).
 *   - Status pill reflects the bundle-path lookup (loading → ready →
 *     unavailable) driven by the injected `onResolveBundlePath` stub.
 *   - Download button triggers the injected `onDownload` and surfaces
 *     a success toast.
 *   - Approval modal renders the path, preview, and three action buttons
 *     (`mcp-approve-write`, `mcp-approve-all-session`, `mcp-deny-write`)
 *     and wires each one to the `onRespond` callback with the correct
 *     approved flag.
 *   - `sessionApproveAll = true` auto-approves every queued item and
 *     hides the modal body.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';

import {
  McpSettingsSection,
  McpApprovalModal,
} from '@/components/settings';
import type { McpPendingApproval } from '@/utils/tauri-commands';

// ---------------------------------------------------------------------------
// McpSettingsSection
// ---------------------------------------------------------------------------

describe('McpSettingsSection', () => {
  it('renders with the expected testids', async () => {
    render(
      <McpSettingsSection onResolveBundlePath={async () => null} />,
    );
    expect(screen.getByTestId('mcp-settings-section')).toBeTruthy();
    expect(screen.getByTestId('mcp-server-status')).toBeTruthy();
    expect(screen.getByTestId('mcp-download-mcpb')).toBeTruthy();
    // Status resolves to "unavailable" after the async lookup completes.
    await waitFor(() => {
      expect(
        screen.getByTestId('mcp-server-status').getAttribute('data-status'),
      ).toBe('unavailable');
    });
  });

  it('shows "ready" status when the bundle is available', async () => {
    render(
      <McpSettingsSection
        onResolveBundlePath={async () => '/tmp/keepance-mcp.mcpb'}
      />,
    );
    await waitFor(() => {
      expect(
        screen.getByTestId('mcp-server-status').getAttribute('data-status'),
      ).toBe('ready');
    });
  });

  it('disables download button when bundle is unavailable', async () => {
    render(
      <McpSettingsSection onResolveBundlePath={async () => null} />,
    );
    await waitFor(() => {
      const btn = screen.getByTestId('mcp-download-mcpb') as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
    });
  });

  it('invokes onDownload with the bundle path when the user clicks', async () => {
    const onDownload = vi.fn(async () => undefined);
    render(
      <McpSettingsSection
        onResolveBundlePath={async () => '/tmp/keepance-mcp.mcpb'}
        onDownload={onDownload}
      />,
    );
    await waitFor(() => {
      expect(
        (screen.getByTestId('mcp-download-mcpb') as HTMLButtonElement).disabled,
      ).toBe(false);
    });
    fireEvent.click(screen.getByTestId('mcp-download-mcpb'));
    await waitFor(() => {
      expect(onDownload).toHaveBeenCalledWith('/tmp/keepance-mcp.mcpb');
    });
    // Success toast surfaces the clipboard message.
    await waitFor(() => {
      expect(screen.getByTestId('mcp-download-status')).toBeTruthy();
    });
  });

  it('shows an error when onDownload rejects', async () => {
    const onDownload = vi.fn(async () => {
      throw new Error('permission denied');
    });
    render(
      <McpSettingsSection
        onResolveBundlePath={async () => '/tmp/keepance-mcp.mcpb'}
        onDownload={onDownload}
      />,
    );
    await waitFor(() => {
      expect(
        (screen.getByTestId('mcp-download-mcpb') as HTMLButtonElement).disabled,
      ).toBe(false);
    });
    fireEvent.click(screen.getByTestId('mcp-download-mcpb'));
    await waitFor(() => {
      expect(screen.getByTestId('mcp-download-error').textContent).toContain(
        'permission denied',
      );
    });
  });
});

// ---------------------------------------------------------------------------
// McpApprovalModal
// ---------------------------------------------------------------------------

function makeApproval(overrides?: Partial<McpPendingApproval>): McpPendingApproval {
  return {
    token: 'abc123',
    path: 'notes/plan.md',
    preview: 'Hello world',
    fileExists: false,
    oldPreview: '',
    contentBytes: 11,
    receivedAt: 1_700_000_000,
    ...overrides,
  };
}

describe('McpApprovalModal', () => {
  it('renders nothing when the approvals queue is empty', () => {
    const { container } = render(
      <McpApprovalModal approvals={[]} onRespond={vi.fn()} />,
    );
    // Radix Dialog renders into a portal; the queue-empty case should
    // produce zero testids inside the document.
    expect(container.querySelector('[data-testid="mcp-approval-modal"]')).toBeNull();
    expect(
      document.querySelector('[data-testid="mcp-approval-modal"]'),
    ).toBeNull();
  });

  it('renders the topmost approval with path + preview + three buttons', () => {
    render(
      <McpApprovalModal
        approvals={[makeApproval()]}
        onRespond={vi.fn()}
        onApproveAllSession={vi.fn()}
      />,
    );
    expect(screen.getByTestId('mcp-approval-modal')).toBeTruthy();
    expect(screen.getByTestId('mcp-approval-path').textContent).toBe(
      'notes/plan.md',
    );
    expect(screen.getByTestId('mcp-approval-preview').textContent).toContain(
      'Hello world',
    );
    expect(screen.getByTestId('mcp-approve-write')).toBeTruthy();
    expect(screen.getByTestId('mcp-approve-all-session')).toBeTruthy();
    expect(screen.getByTestId('mcp-deny-write')).toBeTruthy();
  });

  it('calls onRespond(token, true) when Approve is clicked', async () => {
    const onRespond = vi.fn(async () => undefined);
    render(
      <McpApprovalModal approvals={[makeApproval()]} onRespond={onRespond} />,
    );
    fireEvent.click(screen.getByTestId('mcp-approve-write'));
    await waitFor(() => {
      expect(onRespond).toHaveBeenCalledWith('abc123', true);
    });
  });

  it('calls onRespond(token, false) when Deny is clicked', async () => {
    const onRespond = vi.fn(async () => undefined);
    render(
      <McpApprovalModal approvals={[makeApproval()]} onRespond={onRespond} />,
    );
    fireEvent.click(screen.getByTestId('mcp-deny-write'));
    await waitFor(() => {
      expect(onRespond).toHaveBeenCalledWith('abc123', false);
    });
  });

  it('calls onApproveAllSession and then approves when Approve-all is clicked', async () => {
    const onRespond = vi.fn(async () => undefined);
    const onApproveAllSession = vi.fn();
    render(
      <McpApprovalModal
        approvals={[makeApproval()]}
        onRespond={onRespond}
        onApproveAllSession={onApproveAllSession}
      />,
    );
    fireEvent.click(screen.getByTestId('mcp-approve-all-session'));
    await waitFor(() => {
      expect(onApproveAllSession).toHaveBeenCalled();
      expect(onRespond).toHaveBeenCalledWith('abc123', true);
    });
  });

  it('hides the modal and auto-approves everything when sessionApproveAll=true', async () => {
    const onRespond = vi.fn(async () => undefined);
    render(
      <McpApprovalModal
        approvals={[
          makeApproval({ token: 't1' }),
          makeApproval({ token: 't2' }),
        ]}
        onRespond={onRespond}
        sessionApproveAll={true}
      />,
    );
    await waitFor(() => {
      expect(onRespond).toHaveBeenCalledWith('t1', true);
      expect(onRespond).toHaveBeenCalledWith('t2', true);
    });
    expect(
      document.querySelector('[data-testid="mcp-approval-modal"]'),
    ).toBeNull();
  });

  it('shows the "N more queued" hint when more than one approval is pending', () => {
    render(
      <McpApprovalModal
        approvals={[
          makeApproval({ token: 't1' }),
          makeApproval({ token: 't2', path: 'x.md' }),
          makeApproval({ token: 't3', path: 'y.md' }),
        ]}
        onRespond={vi.fn()}
      />,
    );
    expect(
      screen.getByTestId('mcp-approval-queue-more').textContent,
    ).toContain('2 more');
  });

  it('renders a diff when the file exists', () => {
    render(
      <McpApprovalModal
        approvals={[
          makeApproval({
            fileExists: true,
            oldPreview: 'old line',
            preview: 'new line',
          }),
        ]}
        onRespond={vi.fn()}
      />,
    );
    const preview = screen.getByTestId('mcp-approval-preview');
    expect(preview.textContent).toContain('old line');
    expect(preview.textContent).toContain('new line');
    expect(preview.textContent).toContain('-');
    expect(preview.textContent).toContain('+');
  });

  it('disables buttons while a respond callback is in flight', async () => {
    let resolve: () => void = () => {};
    const onRespond = vi.fn(
      () =>
        new Promise<void>((r) => {
          resolve = r;
        }),
    );
    render(
      <McpApprovalModal approvals={[makeApproval()]} onRespond={onRespond} />,
    );
    fireEvent.click(screen.getByTestId('mcp-approve-write'));
    await waitFor(() => {
      expect(
        (screen.getByTestId('mcp-approve-write') as HTMLButtonElement)
          .disabled,
      ).toBe(true);
    });
    // Unblock so React can finish its `finally { setBusy(false) }`.
    await act(async () => {
      resolve();
    });
  });
});
