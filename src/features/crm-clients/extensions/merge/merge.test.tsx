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
const permissionDoorway = vi.hoisted(() => ({
  ownClientsEnforcementActive: vi.fn(() => Promise.resolve(false)),
  permitsOwnClientRecord: vi.fn(() => true),
}));
vi.mock('@/platform/crm/useLiveCrmRecords', () => ({ useLiveCrmRecords }));
vi.mock('@/features/crm-permissions', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/features/crm-permissions')>(),
  ...permissionDoorway,
}));

const source: HouseholdRecord = {
  id: 'source', name: 'Morgan household', lifecycle: 'Active', primaryAdvisor: 'Ada', ownership: 'mine', serviceTier: 'Gold', syncState: 'live',
  facts: [{ id: 'fact-source', label: 'Goal', value: 'Retire', status: 'confirmed', asOf: '2026-07-16', sources: [] }], accounts: [], members: [], externalParties: [], notes: [], tags: [], contextRefs: [],
};
const target: HouseholdRecord = {
  ...source,
  id: 'target',
  name: 'Morgan family',
  facts: [{ id: 'fact-target', label: 'Goal', value: 'Retire', status: 'confirmed', asOf: '2026-07-16', sources: [] }],
};
const context = { household: source, openPanel: vi.fn(), setNoteAudience: vi.fn(), setAdding: vi.fn(), setEditingPerson: vi.fn(), deleteFact: vi.fn(), renderLegacyClientMap: vi.fn() };

afterEach(() => {
  cleanup();
  setDevFlagOverride('crm-merge-clients', undefined);
  vi.clearAllMocks();
  permissionDoorway.ownClientsEnforcementActive.mockImplementation(() => Promise.resolve(false));
  permissionDoorway.permitsOwnClientRecord.mockReturnValue(true);
});

describe('duplicate household merge extension', () => {
  it('has one validated public registry descriptor when enabled', () => {
    setDevFlagOverride('crm-merge-clients', true);
    expect(getHouseholdHeaderActions().filter((action) => action.id === 'merge_duplicate')).toHaveLength(1);
  });

  it('is inert while dark: no live-record reader, button, blank slot, or toolbar gap', () => {
    setDevFlagOverride('crm-merge-clients', false);
    const { container } = render(<MergeHeaderAction {...context} />);
    expect(useLiveCrmRecords).not.toHaveBeenCalled();
    expect(permissionDoorway.ownClientsEnforcementActive).not.toHaveBeenCalled();
    expect(screen.queryByTestId('crm-household-merge')).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();

    useLiveCrmRecords.mockReturnValue({ records: [], workspaceRoot: '/workspace', reload: vi.fn() });
    const { getByTestId } = render(<HouseholdRecordSurface household={source} />);
    expect(getByTestId('crm-household-toolbar').innerHTML).toBe(
      '<button type="button" class="kp-btn kp-btn--primary kp-btn--sm" data-testid="crm-household-add"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-plus" aria-hidden="true"><path d="M5 12h14"></path><path d="M12 5v14"></path></svg>Add to this household<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-chevron-down" aria-hidden="true"><path d="m6 9 6 6 6-6"></path></svg></button><span><button type="button" class="kp-btn kp-btn--secondary kp-btn--sm" data-testid="crm-household-metadata">Fields and tags</button></span><span><button type="button" class="kp-btn kp-btn--secondary kp-btn--sm" data-testid="crm-household-edit">Edit household</button></span><span><span title="Ask a firm admin to add a scheduling link" style="font-size: 13px; color: var(--color-slate-500);">Scheduling link unavailable</span></span>'
    );
  });

  it('requires an accessible surviving household and an explicit choice for every conflict', async () => {
    setDevFlagOverride('crm-merge-clients', true);
    useLiveCrmRecords.mockReturnValue({ records: [{ ...source, kind: 'household', matterId: 'matter-1' }, { ...target, kind: 'household', matterId: 'matter-1' }], workspaceRoot: '/workspace', reload: vi.fn() });
    render(<MergeHeaderAction {...context} />);
    fireEvent.click(screen.getByTestId('crm-household-merge'));
    fireEvent.change(await screen.findByTestId('crm-household-merge-target'), { target: { value: 'target' } });
    expect(screen.getByTestId('crm-household-merge-conflict-name')).toBeInTheDocument();
    expect(screen.getByTestId('crm-household-merge-approve')).toBeDisabled();
    fireEvent.click(within(screen.getByTestId('crm-household-merge-conflict-name')).getByLabelText('Morgan family'));
    fireEvent.click(within(screen.getByTestId('crm-household-merge-conflict-facts')).getByLabelText('Morgan family'));
    expect(screen.getByTestId('crm-household-merge-approve')).toBeEnabled();
    expect(assessMergeEligibility(source, { ...target, ownership: 'other' })).toEqual({ eligible: false, reason: 'inaccessible-household' });
    expect(permissionDoorway.ownClientsEnforcementActive).toHaveBeenCalledOnce();
    expect(permissionDoorway.permitsOwnClientRecord).toHaveBeenCalled();
  });

  it('builds a value-free review that counts retained references', () => {
    expect(buildMergeReview(source, target)).toEqual({ sourceId: 'source', targetId: 'target', conflictingFields: ['name', 'facts'], movedReferenceCount: 0 });
  });

  it('requires an advisor choice for a non-scalar conflict', () => {
    const review = buildMergeReview(source, target);
    expect(review.conflictingFields).toContain('facts');
  });

  it('retains a non-empty source array when the survivor array is empty', () => {
    const review = buildMergeReview(source, { ...target, facts: [] });
    expect(review.conflictingFields).not.toContain('facts');
    expect(review.movedReferenceCount).toBe(1);
  });

  it('fails the staged read mirror closed if enforcement activates before identity lands', async () => {
    setDevFlagOverride('crm-merge-clients', true);
    permissionDoorway.ownClientsEnforcementActive.mockResolvedValue(true);
    permissionDoorway.permitsOwnClientRecord.mockReturnValue(false);
    useLiveCrmRecords.mockReturnValue({ records: [{ ...source, kind: 'household', matterId: 'matter-1' }, { ...target, kind: 'household', matterId: 'matter-1' }], workspaceRoot: '/workspace', reload: vi.fn() });

    render(<MergeHeaderAction {...context} />);
    fireEvent.click(screen.getByTestId('crm-household-merge'));

    expect(await screen.findByTestId('crm-household-merge-empty')).toBeInTheDocument();
    expect(screen.getByTestId('crm-household-merge-target')).toHaveTextContent('Choose a household');
  });
});
