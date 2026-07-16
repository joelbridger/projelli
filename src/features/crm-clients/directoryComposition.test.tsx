import '@/i18n';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import {
  DirectorySurface,
  createDirectoryComposition,
  createDirectoryPreferenceStore,
  type DirectoryQueryDescriptor,
  type DirectoryViewDescriptor,
} from '@/features/crm-clients';
import type { HouseholdDirectoryEntry } from '@/features/crm-clients';
import { useMatterStore } from '@/platform/matter/matterStore';
import { useClientMapStore } from '@/platform/clientMap/clientMapStore';
import type { Matter } from '@/platform/types/matter';

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

  it('gives query callbacks copies so mutation attempts cannot rewrite stored records', () => {
    const mutableRecords = households.map((household) => ({ ...household }));
    const before = structuredClone(mutableRecords);
    const mutationAttempt: DirectoryQueryDescriptor<'test-mutation-attempt'> = {
      id: 'test-mutation-attempt',
      order: 10,
      isActive: () => true,
      filter: (result) => {
        if (result.kind === 'household') {
          // @ts-expect-error public directory projections are deeply read-only.
          result.record.name = 'Rewritten by feature';
        }
        return true;
      },
    };
    const composition = createDirectoryComposition({ queries: [mutationAttempt] });

    render(<DirectorySurface people={[]} households={mutableRecords} composition={composition} />);

    expect(mutableRecords).toEqual(before);
    expect(screen.getByTestId('crm-directory-household-h-c')).toHaveTextContent('Chen household');
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
