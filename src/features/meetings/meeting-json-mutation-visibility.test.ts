import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  setMeetingsWorkspaceService,
  updateMeetingJson,
  type MeetingJsonMutationGuard,
  type MeetingMeta,
} from './meetingStore';
import { markMeetingReviewed } from './insights/review/meetingReviewArtifactStore';

const meetingDir = '/ws/Client/Meetings/one';

function workspace() {
  const meta: MeetingMeta = {
    matterId: 'matter-1',
    startedAt: '2026-07-22T10:00:00.000Z',
    typeId: 'annual-review',
    consent: {
      mode: 'one-party',
      confirmedBy: 'advisor-1',
      confirmedAt: '2026-07-22T09:59:00.000Z',
    },
  };
  return {
    readFile: vi.fn(() => Promise.resolve(JSON.stringify(meta))),
    writeFile: vi.fn(() => Promise.resolve()),
  };
}

function revokedAfterRead(): MeetingJsonMutationGuard {
  const assertCurrentAccess = vi
    .fn<() => Promise<void>>()
    .mockResolvedValueOnce()
    .mockRejectedValueOnce(new Error('Access changed'));
  return { assertCurrentAccess };
}

describe('meeting.json mutations re-authorize after their canonical read', () => {
  beforeEach(() => {
    setMeetingsWorkspaceService(null);
  });

  it('does not persist a title edit when access changes during the read', async () => {
    const ws = workspace();
    const guard = revokedAfterRead();
    setMeetingsWorkspaceService(ws as never);

    await expect(
      updateMeetingJson(
        meetingDir,
        (current) => ({ ...current, customTitle: 'Private title' }),
        guard
      )
    ).rejects.toThrow('Access changed');

    expect(guard.assertCurrentAccess).toHaveBeenCalledTimes(2);
    expect(ws.readFile).toHaveBeenCalledTimes(1);
    expect(ws.writeFile).not.toHaveBeenCalled();
  });

  it('does not persist a type edit when access changes during the read', async () => {
    const ws = workspace();
    const guard = revokedAfterRead();
    setMeetingsWorkspaceService(ws as never);

    await expect(
      updateMeetingJson(
        meetingDir,
        (current) => ({ ...current, typeId: 'discovery' }),
        guard
      )
    ).rejects.toThrow('Access changed');

    expect(guard.assertCurrentAccess).toHaveBeenCalledTimes(2);
    expect(ws.readFile).toHaveBeenCalledTimes(1);
    expect(ws.writeFile).not.toHaveBeenCalled();
  });

  it('does not mark reviewed when access changes during the read', async () => {
    const ws = workspace();
    const guard = revokedAfterRead();
    setMeetingsWorkspaceService(ws as never);

    await expect(markMeetingReviewed(meetingDir, guard)).rejects.toThrow(
      'Access changed'
    );

    expect(guard.assertCurrentAccess).toHaveBeenCalledTimes(2);
    expect(ws.readFile).toHaveBeenCalledTimes(1);
    expect(ws.writeFile).not.toHaveBeenCalled();
  });
});
