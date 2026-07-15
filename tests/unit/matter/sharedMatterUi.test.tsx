/**
 * sharedMatterUi.test.tsx — Task 3 acceptance tests.
 *
 * Tests:
 *   1. Solo regression: no firm session -> MatterManagerDialog renders no firm UI.
 *   2. Share flow happy path: createMatter -> getOrCreateMatterKey -> registerDevice
 *      -> publishMatterKeyToMembers sequence fires in order + links the matter.
 *   3. Open-shared: obtainMatterKey returns null -> fail-closed message, no
 *      local matter created.
 *   4. Invite flow: new user branch (createUser + addMatterMember + re-publish).
 *   5. Invite flow: existing user (409 from createUser) -> error surfaced.
 *   6. i18n: new keys exist in all three locales.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { useMatterStore } from '@/platform/matter/matterStore';
import { useFirmStore } from '@/platform/firm/firmStore';
import { useMatterSyncStore } from '@/platform/matter/matterSyncStore';
import { deCatalog as de, enCatalog as en, esCatalog as es } from '@/i18nCatalogs';

// ── Mock Tauri keychain (firm modules need it) ───────────────────────────────
const keychainStore = new Map<string, string>();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (cmd: string, args: Record<string, unknown> = {}) => {
    const svc = (args['service'] as string) ?? 'com.keepance.app';
    const key = args['key'] as string;
    const id = `${svc}::${key}`;
    if (cmd === 'keychain_set') { keychainStore.set(id, args['value'] as string); return undefined; }
    if (cmd === 'keychain_get') {
      if (!keychainStore.has(id)) throw { kind: 'notFound', message: 'no entry' };
      return keychainStore.get(id);
    }
    if (cmd === 'keychain_delete') { keychainStore.delete(id); return undefined; }
    throw new Error(`unexpected invoke ${cmd}`);
  }),
  isTauri: () => true,
}));

// ── Mock CORS-safe fetch ─────────────────────────────────────────────────────
const fetchMock = vi.fn();
vi.mock('@/platform/providers/fetchUtils', () => ({
  getCorsSafeFetch: async () => fetchMock as unknown as typeof fetch,
}));

// ── Mock AuditService so it doesn't blow up on audit.append calls ────────────
vi.mock('@/platform/audit/AuditService', () => ({
  AuditService: class {
    append() { /* noop */ }
  },
  isAuditEncrypted: () => false,
}));

// ── Mock useFirm so tests can control the firm session state ──────────────────
// This avoids fighting with the persist middleware and getState() snapshots.
let firmSessionMock = { isSignedIn: false, hasActiveSeat: false, role: null as string | null, org: null as { org_id: string } | null };

vi.mock('@/platform/hooks/useFirm', () => ({
  useFirm: () => ({
    isSignedIn: firmSessionMock.isSignedIn,
    hasActiveSeat: firmSessionMock.hasActiveSeat,
    role: firmSessionMock.role,
    org: firmSessionMock.org,
    email: null,
    seatId: null,
    entitlement: { aiEnabled: firmSessionMock.hasActiveSeat },
    isOffline: false,
    isLoading: false,
    error: null,
    assuredProviders: [],
    signIn: async () => ({ ok: true }),
    activateSeat: async () => ({ ok: true }),
    signOut: async () => undefined,
  }),
  useAssuredAvailable: () => false,
}));

// ── Mock mail commands (no real IPC in tests) ─────────────────────────────────
vi.mock('@/platform/utils/mail-commands', () => ({
  mailListMessages: async () => ({ items: [], total: 0 }),
  mailConnectedAccounts: async () => [],
  // deleteMatter clears a deleted matter's email filings (BUG-042).
  mailClearMatterFilings: async () => 0,
}));

// ── Mock workspace store ──────────────────────────────────────────────────────
vi.mock('@/platform/fs/workspaceStore', () => ({
  useWorkspaceStore: (sel: (s: { rootPath: string | null; fileTree: unknown[] }) => unknown) =>
    sel({ rootPath: null, fileTree: [] }),
}));

// ── Mock the firm key service functions ──────────────────────────────────────
const mockGetOrCreateMatterKey = vi.fn<(matterId: string) => Promise<string>>();
const mockPublishMatterKeyToMembers = vi.fn<
  (session: unknown, matterId: string, n: number) => Promise<{ published: number; skippedWalled: number }>
>();
const mockObtainMatterKey = vi.fn<(session: unknown, matterId: string) => Promise<string | null>>();
const mockRegisterDevice = vi.fn<(session: unknown) => Promise<void>>();

vi.mock('@/platform/firm/matterKeyService', () => ({
  getOrCreateMatterKey: (...args: [string]) => mockGetOrCreateMatterKey(...args),
  publishMatterKeyToMembers: (...args: [unknown, string, number]) => mockPublishMatterKeyToMembers(...args),
  obtainMatterKey: (...args: [unknown, string]) => mockObtainMatterKey(...args),
}));

vi.mock('@/platform/firm/deviceKeys', () => ({
  registerDevice: (...args: [unknown]) => mockRegisterDevice(...args),
  _resetDeviceCache: () => undefined,
  getOrCreateDeviceKeypair: async () => ({ deviceId: 'test-device-id', publicJwk: {} }),
}));

// ── Import the component after mocks are in place ─────────────────────────────
import { MatterManagerDialog } from '@/features/matters/MatterManagerDialog';

// ── Helpers ───────────────────────────────────────────────────────────────────

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function resetStores() {
  useMatterStore.setState({ matters: [], activeMatterId: null });
  useFirmStore.setState({
    session: null,
    accessToken: null,
    seatToken: null,
    seatPublicKeyPem: null,
    serverVerdict: 'unknown',
    offlineSeatValid: false,
    isOffline: false,
    isLoading: false,
    error: null,
    assuredProviders: [],
  });
  useMatterSyncStore.setState({ statusByMatterId: {} });
  keychainStore.clear();
  // Reset firm session mock to solo mode
  firmSessionMock = { isSignedIn: false, hasActiveSeat: false, role: null, org: null };
}

function signInAdmin() {
  // Set both the store and the mock so the component sees firm session
  useFirmStore.setState({
    session: {
      userId: 'user-admin',
      email: 'admin@law.com',
      role: 'admin',
      org: { org_id: 'org-1', name: 'Law Firm', plan: 'practice', packs: [], seat_limit: 5 },
      seatId: 'seat-1',
      tier: 'practice',
      packs: [],
      seats: 5,
      lastValidatedAt: new Date().toISOString(),
      activated: true,
    },
    accessToken: 'ACCESS_JWT',
    seatToken: 'SEAT_TOKEN',
    serverVerdict: 'valid',
    offlineSeatValid: true,
    isOffline: false,
  });
  firmSessionMock = {
    isSignedIn: true,
    hasActiveSeat: true,
    role: 'admin',
    org: { org_id: 'org-1' },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 1: Solo regression
// ─────────────────────────────────────────────────────────────────────────────

describe('MatterManagerDialog — solo mode (no firm session)', () => {
  beforeEach(resetStores);

  it('renders without any firm UI sections', async () => {
    // Add a local matter
    useMatterStore.getState().createMatter({ name: 'Acme v. Beta', client: 'Acme' });
    const [matter] = useMatterStore.getState().matters;

    render(
      <MatterManagerDialog
        open={true}
        onOpenChange={() => undefined}
        focusMatterId={useMatterStore.getState().matters[0]?.id ?? null}
      />,
    );

    // The dialog renders
    expect(screen.getByTestId('matter-manager-dialog')).toBeInTheDocument();

    // The matter row renders
    expect(screen.getByTestId(`matter-row-${matter!.id}`)).toBeInTheDocument();

    // No firm sections should exist
    expect(screen.queryByTestId(`firm-section-${matter!.id}`)).not.toBeInTheDocument();
    expect(screen.queryByTestId('firm-shared-mine-section')).not.toBeInTheDocument();
    expect(screen.queryByTestId('firm-refresh-mine')).not.toBeInTheDocument();
  });

  it('is a settings dialog: no create form (creating a client lives in NewClientDialog)', () => {
    render(
      <MatterManagerDialog
        open={true}
        onOpenChange={() => undefined}
        focusMatterId={useMatterStore.getState().matters[0]?.id ?? null}
      />,
    );
    // The heavy create form was moved out of the manager (feedback line 14):
    // the manager is now the per-client settings surface only.
    expect(screen.queryByTestId('matter-new-name')).not.toBeInTheDocument();
    expect(screen.queryByTestId('matter-create-button')).not.toBeInTheDocument();
    expect(screen.queryByTestId('matter-new-client-helper')).not.toBeInTheDocument();
    // Firm mine section absent (no firm session).
    expect(screen.queryByTestId('firm-shared-mine-section')).not.toBeInTheDocument();
  });

  it('shows folder + email mapping when a client is expanded', () => {
    useMatterStore.getState().createMatter({ name: 'Acme v. Beta', client: 'Acme' });
    const matter = useMatterStore.getState().matters[0]!;
    render(
      <MatterManagerDialog
        open={true}
        onOpenChange={() => undefined}
        focusMatterId={matter.id}
      />,
    );
    // The client's own name field is still editable inside its settings panel.
    expect(screen.getByTestId(`matter-name-${matter.id}`)).toBeInTheDocument();
    expect(screen.getByTestId(`matter-client-${matter.id}`)).toBeInTheDocument();
  });

  it('pressing Escape closes only the matter manager dialog', async () => {
    const onOpenChange = vi.fn();
    render(<MatterManagerDialog open={true} onOpenChange={onOpenChange} />);

    expect(screen.getByTestId('matter-manager-dialog')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape', bubbles: true });

    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
    expect(onOpenChange).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 2: Share flow happy path
// ─────────────────────────────────────────────────────────────────────────────

describe('MatterManagerDialog — share flow', () => {
  beforeEach(() => {
    resetStores();
    signInAdmin();
  });

  it('share: calls createMatter -> getOrCreateMatterKey -> registerDevice -> publishMatterKeyToMembers in sequence and links matter', async () => {
    // Set up a local matter
    useMatterStore.getState().createMatter({ name: 'Acme v. Beta', client: 'Acme Corp' });
    const [matter] = useMatterStore.getState().matters;
    expect(matter).toBeDefined();

    const callOrder: string[] = [];

    // Mock /matter/mine (initial load, happens first in useEffect)
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { matters: [] }));

    // Mock the FirmApiClient createMatter call (happens when user clicks Share)
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        matter: {
          matter_id: 'firm-matter-1',
          org_id: 'org-1',
          client_name: 'Acme Corp',
          status: 'active',
          key_epoch: 1,
          created_at: new Date().toISOString(),
        },
      }),
    );

    mockGetOrCreateMatterKey.mockImplementationOnce(async () => {
      callOrder.push('getOrCreateMatterKey');
      return 'base64-key';
    });

    mockRegisterDevice.mockImplementationOnce(async () => {
      callOrder.push('registerDevice');
    });

    mockPublishMatterKeyToMembers.mockImplementationOnce(async () => {
      callOrder.push('publishMatterKeyToMembers');
      return { published: 1, skippedWalled: 0 };
    });

    render(
      <MatterManagerDialog
        open={true}
        onOpenChange={() => undefined}
        focusMatterId={matter!.id}
      />,
    );

    // Wait for the firm section to appear (client row is expanded via focus)
    await waitFor(() => {
      expect(screen.getByTestId(`firm-section-${matter!.id}`)).toBeInTheDocument();
    });

    // Click the share button
    const shareBtn = screen.getByTestId(`firm-share-${matter!.id}`);
    await act(async () => {
      fireEvent.click(shareBtn);
    });

    // Wait for the share to complete (button changes to "Shared with my firm")
    await waitFor(() => {
      const m = useMatterStore.getState().matters.find((x) => x.id === matter!.id);
      expect(m?.shared).toBe(true);
    });

    // Sequence check
    expect(callOrder).toEqual([
      'getOrCreateMatterKey',
      'registerDevice',
      'publishMatterKeyToMembers',
    ]);

    // Matter is linked
    const linked = useMatterStore.getState().matters.find((m) => m.id === matter!.id);
    expect(linked?.firmMatterId).toBe('firm-matter-1');
    expect(linked?.orgId).toBe('org-1');
    expect(linked?.role).toBe('owner');
    expect(linked?.shared).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 3: Open-shared with obtainMatterKey returning null (fail-closed)
// ─────────────────────────────────────────────────────────────────────────────

describe('MatterManagerDialog — open-shared fail-closed', () => {
  beforeEach(() => {
    resetStores();
    signInAdmin();
  });

  it('shows friendly fail-closed message when obtainMatterKey returns null, no local matter created', async () => {
    // Set up a remote shared matter in /matter/mine
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        matters: [
          {
            matter_id: 'remote-matter-1',
            client_name: 'Remote Client',
            status: 'active',
            key_epoch: 1,
            role: 'viewer',
          },
        ],
      }),
    );

    // obtainMatterKey returns null (walled or no key published)
    mockObtainMatterKey.mockResolvedValueOnce(null);

    render(
      <MatterManagerDialog
        open={true}
        onOpenChange={() => undefined}
        focusMatterId={useMatterStore.getState().matters[0]?.id ?? null}
      />,
    );

    // Wait for the remote matter to appear
    await waitFor(() => {
      expect(screen.getByTestId('firm-remote-matter-remote-matter-1')).toBeInTheDocument();
    });

    const openBtn = screen.getByTestId('firm-open-remote-remote-matter-1');
    await act(async () => {
      fireEvent.click(openBtn);
    });

    // Fail-closed message appears
    await waitFor(() => {
      expect(screen.getByTestId('firm-open-error')).toBeInTheDocument();
    });

    const errorEl = screen.getByTestId('firm-open-error');
    // F-123: changed from error to pending-state copy
    expect(errorEl.textContent).toContain("Waiting for your firm admin");

    // No local matter was created
    expect(useMatterStore.getState().matters).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 4: Invite flow — new user branch
// ─────────────────────────────────────────────────────────────────────────────

describe('MatterManagerDialog — invite flow', () => {
  beforeEach(() => {
    resetStores();
    signInAdmin();
  });

  it('invite: new user path calls createUser + addMatterMember + publishMatterKeyToMembers', async () => {
    // Pre-create a shared matter locally
    useMatterStore.getState().createMatter({
      name: 'Shared Matter',
      client: 'Client Corp',
      firmMatterId: 'firm-matter-1',
      orgId: 'org-1',
      role: 'owner',
      shared: true,
    });
    const [matter] = useMatterStore.getState().matters;

    const apiCalls: string[] = [];

    // /matter/mine returns nothing (no remote unlinked matters)
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { matters: [] }));

    // listMatterMembers for the roster
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        matter_id: 'firm-matter-1',
        key_epoch: 1,
        members: [],
        walls: [],
      }),
    );

    render(
      <MatterManagerDialog
        open={true}
        onOpenChange={() => undefined}
        focusMatterId={useMatterStore.getState().matters[0]?.id ?? null}
      />,
    );

    // Expand the firm section (it shows "Shared with my firm")
    await waitFor(() => {
      expect(screen.getByTestId(`firm-section-${matter!.id}`)).toBeInTheDocument();
    });

    // Toggle the member roster
    const toggleBtn = screen.getByTestId(`firm-toggle-roster-${matter!.id}`);
    await act(async () => {
      fireEvent.click(toggleBtn);
    });

    // Wait for the invite input to appear
    await waitFor(() => {
      expect(screen.getByTestId(`firm-invite-email-${matter!.id}`)).toBeInTheDocument();
    });

    // Type an email
    const emailInput = screen.getByTestId(`firm-invite-email-${matter!.id}`);
    fireEvent.change(emailInput, { target: { value: 'newuser@law.com' } });

    // Mock createUser (new user created successfully)
    fetchMock.mockImplementationOnce(async () => {
      apiCalls.push('createUser');
      return jsonResponse(200, {
        user: { user_id: 'user-new', email: 'newuser@law.com', role: 'member', status: 'active', created_at: 'now' },
      });
    });

    // Mock addMatterMember
    fetchMock.mockImplementationOnce(async () => {
      apiCalls.push('addMatterMember');
      return jsonResponse(200, { ok: true, key_epoch: 1, key_release: 'release_to_member' });
    });

    // publishMatterKeyToMembers called after add
    mockPublishMatterKeyToMembers.mockImplementationOnce(async () => {
      apiCalls.push('publishMatterKeyToMembers');
      return { published: 2, skippedWalled: 0 };
    });

    // Mock the member list reload
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        matter_id: 'firm-matter-1',
        key_epoch: 1,
        members: [
          { matter_id: 'firm-matter-1', user_id: 'user-new', email: 'newuser@law.com', org_id: 'org-1', role: 'editor', created_at: 'now' },
        ],
        walls: [],
      }),
    );

    const inviteBtn = screen.getByTestId(`firm-invite-submit-${matter!.id}`);
    await act(async () => {
      fireEvent.click(inviteBtn);
    });

    // Wait for API calls to complete
    await waitFor(() => {
      expect(apiCalls).toContain('addMatterMember');
    });

    // publishMatterKeyToMembers was called after add
    expect(apiCalls).toEqual(
      expect.arrayContaining(['createUser', 'addMatterMember', 'publishMatterKeyToMembers']),
    );
  });

  it('invite: existing user (409) shows error', async () => {
    useMatterStore.getState().createMatter({
      name: 'Shared Matter',
      client: 'Client Corp',
      firmMatterId: 'firm-matter-2',
      orgId: 'org-1',
      role: 'owner',
      shared: true,
    });
    const [matter] = useMatterStore.getState().matters;

    // /matter/mine
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { matters: [] }));
    // listMatterMembers
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { matter_id: 'firm-matter-2', key_epoch: 1, members: [], walls: [] }),
    );

    render(
      <MatterManagerDialog
        open={true}
        onOpenChange={() => undefined}
        focusMatterId={useMatterStore.getState().matters[0]?.id ?? null}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId(`firm-section-${matter!.id}`)).toBeInTheDocument();
    });

    const toggleBtn = screen.getByTestId(`firm-toggle-roster-${matter!.id}`);
    await act(async () => { fireEvent.click(toggleBtn); });

    await waitFor(() => {
      expect(screen.getByTestId(`firm-invite-email-${matter!.id}`)).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId(`firm-invite-email-${matter!.id}`), {
      target: { value: 'existing@law.com' },
    });

    // createUser returns 409 (user already exists)
    fetchMock.mockImplementationOnce(async () =>
      jsonResponse(409, { error: 'conflict', detail: 'email already taken' }),
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId(`firm-invite-submit-${matter!.id}`));
    });

    await waitFor(() => {
      expect(screen.getByTestId(`firm-member-error-${matter!.id}`)).toBeInTheDocument();
    });

    const errEl = screen.getByTestId(`firm-member-error-${matter!.id}`);
    expect(errEl.textContent).toContain('already has an account');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 5: i18n parity — new keys exist in all three locales
// ─────────────────────────────────────────────────────────────────────────────

describe('i18n parity — new firm/matter keys', () => {
  // Required new matter.manager keys
  const NEW_MATTER_MANAGER_KEYS = [
    'firm-share-section',
    'firm-shared-section',
    'firm-share-action',
    'firm-shared-badge',
    'firm-members-label',
    'firm-invite-label',
    'firm-invite-action',
    'firm-invite-placeholder',
    'firm-open-shared-section',
    'firm-open-action',
    'firm-key-blocked',
    'firm-share-error',
    'firm-open-error',
    'firm-invite-error',
    'firm-remove-error',
    'firm-leave-error',
    'firm-temp-password-label',
    'firm-temp-password-hint',
    'firm-walled-badge',
    'firm-leave-action',
    'firm-leave-hint',
    'firm-members-loading',
    'firm-members-empty',
    'firm-remove-member-action',
    'firm-inviting',
    'firm-opening',
    'firm-open-shared-empty',
    'firm-open-shared-loading',
    'firm-sharing',
    'firm-owner-badge',
    'firm-editor-badge',
    'firm-viewer-badge',
    'firm-invite-new-user-hint',
    'firm-remove-member-confirm',
    'firm-leave-confirm',
    'firm-leave-confirm-action',
  ];

  // Required new matter.sync keys
  const SYNC_KEYS = [
    'live-tooltip',
    'offline-tooltip',
    'error-tooltip',
    'connecting-tooltip',
    'catching-up-tooltip',
  ];

  // Required new firm.admin keys
  const FIRM_ADMIN_KEYS = [
    'title',
    'refresh',
    'not-admin',
    'matters-section',
    'new-matter-label',
    'new-matter-placeholder',
    'create-matter',
    'matter-created',
    'no-matters',
    'epoch-label',
    'members-section',
    'invite-label',
    'invite-placeholder',
    'invite-action',
    'inviting',
    'invite-ok',
    'invite-new-user-hint',
    'temp-password-label',
    'temp-password-hint',
    'wall-label',
    'wall-placeholder',
    'wall-action',
    'wall-ok',
    'members-epoch',
    'remove-member-action',
    'remove-member-ok',
    'walls-label',
    'clear-wall-action',
    'clear-wall-ok',
    'seats-section',
    'no-seats',
    'unnamed-device',
    'inactive-label',
    'revoke-seat-action',
    'revoke-seat-ok',
    'assured-section',
    'assured-description',
    'provider-label',
    'api-key-label',
    'save-key-action',
    'save-key-ok',
    'no-keys',
    'delete-key-action',
    'delete-key-ok',
    'user-id-fallback',
  ];

  type LocaleType = { matter?: { manager?: Record<string, unknown>; sync?: Record<string, unknown> }; firm?: { admin?: Record<string, unknown> } };

  const locales: Array<[string, LocaleType]> = [
    ['en', en as LocaleType],
    ['es', es as LocaleType],
    ['de', de as LocaleType],
  ];

  for (const [lang, catalog] of locales) {
    it(`[${lang}] matter.manager has all new firm-sharing keys`, () => {
      const mgr = catalog.matter?.manager ?? {};
      for (const key of NEW_MATTER_MANAGER_KEYS) {
        expect(
          Object.prototype.hasOwnProperty.call(mgr, key),
          `${lang}: missing matter.manager.${key}`,
        ).toBe(true);
      }
    });

    it(`[${lang}] matter.sync has all sync badge keys`, () => {
      const sync = catalog.matter?.sync ?? {};
      for (const key of SYNC_KEYS) {
        expect(
          Object.prototype.hasOwnProperty.call(sync, key),
          `${lang}: missing matter.sync.${key}`,
        ).toBe(true);
      }
    });

    it(`[${lang}] firm.admin has all admin console keys`, () => {
      const admin = catalog.firm?.admin ?? {};
      for (const key of FIRM_ADMIN_KEYS) {
        expect(
          Object.prototype.hasOwnProperty.call(admin, key),
          `${lang}: missing firm.admin.${key}`,
        ).toBe(true);
      }
    });
  }
});
