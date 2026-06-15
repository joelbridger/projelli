/**
 * Unit tests for ReimaginedAssociateHome.
 *
 * Scope:
 *  - Template loader is mocked to inject controlled fixtures.
 *  - Groups render with the correct section testids.
 *  - "Run" button calls onStartWorkflow with the right template.
 *  - Search filters across name/description.
 *  - providerError banner renders + openSettings action fires.
 *  - Trial-locked state disables run buttons.
 *  - Recent runs strip appears and clicking focuses execution tab.
 *  - Practice-area filter chips: hidden when one category, visible + functional
 *    when multiple categories present.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { WorkflowTemplate, RunRecord } from '@/types/workflow';

// ── Mock the template loader before importing the component ─────────────────

const mockTemplates: WorkflowTemplate[] = [
  {
    id: 'deposition-contradiction-finder',
    name: 'Deposition Contradiction Finder',
    description: 'Find contradictions in deposition transcripts.',
    version: '1.0.0',
    category: 'legal',
    steps: [],
    requiredInputs: [],
    outputs: [],
  },
  {
    id: 'case-timeline-builder',
    name: 'Case Timeline Builder',
    description: 'Build a chronological case timeline.',
    version: '1.0.0',
    category: 'legal',
    steps: [],
    requiredInputs: [],
    outputs: [],
  },
  {
    id: 'tax-review-workflow',
    name: 'Tax Review',
    description: 'Review tax documents for compliance.',
    version: '1.0.0',
    category: 'tax',
    steps: [],
    requiredInputs: [],
    outputs: [],
  },
];

vi.mock('@/modules/workflow/userTemplates', () => ({
  loadAllTemplates: () => mockTemplates,
}));

// Profession store: use vi.fn() so we can override per describe block.
const mockIsLawExperience = vi.fn((profession: string) => profession === 'legal');
vi.mock('@/stores/professionStore', () => ({
  useProfessionStore: vi.fn((selector: (s: { profession: string }) => unknown) =>
    selector({ profession: 'legal' })),
  isLawExperience: (profession: string) => mockIsLawExperience(profession),
  getProfession: vi.fn(() => 'legal'),
}));

// prioritizeByProfession: pass-through (order doesn't matter for these tests).
vi.mock('@/modules/workflow/prioritizeByProfession', () => ({
  prioritizeByProfession: (templates: WorkflowTemplate[]) => templates,
}));

// Trial gate: not locked by default; tests override per-case.
const mockTrialGate = vi.fn(() => ({ isLocked: false, daysRemaining: 25, isTrialExpired: false, isActivated: true, trialDays: 30 }));
vi.mock('@/hooks/useTrial', () => ({
  useTrialGate: () => mockTrialGate(),
}));

// Matter store: useActiveMatter returns null by default (no active matter).
const mockUseActiveMatter = vi.fn(() => null);
vi.mock('@/stores/matterStore', () => ({
  useActiveMatter: () => mockUseActiveMatter(),
}));

// matterResolver: provide the same label logic as the real module.
vi.mock('@/modules/memory/matterResolver', () => ({
  matterLabel: (matter: { name: string; client: string; id: string }) => {
    const name = matter.name.trim();
    const client = matter.client.trim();
    if (name && client) return `${client} - ${name}`;
    return name || client || matter.id;
  },
}));

// ── Import component and mocked store AFTER mocks are set up ─────────────────

import { ReimaginedAssociateHome } from '@/components/workflow/ReimaginedAssociateHome';
import { useProfessionStore } from '@/stores/professionStore';

// ── Shared props factory ────────────────────────────────────────────────────

function defaultProps(overrides = {}) {
  return {
    onStartWorkflow: vi.fn(),
    currentExecution: null,
    runHistory: [] as RunRecord[],
    providerError: null as ('needs-provider' | 'ollama-unreachable' | null),
    onOpenSettings: vi.fn(),
    onFocusExecutionTab: vi.fn(),
    ...overrides,
  };
}

// ── Law-persona tests (single category — filter bar hidden) ─────────────────

describe('ReimaginedAssociateHome (law persona)', () => {
  beforeEach(() => {
    // Clear persisted UI state so tests don't bleed into each other.
    localStorage.clear();
    // Profession = 'legal'; isLawExperience = true → only legal templates shown.
    vi.mocked(useProfessionStore).mockImplementation(
      (selector: (s: { profession: string }) => unknown) =>
        selector({ profession: 'legal' }),
    );
    mockIsLawExperience.mockImplementation((p) => p === 'legal');
    mockTrialGate.mockReturnValue({
      isLocked: false,
      daysRemaining: 25,
      isTrialExpired: false,
      isActivated: true,
      trialDays: 30,
    });
    // No active matter by default.
    mockUseActiveMatter.mockReturnValue(null);
  });

  it('renders the surface header title', () => {
    render(<ReimaginedAssociateHome {...defaultProps()} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Workflows' })).toBeTruthy();
  });

  it('renders the search box', () => {
    render(<ReimaginedAssociateHome {...defaultProps()} />);
    const searchInput = screen.getByTestId('associate-search');
    expect(searchInput).toBeTruthy();
  });

  it('groups legal templates into a Legal Practice section', () => {
    render(<ReimaginedAssociateHome {...defaultProps()} />);
    const legalSection = screen.getByTestId('associate-section-legal');
    expect(legalSection).toBeTruthy();
    // Tax templates are filtered out for law profession.
    expect(screen.queryByTestId('associate-section-tax')).toBeNull();
  });

  it('renders template cards inside their section', () => {
    render(<ReimaginedAssociateHome {...defaultProps()} />);
    expect(screen.getByTestId('associate-card-deposition-contradiction-finder')).toBeTruthy();
    expect(screen.getByTestId('associate-card-case-timeline-builder')).toBeTruthy();
  });

  it('calls onStartWorkflow when Run is clicked', () => {
    const onStartWorkflow = vi.fn();
    render(<ReimaginedAssociateHome {...defaultProps({ onStartWorkflow })} />);
    const runBtn = screen.getByTestId('associate-run-deposition-contradiction-finder');
    fireEvent.click(runBtn);
    expect(onStartWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'deposition-contradiction-finder' })
    );
  });

  it('disables Run buttons and shows trial banner when trial is locked', () => {
    mockTrialGate.mockReturnValue({
      isLocked: true,
      daysRemaining: 0,
      isTrialExpired: true,
      isActivated: false,
      trialDays: 30,
    });
    const onStartWorkflow = vi.fn();
    render(<ReimaginedAssociateHome {...defaultProps({ onStartWorkflow })} />);

    expect(screen.getByTestId('associate-trial-banner')).toBeTruthy();

    const runBtn = screen.getByTestId('associate-run-deposition-contradiction-finder');
    expect((runBtn as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(runBtn);
    expect(onStartWorkflow).not.toHaveBeenCalled();
  });

  it('filters templates by search query (name match)', () => {
    render(<ReimaginedAssociateHome {...defaultProps()} />);
    const searchInput = screen.getByTestId('associate-search');
    fireEvent.change(searchInput, { target: { value: 'timeline' } });

    expect(screen.getByTestId('associate-card-case-timeline-builder')).toBeTruthy();
    expect(screen.queryByTestId('associate-card-deposition-contradiction-finder')).toBeNull();
  });

  it('shows empty state when search matches nothing', () => {
    render(<ReimaginedAssociateHome {...defaultProps()} />);
    const searchInput = screen.getByTestId('associate-search');
    fireEvent.change(searchInput, { target: { value: 'xyznotfound' } });

    expect(screen.getByTestId('associate-empty')).toBeTruthy();
  });

  it('shows provider error banner for needs-provider', () => {
    render(<ReimaginedAssociateHome {...defaultProps({ providerError: 'needs-provider' })} />);
    const banner = screen.getByTestId('associate-provider-error');
    expect(banner).toBeTruthy();
    const settingsBtn = screen.getByRole('button', { name: /open settings/i });
    expect(settingsBtn).toBeTruthy();
  });

  it('calls onOpenSettings when Open settings is clicked', () => {
    const onOpenSettings = vi.fn();
    render(<ReimaginedAssociateHome {...defaultProps({ providerError: 'needs-provider', onOpenSettings })} />);
    const settingsBtn = screen.getByRole('button', { name: /open settings/i });
    fireEvent.click(settingsBtn);
    expect(onOpenSettings).toHaveBeenCalledOnce();
  });

  it('shows ollama-unreachable banner (no settings button)', () => {
    render(<ReimaginedAssociateHome {...defaultProps({ providerError: 'ollama-unreachable' })} />);
    expect(screen.getByTestId('associate-provider-error')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /open settings/i })).toBeNull();
  });

  it('renders recent runs strip when runHistory is provided', () => {
    const runHistory: RunRecord[] = [
      {
        run_id: 'run-1',
        workflow: 'Deposition Contradiction Finder',
        model: 'claude-sonnet-4-6',
        inputs: {},
        outputs: {},
        tool_calls: [],
        start_time: new Date(Date.now() - 3600000).toISOString(),
        end_time: new Date(Date.now() - 3500000).toISOString(),
        status: 'completed',
        error: undefined,
      },
    ];
    render(<ReimaginedAssociateHome {...defaultProps({ runHistory })} />);
    expect(screen.getByTestId('associate-recent-runs')).toBeTruthy();
    expect(screen.getByTestId('associate-run-row-run-1')).toBeTruthy();
  });

  it('calls onFocusExecutionTab when a recent run row is clicked', () => {
    const onFocusExecutionTab = vi.fn();
    const runHistory: RunRecord[] = [
      {
        run_id: 'run-42',
        workflow: 'Case Timeline Builder',
        model: 'claude-sonnet-4-6',
        inputs: {},
        outputs: {},
        tool_calls: [],
        start_time: new Date(Date.now() - 7200000).toISOString(),
        end_time: new Date(Date.now() - 7100000).toISOString(),
        status: 'completed',
        error: undefined,
      },
    ];
    render(<ReimaginedAssociateHome {...defaultProps({ runHistory, onFocusExecutionTab })} />);
    const runRow = screen.getByTestId('associate-run-row-run-42');
    fireEvent.click(runRow);
    expect(onFocusExecutionTab).toHaveBeenCalledOnce();
  });

  it('does not show recent runs strip when runHistory is empty', () => {
    render(<ReimaginedAssociateHome {...defaultProps({ runHistory: [] })} />);
    expect(screen.queryByTestId('associate-recent-runs')).toBeNull();
  });

  // ── Active-matter context chip ────────────────────────────────────────────

  it('shows no matter chip when there is no active matter', () => {
    render(<ReimaginedAssociateHome {...defaultProps()} />);
    expect(screen.queryByTestId('associate-active-matter-chip')).toBeNull();
  });

  it('shows the matter chip with label when an active matter is set', () => {
    mockUseActiveMatter.mockReturnValue({
      id: 'matter_test_1',
      name: 'Smith v. Jones',
      client: 'Alice Smith',
      folderPaths: [],
      mailFolderPaths: [],
      privileged: false,
      createdAt: new Date().toISOString(),
    });
    render(<ReimaginedAssociateHome {...defaultProps()} />);
    const chip = screen.getByTestId('associate-active-matter-chip');
    expect(chip).toBeTruthy();
    expect(chip.textContent).toContain('Running in:');
    expect(chip.textContent).toContain('Alice Smith - Smith v. Jones');
  });

  // ── Practice-area filter chips ────────────────────────────────────────────

  it('hides the practice-area filter bar when only one category is present', () => {
    // Law persona scopes to 'legal' only — one category, filter bar unnecessary.
    render(<ReimaginedAssociateHome {...defaultProps()} />);
    expect(screen.queryByTestId('associate-practice-filter')).toBeNull();
  });
});

// ── Practice-area filter chips — multi-category persona ───────────────────
//
// These tests set the profession to 'other' (isLawExperience = false) so all
// three fixture templates (legal + tax) pass through the scope filter, giving
// two distinct categories and making the chip bar appear.

describe('ReimaginedAssociateHome — practice-area filter chips (multi-category)', () => {
  beforeEach(() => {
    // Clear persisted UI state so tests don't bleed into each other.
    localStorage.clear();
    vi.mocked(useProfessionStore).mockImplementation(
      (selector: (s: { profession: string }) => unknown) =>
        selector({ profession: 'other' }),
    );
    // 'other' is not legal, so all templates (legal + tax) are shown.
    mockIsLawExperience.mockReturnValue(false);
    mockTrialGate.mockReturnValue({
      isLocked: false,
      daysRemaining: 25,
      isTrialExpired: false,
      isActivated: true,
      trialDays: 30,
    });
    // No active matter by default.
    mockUseActiveMatter.mockReturnValue(null);
  });

  function multiProps(overrides = {}) {
    return {
      onStartWorkflow: vi.fn(),
      currentExecution: null,
      runHistory: [] as RunRecord[],
      providerError: null as ('needs-provider' | 'ollama-unreachable' | null),
      onOpenSettings: vi.fn(),
      onFocusExecutionTab: vi.fn(),
      ...overrides,
    };
  }

  it('shows the filter bar when multiple categories are present', () => {
    render(<ReimaginedAssociateHome {...multiProps()} />);
    expect(screen.getByTestId('associate-practice-filter')).toBeTruthy();
  });

  it('renders an "All" chip that is a button', () => {
    render(<ReimaginedAssociateHome {...multiProps()} />);
    const allChip = screen.getByTestId('associate-filter-all');
    expect(allChip).toBeTruthy();
    expect(allChip.tagName).toBe('BUTTON');
  });

  it('renders a chip for each category present in the template set', () => {
    render(<ReimaginedAssociateHome {...multiProps()} />);
    // mockTemplates has 'legal' and 'tax' categories.
    expect(screen.getByTestId('associate-filter-legal')).toBeTruthy();
    expect(screen.getByTestId('associate-filter-tax')).toBeTruthy();
  });

  it('clicking a category chip filters to only that category', () => {
    render(<ReimaginedAssociateHome {...multiProps()} />);
    fireEvent.click(screen.getByTestId('associate-filter-tax'));

    expect(screen.getByTestId('associate-section-tax')).toBeTruthy();
    expect(screen.queryByTestId('associate-section-legal')).toBeNull();
  });

  it('clicking "All" after a category filter restores all sections', () => {
    render(<ReimaginedAssociateHome {...multiProps()} />);

    fireEvent.click(screen.getByTestId('associate-filter-tax'));
    expect(screen.queryByTestId('associate-section-legal')).toBeNull();

    fireEvent.click(screen.getByTestId('associate-filter-all'));
    expect(screen.getByTestId('associate-section-legal')).toBeTruthy();
    expect(screen.getByTestId('associate-section-tax')).toBeTruthy();
  });

  it('search narrows within the selected category filter', () => {
    render(<ReimaginedAssociateHome {...multiProps()} />);

    // Activate the legal chip.
    fireEvent.click(screen.getByTestId('associate-filter-legal'));

    // Search for 'timeline' — matches Case Timeline Builder (legal).
    fireEvent.change(screen.getByTestId('associate-search'), { target: { value: 'timeline' } });

    expect(screen.getByTestId('associate-card-case-timeline-builder')).toBeTruthy();
    // Tax template must not appear even though 'timeline' doesn't match it.
    expect(screen.queryByTestId('associate-card-tax-review-workflow')).toBeNull();
  });

  it('search across "All" chip still works correctly', () => {
    render(<ReimaginedAssociateHome {...multiProps()} />);

    // "All" is active; search for 'tax'.
    fireEvent.change(screen.getByTestId('associate-search'), { target: { value: 'tax' } });

    expect(screen.getByTestId('associate-card-tax-review-workflow')).toBeTruthy();
    expect(screen.queryByTestId('associate-card-deposition-contradiction-finder')).toBeNull();
  });

  it('empty-state clear button resets both search and category filter', () => {
    render(<ReimaginedAssociateHome {...multiProps()} />);

    // Apply a category filter then search for something that matches nothing.
    fireEvent.click(screen.getByTestId('associate-filter-legal'));
    fireEvent.change(screen.getByTestId('associate-search'), { target: { value: 'xyznotfound' } });
    expect(screen.getByTestId('associate-empty')).toBeTruthy();

    // The empty-state "Clear search" button has no aria-label — find by testid parent.
    const emptyDiv = screen.getByTestId('associate-empty');
    const clearBtn = emptyDiv.querySelector('button');
    expect(clearBtn).toBeTruthy();
    fireEvent.click(clearBtn!);

    // Both legal and tax sections should be visible again.
    expect(screen.getByTestId('associate-section-legal')).toBeTruthy();
    expect(screen.getByTestId('associate-section-tax')).toBeTruthy();
  });

  // ── Search-narrowed category affordance ───────────────────────────────────

  it('shows "N of M" count badge when search has narrowed a category', () => {
    render(<ReimaginedAssociateHome {...multiProps()} />);

    // Search for 'deposition' — matches only one of the two legal templates.
    fireEvent.change(screen.getByTestId('associate-search'), { target: { value: 'deposition' } });

    // The legal section should show "1 of 2" in its count badge.
    const badge = screen.getByTestId('associate-section-count-legal');
    expect(badge.textContent).toBe('(1 of 2)');
  });

  it('shows the search-hidden hint with a working Clear search link', () => {
    render(<ReimaginedAssociateHome {...multiProps()} />);

    // Search for 'deposition' — narrows legal from 2 to 1.
    fireEvent.change(screen.getByTestId('associate-search'), { target: { value: 'deposition' } });

    const hint = screen.getByTestId('associate-search-hidden-legal');
    expect(hint.textContent).toContain('1 more hidden by search');

    // Clicking the Clear search link inside the hint clears the query.
    const clearLink = screen.getByTestId('associate-search-hidden-clear-legal');
    fireEvent.click(clearLink);

    // Both legal templates should now be visible again.
    expect(screen.getByTestId('associate-card-deposition-contradiction-finder')).toBeTruthy();
    expect(screen.getByTestId('associate-card-case-timeline-builder')).toBeTruthy();
  });
});

// ── localStorage persistence tests ────────────────────────────────────────

describe('ReimaginedAssociateHome — localStorage persistence', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(useProfessionStore).mockImplementation(
      (selector: (s: { profession: string }) => unknown) =>
        selector({ profession: 'other' }),
    );
    mockIsLawExperience.mockReturnValue(false);
    mockTrialGate.mockReturnValue({
      isLocked: false,
      daysRemaining: 25,
      isTrialExpired: false,
      isActivated: true,
      trialDays: 30,
    });
    mockUseActiveMatter.mockReturnValue(null);
  });

  function persistProps(overrides = {}) {
    return {
      onStartWorkflow: vi.fn(),
      currentExecution: null,
      runHistory: [] as RunRecord[],
      providerError: null as ('needs-provider' | 'ollama-unreachable' | null),
      onOpenSettings: vi.fn(),
      onFocusExecutionTab: vi.fn(),
      ...overrides,
    };
  }

  it('restores the active filter after a simulated remount', () => {
    const { unmount } = render(<ReimaginedAssociateHome {...persistProps()} />);

    // Select the "Legal Practice" filter chip.
    fireEvent.click(screen.getByTestId('associate-filter-legal'));
    // Confirm only legal section is visible.
    expect(screen.getByTestId('associate-section-legal')).toBeTruthy();
    expect(screen.queryByTestId('associate-section-tax')).toBeNull();

    // Simulate a tab switch: unmount + remount (no localStorage.clear between).
    unmount();
    render(<ReimaginedAssociateHome {...persistProps()} />);

    // After remount the legal filter should be restored from localStorage.
    expect(screen.getByTestId('associate-section-legal')).toBeTruthy();
    expect(screen.queryByTestId('associate-section-tax')).toBeNull();
    // The Legal Practice chip should be active (aria role alone isn't enough; check
    // that the tax section is absent and legal is present, which proves the filter held).
  });

  it('restores collapsed state after a simulated remount', () => {
    const { unmount } = render(<ReimaginedAssociateHome {...persistProps()} />);

    // Collapse the "Legal Practice" category.
    fireEvent.click(screen.getByTestId('associate-section-toggle-legal'));
    // The section exists but its cards should be gone (collapsed).
    expect(screen.queryByTestId('associate-card-deposition-contradiction-finder')).toBeNull();

    // Remount — no localStorage.clear, so state should persist.
    unmount();
    render(<ReimaginedAssociateHome {...persistProps()} />);

    // Cards should still be hidden (collapsed restored from localStorage).
    expect(screen.queryByTestId('associate-card-deposition-contradiction-finder')).toBeNull();
    // The section header itself should still be present.
    expect(screen.getByTestId('associate-section-legal')).toBeTruthy();
  });

  it('writes the filter to localStorage when changed', () => {
    render(<ReimaginedAssociateHome {...persistProps()} />);
    fireEvent.click(screen.getByTestId('associate-filter-tax'));

    expect(localStorage.getItem('keepance:workflows-filter')).toBe('tax');
  });

  it('writes collapsed state to localStorage when a section is toggled', () => {
    render(<ReimaginedAssociateHome {...persistProps()} />);
    fireEvent.click(screen.getByTestId('associate-section-toggle-legal'));

    const stored = JSON.parse(localStorage.getItem('keepance:workflows-collapsed') ?? '{}') as Record<string, boolean>;
    expect(stored['legal']).toBe(true);
  });
});
