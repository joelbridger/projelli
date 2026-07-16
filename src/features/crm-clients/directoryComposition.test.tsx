import '@/i18n';
import { afterEach, describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import {
  DirectorySurface,
  createDirectoryComposition,
  createDirectoryPreferenceStore,
  type DirectoryQueryDescriptor,
  type DirectoryViewDescriptor,
} from '@/features/crm-clients';
import type { HouseholdDirectoryEntry } from '@/features/crm-clients';

const households: readonly HouseholdDirectoryEntry[] = Object.freeze([
  Object.freeze({ id: 'h-b', name: 'Bishop household', lifecycle: 'Active', primaryAdvisor: 'Avery', serviceTier: 'Standard', peopleCount: 2 }),
  Object.freeze({ id: 'h-a', name: 'Alvarez household', lifecycle: 'Active', primaryAdvisor: 'Morgan', serviceTier: 'Standard', peopleCount: 1 }),
  Object.freeze({ id: 'h-c', name: 'Chen household', lifecycle: 'Inactive', primaryAdvisor: 'Avery', serviceTier: 'Standard', peopleCount: 3 }),
]);

afterEach(() => { localStorage.clear(); });

describe('directory composition public seam', () => {
  it('keeps the legacy view and record order unchanged without a feature contribution', () => {
    render(<DirectorySurface people={[]} households={households} />);

    const surface = screen.getByTestId('crm-directory-surface');
    const rows = within(surface).getAllByTestId(/^crm-directory-household-/);
    expect(rows.map((row) => row.dataset['testid'])).toEqual([
      'crm-directory-household-h-b',
      'crm-directory-household-h-a',
      'crm-directory-household-h-c',
    ]);
    expect(screen.queryByTestId('test-feature-view')).not.toBeInTheDocument();
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

  it('composes feature filters and sort order on the result projection only', () => {
    const advisorFilter: DirectoryQueryDescriptor<'test-advisor-filter'> = {
      id: 'test-advisor-filter',
      order: 10,
      isActive: () => true,
      filter: (result) => result.kind !== 'household' || result.record.primaryAdvisor === 'Avery',
    };
    const nameSort: DirectoryQueryDescriptor<'test-name-sort'> = {
      id: 'test-name-sort',
      order: 20,
      isActive: () => true,
      compare: (left, right) => left.record.name.localeCompare(right.record.name),
    };
    const composition = createDirectoryComposition({ queries: [advisorFilter, nameSort] });

    render(<DirectorySurface people={[]} households={households} composition={composition} />);

    const rows = screen.getAllByTestId(/^crm-directory-household-/);
    expect(rows.map((row) => row.dataset['testid'])).toEqual([
      'crm-directory-household-h-b',
      'crm-directory-household-h-c',
    ]);
    expect(households.map(({ id }) => id)).toEqual(['h-b', 'h-a', 'h-c']);
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
