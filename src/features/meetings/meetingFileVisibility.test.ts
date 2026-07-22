import { describe, expect, it, vi } from 'vitest';
import type {
  MeetingVisibilityPolicy,
  MeetingVisibilitySubject,
} from '@/platform/meeting-visibility';
import {
  createMeetingFileVisibilityManifest,
  decideMeetingFileVisibility,
  resolveMeetingFilePathVisibility,
  type MeetingFileVisibilityManifest,
} from './meetingFileVisibility';

const policy: MeetingVisibilityPolicy = {
  id: 'policy-one-meeting',
  mode: 'explicit-review',
  includedMemberIds: ['included'],
  excludedMemberIds: ['excluded'],
};

function manifest(): MeetingFileVisibilityManifest {
  return createMeetingFileVisibilityManifest({
    meetingSubjectId: 'meeting-file:exact-1',
    ownerRef: 'owner',
    visibilityPolicyId: policy.id,
    fileNames: ['meeting.json', 'transcript.json', 'notes.docx'],
  });
}

describe('file-backed meeting visibility', () => {
  it.each([
    ['owner', true],
    ['included', true],
    ['excluded', false],
    ['other', false],
    [null, false],
  ] as const)('resolves the current viewer %p before exposing a file', (viewerId, visible) => {
    expect(
      decideMeetingFileVisibility({
        manifest: manifest(),
        fileName: 'notes.docx',
        context: { viewerId, policies: [policy] },
      })
    ).toBe(visible);
  });

  it('fails closed for a missing policy, missing file identity, and malformed parent lineage', () => {
    const current = manifest();
    expect(
      decideMeetingFileVisibility({
        manifest: current,
        fileName: 'notes.docx',
        context: { viewerId: 'owner', policies: [] },
      })
    ).toBe(false);
    expect(
      decideMeetingFileVisibility({
        manifest: current,
        fileName: 'unregistered.txt',
        context: { viewerId: 'owner', policies: [policy] },
      })
    ).toBe(false);

    const wrongParent: MeetingFileVisibilityManifest = {
      ...current,
      files: {
        ...current.files,
        'notes.docx': {
          ...(current.files['notes.docx'] as MeetingVisibilitySubject),
          parentRef: { kind: 'meeting-note', id: 'another-meeting' },
        } as MeetingVisibilitySubject,
      },
    };
    expect(
      decideMeetingFileVisibility({
        manifest: wrongParent,
        fileName: 'notes.docx',
        context: { viewerId: 'owner', policies: [policy] },
      })
    ).toBe(false);
  });

  it('uses the exact sibling manifest on both slash forms, never a folder name guess', async () => {
    const current = manifest();
    const raw = JSON.stringify({ meetingFileVisibility: current });
    const workspace = {
      exists: vi.fn(async (path: string) =>
        path.replaceAll('\\', '/').endsWith('/client/Meetings/arbitrary/meeting.json')
      ),
      readFile: vi.fn(async () => raw),
    };

    await expect(
      resolveMeetingFilePathVisibility({
        path: 'C:\\workspace\\client\\Meetings\\arbitrary\\notes.docx',
        workspace,
        context: { viewerId: 'excluded', policies: [policy] },
      })
    ).resolves.toEqual({ kind: 'hidden' });
    await expect(
      resolveMeetingFilePathVisibility({
        path: 'C:/workspace/client/Meetings/arbitrary/transcript.json',
        workspace,
        context: { viewerId: 'included', policies: [policy] },
      })
    ).resolves.toEqual({ kind: 'visible' });
  });

  it('allows only an explicitly classified genuine legacy file', () => {
    const legacy: MeetingFileVisibilityManifest = {
      version: 1,
      meetingSubject: {
        id: 'legacy-meeting',
        kind: 'meeting-note',
        lineage: 'legacy-unrestricted',
      },
      files: {
        'meeting.json': {
          id: 'legacy-meeting-json',
          kind: 'file-reference',
          lineage: 'legacy-unrestricted',
        },
      },
    };
    expect(
      decideMeetingFileVisibility({
        manifest: legacy,
        fileName: 'meeting.json',
        context: { viewerId: null, policies: [] },
      })
    ).toBe(true);
    expect(
      decideMeetingFileVisibility({
        manifest: { ...legacy, files: {} },
        fileName: 'meeting.json',
        context: { viewerId: null, policies: [] },
      })
    ).toBe(false);
  });
});
