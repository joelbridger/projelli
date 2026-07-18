/**
 * Privileged Matter Mode: the exfiltration guardrail for network-capable
 * extensions (MCP servers).
 *
 * These tests pin the guardrail's load-bearing behaviour:
 *   1. resolvePrivilegedMatterMode(): the manual toggle OR'd with the auto-on
 *      triggers (privileged active matter, Local-only), and the "forced" flag.
 *   5. McpApprovalModal: MCP is disabled in the mode: pending writes are
 *      auto-denied, never approvable, the disabled banner renders, and each
 *      block fires the audit callback.
 *   6. The status-bar badge renders when the mode is active.
 *   7. Auto-on fires for a privileged active matter (end-to-end through the
 *      stores + the reactive hook).
 *   8. No em dashes in the new user-facing copy.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const nativeRequest = vi.hoisted(() => vi.fn());
vi.mock('@/platform/privacy/nativeNetworkLockdownBridge', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/platform/privacy/nativeNetworkLockdownBridge')>();
  return { ...actual, requestNativeNetworkLockdown: nativeRequest };
});

import {
  resolvePrivilegedMatterMode,
  PRIVILEGED_MATTER_BLOCK_REASON,
  PRIVILEGED_MATTER_MODE_SETTING_KEY,
} from '@/platform/privacy/privilegedMatterMode';
import {
  usePrivilegedMatterMode,
  getPrivilegedMatterModeActive,
} from '@/platform/hooks/usePrivilegedMatterMode';
import { useSettingsStore } from '@/platform/settings/settingsStore';
import { getActiveScope, useMatterStore } from '@/platform/matter/matterStore';
import { CONFIDENTIALITY_MODE_SETTING_KEY } from '@/platform/privacy/egress';
import { McpApprovalModal } from '@/features/settings/McpApprovalModal';
import type { McpPendingApproval } from '@/platform/utils/tauri-commands';
import { StatusBar } from '@/app/shell/layout/StatusBar';
import { useWorkspaceStore } from '@/platform/fs/workspaceStore';
import { useOfflineModeStore } from '@/platform/privacy/offlineMode';
import {
  issueMatterScopeSelection,
  readSelectionOperationDecision,
  rehydrateSelectionHint,
  requestClearClientSelection,
  requestMatterScopeSelection,
} from '@/platform/client-context';
import { setDevFlagOverride } from '@/platform/flags/router';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function makeApproval(over: Partial<McpPendingApproval> = {}): McpPendingApproval {
  return {
    token: over.token ?? 'abc123',
    path: over.path ?? 'notes/secret.md',
    preview: over.preview ?? 'new content',
    fileExists: over.fileExists ?? false,
    oldPreview: over.oldPreview ?? '',
    contentBytes: over.contentBytes ?? 11,
    receivedAt: over.receivedAt ?? 1,
  };
}

async function selectMatterWithConvergedFollower(matterId: string) {
  await requestMatterScopeSelection(issueMatterScopeSelection(matterId));
  await waitFor(() => {
    expect(
      readSelectionOperationDecision({
        operationClass: 'matter-scoped',
        allowAllMatters: true,
        requireFollowerAgreement: true,
      }),
    ).toMatchObject({ kind: 'matter', matter: { id: matterId } });
  });
}

beforeEach(() => {
  globalThis.localStorage.clear();
  useSettingsStore.setState({ values: {} });
  useMatterStore.setState({ matters: [], activeMatterId: null });
  nativeRequest.mockReset();
  setDevFlagOverride('selection-authority-boot-gate', false);
  requestClearClientSelection();
  setDevFlagOverride('selection-authority-boot-gate', true);
  rehydrateSelectionHint({
    kind: 'persisted-hint',
    value: { version: 1, source: 'explicit-all-matters' },
  });
});

// ---------------------------------------------------------------------------
// 1. Pure resolver
// ---------------------------------------------------------------------------

describe('resolvePrivilegedMatterMode', () => {
  it('is off when nothing forces it and the manual toggle is off', () => {
    const r = resolvePrivilegedMatterMode({
      manual: false,
      activeMatterPrivileged: false,
      confidentialityMode: 'direct',
    });
    expect(r.active).toBe(false);
    expect(r.trigger).toBe('off');
    expect(r.forced).toBe(false);
  });

  it('is on (not forced) when only the manual toggle is set', () => {
    const r = resolvePrivilegedMatterMode({
      manual: true,
      activeMatterPrivileged: false,
      confidentialityMode: 'direct',
    });
    expect(r.active).toBe(true);
    expect(r.trigger).toBe('manual');
    expect(r.forced).toBe(false);
  });

  it('is forced on when the active matter is privileged, even with manual off', () => {
    const r = resolvePrivilegedMatterMode({
      manual: false,
      activeMatterPrivileged: true,
      confidentialityMode: 'direct',
    });
    expect(r.active).toBe(true);
    expect(r.trigger).toBe('privileged-matter');
    expect(r.forced).toBe(true);
  });

  it('is forced on in Local-only mode', () => {
    const r = resolvePrivilegedMatterMode({
      manual: false,
      activeMatterPrivileged: false,
      confidentialityMode: 'local-only',
    });
    expect(r.active).toBe(true);
    expect(r.trigger).toBe('local-only');
    expect(r.forced).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5. MCP disabled in the mode
// ---------------------------------------------------------------------------

describe('McpApprovalModal: disabled in Privileged Matter Mode', () => {
  it('auto-denies every pending write, never offers approve, shows the banner, and audits', async () => {
    const onRespond = vi.fn(async () => {});
    const onMcpBlocked = vi.fn();

    render(
      <McpApprovalModal
        approvals={[makeApproval({ token: 'tok1', path: 'matter/secret.md' })]}
        onRespond={onRespond}
        onApproveAllSession={() => {}}
        privilegedMatterMode
        onMcpBlocked={onMcpBlocked}
      />,
    );

    // Auto-denied (approved=false) and audited.
    await waitFor(() => {
      expect(onRespond).toHaveBeenCalledWith('tok1', false);
    });
    expect(onMcpBlocked).toHaveBeenCalledWith('matter/secret.md');

    // The disabled banner shows and there is NO approve button.
    expect(screen.getByTestId('mcp-approval-blocked-banner')).toBeInTheDocument();
    expect(screen.queryByTestId('mcp-approve-write')).not.toBeInTheDocument();
    expect(screen.queryByTestId('mcp-approve-all-session')).not.toBeInTheDocument();
  });

  it('does NOT auto-deny when the mode is off (normal approval flow shows the approve button)', () => {
    const onRespond = vi.fn(async () => {});
    render(
      <McpApprovalModal
        approvals={[makeApproval({ token: 'tok2' })]}
        onRespond={onRespond}
        privilegedMatterMode={false}
      />,
    );
    expect(onRespond).not.toHaveBeenCalled();
    expect(screen.getByTestId('mcp-approve-write')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 6 + 7. Status-bar badge + auto-on for a privileged active matter
// ---------------------------------------------------------------------------

/** A tiny probe component that surfaces the reactive hook for assertions. */
function ModeProbe() {
  const mode = usePrivilegedMatterMode();
  return (
    <div
      data-testid="probe"
      data-active={mode.active ? 'true' : 'false'}
      data-forced={mode.forced ? 'true' : 'false'}
      data-trigger={mode.trigger}
    />
  );
}

describe('Privileged Matter Mode activation (reactive hook + stores)', () => {
  it('is off by default', () => {
    render(<ModeProbe />);
    expect(screen.getByTestId('probe').getAttribute('data-active')).toBe('false');
  });

  it('turns on automatically when the authoritative matter-only selection is privileged', async () => {
    const matter = useMatterStore.getState().createMatter({
      name: 'Acme v. Beta',
      client: 'Acme',
      privileged: true,
    });
    await selectMatterWithConvergedFollower(matter.id);

    render(<ModeProbe />);
    const probe = screen.getByTestId('probe');
    expect(probe.getAttribute('data-active')).toBe('true');
    expect(probe.getAttribute('data-forced')).toBe('true');
    expect(probe.getAttribute('data-trigger')).toBe('privileged-matter');
  });

  it('turns on automatically in Local-only confidentiality mode', () => {
    useSettingsStore.getState().setSetting(CONFIDENTIALITY_MODE_SETTING_KEY, 'local-only');
    render(<ModeProbe />);
    expect(screen.getByTestId('probe').getAttribute('data-trigger')).toBe('local-only');
  });

  it('the non-reactive read agrees with the reactive resolver (privileged active matter)', async () => {
    const matter = useMatterStore.getState().createMatter({
      name: 'M', client: 'C', privileged: true,
    });
    await selectMatterWithConvergedFollower(matter.id);
    expect(getPrivilegedMatterModeActive()).toBe(true);
  });

  it('keeps an unlinked, non-privileged matter-only selection unforced', async () => {
    const matter = useMatterStore.getState().createMatter({
      name: 'Unlinked', client: 'Unlinked', privileged: false,
    });
    await selectMatterWithConvergedFollower(matter.id);

    const decision = readSelectionOperationDecision({
        operationClass: 'matter-scoped',
        allowAllMatters: true,
        requireFollowerAgreement: true,
      });
    expect(decision).toMatchObject({ kind: 'matter', sourceKind: 'matter-only' });
    expect(getPrivilegedMatterModeActive()).toBe(false);
  });

  it('fails protected when source selection is blocked', () => {
    rehydrateSelectionHint({
      kind: 'persisted-hint',
      value: { version: 1, source: 'blocked/refused' },
    });

    render(<ModeProbe />);
    expect(screen.getByTestId('probe')).toHaveAttribute('data-active', 'true');
    expect(getPrivilegedMatterModeActive()).toBe(true);
  });

  it('uses follower disagreement only to strengthen protection', async () => {
    const matter = useMatterStore.getState().createMatter({
      name: 'Unlinked', client: 'Unlinked', privileged: false,
    });
    await selectMatterWithConvergedFollower(matter.id);
    useMatterStore.setState({ activeMatterId: null });

    expect(() => getActiveScope()).toThrow('still catching up');
    render(<ModeProbe />);
    expect(screen.getByTestId('probe')).toHaveAttribute('data-active', 'true');
    expect(getPrivilegedMatterModeActive()).toBe(true);
  });

  it('setMatterPrivileged arms the native guard for the authoritative matter-only selection', async () => {
    const matter = useMatterStore.getState().createMatter({
      name: 'Unlinked', client: 'Unlinked', privileged: false,
    });
    await selectMatterWithConvergedFollower(matter.id);
    nativeRequest.mockClear();

    useMatterStore.getState().setMatterPrivileged(matter.id, true);

    expect(nativeRequest).toHaveBeenCalledWith(true);
    expect(useMatterStore.getState().matters.find((item) => item.id === matter.id)?.privileged).toBe(true);
  });

  it('setMatterPrivileged stays armed when the selection is blocked or disagrees', async () => {
    const matter = useMatterStore.getState().createMatter({
      name: 'Unlinked', client: 'Unlinked', privileged: false,
    });
    await selectMatterWithConvergedFollower(matter.id);
    useMatterStore.setState({ activeMatterId: null });
    nativeRequest.mockClear();

    useMatterStore.getState().setMatterPrivileged(matter.id, true);

    expect(nativeRequest).toHaveBeenCalledWith(true);
  });

  it('setMatterPrivileged also stays armed for blocked-unresolved source state', () => {
    const matter = useMatterStore.getState().createMatter({
      name: 'Unlinked', client: 'Unlinked', privileged: false,
    });
    rehydrateSelectionHint({
      kind: 'persisted-hint',
      value: { version: 1, source: 'blocked/refused' },
    });
    nativeRequest.mockClear();

    useMatterStore.getState().setMatterPrivileged(matter.id, true);

    expect(nativeRequest).toHaveBeenCalledWith(true);
  });

  it('manual toggle alone activates it (non-reactive read)', () => {
    useSettingsStore.getState().setSetting(PRIVILEGED_MATTER_MODE_SETTING_KEY, true);
    expect(getPrivilegedMatterModeActive()).toBe(true);
  });
});

describe('StatusBar: Privileged Matter Mode badge', () => {
  it('renders the persistent badge when the mode is active and a matter is open', async () => {
    // Badge requires both the mode active AND an active matter (it only makes
    // sense to show it when scoped to a specific matter).
    const matter = useMatterStore.getState().createMatter({ name: 'Test', client: 'C' });
    await selectMatterWithConvergedFollower(matter.id);
    useSettingsStore.getState().setSetting(PRIVILEGED_MATTER_MODE_SETTING_KEY, true);
    useOfflineModeStore.setState({
      offlineMode: true,
      generation: 1,
      hydrated: true,
      loadError: null,
      statusKnown: true,
      changePending: false,
      changeError: null,
    });
    render(<StatusBar />);
    const badge = screen.getByTestId('privileged-matter-badge');
    expect(badge).toBeInTheDocument();
    // The visible badge stays short in the simplified status bar; the hover
    // text keeps the fuller explanation.
    expect(badge.textContent).toContain('Isolated client');
    expect(badge).toHaveAttribute(
      'title',
      'Network lockdown: network plugins and MCP servers are disabled.',
    );
  });

  it('does not render the badge when the mode is off', () => {
    useWorkspaceStore.setState({ rootPath: null });
    render(<StatusBar />);
    expect(screen.queryByTestId('privileged-matter-badge')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 8. No em dashes in the new copy
// ---------------------------------------------------------------------------

describe('copy hygiene', () => {
  it('the block reason contains no em dash', () => {
    expect(PRIVILEGED_MATTER_BLOCK_REASON.includes('—')).toBe(false);
  });
});
