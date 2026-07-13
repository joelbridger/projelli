import '@/i18n';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DirectorySurface } from './DirectorySurface';
import { clientMapTab } from './clientMapTab';
import { useMatterStore } from '@/platform/matter/matterStore';
import type { Matter } from '@/platform/types/matter';

const generate = vi.fn(() => Promise.resolve('updated' as const));
const checkForUpdates = vi.fn(() => Promise.resolve('unchanged' as const));

vi.mock('@/features/matters/useClientMap', () => ({
  useClientMap: () => ({
    status: 'idle',
    errorMessage: null,
    map: undefined,
    generate,
    checkForUpdates,
  }),
}));

function matter(id: string, client: string): Matter {
  return {
    id,
    name: client,
    client,
    folderPaths: [`Clients/${client}`],
    createdAt: '2026-01-01T00:00:00.000Z',
  } as Matter;
}

describe('Client Map entry points', () => {
  beforeEach(() => {
    generate.mockClear();
    checkForUpdates.mockClear();
    useMatterStore.setState({ matters: [matter('m-a', 'Alvarez'), matter('m-b', 'Bishop')] });
  });

  it('opens the restored Whole book view from Clients / Directory and opens its chosen client', () => {
    const onOpenHousehold = vi.fn();
    render(
      <DirectorySurface
        people={[]}
        households={[
          { id: 'm-a', name: 'Alvarez', lifecycle: 'Active', primaryAdvisor: 'A', serviceTier: 'Standard', peopleCount: 1 },
          { id: 'm-b', name: 'Bishop', lifecycle: 'Active', primaryAdvisor: 'A', serviceTier: 'Standard', peopleCount: 1 },
        ]}
        actions={{ onOpenHousehold }}
      />,
    );

    fireEvent.click(screen.getByTestId('crm-directory-view-book'));
    fireEvent.click(screen.getByTestId('book-row-m-a'));

    expect(screen.getByTestId('book-view')).toBeTruthy();
    expect(onOpenHousehold).toHaveBeenCalledWith('m-a');
  });

  it('offers the original Client Map build action in the live per-client Client Map tab', async () => {
    const ClientMapTab = clientMapTab.Component;
    render(
      <ClientMapTab
        household={{
          id: 'm-a', name: 'Alvarez', lifecycle: 'Active', primaryAdvisor: 'A', ownership: 'mine', serviceTier: 'Standard', syncState: 'live',
          facts: [], accounts: [], members: [], externalParties: [], notes: [], customFields: [], tags: [], contextRefs: [],
        }}
        proposals={[]}
        timelineRecords={[]}
        renderLegacySurface={() => null}
      />,
    );

    fireEvent.click(screen.getByTestId('clientmap-build-refresh'));
    await vi.waitFor(() => { expect(generate).toHaveBeenCalledOnce(); });
  });
});
