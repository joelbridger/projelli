import { describe, it, expect, vi } from 'vitest';
import { detectMeetingType, typeDefaults, makeMeetingTypesStore } from '@/features/meetings/meetingTypes';

describe('meeting type detection', () => {
  it('detects built-ins from calendar titles', () => {
    expect(detectMeetingType('Hendersons — Annual Review', {})).toBe('annual-review');
    expect(detectMeetingType('New client intake: Ortiz', {})).toBe('intake');
    expect(detectMeetingType('Quick check in', {})).toBe('check-in');
    expect(detectMeetingType('Lunch', {})).toBeNull();
  });
  it('detects from a null title', () => {
    expect(detectMeetingType(null, {})).toBeNull();
  });
  it('learned corrections beat keywords', () => {
    const learned = { 'acme planning sync': 'annual-review' as const };
    expect(detectMeetingType('Acme Planning sync', learned)).toBe('annual-review');
  });
  it('defaults differ by type', () => {
    expect(typeDefaults('annual-review').prepareCrmPacket).toBe(true);
    expect(typeDefaults('check-in').prepareFollowupDraft).toBe(false);
    expect(typeDefaults('intake').prepareFollowupDraft).toBe(true);
  });
  it('all built-in types default to the meeting-note template', () => {
    expect(typeDefaults('annual-review').templateId).toBe('meeting-note-from-transcript');
    expect(typeDefaults('intake').templateId).toBe('meeting-note-from-transcript');
    expect(typeDefaults('check-in').templateId).toBe('meeting-note-from-transcript');
  });
});

describe('meeting types storage (injected-pair pattern)', () => {
  it('starts empty, then remembers a learned correction across loads', async () => {
    const files = new Map<string, string>();
    const ws = {
      readFile: vi.fn(async (p: string) => {
        const v = files.get(p);
        if (v === undefined) throw new Error('not found');
        return v;
      }),
      writeFile: vi.fn(async (p: string, c: string) => { files.set(p, c); }),
    };
    const store = makeMeetingTypesStore(ws);
    expect((await store.load()).learned).toEqual({});
    await store.learnCorrection('Acme Planning Sync', 'annual-review');
    const file = await store.load();
    expect(file.learned['acme planning sync']).toBe('annual-review');
    expect(detectMeetingType('ACME planning sync', file.learned)).toBe('annual-review');
  });

  it('does not rewrite meeting types when access is revoked during its read', async () => {
    const original = JSON.stringify({
      learned: { existing: 'check-in' },
      custom: [],
    });
    const files = new Map([['.lantern/meeting-types.json', original]]);
    let signalReadStarted!: () => void;
    const readStarted = new Promise<void>((resolve) => {
      signalReadStarted = resolve;
    });
    let releaseRead!: (value: string) => void;
    const ws = {
      readFile: vi.fn(
        () =>
          new Promise<string>((resolve) => {
            releaseRead = resolve;
            signalReadStarted();
          })
      ),
      writeFile: vi.fn(async (path: string, content: string) => {
        files.set(path, content);
      }),
    };
    let revoked = false;
    const guard = {
      assertCurrentAccess: vi.fn(async () => {
        if (revoked) throw new Error('Access changed');
      }),
    };
    const pending = makeMeetingTypesStore(ws).learnCorrection(
      'Held private meeting',
      'annual-review',
      guard
    );

    await readStarted;
    revoked = true;
    releaseRead(original);

    await expect(pending).rejects.toThrow('Access changed');
    expect(guard.assertCurrentAccess).toHaveBeenCalledTimes(2);
    expect(ws.writeFile).not.toHaveBeenCalled();
    expect(files.get('.lantern/meeting-types.json')).toBe(original);
  });

  it('adds and replaces custom types by id', async () => {
    const files = new Map<string, string>();
    const ws = {
      readFile: vi.fn(async (p: string) => files.get(p) ?? (() => { throw new Error('not found'); })()),
      writeFile: vi.fn(async (p: string, c: string) => { files.set(p, c); }),
    };
    const store = makeMeetingTypesStore(ws);
    const defaults = typeDefaults('custom-1');
    await store.addCustomType({ id: 'custom-1', label: 'Estate Planning', defaults });
    await store.addCustomType({ id: 'custom-1', label: 'Estate Planning Renamed', defaults });
    const file = await store.load();
    expect(file.custom).toHaveLength(1);
    expect(file.custom[0]?.label).toBe('Estate Planning Renamed');
  });
});
