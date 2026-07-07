/**
 * Unit tests for AssociateHome.
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
import type { WorkflowTemplate, RunRecord } from '@/platform/types/workflow';
import type { Matter } from '@/platform/types/matter';
import type { Profession } from '@/platform/profile/professionModel';

// Mirrors the (unexported) `ProfessionState` shape in professionStore.ts —
// structurally identical so mocked selectors type-check against the real
// hook's selector signature without importing a private type.
type ProfessionSelectorState = { profession: Profession; setProfession: (p: Profession) => void };
const asProfessionState = (profession: Profession): ProfessionSelectorState => ({
  profession,
  setProfession: () => undefined,
});

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

vi.mock('@/features/workflows/engine/userTemplates', () => ({
  loadAllTemplates: () => mockTemplates,
}));

// Profession store: use vi.fn() so we can override per describe block.
const mockIsLawExperience = vi.fn((profession: string) => profession === 'legal');
vi.mock('@/platform/profile/professionStore', () => ({
  useProfessionStore: vi.fn((selector: (s: ProfessionSelectorState) => unknown) =>
    selector({ profession: 'legal', setProfession: () => undefined })),
  isLawExperience: (profession: string) => mockIsLawExperience(profession),
  getProfession: vi.fn(() => 'legal'),
}));

// prioritizeByProfession: pass-through (order doesn't matter for these tests).
vi.mock('@/features/workflows/engine/prioritizeByProfession', () => ({
  prioritizeByProfession: (templates: WorkflowTemplate[]) => templates,
}));

// Trial gate: not locked by default; tests override per-case.
const mockTrialGate = vi.fn(() => ({ isLocked: false, daysRemaining: 25, isTrialExpired: false, isActivated: true, trialDays: 30 }));
vi.mock('@/platform/hooks/useTrial', () => ({
  useTrialGate: () => mockTrialGate(),
}));

// Matter store: useActiveMatter returns null by default (no active matter).
const mockUseActiveMatter = vi.fn((): Matter | null => null);
vi.mock('@/platform/matter/matterStore', () => ({
  useActiveMatter: () => mockUseActiveMatter(),
}));

// matterResolver: provide the same label logic as the real module.
vi.mock('@/platform/rag/matterResolver', () => ({
  matterLabel: (matter: { name: string; client: string; id: string }) => {
    const name = matter.name.trim();
    const client = matter.client.trim();
    if (name && client) return `${client} - ${name}`;
    return name || client || matter.id;
  },
}));

// ── Import component and mocked store AFTER mocks are set up ─────────────────

import { AssociateHome } from '@/features/workflows/AssociateHome';
import { useProfessionStore } from '@/platform/profile/professionStore';

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

describe('AssociateHome (law persona)', () => {
  beforeEach(() => {
    // Clear persisted UI state so tests don't bleed into each other.
    localStorage.clear();
    // Profession = 'legal'; isLawExperience = true → only legal templates shown.
    vi.mocked(useProfessionStore).mockImplementation(
      (selector: (s: ProfessionSelectorState) => unknown) =>
        selector(asProfessionState('legal')),
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
    render(<AssociateHome {...defaultProps()} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Workflows' })).toBeTruthy();
  });

  it('renders the search box', () => {
    render(<AssociateHome {...defaultProps()} />);
    const searchInput = screen.getByTestId('associate-search');
    expect(searchInput).toBeTruthy();
  });

  it('groups legal templates into a Legal Practice section', () => {
    render(<AssociateHome {...defaultProps()} />);
    const legalSection = screen.getByTestId('associate-section-legal');
    expect(legalSection).toBeTruthy();
    // Tax templates are filtered out for law profession.
    expect(screen.queryByTestId('associate-section-tax')).toBeNull();
  });

  it('renders template cards inside their section', () => {
    render(<AssociateHome {...defaultProps()} />);
    expect(screen.getByTestId('associate-card-deposition-contradiction-finder')).toBeTruthy();
    expect(screen.getByTestId('associate-card-case-timeline-builder')).toBeTruthy();
  });

  it('calls onStartWorkflow as soon as Run is clicked', () => {
    const onStartWorkflow = vi.fn();
    render(<AssociateHome {...defaultProps({ onStartWorkflow })} />);
    const runBtn = screen.getByTestId('associate-run-deposition-contradiction-finder');
    fireEvent.click(runBtn);
    expect(onStartWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'deposition-contradiction-finder' })
    );
    expect(screen.queryByTestId('workflow-run-confirm')).toBeNull();
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
    render(<AssociateHome {...defaultProps({ onStartWorkflow })} />);

    expect(screen.getByTestId('associate-trial-banner')).toBeTruthy();

    const runBtn = screen.getByTestId('associate-run-deposition-contradiction-finder');
    expect((runBtn as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(runBtn);
    expect(onStartWorkflow).not.toHaveBeenCalled();
  });

  it('filters templates by search query (name match)', () => {
    render(<AssociateHome {...defaultProps()} />);
    const searchInput = screen.getByTestId('associate-search');
    fireEvent.change(searchInput, { target: { value: 'timeline' } });

    expect(screen.getByTestId('associate-card-case-timeline-builder')).toBeTruthy();
    expect(screen.queryByTestId('associate-card-deposition-contradiction-finder')).toBeNull();
  });

  it('shows empty state when search matches nothing', () => {
    render(<AssociateHome {...defaultProps()} />);
    const searchInput = screen.getByTestId('associate-search');
    fireEvent.change(searchInput, { target: { value: 'xyznotfound' } });

    expect(screen.getByTestId('associate-empty')).toBeTruthy();
  });

  it('shows provider error banner for needs-provider', () => {
    render(<AssociateHome {...defaultProps({ providerError: 'needs-provider' })} />);
    const banner = screen.getByTestId('associate-provider-error');
    expect(banner).toBeTruthy();
    const settingsBtn = screen.getByRole('button', { name: /open settings/i });
    expect(settingsBtn).toBeTruthy();
  });

  it('calls onOpenSettings when Open settings is clicked', () => {
    const onOpenSettings = vi.fn();
    render(<AssociateHome {...defaultProps({ providerError: 'needs-provider', onOpenSettings })} />);
    const settingsBtn = screen.getByRole('button', { name: /open settings/i });
    fireEvent.click(settingsBtn);
    expect(onOpenSettings).toHaveBeenCalledOnce();
  });

  it('shows ollama-unreachable banner (no settings button)', () => {
    render(<AssociateHome {...defaultProps({ providerError: 'ollama-unreachable' })} />);
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
    render(<AssociateHome {...defaultProps({ runHistory })} />);
    expect(screen.getByTestId('associate-recent-runs')).toBeTruthy();
    expect(screen.getByTestId('associate-run-row-run-1')).toBeTruthy();
  });

  it('calls onFocusExecutionTab when a recent run row without a result file is clicked', () => {
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
    render(<AssociateHome {...defaultProps({ runHistory, onFocusExecutionTab })} />);
    const runRow = screen.getByTestId('associate-run-row-run-42');
    fireEvent.click(runRow);
    expect(onFocusExecutionTab).toHaveBeenCalledOnce();
  });

  it('opens the produced document when a recent run row has a result file', () => {
    const onOpenRunArtifact = vi.fn();
    const onFocusExecutionTab = vi.fn();
    const runHistory: RunRecord[] = [
      {
        run_id: 'run-doc',
        workflow: 'annual-review-packet',
        model: 'claude-sonnet-4-6',
        inputs: {},
        outputs: {
          displayTitle: 'Alice Smith - Word document',
          primaryArtifactName: 'Annual Review Packet.docx',
          primaryArtifactPath: '/workspace/Clients/Alice/Documents/Workflows/Annual/Annual Review Packet.docx',
        },
        tool_calls: [],
        start_time: new Date(Date.now() - 7200000).toISOString(),
        end_time: new Date(Date.now() - 7100000).toISOString(),
        status: 'completed',
        error: undefined,
      },
    ];
    render(<AssociateHome {...defaultProps({ runHistory, onOpenRunArtifact, onFocusExecutionTab })} />);

    expect(screen.getByText('Alice Smith - Word document')).toBeTruthy();
    expect(screen.getByText('Annual Review Packet.docx')).toBeTruthy();
    fireEvent.click(screen.getByTestId('associate-run-row-run-doc'));

    expect(onOpenRunArtifact).toHaveBeenCalledWith(
      '/workspace/Clients/Alice/Documents/Workflows/Annual/Annual Review Packet.docx',
      'Annual Review Packet.docx',
    );
    expect(onFocusExecutionTab).not.toHaveBeenCalled();
  });

  it('does not show recent runs strip when runHistory is empty', () => {
    render(<AssociateHome {...defaultProps({ runHistory: [] })} />);
    expect(screen.queryByTestId('associate-recent-runs')).toBeNull();
  });

  it('shows a non-clickable animated running pill while a workflow is running', () => {
    const template = mockTemplates[0]!;
    render(<AssociateHome {...defaultProps({
      currentExecution: {
        runId: 'run-active',
        template,
        currentStepIndex: 0,
        status: 'running',
        inputs: {},
        stepOutputs: [],
        startTime: new Date(),
      },
    })} />);

    const pill = screen.getByTestId('associate-running-pill');
    expect(pill.textContent).toContain('Running Deposition Contradiction Finder');
    expect(pill.querySelector('.animate-spin')).toBeTruthy();
    expect((pill as HTMLElement).style.pointerEvents).toBe('none');
  });

  // ── Practice-area filter chips ────────────────────────────────────────────

  it('hides the practice-area filter bar when only one category is present', () => {
    // Law persona scopes to 'legal' only — one category, filter bar unnecessary.
    render(<AssociateHome {...defaultProps()} />);
    expect(screen.queryByTestId('associate-practice-filter')).toBeNull();
  });
});

// ── Practice-area filter chips — multi-category persona ───────────────────
//
// These tests set the profession to 'other' (isLawExperience = false) so all
// three fixture templates (legal + tax) pass through the scope filter, giving
// two distinct categories and making the chip bar appear.

describe('AssociateHome — practice-area filter chips (multi-category)', () => {
  beforeEach(() => {
    // Clear persisted UI state so tests don't bleed into each other.
    localStorage.clear();
    vi.mocked(useProfessionStore).mockImplementation(
      (selector: (s: ProfessionSelectorState) => unknown) =>
        selector(asProfessionState('other')),
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
    render(<AssociateHome {...multiProps()} />);
    expect(screen.getByTestId('associate-practice-filter')).toBeTruthy();
  });

  it('renders an "All" chip that is a button', () => {
    render(<AssociateHome {...multiProps()} />);
    const allChip = screen.getByTestId('associate-filter-all');
    expect(allChip).toBeTruthy();
    expect(allChip.tagName).toBe('BUTTON');
  });

  it('renders a chip for each category present in the template set', () => {
    render(<AssociateHome {...multiProps()} />);
    // mockTemplates has 'legal' and 'tax' categories.
    expect(screen.getByTestId('associate-filter-legal')).toBeTruthy();
    expect(screen.getByTestId('associate-filter-tax')).toBeTruthy();
  });

  it('clicking a category chip filters to only that category', () => {
    render(<AssociateHome {...multiProps()} />);
    fireEvent.click(screen.getByTestId('associate-filter-tax'));

    expect(screen.getByTestId('associate-section-tax')).toBeTruthy();
    expect(screen.queryByTestId('associate-section-legal')).toBeNull();
  });

  it('clicking "All" after a category filter restores all sections', () => {
    render(<AssociateHome {...multiProps()} />);

    fireEvent.click(screen.getByTestId('associate-filter-tax'));
    expect(screen.queryByTestId('associate-section-legal')).toBeNull();

    fireEvent.click(screen.getByTestId('associate-filter-all'));
    expect(screen.getByTestId('associate-section-legal')).toBeTruthy();
    expect(screen.getByTestId('associate-section-tax')).toBeTruthy();
  });

  it('search narrows within the selected category filter', () => {
    render(<AssociateHome {...multiProps()} />);

    // Activate the legal chip.
    fireEvent.click(screen.getByTestId('associate-filter-legal'));

    // Search for 'timeline' — matches Case Timeline Builder (legal).
    fireEvent.change(screen.getByTestId('associate-search'), { target: { value: 'timeline' } });

    expect(screen.getByTestId('associate-card-case-timeline-builder')).toBeTruthy();
    // Tax template must not appear even though 'timeline' doesn't match it.
    expect(screen.queryByTestId('associate-card-tax-review-workflow')).toBeNull();
  });

  it('search across "All" chip still works correctly', () => {
    render(<AssociateHome {...multiProps()} />);

    // "All" is active; search for 'tax'.
    fireEvent.change(screen.getByTestId('associate-search'), { target: { value: 'tax' } });

    expect(screen.getByTestId('associate-card-tax-review-workflow')).toBeTruthy();
    expect(screen.queryByTestId('associate-card-deposition-contradiction-finder')).toBeNull();
  });

  it('empty-state clear button resets both search and category filter', () => {
    render(<AssociateHome {...multiProps()} />);

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
    render(<AssociateHome {...multiProps()} />);

    // Search for 'deposition' — matches only one of the two legal templates.
    fireEvent.change(screen.getByTestId('associate-search'), { target: { value: 'deposition' } });

    // The legal section should show "1 of 2" in its count badge.
    const badge = screen.getByTestId('associate-section-count-legal');
    expect(badge.textContent).toBe('(1 of 2)');
  });

  it('shows the search-hidden hint with a working Clear search link', () => {
    render(<AssociateHome {...multiProps()} />);

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

describe('AssociateHome — localStorage persistence', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(useProfessionStore).mockImplementation(
      (selector: (s: ProfessionSelectorState) => unknown) =>
        selector(asProfessionState('other')),
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
    const { unmount } = render(<AssociateHome {...persistProps()} />);

    // Select the "Legal Practice" filter chip.
    fireEvent.click(screen.getByTestId('associate-filter-legal'));
    // Confirm only legal section is visible.
    expect(screen.getByTestId('associate-section-legal')).toBeTruthy();
    expect(screen.queryByTestId('associate-section-tax')).toBeNull();

    // Simulate a tab switch: unmount + remount (no localStorage.clear between).
    unmount();
    render(<AssociateHome {...persistProps()} />);

    // After remount the legal filter should be restored from localStorage.
    expect(screen.getByTestId('associate-section-legal')).toBeTruthy();
    expect(screen.queryByTestId('associate-section-tax')).toBeNull();
    // The Legal Practice chip should be active (aria role alone isn't enough; check
    // that the tax section is absent and legal is present, which proves the filter held).
  });

  it('restores collapsed state after a simulated remount', () => {
    const { unmount } = render(<AssociateHome {...persistProps()} />);

    // Collapse the "Legal Practice" category.
    fireEvent.click(screen.getByTestId('associate-section-toggle-legal'));
    // The section exists but its cards should be gone (collapsed).
    expect(screen.queryByTestId('associate-card-deposition-contradiction-finder')).toBeNull();

    // Remount — no localStorage.clear, so state should persist.
    unmount();
    render(<AssociateHome {...persistProps()} />);

    // Cards should still be hidden (collapsed restored from localStorage).
    expect(screen.queryByTestId('associate-card-deposition-contradiction-finder')).toBeNull();
    // The section header itself should still be present.
    expect(screen.getByTestId('associate-section-legal')).toBeTruthy();
  });

  it('writes the filter to localStorage when changed', () => {
    render(<AssociateHome {...persistProps()} />);
    fireEvent.click(screen.getByTestId('associate-filter-tax'));

    expect(localStorage.getItem('lantern:workflows-filter')).toBe('tax');
  });

  it('writes collapsed state to localStorage when a section is toggled', () => {
    render(<AssociateHome {...persistProps()} />);
    fireEvent.click(screen.getByTestId('associate-section-toggle-legal'));

    const stored = JSON.parse(localStorage.getItem('lantern:workflows-collapsed') ?? '{}') as Record<string, boolean>;
    expect(stored['legal']).toBe(true);
  });
});
