import '@/i18n';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  DirectorySurface,
  createDirectoryComposition,
  type CrmPerson,
  type DirectoryContribution,
  type HouseholdDirectoryEntry,
} from '@/features/crm-clients';
import * as tagsRail from '@/features/crm-clients/extensions/tags-rail';
import type { FirmTagCatalog, FirmTagStore } from '@/features/crm-tags';
import { setDevFlagOverride } from '@/platform/flags/router';

const { useFirmTagStore } = vi.hoisted(() => ({
  useFirmTagStore: vi.fn(),
}));

vi.mock('@/features/crm-tags', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/crm-tags')>()),
  useFirmTagStore,
}));

const catalog: FirmTagCatalog = {
  version: 1,
  tags: [
    { id: 'tag-client', name: 'Client', color: '#2563eb', status: 'active' },
    { id: 'tag-estate', name: 'Estate', color: '#7e22ce', status: 'retired' },
    { id: 'tag-referral', name: 'Referral', color: '#15803d', status: 'active' },
    { id: 'tag-none', name: 'No matches', color: '#475569', status: 'active' },
  ],
};

const households: readonly HouseholdDirectoryEntry[] = Object.freeze([
  Object.freeze({ id: 'h-client-active', name: 'Client active', lifecycle: 'Active', primaryAdvisor: 'Avery', serviceTier: 'Standard', peopleCount: 2, tagIds: ['tag-client'] }),
  Object.freeze({ id: 'h-client-inactive', name: 'Client inactive', lifecycle: 'Inactive', primaryAdvisor: 'Avery', serviceTier: 'Standard', peopleCount: 1, tagIds: ['tag-client'] }),
  Object.freeze({ id: 'h-estate-active', name: 'Estate active', lifecycle: 'Active', primaryAdvisor: 'Morgan', serviceTier: 'Standard', peopleCount: 3, tagIds: ['tag-estate'] }),
  Object.freeze({ id: 'h-untagged', name: 'Untagged', lifecycle: 'Active', primaryAdvisor: 'Morgan', serviceTier: 'Standard', peopleCount: 1 }),
]);

const people: readonly CrmPerson[] = Object.freeze([
  Object.freeze({ id: 'p-client', name: 'Client person', personType: 'person', roles: [], relatedHouseholds: 1, tagIds: ['tag-client'] }),
  Object.freeze({ id: 'p-referral', name: 'Referral person', personType: 'person', roles: [], relatedHouseholds: 1, tagIds: ['tag-referral'] }),
]);

function buildStore(overrides: Partial<FirmTagStore> = {}): FirmTagStore {
  return {
    catalog,
    errorCode: null,
    list: vi.fn().mockResolvedValue(catalog),
    create: vi.fn(),
    rename: vi.fn(),
    setColor: vi.fn(),
    retire: vi.fn(),
    ...overrides,
  };
}

function renderDirectory(contributions: readonly DirectoryContribution[] = []) {
  return render(
    <DirectorySurface
      households={households}
      people={people}
      composition={createDirectoryComposition(tagsRail.crmTagsRailDirectoryContribution, ...contributions)}
    />,
  );
}

async function openTags() {
  fireEvent.click(screen.getByTestId('crm-directory-tags-rail-toggle'));
  await waitFor(() => {
    expect(screen.queryByTestId('crm-directory-tags-rail-loading')).not.toBeInTheDocument();
  });
}

function selectAndApply(...tagIds: readonly string[]) {
  for (const tagId of tagIds) {
    fireEvent.click(screen.getByTestId(`crm-directory-tags-rail-tag-${tagId}`));
  }
  fireEvent.click(screen.getByTestId('crm-directory-tags-rail-apply'));
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  setDevFlagOverride('crm-tags-rail', undefined);
  useFirmTagStore.mockReset();
});

describe('CRM directory tags rail', () => {
  it('exports only its one stateful public directory contribution', () => {
    expect(Object.keys(tagsRail)).toEqual(['crmTagsRailDirectoryContribution']);
    expect(tagsRail.crmTagsRailDirectoryContribution.namespace).toBe('crm-tags-rail');
    expect(tagsRail.crmTagsRailDirectoryContribution.tools).toHaveLength(1);
    expect(tagsRail.crmTagsRailDirectoryContribution.queries).toHaveLength(1);
  });

  it('is completely inert with no toolbar gap or tag-store load while the flag is off', () => {
    const list = vi.fn().mockResolvedValue(catalog);
    const store = buildStore({ list });
    useFirmTagStore.mockReturnValue(store);
    setDevFlagOverride('crm-tags-rail', false);

    const { unmount } = render(<DirectorySurface households={households} people={people} />);
    const legacyHtml = screen.getByTestId('crm-directory-surface').innerHTML;
    unmount();
    renderDirectory();

    expect(tagsRail.crmTagsRailDirectoryContribution.tools?.[0]?.isEnabled?.()).toBe(false);
    expect(screen.queryByTestId('crm-directory-tags-rail')).not.toBeInTheDocument();
    expect(screen.getByTestId('crm-directory-surface').innerHTML).toBe(legacyHtml);
    expect(useFirmTagStore).not.toHaveBeenCalled();
    expect(list).not.toHaveBeenCalled();
  });

  it('mounts through the public composition seam, applies OR tag matching, and composes with another query by AND', async () => {
    const store = buildStore();
    useFirmTagStore.mockReturnValue(store);
    setDevFlagOverride('crm-tags-rail', true);
    const sourceBeforeProjection = structuredClone(households);
    const activeHouseholdOnly: DirectoryContribution = {
      queries: [{
        id: 'active-household-only',
        order: 10,
        isActive: () => true,
        filter: (result) => result.kind !== 'household' || result.record.lifecycle === 'Active',
      }],
    };

    renderDirectory([activeHouseholdOnly]);
    await openTags();
    selectAndApply('tag-client', 'tag-estate');

    expect(screen.getByTestId('crm-directory-tags-rail-applied')).toHaveTextContent('2 tags applied');
    expect(screen.getByTestId('crm-directory-tags-rail-applied')).toHaveTextContent('Estate Retired');
    const visibleTagDot = screen
      .getByTestId('crm-directory-tags-rail-tag-tag-client')
      .querySelector('[data-tag-color]');
    expect(visibleTagDot).toHaveStyle({ background: 'var(--kp-tag-blue)' });
    expect(screen.getAllByTestId(/^crm-directory-household-/).map((row) => row.dataset['testid'])).toEqual([
      'crm-directory-household-h-client-active',
      'crm-directory-household-h-estate-active',
    ]);
    expect(households).toEqual(sourceBeforeProjection);

    fireEvent.click(screen.getByRole('button', { name: 'People' }));
    expect(screen.getAllByTestId(/^crm-directory-person-/).map((row) => row.dataset['testid'])).toEqual([
      'crm-directory-person-p-client',
    ]);
  });

  it('saves applied IDs and reloads them into a fresh mounted directory state port', async () => {
    const store = buildStore();
    useFirmTagStore.mockReturnValue(store);
    setDevFlagOverride('crm-tags-rail', true);
    const firstSession = renderDirectory();
    await openTags();
    selectAndApply('tag-client');

    firstSession.unmount();
    renderDirectory();

    expect(screen.getAllByTestId(/^crm-directory-household-/).map((row) => row.dataset['testid'])).toEqual([
      'crm-directory-household-h-client-active',
      'crm-directory-household-h-client-inactive',
    ]);
    expect(screen.getByTestId('crm-directory-tags-rail-applied')).toHaveTextContent('1 tag applied');
  });

  it('clears the persisted filter and reports an accessible empty-results state', async () => {
    const store = buildStore();
    useFirmTagStore.mockReturnValue(store);
    setDevFlagOverride('crm-tags-rail', true);
    renderDirectory();
    await openTags();
    selectAndApply('tag-none');

    expect(screen.getByTestId('crm-directory-tags-rail-no-results')).toHaveTextContent(
      'No people or households match these tags.',
    );
    fireEvent.click(screen.getByTestId('crm-directory-tags-rail-reset'));
    expect(screen.queryByTestId('crm-directory-tags-rail-applied')).not.toBeInTheDocument();
    expect(screen.getAllByTestId(/^crm-directory-household-/)).toHaveLength(4);
  });

  it('honestly reports catalog failure without changing its saved tag IDs', async () => {
    const failedStore = buildStore({ list: vi.fn().mockRejectedValue(new Error('unavailable')) });
    useFirmTagStore.mockReturnValue(failedStore);
    setDevFlagOverride('crm-tags-rail', true);
    localStorage.setItem(
      'lantern:crm:directory:preferences:crm-tags-rail:v1',
      JSON.stringify({ version: 1, value: ['tag-client'] }),
    );

    renderDirectory();
    await openTags();

    await waitFor(() => {
      expect(screen.getByTestId('crm-directory-tags-rail-unavailable')).toHaveTextContent(
        'Firm tags are unavailable right now.',
      );
    });
    expect(screen.getByTestId('crm-directory-tags-rail-applied')).toHaveTextContent('1 tag applied');
    expect(localStorage.getItem('lantern:crm:directory:preferences:crm-tags-rail:v1'))
      .toContain('tag-client');
  });

  it('has accessible no-tags-configured and no-results states', async () => {
    const emptyCatalog: FirmTagCatalog = { version: 1, tags: [] };
    const emptyStore = buildStore({ catalog: emptyCatalog, list: vi.fn().mockResolvedValue(emptyCatalog) });
    useFirmTagStore.mockReturnValue(emptyStore);
    setDevFlagOverride('crm-tags-rail', true);
    renderDirectory();
    await openTags();

    expect(screen.getByTestId('crm-directory-tags-rail-empty-catalog')).toHaveTextContent(
      'No firm tags have been configured yet.',
    );
  });
});
