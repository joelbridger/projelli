/**
 * Tests for calendar event -> matter resolution:
 *   - buildCalendarMatterMap: taught meetingKeys + client/matter names,
 *     ambiguous name keys dropped, first-writer-wins on taught keys
 *   - resolveMattersForCalendarEvent: email beats name per attendee,
 *     multi-client events return every matched matter, no match -> []
 */

import { describe, expect, it } from 'vitest';
import {
  buildCalendarMatterMap,
  resolveMattersForCalendarEvent,
} from './matterResolver';
import type { Matter } from '@/platform/types/matter';

function makeMatter(
  overrides: Pick<Matter, 'id' | 'name' | 'client'> & Partial<Matter>,
): Matter {
  return {
    folderPaths: [],
    createdAt: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('buildCalendarMatterMap', () => {
  it('emits taught meetingKeys and client + matter names, normalized', () => {
    const matters = [
      makeMatter({
        id: 'm-hend',
        name: 'Henderson Household',
        client: 'Kim Henderson',
        meetingKeys: [' Kim@Henderson.COM '],
      }),
    ];
    const entries = buildCalendarMatterMap(matters);
    const keys = entries.map((e) => e.key).sort();
    expect(keys).toEqual(['henderson household', 'kim henderson', 'kim@henderson.com']);
    expect(entries.every((e) => e.matterId === 'm-hend')).toBe(true);
  });

  it('drops name-derived keys shared by two matters (ambiguity never links)', () => {
    const matters = [
      makeMatter({ id: 'm-1', name: 'Smith Household', client: 'John Smith' }),
      makeMatter({ id: 'm-2', name: 'Smith Trust', client: 'John Smith' }),
    ];
    const entries = buildCalendarMatterMap(matters);
    expect(entries.find((e) => e.key === 'john smith')).toBeUndefined();
    expect(entries.find((e) => e.key === 'smith household')?.matterId).toBe('m-1');
    expect(entries.find((e) => e.key === 'smith trust')?.matterId).toBe('m-2');
  });

  it('skips the unassigned matter and blank keys', () => {
    const matters = [
      makeMatter({ id: 'unassigned', name: 'Needs filing', client: '' }),
      makeMatter({ id: 'm-1', name: 'Ortiz', client: '  ', meetingKeys: ['', '  '] }),
    ];
    const entries = buildCalendarMatterMap(matters);
    expect(entries).toEqual([{ key: 'ortiz', matterId: 'm-1' }]);
  });
});

describe('resolveMattersForCalendarEvent', () => {
  const entries = [
    { key: 'kim@henderson.com', matterId: 'm-hend' },
    { key: 'r ortiz', matterId: 'm-ortiz' },
    { key: 'henderson quarterly', matterId: 'm-hend' },
  ];

  it('matches by attendee email', () => {
    const got = resolveMattersForCalendarEvent(
      { title: 'Review', attendees: [{ email: 'Kim@Henderson.com', name: 'Kim' }] },
      entries,
    );
    expect(got).toEqual(['m-hend']);
  });

  it('falls back to attendee name and event title', () => {
    expect(
      resolveMattersForCalendarEvent(
        { title: 'x', attendees: [{ email: 'other@x.com', name: 'R  Ortiz' }] },
        entries,
      ),
    ).toEqual(['m-ortiz']);
    expect(
      resolveMattersForCalendarEvent({ title: 'Henderson Quarterly', attendees: [] }, entries),
    ).toEqual(['m-hend']);
  });

  it('returns every matched matter for a joint meeting, deduped and sorted', () => {
    const got = resolveMattersForCalendarEvent(
      {
        title: 'Joint planning',
        attendees: [
          { email: 'kim@henderson.com', name: 'Kim' },
          { email: 'z@z.com', name: 'R Ortiz' },
          { email: 'kim@henderson.com', name: 'Kim again' },
        ],
      },
      entries,
    );
    expect(got).toEqual(['m-hend', 'm-ortiz']);
  });

  it('returns [] when nothing matches (unassigned, never guessed)', () => {
    expect(
      resolveMattersForCalendarEvent(
        { title: 'Dentist', attendees: [{ email: 'doc@dental.com', name: 'Doc' }] },
        entries,
      ),
    ).toEqual([]);
  });

  it('matches by organizer email when the client sent the invite (mirrors Rust engine::resolve_event_matters)', () => {
    // Google/Graph put the sender in `organizer`, not `attendees` — when
    // the client sends the invite, attendees may only list the advisor.
    const got = resolveMattersForCalendarEvent(
      {
        title: 'Client-sent invite',
        attendees: [{ email: 'adv@firm.com', name: 'Advisor' }],
        organizerEmail: 'Kim@Henderson.com',
      },
      entries,
    );
    expect(got).toEqual(['m-hend']);
  });
});
