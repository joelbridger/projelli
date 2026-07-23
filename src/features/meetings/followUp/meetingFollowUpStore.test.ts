import { describe, expect, it, vi } from 'vitest';
import type {
  MeetingArtifact,
  MeetingArtifactInput,
  MeetingArtifactReader,
  MeetingArtifactStore,
  MeetingProjection,
  MeetingStore,
  SealedMeetingClientBoundary,
} from '../foundation/contract';
import {
  createMeetingFollowUpStore,
  deriveMeetingFollowUpRecapKey,
  type MeetingFollowUpTarget,
} from './meetingFollowUpStore';

function boundary(
  householdRef: string,
  matterId = 'matter-shared'
): SealedMeetingClientBoundary {
  return { householdRef, matterId } as SealedMeetingClientBoundary;
}

function meeting(
  id: string,
  client: SealedMeetingClientBoundary
): MeetingProjection {
  return {
    id,
    workspaceId: 'workspace-1',
    householdRef: client.householdRef,
    matterId: client.matterId,
    typeId: 'review',
    ownerRef: 'advisor-1',
    scheduledStartUtc: '2026-07-20T09:00:00.000Z',
    scheduledEndUtc: '2026-07-20T10:00:00.000Z',
    timezone: 'America/Chicago',
    state: 'completed',
    references: [],
  };
}

function harness() {
  const householdA = boundary('household-a');
  const householdB = boundary('household-b');
  let active = householdA;
  const meetings: MeetingStore = {
    list: [meeting('meeting-a', householdA), meeting('meeting-a', householdB)],
    error: null,
    get: vi.fn(),
    createDraft: vi.fn(),
    update: vi.fn(),
    transition: vi.fn(),
  };
  const records: MeetingArtifact[] = [];
  const artifacts: MeetingArtifactStore = {
    readerFor: (_meetings, client): MeetingArtifactReader => ({
      listForMeeting: (meetingId, kinds) =>
        records.filter(
          (artifact) =>
            artifact.meetingId === meetingId &&
            artifact.householdRef === client.householdRef &&
            artifact.matterId === client.matterId &&
            (!kinds || kinds.includes(artifact.kind))
        ),
      get: (id) => records.find((artifact) => artifact.id === id) ?? null,
    }),
    append: vi.fn((input: MeetingArtifactInput) => {
      const now = input.producedAt;
      const artifact: MeetingArtifact = {
        ...input,
        id: `artifact-${String(records.length + 1)}`,
        householdRef: active.householdRef,
        matterId: active.matterId,
        state: 'produced',
        createdAt: now,
      };
      records.push(artifact);
      return Promise.resolve(artifact);
    }),
    approve: vi.fn(),
  };
  return {
    householdA,
    householdB,
    meetings,
    artifacts,
    records,
    setActive(client: SealedMeetingClientBoundary) {
      active = client;
    },
  };
}

function target(client: SealedMeetingClientBoundary): MeetingFollowUpTarget {
  return { meetingId: 'meeting-a', client };
}

describe('meeting follow-up exact-pair store', () => {
  it('derives a different opaque key for each household, matter, and meeting', async () => {
    const a = target(boundary('household-a'));
    const keys = await Promise.all([
      deriveMeetingFollowUpRecapKey(a),
      deriveMeetingFollowUpRecapKey(target(boundary('household-b'))),
      deriveMeetingFollowUpRecapKey(
        target(boundary('household-a', 'matter-b'))
      ),
      deriveMeetingFollowUpRecapKey({ ...a, meetingId: 'meeting-b' }),
    ]);
    expect(new Set(keys).size).toBe(4);
    expect(keys[0]).toMatch(/^meeting-follow-up-[a-f0-9]{64}$/u);
    expect(keys[0]).not.toContain('household-a');
    expect(keys[0]).not.toContain('matter-shared');
  });

  it('does not show household A recap to household B when the matter and meeting id match', async () => {
    const lane = harness();
    const store = createMeetingFollowUpStore(lane.meetings, lane.artifacts);
    const savedA = await store.save(target(lane.householdA), {
      to: 'alpha@example.test',
      subject: 'Alpha recap',
      body: 'Private household A recap.',
      state: 'edited',
    });
    expect(savedA.kind).toBe('ready');

    lane.setActive(lane.householdB);
    const readB = await store.read(target(lane.householdB));
    expect(readB).toEqual({ kind: 'not-produced' });
    expect(JSON.stringify(readB)).not.toContain('Private household A recap');
  });

  it('locks a durable pending provider receipt to its original mailbox and refuses another attempt', async () => {
    const lane = harness();
    const store = createMeetingFollowUpStore(lane.meetings, lane.artifacts);
    const edited = {
      to: 'alpha@example.test',
      subject: 'Alpha recap',
      body: 'Private household A recap.',
    };
    await expect(
      store.save(target(lane.householdA), { ...edited, state: 'edited' })
    ).resolves.toMatchObject({ kind: 'ready' });
    await expect(
      store.save(target(lane.householdA), {
        ...edited,
        state: 'provider-save-pending',
        draftProvider: 'm365',
        draftAccount: 'advisor@firm.test',
        draftAccountLabel: 'Advisor Outlook',
      })
    ).resolves.toMatchObject({
      kind: 'ready',
      recap: {
        state: 'provider-save-pending',
        draftProvider: 'm365',
        draftAccount: 'advisor@firm.test',
      },
    });
    await expect(
      store.save(target(lane.householdA), {
        ...edited,
        state: 'provider-save-unknown',
        draftProvider: 'gmail',
        draftAccount: 'advisor@firm.test',
        draftAccountLabel: 'Advisor Gmail',
      })
    ).resolves.toEqual({ kind: 'refused' });
    await expect(
      store.save(target(lane.householdA), {
        ...edited,
        state: 'provider-save-unknown',
        draftProvider: 'm365',
        draftAccount: 'advisor@firm.test',
        draftAccountLabel: 'Advisor Outlook',
      })
    ).resolves.toMatchObject({ kind: 'ready' });
    await expect(
      store.save(target(lane.householdA), {
        ...edited,
        state: 'provider-save-pending',
        draftProvider: 'm365',
        draftAccount: 'second@firm.test',
        draftAccountLabel: 'Second Outlook',
      })
    ).resolves.toEqual({ kind: 'refused' });
  });

  it('shows a fresh store the durable pending claim and never lets another household take it', async () => {
    const lane = harness();
    const claim = async (input: {
      recapKey: string;
      meetingId: string;
      to: string;
      subject: string;
      body: string;
      provider: 'm365' | 'gmail';
      account: string;
      accountLabel: string;
    }) => {
      await lane.artifacts.append({
        meetingId: input.meetingId,
        kind: 'follow-up-draft',
        schemaVersion: 1,
        producedAt: new Date().toISOString(),
        sourceRefs: [],
        provenance: 'local-entry',
        payload: {
          recapKey: input.recapKey,
          to: input.to,
          subject: input.subject,
          body: input.body,
          deliveryState: 'provider-save-pending',
          draftProvider: input.provider,
          draftAccount: input.account,
          draftAccountLabel: input.accountLabel,
        },
      });
      return { outcome: 'acquired' as const };
    };
    const first = createMeetingFollowUpStore(
      lane.meetings,
      lane.artifacts,
      undefined,
      claim
    );
    await first.start(target(lane.householdA));
    await expect(
      first.claimProviderSave(target(lane.householdA), {
        to: 'alpha@example.test',
        subject: 'Alpha recap',
        body: 'Private household A recap.',
        provider: 'm365',
        account: 'advisor@firm.test',
        accountLabel: 'Advisor Outlook',
      })
    ).resolves.toEqual({ kind: 'acquired' });

    const fresh = createMeetingFollowUpStore(
      lane.meetings,
      lane.artifacts,
      undefined,
      claim
    );
    await expect(fresh.read(target(lane.householdA))).resolves.toMatchObject({
      kind: 'ready',
      recap: { state: 'provider-save-pending' },
    });
    lane.setActive(lane.householdB);
    await expect(fresh.read(target(lane.householdB))).resolves.toEqual({
      kind: 'not-produced',
    });
    await expect(
      fresh.claimProviderSave(target(lane.householdB), {
        to: 'beta@example.test',
        subject: 'Beta recap',
        body: 'Private household B recap.',
        provider: 'm365',
        account: 'advisor@firm.test',
        accountLabel: 'Advisor Outlook',
      })
    ).resolves.toEqual({ kind: 'refused' });
  });

  it('refuses missing runtime identity and ignores legacy records without the pair-derived key', async () => {
    const lane = harness();
    const store = createMeetingFollowUpStore(lane.meetings, lane.artifacts);
    lane.records.push({
      id: 'legacy-follow-up',
      meetingId: 'meeting-a',
      householdRef: lane.householdA.householdRef,
      matterId: lane.householdA.matterId,
      kind: 'follow-up-draft',
      schemaVersion: 1,
      state: 'produced',
      producedAt: '2026-07-20T10:00:00.000Z',
      sourceRefs: [],
      provenance: 'local-entry',
      payload: { body: 'Legacy matter-only text' },
      createdAt: '2026-07-20T10:00:00.000Z',
    });
    await expect(store.read(target(lane.householdA))).resolves.toEqual({
      kind: 'error',
    });
    await expect(
      store.read({
        meetingId: 'meeting-a',
        client: boundary('', 'matter-shared'),
      })
    ).resolves.toEqual({ kind: 'refused' });
    await expect(
      store.read({
        meetingId: 'meeting-a',
        client: undefined,
      } as unknown as MeetingFollowUpTarget)
    ).resolves.toEqual({ kind: 'refused' });
  });

  it('makes matter-only recap reads and writes compile errors', () => {
    const lane = harness();
    const store = createMeetingFollowUpStore(lane.meetings, lane.artifacts);
    function matterOnlyAccessMustNotCompile() {
      // prettier-ignore
      // @ts-expect-error follow-up reads require householdRef plus matterId.
      const read = store.read({ meetingId: 'meeting-a', client: { matterId: 'matter-shared' } });
      // prettier-ignore
      // @ts-expect-error follow-up starts require householdRef plus matterId.
      const start = store.start({ meetingId: 'meeting-a', client: { matterId: 'matter-shared' } });
      const write = store.save(
        // @ts-expect-error follow-up writes require householdRef plus matterId.
        { meetingId: 'meeting-a', client: { matterId: 'matter-shared' } },
        { to: '', subject: '', body: 'recap', state: 'edited' }
      );
      return Promise.all([read, start, write]);
    }
    expect(matterOnlyAccessMustNotCompile).toBeTypeOf('function');
  });
});
