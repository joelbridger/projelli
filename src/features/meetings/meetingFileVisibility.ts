import { useFirmStore } from '@/platform/firm/firmStore';
import {
  loadMeetingVisibilityPoliciesForFileAccess,
} from '@/platform/crm/useLiveCrmRecords';
import { useWorkspaceStore } from '@/platform/fs/workspaceStore';
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

/** Stable render/operation identity for the viewer and exact policy snapshot. */
function stableIdentityValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableIdentityValue);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, stableIdentityValue(nested)])
    );
  return value;
}

export function meetingFileVisibilityContextIdentity(
  context: MeetingFileVisibilityContext
): string {
  return JSON.stringify(
    stableIdentityValue([context.viewerId, context.policies])
  );
}

export interface MeetingVisibilityWorkspace {
  readFile(path: string): Promise<string>;
  writeFile?(path: string, content: string): Promise<void>;
  list?(path: string): Promise<
    readonly { name: string; path: string; type: 'file' | 'folder' }[]
  >;
  exists?(path: string): Promise<boolean>;
}

export type MeetingFileVisibilityResult =
  | { readonly kind: 'not-meeting' }
  | { readonly kind: 'visible' }
  | { readonly kind: 'hidden' };

export class MeetingFileVisibilityRevokedError extends Error {
  constructor() {
    super('Access to this meeting file changed. Nothing was sent or opened.');
    this.name = 'MeetingFileVisibilityRevokedError';
  }
}

export const FILE_MEETING_OWNER_PRIVATE_POLICY_ID =
  'meeting-file-visibility:owner-private';

export const FILE_MEETING_OWNER_PRIVATE_POLICY: MeetingVisibilityPolicy = {
  id: FILE_MEETING_OWNER_PRIVATE_POLICY_ID,
  mode: 'explicit-review',
  includedMemberIds: [],
  excludedMemberIds: [],
};

const FILE_VISIBILITY_FIELD = 'meetingFileVisibility';
const MEETING_VISIBILITY_MIGRATION_PATH =
  '.lantern/migrations/meeting-file-visibility-v1.json';

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
  /** Durable index provenance. A source once stamped as meeting-derived stays
   * protected even after its manifest is deleted or moved. */
  readonly knownMeetingDerived?: boolean;
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
    if (!exists)
      return input.knownMeetingDerived
        ? { kind: 'hidden' }
        : { kind: 'not-meeting' };
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
  readonly meetingDerivedPaths?: ReadonlySet<string>;
}): Promise<ReadonlyMap<string, MeetingFileVisibilityResult>> {
  const results = await Promise.all(
    [...new Set(input.paths)].map(async (path) => [
      path,
      await resolveMeetingFilePathVisibility({
        path,
        workspace: input.workspace,
        context: input.context,
        knownMeetingDerived: input.meetingDerivedPaths?.has(path) ?? false,
      }),
    ] as const)
  );
  return new Map(results);
}

export function readCurrentMeetingViewerId(): string | null {
  const session = useFirmStore.getState().session;
  return session ? exactText(session.userId) : null;
}

/** Read current viewer + persisted policies. Malformed policy data is retained
 * so the shared resolver can fail closed rather than silently dropping it. */
export async function readCurrentMeetingFileVisibilityContext(
  workspaceRoot: string | null | undefined
): Promise<MeetingFileVisibilityContext> {
  const persisted = workspaceRoot
    ? await loadMeetingVisibilityPoliciesForFileAccess(workspaceRoot).catch(
        () => []
      )
    : [];
  return {
    viewerId: readCurrentMeetingViewerId(),
    policies: [FILE_MEETING_OWNER_PRIVATE_POLICY, ...persisted],
  };
}

function requireCurrentWorkspace(
  workspaceRoot: string,
  workspaceGeneration: number
): void {
  const current = useWorkspaceStore.getState();
  if (
    current.rootGeneration !== workspaceGeneration ||
    normalizedPath(current.rootPath ?? '') !== normalizedPath(workspaceRoot)
  ) {
    throw new MeetingFileVisibilityRevokedError();
  }
}

/**
 * Re-authorize one exact meeting file at the last safe moment before a caller
 * reads, renders, attaches, or sends it. The file manifest is read first; then
 * the current viewer and persisted policies are loaded. No awaited work occurs
 * after the final workspace check and visibility decision, so callers cannot
 * accidentally rely on the viewer or policy snapshot from when a panel opened.
 */
export async function requireCurrentMeetingFileAccess(input: {
  readonly path: string;
  readonly workspace: MeetingVisibilityWorkspace;
  readonly workspaceRoot: string;
  readonly workspaceGeneration: number;
  /** Refuse a held action after the viewer or policy snapshot changes, even
   * when both the old and new viewer would otherwise be allowed. */
  readonly expectedVisibilityIdentity?: string;
}): Promise<void> {
  requireCurrentWorkspace(input.workspaceRoot, input.workspaceGeneration);
  const split = splitFilePath(input.path);
  if (!split) throw new MeetingFileVisibilityRevokedError();
  const meetingJsonPath =
    split.name === 'meeting.json'
      ? normalizedPath(input.path)
      : `${split.dir}/meeting.json`;

  let manifest: MeetingFileVisibilityManifest | null = null;
  try {
    manifest = manifestFromMeta(
      JSON.parse(await input.workspace.readFile(meetingJsonPath))
    );
  } catch {
    throw new MeetingFileVisibilityRevokedError();
  }
  const context = await readCurrentMeetingFileVisibilityContext(
    input.workspaceRoot
  );
  requireCurrentWorkspace(input.workspaceRoot, input.workspaceGeneration);
  if (
    (input.expectedVisibilityIdentity !== undefined &&
      meetingFileVisibilityContextIdentity(context) !==
        input.expectedVisibilityIdentity) ||
    !manifest ||
    !decideMeetingFileVisibility({
      manifest,
      fileName: split.name,
      context,
    })
  ) {
    throw new MeetingFileVisibilityRevokedError();
  }
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

/** New meeting material created while the product is in accountless solo mode.
 * It is explicit and unrestricted because no coworker identity system exists;
 * it must never be represented by a made-up user ID. */
export function createAccountlessUnrestrictedMeetingFileVisibilityManifest(input: {
  readonly meetingSubjectId?: string;
  readonly fileNames: readonly string[];
}): MeetingFileVisibilityManifest {
  const meetingSubjectId = exactText(
    input.meetingSubjectId ?? randomMeetingSubjectId()
  );
  if (!meetingSubjectId)
    throw new Error('Accountless meeting visibility requires an exact meeting ID.');
  const meetingSubject: MeetingVisibilitySubject = {
    id: meetingSubjectId,
    kind: 'meeting-note',
    lineage: 'accountless-unrestricted',
  };
  const files: Record<string, MeetingVisibilitySubject> = {};
  for (const rawName of input.fileNames) {
    const fileName = exactText(rawName);
    if (!fileName || fileName.includes('/') || fileName.includes('\\'))
      throw new Error('Accountless meeting visibility requires exact direct-child file names.');
    files[fileName] = {
      id: `${meetingSubjectId}:file:${encodeURIComponent(fileName)}`,
      kind: 'file-reference',
      lineage: 'accountless-unrestricted',
    };
  }
  return { version: 1, meetingSubject, files };
}

export function addMeetingFileVisibilityEntries(
  manifest: MeetingFileVisibilityManifest,
  fileNames: readonly string[]
): MeetingFileVisibilityManifest {
  const root = manifest.meetingSubject;
  if (
    root.kind !== 'meeting-note' ||
    (root.lineage !== 'root' && root.lineage !== 'accountless-unrestricted')
  )
    return manifest;
  const files = { ...manifest.files };
  for (const rawName of fileNames) {
    const fileName = exactText(rawName);
    if (!fileName || fileName.includes('/') || fileName.includes('\\'))
      throw new Error('Meeting file visibility requires exact direct-child file names.');
    files[fileName] ??=
      root.lineage === 'root'
        ? {
            id: `${root.id}:file:${encodeURIComponent(fileName)}`,
            kind: 'file-reference',
            lineage: 'derived',
            parentRef: { id: root.id, kind: root.kind },
          }
        : {
            id: `${root.id}:file:${encodeURIComponent(fileName)}`,
            kind: 'file-reference',
            lineage: 'accountless-unrestricted',
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

interface MeetingFileVisibilityMigrationState {
  readonly version: 1;
  readonly completedMatterIds: readonly string[];
  readonly ambiguousMeetingDirs: readonly string[];
}

export interface MeetingFileVisibilityMigrationResult {
  readonly kind: 'already-complete' | 'completed';
  readonly migrated: number;
  readonly ambiguousMeetingDirs: readonly string[];
}

let migrationQueue: Promise<void> = Promise.resolve();

async function readMigrationState(
  workspace: MeetingVisibilityWorkspace
): Promise<MeetingFileVisibilityMigrationState> {
  try {
    const parsed: unknown = JSON.parse(
      await workspace.readFile(MEETING_VISIBILITY_MIGRATION_PATH)
    );
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      throw new Error('invalid migration state');
    const record = parsed as Record<string, unknown>;
    if (
      record['version'] !== 1 ||
      !Array.isArray(record['completedMatterIds']) ||
      !Array.isArray(record['ambiguousMeetingDirs'])
    )
      throw new Error('invalid migration state');
    const completedMatterIds = record['completedMatterIds'].filter(
      (value): value is string => exactText(value) !== null
    );
    const ambiguousMeetingDirs = record['ambiguousMeetingDirs'].filter(
      (value): value is string => exactText(value) !== null
    );
    return { version: 1, completedMatterIds, ambiguousMeetingDirs };
  } catch {
    return { version: 1, completedMatterIds: [], ambiguousMeetingDirs: [] };
  }
}

/**
 * Versioned, crash-safe migration for one exact client parent. The sealed
 * client boundary supplies both identities: `matterId` and its mapped folder.
 * A child is migrated only when its own meeting.json repeats that exact matter
 * ID. Malformed/mismatched children remain hidden and are recorded as residuals.
 * The matter completion sentinel is written only after every eligible manifest
 * write succeeds; a crash therefore retries safely and never blesses a partial
 * migration.
 */
export async function migrateLegacyMeetingFileVisibility(input: {
  readonly matterId: string;
  readonly matterFolder: string;
  readonly workspace: MeetingVisibilityWorkspace;
}): Promise<MeetingFileVisibilityMigrationResult> {
  const matterId = exactText(input.matterId);
  const matterFolder = exactText(input.matterFolder);
  if (!matterId || !matterFolder || !input.workspace.list || !input.workspace.writeFile)
    throw new Error('Meeting visibility migration requires an exact client parent and writable workspace.');

  let release: (() => void) | undefined;
  const prior = migrationQueue;
  migrationQueue = new Promise<void>((resolve) => {
    release = resolve;
  });
  await prior.catch(() => undefined);
  try {
    const state = await readMigrationState(input.workspace);
    if (state.completedMatterIds.includes(matterId)) {
      return {
        kind: 'already-complete',
        migrated: 0,
        ambiguousMeetingDirs: state.ambiguousMeetingDirs,
      };
    }

    const meetingsPath = `${matterFolder}/Meetings`;
    let entries: readonly {
      name: string;
      path: string;
      type: 'file' | 'folder';
    }[] = [];
    try {
      if (input.workspace.exists && !(await input.workspace.exists(meetingsPath))) {
        entries = [];
      } else {
        let lastError: unknown;
        for (let attempt = 0; attempt < 3; attempt += 1) {
          try {
            entries = await input.workspace.list(meetingsPath);
            lastError = undefined;
            break;
          } catch (error) {
            lastError = error;
          }
        }
        if (lastError) {
          throw lastError instanceof Error
            ? lastError
            : new Error('Meeting visibility scan failed.');
        }
      }
    } catch {
      // A transient scan failure cannot be committed as a completed migration.
      throw new Error('Meeting visibility migration could not scan the client meetings folder.');
    }

    let migrated = 0;
    const ambiguous = new Set(state.ambiguousMeetingDirs);
    for (const entry of entries) {
      if (entry.type !== 'folder') continue;
      const metaPath = `${entry.path}/meeting.json`;
      let raw: string;
      let meta: Record<string, unknown>;
      try {
        raw = await input.workspace.readFile(metaPath);
        const parsed: unknown = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
          throw new Error('invalid meeting metadata');
        meta = parsed as Record<string, unknown>;
      } catch {
        ambiguous.add(entry.path);
        continue;
      }
      if (manifestFromMeta(meta)) continue;
      if (exactText(meta['matterId']) !== matterId) {
        ambiguous.add(entry.path);
        continue;
      }
      let children: readonly {
        name: string;
        path: string;
        type: 'file' | 'folder';
      }[];
      try {
        children = await input.workspace.list(entry.path);
      } catch {
        ambiguous.add(entry.path);
        continue;
      }
      const fileNames = children
        .filter((child) => child.type === 'file')
        .map((child) => child.name);
      if (!fileNames.includes('meeting.json')) fileNames.push('meeting.json');
      const manifest = createLegacyUnrestrictedMeetingFileVisibilityManifest({
        meetingSubjectId: randomMeetingSubjectId(),
        fileNames,
      });
      await input.workspace.writeFile(
        metaPath,
        JSON.stringify(withMeetingFileVisibility(meta, manifest), null, 2)
      );
      migrated += 1;
    }

    const next: MeetingFileVisibilityMigrationState = {
      version: 1,
      completedMatterIds: [...new Set([...state.completedMatterIds, matterId])],
      ambiguousMeetingDirs: [...ambiguous],
    };
    await input.workspace.writeFile(
      MEETING_VISIBILITY_MIGRATION_PATH,
      JSON.stringify(next, null, 2)
    );
    return {
      kind: 'completed',
      migrated,
      ambiguousMeetingDirs: [...ambiguous],
    };
  } finally {
    release?.();
  }
}
