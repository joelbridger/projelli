/**
 * reimaginedMattersHome.test.tsx
 *
 * Acceptance tests for B1 (sample-matter badge) and B4 (visible quick-actions).
 *
 * B1: When a matter has isSample===true, a "Sample" pill is visible on its row
 *     in ReimaginedMattersHome and in MatterManagerDialog. The delete button in
 *     MatterManagerDialog shows a confirm dialog before deleting the sample matter.
 *
 * B4: The Ask / Documents / Email quick-action buttons are present in the DOM
 *     at rest (not hidden via height:0 or display:none), keyboard-focusable,
 *     and have correct aria-labels.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useMatterStore, SAMPLE_MATTER_ID } from '@/stores/matterStore';

// ── Mail commands (async probes used by GetStartedCard) ───────────────────────
vi.mock('@/utils/mail-commands', () => ({
  mailIsConnected: async () => false,
  gmailIsConnected: async () => false,
  mailImapIsConnected: async () => false,
  mailConnectedAccounts: async () => [],
}));

// ── useApiKeys ─────────────────────────────────────────────────────────────────
vi.mock('@/hooks/useApiKeys', () => ({
  useApiKeys: () => ({ apiKeys: [] }),
}));

// ── matterLabel falls through to actual implementation ─────────────────────────
// (pure function, no side effects)

// ── useFirm (no firm session in these tests) ──────────────────────────────────
vi.mock('@/hooks/useFirm', () => ({
  useFirm: () => ({
    isSignedIn: false,
    hasActiveSeat: false,
    role: null,
    org: null,
    email: null,
    seatId: null,
    entitlement: { aiEnabled: false },
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

// ── Workspace store (empty tree) ───────────────────────────────────────────────
vi.mock('@/stores/workspaceStore', () => ({
  useWorkspaceStore: (sel: (s: { rootPath: string | null; fileTree: unknown[] }) => unknown) =>
    sel({ rootPath: null, fileTree: [] }),
}));

// ── Tauri keychain (firm module deps) ─────────────────────────────────────────
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async () => { throw new Error('not in test'); }),
  isTauri: () => false,
}));

// ── AuditService ───────────────────────────────────────────────────────────────
vi.mock('@/modules/audit/AuditService', () => ({
  AuditService: class { append() {} },
  isAuditEncrypted: () => false,
}));

// ── firm key service ───────────────────────────────────────────────────────────
vi.mock('@/modules/firm/matterKeyService', () => ({
  getOrCreateMatterKey: async () => 'key',
  publishMatterKeyToMembers: async () => ({ published: 0, skippedWalled: 0 }),
  obtainMatterKey: async () => null,
}));

vi.mock('@/modules/firm/deviceKeys', () => ({
  registerDevice: async () => undefined,
  _resetDeviceCache: () => undefined,
  getOrCreateDeviceKeypair: async () => ({ deviceId: 'test', publicJwk: {} }),
}));

vi.mock('@/modules/models/fetchUtils', () => ({
  getCorsSafeFetch: async () => vi.fn(),
}));

// ── Import components after mocks ──────────────────────────────────────────────
import { ReimaginedMattersHome } from '@/components/matter/ReimaginedMattersHome';
import { MatterManagerDialog } from '@/components/matter/MatterManagerDialog';

function resetStore() {
  useMatterStore.setState({ matters: [], activeMatterId: null });
}

// ─────────────────────────────────────────────────────────────────────────────
// B1 — Sample pill in ReimaginedMattersHome
// ─────────────────────────────────────────────────────────────────────────────

describe('ReimaginedMattersHome — B1 sample badge', () => {
  beforeEach(resetStore);

  it('shows the Sample pill on a matter with isSample===true', () => {
    useMatterStore.getState().createMatter({
      name: 'Roberto Garcia',
      client: 'Roberto Garcia',
      isSample: true,
    });
    // Force the id to the canonical SAMPLE_MATTER_ID for the testid lookup
    const matters = useMatterStore.getState().matters;
    const sampleMatter = matters[0]!;

    render(<ReimaginedMattersHome />);

    // The row should be in the DOM
    expect(screen.getByTestId(`reimagined-matter-row-${sampleMatter.id}`)).toBeInTheDocument();
    // The Sample pill should appear
    expect(screen.getByTestId('sample-matter-pill')).toBeInTheDocument();
    expect(screen.getByTestId('sample-matter-pill').textContent).toBe('Sample');
  });

  it('does not show a Sample pill on a normal matter', () => {
    useMatterStore.getState().createMatter({ name: 'Normal Matter', client: 'Client' });

    render(<ReimaginedMattersHome />);

    expect(screen.queryByTestId('sample-matter-pill')).not.toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B4 — Quick-actions visible at rest in ReimaginedMattersHome
// ─────────────────────────────────────────────────────────────────────────────

describe('ReimaginedMattersHome — B4 quick-actions visible at rest', () => {
  beforeEach(resetStore);

  it('renders Ask / Documents / Email buttons in the DOM (not hidden) for each matter', () => {
    useMatterStore.getState().createMatter({ name: 'Acme v. Beta', client: 'Acme' });
    const matter = useMatterStore.getState().matters[0]!;

    render(<ReimaginedMattersHome />);

    // All three buttons must exist in the DOM
    const askBtn = screen.getByTestId(`matter-launch-ask-${matter.id}`);
    const docsBtn = screen.getByTestId(`matter-launch-documents-${matter.id}`);
    const emailBtn = screen.getByTestId(`matter-launch-email-${matter.id}`);

    expect(askBtn).toBeInTheDocument();
    expect(docsBtn).toBeInTheDocument();
    expect(emailBtn).toBeInTheDocument();

    // Must not be aria-hidden
    expect(askBtn.closest('[aria-hidden="true"]')).toBeNull();
    expect(docsBtn.closest('[aria-hidden="true"]')).toBeNull();
    expect(emailBtn.closest('[aria-hidden="true"]')).toBeNull();
  });

  it('quick-action buttons have correct aria-labels', () => {
    useMatterStore.getState().createMatter({ name: 'Smith v. Jones', client: 'Smith' });
    const matter = useMatterStore.getState().matters[0]!;

    render(<ReimaginedMattersHome />);

    const askBtn = screen.getByTestId(`matter-launch-ask-${matter.id}`);
    const docsBtn = screen.getByTestId(`matter-launch-documents-${matter.id}`);
    const emailBtn = screen.getByTestId(`matter-launch-email-${matter.id}`);

    expect(askBtn.getAttribute('aria-label')).toContain('Ask AI about');
    expect(docsBtn.getAttribute('aria-label')).toContain('Open documents for');
    expect(emailBtn.getAttribute('aria-label')).toContain('Open email for');
  });

  it('quick-action buttons are real <button> elements (keyboard-focusable)', () => {
    useMatterStore.getState().createMatter({ name: 'Focus Test', client: 'Client' });
    const matter = useMatterStore.getState().matters[0]!;

    render(<ReimaginedMattersHome />);

    const askBtn = screen.getByTestId(`matter-launch-ask-${matter.id}`);
    expect(askBtn.tagName).toBe('BUTTON');
    expect(askBtn.getAttribute('type')).toBe('button');
    // Should not have tabindex=-1 which would exclude from tab order
    expect(askBtn.getAttribute('tabindex')).not.toBe('-1');
  });

  it('quick-action click dispatches keepance:matter-launch with correct surface', () => {
    useMatterStore.getState().createMatter({ name: 'Launch Test', client: 'Client' });
    const matter = useMatterStore.getState().matters[0]!;

    const events: CustomEvent[] = [];
    const handler = (e: Event) => { events.push(e as CustomEvent); };
    window.addEventListener('keepance:matter-launch', handler);

    render(<ReimaginedMattersHome />);

    fireEvent.click(screen.getByTestId(`matter-launch-ask-${matter.id}`));
    expect(events).toHaveLength(1);
    expect(events[0]!.detail.surface).toBe('search');
    expect(events[0]!.detail.matterId).toBe(matter.id);

    window.removeEventListener('keepance:matter-launch', handler);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B1 — Sample badge + confirmed delete in MatterManagerDialog
// ─────────────────────────────────────────────────────────────────────────────

describe('MatterManagerDialog — B1 sample badge + guarded delete', () => {
  beforeEach(() => {
    resetStore();
  });

  it('shows the sample badge on the sample matter row', () => {
    useMatterStore.setState({
      matters: [
        {
          id: SAMPLE_MATTER_ID,
          name: 'Garcia v. Meridian Properties LLC',
          client: 'Roberto Garcia',
          folderPaths: [],
          createdAt: new Date().toISOString(),
          isSample: true,
        },
      ],
      activeMatterId: null,
    });

    render(<MatterManagerDialog open={true} onOpenChange={() => undefined} />);

    expect(screen.getByTestId('matter-manager-sample-badge')).toBeInTheDocument();
    expect(screen.getByTestId('matter-manager-sample-badge').textContent).toBe('Sample');
  });

  it('does not show sample badge on a normal matter', () => {
    useMatterStore.getState().createMatter({ name: 'Normal', client: 'Client' });

    render(<MatterManagerDialog open={true} onOpenChange={() => undefined} />);

    expect(screen.queryByTestId('matter-manager-sample-badge')).not.toBeInTheDocument();
  });

  it('deletes sample matter only after window.confirm returns true', () => {
    useMatterStore.setState({
      matters: [
        {
          id: SAMPLE_MATTER_ID,
          name: 'Garcia v. Meridian Properties LLC',
          client: 'Roberto Garcia',
          folderPaths: [],
          createdAt: new Date().toISOString(),
          isSample: true,
        },
      ],
      activeMatterId: null,
    });

    // Confirm returns true
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValueOnce(true);

    render(<MatterManagerDialog open={true} onOpenChange={() => undefined} />);

    const deleteBtn = screen.getByTestId(`matter-delete-${SAMPLE_MATTER_ID}`);
    fireEvent.click(deleteBtn);

    expect(confirmSpy).toHaveBeenCalledOnce();
    expect(confirmSpy.mock.calls[0]![0]).toContain('demo questions will stop working');
    // Matter should be deleted
    expect(useMatterStore.getState().matters).toHaveLength(0);

    confirmSpy.mockRestore();
  });

  it('does NOT delete sample matter when window.confirm returns false', () => {
    useMatterStore.setState({
      matters: [
        {
          id: SAMPLE_MATTER_ID,
          name: 'Garcia v. Meridian Properties LLC',
          client: 'Roberto Garcia',
          folderPaths: [],
          createdAt: new Date().toISOString(),
          isSample: true,
        },
      ],
      activeMatterId: null,
    });

    // Confirm returns false (user cancelled)
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValueOnce(false);

    render(<MatterManagerDialog open={true} onOpenChange={() => undefined} />);

    const deleteBtn = screen.getByTestId(`matter-delete-${SAMPLE_MATTER_ID}`);
    fireEvent.click(deleteBtn);

    expect(confirmSpy).toHaveBeenCalledOnce();
    // Matter should NOT be deleted
    expect(useMatterStore.getState().matters).toHaveLength(1);

    confirmSpy.mockRestore();
  });

  it('deletes a normal matter without any confirm dialog', () => {
    useMatterStore.getState().createMatter({ name: 'Normal', client: 'Client' });
    const matter = useMatterStore.getState().matters[0]!;

    const confirmSpy = vi.spyOn(window, 'confirm');

    render(<MatterManagerDialog open={true} onOpenChange={() => undefined} />);

    const deleteBtn = screen.getByTestId(`matter-delete-${matter.id}`);
    fireEvent.click(deleteBtn);

    // confirm must NOT be called for normal matters
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(useMatterStore.getState().matters).toHaveLength(0);

    confirmSpy.mockRestore();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B5 — Isolated (network lockdown) celebration UX in MatterManagerDialog
// ─────────────────────────────────────────────────────────────────────────────

describe('MatterManagerDialog — B5 isolation affirmation + persistent badge', () => {
  beforeEach(() => {
    resetStore();
  });

  it('clicking the lockdown checkbox shows a confirmation dialog, not immediate state change', () => {
    useMatterStore.getState().createMatter({ name: 'Acme v. Beta', client: 'Acme' });
    const matter = useMatterStore.getState().matters[0]!;

    render(<MatterManagerDialog open={true} onOpenChange={() => undefined} />);

    // Find the checkbox inside the privileged toggle for this matter
    const toggleLabel = screen.getByTestId(`matter-privileged-${matter.id}`);
    const checkbox = toggleLabel.querySelector('input[type="checkbox"]') as HTMLInputElement;
    fireEvent.click(checkbox);

    // Confirm dialog should appear
    expect(screen.getByTestId(`matter-isolate-confirm-${matter.id}`)).toBeInTheDocument();

    // State must NOT have changed yet (no premature lockdown)
    expect(useMatterStore.getState().matters[0]!.privileged).toBeFalsy();
  });

  it('cancelling the confirm dialog leaves the matter un-isolated', () => {
    useMatterStore.getState().createMatter({ name: 'Acme v. Beta', client: 'Acme' });
    const matter = useMatterStore.getState().matters[0]!;

    render(<MatterManagerDialog open={true} onOpenChange={() => undefined} />);

    const toggleLabel = screen.getByTestId(`matter-privileged-${matter.id}`);
    const checkbox = toggleLabel.querySelector('input[type="checkbox"]') as HTMLInputElement;
    fireEvent.click(checkbox);

    const cancelBtn = screen.getByTestId(`matter-isolate-cancel-${matter.id}`);
    fireEvent.click(cancelBtn);

    // Confirm dialog should be gone
    expect(screen.queryByTestId(`matter-isolate-confirm-${matter.id}`)).not.toBeInTheDocument();
    // Still not isolated
    expect(useMatterStore.getState().matters[0]!.privileged).toBeFalsy();
  });

  it('confirming isolation sets privileged=true and shows the affirmation callout', () => {
    useMatterStore.getState().createMatter({ name: 'Acme v. Beta', client: 'Acme' });
    const matter = useMatterStore.getState().matters[0]!;

    render(<MatterManagerDialog open={true} onOpenChange={() => undefined} />);

    const toggleLabel = screen.getByTestId(`matter-privileged-${matter.id}`);
    const checkbox = toggleLabel.querySelector('input[type="checkbox"]') as HTMLInputElement;
    fireEvent.click(checkbox);

    const confirmBtn = screen.getByTestId(`matter-isolate-confirm-action-${matter.id}`);
    fireEvent.click(confirmBtn);

    // Matter is now isolated
    expect(useMatterStore.getState().matters[0]!.privileged).toBe(true);

    // Affirmation callout is visible
    expect(screen.getByTestId(`matter-isolated-affirmation-${matter.id}`)).toBeInTheDocument();

    // Persistent badge is shown
    expect(screen.getByTestId(`matter-isolated-badge-${matter.id}`)).toBeInTheDocument();
  });

  it('a matter that starts isolated shows the persistent badge without going through confirm', () => {
    useMatterStore.getState().createMatter({ name: 'Protected', client: 'Client', privileged: true });
    const matter = useMatterStore.getState().matters[0]!;

    render(<MatterManagerDialog open={true} onOpenChange={() => undefined} />);

    // Badge visible immediately
    expect(screen.getByTestId(`matter-isolated-badge-${matter.id}`)).toBeInTheDocument();
    // No affirmation (we didn't just enable it in this session)
    expect(screen.queryByTestId(`matter-isolated-affirmation-${matter.id}`)).not.toBeInTheDocument();
  });

  it('unchecking the lockdown checkbox when already isolated disables immediately (no confirm)', () => {
    useMatterStore.getState().createMatter({ name: 'Protected', client: 'Client', privileged: true });
    const matter = useMatterStore.getState().matters[0]!;

    render(<MatterManagerDialog open={true} onOpenChange={() => undefined} />);

    const toggleLabel = screen.getByTestId(`matter-privileged-${matter.id}`);
    const checkbox = toggleLabel.querySelector('input[type="checkbox"]') as HTMLInputElement;
    fireEvent.click(checkbox); // unchecking (was already checked)

    // No confirm dialog for turning OFF
    expect(screen.queryByTestId(`matter-isolate-confirm-${matter.id}`)).not.toBeInTheDocument();
    // Immediately disabled
    expect(useMatterStore.getState().matters[0]!.privileged).toBe(false);
  });
});
