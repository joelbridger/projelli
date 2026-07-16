import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { setDevFlagOverride } from '@/platform/flags';
import type { HouseholdRecord } from '../../adapters';
import { getHouseholdHeaderActions } from '../../recordRegistry';
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
  it('has one validated public registry descriptor', () => {
    expect(getHouseholdHeaderActions().filter((action) => action.id === 'merge_duplicate')).toHaveLength(1);
  });

  it('is inert while dark: no live-record reader, button, blank slot, or toolbar gap', () => {
    setDevFlagOverride('crm-merge-clients', false);
    const { container } = render(<MergeHeaderAction {...context} />);
    expect(useLiveCrmRecords).not.toHaveBeenCalled();
    expect(screen.queryByTestId('crm-household-merge')).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });

  it('requires an accessible surviving household and an explicit choice for every conflict', () => {
    setDevFlagOverride('crm-merge-clients', true);
    useLiveCrmRecords.mockReturnValue({ records: [{ ...source, kind: 'household', matterId: 'matter-1' }, { ...target, kind: 'household', matterId: 'matter-1' }], workspaceRoot: '/workspace', reload: vi.fn() });
    render(<MergeHeaderAction {...context} />);
    fireEvent.click(screen.getByTestId('crm-household-merge'));
    fireEvent.change(screen.getByTestId('crm-household-merge-target'), { target: { value: 'target' } });
    expect(screen.getByTestId('crm-household-merge-conflict-name')).toBeInTheDocument();
    expect(screen.getByTestId('crm-household-merge-approve')).toBeDisabled();
    fireEvent.click(screen.getByLabelText('Morgan family'));
    expect(screen.getByTestId('crm-household-merge-approve')).toBeEnabled();
    expect(assessMergeEligibility(source, { ...target, ownership: 'other' })).toEqual({ eligible: false, reason: 'inaccessible-household' });
  });

  it('builds a value-free review that counts retained references', () => {
    expect(buildMergeReview(source, target)).toEqual({ sourceId: 'source', targetId: 'target', conflictingFields: ['name'], movedReferenceCount: 1 });
  });
});
