import { describe, expect, it, vi } from 'vitest';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';
import { createCalendarEventStore, createDraftFromRecord } from './eventStore';

function port(
  initial: LiveCrmRecord[] = [],
  canonicalize: (record: LiveCrmRecord) => LiveCrmRecord = (record) => record,
) {
  const records = [...initial];
  const save = vi.fn((record: LiveCrmRecord) => {
    const saveEcho = structuredClone(record);
    const canonical = structuredClone(canonicalize(saveEcho));
    const index = records.findIndex((candidate) => candidate.id === canonical.id);
    if (index >= 0) records[index] = canonical;
    else records.push(canonical);
    return Promise.resolve(saveEcho);
  });
  return {
    records,
    workspaceRoot: '/workspace',
    error: null,
    save,
    reloadRecords: vi.fn(() => Promise.resolve(structuredClone(records))),
  };
}

const baseDraft = {
  title: 'Annual review',
  startUtc: '2026-08-03T14:00:00Z',
  endUtc: '2026-08-03T14:30:00Z',
  displayTimezone: 'America/New_York',
  allDay: false,
  calendarId: 'calendar:local',
} as const;

describe('calendar event store', () => {
  it('uses the same create path for record prefill and preserves context plus additive fields on a thin patch', async () => {
    const live = port();
    const created = await createCalendarEventStore(live).create(createDraftFromRecord(
      { kind: 'household', id: 'household-1', matterId: 'matter-1', label: 'Rivera' },
      baseDraft,
    ));
    const stored = live.records[0];
    if (!stored) throw new Error('Expected the created calendar record.');
    live.records[0] = { ...stored, additiveFutureField: { retained: true } };
    const updated = await createCalendarEventStore(live).update(created.id, { title: 'Updated annual review' });
    expect(updated.contextRef).toMatchObject({ id: 'household-1', matterId: 'matter-1' });
    expect(live.records[0]['additiveFutureField']).toEqual({ retained: true });
    expect(live.save).toHaveBeenCalledTimes(2);
  });

  it('cancels with an explicit status update rather than deleting the record', async () => {
    const live = port();
    const created = await createCalendarEventStore(live).create(baseDraft);
    const cancelled = await createCalendarEventStore(live).cancel(created.id);
    expect(cancelled.status).toBe('cancelled');
    expect(live.records).toHaveLength(1);
    expect(live.records[0]?.['deleted']).toBe(false);
  });

  it('returns the canonical reload result from create, update, and cancel rather than the save echo', async () => {
    const live = port([], (record) => ({
      ...record,
      notes: `canonical:${String(record['status'])}:${String(record['title'])}`,
    }));
    const created = await createCalendarEventStore(live).create(baseDraft);
    expect(created.notes).toBe('canonical:scheduled:Annual review');

    const updated = await createCalendarEventStore(live).update(created.id, { title: 'Canonical update' });
    expect(updated.notes).toBe('canonical:scheduled:Canonical update');

    const cancelled = await createCalendarEventStore(live).cancel(created.id);
    expect(cancelled.notes).toBe('canonical:cancelled:Canonical update');
    expect(live.reloadRecords).toHaveBeenCalledTimes(3);
  });
});
