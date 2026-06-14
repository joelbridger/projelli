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

// Profession store: default to 'legal' (law experience).
vi.mock('@/stores/professionStore', () => ({
  useProfessionStore: (selector: (s: { profession: 'legal' | 'tax' | 'consulting' | 'advisor' | 'other' }) => unknown) =>
    selector({ profession: 'legal' }),
  isLawExperience: (profession: string) => profession === 'legal',
  getProfession: () => 'legal',
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

// ── Import component AFTER mocks are set up ─────────────────────────────────

import { ReimaginedAssociateHome } from '@/components/workflow/ReimaginedAssociateHome';

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

// ── Tests ───────────────────────────────────────────────────────────────────

describe('ReimaginedAssociateHome', () => {
  beforeEach(() => {
    mockTrialGate.mockReturnValue({
      isLocked: false,
      daysRemaining: 25,
      isTrialExpired: false,
      isActivated: true,
      trialDays: 30,
    });
  });

  it('renders the header eyebrow and title', () => {
    render(<ReimaginedAssociateHome {...defaultProps()} />);
    expect(screen.getByText('ASSOCIATE')).toBeTruthy();
    expect(screen.getByText('Litigation Associate')).toBeTruthy();
  });

  it('renders the search box', () => {
    render(<ReimaginedAssociateHome {...defaultProps()} />);
    const searchInput = screen.getByTestId('associate-search');
    expect(searchInput).toBeTruthy();
  });

  it('groups legal templates into a Legal Practice section (law profession)', () => {
    render(<ReimaginedAssociateHome {...defaultProps()} />);
    const legalSection = screen.getByTestId('associate-section-legal');
    expect(legalSection).toBeTruthy();
    // Tax templates are filtered out for law profession
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

    // Trial banner should appear
    expect(screen.getByTestId('associate-trial-banner')).toBeTruthy();

    // Run buttons should be disabled
    const runBtn = screen.getByTestId('associate-run-deposition-contradiction-finder');
    expect((runBtn as HTMLButtonElement).disabled).toBe(true);

    // Clicking should NOT fire onStartWorkflow
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
    // The "Open settings" button should be present for needs-provider
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
    // "Open settings" is only shown for needs-provider, not ollama-unreachable
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
});
