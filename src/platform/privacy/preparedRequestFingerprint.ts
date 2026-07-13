/**
 * A safe, durable fingerprint of the EXACT prepared cloud request that will be
 * transmitted to a provider — the payload after prompt preparation / redaction,
 * not the user's typed question. The durable audit intent records this so the
 * log can prove precisely what left the device: content-addressed hashes and
 * lengths only, never the content itself. This is the antidote to the
 * "audit-send mismatch" defect, where the intent recorded only the typed
 * question's character count while a much larger prepared system prompt (CRM
 * JSON, retrieved files, prior answers) was actually sent.
 */
import type { PreparedCloudRequest } from './promptPreparation';

export interface PreparedRequestFingerprint {
  /** SHA-256 over a canonical serialization of the whole prepared payload. */
  preparedPayloadSha256: string;
  /** SHA-256 of the exact prepared user prompt actually transmitted. */
  preparedPromptSha256: string;
  preparedPromptLength: number;
  /** SHA-256 of the exact prepared system prompt, or null when there is none. */
  preparedSystemPromptSha256: string | null;
  preparedSystemPromptLength: number;
  /** Attachment IDs + content hashes — never attachment bytes/contents. */
  preparedAttachments: { id: string; sha256: string; byteSize: number }[];
  /** none | text_only | redacted_derivative | blocked (from preparation). */
  preparedAttachmentDisposition: PreparedCloudRequest['attachmentDisposition'];
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256HexOfString(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return bytesToHex(digest);
}

async function sha256HexOfBytes(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return bytesToHex(digest);
}

/**
 * Canonical serialization used for {@link PreparedRequestFingerprint.preparedPayloadSha256}.
 * Exported so a verifier (or a test) can recompute the same fingerprint over
 * whatever the provider actually received and assert they match.
 */
export function canonicalizePreparedPayload(input: {
  prompt: string;
  systemPrompt: string | undefined;
  attachments: { id: string; sha256: string; byteSize: number }[];
  attachmentDisposition: PreparedCloudRequest['attachmentDisposition'];
}): string {
  return JSON.stringify({
    prompt: input.prompt,
    systemPrompt: input.systemPrompt ?? null,
    attachments: input.attachments,
    attachmentDisposition: input.attachmentDisposition,
  });
}

/** Compute the durable fingerprint of a prepared cloud request. */
export async function fingerprintPreparedRequest(
  request: Readonly<PreparedCloudRequest>,
): Promise<PreparedRequestFingerprint> {
  const preparedAttachments = await Promise.all(
    (request.attachmentBytes ?? []).map(async (attachment) => ({
      id: attachment.att.id,
      sha256: await sha256HexOfBytes(attachment.bytes),
      byteSize: attachment.bytes.byteLength,
    })),
  );
  const [preparedPromptSha256, preparedSystemPromptSha256] = await Promise.all([
    sha256HexOfString(request.prompt),
    request.systemPrompt === undefined
      ? Promise.resolve(null)
      : sha256HexOfString(request.systemPrompt),
  ]);
  const preparedPayloadSha256 = await sha256HexOfString(
    canonicalizePreparedPayload({
      prompt: request.prompt,
      systemPrompt: request.systemPrompt,
      attachments: preparedAttachments,
      attachmentDisposition: request.attachmentDisposition,
    }),
  );
  return {
    preparedPayloadSha256,
    preparedPromptSha256,
    preparedPromptLength: request.prompt.length,
    preparedSystemPromptSha256,
    preparedSystemPromptLength: request.systemPrompt?.length ?? 0,
    preparedAttachments,
    preparedAttachmentDisposition: request.attachmentDisposition,
  };
}
