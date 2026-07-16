import '@/i18n';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import {
  DirectorySurface,
  createDirectoryComposition,
  createDirectoryPreferenceStore,
  type DirectoryQueryDescriptor,
  type DirectoryToolDescriptor,
  type DirectoryViewDescriptor,
} from '@/features/crm-clients';
import type { HouseholdDirectoryEntry } from '@/features/crm-clients';
import { useMatterStore } from '@/platform/matter/matterStore';
import { useClientMapStore } from '@/platform/clientMap/clientMapStore';
import type { Matter } from '@/platform/types/matter';

declare module './directoryRegistry' {
  interface DirectoryToolIdMap {
    'test-reactive-sort-tool': true;
  }
}

const REACTIVE_SORT_TOOL_LABEL = 'Sort by name';

const households: readonly HouseholdDirectoryEntry[] = Object.freeze([
  Object.freeze({ id: 'h-c', name: 'Chen household', lifecycle: 'Inactive', primaryAdvisor: 'Avery', serviceTier: 'Standard', peopleCount: 3 }),
  Object.freeze({ id: 'h-a', name: 'Alvarez household', lifecycle: 'Active', primaryAdvisor: 'Morgan', serviceTier: 'Standard', peopleCount: 1 }),
  Object.freeze({ id: 'h-b', name: 'Bishop household', lifecycle: 'Active', primaryAdvisor: 'Avery', serviceTier: 'Standard', peopleCount: 2 }),
]);

const BASE_ERA_SURFACE_CHILDREN = ['header', 'div#crm-directory-toolbar', 'span', 'span', 'span'];
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
  [],
  ['book-view', 'book-row-m-a', 'book-row-m-b'],
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
  useMatterStore.setState({ matters: [] });
  useClientMapStore.setState({ maps: {}, clientQuestions: {} });
});

describe('directory composition public seam', () => {
  it('matches the fixed base-era directory and Whole book mount shapes without a contribution', () => {
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
      surfaceChildren: BASE_ERA_SURFACE_CHILDREN,
      toolMounts: BASE_ERA_BOOK_TOOL_MOUNTS,
      viewAndRailMounts: BASE_ERA_BOOK_VIEW_MOUNTS,
    });
  });

  it('selects one active feature view and replaces the legacy cards', () => {
    const featureView: DirectoryViewDescriptor<'test-feature-view'> = {
      id: 'test-feature-view',
      order: 100,
      replaces: ['directory'],
      isActive: () => true,
      mount: (context) => <div data-testid="test-feature-view">{context.records.households.length} records</div>,
    };
    const composition = createDirectoryComposition({ views: [featureView] });

    render(<DirectorySurface people={[]} households={households} composition={composition} />);

    expect(screen.getByTestId('test-feature-view')).toHaveTextContent('3 records');
    expect(screen.queryByTestId('crm-directory-household-h-b')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('test-feature-view')).toHaveLength(1);
  });

  it('keeps the legacy view when a registered feature view is inactive', () => {
    const inactiveView: DirectoryViewDescriptor<'test-inactive-view'> = {
      id: 'test-inactive-view',
      order: 100,
      replaces: ['directory'],
      isActive: () => false,
      mount: () => <div data-testid="test-inactive-view" />,
    };
    const composition = createDirectoryComposition({ views: [inactiveView] });

    render(<DirectorySurface people={[]} households={households} composition={composition} />);

    expect(screen.queryByTestId('test-inactive-view')).not.toBeInTheDocument();
    expect(screen.getByTestId('crm-directory-household-h-b')).toBeInTheDocument();
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

  it('re-projects through the public seam when a mounted feature tool changes its state', () => {
    const sortTool: DirectoryToolDescriptor = {
      id: 'test-reactive-sort-tool',
      order: 100,
      mount: (context) => <button data-testid="test-reactive-sort" onClick={() => {
        context.featureState.set('test-reactive-sort', 'name-ascending');
      }}>{REACTIVE_SORT_TOOL_LABEL}</button>,
    };
    const nameSort: DirectoryQueryDescriptor<'test-reactive-sort'> = {
      id: 'test-reactive-sort',
      order: 10,
      isActive: (context) => context.featureState.get('test-reactive-sort') === 'name-ascending',
      compare: (left, right) => left.record.name.localeCompare(right.record.name),
    };
    const composition = createDirectoryComposition({
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

  it('keeps feature state namespaces isolated', () => {
    const sortTool: DirectoryToolDescriptor = {
      id: 'test-reactive-sort-tool',
      order: 100,
      mount: (context) => <button data-testid="test-reactive-sort" onClick={() => {
        context.featureState.set('test-reactive-sort', 'name-ascending');
      }}>{REACTIVE_SORT_TOOL_LABEL}</button>,
    };
    type QueryCompare = NonNullable<DirectoryQueryDescriptor['compare']>;
    const ownNamespaceSort = vi.fn((
      left: Parameters<QueryCompare>[0],
      right: Parameters<QueryCompare>[1],
    ) => left.record.name.localeCompare(right.record.name));
    const otherNamespaceSort = vi.fn(() => 0);
    const composition = createDirectoryComposition({
      tools: [sortTool],
      queries: [
        {
          id: 'test-reactive-sort',
          order: 10,
          isActive: (context) => context.featureState.get('test-reactive-sort') === 'name-ascending',
          compare: ownNamespaceSort,
        },
        {
          id: 'test-other-feature',
          order: 20,
          isActive: (context) => context.featureState.get('test-other-feature') === 'name-ascending',
          compare: otherNamespaceSort,
        },
      ],
    });

    render(<DirectorySurface people={[]} households={households} composition={composition} />);
    fireEvent.click(screen.getByTestId('test-reactive-sort'));

    expect(ownNamespaceSort).toHaveBeenCalled();
    expect(otherNamespaceSort).not.toHaveBeenCalled();
  });

  it('passes timestamp fields through directory projections when they are present', () => {
    const timestamps = vi.fn();
    const timestampedHouseholds: readonly HouseholdDirectoryEntry[] = [{
      ...households[0],
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
        // @ts-expect-error callback result records are deeply read-only.
        result.record.name = 'Filter rewrote its result';
        const contextRecord = callbackContext.records.households[0];
        if (contextRecord) {
          // @ts-expect-error callback context records are deeply read-only.
          contextRecord.name = 'Filter rewrote its context';
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
        // @ts-expect-error comparator result records are deeply read-only.
        left.record.name = 'Sort rewrote its left result';
        // @ts-expect-error comparator result records are deeply read-only.
        right.record.name = 'Sort rewrote its right result';
        const contextRecord = callbackContext.records.households[1];
        if (contextRecord) {
          // @ts-expect-error comparator context records are deeply read-only.
          contextRecord.name = 'Sort rewrote its context';
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
