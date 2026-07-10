import {
  generateContentKey,
  generateSubmissionId,
  importContentKey,
  sealItemChunk,
  sealManifest,
  verifySubmissionIntegrity,
  wrapContentKey,
  type SealedManifest,
} from '@/platform/intake/intakeCrypto';
import { hashPlaintextChunk } from '@/platform/intake/chunkHash';
import type { RequestItem } from '@/platform/intake/types';
import type { ChunkUpload, SubmitManifest } from '@/platform/intake/intakeContract';

import { RelayClient } from './relayClient';
import type { AnswerPayload } from './types';

const CHUNK_BYTES = 4 * 1024 * 1024;

interface SubmitAnswerOptions {
  intakeId: string;
  intakePubRaw: Uint8Array;
  item: RequestItem;
  payload: AnswerPayload;
  relay: RelayClient;
  sessionId: string;
  resumeSubmissionId?: string;
  resumeContentKeyB64?: string;
  onPendingUpload?: (pending: { submission_id: string; chunk_count: number; content_key_b64: string }) => Promise<void>;
}

interface PlainChunk {
  bytes: Uint8Array;
  fileIndex?: number;
  filePart?: number;
}

async function fileToChunks(file: File, fileIndex: number): Promise<PlainChunk[]> {
  const out: PlainChunk[] = [];
  const bytes = new Uint8Array(await file.arrayBuffer());
  const partCount = Math.max(1, Math.ceil(bytes.length / CHUNK_BYTES));
  for (let part = 0; part < partCount; part += 1) {
    const start = part * CHUNK_BYTES;
    const end = Math.min(bytes.length, start + CHUNK_BYTES);
    out.push({ bytes: bytes.slice(start, end), fileIndex, filePart: part });
  }
  return out;
}

async function buildChunks(item: RequestItem, payload: AnswerPayload): Promise<{
  chunks: PlainChunk[];
  fileNames: string[];
  contentType: string;
}> {
  if (payload.kind === 'files') {
    if (payload.files.length !== 1) {
      throw new Error('File upload submissions must contain exactly one file.');
    }
    const file = payload.files[0];
    if (!file) throw new Error('File upload submission is missing its file.');
    const chunks = await fileToChunks(file, 0);
    return {
      chunks,
      fileNames: [file.name],
      contentType: file.type || 'application/octet-stream',
    };
  }

  const body =
    payload.kind === 'typed'
      ? {
          item_id: item.item_id,
          item_type: item.t,
          subject: item.subject,
          value: payload.value,
          display_value: payload.display_value,
        }
      : {
          item_id: item.item_id,
          item_type: item.t,
          subject: item.subject,
          answer: payload.answer,
        };
  return {
    chunks: [{ bytes: new TextEncoder().encode(JSON.stringify(body)) }],
    fileNames: [],
    contentType: 'application/json',
  };
}

export async function submitAnswer(options: SubmitAnswerOptions): Promise<{ submissionId: string }> {
  const contentKeyB64 = options.resumeContentKeyB64 ?? (await generateContentKey());
  const contentKey = await importContentKey(contentKeyB64);
  const submissionId = options.resumeSubmissionId ?? generateSubmissionId();
  const { chunks, fileNames, contentType } = await buildChunks(options.item, options.payload);
  const chunkHashes = await Promise.all(chunks.map((chunk) => hashPlaintextChunk(chunk.bytes)));

  await options.onPendingUpload?.({ submission_id: submissionId, chunk_count: chunks.length, content_key_b64: contentKeyB64 });

  const existingIndexes = new Set(await options.relay.fetchUploadedIndexes(options.item.item_id, submissionId));
  const chunkSidBindings: string[] = [];

  for (let index = 0; index < chunks.length; index += 1) {
    chunkSidBindings.push(submissionId);
    if (existingIndexes.has(index)) continue;
    const ciphertext = await sealItemChunk(contentKey, chunks[index].bytes, {
      intakeId: options.intakeId,
      itemId: options.item.item_id,
      submissionId,
      index,
    });
    const upload: ChunkUpload = {
      intake_id: options.intakeId,
      item_id: options.item.item_id,
      submission_id: submissionId,
      index,
      ciphertext_b64: ciphertext,
    };
    await options.relay.uploadChunk(options.item.item_id, upload);
  }

  const manifest: SealedManifest = {
    submission_id: submissionId,
    item_id: options.item.item_id,
    content_type: contentType,
    file_names: fileNames,
    chunk_hashes: chunkHashes,
    chunk_count: chunks.length,
    session_id: options.sessionId,
    ...(options.payload.kind === 'files' && options.payload.document_detective?.length
      ? { document_detective: options.payload.document_detective }
      : {}),
  };
  const integrity = verifySubmissionIntegrity(submissionId, manifest, chunkSidBindings);
  if (!integrity.ok) throw new Error(`Submission integrity failed: ${integrity.reason}`);
  const manifestCiphertext = await sealManifest(contentKey, manifest, {
    intakeId: options.intakeId,
    itemId: options.item.item_id,
    submissionId,
  });
  const wrappedContentKey = await wrapContentKey(contentKeyB64, options.intakePubRaw);
  const submit: SubmitManifest = {
    intake_id: options.intakeId,
    item_id: options.item.item_id,
    submission_id: submissionId,
    manifest_ciphertext_b64: manifestCiphertext,
    wrapped_content_key_b64: wrappedContentKey,
  };
  await options.relay.submitManifest(options.item.item_id, submit);

  return { submissionId };
}
