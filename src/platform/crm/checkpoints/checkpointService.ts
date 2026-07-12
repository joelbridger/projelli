import * as Y from 'yjs';
import {
  b64ToBytes,
  bytesToB64,
  openCheckpointPayload,
  sealCheckpointPayload,
  sha256B64,
} from './checkpointCrypto';
import type {
  CheckpointFrontier,
  CheckpointManifestBody,
  CheckpointPackage,
  CheckpointSigner,
  CheckpointStream,
  CheckpointValidationResult,
  CheckpointVerifier,
  RetainedRawRow,
  SignedCheckpointManifest,
  ValidationReceipt,
} from './types';

/** Ciphertext, before base64 transport encoding, may never exceed this size. */
export const MAX_CHECKPOINT_CIPHERTEXT_BYTES = 768 * 1024;
const AES_GCM_OVERHEAD_BYTES = 1 + 12 + 16;
const MAX_CHECKPOINT_PLAINTEXT_CHUNK_BYTES =
  MAX_CHECKPOINT_CIPHERTEXT_BYTES - AES_GCM_OVERHEAD_BYTES;

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(',')}}`;
}

function bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function parseJson(value: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(value)) as unknown;
  } catch {
    return null;
  }
}

function manifestPayload(manifest: CheckpointManifestBody): Uint8Array {
  return bytes(stableJson(manifest));
}

function signedManifestPayload(manifest: SignedCheckpointManifest): Uint8Array {
  const {
    signatureB64: _signature,
    signerDeviceId: _signer,
    ...body
  } = manifest;
  return manifestPayload(body);
}

function sameStream(left: CheckpointStream, right: CheckpointStream): boolean {
  return (
    left.orgId === right.orgId &&
    left.matter_id === right.matter_id &&
    left.docId === right.docId
  );
}

async function canonicalStateHash(doc: Y.Doc): Promise<string> {
  return sha256B64(Y.encodeStateAsUpdate(doc));
}

function checkpointAlert(
  code: Extract<
    CheckpointValidationResult,
    { ok: false }
  >['repairAlert']['code'],
  detail: string
): CheckpointValidationResult {
  return { ok: false, repairAlert: { code, detail } };
}

export interface CreateCheckpointInput {
  stream: CheckpointStream;
  frontier: CheckpointFrontier;
  keyEpoch: number;
  generation: number;
  doc: Y.Doc;
  contentKey: CryptoKey;
  signer: CheckpointSigner;
  retentionEligible: boolean;
  createdAt?: string;
}

/**
 * Encrypt chunks first, then encrypt the signed manifest. A caller must upload
 * the chunks before atomically publishing this package's manifest/control data.
 */
export async function createCheckpoint(
  input: CreateCheckpointInput
): Promise<CheckpointPackage> {
  const snapshot = Y.encodeStateAsUpdate(input.doc);
  const chunks: CheckpointPackage['chunks'] = [];
  const chunkHashesB64: string[] = [];

  for (
    let offset = 0, index = 0;
    offset < snapshot.length || (snapshot.length === 0 && index === 0);
    index += 1
  ) {
    const end = Math.min(
      snapshot.length,
      offset + MAX_CHECKPOINT_PLAINTEXT_CHUNK_BYTES
    );
    const plaintext = snapshot.subarray(offset, end);
    const ciphertextB64 = await sealCheckpointPayload(
      input.contentKey,
      plaintext,
      input.keyEpoch
    );
    if (
      b64ToBytes(ciphertextB64).byteLength > MAX_CHECKPOINT_CIPHERTEXT_BYTES
    ) {
      throw new Error(
        'Checkpoint chunk exceeded the 768 KiB ciphertext limit.'
      );
    }
    chunks.push({ index, ciphertextB64 });
    chunkHashesB64.push(await sha256B64(b64ToBytes(ciphertextB64)));
    offset = end;
    if (snapshot.length === 0) break;
  }

  const body: CheckpointManifestBody = {
    version: 1,
    stream: input.stream,
    frontier: input.frontier,
    stateVectorB64: bytesToB64(Y.encodeStateVector(input.doc)),
    canonicalStateHashB64: await canonicalStateHash(input.doc),
    chunkHashesB64,
    keyEpoch: input.keyEpoch,
    generation: input.generation,
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
  const signatureB64 = await input.signer.sign(manifestPayload(body));
  const manifest: SignedCheckpointManifest = {
    ...body,
    signerDeviceId: input.signer.deviceId,
    signatureB64,
  };
  const encryptedManifestB64 = await sealCheckpointPayload(
    input.contentKey,
    bytes(stableJson(manifest)),
    input.keyEpoch
  );

  return {
    control: {
      stream: input.stream,
      generation: input.generation,
      frontier: input.frontier,
      retentionEligible: input.retentionEligible,
    },
    encryptedManifestB64,
    chunks,
  };
}

export interface LoadCheckpointResult {
  manifest: SignedCheckpointManifest;
  doc: Y.Doc;
}

function isLoadCheckpointResult(
  value: LoadCheckpointResult | CheckpointValidationResult
): value is LoadCheckpointResult {
  return 'manifest' in value && 'doc' in value;
}

/** Opens and validates a checkpoint locally. Relay control metadata is never trusted as content. */
export async function loadCheckpoint(
  checkpoint: CheckpointPackage,
  contentKey: CryptoKey,
  keyEpoch: number,
  verifier: CheckpointVerifier
): Promise<LoadCheckpointResult | CheckpointValidationResult> {
  return loadCheckpointAtEpoch(checkpoint, contentKey, keyEpoch, verifier);
}

async function loadCheckpointAtEpoch(
  checkpoint: CheckpointPackage,
  contentKey: CryptoKey,
  keyEpoch: number,
  verifier: CheckpointVerifier
): Promise<LoadCheckpointResult | CheckpointValidationResult> {
  const manifestBytes = await openCheckpointPayload(
    contentKey,
    checkpoint.encryptedManifestB64,
    keyEpoch
  );
  const manifest = manifestBytes
    ? (parseJson(manifestBytes) as SignedCheckpointManifest | null)
    : null;
  if (
    !manifest ||
    manifest.keyEpoch !== keyEpoch ||
    !sameStream(manifest.stream, checkpoint.control.stream) ||
    manifest.generation !== checkpoint.control.generation ||
    manifest.frontier.cursor !== checkpoint.control.frontier.cursor
  ) {
    return checkpointAlert(
      'manifest_invalid',
      'Checkpoint manifest is malformed or disagrees with relay control metadata.'
    );
  }
  if (
    !(await verifier.verify(
      manifest.signerDeviceId,
      signedManifestPayload(manifest),
      manifest.signatureB64
    ))
  ) {
    return checkpointAlert(
      'manifest_invalid',
      'Checkpoint manifest signature is invalid.'
    );
  }
  if (manifest.chunkHashesB64.length !== checkpoint.chunks.length) {
    return checkpointAlert(
      'chunk_corrupt',
      'Checkpoint manifest and chunk count disagree.'
    );
  }
  const doc = new Y.Doc();
  const pieces: Uint8Array[] = [];
  for (const [index, chunk] of checkpoint.chunks.entries()) {
    if (
      chunk.index !== index ||
      (await sha256B64(b64ToBytes(chunk.ciphertextB64))) !==
        manifest.chunkHashesB64[index]
    ) {
      return checkpointAlert(
        'chunk_corrupt',
        `Checkpoint chunk ${String(index)} failed its hash check.`
      );
    }
    const plaintext = await openCheckpointPayload(
      contentKey,
      chunk.ciphertextB64,
      keyEpoch
    );
    if (!plaintext)
      return checkpointAlert(
        'chunk_corrupt',
        `Checkpoint chunk ${String(index)} could not be authenticated.`
      );
    pieces.push(plaintext);
  }
  const snapshot = new Uint8Array(
    pieces.reduce((length, piece) => length + piece.length, 0)
  );
  let offset = 0;
  for (const piece of pieces) {
    snapshot.set(piece, offset);
    offset += piece.length;
  }
  try {
    Y.applyUpdate(doc, snapshot);
  } catch {
    return checkpointAlert(
      'chunk_corrupt',
      'Checkpoint chunks do not form a valid CRDT snapshot.'
    );
  }
  if (
    bytesToB64(Y.encodeStateVector(doc)) !== manifest.stateVectorB64 ||
    (await canonicalStateHash(doc)) !== manifest.canonicalStateHashB64
  ) {
    return checkpointAlert(
      'chunk_corrupt',
      'Checkpoint contents disagree with its signed state vector or hash.'
    );
  }
  return { manifest, doc };
}

export interface ValidateCheckpointInput {
  checkpoint: CheckpointPackage;
  previousValidatedCheckpoint?: CheckpointPackage;
  retainedRows: ReadonlyArray<RetainedRawRow>;
  contentKey: CryptoKey;
  keyEpoch: number;
  verifier: CheckpointVerifier;
  receiptSigner: CheckpointSigner;
  validatedAt?: string;
}

/**
 * Performs D17's independent reconstruction. It never trusts the new snapshot
 * as proof: it starts from the previous validated checkpoint, applies every
 * contiguous retained relay row, then compares vector and canonical hash.
 */
export async function validateCheckpoint(
  input: ValidateCheckpointInput
): Promise<CheckpointValidationResult> {
  const loadedTarget = await loadCheckpointAtEpoch(
    input.checkpoint,
    input.contentKey,
    input.keyEpoch,
    input.verifier
  );
  if (!isLoadCheckpointResult(loadedTarget)) return loadedTarget;
  const { manifest: targetManifest } = loadedTarget;

  let reconstructed = new Y.Doc();
  let cursor = 0;
  if (targetManifest.generation > 1 && !input.previousValidatedCheckpoint) {
    return checkpointAlert(
      'prior_checkpoint_invalid',
      'A non-initial checkpoint must be reconstructed from its prior validated checkpoint.'
    );
  }
  if (input.previousValidatedCheckpoint) {
    const previous = await loadCheckpointAtEpoch(
      input.previousValidatedCheckpoint,
      input.contentKey,
      input.keyEpoch,
      input.verifier
    );
    if (!isLoadCheckpointResult(previous)) {
      return checkpointAlert(
        'prior_checkpoint_invalid',
        'repairAlert' in previous
          ? previous.repairAlert.detail
          : 'Previous checkpoint did not load.'
      );
    }
    if (
      !sameStream(previous.manifest.stream, targetManifest.stream) ||
      previous.manifest.generation >= targetManifest.generation ||
      previous.manifest.frontier.cursor > targetManifest.frontier.cursor
    ) {
      return checkpointAlert(
        'prior_checkpoint_invalid',
        'Previous validated checkpoint is not a valid predecessor.'
      );
    }
    reconstructed = previous.doc;
    cursor = previous.manifest.frontier.cursor;
  }

  const rows = [...input.retainedRows].sort(
    (left, right) => left.cursor - right.cursor
  );
  for (const row of rows) {
    if (row.cursor <= cursor) continue;
    if (row.cursor > targetManifest.frontier.cursor) break;
    if (row.cursor !== cursor + 1) {
      return checkpointAlert(
        'missing_raw_row',
        `Expected retained raw row ${String(cursor + 1)} before frontier ${String(targetManifest.frontier.cursor)}.`
      );
    }
    if (row.keyEpoch !== input.keyEpoch) {
      return checkpointAlert(
        'raw_row_invalid',
        `Raw row ${String(row.cursor)} has an unexpected key epoch.`
      );
    }
    const update = await openCheckpointPayload(
      input.contentKey,
      row.ciphertextB64,
      row.keyEpoch
    );
    if (!update)
      return checkpointAlert(
        'raw_row_invalid',
        `Raw row ${String(row.cursor)} could not be authenticated.`
      );
    try {
      Y.applyUpdate(reconstructed, update);
    } catch {
      return checkpointAlert(
        'raw_row_invalid',
        `Raw row ${String(row.cursor)} is not a valid CRDT update.`
      );
    }
    cursor = row.cursor;
  }
  if (cursor !== targetManifest.frontier.cursor) {
    return checkpointAlert(
      'missing_raw_row',
      `Retained raw rows stop at ${String(cursor)} before frontier ${String(targetManifest.frontier.cursor)}.`
    );
  }
  if (
    bytesToB64(Y.encodeStateVector(reconstructed)) !==
      targetManifest.stateVectorB64 ||
    (await canonicalStateHash(reconstructed)) !==
      targetManifest.canonicalStateHashB64
  ) {
    return checkpointAlert(
      'state_mismatch',
      'Independent replay does not match the signed checkpoint state.'
    );
  }
  const manifestHashB64 = await sha256B64(manifestPayload(targetManifest));
  const receiptPayload = bytes(
    stableJson({
      version: 1,
      orgId: targetManifest.stream.orgId,
      stream: targetManifest.stream,
      generation: targetManifest.generation,
      frontier: targetManifest.frontier,
      manifestHashB64,
      validatorDeviceId: input.receiptSigner.deviceId,
      validatedAt: input.validatedAt ?? new Date().toISOString(),
    })
  );
  const receiptBody =
    parseJson(receiptPayload) as Omit<ValidationReceipt, 'signatureB64'> | null;
  if (!receiptBody)
    return checkpointAlert(
      'manifest_invalid',
      'Could not encode validation receipt.'
    );
  return {
    ok: true,
    receipt: {
      ...receiptBody,
      signatureB64: await input.receiptSigner.sign(receiptPayload),
    },
  };
}

/** Relay pruning remains impossible until B2 says archive+retention are true and two devices signed receipts. */
export function canPruneCheckpointBase(
  control: import('./types').RelayCheckpointControlMetadata
): boolean {
  return (
    control.archived &&
    control.retentionEligible &&
    new Set(
      control.validationReceipts.map((receipt) => receipt.validatorDeviceId)
    ).size >= 2 &&
    control.validationReceipts.every(
      (receipt) => receipt.signatureB64.length > 0
    )
  );
}
