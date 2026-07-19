import { describe, expect, it, vi } from 'vitest';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';
import type {
  MeetingProjection,
  SealedMeetingClientBoundary,
} from '../foundation/contract';
import {
  createMeetingAgendaStore,
  deriveMeetingAgendaRecordId,
  meetingAgendaTarget,
  type MeetingAgendaPort,
  type MeetingAgendaTarget,
} from './meetingAgendaStore';

function boundary(
  householdRef: string,
  matterId: string
): SealedMeetingClientBoundary {
  return { householdRef, matterId } as SealedMeetingClientBoundary;
}

function canonicalMeeting(
  meetingId = 'meeting-1',
  client = boundary('household-1', 'matter-1')
): LiveCrmRecord {
  return {
    id: meetingId,
    kind: 'meeting',
    matterId: client.matterId,
    householdRef: client.householdRef,
    references: ['document-1', 'contact-1', 'document-1'],
  };
}

function target(
  meetingId = 'meeting-1',
  client = boundary('household-1', 'matter-1')
): MeetingAgendaTarget {
  return { meetingId, client };
}

function portHarness(initial: readonly LiveCrmRecord[]) {
  let records = structuredClone(initial) as LiveCrmRecord[];
  let active = boundary('household-1', 'matter-1');
  const save = vi.fn((record: LiveCrmRecord) => {
    const copy = structuredClone(record);
    records = records.some((candidate) => candidate.id === copy.id)
      ? records.map((candidate) =>
          candidate.id === copy.id ? copy : candidate
        )
      : [...records, copy];
    return Promise.resolve(structuredClone(copy));
  });
  const port: MeetingAgendaPort = {
    records: structuredClone(records),
    workspaceRoot: '/workspace',
    error: null,
    getActiveClientBoundary: () => active,
    save,
    reloadRecords: () => Promise.resolve(structuredClone(records)),
  };
  return {
    port,
    save,
    records: () => structuredClone(records),
    setActive(next: SealedMeetingClientBoundary) {
      active = next;
    },
    replaceRecords(next: readonly LiveCrmRecord[]) {
      records = structuredClone(next) as LiveCrmRecord[];
    },
  };
}

describe('meetingAgendaStore exact-meeting persistence', () => {
  it('derives opaque, stable keys from all three identity fields', async () => {
    const base = target();
    const [first, repeated, otherHousehold, otherMatter, otherMeeting] =
      await Promise.all([
        deriveMeetingAgendaRecordId(base),
        deriveMeetingAgendaRecordId(base),
        deriveMeetingAgendaRecordId(
          target('meeting-1', boundary('household-2', 'matter-1'))
        ),
        deriveMeetingAgendaRecordId(
          target('meeting-1', boundary('household-1', 'matter-2'))
        ),
        deriveMeetingAgendaRecordId(target('meeting-2')),
      ]);

    expect(first).toBe(repeated);
    expect(
      new Set([first, otherHousehold, otherMatter, otherMeeting]).size
    ).toBe(4);
    expect(first).toMatch(/^meeting-agenda-[a-f0-9]{64}$/u);
    expect(first).not.toContain('household-1');
    expect(first).not.toContain('matter-1');
    expect(first).not.toContain('meeting-1');
  });

  it('persists a real blank draft and reloads its template/source provenance', async () => {
    const harness = portHarness([canonicalMeeting()]);
    const firstStore = createMeetingAgendaStore(harness.port);

    const created = await firstStore.create(target());
    expect(created.kind).toBe('ready');
    if (created.kind !== 'ready') throw new Error(created.message);
    expect(created.agenda.body).toBe('');
    expect(created.agenda.template).toEqual({
      kind: 'built-in',
      templateId: 'blank-agenda',
      version: 1,
      label: 'Blank agenda',
    });
    expect(created.agenda.sources).toEqual([
      { kind: 'meeting-reference', sourceRef: 'document-1' },
      { kind: 'meeting-reference', sourceRef: 'contact-1' },
    ]);
    expect(harness.save).toHaveBeenCalledTimes(1);

    const saved = await firstStore.save(target(), {
      body: '## Topics\n\n- Review the plan',
      expectedRevision: created.agenda.revision,
    });
    expect(saved.kind).toBe('ready');
    if (saved.kind !== 'ready') throw new Error(saved.message);
    expect(saved.agenda.revision).toBe(2);

    const freshStore = createMeetingAgendaStore({
      ...harness.port,
      records: harness.records(),
    });
    await expect(freshStore.read(target())).resolves.toMatchObject({
      kind: 'ready',
      agenda: {
        body: '## Topics\n\n- Review the plan',
        householdRef: 'household-1',
        matterId: 'matter-1',
        meetingId: 'meeting-1',
        revision: 2,
      },
    });
  });

  it('requires the exact canonical meeting and refuses cross-client targets', async () => {
    const harness = portHarness([
      canonicalMeeting(),
      canonicalMeeting('meeting-2', boundary('household-2', 'matter-2')),
    ]);
    const store = createMeetingAgendaStore(harness.port);

    await expect(store.read(target('meeting-missing'))).resolves.toMatchObject({
      kind: 'error',
      reason: 'meeting-unavailable',
    });
    await expect(
      store.read(target('meeting-2', boundary('household-2', 'matter-2')))
    ).resolves.toMatchObject({
      kind: 'error',
      reason: 'identity-refused',
    });
    expect(harness.save).not.toHaveBeenCalled();
  });

  it('does not read household A agenda through household B with the same matter and meeting', async () => {
    const householdA = boundary('household-a', 'matter-shared');
    const householdB = boundary('household-b', 'matter-shared');
    const harness = portHarness([
      canonicalMeeting('meeting-shared', householdA),
    ]);
    harness.setActive(householdA);
    const householdAStore = createMeetingAgendaStore(harness.port);
    const created = await householdAStore.create(
      target('meeting-shared', householdA)
    );
    if (created.kind !== 'ready') throw new Error(created.message);
    const saved = await householdAStore.save(
      target('meeting-shared', householdA),
      {
        body: 'Household A private agenda',
        expectedRevision: created.agenda.revision,
      }
    );
    expect(saved.kind).toBe('ready');

    harness.replaceRecords([
      ...harness.records(),
      canonicalMeeting('meeting-shared', householdB),
    ]);
    harness.setActive(householdB);
    const householdBStore = createMeetingAgendaStore({
      ...harness.port,
      records: harness.records(),
    });

    await expect(
      householdBStore.read(target('meeting-shared', householdB))
    ).resolves.toEqual({ kind: 'empty' });
  });

  it('refuses incomplete client pairs before reading or writing records', async () => {
    const reloadRecords = vi.fn<MeetingAgendaPort['reloadRecords']>();
    const save = vi.fn<MeetingAgendaPort['save']>();
    const incompletePairs = [
      boundary('', ''),
      boundary('household-1', ''),
      boundary('', 'matter-1'),
      boundary('   ', '\t'),
      {
        householdRef: undefined,
        matterId: undefined,
      } as unknown as SealedMeetingClientBoundary,
    ];

    for (const incomplete of incompletePairs) {
      const store = createMeetingAgendaStore({
        records: [],
        workspaceRoot: '/workspace',
        error: null,
        getActiveClientBoundary: () => incomplete,
        save,
        reloadRecords,
      });
      const incompleteTarget = target('meeting-1', incomplete);

      await expect(store.read(incompleteTarget)).resolves.toMatchObject({
        kind: 'error',
        reason: 'identity-refused',
      });
      await expect(store.create(incompleteTarget)).resolves.toMatchObject({
        kind: 'error',
        reason: 'identity-refused',
      });
      await expect(
        store.save(incompleteTarget, {
          body: 'Must not save',
          expectedRevision: 1,
        })
      ).resolves.toMatchObject({ kind: 'error', reason: 'identity-refused' });

      expect(
        meetingAgendaTarget(
          {
            id: 'meeting-1',
            householdRef: incomplete.householdRef,
            matterId: incomplete.matterId,
          } as MeetingProjection,
          incomplete
        )
      ).toBeNull();
    }

    expect(reloadRecords).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it('rejects a late read after the active sealed pair changes', async () => {
    let resolveReload!: (records: readonly LiveCrmRecord[]) => void;
    const harness = portHarness([canonicalMeeting()]);
    harness.port.reloadRecords = () =>
      new Promise((resolve) => {
        resolveReload = resolve;
      });
    const pending = createMeetingAgendaStore(harness.port).read(target());

    harness.setActive(boundary('household-2', 'matter-2'));
    resolveReload([canonicalMeeting()]);

    await expect(pending).resolves.toMatchObject({
      kind: 'error',
      reason: 'stale-result',
    });
  });

  it('surfaces reload failures as a typed local error', async () => {
    const harness = portHarness([canonicalMeeting()]);
    harness.port.reloadRecords = () =>
      Promise.reject(new Error('Encrypted records are locked.'));

    await expect(
      createMeetingAgendaStore(harness.port).read(target())
    ).resolves.toEqual({
      kind: 'error',
      reason: 'unavailable',
      message: 'Encrypted records are locked.',
    });
  });

  it('rejects stale editor revisions instead of overwriting newer text', async () => {
    const harness = portHarness([canonicalMeeting()]);
    const store = createMeetingAgendaStore(harness.port);
    const created = await store.create(target());
    if (created.kind !== 'ready') throw new Error(created.message);
    const newer = await store.save(target(), {
      body: 'Newer text',
      expectedRevision: created.agenda.revision,
    });
    if (newer.kind !== 'ready') throw new Error(newer.message);

    const stale = await store.save(target(), {
      body: 'Older text',
      expectedRevision: created.agenda.revision,
    });
    expect(stale).toMatchObject({ kind: 'error', reason: 'stale-write' });
    expect(harness.save).toHaveBeenCalledTimes(2);
    expect(harness.records()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'meeting_agenda', body: 'Newer text' }),
      ])
    );
  });

  it('builds a panel target only from a canonical meeting matching both client fields', () => {
    const client = boundary('household-1', 'matter-1');
    const meeting = {
      id: 'meeting-1',
      householdRef: 'household-1',
      matterId: 'matter-1',
    } as MeetingProjection;
    expect(meetingAgendaTarget(meeting, client)).toEqual({
      meetingId: 'meeting-1',
      client,
    });
    expect(
      meetingAgendaTarget({ ...meeting, householdRef: 'household-2' }, client)
    ).toBeNull();
    expect(
      meetingAgendaTarget({ ...meeting, matterId: 'matter-2' }, client)
    ).toBeNull();
  });
});
