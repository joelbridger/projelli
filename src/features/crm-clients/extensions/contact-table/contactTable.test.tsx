import '@/i18n';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import i18n from '@/i18n';
import { setDevFlagOverride } from '@/platform/flags';
import {
  DirectorySurface,
  createDirectoryComposition,
  type DirectoryQueryDescriptor,
} from '@/features/crm-clients';
import type { ContactDirectoryProjection } from '@/features/crm-contacts';
import { contactTableDirectoryContribution } from '@/features/crm-clients/extensions/contact-table';

vi.mock('@/features/crm-tags', () => ({
  useFirmTagStore: () => ({
    catalog: {
      version: 1,
      tags: [{ id: 'tag-priority', name: 'Priority', color: '#1267A8', status: 'active' }],
    },
  }),
}));

const households = [
  {
    id: 'h-chen',
    name: 'Chen household',
    lifecycle: 'Active',
    primaryAdvisor: 'Avery',
    peopleCount: 2,
    serviceTier: 'Private wealth',
    tagIds: ['tag-priority'],
    lastActivityAt: '2026-07-14',
  },
  {
    id: 'h-bishop',
    name: 'Bishop household',
    lifecycle: 'Prospect',
    primaryAdvisor: 'Morgan',
    peopleCount: 1,
    serviceTier: 'Planning',
    lastActivityAt: '2026-07-11',
  },
] as const;

const people = [
  {
    id: 'p-chen',
    name: 'Maya Chen',
    personType: 'person' as const,
    roles: ['Client'],
    householdRole: 'Primary contact',
    relatedHouseholds: 1,
    tagIds: ['tag-priority'],
    lastActivityAt: '2026-07-15',
    emails: [
      { id: 'email-maya', address: 'maya@example.com', kind: 'Personal', primary: true },
    ],
  },
  {
    id: 'p-lee',
    name: 'Jordan Lee',
    personType: 'organization' as const,
    roles: ['Attorney'],
    external: true,
    relatedHouseholds: 1,
    lastActivityAt: '2026-07-13',
    phones: [
      { id: 'phone-jordan', address: '555-0100', kind: 'Work', primary: true },
    ],
  },
  {
    id: 'p-trust',
    name: 'Zeta Trust',
    personType: 'trust' as const,
    roles: [],
    relatedHouseholds: 0,
  },
] as const;

const composition = createDirectoryComposition(contactTableDirectoryContribution);

const contactRecords: readonly ContactDirectoryProjection[] = [
  { id: 'household:chen', kind: 'household', matterId: 'matter-1', displayName: 'Chen household', lifecycle: 'Active', status: 'Active', ownerDisplay: 'Avery', tagIds: ['tag-priority'], contextRefs: [], ref: { id: 'household:chen', kind: 'household', matterId: 'matter-1', label: 'Chen household' } },
  { id: 'person:maya', kind: 'person', matterId: 'matter-1', displayName: 'Maya Chen', lifecycle: 'Active', status: 'Active', tagIds: [], contextRefs: [], ref: { id: 'person:maya', kind: 'person', matterId: 'matter-1', label: 'Maya Chen' } },
  { id: 'organization:lee', kind: 'organization', matterId: 'matter-1', displayName: 'Lee Legal', lifecycle: 'Prospect', status: 'Prospect', ownerDisplay: 'Morgan', tagIds: [], contextRefs: [], ref: { id: 'organization:lee', kind: 'organization', matterId: 'matter-1', label: 'Lee Legal' } },
  { id: 'trust:chen', kind: 'trust', matterId: 'matter-1', displayName: 'Chen Family Trust', lifecycle: 'Active', status: 'Active', tagIds: [], contextRefs: [], ref: { id: 'trust:chen', kind: 'trust', matterId: 'matter-1', label: 'Chen Family Trust' } },
];

afterEach(async () => {
  cleanup();
  localStorage.clear();
  setDevFlagOverride('crm-contact-table', undefined);
  await i18n.changeLanguage('en');
});

describe('CRM contact table directory contribution', () => {
  it('leaves the complete legacy surface byte-identical while the feature is off', () => {
    setDevFlagOverride('crm-contact-table', false);
    const legacy = render(<DirectorySurface people={people} households={households} />);
    const legacyHtml = legacy.container.innerHTML;
    legacy.unmount();

    const composed = render(
      <DirectorySurface people={people} households={households} composition={composition} />
    );

    expect(composed.container.innerHTML).toBe(legacyHtml);
    expect(screen.getByTestId('crm-directory-household-h-chen')).toBeInTheDocument();
    expect(screen.queryByTestId('crm-contact-table')).not.toBeInTheDocument();
  });

  it('replaces legacy cards with one mixed table using the required columns and tag doorway', () => {
    setDevFlagOverride('crm-contact-table', true);
    const openHousehold = vi.fn();

    render(
      <DirectorySurface
        people={people}
        households={households}
        actions={{ onOpenHousehold: openHousehold }}
        composition={composition}
      />
    );

    expect(screen.getAllByTestId('crm-contact-table')).toHaveLength(1);
    expect(screen.queryByTestId('crm-directory-household-h-chen')).not.toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Name' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Type' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Status' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Tags' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Owner' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Last activity' })).toBeInTheDocument();
    expect(screen.getByTestId('crm-contact-table-household-h-chen')).toHaveTextContent(
      'Priority'
    );
    expect(screen.getByTestId('crm-contact-table-person-p-chen')).toHaveTextContent(
      '2026-07-15'
    );

    fireEvent.click(screen.getByTestId('crm-contact-table-open-household-h-chen'));
    expect(openHousehold).toHaveBeenCalledWith('h-chen');
  });

  it('filters the one mixed projection by local contact Type without mutating records', () => {
    setDevFlagOverride('crm-contact-table', true);
    const originalPeople = structuredClone(people);
    const originalHouseholds = structuredClone(households);

    render(<DirectorySurface people={people} households={households} composition={composition} />);
    fireEvent.change(screen.getByTestId('crm-contact-table-type'), {
      target: { value: 'organization' },
    });

    expect(screen.queryByTestId('crm-contact-table-household-h-chen')).not.toBeInTheDocument();
    expect(screen.queryByTestId('crm-contact-table-person-p-chen')).not.toBeInTheDocument();
    expect(screen.getByTestId('crm-contact-table-person-p-lee')).toBeInTheDocument();
    expect(people).toEqual(originalPeople);
    expect(households).toEqual(originalHouseholds);
  });

  it('searches and globally sorts all four canonical kinds, preserves sources, and opens the exact contact ref', () => {
    setDevFlagOverride('crm-contact-table', true);
    const original = structuredClone(contactRecords);
    const openContact = vi.fn(() => Promise.resolve());
    const resolveContact = vi.fn(() => Promise.resolve(null));
    const compare = vi.fn(
      (left: Parameters<NonNullable<DirectoryQueryDescriptor['compare']>>[0], right: Parameters<NonNullable<DirectoryQueryDescriptor['compare']>>[0]) =>
        left.record.name.localeCompare(right.record.name)
    );
    const queryComposition = createDirectoryComposition(
      { queries: [{ id: 'four-kind-sort', order: 1, isActive: () => true, compare }] },
      contactTableDirectoryContribution,
    );

    render(
      <DirectorySurface
        people={[]}
        households={[]}
        contacts={contactRecords}
        directoryRepository={{ openContact, resolveContact }}
        composition={queryComposition}
      />
    );

    expect(screen.getAllByRole('row').slice(1).map((row) => row.querySelector('button')?.textContent)).toEqual([
      'Chen Family Trust', 'Chen household', 'Lee Legal', 'Maya Chen',
    ]);
    expect(compare.mock.calls.some(([left, right]) => left.record.id.startsWith('household:') !== right.record.id.startsWith('household:'))).toBe(true);
    expect(screen.getByTestId('crm-contact-table-person-organization:lee')).toHaveTextContent('Prospect');
    expect(screen.getByTestId('crm-contact-table-person-organization:lee')).toHaveTextContent('Morgan');
    fireEvent.click(screen.getByTestId('crm-contact-table-open-person-organization:lee'));
    expect(openContact).toHaveBeenCalledWith(contactRecords[2]?.ref);

    fireEvent.change(screen.getByTestId('crm-directory-search'), { target: { value: 'trust' } });
    expect(screen.getByTestId('crm-contact-table-person-trust:chen')).toBeInTheDocument();
    expect(screen.queryByTestId('crm-contact-table-person-organization:lee')).not.toBeInTheDocument();
    expect(contactRecords).toEqual(original);
  });

  it('hands the deliberately partial WB-009 action only to createHousehold', async () => {
    setDevFlagOverride('crm-contact-table', true);
    let resolveCreate = () => {};
    const createHousehold = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveCreate = resolve;
        })
    );
    render(
      <DirectorySurface
        people={people}
        households={households}
        composition={composition}
        onCreateHousehold={createHousehold}
      />
    );

    expect(screen.getByTestId('crm-contact-table-add-household')).toHaveTextContent(
      'Add household'
    );
    fireEvent.click(screen.getByTestId('crm-contact-table-add-household'));
    fireEvent.change(screen.getByTestId('crm-contact-table-household-name'), {
      target: { value: 'New household' },
    });
    fireEvent.click(screen.getByTestId('crm-contact-table-household-save'));
    fireEvent.click(screen.getByTestId('crm-contact-table-household-save'));
    await waitFor(() => {
      expect(createHousehold).toHaveBeenCalledWith('New household');
    });
    expect(createHousehold).toHaveBeenCalledTimes(1);
    resolveCreate();
    // WB-009: PARTIAL — household creation only via createHousehold; WB-010 pending.
  });

  it('uses the composed public query filters and globally orders copied mixed projections', () => {
    setDevFlagOverride('crm-contact-table', true);
    const interleavedHouseholds = [
      { ...households[1], name: 'Bishop household' },
      { ...households[0], name: 'Cedar household' },
    ];
    const interleavedPeople = [
      { ...people[0], id: 'p-aaron', name: 'Aaron Person' },
      { ...people[2], id: 'p-zeta', name: 'Zeta Trust' },
    ];
    const compare = vi.fn(
      (left: Parameters<NonNullable<DirectoryQueryDescriptor['compare']>>[0], right: Parameters<NonNullable<DirectoryQueryDescriptor['compare']>>[0]) =>
        left.record.name.localeCompare(right.record.name)
    );
    const query: DirectoryQueryDescriptor<'contact-table-query-proof'> = {
      id: 'contact-table-query-proof',
      order: 1,
      isActive: () => true,
      filter: (result) => result.record.id !== 'p-zeta',
      compare,
    };
    const queryComposition = createDirectoryComposition(
      { queries: [query] },
      contactTableDirectoryContribution
    );
    const originalPeople = structuredClone(interleavedPeople);
    const originalHouseholds = structuredClone(interleavedHouseholds);

    render(
      <DirectorySurface people={interleavedPeople} households={interleavedHouseholds} composition={queryComposition} />
    );

    expect(screen.queryByTestId('crm-contact-table-person-p-zeta')).not.toBeInTheDocument();
    expect(screen.getAllByRole('row').slice(1).map((row) => row.querySelector('button')?.textContent)).toEqual(
      ['Aaron Person', 'Bishop household', 'Cedar household']
    );
    expect(compare).toHaveBeenCalled();
    expect(compare.mock.calls.some(([left, right]) => left.kind !== right.kind)).toBe(true);
    expect(interleavedPeople).toEqual(originalPeople);
    expect(interleavedHouseholds).toEqual(originalHouseholds);
  });

  it('applies search and existing external filters to its mixed rows', () => {
    setDevFlagOverride('crm-contact-table', true);
    render(<DirectorySurface people={people} households={households} composition={composition} />);

    fireEvent.change(screen.getByTestId('crm-directory-search'), { target: { value: 'chen' } });
    expect(screen.getByTestId('crm-contact-table-household-h-chen')).toBeInTheDocument();
    expect(screen.getByTestId('crm-contact-table-person-p-chen')).toBeInTheDocument();
    expect(screen.queryByTestId('crm-contact-table-person-p-lee')).not.toBeInTheDocument();

    fireEvent.change(screen.getByTestId('crm-directory-search'), { target: { value: '' } });
    fireEvent.click(screen.getByTestId('crm-directory-external'));
    expect(screen.queryByTestId('crm-contact-table-person-p-chen')).not.toBeInTheDocument();
    expect(screen.getByTestId('crm-contact-table-person-p-lee')).toBeInTheDocument();
  });

  it('honors the existing Households and People toolbar toggle', () => {
    setDevFlagOverride('crm-contact-table', true);
    render(<DirectorySurface people={people} households={households} composition={composition} />);

    fireEvent.click(screen.getByTestId('crm-directory-tab-people'));
    expect(screen.queryByTestId('crm-contact-table-household-h-chen')).not.toBeInTheDocument();
    expect(screen.getByTestId('crm-contact-table-person-p-chen')).toBeInTheDocument();
    expect(screen.getByTestId('crm-contact-table-person-p-lee')).toBeInTheDocument();
    expect(screen.getByTestId('crm-contact-table-person-p-trust')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('crm-directory-tab-households'));
    expect(screen.getByTestId('crm-contact-table-household-h-chen')).toBeInTheDocument();
    expect(screen.queryByTestId('crm-contact-table-person-p-chen')).not.toBeInTheDocument();

    fireEvent.change(screen.getByTestId('crm-contact-table-type'), {
      target: { value: 'organization' },
    });
    fireEvent.click(screen.getByTestId('crm-directory-tab-people'));
    expect(screen.getByTestId('crm-contact-table-person-p-lee')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('crm-directory-tab-households'));
    expect(screen.queryByTestId('crm-contact-table-person-p-lee')).not.toBeInTheDocument();
    expect(screen.getByTestId('crm-contact-table-empty')).toBeInTheDocument();
  });

  it('unlocks the Add household form when a synchronous repository call fails', async () => {
    setDevFlagOverride('crm-contact-table', true);
    render(
      <DirectorySurface
        people={people}
        households={households}
        composition={composition}
        onCreateHousehold={() => {
          throw new Error('unavailable');
        }}
      />
    );

    fireEvent.click(screen.getByTestId('crm-contact-table-add-household'));
    fireEvent.change(screen.getByTestId('crm-contact-table-household-name'), {
      target: { value: 'New household' },
    });
    fireEvent.click(screen.getByTestId('crm-contact-table-household-save'));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Could not create the household.');
    });
    expect(screen.getByTestId('crm-contact-table-household-save')).not.toBeDisabled();
  });

  it('saves its display preference through the directory doorway and reloads it', () => {
    setDevFlagOverride('crm-contact-table', true);
    const firstMount = render(
      <DirectorySurface people={people} households={households} composition={composition} />
    );

    expect(screen.getByTestId('crm-contact-table')).toHaveAttribute('data-density', 'comfortable');
    fireEvent.click(screen.getByTestId('crm-contact-table-density'));
    expect(screen.getByTestId('crm-contact-table')).toHaveAttribute('data-density', 'compact');
    firstMount.unmount();

    render(<DirectorySurface people={people} households={households} composition={composition} />);
    expect(screen.getByTestId('crm-contact-table')).toHaveAttribute('data-density', 'compact');
  });

  it('loads its locale shard through the client language facade', async () => {
    setDevFlagOverride('crm-contact-table', true);
    render(<DirectorySurface people={people} households={households} composition={composition} />);

    await i18n.changeLanguage('de');
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Kontakte' })).toBeInTheDocument();
    });
    expect(screen.getByRole('columnheader', { name: 'Letzte Aktivität' })).toBeInTheDocument();
  });
});
