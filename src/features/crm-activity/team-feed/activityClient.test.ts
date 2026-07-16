import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  TEAM_ACTIVITY_FIRM_SCOPE,
  TEAM_ACTIVITY_STAGED_TRUST,
  type TeamActivityPost,
} from './contracts';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';
import type { PlatformFlagsMockState } from '@/testing/platform-flags';

const { mockPlatformFlags, resetPlatformFlagsOverrides, setPlatformFlagsOverrides } =
  await vi.hoisted(async () => import('@/testing/platform-flags'));

const mocks = vi.hoisted(() => ({
  emitAuditEntry: vi.fn(),
  invoke: vi.fn(),
  isEnabled: vi.fn(),
  isTauri: vi.fn(),
  crmSetWorkspace: vi.fn(),
}));
const flagsMock = vi.hoisted(() => ({
  overrides: { isEnabled: undefined } as PlatformFlagsMockState['overrides'],
}));

vi.mock('@/features/audit', () => ({ emitAuditEntry: mocks.emitAuditEntry }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke, isTauri: mocks.isTauri }));
vi.mock('@/platform/flags', async (importOriginal) =>
  mockPlatformFlags(importOriginal, flagsMock)
);
vi.mock('@/platform/utils/wealthbox-commands', () => ({ crmSetWorkspace: mocks.crmSetWorkspace }));
vi.mock('@/platform/crm/useLiveCrmRecords', () => ({
  LIVE_CRM_RECORDS_CHANGED: 'lantern:crm-live-records-changed',
}));

import { createNativeTeamActivityStore } from './activityClient';

describe('native team activity client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetPlatformFlagsOverrides(flagsMock);
    setPlatformFlagsOverrides(flagsMock, { isEnabled: mocks.isEnabled });
    mocks.isEnabled.mockReturnValue(true);
    mocks.isTauri.mockReturnValue(true);
    mocks.crmSetWorkspace.mockResolvedValue(undefined);
    mocks.emitAuditEntry.mockResolvedValue({ id: 'audit-1' });
  });

  it('uses the dedicated native command and publishes its validated result', async () => {
    const saved: TeamActivityPost = {
      id: 'team-activity-post:one',
      kind: 'teamActivityPost',
      matterId: TEAM_ACTIVITY_FIRM_SCOPE,
      body: 'Staged update',
      author: { memberId: 'member-1', displayName: 'Member', trust: TEAM_ACTIVITY_STAGED_TRUST },
      mentionedMemberIds: [],
      authority: {
        identityTrust: TEAM_ACTIVITY_STAGED_TRUST,
        roleBinding: 'deferred',
        operationBinding: 'deferred',
      },
      createdAt: '2026-07-16T10:00:00.000Z',
      updatedAt: '2026-07-16T10:00:00.000Z',
    };
    mocks.invoke.mockResolvedValue(saved);
    const publishSavedRecord = vi.fn<(record: LiveCrmRecord) => LiveCrmRecord>();
    publishSavedRecord.mockImplementation((record) => record);
    const store = createNativeTeamActivityStore({ workspaceRoot: '/workspace', publishSavedRecord });

    await expect(store.createPost({
      id: saved.id,
      matterId: TEAM_ACTIVITY_FIRM_SCOPE,
      body: saved.body,
      author: saved.author,
      mentionedMemberIds: [],
    })).resolves.toEqual(saved);

    const [command, payload] = mocks.invoke.mock.calls[0] as unknown as [
      string,
      { input: { matterId: string } },
    ];
    expect(command).toBe('crm_activity_create_post');
    expect(payload.input.matterId).toBe(TEAM_ACTIVITY_FIRM_SCOPE);
    expect(publishSavedRecord).toHaveBeenCalledWith(saved);
  });

  it('awaits the public durable audit doorway with content-safe metadata', async () => {
    const store = createNativeTeamActivityStore({ workspaceRoot: '/workspace', publishSavedRecord: (record) => record });
    await store.audit({
      action: 'user_action', activityId: 'team-activity-post:one',
      operation: 'post', mentionCount: 2, state: 'requested',
    });
    expect(mocks.emitAuditEntry).toHaveBeenCalledWith(expect.objectContaining({
      action: 'user_action',
      metadata: {
        activityId: 'team-activity-post:one', operation: 'post', mentionCount: 2, state: 'requested',
      },
    }));
    expect(JSON.stringify(mocks.emitAuditEntry.mock.calls[0]?.[0])).not.toContain('Staged update');
  });
});
