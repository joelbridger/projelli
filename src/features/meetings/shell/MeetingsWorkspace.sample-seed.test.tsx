import '@/i18n';
import { act, cleanup, waitFor } from '@testing-library/react';
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
import { createMeetingPopulationService, readActiveMeetingClientBoundary } from '../foundation/contract';
import {
  SAMPLE_GOLDEN_PATH,
  ensureSampleHendricksCrmLink,
  seedSampleGoldenPath,
} from '@/features/onboarding';
import { HENDRICKS_SAMPLE_MATTER_ID } from '@/platform/samples/hendricksReviewCapability';
import { filterLiveCrmRecordsByMeetingVisibility } from '@/platform/crm/meetingVisibility';

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
    if (command === 'crm_hendricks_review_seed') {
      const context = args?.['context'] as { matterId: string; householdRef: string; meetingId: string };
      const meeting: LiveCrmRecord = {
        id: context.meetingId,
        kind: 'meeting',
        matterId: context.matterId,
        householdRef: context.householdRef,
        title: 'Hendricks annual review',
        state: 'completed',
        workspaceId: 'sample-hendricks-workspace',
        ownerRef: null,
        scheduledStartUtc: '2026-07-02T14:00:00.000Z',
        scheduledEndUtc: '2026-07-02T14:42:00.000Z',
        timezone: 'UTC',
        references: ['meeting:sample-hendricks-annual-review'],
        createdAt: '2026-07-02T14:00:00.000Z',
        updatedAt: '2026-07-02T14:42:00.000Z',
        legacyMeetingLink: { meetingDir: 'Meetings/2026-07-02-hendricks-annual-review', linkedAt: '2026-07-02T14:42:00.000Z' },
        visibility: { lineage: 'hendricks-sample-capability', meetingId: context.meetingId },
      };
      crm.records = crm.records.some((item) => item.id === meeting.id)
        ? crm.records
        : [...crm.records, meeting];
      return Promise.resolve({ manifestId: 'hendricks-review-manifest-v1', artifacts: [] });
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
    { id: HENDRICKS_SAMPLE_MATTER_ID, name: HENDRICKS.displayName, client: HENDRICKS.displayName, folderPaths: [ROOT], createdAt: '2026-07-01T00:00:00.000Z' },
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
    ensureSampleHendricksCrmLink(HENDRICKS_SAMPLE_MATTER_ID);
    await requestSharedClientSelection(issueSharedClientSelection(HENDRICKS));
    await waitFor(() => {
      expect(useMatterStore.getState().activeMatterId).toBe(HENDRICKS_SAMPLE_MATTER_ID);
    });
    expect(readActiveMeetingClientBoundary()).toMatchObject({
      householdRef: HENDRICKS.householdId,
      matterId: HENDRICKS_SAMPLE_MATTER_ID,
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
    await seedSampleGoldenPath(workspace as unknown as WorkspaceService, ROOT, HENDRICKS_SAMPLE_MATTER_ID, createMeetingPopulationService(port), boundary);
    expect(filterLiveCrmRecordsByMeetingVisibility(crm.records, null, {
      matterId: HENDRICKS_SAMPLE_MATTER_ID,
      householdRef: HENDRICKS.householdId,
    })).toHaveLength(1);
    expect(crm.records.filter((record) => record.kind === 'meeting')).toEqual([
      expect.objectContaining({ ownerRef: null, state: 'completed' }),
    ]);
    await act(async () => { await requestSharedClientSelection(issueSharedClientSelection(OTHER)); });
    expect(filterLiveCrmRecordsByMeetingVisibility(crm.records, null, {
      matterId: 'matter-other', householdRef: OTHER.householdId,
    })).toEqual([]);
  });
});
