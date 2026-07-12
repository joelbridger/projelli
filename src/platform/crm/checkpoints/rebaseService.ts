import {
  openCheckpointPayload,
  sealCheckpointPayload,
} from './checkpointCrypto';
import type {
  CheckpointPackage,
  DeviceRetentionState,
  EncryptedRebaseExport,
  OrgDeviceRetentionRecord,
  UnsentLocalEdit,
} from './types';

function asBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

function parseExport(bytes: Uint8Array): UnsentLocalEdit[] | null {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    return Array.isArray(parsed) ? (parsed as UnsentLocalEdit[]) : null;
  } catch {
    return null;
  }
}

/** Export old writes for human review. This intentionally never applies them. */
export async function exportUnsentEditsForRebase(input: {
  orgId: string;
  deviceId: string;
  edits: ReadonlyArray<UnsentLocalEdit>;
  exportKey: CryptoKey;
  keyEpoch: number;
  exportedAt?: string;
}): Promise<EncryptedRebaseExport> {
  return {
    version: 1,
    orgId: input.orgId,
    deviceId: input.deviceId,
    exportedAt: input.exportedAt ?? new Date().toISOString(),
    keyEpoch: input.keyEpoch,
    ciphertextB64: await sealCheckpointPayload(
      input.exportKey,
      asBytes(input.edits),
      input.keyEpoch
    ),
  };
}

export async function openRebaseExport(
  exported: EncryptedRebaseExport,
  exportKey: CryptoKey
): Promise<ReadonlyArray<UnsentLocalEdit> | null> {
  const plaintext = await openCheckpointPayload(
    exportKey,
    exported.ciphertextB64,
    exported.keyEpoch
  );
  return plaintext ? parseExport(plaintext) : null;
}

export interface RebaseDependencies {
  discardStaleState(orgId: string, deviceId: string): Promise<void>;
  loadValidatedCheckpoint(orgId: string): Promise<CheckpointPackage>;
  /** User-approved exports become NEW current-epoch operations only. */
  replayApprovedEdit(
    edit: UnsentLocalEdit,
    currentKeyEpoch: number
  ): Promise<void>;
}

export async function retireAndRebaseDevice(input: {
  orgId: string;
  deviceId: string;
  localEdits: ReadonlyArray<UnsentLocalEdit>;
  exportKey: CryptoKey;
  exportKeyEpoch: number;
  currentKeyEpoch: number;
  approvedEditIds: ReadonlySet<string>;
  dependencies: RebaseDependencies;
}): Promise<{ exportFile: EncryptedRebaseExport; replayedEditIds: string[] }> {
  const exportFile = await exportUnsentEditsForRebase({
    orgId: input.orgId,
    deviceId: input.deviceId,
    edits: input.localEdits,
    exportKey: input.exportKey,
    keyEpoch: input.exportKeyEpoch,
  });
  // The order is binding: old state is discarded, then a validated base loads.
  await input.dependencies.discardStaleState(input.orgId, input.deviceId);
  await input.dependencies.loadValidatedCheckpoint(input.orgId);
  const replayedEditIds: string[] = [];
  for (const edit of input.localEdits) {
    if (!input.approvedEditIds.has(edit.editId)) continue;
    await input.dependencies.replayApprovedEdit(edit, input.currentKeyEpoch);
    replayedEditIds.push(edit.editId);
  }
  return { exportFile, replayedEditIds };
}

/** Tombstones stay in a validated checkpoint until every org device is current or explicitly retired. */
export function canRemoveTombstoneAfterRetirement(input: {
  orgId: string;
  tombstoneCheckpointGeneration: number;
  devices: ReadonlyArray<OrgDeviceRetentionRecord>;
}): boolean {
  return input.devices
    .filter((device) => device.orgId === input.orgId)
    .every((device) =>
      isSafeForTombstoneRemoval(
        device.state,
        input.tombstoneCheckpointGeneration
      )
    );
}

function isSafeForTombstoneRemoval(
  state: DeviceRetentionState,
  generation: number
): boolean {
  return (
    state.status === 'retired' ||
    (state.status === 'current' && state.checkpointGeneration >= generation)
  );
}
