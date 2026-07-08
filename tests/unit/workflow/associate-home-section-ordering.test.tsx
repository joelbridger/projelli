/**
 * Rail-ordering tests for AssociateHome — profession-aware ordering.
 *
 * Bug: The "All" view used to render a fixed category order, so an advisor
 * user saw tax workflows before their own Advisor Practice Pack.
 *
 * Fix: The active profession's primary category should provide the first rail
 * rows in the "All" view; all other rows follow in their existing relative order.
 *
 * Profession → primary category mapping (mirrors prioritizeByProfession.ts):
 *   'advisor'    → 'advisors'  (plural — that's the template category key)
 *   'legal'      → 'legal'
 *   'tax'        → 'tax'
 *   'consulting' → 'consulting'
 *   'other'      → no priority (existing order unchanged)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { WorkflowTemplate, RunRecord } from '@/platform/types/workflow';

// ── Minimal template factories ───────────────────────────────────────────────

function tpl(id: string, category: WorkflowTemplate['category']): WorkflowTemplate {
  return {
    id,
    name: id,
    description: `${id} description`,
    version: '1.0.0',
    category,
    steps: [],
    requiredInputs: [],
    outputs: [],
  } as WorkflowTemplate;
}

const advisorTemplates = [
  tpl('annual-review-packet', 'advisors'),
  tpl('reg-bi-doc', 'advisors'),
];
const taxTemplates = [tpl('tax-review', 'tax')];
const consultingTemplates = [tpl('client-discovery', 'consulting')];
const legalTemplates = [tpl('depo-finder', 'legal')];

// ── Mocks ─────────────────────────────────────────────────────────────────────
//
// loadAllTemplates is controlled per-test via mockLoadAllTemplates.

const mockLoadAllTemplates = vi.fn<() => WorkflowTemplate[]>();

vi.mock('@/features/workflows/engine/userTemplates', () => ({
  loadAllTemplates: () => mockLoadAllTemplates(),
}));

// prioritizeByProfession: pass-through — section ordering is what we test here.
// The flat-list reordering done by prioritizeByProfession is already tested in
// prioritizeByProfession.test.ts.  We feed mockLoadAllTemplates an already-ordered
// list that matches what prioritizeByProfession would return for the profession
// (advisors first, no legal for advisor, etc.).
vi.mock('@/features/workflows/engine/prioritizeByProfession', () => ({
  prioritizeByProfession: (templates: WorkflowTemplate[]) => templates,
}));

// Profession store — controlled per describe block via mockProfession / mockIsLaw.
const mockProfession = vi.fn<() => string>(() => 'advisor');
const mockIsLaw = vi.fn<(p: string) => boolean>(() => false);

vi.mock('@/platform/profile/professionStore', () => ({
  useProfessionStore: (selector: (s: { profession: string }) => unknown) =>
    selector({ profession: mockProfession() }),
  isLawExperience: (p: string) => mockIsLaw(p),
  getProfession: () => mockProfession(),
}));

vi.mock('@/platform/hooks/useTrial', () => ({
  useTrialGate: () => ({
    isLocked: false,
    daysRemaining: 25,
    isTrialExpired: false,
    isActivated: true,
    trialDays: 30,
  }),
}));

vi.mock('@/platform/matter/matterStore', () => ({
  useActiveMatter: () => null,
}));

vi.mock('@/platform/rag/matterResolver', () => ({
  matterLabel: (m: { name: string; client: string; id: string }) => m.name || m.id,
}));

// ── Component import (after mocks) ────────────────────────────────────────────

import { AssociateHome } from '@/features/workflows/AssociateHome';

// ── Helpers ───────────────────────────────────────────────────────────────────

function defaultProps() {
  return {
    onStartWorkflow: vi.fn(),
    currentExecution: null,
    runHistory: [] as RunRecord[],
    providerError: null as 'needs-provider' | 'ollama-unreachable' | null,
    onOpenSettings: vi.fn(),
    onFocusExecutionTab: vi.fn(),
  };
}

/** Return the rendered workflow ids in rail order. */
function getWorkflowRowOrder(): string[] {
  return Array.from(
    document.querySelectorAll('[data-testid^="associate-workflow-row-"]'),
  ).map((el) =>
    (el.getAttribute('data-testid') ?? '').replace('associate-workflow-row-', ''),
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AssociateHome — profession-aware rail ordering', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  // ── advisor profession ──────────────────────────────────────────────────────

  it('advisor: advisor workflows render first (before tax)', () => {
    mockProfession.mockReturnValue('advisor');
    mockIsLaw.mockReturnValue(false);
    // Feed templates in the order prioritizeByProfession would produce for
    // advisor: advisors first, then tax (legal excluded entirely).
    mockLoadAllTemplates.mockReturnValue([...advisorTemplates, ...taxTemplates]);

    render(<AssociateHome {...defaultProps()} />);

    const rows = getWorkflowRowOrder();
    expect(rows).toContain('annual-review-packet');
    expect(rows).toContain('tax-review');
    expect(rows.indexOf('annual-review-packet')).toBeLessThan(rows.indexOf('tax-review'));
  });

  it('advisor: advisor workflow is first among three categories', () => {
    mockProfession.mockReturnValue('advisor');
    mockIsLaw.mockReturnValue(false);
    mockLoadAllTemplates.mockReturnValue([
      ...advisorTemplates,
      ...taxTemplates,
      ...consultingTemplates,
    ]);

    render(<AssociateHome {...defaultProps()} />);

    const rows = getWorkflowRowOrder();
    expect(rows[0]).toBe('annual-review-packet');
  });

  it('advisor: no legal workflow appears (legal pack excluded for advisors)', () => {
    mockProfession.mockReturnValue('advisor');
    mockIsLaw.mockReturnValue(false);
    // Do NOT include legal templates — mirroring advisor exclusion.
    mockLoadAllTemplates.mockReturnValue([...advisorTemplates, ...taxTemplates]);

    render(<AssociateHome {...defaultProps()} />);

    expect(screen.queryByTestId('associate-workflow-row-depo-finder')).toBeNull();
    expect(screen.queryByTestId('associate-workflow-row-annual-review-packet')).not.toBeNull();
  });

  // ── legal profession (regression — legal was already first in fixed order) ──

  it('legal: legal workflow is first when multiple categories are present', () => {
    mockProfession.mockReturnValue('legal');
    // isLawExperience = true → AssociateHome scopes to legal-only, so only one
    // section exists. Test with isLawExperience false to exercise multi-section ordering.
    mockIsLaw.mockReturnValue(false);
    mockLoadAllTemplates.mockReturnValue([...legalTemplates, ...taxTemplates]);

    render(<AssociateHome {...defaultProps()} />);

    const rows = getWorkflowRowOrder();
    expect(rows[0]).toBe('depo-finder');
  });

  // ── tax profession ──────────────────────────────────────────────────────────

  it('tax: tax workflow renders first when profession is tax', () => {
    mockProfession.mockReturnValue('tax');
    mockIsLaw.mockReturnValue(false);
    // tax first in flat list (as prioritizeByProfession would produce).
    mockLoadAllTemplates.mockReturnValue([...taxTemplates, ...advisorTemplates]);

    render(<AssociateHome {...defaultProps()} />);

    const rows = getWorkflowRowOrder();
    expect(rows[0]).toBe('tax-review');
    expect(rows).toContain('annual-review-packet');
    expect(rows.indexOf('tax-review')).toBeLessThan(rows.indexOf('annual-review-packet'));
  });

  // ── consulting profession ───────────────────────────────────────────────────

  it('consulting: consulting workflow renders first when profession is consulting', () => {
    mockProfession.mockReturnValue('consulting');
    mockIsLaw.mockReturnValue(false);
    mockLoadAllTemplates.mockReturnValue([...consultingTemplates, ...taxTemplates]);

    render(<AssociateHome {...defaultProps()} />);

    const rows = getWorkflowRowOrder();
    expect(rows[0]).toBe('client-discovery');
  });

  // ── 'other' profession — no priority change ─────────────────────────────────

  it('other: row order is unchanged when profession is other', () => {
    mockProfession.mockReturnValue('other');
    mockIsLaw.mockReturnValue(false);
    // tax + advisors — in fixed CATEGORY_ORDER tax comes before advisors.
    mockLoadAllTemplates.mockReturnValue([...taxTemplates, ...advisorTemplates]);

    render(<AssociateHome {...defaultProps()} />);

    const rows = getWorkflowRowOrder();
    expect(rows[0]).toBe('tax-review');
  });
});
