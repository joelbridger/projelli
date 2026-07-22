import { useFirmStore } from '@/platform/firm/firmStore';
import { loadLiveCrmRecords } from '@/platform/crm/liveRecords';
import {
  resolveMeetingVisibility,
  type MeetingVisibilityPolicy,
  type MeetingVisibilitySubject,
  type MeetingVisibilitySubjectRef,
  type RootMeetingVisibilitySubject,
} from '@/platform/meeting-visibility';

/**
 * The file-backed meeting route predates the canonical meeting store.  This
 * manifest gives every meeting folder and every protected file inside it a
 * stable identity so visibility never depends on a title, date, or folder
 * name.  It lives in the existing meeting.json; there is no second store.
 */
export interface MeetingFileVisibilityManifest {
  readonly version: 1;
  readonly meetingSubject: MeetingVisibilitySubject;
  readonly files: Readonly<Record<string, MeetingVisibilitySubject>>;
}

export interface MeetingFileVisibilityContext {
  readonly viewerId: string | null;
  readonly policies: readonly unknown[];
}

export interface MeetingVisibilityWorkspace {
  readFile(path: string): Promise<string>;
  exists?(path: string): Promise<boolean>;
}

export type MeetingFileVisibilityResult =
  | { readonly kind: 'not-meeting' }
  | { readonly kind: 'visible' }
  | { readonly kind: 'hidden' };

export const FILE_MEETING_OWNER_PRIVATE_POLICY_ID =
  'meeting-file-visibility:owner-private';

export const FILE_MEETING_OWNER_PRIVATE_POLICY: MeetingVisibilityPolicy = {
  id: FILE_MEETING_OWNER_PRIVATE_POLICY_ID,
  mode: 'explicit-review',
  includedMemberIds: [],
  excludedMemberIds: [],
};

const FILE_VISIBILITY_FIELD = 'meetingFileVisibility';
const LOCAL_ADVISOR_ID = 'advisor';

function exactText(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 && value === value.trim()
    ? value
    : null;
}

function normalizedPath(value: string): string {
  return value.replaceAll('\\', '/').replace(/\/+$/u, '');
}

function splitFilePath(value: string): { dir: string; name: string } | null {
  const path = normalizedPath(value);
  const separator = path.lastIndexOf('/');
  if (separator < 0 || separator === path.length - 1) return null;
  const dir = path.slice(0, separator);
  const name = path.slice(separator + 1);
  return dir && name ? { dir, name } : null;
}

function manifestFromMeta(meta: unknown): MeetingFileVisibilityManifest | null {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return null;
  const value = (meta as Record<string, unknown>)[FILE_VISIBILITY_FIELD];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record['version'] !== 1) return null;
  if (!record['meetingSubject'] || typeof record['meetingSubject'] !== 'object')
    return null;
  if (!record['files'] || typeof record['files'] !== 'object' || Array.isArray(record['files']))
    return null;
  return value as MeetingFileVisibilityManifest;
}

function subjectKey(ref: MeetingVisibilitySubjectRef): string {
  return `${ref.kind}\u0000${ref.id}`;
}

/** Resolve a manifest subject through its exact in-manifest parent identity. */
export function decideMeetingFileVisibility(input: {
  readonly manifest: MeetingFileVisibilityManifest;
  readonly fileName: string;
  readonly context: MeetingFileVisibilityContext;
}): boolean {
  const subject = input.manifest.files[input.fileName];
  if (!subject) return false;
  const parentByRef = new Map<string, MeetingVisibilitySubject>([
    [subjectKey(input.manifest.meetingSubject), input.manifest.meetingSubject],
  ]);
  return resolveMeetingVisibility({
    subject,
    viewerId: input.context.viewerId,
    policies: input.context.policies,
    resolveParent: (ref) => parentByRef.get(subjectKey(ref)),
  }).visible;
}

/**
 * Classify one source from its exact sibling meeting.json manifest.  Directory
 * structure finds the manifest; the manifest's stable IDs make the decision.
 * No display label, timestamp, or folder-name pattern participates.
 */
export async function resolveMeetingFilePathVisibility(input: {
  readonly path: string;
  readonly workspace: MeetingVisibilityWorkspace;
  readonly context: MeetingFileVisibilityContext;
}): Promise<MeetingFileVisibilityResult> {
  const split = splitFilePath(input.path);
  if (!split) return { kind: 'not-meeting' };
  const meetingJsonPath =
    split.name === 'meeting.json'
      ? normalizedPath(input.path)
      : `${split.dir}/meeting.json`;

  if (input.workspace.exists) {
    let exists: boolean;
    try {
      exists = await input.workspace.exists(meetingJsonPath);
    } catch {
      return { kind: 'hidden' };
    }
    if (!exists) return { kind: 'not-meeting' };
  }

  let meta: unknown;
  try {
    meta = JSON.parse(await input.workspace.readFile(meetingJsonPath));
  } catch {
    // A file beside an unreadable meeting.json is meeting material whose
    // lineage cannot be proven.  Hide it rather than guessing.
    return { kind: 'hidden' };
  }
  const manifest = manifestFromMeta(meta);
  if (!manifest) return { kind: 'hidden' };
  return decideMeetingFileVisibility({
    manifest,
    fileName: split.name,
    context: input.context,
  })
    ? { kind: 'visible' }
    : { kind: 'hidden' };
}

/** Batch form used by search so viewer/policy state is read once per result set. */
export async function resolveMeetingFilePathsVisibility(input: {
  readonly paths: readonly string[];
  readonly workspace: MeetingVisibilityWorkspace;
  readonly context: MeetingFileVisibilityContext;
}): Promise<ReadonlyMap<string, MeetingFileVisibilityResult>> {
  const results = await Promise.all(
    [...new Set(input.paths)].map(async (path) => [
      path,
      await resolveMeetingFilePathVisibility({
        path,
        workspace: input.workspace,
        context: input.context,
      }),
    ] as const)
  );
  return new Map(results);
}

export function readCurrentMeetingViewerId(): string | null {
  const session = useFirmStore.getState().session;
  if (session) return exactText(session.userId);
  // Solo mode has no firm account.  Its long-standing canonical local owner is
  // `advisor` (also used by MatterHub), so the same person remains the owner on
  // their own synced devices without pretending a missing firm session exists.
  return LOCAL_ADVISOR_ID;
}

/** Read current viewer + persisted policies. Malformed policy data is retained
 * so the shared resolver can fail closed rather than silently dropping it. */
export async function readCurrentMeetingFileVisibilityContext(
  workspaceRoot: string | null | undefined
): Promise<MeetingFileVisibilityContext> {
  const records = await loadLiveCrmRecords(workspaceRoot).catch(() => []);
  const preferences = records.filter(
    (record) => record.kind === 'meeting_foundation_preferences'
  );
  const persisted: unknown[] = preferences.flatMap((record): unknown[] => {
    const value: unknown = record['visibilityPolicies'];
    return Array.isArray(value) ? (value as unknown[]) : [];
  });
  return {
    viewerId: readCurrentMeetingViewerId(),
    policies: [FILE_MEETING_OWNER_PRIVATE_POLICY, ...persisted],
  };
}

function randomMeetingSubjectId(): string {
  const id = globalThis.crypto.randomUUID();
  return `meeting-file:${id}`;
}

export function createMeetingFileVisibilityManifest(input: {
  readonly ownerRef: string;
  readonly visibilityPolicyId?: string;
  readonly meetingSubjectId?: string;
  readonly fileNames: readonly string[];
}): MeetingFileVisibilityManifest {
  const ownerRef = exactText(input.ownerRef);
  const visibilityPolicyId = exactText(
    input.visibilityPolicyId ?? FILE_MEETING_OWNER_PRIVATE_POLICY_ID
  );
  const meetingSubjectId = exactText(
    input.meetingSubjectId ?? randomMeetingSubjectId()
  );
  if (!ownerRef || !visibilityPolicyId || !meetingSubjectId)
    throw new Error('Meeting file visibility requires exact owner, policy, and meeting IDs.');
  const meetingSubject: RootMeetingVisibilitySubject = {
    id: meetingSubjectId,
    kind: 'meeting-note',
    lineage: 'root',
    ownerRef,
    visibilityPolicyId,
  };
  const files: Record<string, MeetingVisibilitySubject> = {};
  for (const rawName of input.fileNames) {
    const fileName = exactText(rawName);
    if (!fileName || fileName.includes('/') || fileName.includes('\\'))
      throw new Error('Meeting file visibility requires exact direct-child file names.');
    if (files[fileName]) throw new Error('Meeting file visibility file names must be unique.');
    files[fileName] = {
      id: `${meetingSubjectId}:file:${encodeURIComponent(fileName)}`,
      kind: 'file-reference',
      lineage: 'derived',
      parentRef: { id: meetingSubject.id, kind: meetingSubject.kind },
    };
  }
  return { version: 1, meetingSubject, files };
}

/**
 * Migration/import helper only. Callers must have already established that a
 * record genuinely predates meeting visibility; absence of a manifest is never
 * enough. Each legacy file is deliberately classified in its own right because
 * the shared resolver forbids derived data from inheriting the legacy escape.
 */
export function createLegacyUnrestrictedMeetingFileVisibilityManifest(input: {
  readonly meetingSubjectId: string;
  readonly fileNames: readonly string[];
}): MeetingFileVisibilityManifest {
  const meetingSubjectId = exactText(input.meetingSubjectId);
  if (!meetingSubjectId)
    throw new Error('Legacy meeting visibility requires an exact meeting ID.');
  const meetingSubject: MeetingVisibilitySubject = {
    id: meetingSubjectId,
    kind: 'meeting-note',
    lineage: 'legacy-unrestricted',
  };
  const files: Record<string, MeetingVisibilitySubject> = {};
  for (const rawName of input.fileNames) {
    const fileName = exactText(rawName);
    if (!fileName || fileName.includes('/') || fileName.includes('\\'))
      throw new Error('Legacy meeting visibility requires exact direct-child file names.');
    files[fileName] = {
      id: `${meetingSubjectId}:file:${encodeURIComponent(fileName)}`,
      kind: 'file-reference',
      lineage: 'legacy-unrestricted',
    };
  }
  return { version: 1, meetingSubject, files };
}

export function addMeetingFileVisibilityEntries(
  manifest: MeetingFileVisibilityManifest,
  fileNames: readonly string[]
): MeetingFileVisibilityManifest {
  const root = manifest.meetingSubject;
  if (root.kind !== 'meeting-note' || root.lineage !== 'root') return manifest;
  const files = { ...manifest.files };
  for (const rawName of fileNames) {
    const fileName = exactText(rawName);
    if (!fileName || fileName.includes('/') || fileName.includes('\\'))
      throw new Error('Meeting file visibility requires exact direct-child file names.');
    files[fileName] ??= {
      id: `${root.id}:file:${encodeURIComponent(fileName)}`,
      kind: 'file-reference',
      lineage: 'derived',
      parentRef: { id: root.id, kind: root.kind },
    };
  }
  return { ...manifest, files };
}

export function withMeetingFileVisibility<T extends object>(
  meta: T,
  manifest: MeetingFileVisibilityManifest
): T & { meetingFileVisibility: MeetingFileVisibilityManifest } {
  return Object.assign({}, meta, { meetingFileVisibility: manifest });
}

export function meetingFileVisibilityManifestFromMeta(
  meta: unknown
): MeetingFileVisibilityManifest | null {
  return manifestFromMeta(meta);
}
