/**
 * addMeetingKey: teaching a calendar/meeting mapping. A key belongs to
 * exactly one matter — assigning moves it off any other matter.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { useMatterStore } from '@/platform/matter/matterStore';

describe('addMeetingKey', () => {
  beforeEach(() => {
    useMatterStore.setState((s) => ({
      ...s,
      matters: [
        {
          id: 'm-1', name: 'Henderson', client: 'Kim Henderson',
          folderPaths: [], createdAt: '2024-01-01T00:00:00Z',
        },
        {
          id: 'm-2', name: 'Ortiz', client: 'R Ortiz',
          folderPaths: [], createdAt: '2024-01-01T00:00:00Z',
          meetingKeys: ['kim@henderson.com'],
        },
      ],
    }));
  });

  it('adds a trimmed key, dedupes, and moves the key off other matters', () => {
    useMatterStore.getState().addMeetingKey('m-1', '  kim@henderson.com ');
    const matters = useMatterStore.getState().matters;
    expect(matters.find((m) => m.id === 'm-1')?.meetingKeys).toEqual(['kim@henderson.com']);
    expect(matters.find((m) => m.id === 'm-2')?.meetingKeys).toEqual([]);

    useMatterStore.getState().addMeetingKey('m-1', 'kim@henderson.com');
    expect(useMatterStore.getState().matters.find((m) => m.id === 'm-1')?.meetingKeys)
      .toEqual(['kim@henderson.com']);
  });

  it('ignores blank keys', () => {
    useMatterStore.getState().addMeetingKey('m-1', '   ');
    expect(useMatterStore.getState().matters.find((m) => m.id === 'm-1')?.meetingKeys)
      .toBeUndefined();
  });

  it('moves a key off another matter even when the casing/whitespace differs (codex-review P2)', () => {
    // m-2 already has 'kim@henderson.com'. Assigning a differently-cased
    // form to m-1 must still be recognized as the same key and remove it
    // from m-2 — otherwise the resolver (which normalizes) sees two
    // matters claiming what it treats as one key.
    useMatterStore.getState().addMeetingKey('m-1', 'Kim@Henderson.COM');
    const matters = useMatterStore.getState().matters;
    expect(matters.find((m) => m.id === 'm-1')?.meetingKeys).toEqual(['Kim@Henderson.COM']);
    expect(matters.find((m) => m.id === 'm-2')?.meetingKeys).toEqual([]);
  });

  it('does not add a duplicate of an already-present key that only differs by casing', () => {
    useMatterStore.getState().addMeetingKey('m-2', 'KIM@HENDERSON.COM');
    expect(useMatterStore.getState().matters.find((m) => m.id === 'm-2')?.meetingKeys)
      .toEqual(['kim@henderson.com']);
  });
});
