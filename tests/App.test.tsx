import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const seedControl = vi.hoisted(() => ({
  crmReady: false,
  creates: 0,
  transitions: 0,
  meeting: undefined as
    | {
        id: string;
        state: 'draft' | 'scheduled' | 'in-progress' | 'completed';
        references: readonly string[];
      }
    | undefined,
}));

vi.mock('@/platform/utils/telemetry', () => ({
  sendEvent: vi.fn(async () => {}),
  sendEventOnce: vi.fn(async () => {}),
}));
vi.mock('@/features/onboarding/v2/LottiePlayer', () => ({
  LottiePlayer: () => <div data-testid="lottie-stub" />,
}));

const fakeWorkspaceService = {
  initialize: vi.fn(async () => ({ rootPath: '/app-sample', name: 'app-sample' })),
  getRootPath: () => '/app-sample',
  writeFile: vi.fn(async () => {}),
  writeFileBinary: vi.fn(async () => {}),
  delete: vi.fn(async () => {}),
  move: vi.fn(async () => {}),
  exists: vi.fn(async () => false),
  getFileTree: vi.fn(async () => []),
  getBackend: () => null,
};

vi.mock('@/platform/fs/WorkspaceService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/platform/fs/WorkspaceService')>();
  return { ...actual, createWorkspaceService: () => fakeWorkspaceService };
});
vi.mock('@/platform/fs/WebFSBackend', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/platform/fs/WebFSBackend')>();
  return {
    ...actual,
    createWebFSBackend: () => ({
      openDirectoryPicker: async () => ({ name: 'app-sample' }),
      setRootHandle: () => {},
    }),
  };
});
vi.mock('@/app/lifecycle/useWorkspaceLifecycle', () => ({
  useWorkspaceLifecycle: (opts: {
    setShowWorkspaceSelector: (value: boolean) => void;
    setRootPath: (value: string) => void;
    workspaceServiceRef: { current: unknown };
  }) => ({
    handleWorkspaceSelected: async (service: unknown) => {
      opts.workspaceServiceRef.current = service;
      opts.setShowWorkspaceSelector(false);
      opts.setRootPath('/app-sample');
      return true;
    },
    handleOpenRecentProject: vi.fn(async () => {}),
  }),
}));
vi.mock('@/features/meetings/foundation/contract', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/meetings/foundation/contract')>();
  return {
    ...actual,
    useMeetingPopulationService: () => ({
      captureActiveClientOperation: () => ({
        assertStable: () => undefined,
        findByReference: async (reference: string) => {
          if (!seedControl.crmReady) throw new Error('CRM is still loading.');
          return seedControl.meeting?.references.includes(reference)
            ? seedControl.meeting
            : undefined;
        },
        createForActiveClient: async () => {
          seedControl.creates += 1;
          seedControl.meeting = {
            id: 'app-hendricks-meeting',
            state: 'draft',
            references: ['meeting:sample-hendricks-annual-review'],
          };
          return seedControl.meeting;
        },
        linkLegacy: async () => {
          if (!seedControl.meeting) throw new Error('Missing canonical sample meeting.');
          return seedControl.meeting;
        },
        transition: async (
          _id: string,
          transition: {
            from: 'draft' | 'scheduled' | 'in-progress';
            to: 'scheduled' | 'in-progress' | 'completed';
          }
        ) => {
          seedControl.transitions += 1;
          if (!seedControl.meeting || seedControl.meeting.state !== transition.from)
            throw new Error('Illegal sample transition.');
          seedControl.meeting = { ...seedControl.meeting, state: transition.to };
          return seedControl.meeting;
        },
      }),
    }),
  };
});

import App from '@/App';
import {
  issueSharedClientSelection,
  readSelectionOperationDecision,
  replaceCanonicalHouseholdDirectory,
  requestClearClientSelection,
  requestSharedClientSelection,
  useClientContextStore,
} from '@/platform/client-context';
import { setDevFlagOverride } from '@/platform/flags/router';
import { useMatterStore } from '@/platform/matter/matterStore';
import { useWorkspaceStore } from '@/platform/fs/workspaceStore';

async function openSampleStart(): Promise<void> {
  render(<App />);
  await screen.findByTestId('onboarding-v2-intro', {}, { timeout: 3000 });
  fireEvent.click(screen.getByTestId('onboarding-v2-go'));
  await screen.findByTestId('choose-start-sample');
  await act(async () => {
    fireEvent.click(screen.getByTestId('choose-start-sample'));
  });
}

async function finishOnboarding(): Promise<void> {
  await screen.findByTestId('onboarding-v2-compliance');
  fireEvent.click(screen.getByTestId('onboarding-v2-continue'));
  await screen.findByTestId('onboarding-v2-ai');
  fireEvent.click(screen.getByTestId('onboarding-v2-continue'));
  await screen.findByTestId('onboarding-v2-connect');
  fireEvent.click(screen.getByTestId('onboarding-v2-continue'));
  await screen.findByTestId('onboarding-v2-firm');
  fireEvent.click(screen.getByTestId('onboarding-v2-continue'));
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  seedControl.crmReady = false;
  seedControl.creates = 0;
  seedControl.transitions = 0;
  seedControl.meeting = undefined;
  useWorkspaceStore.setState({ recentWorkspaces: [], rootPath: null });
  useMatterStore.setState({ matters: [], activeMatterId: null });
  setDevFlagOverride('selection-authority-boot-gate', false);
  replaceCanonicalHouseholdDirectory('wealthbox', null);
  requestClearClientSelection();
  setDevFlagOverride('selection-authority-boot-gate', true);
});

describe('App', () => {
  it('renders the workspace selector welcome pitch', () => {
    render(<App />);
    expect(screen.getByTestId('welcome-dialog-pitch')).toBeInTheDocument();
    expect(screen.getByTestId('welcome-dialog-pitch').textContent).toMatch(
      /Your firm folder/i,
    );
  });

  it('renders the Open Existing button', () => {
    render(<App />);
    expect(screen.getByText('Open Existing')).toBeInTheDocument();
  });

  it('renders the New Workspace button', () => {
    render(<App />);
    expect(screen.getByText('New Workspace')).toBeInTheDocument();
  });

  it('selects Hendricks in the live welcome path, visibly retries delayed CRM seeding, and does not duplicate it', async () => {
    await openSampleStart();

    await waitFor(() => {
      expect(useClientContextStore.getState()).toMatchObject({
        client: { householdId: 'sample-hendricks-household' },
        scope: { kind: 'matter' },
        followerStatus: 'converged',
      });
    });
    const selected = readSelectionOperationDecision({
      operationClass: 'client-scoped',
      allowAllMatters: false,
      requireFollowerAgreement: true,
    });
    expect(selected).toMatchObject({
      kind: 'matter',
      matter: { id: expect.any(String) },
      client: { householdId: 'sample-hendricks-household' },
      selectionGeneration: expect.any(Number),
    });

    await finishOnboarding();
    expect(await screen.findByTestId('sample-meeting-seed-error')).toHaveTextContent(
      'CRM is still loading.',
    );

    seedControl.crmReady = true;
    await act(async () => {
      fireEvent.click(screen.getByTestId('sample-meeting-seed-retry'));
    });
    await waitFor(() => {
      expect(screen.queryByTestId('sample-meeting-seed-error')).toBeNull();
    });
    expect(seedControl.creates).toBe(1);
    expect(seedControl.meeting?.references).toContain(
      'meeting:sample-hendricks-annual-review',
    );

    // A later client request must not turn this completed Hendricks sample into
    // a write for another household.
    replaceCanonicalHouseholdDirectory('wealthbox', [
      {
        provider: 'wealthbox',
        householdId: 'sample-hendricks-household',
        displayName: 'The Hendricks Household',
      },
      {
        provider: 'wealthbox',
        householdId: 'other-household',
        displayName: 'Other household',
      },
    ]);
    await requestSharedClientSelection(
      issueSharedClientSelection({
        provider: 'wealthbox',
        householdId: 'other-household',
        displayName: 'Other household',
      }),
    );
    expect(
      readSelectionOperationDecision({
        operationClass: 'client-scoped',
        allowAllMatters: false,
        requireFollowerAgreement: false,
      }),
    ).toMatchObject({ kind: 'refused', reason: 'blocked-unresolved' });
    expect(seedControl.creates).toBe(1);
  });
});
