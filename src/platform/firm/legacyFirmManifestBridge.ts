/**
 * One-time device-side bridge from readable legacy firm IDs to v2 opaque
 * handles. The manifest is read-only until acknowledgement, so the local
 * checkpoints below make a power loss safe: a later run can simply continue.
 */
import * as Y from 'yjs';
import type { Matter } from '@/platform/types/matter';
import { useMatterStore } from '@/platform/matter/matterStore';
import type { FirmApiClient } from './FirmApiClient';
import { parseMatterHandle, parseStreamHandle, type LegacyMigrationManifestMatter, type MatterHandle, type StreamHandle } from './contract';
import { encryptUpdateV2, importMatterKey } from './matterCrypto';
import { writeFirmMatterPrivateIndex } from './firmMatterPrivateIndex';
import { clearMatterKey, loadMatterKey, storeMatterKey } from './firmKeychain';

const PLACEHOLDER_NAME = 'Shared client';
const UNMATCHED_NOTICE = 'A shared client was not found on this device, so it remains local only.';

type BridgeClient = Pick<FirmApiClient, 'migrationManifest' | 'migrationComplete' | 'pushUpdate'>;

export interface LegacyFirmManifestBridgeOptions {
  client: BridgeClient;
  seatToken: string;
  /** Read from device-local persisted matter state. */
  getMatters: () => Matter[];
  /** Must durably save the supplied matter before this function proceeds. */
  saveMatter: (matter: Matter) => void | Promise<void>;
  /** Create a generic local record for an authorized row this device lacks. */
  createPlaceholder: (linkage: { matterHandle: MatterHandle; rootStreamHandle: StreamHandle }) => void | Promise<void>;
  /**
   * Match a legacy document ID from the manifest to a device-local logical
   * document ID. The default is identity because historic clients used that
   * same local identifier; custom stores can return null for a missing file.
   */
  localDocumentIdForLegacyId?: (matter: Matter, legacyDocumentId: string) => string | null;
  loadLegacyMatterKey?: (legacyMatterId: string) => Promise<string | null>;
  storeOpaqueMatterKey?: (matterHandle: MatterHandle, key: string) => Promise<void>;
  clearLegacyMatterKey?: (legacyMatterId: string) => Promise<void>;
}

export interface LegacyFirmManifestBridgeResult {
  status: 'noop' | 'completed';
  migratedMatterIds: string[];
  placeholderCount: number;
  notices: string[];
}

function isLegacyFirmId(value: string | undefined): value is string {
  return typeof value === 'string' && !value.startsWith('mh2_');
}

function legacyIdFor(matter: Matter): string | null {
  // Once the opaque link is saved, the legacy value moves to this device-only
  // checkpoint. It stays until the server accepts migration_complete.
  if (matter.legacyFirmMatterId) return matter.legacyFirmMatterId;
  return isLegacyFirmId(matter.firmMatterId) ? matter.firmMatterId : null;
}

function streamMapFor(
  matter: Matter,
  row: LegacyMigrationManifestMatter,
  localDocumentIdForLegacyId: NonNullable<LegacyFirmManifestBridgeOptions['localDocumentIdForLegacyId']>,
): Record<string, { streamHandle: StreamHandle; kind: 'notes' | 'document' }> {
  const rootStreamHandle = parseStreamHandle(row.root_stream_handle);
  const streams: Record<string, { streamHandle: StreamHandle; kind: 'notes' | 'document' }> = {
    _notes: { streamHandle: rootStreamHandle, kind: 'notes' },
  };
  for (const [legacyDocumentId, streamHandle] of Object.entries(row.streams)) {
    if (legacyDocumentId === '_notes') continue;
    const localDocumentId = localDocumentIdForLegacyId(matter, legacyDocumentId);
    if (!localDocumentId) continue;
    streams[localDocumentId] = { streamHandle: parseStreamHandle(streamHandle), kind: 'document' };
  }
  return streams;
}

function withOpaqueLink(matter: Matter, row: LegacyMigrationManifestMatter, legacyMatterId: string): Matter {
  const matterHandle = parseMatterHandle(row.matter_handle);
  const rootStreamHandle = parseStreamHandle(row.root_stream_handle);
  const alreadyLinked = matter.firmMatterId === matterHandle && matter.rootStreamHandle === rootStreamHandle;
  return {
    ...matter,
    firmMatterId: matterHandle,
    rootStreamHandle,
    shared: true,
    legacyFirmMatterId: legacyMatterId,
    // A changed server mapping must always be sealed again. This never trusts a
    // stale checkpoint to point a private index at a different opaque stream.
    firmMigrationSealed: alreadyLinked ? matter.firmMigrationSealed === true : false,
  };
}

function stripLegacyLink(matter: Matter): Matter {
  const {
    firmMatterId: _firmMatterId,
    rootStreamHandle: _rootStreamHandle,
    orgId: _orgId,
    role: _role,
    shared: _shared,
    legacyFirmMatterId: _legacyFirmMatterId,
    firmMigrationSealed: _firmMigrationSealed,
    ...localOnly
  } = matter;
  return { ...localOnly, shared: false };
}

function clearBridgeCheckpoint(matter: Matter): Matter {
  const { legacyFirmMatterId: _legacyFirmMatterId, firmMigrationSealed: _firmMigrationSealed, ...complete } = matter;
  return complete;
}

function blobId(): string {
  return crypto.randomUUID();
}

/**
 * Fetch, seal, and acknowledge the bridge. This intentionally has no server
 * input besides the two fixed empty-body endpoints and the normal opaque
 * stream-update request. It sends neither legacy nor local identifiers.
 */
export async function runLegacyFirmManifestBridge(
  options: LegacyFirmManifestBridgeOptions,
): Promise<LegacyFirmManifestBridgeResult> {
  const candidates = options.getMatters().filter((matter) => legacyIdFor(matter) !== null);
  if (candidates.length === 0) {
    return { status: 'noop', migratedMatterIds: [], placeholderCount: 0, notices: [] };
  }

  const manifest = await options.client.migrationManifest();
  const byLegacyId = new Map(manifest.matters.map((row) => [row.legacy_matter_id, row]));
  const matchedLegacyIds = new Set<string>();
  const migratedMatterIds: string[] = [];
  const notices: string[] = [];
  const localDocumentIdForLegacyId = options.localDocumentIdForLegacyId ?? ((_matter, legacyDocumentId) => legacyDocumentId);
  const loadLegacyMatterKey = options.loadLegacyMatterKey ?? loadMatterKey;
  const storeOpaqueMatterKey = options.storeOpaqueMatterKey ?? storeMatterKey;
  const clearLegacyMatterKey = options.clearLegacyMatterKey ?? clearMatterKey;
  const sealedLegacyIds: string[] = [];

  for (const candidate of candidates) {
    const legacyMatterId = legacyIdFor(candidate);
    if (!legacyMatterId) continue;
    const row = byLegacyId.get(legacyMatterId);
    if (!row) {
      await options.saveMatter(stripLegacyLink(candidate));
      notices.push(UNMATCHED_NOTICE);
      continue;
    }
    matchedLegacyIds.add(legacyMatterId);
    const linked = withOpaqueLink(candidate, row, legacyMatterId);

    // This is the critical durability point: the opaque association is saved
    // before root sealing and before acknowledgement. The retained local
    // checkpoint makes the next run resume from exactly here.
    if (linked !== candidate) await options.saveMatter(linked);
    if (linked.firmMigrationSealed) {
      sealedLegacyIds.push(legacyMatterId);
      migratedMatterIds.push(linked.id);
      continue;
    }

    const keyB64 = await loadLegacyMatterKey(legacyMatterId);
    if (!keyB64) throw new Error('This shared client is waiting for a local encryption key before migration can finish.');
    const matterHandle = parseMatterHandle(row.matter_handle);
    const rootStreamHandle = parseStreamHandle(row.root_stream_handle);
    await storeOpaqueMatterKey(matterHandle, keyB64);

    const root = new Y.Doc();
    writeFirmMatterPrivateIndex(root, {
      version: 1,
      clientName: linked.client,
      displayName: linked.name,
      streams: streamMapFor(linked, row, localDocumentIdForLegacyId),
    });
    const key = await importMatterKey(keyB64);
    const ciphertext = await encryptUpdateV2(key, Y.encodeStateAsUpdate(root), {
      matterHandle,
      streamHandle: rootStreamHandle,
      keyEpoch: 1,
    });
    await options.client.pushUpdate(rootStreamHandle, blobId(), ciphertext, options.seatToken, 1);

    await options.saveMatter({ ...linked, firmMigrationSealed: true });
    sealedLegacyIds.push(legacyMatterId);
    migratedMatterIds.push(linked.id);
  }

  let placeholderCount = 0;
  const locallyLinkedHandles = new Set(options.getMatters().map((matter) => matter.firmMatterId).filter(Boolean));
  for (const row of manifest.matters) {
    if (matchedLegacyIds.has(row.legacy_matter_id) || locallyLinkedHandles.has(row.matter_handle)) continue;
    await options.createPlaceholder({
      matterHandle: parseMatterHandle(row.matter_handle),
      rootStreamHandle: parseStreamHandle(row.root_stream_handle),
    });
    placeholderCount++;
  }

  // Every matched record is either sealed in this run or had its accepted
  // checkpoint from an earlier crashed run. Only now may the manifest be acked.
  await options.client.migrationComplete();
  for (const candidate of options.getMatters()) {
    const legacyMatterId = candidate.legacyFirmMatterId;
    if (!legacyMatterId || !sealedLegacyIds.includes(legacyMatterId)) continue;
    await options.saveMatter(clearBridgeCheckpoint(candidate));
    await clearLegacyMatterKey(legacyMatterId);
  }
  return { status: 'completed', migratedMatterIds, placeholderCount, notices };
}

/** Real-app adapter. The bridge state is saved through the normal persisted matter store. */
export async function runLegacyFirmManifestBridgeFromMatterStore(
  client: FirmApiClient,
  seatToken: string,
): Promise<LegacyFirmManifestBridgeResult> {
  // Firm token hydration can finish before the workspace-scoped matter store.
  // Waiting here prevents an early empty read from incorrectly becoming a
  // permanent no-op on a device that really does have a legacy link.
  if (!useMatterStore.persist.hasHydrated()) {
    await new Promise<void>((resolve) => {
      const stop = useMatterStore.persist.onFinishHydration(() => {
        stop();
        resolve();
      });
    });
  }
  return runLegacyFirmManifestBridge({
    client,
    seatToken,
    getMatters: () => useMatterStore.getState().matters,
    saveMatter: (matter) => useMatterStore.getState().replaceMatterFromLegacyFirmBridge(matter),
    createPlaceholder: ({ matterHandle, rootStreamHandle }) => {
      useMatterStore.getState().createMatter({
        name: PLACEHOLDER_NAME,
        client: PLACEHOLDER_NAME,
        shared: true,
        firmMatterId: matterHandle,
        rootStreamHandle,
        sharedDetailsPending: true,
      });
    },
  });
}
