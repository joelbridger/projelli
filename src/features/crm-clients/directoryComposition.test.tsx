import '@/i18n';
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import {
  DirectorySurface,
  createDirectoryComposition,
  createDirectoryPreferenceStore,
  projectDirectoryResults,
  type DirectoryContribution,
  type DirectoryContext,
  type DirectoryFeatureQueryDescriptor,
  type DirectoryFeatureState,
  type DirectoryQueryDescriptor,
  type DirectoryResult,
  type DirectoryFeatureToolDescriptor,
  type DirectoryViewDescriptor,
} from '@/features/crm-clients';
import type { CrmPerson, HouseholdDirectoryEntry } from '@/features/crm-clients';
import { useMatterStore } from '@/platform/matter/matterStore';
import { useClientMapStore } from '@/platform/clientMap/clientMapStore';
import type { Matter } from '@/platform/types/matter';
import { isEnabled, setDevFlagOverride } from '@/platform/flags/router';

declare module './directoryRegistry' {
  interface DirectoryToolIdMap {
    'test-reactive-sort-tool': true;
  }
}

const REACTIVE_SORT_TOOL_LABEL = 'Sort by name';
const OTHER_FEATURE_TOOL_LABEL = 'Filter by advisor';

const households: readonly HouseholdDirectoryEntry[] = Object.freeze([
  Object.freeze({ id: 'h-c', name: 'Chen household', lifecycle: 'Inactive', primaryAdvisor: 'Avery', serviceTier: 'Standard', peopleCount: 3 }),
  Object.freeze({ id: 'h-a', name: 'Alvarez household', lifecycle: 'Active', primaryAdvisor: 'Morgan', serviceTier: 'Standard', peopleCount: 1 }),
  Object.freeze({ id: 'h-b', name: 'Bishop household', lifecycle: 'Active', primaryAdvisor: 'Avery', serviceTier: 'Standard', peopleCount: 2 }),
]);

const people: readonly CrmPerson[] = Object.freeze([
  Object.freeze({
    id: 'p-a',
    name: 'Adams person',
    personType: 'person',
    roles: Object.freeze(['Client']),
    relatedHouseholds: 1,
  }),
  Object.freeze({
    id: 'p-d',
    name: 'Diaz person',
    personType: 'person',
    roles: Object.freeze(['Client']),
    relatedHouseholds: 1,
  }),
]);

const projectionContext: DirectoryContext = {
  query: { value: '', setValue: vi.fn() },
  selection: { person: null, setPerson: vi.fn() },
  view: { value: 'directory', setValue: vi.fn() },
  sort: { value: 'directory', setValue: vi.fn() },
  filters: {
    tab: 'households',
    setTab: vi.fn(),
    externalOnly: false,
    setExternalOnly: vi.fn(),
    needsVerification: false,
    setNeedsVerification: vi.fn(),
  },
  records: { people, households },
  repository: {
    openContact: vi.fn(),
    resolveContact: vi.fn(),
  },
  legacyRepository: {
    openHousehold: vi.fn(),
    reviewRecipient: vi.fn(),
    createHousehold: vi.fn(),
  },
  composition: createDirectoryComposition(),
};

const BASE_ERA_SURFACE_CHILDREN = ['header', 'div#crm-directory-toolbar', 'div', 'span'];
const BASE_ERA_BOOK_SURFACE_CHILDREN = ['header', 'div#crm-directory-toolbar', 'div#book-view', 'span'];
const BASE_ERA_DEFAULT_TOOL_MOUNTS = [
  ['crm-directory-view-directory', 'crm-directory-view-book'],
  ['crm-directory-tab-households', 'crm-directory-tab-people'],
  ['crm-directory-search'],
  ['crm-directory-external'],
  ['crm-directory-needs-verification'],
  ['crm-directory-add'],
];
const BASE_ERA_DEFAULT_VIEW_MOUNTS = [
  ['crm-directory-household-h-c', 'crm-directory-household-h-a', 'crm-directory-household-h-b'],
  [],
];
const BASE_ERA_BOOK_TOOL_MOUNTS = [
  ['crm-directory-view-directory', 'crm-directory-view-book'],
  ['crm-directory-tab-households', 'crm-directory-tab-people'],
  [],
  [],
  [],
  [],
];
const BASE_ERA_BOOK_VIEW_MOUNTS = [
  ['book-row-m-a', 'book-row-m-b'],
  [],
];

function matter(id: string, client: string): Matter {
  return {
    id,
    name: client,
    client,
    folderPaths: [`Clients/${client}`],
    createdAt: '2026-01-01T00:00:00.000Z',
  } as Matter;
}

function descendantHandles(element: Element): string[] {
  return Array.from(element.querySelectorAll<HTMLElement>('[data-testid]'))
    .map((child) => child.dataset['testid'])
    .filter((handle): handle is string => handle !== undefined);
}

function legacyMountShape(surface: HTMLElement) {
  const children = Array.from(surface.children);
  const toolbar = children[1];
  if (!toolbar) throw new Error('Expected the base-era directory toolbar');
  return {
    surfaceChildren: children.map((child) => {
      const handle = child.getAttribute('data-testid');
      return `${child.tagName.toLowerCase()}${handle ? `#${handle}` : ''}`;
    }),
    toolMounts: Array.from(toolbar.children).map(descendantHandles),
    viewAndRailMounts: children.slice(2).map(descendantHandles),
  };
}

afterEach(() => {
  localStorage.clear();
  act(() => {
    setDevFlagOverride('crm-bulk-select', undefined);
    setDevFlagOverride('own-clients-permissions', undefined);
  });
  useMatterStore.setState({ matters: [] });
  useClientMapStore.setState({ maps: {}, clientQuestions: {} });
});

describe('directory composition public seam', () => {
  it('preserves legacy and mixed array identity when no query is active', () => {
    const inactive: DirectoryQueryDescriptor<'test-inactive-query'> = {
      id: 'test-inactive-query',
      order: 10,
      isActive: () => false,
      filter: () => true,
    };
    const mixed: readonly DirectoryResult[] = [
      { kind: 'household', record: households[0] as HouseholdDirectoryEntry },
      { kind: 'person', record: people[0] as CrmPerson },
    ];

    expect(projectDirectoryResults('household', households, projectionContext, [])).toBe(households);
    expect(projectDirectoryResults('household', households, projectionContext, [inactive])).toBe(households);
    expect(projectDirectoryResults(mixed, projectionContext, [])).toBe(mixed);
    expect(projectDirectoryResults(mixed, projectionContext, [inactive])).toBe(mixed);
  });

  it('orders one interleaved mixed projection globally across both record kinds', () => {
    const mixed: readonly DirectoryResult[] = [
      { kind: 'household', record: households[2] as HouseholdDirectoryEntry },
      { kind: 'person', record: people[0] as CrmPerson },
      { kind: 'household', record: households[1] as HouseholdDirectoryEntry },
      { kind: 'person', record: people[1] as CrmPerson },
    ];
    const byName: DirectoryQueryDescriptor<'test-mixed-name-sort'> = {
      id: 'test-mixed-name-sort',
      order: 10,
      isActive: () => true,
      compare: (left, right) => left.record.name.localeCompare(right.record.name),
    };

    const projected = projectDirectoryResults(mixed, projectionContext, [byName]);

    expect(projected.map(({ kind, record }) => `${kind}:${record.id}`)).toEqual([
      'person:p-a',
      'household:h-a',
      'household:h-b',
      'person:p-d',
    ]);
    expect(projected[0]).toBe(mixed[1]);
    expect(projected[1]).toBe(mixed[2]);
    expect(projected[2]).toBe(mixed[0]);
    expect(projected[3]).toBe(mixed[3]);
  });

  it('gives mixed callbacks isolated clones and returns the surviving source wrappers', () => {
    const sourceHouseholdRecord: HouseholdDirectoryEntry = {
      id: 'h-source',
      name: 'Source household',
      lifecycle: 'Active',
      primaryAdvisor: 'Avery',
      serviceTier: 'Standard',
      peopleCount: 2,
      tagIds: ['source-household-tag'],
    };
    const sourcePersonRecord: CrmPerson = {
      id: 'p-source',
      name: 'Source person',
      personType: 'person',
      roles: ['Client'],
      relatedHouseholds: 1,
      tagIds: ['source-person-tag'],
    };
    const sourceHousehold = { kind: 'household', record: sourceHouseholdRecord } as const;
    const sourcePerson = { kind: 'person', record: sourcePersonRecord } as const;
    const mixed: readonly DirectoryResult[] = [sourceHousehold, sourcePerson];
    const callbackResults: DirectoryResult[] = [];
    const comparedResults: DirectoryResult[] = [];
    const filter: NonNullable<DirectoryQueryDescriptor['filter']> = (result, context) => {
      callbackResults.push(result);
      const mutableResult = result as unknown as {
        kind: DirectoryResult['kind'];
        record: { name: string; tagIds: string[] };
      };
      mutableResult.kind = result.kind === 'household' ? 'person' : 'household';
      mutableResult.record.name = 'Mutated callback record';
      mutableResult.record.tagIds.push('mutated-callback-tag');
      const contextHousehold = context.records.households[0];
      if (contextHousehold) {
        (contextHousehold as { name: string }).name = 'Mutated callback context';
      }
      return true;
    };
    const compare: NonNullable<DirectoryQueryDescriptor['compare']> = (left, right) => {
      comparedResults.push(left, right);
      (left.record as { name: string }).name = 'Mutated left comparison record';
      (right.record as { name: string }).name = 'Mutated right comparison record';
      return left.record.id.localeCompare(right.record.id);
    };
    const cloneProbe: DirectoryQueryDescriptor<'test-mixed-clone-probe'> = {
      id: 'test-mixed-clone-probe',
      order: 10,
      isActive: () => true,
      filter,
      compare,
    };

    const projected = projectDirectoryResults(mixed, projectionContext, [cloneProbe]);

    expect(projected).not.toBe(mixed);
    expect(projected[0]).toBe(sourceHousehold);
    expect(projected[1]).toBe(sourcePerson);
    expect(callbackResults[0]).not.toBe(sourceHousehold);
    expect(callbackResults[0]?.record).not.toBe(sourceHouseholdRecord);
    expect(callbackResults[1]).not.toBe(sourcePerson);
    expect(callbackResults[1]?.record).not.toBe(sourcePersonRecord);
    expect(comparedResults).not.toHaveLength(0);
    expect(comparedResults).not.toContain(sourceHousehold);
    expect(comparedResults).not.toContain(sourcePerson);
    expect(sourceHousehold).toEqual({ kind: 'household', record: sourceHouseholdRecord });
    expect(sourceHouseholdRecord).toEqual({
      id: 'h-source',
      name: 'Source household',
      lifecycle: 'Active',
      primaryAdvisor: 'Avery',
      serviceTier: 'Standard',
      peopleCount: 2,
      tagIds: ['source-household-tag'],
    });
    expect(sourcePerson).toEqual({ kind: 'person', record: sourcePersonRecord });
    expect(sourcePersonRecord.name).toBe('Source person');
    expect(sourcePersonRecord.tagIds).toEqual(['source-person-tag']);
    expect(projectionContext.records.households[0]?.name).toBe('Chen household');
  });

  it('keeps source order and wrappers on the active filter-only path', () => {
    const sourceHousehold = {
      kind: 'household',
      record: households[0] as HouseholdDirectoryEntry,
    } as const;
    const sourcePerson = {
      kind: 'person',
      record: people[0] as CrmPerson,
    } as const;
    const mixed: readonly DirectoryResult[] = [sourceHousehold, sourcePerson];
    const householdsOnly: DirectoryQueryDescriptor<'test-households-only'> = {
      id: 'test-households-only',
      order: 10,
      isActive: () => true,
      filter: (result) => result.kind === 'household',
    };

    const projected = projectDirectoryResults(mixed, projectionContext, [householdsOnly]);

    expect(projected).not.toBe(mixed);
    expect(projected).toHaveLength(1);
    expect(projected[0]).toBe(sourceHousehold);
  });

  it('validates mixed descriptors and handles empty and all-filtered projections', () => {
    const empty: readonly DirectoryResult[] = [];
    const activeFilter: DirectoryQueryDescriptor<'test-filter-all'> = {
      id: 'test-filter-all',
      order: 10,
      isActive: () => true,
      filter: () => false,
    };
    const mixed: readonly DirectoryResult[] = [
      { kind: 'household', record: households[0] as HouseholdDirectoryEntry },
      { kind: 'person', record: people[0] as CrmPerson },
    ];
    const duplicateDescriptors: readonly DirectoryQueryDescriptor<string>[] = [
      activeFilter,
      { ...activeFilter },
    ];

    expect(projectDirectoryResults(empty, projectionContext, [])).toBe(empty);
    expect(projectDirectoryResults(empty, projectionContext, [activeFilter])).toEqual([]);
    expect(projectDirectoryResults(mixed, projectionContext, [activeFilter])).toEqual([]);
    expect(() => projectDirectoryResults(mixed, projectionContext, duplicateDescriptors))
      .toThrow('duplicate id: test-filter-all');
  });

  it('matches the fixed base-era directory and Whole book mount shapes without a contribution', () => {
    act(() => {
      setDevFlagOverride('own-clients-permissions', true);
    });
    useMatterStore.setState({ matters: [matter('m-b', 'Bishop'), matter('m-a', 'Alvarez')] });
    useClientMapStore.setState({ maps: {}, clientQuestions: {} });
    render(<DirectorySurface people={[]} households={households} />);

    const surface = screen.getByTestId('crm-directory-surface');
    expect(legacyMountShape(surface)).toEqual({
      surfaceChildren: BASE_ERA_SURFACE_CHILDREN,
      toolMounts: BASE_ERA_DEFAULT_TOOL_MOUNTS,
      viewAndRailMounts: BASE_ERA_DEFAULT_VIEW_MOUNTS,
    });
    expect(screen.queryByTestId('test-feature-view')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('crm-directory-view-book'));

    expect(legacyMountShape(surface)).toEqual({
      surfaceChildren: BASE_ERA_BOOK_SURFACE_CHILDREN,
      toolMounts: BASE_ERA_BOOK_TOOL_MOUNTS,
      viewAndRailMounts: BASE_ERA_BOOK_VIEW_MOUNTS,
    });
  });

  it('keeps the Whole book control hidden until staff permissions are ready', () => {
    render(<DirectorySurface people={[]} households={households} />);

    expect(screen.getByTestId('crm-directory-view-directory')).toBeTruthy();
    expect(screen.queryByTestId('crm-directory-view-book')).toBeNull();
    expect(screen.queryByText('Whole book')).toBeNull();
  });

  it('selects one active feature view and replaces the legacy cards', () => {
    const featureView: DirectoryViewDescriptor<'test-feature-view'> = {
      id: 'test-feature-view',
      order: 100,
      replaces: ['directory'],
      isActive: () => true,
      mount: (context) => <div data-testid="test-feature-view">{context.records.households.length} records</div>,
    };
    const contactTableContributionPattern: DirectoryContribution = { views: [featureView] };
    const composition = createDirectoryComposition(contactTableContributionPattern);

    render(<DirectorySurface people={[]} households={households} composition={composition} />);

    expect(screen.getByTestId('test-feature-view')).toHaveTextContent('3 records');
    expect(screen.queryByTestId('crm-directory-household-h-b')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('test-feature-view')).toHaveLength(1);
  });

  it('leaves the legacy DOM byte-identical when a registered feature view is inactive', () => {
    const inactiveView: DirectoryViewDescriptor<'test-inactive-view'> = {
      id: 'test-inactive-view',
      order: 100,
      replaces: ['directory'],
      isActive: () => false,
      mount: () => <div data-testid="test-inactive-view" />,
    };
    const { unmount } = render(<DirectorySurface people={[]} households={households} />);
    const legacyHtml = screen.getByTestId('crm-directory-surface').innerHTML;
    unmount();
    const composition = createDirectoryComposition({ views: [inactiveView] });

    render(<DirectorySurface people={[]} households={households} composition={composition} />);

    expect(screen.queryByTestId('test-inactive-view')).not.toBeInTheDocument();
    expect(screen.getByTestId('crm-directory-household-h-b')).toBeInTheDocument();
    expect(screen.getByTestId('crm-directory-surface').innerHTML).toBe(legacyHtml);
  });

  it('filters the projection and preserves the reversed surviving source order', () => {
    const filter = vi.fn((result: Parameters<NonNullable<DirectoryQueryDescriptor['filter']>>[0]) =>
      result.kind !== 'household' || result.record.primaryAdvisor === 'Avery');
    const advisorFilter: DirectoryQueryDescriptor<'test-advisor-filter'> = {
      id: 'test-advisor-filter',
      order: 10,
      isActive: () => true,
      filter,
    };
    const composition = createDirectoryComposition({ queries: [advisorFilter] });

    render(<DirectorySurface people={[]} households={households} composition={composition} />);

    const rows = screen.getAllByTestId(/^crm-directory-household-/);
    expect(rows.map((row) => row.dataset['testid'])).toEqual([
      'crm-directory-household-h-c',
      'crm-directory-household-h-b',
    ]);
    expect(filter).toHaveBeenCalledTimes(3);
  });

  it('sorts an intentionally reversed projection and invokes the comparator', () => {
    const compare = vi.fn((
      left: Parameters<NonNullable<DirectoryQueryDescriptor['compare']>>[0],
      right: Parameters<NonNullable<DirectoryQueryDescriptor['compare']>>[1],
    ) => left.record.name.localeCompare(right.record.name));
    const nameSort: DirectoryQueryDescriptor<'test-name-sort'> = {
      id: 'test-name-sort',
      order: 10,
      isActive: () => true,
      compare,
    };
    const composition = createDirectoryComposition({ queries: [nameSort] });

    render(<DirectorySurface people={[]} households={households} composition={composition} />);

    const rows = screen.getAllByTestId(/^crm-directory-household-/);
    expect(rows.map((row) => row.dataset['testid'])).toEqual([
      'crm-directory-household-h-a',
      'crm-directory-household-h-b',
      'crm-directory-household-h-c',
    ]);
    expect(compare).toHaveBeenCalled();
    expect(households.map(({ id }) => id)).toEqual(['h-c', 'h-a', 'h-b']);
  });

  it('restores legacy order immediately when a contribution flag turns off', () => {
    const flagGatedSort: DirectoryQueryDescriptor<'test-flag-gated-sort'> = {
      id: 'test-flag-gated-sort',
      order: 10,
      isActive: () => isEnabled('crm-bulk-select'),
      compare: (left, right) => left.record.name.localeCompare(right.record.name),
    };
    const composition = createDirectoryComposition({ queries: [flagGatedSort] });
    setDevFlagOverride('crm-bulk-select', true);

    render(<DirectorySurface people={[]} households={households} composition={composition} />);

    expect(screen.getAllByTestId(/^crm-directory-household-/).map((row) => row.dataset['testid'])).toEqual([
      'crm-directory-household-h-a',
      'crm-directory-household-h-b',
      'crm-directory-household-h-c',
    ]);
    act(() => {
      setDevFlagOverride('crm-bulk-select', false);
    });
    expect(screen.getAllByTestId(/^crm-directory-household-/).map((row) => row.dataset['testid'])).toEqual([
      'crm-directory-household-h-c',
      'crm-directory-household-h-a',
      'crm-directory-household-h-b',
    ]);
  });

  it('re-projects through the public seam when a mounted feature tool changes its state', () => {
    const sortTool: DirectoryFeatureToolDescriptor<'name-ascending'> = {
      id: 'test-reactive-sort-tool',
      order: 100,
      mount: (context) => <button data-testid="test-reactive-sort" onClick={() => {
        context.featureState.set('name-ascending');
      }}>{REACTIVE_SORT_TOOL_LABEL}</button>,
    };
    const nameSort: DirectoryFeatureQueryDescriptor<'name-ascending'> = {
      id: 'test-reactive-sort',
      order: 10,
      isActive: (context) => context.featureState.get() === 'name-ascending',
      compare: (left, right) => left.record.name.localeCompare(right.record.name),
    };
    const composition = createDirectoryComposition({
      namespace: 'test-reactive-sort',
      tools: [sortTool],
      queries: [nameSort],
    });

    render(<DirectorySurface people={[]} households={households} composition={composition} />);

    expect(screen.getAllByTestId(/^crm-directory-household-/).map((row) => row.dataset['testid'])).toEqual([
      'crm-directory-household-h-c',
      'crm-directory-household-h-a',
      'crm-directory-household-h-b',
    ]);
    fireEvent.click(screen.getByTestId('test-reactive-sort'));
    expect(screen.getAllByTestId(/^crm-directory-household-/).map((row) => row.dataset['testid'])).toEqual([
      'crm-directory-household-h-a',
      'crm-directory-household-h-b',
      'crm-directory-household-h-c',
    ]);
  });

  it('gives each contributed feature an independent state port', () => {
    const sortTool: DirectoryFeatureToolDescriptor<'name-ascending'> = {
      id: 'test-reactive-sort-tool',
      order: 100,
      mount: (context) => <button data-testid="test-reactive-sort" onClick={() => {
        context.featureState.set('name-ascending');
      }}>{REACTIVE_SORT_TOOL_LABEL}</button>,
    };
    const otherTool: DirectoryFeatureToolDescriptor<'advisor-only'> = {
      id: 'test-other-feature-tool',
      order: 101,
      mount: (context) => <button data-testid="test-other-feature" onClick={() => {
        context.featureState.set('advisor-only');
      }}>{OTHER_FEATURE_TOOL_LABEL}</button>,
    };
    type QueryCompare = NonNullable<DirectoryFeatureQueryDescriptor<'name-ascending'>['compare']>;
    const ownNamespaceSort = vi.fn((
      _left: Parameters<QueryCompare>[0],
      _right: Parameters<QueryCompare>[1],
    ) => 0);
    const otherNamespaceSort = vi.fn(() => 0);
    const sortContribution = {
      namespace: 'test-reactive-sort',
      tools: [sortTool],
      queries: [
        {
          id: 'test-reactive-sort',
          order: 10,
          isActive: (context) => context.featureState.get() === 'name-ascending',
          compare: ownNamespaceSort,
        },
      ],
    } satisfies DirectoryContribution<'name-ascending'>;
    const otherContribution = {
      namespace: 'test-other-feature',
      tools: [otherTool],
      queries: [
        {
          id: 'test-other-feature',
          order: 20,
          isActive: (context) => context.featureState.get() === 'advisor-only',
          compare: otherNamespaceSort,
        },
      ],
    } satisfies DirectoryContribution<'advisor-only'>;
    expectTypeOf<Parameters<DirectoryFeatureState<'name-ascending'>['get']>>().toEqualTypeOf<[]>();
    expectTypeOf<Parameters<DirectoryFeatureState<'name-ascending'>['set']>>()
      .toEqualTypeOf<[value: 'name-ascending']>();
    expectTypeOf<{ tools: readonly DirectoryFeatureToolDescriptor<'name-ascending'>[] }>()
      .not.toExtend<DirectoryContribution<'name-ascending'>>();
    const composition = createDirectoryComposition(sortContribution, otherContribution);

    render(<DirectorySurface people={[]} households={households} composition={composition} />);
    fireEvent.click(screen.getByTestId('test-reactive-sort'));
    fireEvent.click(screen.getByTestId('test-other-feature'));

    expect(ownNamespaceSort).toHaveBeenCalled();
    expect(otherNamespaceSort).toHaveBeenCalled();
    expect(() => createDirectoryComposition(sortContribution, { ...otherContribution, namespace: 'test-reactive-sort' }))
      .toThrow('duplicate feature namespace: test-reactive-sort');
    expect(() => createDirectoryComposition({ ...otherContribution, namespace: 'Invalid namespace' }))
      .toThrow('feature namespace must use lowercase letters, numbers, dots, or hyphens');
  });

  it('passes timestamp fields through directory projections when they are present', () => {
    const timestamps = vi.fn();
    const firstHousehold = households[0];
    if (!firstHousehold) throw new Error('Expected timestamp fixture household');
    const timestampedHouseholds: readonly HouseholdDirectoryEntry[] = [{
      ...firstHousehold,
      createdAt: '2026-07-10T00:00:00.000Z',
      updatedAt: '2026-07-11T00:00:00.000Z',
    }];
    const timestampProbe: DirectoryQueryDescriptor<'test-timestamp-probe'> = {
      id: 'test-timestamp-probe',
      order: 10,
      isActive: () => true,
      filter: (result) => {
        timestamps(result.record.createdAt, result.record.updatedAt);
        return true;
      },
    };
    const composition = createDirectoryComposition({ queries: [timestampProbe] });

    render(<DirectorySurface people={[]} households={timestampedHouseholds} composition={composition} />);

    expect(timestamps).toHaveBeenCalledWith(
      '2026-07-10T00:00:00.000Z',
      '2026-07-11T00:00:00.000Z',
    );
  });

  it('isolates filter and sort callback mutation attempts from source records and visible cards', () => {
    const mutableRecords = households.map((household) => ({ ...household }));
    const before = structuredClone(mutableRecords);
    type QueryFilter = NonNullable<DirectoryQueryDescriptor['filter']>;
    type QueryCompare = NonNullable<DirectoryQueryDescriptor['compare']>;
    const filter = vi.fn((
      result: Parameters<QueryFilter>[0],
      callbackContext: Parameters<QueryFilter>[1],
    ) => {
      if (result.kind === 'household') {
        const mutableResult = result.record as { name: string };
        mutableResult.name = 'Filter rewrote its result';
        const contextRecord = callbackContext.records.households[0];
        if (contextRecord) {
          const mutableContextRecord = contextRecord as { name: string };
          mutableContextRecord.name = 'Filter rewrote its context';
        }
      }
      return true;
    });
    const compare = vi.fn((
      left: Parameters<QueryCompare>[0],
      right: Parameters<QueryCompare>[1],
      callbackContext: Parameters<QueryCompare>[2],
    ) => {
      if (left.kind === 'household' && right.kind === 'household') {
        const mutableLeft = left.record as { name: string };
        const mutableRight = right.record as { name: string };
        mutableLeft.name = 'Sort rewrote its left result';
        mutableRight.name = 'Sort rewrote its right result';
        const contextRecord = callbackContext.records.households[1];
        if (contextRecord) {
          const mutableContextRecord = contextRecord as { name: string };
          mutableContextRecord.name = 'Sort rewrote its context';
        }
      }
      return left.record.id.localeCompare(right.record.id);
    });
    const mutationAttempt: DirectoryQueryDescriptor<'test-mutation-attempt'> = {
      id: 'test-mutation-attempt',
      order: 10,
      isActive: () => true,
      filter,
      compare,
    };
    const composition = createDirectoryComposition({ queries: [mutationAttempt] });

    render(<DirectorySurface people={[]} households={mutableRecords} composition={composition} />);

    expect(mutableRecords).toEqual(before);
    expect(filter).toHaveBeenCalledTimes(3);
    expect(compare).toHaveBeenCalled();
    expect(screen.getAllByTestId(/^crm-directory-household-/).map((row) => ({
      id: row.dataset['testid'],
      text: row.textContent,
    }))).toEqual([
      { id: 'crm-directory-household-h-a', text: 'Alvarez householdStandardActive · Owned by Morgan · 1 people' },
      { id: 'crm-directory-household-h-b', text: 'Bishop householdStandardActive · Owned by Avery · 2 people' },
      { id: 'crm-directory-household-h-c', text: 'Chen householdStandardInactive · Owned by Avery · 3 people' },
    ]);
  });

  it('saves and reloads a feature-owned preference from its namespaced slot', () => {
    type TestPreference = { view: 'table'; sort: 'name'; advisor: string | null };
    const isTestPreference = (value: unknown): value is TestPreference => {
      if (!value || typeof value !== 'object') return false;
      const preference = value as Partial<TestPreference>;
      return preference.view === 'table'
        && preference.sort === 'name'
        && (typeof preference.advisor === 'string' || preference.advisor === null);
    };
    const firstSession = createDirectoryPreferenceStore('test-contact-table', isTestPreference);
    firstSession.save({ view: 'table', sort: 'name', advisor: 'Avery' });

    const reloadedSession = createDirectoryPreferenceStore('test-contact-table', isTestPreference);
    const otherFeature = createDirectoryPreferenceStore('test-list-sort', isTestPreference);

    expect(reloadedSession.load()).toEqual({ view: 'table', sort: 'name', advisor: 'Avery' });
    expect(otherFeature.load()).toBeNull();
  });
});
