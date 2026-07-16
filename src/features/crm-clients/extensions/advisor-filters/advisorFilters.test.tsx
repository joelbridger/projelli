import '@/i18n';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import {
  DirectorySurface,
  createDirectoryComposition,
  defaultDirectoryComposition,
  type DirectoryFeatureContext,
} from '@/features/crm-clients';
import {
  advisorFiltersDirectoryContribution,
} from '@/features/crm-clients/extensions/advisor-filters';
import { setDevFlagOverride } from '@/platform/flags/router';

const households = [
  {
    id: 'avery-private',
    name: 'Avery private household',
    lifecycle: 'Active',
    primaryAdvisor: 'Avery',
    peopleCount: 2,
    serviceTier: 'Private wealth',
  },
  {
    id: 'morgan-standard',
    name: 'Morgan standard household',
    lifecycle: 'Inactive',
    primaryAdvisor: 'Morgan',
    peopleCount: 3,
    serviceTier: 'Standard',
  },
  {
    id: 'avery-standard',
    name: 'Avery standard household',
    lifecycle: 'Active',
    primaryAdvisor: 'Avery',
    peopleCount: 1,
    serviceTier: 'Standard',
  },
] as const;

function directoryContext(
  composition = defaultDirectoryComposition,
): DirectoryFeatureContext<{ primaryAdvisor: string | null; serviceTier: string | null; lifecycle: string | null }> {
  let state: { primaryAdvisor: string | null; serviceTier: string | null; lifecycle: string | null } | undefined;
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
    repository: {
      openHousehold: vi.fn(),
      reviewRecipient: vi.fn(),
      createHousehold: vi.fn(),
    },
    composition,
    featureState: {
      get: () => state,
      set: (value) => {
        state = value;
      },
    },
  };
}

function renderMountedTool(context = directoryContext()) {
  const tool = advisorFiltersDirectoryContribution.tools?.[0];
  if (!tool) throw new Error('advisor filter contribution must provide its tool');
  return render(<>{tool.mount(context)}</>);
}

function applyAdvisorFilter(name = 'Avery') {
  fireEvent.click(screen.getByTestId('crm-directory-advisor-filters-toggle'));
  fireEvent.change(
    screen.getByTestId('crm-directory-advisor-filter-primaryAdvisor'),
    { target: { value: name } },
  );
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  setDevFlagOverride('crm-advisor-filters', undefined);
});

describe('CRM advisor-field directory filters', () => {
  it('is entirely inert while its flag is off, without reading directory records', () => {
    setDevFlagOverride('crm-advisor-filters', false);
    const loadHouseholds = vi.fn(() => households);
    const context = directoryContext();
    Object.defineProperty(context.records, 'households', { get: () => loadHouseholds() });
    renderMountedTool(context);

    expect(advisorFiltersDirectoryContribution.tools?.[0]?.isEnabled?.()).toBe(false);
    expect(screen.queryByTestId('crm-directory-advisor-filters')).not.toBeInTheDocument();
    expect(loadHouseholds).not.toHaveBeenCalled();
  });

  it('leaves no toolbar mount or layout gap while the flag is off', () => {
    setDevFlagOverride('crm-advisor-filters', false);

    const { unmount } = render(<DirectorySurface people={[]} households={households} />);
    const legacyHtml = screen.getByTestId('crm-directory-surface').innerHTML;
    unmount();

    render(<DirectorySurface people={[]} households={households} composition={createDirectoryComposition(advisorFiltersDirectoryContribution)} />);

    expect(advisorFiltersDirectoryContribution.tools?.[0]?.isEnabled?.()).toBe(false);
    expect(screen.getByTestId('crm-directory-toolbar').children).toHaveLength(6);
    expect(screen.queryByTestId('crm-directory-advisor-filters')).not.toBeInTheDocument();
    expect(screen.getByTestId('crm-directory-surface').innerHTML).toBe(legacyHtml);
  });

  it('shows applied chips, removes one field, and resets every active field', () => {
    setDevFlagOverride('crm-advisor-filters', true);
    renderMountedTool();

    applyAdvisorFilter();
    fireEvent.change(
      screen.getByTestId('crm-directory-advisor-filter-serviceTier'),
      { target: { value: 'Private wealth' } },
    );

    expect(screen.getByTestId('crm-directory-advisor-filter-chips')).toHaveTextContent(
      'Primary advisor: Avery',
    );
    expect(screen.getByTestId('crm-directory-advisor-filter-chips')).toHaveTextContent(
      'Service tier: Private wealth',
    );

    fireEvent.click(screen.getByLabelText('Remove Primary advisor filter'));
    expect(screen.getByTestId('crm-directory-advisor-filter-chips')).not.toHaveTextContent(
      'Primary advisor: Avery',
    );

    fireEvent.click(screen.getByTestId('crm-directory-advisor-filters-reset'));
    expect(screen.queryByTestId('crm-directory-advisor-filter-chips')).not.toBeInTheDocument();
  });

  it('persists a saved filter across a real tool reload', () => {
    setDevFlagOverride('crm-advisor-filters', true);
    const composition = createDirectoryComposition(advisorFiltersDirectoryContribution);
    const firstSession = render(<DirectorySurface people={[]} households={households} composition={composition} />);
    applyAdvisorFilter();

    firstSession.unmount();
    render(<DirectorySurface people={[]} households={households} composition={composition} />);

    expect(screen.getAllByTestId(/^crm-directory-household-/).map((row) => row.dataset['testid'])).toEqual([
      'crm-directory-household-avery-private',
      'crm-directory-household-avery-standard',
    ]);
    fireEvent.click(screen.getByTestId('crm-directory-advisor-filters-toggle'));

    expect(
      screen.getByTestId('crm-directory-advisor-filter-primaryAdvisor'),
    ).toHaveValue('Avery');
  });

  it('re-projects the mounted DirectorySurface immediately when its tool changes a filter', () => {
    setDevFlagOverride('crm-advisor-filters', true);
    const composition = createDirectoryComposition(advisorFiltersDirectoryContribution);
    const sourceBeforeProjection = structuredClone(households);
    render(<DirectorySurface people={[]} households={households} composition={composition} />);

    expect(screen.getAllByTestId(/^crm-directory-household-/)).toHaveLength(3);

    applyAdvisorFilter();
    fireEvent.change(
      screen.getByTestId('crm-directory-advisor-filter-lifecycle'),
      { target: { value: 'Active' } },
    );

    expect(screen.getAllByTestId(/^crm-directory-household-/).map((row) => row.dataset['testid'])).toEqual([
      'crm-directory-household-avery-private',
      'crm-directory-household-avery-standard',
    ]);
    expect(households).toEqual(sourceBeforeProjection);
  });

  it('announces an accessible empty state when the saved filters have no matches', () => {
    setDevFlagOverride('crm-advisor-filters', true);
    render(<DirectorySurface people={[]} households={households} composition={createDirectoryComposition(advisorFiltersDirectoryContribution)} />);

    applyAdvisorFilter('Morgan');
    fireEvent.change(
      screen.getByTestId('crm-directory-advisor-filter-lifecycle'),
      { target: { value: 'Active' } },
    );

    expect(screen.getByTestId('crm-directory-advisor-filters-empty')).toHaveTextContent(
      'No households match these filters.',
    );
  });
});
