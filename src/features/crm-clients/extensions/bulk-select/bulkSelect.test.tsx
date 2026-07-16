import '@/i18n';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { setDevFlagOverride } from '@/platform/flags/router';
import {
  directoryToolRegistry,
  getDirectoryTools,
  validateDirectoryToolDescriptors,
  type DirectoryContext,
} from '../../directoryRegistry';
import { DirectorySurface } from '../../DirectorySurface';
import {
  legacyDirectoryActions,
  legacyDirectoryTools,
} from '../../directoryRegistryCompatibility';
import {
  type BulkSelectionContract,
  useBulkSelection,
} from '@/features/crm-clients/extensions/bulk-select';

const households = [
  {
    id: 'foster',
    name: 'Foster household',
    lifecycle: 'Active',
    primaryAdvisor: 'Sarah Morgan',
    peopleCount: 2,
    serviceTier: 'Private wealth',
  },
  {
    id: 'diaz',
    name: 'Diaz household',
    lifecycle: 'Active',
    primaryAdvisor: 'Priya Shah',
    peopleCount: 3,
    serviceTier: 'Planning',
  },
] as const;

function directoryContext(
  overrides: Partial<DirectoryContext> = {}
): DirectoryContext {
  return {
    query: { value: '', setValue: vi.fn() },
    selection: { person: null, setPerson: vi.fn() },
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
    repository: {
      openHousehold: vi.fn(),
      reviewRecipient: vi.fn(),
      createHousehold: vi.fn(),
    },
    ...overrides,
  };
}

function PublicContractProbe() {
  const selection: BulkSelectionContract = useBulkSelection();
  return (
    <output data-testid="bulk-selection-public-contract">
      {selection.selectedCount}:{selection.selectedHouseholdIds.join(',')}
    </output>
  );
}

function renderRegisteredTool(context = directoryContext()) {
  const descriptor = getDirectoryTools().find(({ id }) => id === 'bulk-select');
  if (!descriptor) throw new Error('Expected the registered bulk-select tool.');
  return render(
    <>
      {descriptor.mount(context)}
      <PublicContractProbe />
    </>
  );
}

afterEach(() => {
  cleanup();
  setDevFlagOverride('crm-bulk-select', undefined);
});

describe('CRM directory bulk selection', () => {
  it('is absent while flag-off without reading directory data or subscribing to selection', () => {
    setDevFlagOverride('crm-bulk-select', false);
    const loadHouseholds = vi.fn(() => households);
    const records = {
      people: [],
      get households() {
        return loadHouseholds();
      },
    };

    renderRegisteredTool(directoryContext({ records }));

    expect(
      screen.queryByTestId('crm-directory-bulk-select')
    ).not.toBeInTheDocument();
    expect(loadHouseholds).not.toHaveBeenCalled();
  });

  it('keeps the flag-off directory toolbar layout identical to the legacy base', () => {
    setDevFlagOverride('crm-bulk-select', false);

    render(<DirectorySurface people={[]} households={households} />);

    const toolbar = screen.getByTestId('crm-directory-toolbar');
    expect(toolbar.children).toHaveLength(
      legacyDirectoryTools.length + legacyDirectoryActions.length
    );
    expect(
      Array.from(toolbar.children).every(
        (child) => child.tagName === 'SPAN' && child.childElementCount > 0
      )
    ).toBe(true);
    expect(
      Array.from(toolbar.children).map((child) =>
        child.querySelector('[data-testid]')?.getAttribute('data-testid')
      )
    ).toEqual([
      'crm-directory-view-directory',
      'crm-directory-tab-households',
      'crm-directory-search',
      'crm-directory-external',
      'crm-directory-needs-verification',
      'crm-directory-add',
    ]);
    expect(
      screen.queryByTestId('crm-directory-bulk-select')
    ).not.toBeInTheDocument();
  });

  it('adds the enabled tool to the existing directory toolbar layout', () => {
    setDevFlagOverride('crm-bulk-select', true);

    render(<DirectorySurface people={[]} households={households} />);

    expect(screen.getByTestId('crm-directory-toolbar').children).toHaveLength(
      legacyDirectoryTools.length + legacyDirectoryActions.length + 1
    );
    expect(screen.getByTestId('crm-directory-bulk-select')).toBeInTheDocument();
  });

  it('registers one valid descriptor and mounts it through the real directory registry', () => {
    setDevFlagOverride('crm-bulk-select', true);

    validateDirectoryToolDescriptors(directoryToolRegistry);
    renderRegisteredTool();

    expect(
      directoryToolRegistry.filter(({ id }) => id === 'bulk-select')
    ).toHaveLength(1);
    expect(screen.getByTestId('crm-directory-bulk-select')).toBeInTheDocument();
  });

  it('selects one visible household, selects visible/all households, and clears the public contract', () => {
    setDevFlagOverride('crm-bulk-select', true);
    renderRegisteredTool();

    fireEvent.change(screen.getByTestId('crm-directory-bulk-select-one'), {
      target: { value: 'foster' },
    });
    expect(
      screen.getByTestId('crm-directory-bulk-selected-count')
    ).toHaveTextContent('1 household selected');
    expect(
      screen.getByTestId('bulk-selection-public-contract')
    ).toHaveTextContent('1:foster');

    fireEvent.click(screen.getByTestId('crm-directory-bulk-select-visible'));
    expect(
      screen.getByTestId('bulk-selection-public-contract')
    ).toHaveTextContent('2:foster,diaz');

    fireEvent.click(screen.getByTestId('crm-directory-bulk-clear'));
    expect(
      screen.getByTestId('bulk-selection-public-contract')
    ).toHaveTextContent('0:');

    fireEvent.click(screen.getByTestId('crm-directory-bulk-select-all'));
    expect(
      screen.getByTestId('bulk-selection-public-contract')
    ).toHaveTextContent('2:foster,diaz');
  });

  it('reconciles selected ids against a changed accessible directory', async () => {
    setDevFlagOverride('crm-bulk-select', true);
    const rendered = renderRegisteredTool();

    fireEvent.click(screen.getByTestId('crm-directory-bulk-select-all'));
    expect(
      screen.getByTestId('bulk-selection-public-contract')
    ).toHaveTextContent('2:foster,diaz');

    rendered.rerender(
      <>
        {getDirectoryTools()
          .find(({ id }) => id === 'bulk-select')
          ?.mount(
            directoryContext({
              records: { people: [], households: [households[0]] },
            })
          )}
        <PublicContractProbe />
      </>
    );

    await waitFor(() => {
      expect(
        screen.getByTestId('bulk-selection-public-contract')
      ).toHaveTextContent('1:foster');
    });
  });
});
