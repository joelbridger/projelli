import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import {
  DirectorySurface,
  defaultDirectoryComposition,
  type DirectoryContext,
} from '@/features/crm-clients';
import { setDevFlagOverride } from '@/platform/flags/router';
import {
  crmDuplicatesDirectoryTool,
  findLikelyDuplicateHouseholds,
} from '@/features/crm-clients/extensions/duplicates';

const households = [
  {
    id: 'foster-1',
    name: 'Foster Household',
    lifecycle: 'Active',
    primaryAdvisor: 'Avery',
    serviceTier: 'Private wealth',
    peopleCount: 2,
  },
  {
    id: 'foster-2',
    name: ' foster-household ',
    lifecycle: 'Active',
    primaryAdvisor: 'Morgan',
    serviceTier: 'Planning',
    peopleCount: 3,
  },
  {
    id: 'diaz',
    name: 'Diaz household',
    lifecycle: 'Active',
    primaryAdvisor: 'Avery',
    serviceTier: 'Planning',
    peopleCount: 2,
  },
] as const;

function directoryContext(
  overrides: Partial<DirectoryContext> = {}
): DirectoryContext {
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
    records: { people: [], households },
    repository: { openContact: vi.fn(), resolveContact: vi.fn() },
    legacyRepository: {
      openHousehold: vi.fn(),
      reviewRecipient: vi.fn(),
      createHousehold: vi.fn(),
    },
    composition: defaultDirectoryComposition,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  setDevFlagOverride('crm-duplicates', undefined);
});

describe('CRM duplicate review', () => {
  it('finds deterministic pairs with a visible, narrow explanation', () => {
    const matches = findLikelyDuplicateHouseholds(households);

    expect(matches).toEqual([
      {
        normalizedName: 'fosterhousehold',
        explanation: 'same-normalized-household-name',
        records: [
          { id: 'foster-1', name: 'Foster Household' },
          { id: 'foster-2', name: ' foster-household ' },
        ],
      },
    ]);
  });

  it('stays absent while dark without reading the supplied directory records or adding a toolbar gap', () => {
    setDevFlagOverride('crm-duplicates', false);
    const readHouseholds = vi.fn(() => households);
    const records = {
      people: [],
      get households() {
        return readHouseholds();
      },
    };

    render(crmDuplicatesDirectoryTool.mount(directoryContext({ records })));
    expect(
      screen.queryByTestId('crm-directory-duplicates')
    ).not.toBeInTheDocument();
    expect(readHouseholds).not.toHaveBeenCalled();

    render(<DirectorySurface people={[]} households={households} />);
    expect(
      screen.queryByTestId('crm-directory-duplicates')
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('crm-directory-toolbar').children).toHaveLength(
      6
    );
  });

  it('registers the real tool and only hands records to the existing record-opening boundary', () => {
    setDevFlagOverride('crm-duplicates', true);
    const openHousehold = vi.fn();
    const openContact = vi.fn();
    const resolveContact = vi.fn();
    const context = directoryContext({
      repository: { openContact, resolveContact },
      legacyRepository: {
        openHousehold,
        reviewRecipient: vi.fn(),
        createHousehold: vi.fn(),
      },
    });

    render(crmDuplicatesDirectoryTool.mount(context));
    fireEvent.click(screen.getByTestId('crm-directory-duplicates-toggle'));
    expect(screen.getByTestId('crm-duplicates-count')).toHaveTextContent(
      '1 possible duplicate pair'
    );
    expect(
      screen.getByText(
        'These names match after ignoring capitalization, spacing, and punctuation.'
      )
    ).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('crm-duplicates-open-foster-2'));

    expect(openHousehold).toHaveBeenCalledWith('foster-2');
    expect(openContact).not.toHaveBeenCalled();
    expect(resolveContact).not.toHaveBeenCalled();
  });
});
