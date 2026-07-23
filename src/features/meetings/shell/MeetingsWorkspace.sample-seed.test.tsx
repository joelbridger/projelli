import '@/i18n';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';
import type { WorkspaceService } from '@/platform/fs/WorkspaceService';
import { setActiveWorkspaceService } from '@/platform/fs/activeWorkspaceService';
import { setDevFlagOverride } from '@/platform/flags/router';
import {
  issueSharedClientSelection,
  replaceCanonicalHouseholdDirectory,
  requestClearClientSelection,
  requestSharedClientSelection,
} from '@/platform/client-context';
import { useMatterStore } from '@/platform/matter/matterStore';
import { useWorkspaceStore } from '@/platform/fs/workspaceStore';
import { createMeetingArtifactStore, createMeetingPopulationService, createMeetingStore, readActiveMeetingClientBoundary } from '../foundation/contract';
import { SAMPLE_GOLDEN_PATH, ensureSampleHendricksCrmLink, seedSampleGoldenPath } from '@/features/onboarding/seedSampleGoldenPath';
import { meetingsSurface } from './appSurface';

const crm = vi.hoisted(() => ({ records: [] as LiveCrmRecord[] }));

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => true,
  invoke: (command: string, args?: Record<string, unknown>) => {
    if (command === 'crm_set_workspace') return Promise.resolve(null);
    if (command === 'crm_live_list') return Promise.resolve(structuredClone(crm.records));
    if (command === 'crm_live_upsert') {
      const record = structuredClone(args?.['record']) as LiveCrmRecord;
      crm.records = crm.records.some((item) => item.id === record.id)
        ? crm.records.map((item) => item.id === record.id ? record : item)
        : [...crm.records, record];
      return Promise.resolve(record);
    }
    return Promise.reject(new Error(`Unexpected CRM command: ${command}`));
  },
}));

const ROOT = '/sample-workspace';
const HENDRICKS = { provider: 'wealthbox' as const, householdId: SAMPLE_GOLDEN_PATH.crmHouseholdKey, displayName: 'The Hendricks Household' };
const OTHER = { provider: 'wealthbox' as const, householdId: 'other-household', displayName: 'Other household' };

class SampleWorkspace {
  readonly files = new Map<string, string>();
  getRootPath = () => ROOT;
  private key = (path: string) => path.startsWith('/') ? path : `${ROOT}/${path}`;
  writeFile = async (path: string, content: string) => { this.files.set(this.key(path), content); };
  writeFileBinary = async () => undefined;
  readFile = async (path: string) => {
    const value = this.files.get(this.key(path));
    if (value === undefined) throw new Error(`Missing ${path}`);
    return value;
  };
  exists = async (path: string) => [...this.files.keys()].some((item) => item === this.key(path) || item.startsWith(`${this.key(path).replace(/\/$/, '')}/`));
  isSymlink = async () => false;
  resolveSymlink = async (path: string) => this.key(path);
}

beforeEach(() => {
  setDevFlagOverride('selection-authority-boot-gate', false);
  replaceCanonicalHouseholdDirectory('wealthbox', null);
  requestClearClientSelection();
  useMatterStore.setState({ matters: [
    { id: 'matter-hendricks', name: HENDRICKS.displayName, client: HENDRICKS.displayName, folderPaths: [ROOT], createdAt: '2026-07-01T00:00:00.000Z' },
    { id: 'matter-other', name: OTHER.displayName, client: OTHER.displayName, folderPaths: [ROOT], crmHouseholdKeys: [OTHER.householdId], createdAt: '2026-07-01T00:00:00.000Z' },
  ], activeMatterId: null });
  setDevFlagOverride('selection-authority-boot-gate', true);
  setDevFlagOverride('meetings-shell-v1', true);
  replaceCanonicalHouseholdDirectory('wealthbox', [HENDRICKS, OTHER]);
  useWorkspaceStore.setState({ rootPath: ROOT });
  crm.records = [];
});

afterEach(() => {
  cleanup();
  setActiveWorkspaceService(null);
  setDevFlagOverride('selection-authority-boot-gate', false);
  replaceCanonicalHouseholdDirectory('wealthbox', null);
  requestClearClientSelection();
  useMatterStore.setState({ matters: [], activeMatterId: null });
  useWorkspaceStore.setState({ rootPath: null });
  setDevFlagOverride('meetings-shell-v1', undefined);
  setDevFlagOverride('selection-authority-boot-gate', undefined);
});

describe('Hendricks sample meeting in the real Meetings shell', () => {
  it('shows one Past row, opens linked detail after remount, and refuses another client', async () => {
    const workspace = new SampleWorkspace();
    setActiveWorkspaceService(workspace as unknown as WorkspaceService);
    ensureSampleHendricksCrmLink('matter-hendricks');
    await requestSharedClientSelection(issueSharedClientSelection(HENDRICKS));
    await waitFor(() => {
      expect(useMatterStore.getState().activeMatterId).toBe('matter-hendricks');
    });
    expect(readActiveMeetingClientBoundary()).toMatchObject({
      householdRef: HENDRICKS.householdId,
      matterId: 'matter-hendricks',
      selectionGeneration: expect.any(Number),
    });
    const port = {
      get records() { return structuredClone(crm.records); }, workspaceRoot: ROOT, error: null,
      getActiveClientBoundary: readActiveMeetingClientBoundary,
      save: async (record: LiveCrmRecord) => {
        crm.records = crm.records.some((item) => item.id === record.id)
          ? crm.records.map((item) => item.id === record.id ? record : item) : [...crm.records, record];
        return structuredClone(record);
      },
      reloadRecords: async () => structuredClone(crm.records),
    };
    const boundary = readActiveMeetingClientBoundary();
    if (!boundary) throw new Error('expected Hendricks selection boundary');
    const artifactStore = createMeetingArtifactStore(port);
    const artifactReader = artifactStore.readerFor(
      createMeetingStore(port),
      boundary,
      [{ kind: 'action-update-proposal', minimumSchemaVersion: 2 }]
    );
    await seedSampleGoldenPath(workspace as unknown as WorkspaceService, ROOT, 'matter-hendricks', createMeetingPopulationService(port), boundary, {
      listForMeeting: (id) => artifactReader.listForMeeting(id, ['action-update-proposal']),
      append: (artifact) => artifactStore.append(artifact),
    });
    expect(crm.records.filter((record) => record.kind === 'meeting')).toEqual([
      expect.objectContaining({ ownerRef: null, state: 'completed' }),
    ]);
    const runtime = { navigation: { setSurface: vi.fn(), pushSnapshot: vi.fn() }, workspace: { rootPath: ROOT, activeMatter: null, apiKeys: [], serviceRef: { current: workspace as unknown as WorkspaceService }, setFileTree: vi.fn(), refreshFileTree: vi.fn(), requestApiKeySetup: vi.fn() } };
    const mounted = render(meetingsSurface.render(runtime));

    fireEvent.click(await screen.findByTestId('meetings-view-past'));
    await waitFor(() => {
      expect(screen.getAllByTestId(/meetings-row-/)).toHaveLength(1);
    });
    fireEvent.click(screen.getByTestId(/meetings-open-/));
    expect(await screen.findByTestId('meetings-linked-detail')).toBeTruthy();
    expect(screen.getByText('Hendricks annual review')).toBeTruthy();

    mounted.unmount();
    render(meetingsSurface.render(runtime));
    fireEvent.click(await screen.findByTestId('meetings-view-past'));
    await waitFor(() => {
      expect(screen.getAllByTestId(/meetings-row-/)).toHaveLength(1);
    });

    await act(async () => { await requestSharedClientSelection(issueSharedClientSelection(OTHER)); });
    await waitFor(() => expect(screen.queryByTestId(/meetings-row-/)).toBeNull());
  });
});
