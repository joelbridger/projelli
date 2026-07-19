import { describe, expect, it } from 'vitest';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';
import {
  createMeetingArtifactStore,
  createMeetingStore,
  type ClientScopedLivePort,
  type CreateMeetingDraft,
  type SealedMeetingClientBoundary,
} from './foundation/contract';
import { createStructuredMeetingSummaryReader } from './structuredMeetingSummary';

function sealedBoundary(
  householdRef: string,
  matterId: string
): SealedMeetingClientBoundary {
  return { householdRef, matterId } as SealedMeetingClientBoundary;
}

function draft(
  householdRef: string,
  ownerRef: string
): CreateMeetingDraft {
  return {
    workspaceId: 'workspace-1',
    householdRef,
    matterId: 'shared-matter',
    typeId: 'review',
    ownerRef,
    scheduledStartUtc: '2026-07-20T09:00:00.000Z',
    scheduledEndUtc: '2026-07-20T10:00:00.000Z',
    timezone: 'America/Chicago',
  };
}

function harness() {
  let records: LiveCrmRecord[] = [];
  let active = sealedBoundary('household-a', 'shared-matter');
  const port: ClientScopedLivePort = {
    get records() {
      return records;
    },
    workspaceRoot: '/workspace',
    error: null,
    getActiveClientBoundary: () => active,
    save: async (record) => {
      records = records.some((item) => item.id === record.id)
        ? records.map((item) => (item.id === record.id ? record : item))
        : [...records, record];
      return record;
    },
    reloadRecords: () => Promise.resolve(records),
  };
  return {
    port,
    setActive(next: SealedMeetingClientBoundary) {
      active = next;
    },
  };
}

describe('createStructuredMeetingSummaryReader', () => {
  it('selects the newest real summary for the exact meeting and sealed pair', async () => {
    const live = harness();
    const meetings = createMeetingStore(live.port);
    const artifacts = createMeetingArtifactStore(live.port);
    const boundaryA = sealedBoundary('household-a', 'shared-matter');
    const boundaryB = sealedBoundary('household-b', 'shared-matter');

    const meetingA = await meetings.createDraft(draft('household-a', 'owner-a'));
    await artifacts.append({
      meetingId: meetingA.id,
      kind: 'summary',
      schemaVersion: 1,
      producedAt: '2026-07-20T10:01:00.000Z',
      sourceRefs: ['transcript-a'],
      provenance: 'local-processing',
      payload: { summary: 'Older A recap', decisions: ['Older decision'] },
    });
    const newestA = await artifacts.append({
      meetingId: meetingA.id,
      kind: 'summary',
      schemaVersion: 1,
      producedAt: '2026-07-20T10:02:00.000Z',
      sourceRefs: ['transcript-a'],
      provenance: 'local-processing',
      payload: {
        summary: 'Current A recap',
        decisions: ['Fund the Roth conversion'],
        personalNotes: ['The move went well'],
      },
    });

    live.setActive(boundaryB);
    const meetingB = await meetings.createDraft(draft('household-b', 'owner-b'));
    await artifacts.append({
      meetingId: meetingB.id,
      kind: 'summary',
      schemaVersion: 1,
      producedAt: '2026-07-20T10:03:00.000Z',
      sourceRefs: ['transcript-b'],
      provenance: 'local-processing',
      payload: { summary: 'Private B recap' },
    });

    live.setActive(boundaryA);
    const reader = createStructuredMeetingSummaryReader(
      meetings,
      artifacts,
      boundaryA
    );

    await expect(reader.read(meetingA)).resolves.toEqual({
      kind: 'ready',
      summary: {
        artifactId: newestA.id,
        meetingId: meetingA.id,
        householdRef: 'household-a',
        matterId: 'shared-matter',
        producedAt: '2026-07-20T10:02:00.000Z',
        reviewState: 'needs-review',
        summary: 'Current A recap',
        decisions: ['Fund the Roth conversion'],
        personalNotes: ['The move went well'],
      },
    });
    await expect(reader.read(meetingB)).resolves.toEqual({ kind: 'refused' });
  });

  it('does not fall back to an older artifact when the newest summary is malformed', async () => {
    const live = harness();
    const meetings = createMeetingStore(live.port);
    const artifacts = createMeetingArtifactStore(live.port);
    const boundary = sealedBoundary('household-a', 'shared-matter');
    const meeting = await meetings.createDraft(draft('household-a', 'owner-a'));

    await artifacts.append({
      meetingId: meeting.id,
      kind: 'summary',
      schemaVersion: 1,
      producedAt: '2026-07-20T10:01:00.000Z',
      sourceRefs: [],
      provenance: 'local-processing',
      payload: { summary: 'Stale but valid' },
    });
    await artifacts.append({
      meetingId: meeting.id,
      kind: 'summary',
      schemaVersion: 1,
      producedAt: '2026-07-20T10:02:00.000Z',
      sourceRefs: [],
      provenance: 'local-processing',
      payload: { summary: 42 },
    });

    const reader = createStructuredMeetingSummaryReader(
      meetings,
      artifacts,
      boundary
    );
    await expect(reader.read(meeting)).resolves.toEqual({ kind: 'error' });
  });
});
