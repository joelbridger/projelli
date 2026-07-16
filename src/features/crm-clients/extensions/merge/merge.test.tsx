import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { setDevFlagOverride } from '@/platform/flags';
import type { HouseholdRecord } from '../../adapters';
import { getHouseholdHeaderActions } from '../../recordRegistry';
import { HouseholdRecordSurface } from '../../HouseholdRecordSurface';
import { MergeHeaderAction } from './MergeHeaderAction';
import { assessMergeEligibility, buildMergeReview } from './mergeReview';

const { useLiveCrmRecords } = vi.hoisted(() => ({ useLiveCrmRecords: vi.fn() }));
vi.mock('@/platform/crm/useLiveCrmRecords', () => ({ useLiveCrmRecords }));

const source: HouseholdRecord = {
  id: 'source', name: 'Morgan household', lifecycle: 'Active', primaryAdvisor: 'Ada', ownership: 'mine', serviceTier: 'Gold', syncState: 'live',
  facts: [{ id: 'fact-source', label: 'Goal', value: 'Retire', status: 'confirmed', asOf: '2026-07-16', sources: [] }], accounts: [], members: [], externalParties: [], notes: [], tags: [], contextRefs: [],
};
const target = { ...source, id: 'target', name: 'Morgan family', facts: [{ ...source.facts[0], id: 'fact-target' }] };
const context = { household: source, openPanel: vi.fn(), setNoteAudience: vi.fn(), setAdding: vi.fn(), setEditingPerson: vi.fn(), deleteFact: vi.fn(), renderLegacyClientMap: vi.fn() };

afterEach(() => { cleanup(); setDevFlagOverride('crm-merge-clients', undefined); vi.clearAllMocks(); });

describe('duplicate household merge extension', () => {
  it('has one validated public registry descriptor when enabled', () => {
    setDevFlagOverride('crm-merge-clients', true);
    expect(getHouseholdHeaderActions().filter((action) => action.id === 'merge_duplicate')).toHaveLength(1);
  });

  it('is inert while dark: no live-record reader, button, blank slot, or toolbar gap', () => {
    setDevFlagOverride('crm-merge-clients', false);
    const { container } = render(<MergeHeaderAction {...context} />);
    expect(useLiveCrmRecords).not.toHaveBeenCalled();
    expect(screen.queryByTestId('crm-household-merge')).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();

    useLiveCrmRecords.mockReturnValue({ records: [], workspaceRoot: '/workspace', reload: vi.fn() });
    const { getByTestId } = render(<HouseholdRecordSurface household={source} />);
    expect(getByTestId('crm-household-toolbar').innerHTML).toBe(
      '<button type="button" class="kp-btn kp-btn--primary kp-btn--sm" data-testid="crm-household-add"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-plus" aria-hidden="true"><path d="M5 12h14"></path><path d="M12 5v14"></path></svg>Add to this household<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-chevron-down" aria-hidden="true"><path d="m6 9 6 6 6-6"></path></svg></button><span><button type="button" class="kp-btn kp-btn--secondary kp-btn--sm" data-testid="crm-household-metadata">Fields and tags</button></span><span><button type="button" class="kp-btn kp-btn--secondary kp-btn--sm" data-testid="crm-household-edit">Edit household</button></span><span><span title="Ask a firm admin to add a scheduling link" style="font-size: 13px; color: var(--color-slate-500);">Scheduling link unavailable</span></span>'
    );
  });

  it('requires an accessible surviving household and an explicit choice for every conflict', () => {
    setDevFlagOverride('crm-merge-clients', true);
    useLiveCrmRecords.mockReturnValue({ records: [{ ...source, kind: 'household', matterId: 'matter-1' }, { ...target, kind: 'household', matterId: 'matter-1' }], workspaceRoot: '/workspace', reload: vi.fn() });
    render(<MergeHeaderAction {...context} />);
    fireEvent.click(screen.getByTestId('crm-household-merge'));
    fireEvent.change(screen.getByTestId('crm-household-merge-target'), { target: { value: 'target' } });
    expect(screen.getByTestId('crm-household-merge-conflict-name')).toBeInTheDocument();
    expect(screen.getByTestId('crm-household-merge-approve')).toBeDisabled();
    fireEvent.click(within(screen.getByTestId('crm-household-merge-conflict-name')).getByLabelText('Morgan family'));
    fireEvent.click(within(screen.getByTestId('crm-household-merge-conflict-facts')).getByLabelText('Morgan family'));
    expect(screen.getByTestId('crm-household-merge-approve')).toBeEnabled();
    expect(assessMergeEligibility(source, { ...target, ownership: 'other' })).toEqual({ eligible: false, reason: 'inaccessible-household' });
  });

  it('builds a value-free review that counts retained references', () => {
    expect(buildMergeReview(source, target)).toEqual({ sourceId: 'source', targetId: 'target', conflictingFields: ['name', 'facts'], movedReferenceCount: 0 });
  });

  it('requires an advisor choice for a non-scalar conflict', () => {
    const review = buildMergeReview(source, target);
    expect(review.conflictingFields).toContain('facts');
  });
});
