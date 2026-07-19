/**
 * P1 fix (2026-07): a failed disk scan must never render identically to a
 * genuinely empty client (docs/evidence/meetings-verify-20260704/RUN-LOG.md,
 * finding #6 — "No meetings yet" is exactly what an advisor saw after a
 * transient scan failure, indistinguishable from real emptiness).
 */
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { ClientMeetingsTab } from '@/features/meetings/ClientMeetingsTab';
import {
  readActiveMeetingClientBoundary,
  type SealedMeetingClientBoundary,
} from '@/features/meetings';
import { useMatterStore } from '@/platform/matter/matterStore';
import type { Matter } from '@/platform/types/matter';

const meetingBoundaryMint = vi.hoisted(() => ({
  selection: null as null | { householdRef: string; matterId: string },
}));

vi.mock('@/platform/client-context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/platform/client-context')>();
  return {
    ...actual,
    readSelectionOperationDecision: (
      request: Parameters<typeof actual.readSelectionOperationDecision>[0]
    ) => {
      const selection = meetingBoundaryMint.selection;
      return selection
        ? {
            kind: 'matter' as const,
            sourceKind: 'matter' as const,
            matter: { id: selection.matterId } as Matter,
            client: {
              provider: 'wealthbox' as const,
              householdId: selection.householdRef,
              displayName: selection.householdRef,
            },
          }
        : actual.readSelectionOperationDecision(request);
    },
  };
});

function mintedBoundary(
  householdRef: string,
  matterId: string
): SealedMeetingClientBoundary {
  meetingBoundaryMint.selection = { householdRef, matterId };
  try {
    const boundary = readActiveMeetingClientBoundary();
    if (!boundary) throw new Error('expected live-authority meeting boundary');
    return boundary;
  } finally {
    meetingBoundaryMint.selection = null;
  }
}

const clientBoundary = mintedBoundary('household-acme', 'm1');

beforeEach(() => {
  useMatterStore.setState({
    matters: [{
      id: 'm1',
      name: 'Acme',
      client: 'Acme',
      folderPaths: ['C:/WS/Clients/Acme'],
      crmHouseholdKeys: ['household-acme'],
      createdAt: '2026-07-04T00:00:00.000Z',
    }],
  });
});

afterEach(() => {
  useMatterStore.setState({ matters: [] });
});

function makeWorkspace(overrides: {
  list: (path: string) => Promise<{ name: string; path: string; type: 'file' | 'folder' }[]>;
  exists?: (path: string) => Promise<boolean>;
}) {
  return {
    list: overrides.list,
    exists: overrides.exists ?? (async () => true),
    readFile: async () => { throw new Error('not used'); },
    writeFile: async () => {},
  };
}

describe('ClientMeetingsTab — scan failure vs genuine empty', () => {
  it('owns a vertical scroll region so a long meetings list cannot get clipped by the hub', async () => {
    const ws = makeWorkspace({
      exists: async () => false,
      list: async () => [],
    });

    render(
      <ClientMeetingsTab
        clientBoundary={clientBoundary}
        getActiveClientBoundary={() => clientBoundary}
        matterFolder="C:/WS/Clients/Acme"
        workspaceService={ws}
      />,
    );

    const tab = await screen.findByTestId('client-meetings-tab');
    expect(tab.style.flex).toBe('1 1 0%');
    expect(tab.style.minHeight).toBe('0');
    expect(tab.style.overflowY).toBe('auto');
  });

  it('shows the real "No meetings yet" empty state when the Meetings folder genuinely has none', async () => {
    const ws = makeWorkspace({
      exists: async () => false,
      list: async () => { throw new Error('should not be called — exists() already said no'); },
    });

    render(
      <ClientMeetingsTab
        clientBoundary={clientBoundary}
        getActiveClientBoundary={() => clientBoundary}
        matterFolder="C:/WS/Clients/Acme"
        workspaceService={ws}
      />,
    );

    await waitFor(() => expect(screen.getByTestId('client-meetings-empty')).toBeTruthy());
    expect(screen.queryByTestId('client-meetings-scan-error')).toBeNull();
    expect(screen.getByTestId('client-meetings-empty-record')).toHaveTextContent('Record a meeting');
  });

  it('shows a distinct scan-error state (with a retry action) instead of "No meetings yet" when the scan keeps failing', async () => {
    const ws = makeWorkspace({
      exists: async () => true,
      list: async () => { throw new Error('permanently broken backend'); },
    });

    render(
      <ClientMeetingsTab
        clientBoundary={clientBoundary}
        getActiveClientBoundary={() => clientBoundary}
        matterFolder="C:/WS/Clients/Acme"
        workspaceService={ws}
      />,
    );

    await waitFor(() => expect(screen.getByTestId('client-meetings-scan-error')).toBeTruthy());
    expect(screen.queryByTestId('client-meetings-empty')).toBeNull();
    expect(screen.getByTestId('client-meetings-retry-button')).toBeTruthy();
  });

  it('retry button re-runs the scan and recovers once the backend is healthy again', async () => {
    let healthy = false;
    const list = vi.fn(async (path: string) => {
      if (!healthy) throw new Error('still broken');
      return path.endsWith('/Meetings')
        ? [{ name: '2026-07-04-a', path: 'C:/WS/Clients/Acme/Meetings/2026-07-04-a', type: 'folder' as const }]
        : [];
    });
    const ws = makeWorkspace({ exists: async () => true, list });

    render(
      <ClientMeetingsTab
        clientBoundary={clientBoundary}
        getActiveClientBoundary={() => clientBoundary}
        matterFolder="C:/WS/Clients/Acme"
        workspaceService={ws}
      />,
    );

    await waitFor(() => expect(screen.getByTestId('client-meetings-scan-error')).toBeTruthy());

    healthy = true;
    screen.getByTestId('client-meetings-retry-button').click();

    await waitFor(() => expect(screen.queryAllByTestId('meeting-row')).toHaveLength(1));
    expect(screen.queryByTestId('client-meetings-scan-error')).toBeNull();
  });
});
