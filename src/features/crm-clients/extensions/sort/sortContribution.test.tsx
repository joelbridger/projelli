import '@/i18n';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { setDevFlagOverride } from '@/platform/flags/router';
import {
  DirectorySurface,
  createDirectoryComposition,
  type DirectoryFeatureContext,
  type HouseholdDirectoryEntry,
} from '@/features/crm-clients';
import { crmListSortDirectoryContribution } from '@/features/crm-clients/extensions/sort';

const households: readonly HouseholdDirectoryEntry[] = Object.freeze([
  Object.freeze({
    id: 'cedar',
    name: 'Cedar household',
    lifecycle: 'Active',
    primaryAdvisor: 'Avery',
    peopleCount: 2,
    serviceTier: 'Standard',
    createdAt: '2026-01-20T00:00:00.000Z',
    lastActivityAt: '2026-03-20T00:00:00.000Z',
  }),
  Object.freeze({
    id: 'alpha',
    name: 'Alpha household',
    lifecycle: 'Active',
    primaryAdvisor: 'Avery',
    peopleCount: 1,
    serviceTier: 'Standard',
    createdAt: '2026-04-20T00:00:00.000Z',
  }),
  Object.freeze({
    id: 'bravo',
    name: 'Bravo household',
    lifecycle: 'Active',
    primaryAdvisor: 'Avery',
    peopleCount: 3,
    serviceTier: 'Standard',
    lastActivityAt: '2026-02-20T00:00:00.000Z',
  }),
  Object.freeze({
    id: 'delta',
    name: 'Delta household',
    lifecycle: 'Active',
    primaryAdvisor: 'Avery',
    peopleCount: 4,
    serviceTier: 'Standard',
  }),
]);

const composition = createDirectoryComposition(crmListSortDirectoryContribution);

function householdOrder(): string[] {
  return screen
    .getAllByTestId(/^crm-directory-household-/)
    .map((row) => row.dataset['testid']?.replace('crm-directory-household-', '') ?? '');
}

function featureContextWithRecordReadProbe(
  readRecords: () => void
): DirectoryFeatureContext<'recent' | 'created' | 'name-ascending'> {
  let value: 'recent' | 'created' | 'name-ascending' | undefined;
  return {
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
    get records() {
      readRecords();
      return { people: [], households: [] };
    },
    repository: {
      openHousehold: vi.fn(),
      reviewRecipient: vi.fn(),
      createHousehold: vi.fn(),
    },
    composition,
    featureState: {
      get: () => value,
      set: (next) => {
        value = next;
      },
    },
  };
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  setDevFlagOverride('crm-list-sort', undefined);
});

describe('CRM directory list sort contribution', () => {
  it('exports one stateful contribution with one tool and comparator query', () => {
    expect(crmListSortDirectoryContribution.namespace).toBe('crm-list-sort');
    expect(crmListSortDirectoryContribution.tools).toHaveLength(1);
    expect(crmListSortDirectoryContribution.queries).toHaveLength(1);
    expect(composition.tools.filter(({ id }) => id === 'crm-list-sort')).toHaveLength(1);
    expect(composition.queries).toEqual([
      expect.objectContaining({ id: 'crm-list-sort', order: 54 }),
    ]);
  });

  it('is fully inert while dark, with no data read or toolbar wrapper', () => {
    setDevFlagOverride('crm-list-sort', false);
    const readRecords = vi.fn();
    const tool = crmListSortDirectoryContribution.tools[0];
    if (!tool) throw new Error('Expected the CRM list-sort tool.');

    render(tool.mount(featureContextWithRecordReadProbe(readRecords)));

    expect(readRecords).not.toHaveBeenCalled();
    expect(screen.queryByTestId('crm-directory-sort')).not.toBeInTheDocument();

    const base = render(<DirectorySurface people={[]} households={households} />);
    const baseHtml = screen.getByTestId('crm-directory-surface').innerHTML;
    base.unmount();
    render(
      <DirectorySurface
        people={[]}
        households={households}
        composition={composition}
      />
    );

    expect(screen.getByTestId('crm-directory-surface').innerHTML).toBe(baseHtml);
    expect(screen.queryByTestId('crm-directory-sort')).not.toBeInTheDocument();
  });

  it('composes through the real directory surface and projects Recent, Created, and A–Z', async () => {
    setDevFlagOverride('crm-list-sort', true);
    render(
      <DirectorySurface
        people={[]}
        households={households}
        composition={composition}
      />
    );

    await waitFor(() => {
      expect(householdOrder()).toEqual(['cedar', 'bravo', 'alpha', 'delta']);
    });

    fireEvent.change(screen.getByTestId('crm-directory-sort-select'), {
      target: { value: 'created' },
    });
    expect(householdOrder()).toEqual(['alpha', 'cedar', 'bravo', 'delta']);

    fireEvent.change(screen.getByTestId('crm-directory-sort-select'), {
      target: { value: 'name-ascending' },
    });
    expect(householdOrder()).toEqual(['alpha', 'bravo', 'cedar', 'delta']);
    expect(households.map(({ id }) => id)).toEqual(['cedar', 'alpha', 'bravo', 'delta']);
  });

  it('saves an enabled selection and restores it in a fresh directory surface', async () => {
    setDevFlagOverride('crm-list-sort', true);
    const first = render(
      <DirectorySurface
        people={[]}
        households={households}
        composition={composition}
      />
    );

    await screen.findByTestId('crm-directory-sort-select');
    fireEvent.change(screen.getByTestId('crm-directory-sort-select'), {
      target: { value: 'created' },
    });
    expect(householdOrder()).toEqual(['alpha', 'cedar', 'bravo', 'delta']);
    first.unmount();

    render(
      <DirectorySurface
        people={[]}
        households={households}
        composition={composition}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('crm-directory-sort-select')).toHaveValue('created');
      expect(householdOrder()).toEqual(['alpha', 'cedar', 'bravo', 'delta']);
    });
  });
});
