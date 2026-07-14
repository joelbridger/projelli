import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { HouseholdDocumentsTab } from './HouseholdDocumentsTab';
import { useMatterStore } from '@/platform/matter/matterStore';
import { useWorkspaceStore } from '@/platform/fs/workspaceStore';
import type { HouseholdRecord } from '@/features/crm-clients/adapters';

const liveCrm = vi.hoisted(() => ({
  records: [] as Array<Record<string, unknown>>,
  save: vi.fn(),
  reload: vi.fn(),
}));

vi.mock('@/platform/crm/useLiveCrmRecords', () => ({
  useLiveCrmRecords: () => ({
    records: liveCrm.records,
    save: liveCrm.save,
    reload: liveCrm.reload,
    error: null,
    workspaceRoot: '/practice',
    freshness: { kind: 'fresh' },
    sharedMatterId: null,
  }),
}));

const household: HouseholdRecord = {
  id: 'household-diaz',
  name: 'Diaz, Michelle',
  lifecycle: 'Active',
  primaryAdvisor: 'Maya',
  ownership: 'mine',
  serviceTier: 'Standard',
  syncState: 'live',
  facts: [],
  accounts: [],
  members: [],
  externalParties: [],
  notes: [],
};

describe('HouseholdDocumentsTab client boundary', () => {
  beforeEach(() => {
    liveCrm.records = [{
      id: household.id,
      kind: 'household',
      matterId: 'matter-diaz',
      name: household.name,
    }];
    liveCrm.save.mockReset();
    liveCrm.reload.mockReset();
    useMatterStore.setState({
      matters: [
        {
          id: 'matter-diaz',
          name: 'Diaz, Michelle',
          client: 'Diaz, Michelle',
          folderPaths: ['/practice/Clients/Diaz, Michelle'],
          createdAt: '2026-07-13T00:00:00.000Z',
        },
        {
          id: 'matter-caldwell',
          name: 'Caldwell, Jennifer',
          client: 'Caldwell, Jennifer',
          folderPaths: ['/practice/Clients/Caldwell, Jennifer'],
          createdAt: '2026-07-13T00:00:00.000Z',
        },
      ],
      activeMatterId: 'matter-diaz',
    });
    useWorkspaceStore.setState({
      rootPath: '/practice',
      fileTree: [
        {
          id: 'clients',
          name: 'Clients',
          path: 'Clients',
          type: 'folder',
          children: [
            {
              id: 'diaz',
              name: 'Diaz, Michelle',
              path: 'Clients/Diaz, Michelle',
              type: 'folder',
              children: [
                { id: 'diaz-plan', name: 'Diaz plan.pdf', path: 'Clients/Diaz, Michelle/Diaz plan.pdf', type: 'file' },
              ],
            },
            {
              id: 'caldwell',
              name: 'Caldwell, Jennifer',
              path: 'Clients/Caldwell, Jennifer',
              type: 'folder',
              children: [
                { id: 'caldwell-plan', name: 'Caldwell plan.pdf', path: 'Clients/Caldwell, Jennifer/Caldwell plan.pdf', type: 'file' },
              ],
            },
          ],
        },
        { id: 'firm-policy', name: 'Code of Ethics.pdf', path: 'Firm/Code of Ethics.pdf', type: 'file' },
      ],
    });
  });

  afterEach(() => {
    cleanup();
    useWorkspaceStore.setState({ rootPath: null, fileTree: [] });
    useMatterStore.setState({ matters: [], activeMatterId: null });
  });

  it('offers only plausible documents owned by the open household', () => {
    render(
      <HouseholdDocumentsTab
        household={household}
        proposals={[]}
        timelineRecords={[]}
        renderLegacySurface={() => null}
      />,
    );

    const picker = screen.getByTestId('crm-document-file');
    const options = within(picker).getAllByRole('option').map((option) => option.textContent);

    expect(options).toEqual(['Choose a document', 'Diaz plan.pdf']);
    expect(screen.queryByText('Caldwell plan.pdf')).not.toBeInTheDocument();
    expect(screen.queryByText('Code of Ethics.pdf')).not.toBeInTheDocument();
    expect(screen.getByTestId('crm-document-card-Clients/Diaz, Michelle/Diaz plan.pdf'))
      .toBeInTheDocument();
  });

  it('fails closed when the household does not map to a known client boundary', () => {
    liveCrm.records = [{
      id: household.id,
      kind: 'household',
      matterId: 'missing-matter',
      name: household.name,
    }];

    render(
      <HouseholdDocumentsTab
        household={household}
        proposals={[]}
        timelineRecords={[]}
        renderLegacySurface={() => null}
      />,
    );

    expect(within(screen.getByTestId('crm-document-file')).getAllByRole('option'))
      .toHaveLength(1);
    expect(screen.getByTestId('crm-documents-no-files')).toBeInTheDocument();
  });

  it('saves the real client boundary on a new document link', async () => {
    render(
      <HouseholdDocumentsTab
        household={household}
        proposals={[]}
        timelineRecords={[]}
        renderLegacySurface={() => null}
      />,
    );

    fireEvent.change(screen.getByTestId('crm-document-file'), {
      target: { value: 'Clients/Diaz, Michelle/Diaz plan.pdf' },
    });
    fireEvent.click(screen.getByTestId('crm-document-attach'));

    await waitFor(() => {
      expect(liveCrm.save).toHaveBeenCalledWith(expect.objectContaining({
        contextRefs: [expect.objectContaining({
          id: 'Clients/Diaz, Michelle/Diaz plan.pdf',
          matterId: 'matter-diaz',
        })],
      }));
    });
  });

  it('creates from the client tab through the real Documents menu and keeps the client scope', async () => {
    const onCreateClientDocument = vi.fn();
    render(
      <HouseholdDocumentsTab
        household={household}
        proposals={[]}
        timelineRecords={[]}
        actions={{ onCreateClientDocument }}
        renderLegacySurface={() => null}
      />,
    );

    const trigger = screen.getByTestId('documents-files-create-menu');
    fireEvent.pointerDown(trigger, new MouseEvent('pointerdown', { bubbles: true }));
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByTestId('documents-create-document'));

    expect(onCreateClientDocument).toHaveBeenCalledTimes(1);
    expect(onCreateClientDocument).toHaveBeenCalledWith('matter-diaz');
  });
});
