import { useMemo } from 'react';
import { useLiveCrmRecords } from '@/platform/crm/useLiveCrmRecords';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';
import { sha256Hex } from '@/lib/hash';
import {
  readActiveMeetingClientBoundary,
  useActiveMeetingClientBoundary,
  type MeetingProjection,
  type MeetingRef,
  type SealedMeetingClientBoundary,
} from '../foundation/contract';

const AGENDA_RECORD_KIND = 'meeting_agenda';
const AGENDA_SCHEMA_VERSION = 1;
const MAX_AGENDA_BODY_LENGTH = 100_000;

export interface MeetingAgendaTarget {
  readonly meetingId: MeetingRef;
  readonly client: SealedMeetingClientBoundary;
}

export interface MeetingAgendaTemplateProvenance {
  readonly kind: 'built-in';
  readonly templateId: 'blank-agenda';
  readonly version: 1;
  readonly label: 'Blank agenda';
}

export interface MeetingAgendaSourceProvenance {
  readonly kind: 'meeting-reference';
  readonly sourceRef: string;
}

export interface MeetingAgenda {
  readonly id: string;
  readonly meetingId: MeetingRef;
  readonly householdRef: string;
  readonly matterId: string;
  readonly body: string;
  readonly template: MeetingAgendaTemplateProvenance;
  readonly sources: readonly MeetingAgendaSourceProvenance[];
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type MeetingAgendaReadResult =
  | { readonly kind: 'empty' }
  | { readonly kind: 'ready'; readonly agenda: MeetingAgenda }
  | {
      readonly kind: 'error';
      readonly reason:
        | 'unavailable'
        | 'identity-refused'
        | 'meeting-unavailable'
        | 'invalid-record'
        | 'stale-result';
      readonly message: string;
    };

export type MeetingAgendaWriteResult =
  | { readonly kind: 'ready'; readonly agenda: MeetingAgenda }
  | {
      readonly kind: 'error';
      readonly reason:
        | 'unavailable'
        | 'identity-refused'
        | 'meeting-unavailable'
        | 'invalid-record'
        | 'stale-result'
        | 'stale-write';
      readonly message: string;
    };

export interface MeetingAgendaStore {
  read(target: MeetingAgendaTarget): Promise<MeetingAgendaReadResult>;
  create(target: MeetingAgendaTarget): Promise<MeetingAgendaWriteResult>;
  save(
    target: MeetingAgendaTarget,
    input: { readonly body: string; readonly expectedRevision: number }
  ): Promise<MeetingAgendaWriteResult>;
}

export interface MeetingAgendaPort {
  readonly records: readonly LiveCrmRecord[];
  readonly workspaceRoot: string | null | undefined;
  readonly error: string | null;
  readonly getActiveClientBoundary: () => SealedMeetingClientBoundary | null;
  save(record: LiveCrmRecord): Promise<LiveCrmRecord>;
  reloadRecords(): Promise<readonly LiveCrmRecord[] | undefined>;
}

const BLANK_TEMPLATE: MeetingAgendaTemplateProvenance = Object.freeze({
  kind: 'built-in',
  templateId: 'blank-agenda',
  version: 1,
  label: 'Blank agenda',
});

const encoder = new TextEncoder();

function cleanId(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function sameClient(
  left: Pick<SealedMeetingClientBoundary, 'householdRef' | 'matterId'> | null,
  right: Pick<SealedMeetingClientBoundary, 'householdRef' | 'matterId'> | null
): boolean {
  return (
    !!left &&
    !!right &&
    left.householdRef === right.householdRef &&
    left.matterId === right.matterId
  );
}

function errorResult<
  Reason extends Extract<MeetingAgendaWriteResult, { kind: 'error' }>['reason'],
>(
  reason: Reason,
  message: string
): {
  readonly kind: 'error';
  readonly reason: Reason;
  readonly message: string;
} {
  return { kind: 'error', reason, message };
}

/**
 * Collision-safe, opaque key derivation for one exact household + matter +
 * meeting triple. Length framing prevents ambiguous concatenation and hashing
 * keeps client identifiers out of the durable record id.
 */
export async function deriveMeetingAgendaRecordId(
  target: MeetingAgendaTarget
): Promise<string> {
  const householdRef = cleanId(target.client.householdRef);
  const matterId = cleanId(target.client.matterId);
  const meetingId = cleanId(target.meetingId);
  if (!householdRef || !matterId || !meetingId) {
    throw new Error(
      'Agenda identity requires a household, matter, and meeting.'
    );
  }
  const framed = [householdRef, matterId, meetingId]
    .map((value) => `${String(encoder.encode(value).byteLength)}:${value}`)
    .join('|');
  return `meeting-agenda-${await sha256Hex(encoder.encode(framed))}`;
}

/** Build a target only when the canonical meeting proves the same full pair. */
export function meetingAgendaTarget(
  meeting: MeetingProjection | null | undefined,
  client: SealedMeetingClientBoundary | null | undefined
): MeetingAgendaTarget | null {
  if (
    !meeting ||
    !client ||
    meeting.householdRef !== client.householdRef ||
    meeting.matterId !== client.matterId ||
    !cleanId(meeting.id)
  ) {
    return null;
  }
  return Object.freeze({ meetingId: meeting.id, client });
}

function canonicalMeetingForTarget(
  records: readonly LiveCrmRecord[],
  target: MeetingAgendaTarget
): LiveCrmRecord | null {
  const matches = records.filter(
    (record) =>
      record.kind === 'meeting' &&
      record.id === target.meetingId &&
      record.matterId === target.client.matterId &&
      record['householdRef'] === target.client.householdRef
  );
  return matches.length === 1 ? (matches[0] ?? null) : null;
}

function sourcesFromMeeting(
  meeting: LiveCrmRecord
): readonly MeetingAgendaSourceProvenance[] {
  const refs = Array.isArray(meeting['references'])
    ? meeting['references']
    : [];
  const unique = new Set<string>();
  for (const value of refs) {
    const ref = cleanId(value);
    if (ref) unique.add(ref);
  }
  return [...unique].map((sourceRef) => ({
    kind: 'meeting-reference' as const,
    sourceRef,
  }));
}

function isoTimestamp(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) || date.toISOString() !== value
    ? null
    : value;
}

function projectAgenda(
  record: LiveCrmRecord,
  target: MeetingAgendaTarget,
  expectedId: string
): MeetingAgenda | null {
  if (
    record.id !== expectedId ||
    record.kind !== AGENDA_RECORD_KIND ||
    record.matterId !== target.client.matterId ||
    record['householdRef'] !== target.client.householdRef ||
    record['meetingId'] !== target.meetingId ||
    record['schemaVersion'] !== AGENDA_SCHEMA_VERSION ||
    typeof record['body'] !== 'string' ||
    record['body'].length > MAX_AGENDA_BODY_LENGTH ||
    record['revision'] === undefined ||
    !Number.isInteger(record['revision']) ||
    Number(record['revision']) < 1 ||
    !isoTimestamp(record.createdAt) ||
    !isoTimestamp(record.updatedAt)
  ) {
    return null;
  }
  const rawTemplate = record['template'];
  if (
    !rawTemplate ||
    typeof rawTemplate !== 'object' ||
    (rawTemplate as Record<string, unknown>)['kind'] !== 'built-in' ||
    (rawTemplate as Record<string, unknown>)['templateId'] !== 'blank-agenda' ||
    (rawTemplate as Record<string, unknown>)['version'] !== 1 ||
    (rawTemplate as Record<string, unknown>)['label'] !== 'Blank agenda'
  ) {
    return null;
  }
  const rawSources = record['sources'];
  if (!Array.isArray(rawSources)) return null;
  const sources: MeetingAgendaSourceProvenance[] = [];
  for (const source of rawSources) {
    if (
      !source ||
      typeof source !== 'object' ||
      (source as Record<string, unknown>)['kind'] !== 'meeting-reference'
    ) {
      return null;
    }
    const sourceRef = cleanId((source as Record<string, unknown>)['sourceRef']);
    if (!sourceRef) return null;
    sources.push({ kind: 'meeting-reference', sourceRef });
  }
  return Object.freeze({
    id: record.id,
    meetingId: target.meetingId,
    householdRef: target.client.householdRef,
    matterId: target.client.matterId,
    body: record['body'],
    template: BLANK_TEMPLATE,
    sources: Object.freeze(sources),
    revision: Number(record['revision']),
    createdAt: record.createdAt as string,
    updatedAt: record.updatedAt as string,
  });
}

function targetIsActive(
  port: MeetingAgendaPort,
  target: MeetingAgendaTarget
): boolean {
  return sameClient(port.getActiveClientBoundary(), target.client);
}

async function loadExactSnapshot(
  port: MeetingAgendaPort,
  target: MeetingAgendaTarget
): Promise<
  | {
      readonly kind: 'ready';
      readonly records: readonly LiveCrmRecord[];
      readonly meeting: LiveCrmRecord;
      readonly agendaId: string;
    }
  | Extract<MeetingAgendaReadResult, { kind: 'error' }>
> {
  if (!port.workspaceRoot || port.error) {
    return errorResult(
      'unavailable',
      'Agenda records are unavailable until the workspace reloads.'
    );
  }
  if (!targetIsActive(port, target)) {
    return errorResult(
      'identity-refused',
      'This agenda belongs to a different client than the active one.'
    );
  }
  const records = await port.reloadRecords();
  if (!targetIsActive(port, target)) {
    return errorResult(
      'stale-result',
      'The active client changed while this agenda was loading.'
    );
  }
  if (!records) {
    return errorResult('unavailable', 'Agenda records could not be reloaded.');
  }
  const meeting = canonicalMeetingForTarget(records, target);
  if (!meeting) {
    return errorResult(
      'meeting-unavailable',
      'This exact meeting is unavailable for the active client.'
    );
  }
  return {
    kind: 'ready',
    records,
    meeting,
    agendaId: await deriveMeetingAgendaRecordId(target),
  };
}

export function createMeetingAgendaStore(
  port: MeetingAgendaPort
): MeetingAgendaStore {
  const readUnsafe = async (
    target: MeetingAgendaTarget
  ): Promise<MeetingAgendaReadResult> => {
    const snapshot = await loadExactSnapshot(port, target);
    if (snapshot.kind === 'error') return snapshot;
    if (!targetIsActive(port, target)) {
      return errorResult(
        'stale-result',
        'The active client changed while this agenda was loading.'
      );
    }
    const record = snapshot.records.find(
      (candidate) => candidate.id === snapshot.agendaId
    );
    if (!record) return { kind: 'empty' };
    const agenda = projectAgenda(record, target, snapshot.agendaId);
    return agenda
      ? { kind: 'ready', agenda }
      : errorResult('invalid-record', 'The saved agenda record is invalid.');
  };

  const write = async (
    target: MeetingAgendaTarget,
    body: string,
    expectedRevision: number | null
  ): Promise<MeetingAgendaWriteResult> => {
    if (typeof body !== 'string' || body.length > MAX_AGENDA_BODY_LENGTH) {
      return errorResult('invalid-record', 'The agenda text is too large.');
    }
    const snapshot = await loadExactSnapshot(port, target);
    if (snapshot.kind === 'error') return snapshot;
    const existingRecord = snapshot.records.find(
      (candidate) => candidate.id === snapshot.agendaId
    );
    const existing = existingRecord
      ? projectAgenda(existingRecord, target, snapshot.agendaId)
      : null;
    if (existingRecord && !existing) {
      return errorResult(
        'invalid-record',
        'The saved agenda record is invalid.'
      );
    }
    if (
      (expectedRevision === null && existing) ||
      (expectedRevision !== null && existing?.revision !== expectedRevision)
    ) {
      return errorResult(
        'stale-write',
        'This agenda changed after it was opened. Reload it before saving.'
      );
    }
    if (!targetIsActive(port, target)) {
      return errorResult(
        'stale-result',
        'The active client changed before this agenda could be saved.'
      );
    }
    const writtenAt = new Date().toISOString();
    const record: LiveCrmRecord = {
      id: snapshot.agendaId,
      kind: AGENDA_RECORD_KIND,
      matterId: target.client.matterId,
      householdRef: target.client.householdRef,
      meetingId: target.meetingId,
      schemaVersion: AGENDA_SCHEMA_VERSION,
      body,
      template: existing?.template ?? BLANK_TEMPLATE,
      sources: existing?.sources ?? sourcesFromMeeting(snapshot.meeting),
      revision: (existing?.revision ?? 0) + 1,
      createdAt: existing?.createdAt ?? writtenAt,
      updatedAt: writtenAt,
    };
    const saved = await port.save(record);
    if (!targetIsActive(port, target)) {
      return errorResult(
        'stale-result',
        'The active client changed while this agenda was saving.'
      );
    }
    const fresh = await port.reloadRecords();
    if (!targetIsActive(port, target)) {
      return errorResult(
        'stale-result',
        'The active client changed while this agenda was saving.'
      );
    }
    if (!fresh || !canonicalMeetingForTarget(fresh, target)) {
      return errorResult(
        'meeting-unavailable',
        'This exact meeting became unavailable while the agenda was saving.'
      );
    }
    const reloaded = fresh.find((candidate) => candidate.id === saved.id);
    const agenda = reloaded
      ? projectAgenda(reloaded, target, snapshot.agendaId)
      : null;
    return agenda
      ? { kind: 'ready', agenda }
      : errorResult(
          'invalid-record',
          'The saved agenda was missing after its canonical reload.'
        );
  };

  const unavailableMessage = (error: unknown): string =>
    error instanceof Error ? error.message : String(error);

  return {
    read: async (target) => {
      try {
        return await readUnsafe(target);
      } catch (error) {
        return errorResult('unavailable', unavailableMessage(error));
      }
    },
    create: async (target) => {
      try {
        return await write(target, '', null);
      } catch (error) {
        return errorResult('unavailable', unavailableMessage(error));
      }
    },
    save: async (target, input) => {
      try {
        return await write(target, input.body, input.expectedRevision);
      } catch (error) {
        return errorResult('unavailable', unavailableMessage(error));
      }
    },
  };
}

/** Reactive production adapter over the encrypted canonical CRM store. */
export function useMeetingAgendaStore(): MeetingAgendaStore {
  const live = useLiveCrmRecords();
  // Subscribe so a pair switch rerenders the panel, while the held store still
  // re-reads the live resolver at every async boundary.
  useActiveMeetingClientBoundary();
  return useMemo(
    () =>
      createMeetingAgendaStore({
        records: live.records,
        workspaceRoot: live.workspaceRoot,
        error: live.error,
        getActiveClientBoundary: readActiveMeetingClientBoundary,
        save: live.save,
        reloadRecords: live.reloadRecords,
      }),
    [
      live.error,
      live.records,
      live.reloadRecords,
      live.save,
      live.workspaceRoot,
    ]
  );
}
