import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { EV_MATTER_LAUNCH } from '@/config/identity';
import { ClientsSurface } from '@/features/crm-clients';
import { CrmSearchSurface } from './CrmSearchSurface';

const { searchCrmRecords, useLiveCrmRecords } = vi.hoisted(() => ({
  searchCrmRecords: vi.fn(),
  useLiveCrmRecords: vi.fn(),
}));

const householdRecord = {
  id: 'household:exam',
  kind: 'household',
  matterId: 'matter:exam',
  name: 'Exam Test Household',
  lifecycle: 'Active',
  primaryAdvisor: 'Maya',
  ownership: 'mine',
  serviceTier: 'Standard',
  facts: [{
    id: 'fact:internal-id',
    label: 'Exam probe fact',
    value: 'Garnet lighthouse 4471',
    status: 'Current',
    asOf: '2026-07-13',
    sources: [{ id: 'source:internal-id', label: 'Advisor call' }],
  }],
  accounts: [],
  members: [],
  externalParties: [],
  notes: [],
  customFields: [],
  tags: [],
};

vi.mock('@/platform/crm/search', () => ({ searchCrmRecords }));
vi.mock('@/platform/crm/useLiveCrmRecords', () => ({
  useLiveCrmRecords,
}));

function liveRecords(records: readonly { id: string; kind: string; [key: string]: unknown }[] = [householdRecord]) {
  return {
    records,
    save: vi.fn(),
    reload: vi.fn(),
    error: null,
    workspaceRoot: '/workspace/exam',
    sharedMatterId: 'firm_home',
    freshness: { kind: 'live' },
  };
}

beforeEach(() => {
  localStorage.clear();
  useLiveCrmRecords.mockReturnValue(liveRecords());
  searchCrmRecords.mockResolvedValue([{
    entityId: householdRecord.id,
    entityKind: householdRecord.kind,
    matterId: householdRecord.matterId,
    title: householdRecord.name,
    snippet: '…"label":"Exam probe fact","value":"Garnet lighthouse 4471","sources":[{"id":"source:internal-id","label":"Advisor call"}]…',
    content: JSON.stringify(householdRecord),
  }]);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('CRM saved-record search', () => {
  it('shows a readable fact and opens the real client record instead of raw JSON', async () => {
    const launches: Array<{ matterId?: string; surface?: string }> = [];
    const onLaunch = (event: Event) => {
      launches.push((event as CustomEvent<{ matterId?: string; surface?: string }>).detail);
    };
    window.addEventListener(EV_MATTER_LAUNCH, onLaunch);

    const view = render(<CrmSearchSurface />);
    fireEvent.change(screen.getByPlaceholderText('Ask about a client, note, fact, or task'), {
      target: { value: 'Garnet lighthouse' },
    });
    fireEvent.click(screen.getByTestId('crm-search-submit'));

    const result = await screen.findByTestId(`crm-search-hit-${householdRecord.id}`);
    expect(result).toHaveTextContent('Fact: Exam probe fact');
    expect(result).toHaveTextContent('Garnet lighthouse 4471');
    expect(result).toHaveTextContent('Source: Advisor call');
    expect(result).toHaveTextContent('As of Jul 13, 2026');
    expect(result).not.toHaveTextContent('"label":"Exam probe fact"');
    expect(result).not.toHaveTextContent('source:internal-id');

    fireEvent.click(screen.getByRole('button', { name: 'Open cited client' }));
    expect(launches).toEqual([{ matterId: householdRecord.matterId, surface: 'matters' }]);
    expect(screen.queryByRole('dialog', { name: 'Cited CRM record' })).not.toBeInTheDocument();

    view.unmount();
    render(<ClientsSurface />);
    expect(await screen.findByTestId('crm-household-record')).toHaveTextContent('Exam Test Household');
    expect(screen.getByTestId('crm-household-facts')).toHaveTextContent('Exam probe fact: Garnet lighthouse 4471');
    expect(screen.getByTestId('crm-household-accounts')).toBeInTheDocument();
    expect(screen.getByTestId('crm-household-people')).toBeInTheDocument();
    expect(screen.getByTestId('crm-household-metadata-summary')).toBeInTheDocument();

    window.removeEventListener(EV_MATTER_LAUNCH, onLaunch);
  });

  it('formats a cited note in the detail panel without exposing its stored JSON', async () => {
    const noteRecord = {
      audience: 'internal', body: 'Parity note', createdAt: '2026-07-13T02:45:38.386Z',
      id: 'note:internal-id', kind: 'note', matterId: 'matter:exam',
    };
    useLiveCrmRecords.mockReturnValue(liveRecords([householdRecord, noteRecord]));
    searchCrmRecords.mockResolvedValue([{
      entityId: 'note:internal-id',
      entityKind: 'note',
      matterId: 'matter:exam',
      title: 'Parity note',
      snippet: '{"audience":"internal","body":"Parity note","createdAt":"2026-07-13T02:45:38.386Z","id":"note:internal-id"}',
      content: JSON.stringify(noteRecord),
    }]);

    render(<CrmSearchSurface />);
    fireEvent.change(screen.getByPlaceholderText('Ask about a client, note, fact, or task'), {
      target: { value: 'Parity note' },
    });
    fireEvent.click(screen.getByTestId('crm-search-submit'));

    const result = await screen.findByTestId('crm-search-hit-note:internal-id');
    expect(result).toHaveTextContent('Note');
    expect(result).toHaveTextContent('Parity note');
    expect(result).toHaveTextContent('Internal only');
    expect(result).toHaveTextContent('Saved Jul 13, 2026');
    expect(result).not.toHaveTextContent('"audience":"internal"');

    fireEvent.click(screen.getByRole('button', { name: 'Open cited note' }));
    const detail = screen.getByRole('dialog', { name: 'Cited CRM record' });
    expect(detail).toHaveTextContent('Note');
    expect(detail).toHaveTextContent('Parity note');
    expect(detail).toHaveTextContent('Internal only');
    expect(detail).toHaveTextContent('Saved Jul 13, 2026');
    expect(detail).not.toHaveTextContent('note:internal-id');
    expect(detail).not.toHaveTextContent('"createdAt"');
  });

  it('passes only visible IDs to native search and rejects a stale result after visibility changes', async () => {
    let finishSearch: ((hits: readonly object[]) => void) | null = null;
    searchCrmRecords.mockReturnValueOnce(new Promise((resolve) => { finishSearch = resolve; }));
    const view = render(<CrmSearchSurface />);
    fireEvent.change(screen.getByPlaceholderText('Ask about a client, note, fact, or task'), {
      target: { value: 'private meeting' },
    });
    fireEvent.click(screen.getByTestId('crm-search-submit'));
    expect(searchCrmRecords).toHaveBeenCalledWith(
      '/workspace/exam', 'private meeting', undefined, [householdRecord.id],
    );

    useLiveCrmRecords.mockReturnValue(liveRecords([]));
    view.rerender(<CrmSearchSurface />);
    await act(async () => {
      finishSearch?.([{
        entityId: householdRecord.id, entityKind: householdRecord.kind,
        matterId: householdRecord.matterId, title: householdRecord.name,
        snippet: 'private meeting', content: JSON.stringify(householdRecord),
      }]);
      await Promise.resolve();
    });
    expect(screen.queryByTestId(`crm-search-hit-${householdRecord.id}`)).not.toBeInTheDocument();
  });
});
