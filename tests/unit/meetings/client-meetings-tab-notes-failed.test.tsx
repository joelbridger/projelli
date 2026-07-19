/**
 * QA-31 — a meeting whose notes-generation step failed/timed out must read as
 * "couldn't be written" in the list, not the same "notes pending" copy used
 * for a meeting that's still legitimately queued behind transcription.
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

const META_OK = {
  matterId: 'm1',
  startedAt: '2026-07-04T10:00:00Z',
  consent: { mode: 'one-party', confirmedBy: 'user', confirmedAt: '2026-07-04T10:00:00Z' },
};

function makeWorkspace(meta: Record<string, unknown>) {
  return {
    exists: async () => true,
    list: async (path: string) =>
      path.endsWith('/Meetings')
        ? [{ name: 'a', path: 'C:/WS/Clients/Acme/Meetings/a', type: 'folder' as const }]
        : [],
    readFile: async (path: string) => {
      if (path.endsWith('meeting.json')) return JSON.stringify(meta);
      throw new Error('not present');
    },
    writeFile: async () => {},
  };
}

describe('ClientMeetingsTab — notes-failed row copy (QA-31)', () => {
  it('shows "notes pending" for a meeting still queued behind transcription (no notesError)', async () => {
    render(
      <ClientMeetingsTab
        clientBoundary={clientBoundary}
        getActiveClientBoundary={() => clientBoundary}
        matterFolder="C:/WS/Clients/Acme"
        workspaceService={makeWorkspace(META_OK)}
      />,
    );
    await waitFor(() => expect(screen.getByTestId('meeting-row')).toBeTruthy());
    expect(screen.getByTestId('meeting-row').textContent).toMatch(/notes pending/i);
  });

  it('shows the honest "couldn\'t be written" copy for a meeting whose notesError is set', async () => {
    render(
      <ClientMeetingsTab
        clientBoundary={clientBoundary}
        getActiveClientBoundary={() => clientBoundary}
        matterFolder="C:/WS/Clients/Acme"
        workspaceService={makeWorkspace({
          ...META_OK,
          notesError: { kind: 'error', at: '2026-07-04T10:05:00Z' },
        })}
      />,
    );
    await waitFor(() => expect(screen.getByTestId('meeting-row')).toBeTruthy());
    const text = screen.getByTestId('meeting-row').textContent ?? '';
    expect(text).toMatch(/couldn.t be written/i);
    expect(text).not.toMatch(/notes pending/i);
  });
});
