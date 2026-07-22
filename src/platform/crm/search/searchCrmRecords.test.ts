import { beforeEach, describe, expect, it, vi } from 'vitest';

const boundary = vi.hoisted(() => ({
  invoke: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  setWorkspace: vi.fn<(...args: unknown[]) => Promise<void>>(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => true,
  invoke: (...args: unknown[]) => boundary.invoke(...args),
}));
vi.mock('@/platform/utils/wealthbox-commands', () => ({
  crmSetWorkspace: (...args: unknown[]) => boundary.setWorkspace(...args),
}));

import { searchCrmRecords } from './searchCrmRecords';
import { visibleLiveCrmRecordIds } from '@/platform/crm/meetingVisibility';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';

describe('CRM native search allow boundary', () => {
  beforeEach(() => {
    boundary.invoke.mockReset().mockResolvedValue([]);
    boundary.setWorkspace.mockReset().mockResolvedValue(undefined);
  });

  it('passes only exact, unique visible record IDs to the native command', async () => {
    await searchCrmRecords('/workspace', 'retirement', 'matter-a', [
      'note-a',
      'note-a',
      ' note-b ',
      '',
    ]);

    expect(boundary.invoke).toHaveBeenCalledWith('crm_search', {
      query: 'retirement',
      matterId: 'matter-a',
      allowedRecordIds: ['note-a'],
    });
  });

  it('does not open or query native search when no record is currently visible', async () => {
    await expect(
      searchCrmRecords('/workspace', 'retirement', undefined, [])
    ).resolves.toEqual([]);
    expect(boundary.setWorkspace).not.toHaveBeenCalled();
    expect(boundary.invoke).not.toHaveBeenCalled();
  });

  it('never sends a nested private record ID to native search for an excluded advisor', async () => {
    const records: readonly LiveCrmRecord[] = [
      {
        id: 'preferences', kind: 'meeting_foundation_preferences',
        visibilityPolicies: [{
          id: 'private-policy', mode: 'explicit-review',
          includedMemberIds: [], excludedMemberIds: ['advisor-excluded'],
        }],
      },
      {
        id: 'meeting-private', kind: 'meeting', ownerRef: 'advisor-owner',
        visibilityPolicyId: 'private-policy',
      },
      {
        id: 'task-private', kind: 'task', title: 'Secret transfer',
        meetingVisibility: {
          kind: 'task', id: 'task-private', lineage: 'derived',
          parentRef: { kind: 'meeting-note', id: 'meeting-private' },
        },
      },
      { id: 'task-public', kind: 'task', title: 'Ordinary follow-up' },
    ];
    const allowed = visibleLiveCrmRecordIds(records, 'advisor-excluded');

    await searchCrmRecords('/workspace', 'follow-up', undefined, allowed);

    expect(boundary.invoke).toHaveBeenCalledWith('crm_search', {
      query: 'follow-up',
      allowedRecordIds: ['task-public'],
    });
    expect(allowed).not.toContain('task-private');
  });
});
