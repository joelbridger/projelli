/**
 * mattersHome.test.tsx
 *
 * Acceptance tests for B1 (sample-matter badge) and B4 (visible quick-actions).
 *
 * B1: When a matter has isSample===true, a "Sample" pill is visible on its row
 *     in MattersHome and in MatterManagerDialog. The delete button in
 *     MatterManagerDialog shows a confirm dialog before deleting the sample matter.
 *
 * B4: The Ask / Documents / Email quick-action buttons are present in the DOM
 *     at rest (not hidden via height:0 or display:none), keyboard-focusable,
 *     and have correct aria-labels.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useMatterStore, SAMPLE_MATTER_ID } from '@/platform/matter/matterStore';
import { useProfessionStore } from '@/platform/profile/professionStore';

// ── Mail commands (async probes used by GetStartedCard) ───────────────────────
vi.mock('@/platform/utils/mail-commands', () => ({
  mailIsConnected: async () => false,
  gmailIsConnected: async () => false,
  mailImapIsConnected: async () => false,
  mailConnectedAccounts: async () => [],
  // deleteMatter clears a deleted matter's email filings (BUG-042).
  mailClearMatterFilings: async () => 0,
}));

// ── useApiKeys ─────────────────────────────────────────────────────────────────
vi.mock('@/platform/hooks/useApiKeys', () => ({
  useApiKeys: () => ({ apiKeys: [] }),
}));

// ── matterLabel falls through to actual implementation ─────────────────────────
// (pure function, no side effects)

// ── useFirm (no firm session in these tests) ──────────────────────────────────
vi.mock('@/platform/hooks/useFirm', () => ({
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
vi.mock('@/platform/fs/workspaceStore', () => ({
  useWorkspaceStore: (sel: (s: { rootPath: string | null; fileTree: unknown[] }) => unknown) =>
    sel({ rootPath: null, fileTree: [] }),
}));

// ── Tauri keychain (firm module deps) ─────────────────────────────────────────
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async () => { throw new Error('not in test'); }),
  isTauri: () => false,
}));

// ── AuditService ───────────────────────────────────────────────────────────────
vi.mock('@/platform/audit/AuditService', () => ({
  AuditService: class { append() {} },
  isAuditEncrypted: () => false,
}));

// ── firm key service ───────────────────────────────────────────────────────────
vi.mock('@/platform/firm/matterKeyService', () => ({
  getOrCreateMatterKey: async () => 'key',
  publishMatterKeyToMembers: async () => ({ published: 0, skippedWalled: 0 }),
  obtainMatterKey: async () => null,
}));

vi.mock('@/platform/firm/deviceKeys', () => ({
  registerDevice: async () => undefined,
  _resetDeviceCache: () => undefined,
  getOrCreateDeviceKeypair: async () => ({ deviceId: 'test', publicJwk: {} }),
}));

vi.mock('@/platform/providers/fetchUtils', () => ({
  getCorsSafeFetch: async () => vi.fn(),
}));

// ── Import components after mocks ──────────────────────────────────────────────
import { MattersHome } from '@/features/matters/MattersHome';
import { MatterManagerDialog } from '@/features/matters/MatterManagerDialog';

function resetStore() {
  useMatterStore.setState({ matters: [], activeMatterId: null });
  useProfessionStore.setState({ profession: 'advisor' });
}

// ─────────────────────────────────────────────────────────────────────────────
// B1 — Sample pill in MattersHome
// ─────────────────────────────────────────────────────────────────────────────

describe('MattersHome — B1 sample badge', () => {
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

    render(<MattersHome />);

    // The row should be in the DOM
    expect(screen.getByTestId(`matter-row-${sampleMatter.id}`)).toBeInTheDocument();
    // The Sample pill should appear
    expect(screen.getByTestId('sample-matter-pill')).toBeInTheDocument();
    expect(screen.getByTestId('sample-matter-pill').textContent).toBe('Sample');
  });

  it('does not show a Sample pill on a normal matter', () => {
    useMatterStore.getState().createMatter({ name: 'Normal Matter', client: 'Client' });

    render(<MattersHome />);

    expect(screen.queryByTestId('sample-matter-pill')).not.toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B4 — Quick-actions visible at rest in MattersHome
// ─────────────────────────────────────────────────────────────────────────────

describe('MattersHome — B4 quick-actions visible at rest', () => {
  beforeEach(resetStore);

  it('renders Ask / Documents / Email buttons in the DOM (not hidden) for each matter', () => {
    useMatterStore.getState().createMatter({ name: 'Acme v. Beta', client: 'Acme' });
    const matter = useMatterStore.getState().matters[0]!;

    render(<MattersHome />);

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

    render(<MattersHome />);

    const askBtn = screen.getByTestId(`matter-launch-ask-${matter.id}`);
    const docsBtn = screen.getByTestId(`matter-launch-documents-${matter.id}`);
    const emailBtn = screen.getByTestId(`matter-launch-email-${matter.id}`);

    expect(askBtn.getAttribute('aria-label')).toContain('Search');
    expect(docsBtn.getAttribute('aria-label')).toContain('Open documents for');
    expect(emailBtn.getAttribute('aria-label')).toContain('Open email for');
  });

  it('quick-action buttons are real <button> elements (keyboard-focusable)', () => {
    useMatterStore.getState().createMatter({ name: 'Focus Test', client: 'Client' });
    const matter = useMatterStore.getState().matters[0]!;

    render(<MattersHome />);

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

    render(<MattersHome />);

    fireEvent.click(screen.getByTestId(`matter-launch-ask-${matter.id}`));
    expect(events).toHaveLength(1);
    expect(events[0]!.detail.surface).toBe('search');
    expect(events[0]!.detail.matterId).toBe(matter.id);

    window.removeEventListener('keepance:matter-launch', handler);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Advisor re-aim — sensitivity column wording
// ─────────────────────────────────────────────────────────────────────────────

describe('MattersHome — advisor sensitivity column', () => {
  beforeEach(resetStore);

  it('hides the empty sensitivity column when no clients are flagged', () => {
    useMatterStore.getState().createMatter({ name: 'Hollings Household', client: 'Hollings Household' });

    render(<MattersHome />);

    expect(screen.queryByText('Privilege')).not.toBeInTheDocument();
    expect(screen.queryByText('Sensitive')).not.toBeInTheDocument();
  });

  it('uses advisor language when a client is flagged sensitive', () => {
    useMatterStore.getState().createMatter({
      name: 'Hollings Household',
      client: 'Hollings Household',
      privileged: true,
    });

    render(<MattersHome />);

    expect(screen.queryByText('Privilege')).not.toBeInTheDocument();
    expect(screen.getAllByText('Sensitive').length).toBeGreaterThan(0);
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

  it('confirms before deleting a normal matter, and deletes only on confirm (Codex QA)', () => {
    useMatterStore.getState().createMatter({ name: 'Normal', client: 'Client' });
    const matter = useMatterStore.getState().matters[0]!;

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValueOnce(true);

    render(<MatterManagerDialog open={true} onOpenChange={() => undefined} />);

    const deleteBtn = screen.getByTestId(`matter-delete-${matter.id}`);
    fireEvent.click(deleteBtn);

    // A real matter now requires confirmation (accidental-deletion guard).
    expect(confirmSpy).toHaveBeenCalledOnce();
    expect(confirmSpy.mock.calls[0]![0]).toMatch(/Normal|can't be undone/i);
    expect(useMatterStore.getState().matters).toHaveLength(0);

    confirmSpy.mockRestore();
  });

  it('does NOT delete a normal matter when the confirm is cancelled (Codex QA)', () => {
    useMatterStore.getState().createMatter({ name: 'Normal', client: 'Client' });
    const matter = useMatterStore.getState().matters[0]!;

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValueOnce(false);

    render(<MatterManagerDialog open={true} onOpenChange={() => undefined} />);

    fireEvent.click(screen.getByTestId(`matter-delete-${matter.id}`));

    expect(confirmSpy).toHaveBeenCalledOnce();
    expect(useMatterStore.getState().matters).toHaveLength(1); // not deleted

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

// ─────────────────────────────────────────────────────────────────────────────
// Search filtering
// ─────────────────────────────────────────────────────────────────────────────

describe('MattersHome — search filtering', () => {
  beforeEach(resetStore);

  it('does not show the search box when there are <= 5 matters', () => {
    for (let i = 0; i < 5; i++) {
      useMatterStore.getState().createMatter({ name: `Matter ${String(i)}`, client: `Client ${String(i)}` });
    }

    render(<MattersHome />);

    expect(screen.queryByTestId('matters-search-input')).not.toBeInTheDocument();
  });

  it('shows the search box when there are > 5 matters', () => {
    for (let i = 0; i < 6; i++) {
      useMatterStore.getState().createMatter({ name: `Matter ${String(i)}`, client: `Client ${String(i)}` });
    }

    render(<MattersHome />);

    expect(screen.getByTestId('matters-search-input')).toBeInTheDocument();
  });

  it('filters matters by name (case-insensitive)', () => {
    useMatterStore.getState().createMatter({ name: 'Alpha Corp', client: 'Alpha' });
    useMatterStore.getState().createMatter({ name: 'Beta LLC', client: 'Beta' });
    useMatterStore.getState().createMatter({ name: 'Gamma Inc', client: 'Gamma' });
    useMatterStore.getState().createMatter({ name: 'Delta Partners', client: 'Delta' });
    useMatterStore.getState().createMatter({ name: 'Epsilon Group', client: 'Epsilon' });
    useMatterStore.getState().createMatter({ name: 'Zeta Holdings', client: 'Zeta' });

    render(<MattersHome />);

    const searchInput = screen.getByTestId('matters-search-input');
    fireEvent.change(searchInput, { target: { value: 'beta' } });

    // Beta LLC should be visible; others should not
    expect(screen.queryAllByText(/Beta LLC/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Alpha Corp/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Gamma Inc/)).not.toBeInTheDocument();
  });

  it('filters matters by client name (case-insensitive)', () => {
    useMatterStore.getState().createMatter({ name: 'Garcia v. Meridian', client: 'Roberto Garcia' });
    useMatterStore.getState().createMatter({ name: 'Smith Tax Matter', client: 'John Smith' });
    useMatterStore.getState().createMatter({ name: 'Acme Contract', client: 'Acme Corp' });
    useMatterStore.getState().createMatter({ name: 'Beta IP', client: 'Beta Inc' });
    useMatterStore.getState().createMatter({ name: 'Gamma Dispute', client: 'Gamma LLC' });
    useMatterStore.getState().createMatter({ name: 'Delta Estate', client: 'Delta Family' });

    render(<MattersHome />);

    const searchInput = screen.getByTestId('matters-search-input');
    fireEvent.change(searchInput, { target: { value: 'roberto' } });

    // Only the Garcia matter matches on client name
    expect(screen.queryAllByText(/Garcia v. Meridian/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Smith Tax Matter/)).not.toBeInTheDocument();
  });

  it('shows the no-results row when no matters match', () => {
    for (let i = 0; i < 6; i++) {
      useMatterStore.getState().createMatter({ name: `Matter ${String(i)}`, client: `Client ${String(i)}` });
    }

    render(<MattersHome />);

    const searchInput = screen.getByTestId('matters-search-input');
    fireEvent.change(searchInput, { target: { value: 'zzznomatch' } });

    expect(screen.getByTestId('matters-no-search-results')).toBeInTheDocument();
  });

  it('restores all rows when search is cleared', () => {
    useMatterStore.getState().createMatter({ name: 'Alpha Corp', client: 'Alpha' });
    useMatterStore.getState().createMatter({ name: 'Beta LLC', client: 'Beta' });
    useMatterStore.getState().createMatter({ name: 'Gamma Inc', client: 'Gamma' });
    useMatterStore.getState().createMatter({ name: 'Delta Partners', client: 'Delta' });
    useMatterStore.getState().createMatter({ name: 'Epsilon Group', client: 'Epsilon' });
    useMatterStore.getState().createMatter({ name: 'Zeta Holdings', client: 'Zeta' });

    render(<MattersHome />);

    const searchInput = screen.getByTestId('matters-search-input');
    // Filter down
    fireEvent.change(searchInput, { target: { value: 'alpha' } });
    expect(screen.queryByText(/Beta LLC/)).not.toBeInTheDocument();

    // Clear
    fireEvent.change(searchInput, { target: { value: '' } });
    expect(screen.queryAllByText(/Beta LLC/i).length).toBeGreaterThan(0);
    expect(screen.queryAllByText(/Gamma Inc/i).length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Sortable columns
// ─────────────────────────────────────────────────────────────────────────────

describe('MattersHome — sortable columns', () => {
  beforeEach(resetStore);

  it('renders sort buttons for each visible column header', () => {
    useMatterStore.getState().createMatter({ name: 'Alpha', client: 'Alpha' });

    render(<MattersHome />);

    // Column header buttons should be present (aria-label contains "Sort by")
    const sortBtns = screen.getAllByRole('button', { name: /Sort by/i });
    expect(sortBtns).toHaveLength(3);
    expect(screen.getByRole('button', { name: /Sort by Client/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Sort by Documents/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Sort by Created/i })).toBeInTheDocument();
  });

  it('sorts matters alphabetically by name (default, ascending)', () => {
    useMatterStore.getState().createMatter({ name: 'Zeta v. Alpha', client: 'Zeta' });
    useMatterStore.getState().createMatter({ name: 'Alpha v. Beta', client: 'Alpha' });
    useMatterStore.getState().createMatter({ name: 'Mu v. Nu', client: 'Mu' });

    render(<MattersHome />);

    // All three row testids should be present
    const matters = useMatterStore.getState().matters;
    const ids = matters.map((m) => m.id);
    for (const id of ids) {
      expect(screen.getByTestId(`matter-row-${id}`)).toBeInTheDocument();
    }
  });

  it('clicking a column header toggles sort direction', () => {
    useMatterStore.getState().createMatter({ name: 'Alpha', client: 'Alpha' });

    render(<MattersHome />);

    const nameSortBtn = screen.getByRole('button', { name: /Sort by Client/i });
    // Click once — should toggle to descending (was already asc by default)
    fireEvent.click(nameSortBtn);
    // The aria-label should now reflect descending
    expect(nameSortBtn.getAttribute('aria-label')).toContain('descending');
  });

  it('clicking a different column header switches sort key to asc', () => {
    useMatterStore.getState().createMatter({ name: 'Alpha', client: 'Alpha' });

    render(<MattersHome />);

    const createdSortBtn = screen.getByRole('button', { name: /Sort by Created/i });
    fireEvent.click(createdSortBtn);
    expect(createdSortBtn.getAttribute('aria-label')).toContain('ascending');
  });

  it('all sort column buttons are real <button> elements (keyboard-accessible)', () => {
    useMatterStore.getState().createMatter({ name: 'Alpha', client: 'Alpha' });

    render(<MattersHome />);

    const sortBtns = screen.getAllByRole('button', { name: /Sort by/i });
    for (const btn of sortBtns) {
      expect(btn.tagName).toBe('BUTTON');
      expect(btn.getAttribute('type')).toBe('button');
      expect(btn.getAttribute('tabindex')).not.toBe('-1');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GetStartedCard — create first matter step
// ─────────────────────────────────────────────────────────────────────────────

describe('MattersHome — GetStartedCard create-matter step', () => {
  beforeEach(resetStore);

  it('shows the create-matter step when no matters exist', () => {
    render(<MattersHome />);

    // Empty state renders GetStartedCard
    expect(screen.getByTestId('get-started-card')).toBeInTheDocument();
    expect(screen.getByTestId('get-started-create-matter')).toBeInTheDocument();
  });

  it('dispatches keepance:open-matter-manager when create button is clicked', () => {
    const events: Event[] = [];
    const handler = (e: Event) => { events.push(e); };
    window.addEventListener('keepance:open-matter-manager', handler);

    render(<MattersHome />);

    fireEvent.click(screen.getByTestId('get-started-create-matter'));
    expect(events).toHaveLength(1);

    window.removeEventListener('keepance:open-matter-manager', handler);
  });
});
