import '@/i18n';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { setDevFlagOverride } from '@/platform/flags/router';
import { DirectorySurface } from '@/features/crm-clients';
import {
  directoryActionRegistry,
  validateDirectoryActionDescriptors,
} from '@/features/crm-clients/directoryRegistry';
import { useBulkSelection } from '@/features/crm-clients/extensions/bulk-select';
import { createHouseholdCsv } from './csv';

const households = [
  {
    id: 'zebra',
    name: '=Formula household',
    lifecycle: '+Active',
    primaryAdvisor: '-Jordan',
    serviceTier: '@Private',
    peopleCount: 2,
  },
  {
    id: 'alpha',
    name: 'Alpha, household',
    lifecycle: 'Active',
    primaryAdvisor: 'Taylor "T"',
    serviceTier: 'Planning',
    peopleCount: 3,
  },
] as const;

function resetSelection() {
  const selection = renderHook(() => useBulkSelection());
  act(() => {
    selection.result.current.clearSelection();
  });
  selection.unmount();
}

function renderEnabledDirectory() {
  setDevFlagOverride('crm-bulk-select', true);
  setDevFlagOverride('crm-bulk-export', true);
  return render(<DirectorySurface people={[]} households={households} />);
}

afterEach(() => {
  cleanup();
  resetSelection();
  localStorage.clear();
  setDevFlagOverride('crm-bulk-select', undefined);
  setDevFlagOverride('crm-bulk-export', undefined);
});

describe('CRM selected-household CSV export', () => {
  it('creates deterministic spreadsheet-safe CSV from selected, authorized directory households', () => {
    expect(createHouseholdCsv([households[0], households[1]], { includeHeader: true })).toBe(
      '"Household ID","Household name","Lifecycle","Primary advisor","Service tier","People count"\r\n"alpha","Alpha, household","Active","Taylor ""T""","Planning","3"\r\n"zebra","\'=Formula household","\'+Active","\'-Jordan","\'@Private","2"',
    );
  });

  it('mounts from the real directory registry, shows the empty state, and exports only current selected records', () => {
    renderEnabledDirectory();

    validateDirectoryActionDescriptors(directoryActionRegistry);
    expect(directoryActionRegistry.filter(({ id }) => id === 'bulk-export')).toHaveLength(1);
    expect(screen.getByTestId('crm-directory-bulk-export-empty')).toBeInTheDocument();
    expect(screen.getByTestId('crm-directory-bulk-export-generate')).toBeDisabled();

    fireEvent.click(screen.getByTestId('crm-directory-bulk-select-all'));
    fireEvent.click(screen.getByTestId('crm-directory-bulk-export-generate'));

    const output = screen.getByTestId('crm-directory-bulk-export-output');
    expect(output).toHaveTextContent('"alpha","Alpha, household","Active","Taylor ""T""","Planning","3"');
    expect(output).toHaveTextContent('"zebra","\'=Formula household","\'+Active","\'-Jordan","\'@Private","2"');
    expect(screen.getByTestId('crm-directory-bulk-export-download')).toHaveAttribute(
      'download',
      'selected-households.csv',
    );
  });

  it('authorizes selected ids against the current directory records before exporting', async () => {
    const first = renderEnabledDirectory();
    fireEvent.click(screen.getByTestId('crm-directory-bulk-select-all'));
    first.unmount();

    render(<DirectorySurface people={[]} households={[households[1]]} />);
    await waitFor(() => {
      expect(screen.getByTestId('crm-directory-bulk-selected-count')).toHaveTextContent('1 household selected');
    });
    fireEvent.click(screen.getByTestId('crm-directory-bulk-export-generate'));

    const output = screen.getByTestId('crm-directory-bulk-export-output');
    expect(output).toHaveTextContent('"alpha"');
    expect(output).not.toHaveTextContent('"zebra"');
  });

  it('saves the column-heading preference and reloads it in a fresh action mount', () => {
    const first = renderEnabledDirectory();
    fireEvent.click(screen.getByTestId('crm-directory-bulk-export-include-header'));
    expect(localStorage.getItem('lantern:crm:directory:preferences:crm-bulk-export:v1')).toBe(
      '{"version":1,"value":{"includeHeader":false}}',
    );

    first.unmount();
    renderEnabledDirectory();
    expect(screen.getByTestId('crm-directory-bulk-export-include-header')).not.toBeChecked();

    fireEvent.click(screen.getByTestId('crm-directory-bulk-select-all'));
    fireEvent.click(screen.getByTestId('crm-directory-bulk-export-generate'));
    expect(screen.getByTestId('crm-directory-bulk-export-output')).not.toHaveTextContent('Household ID');
  });

  it('does not read directory records while its action is dark', () => {
    setDevFlagOverride('crm-bulk-export', false);
    const loadHouseholds = vi.fn(() => households);
    const records = {
      people: [],
      get households() {
        return loadHouseholds();
      },
    };
    const action = directoryActionRegistry.find(({ id }) => id === 'bulk-export');
    if (!action) throw new Error('Expected bulk export action descriptor.');

    render(action.mount({
      query: { value: '', setValue: vi.fn() },
      selection: { person: null, setPerson: vi.fn() },
      view: { value: 'directory', setValue: vi.fn() },
      sort: { value: 'directory', setValue: vi.fn() },
      filters: { tab: 'households', setTab: vi.fn(), externalOnly: false, setExternalOnly: vi.fn(), needsVerification: false, setNeedsVerification: vi.fn() },
      records,
      repository: { openContact: vi.fn(), resolveContact: vi.fn() },
      legacyRepository: { openHousehold: vi.fn(), reviewRecipient: vi.fn(), createHousehold: vi.fn() },
      composition: { tools: [], views: [], queries: [] },
    }));

    expect(screen.queryByTestId('crm-directory-bulk-export')).not.toBeInTheDocument();
    expect(loadHouseholds).not.toHaveBeenCalled();
  });
});
