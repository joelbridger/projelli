/**
 * B9 checkpoint contracts.
 *
 * Checkpoint wire shapes deliberately stay narrow: their stream identifiers
 * preserve B1's `matter_id` wire name and carry no decrypted CRM records.
 */

/** A relay position which is safe to use as a checkpoint base. */
export interface CheckpointFrontier {
  /** Last contiguous authenticated relay row included in this state. */
  cursor: number;
}

export interface CheckpointStream {
  orgId: string;
  /** Internal identifier is intentionally preserved. */
  matter_id: string;
  docId: string;
}

export interface CheckpointManifestBody {
  version: 1;
  stream: CheckpointStream;
  frontier: CheckpointFrontier;
  stateVectorB64: string;
  canonicalStateHashB64: string;
  chunkHashesB64: string[];
  keyEpoch: number;
  generation: number;
  createdAt: string;
}

export interface SignedCheckpointManifest extends CheckpointManifestBody {
  signerDeviceId: string;
  signatureB64: string;
}

export interface CheckpointChunk {
  index: number;
  /** AES-GCM ciphertext, base64 encoded for transport. */
  ciphertextB64: string;
}

/** What crosses the relay boundary. Content remains encrypted. */
export interface CheckpointPackage {
  /** B2-PENDING: must map one-for-one to relay checkpoint control metadata. */
  control: {
    stream: CheckpointStream;
    generation: number;
    frontier: CheckpointFrontier;
    retentionEligible: boolean;
  };
  /** Signed manifest encrypted with the stream content key. */
  encryptedManifestB64: string;
  chunks: CheckpointChunk[];
}

export interface CheckpointSigner {
  deviceId: string;
  sign(payload: Uint8Array): Promise<string>;
}

export interface CheckpointVerifier {
  verify(
    deviceId: string,
    payload: Uint8Array,
    signatureB64: string
  ): Promise<boolean>;
}

/** An opaque relay row, only opened locally using the stream key. */
export interface RetainedRawRow {
  cursor: number;
  ciphertextB64: string;
  keyEpoch: number;
}

export interface ValidationReceipt {
  version: 1;
  orgId: string;
  stream: CheckpointStream;
  generation: number;
  frontier: CheckpointFrontier;
  manifestHashB64: string;
  validatorDeviceId: string;
  validatedAt: string;
  signatureB64: string;
}

export type CheckpointValidationResult =
  | { ok: true; receipt: ValidationReceipt }
  | {
      ok: false;
      repairAlert: {
        code:
          | 'manifest_invalid'
          | 'chunk_corrupt'
          | 'prior_checkpoint_invalid'
          | 'missing_raw_row'
          | 'raw_row_invalid'
          | 'state_mismatch';
        detail: string;
      };
    };

export interface RelayCheckpointControlMetadata {
  /** B2-PENDING: control metadata is plaintext by design, never content. */
  retentionEligible: boolean;
  archived: boolean;
  validationReceipts: ReadonlyArray<
    Pick<ValidationReceipt, 'validatorDeviceId' | 'signatureB64'>
  >;
}

export interface UnsentLocalEdit {
  editId: string;
  matter_id: string;
  docId: string;
  /** The old encrypted CRDT operation. It must never be merged directly. */
  ciphertextB64: string;
  keyEpoch: number;
}

export interface EncryptedRebaseExport {
  version: 1;
  orgId: string;
  deviceId: string;
  exportedAt: string;
  keyEpoch: number;
  ciphertextB64: string;
}

export type DeviceRetentionState =
  | { status: 'current'; checkpointGeneration: number }
  | { status: 'retirement_required' }
  | { status: 'retired' };

export interface OrgDeviceRetentionRecord {
  orgId: string;
  deviceId: string;
  state: DeviceRetentionState;
}
