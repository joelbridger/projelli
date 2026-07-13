/**
 * Prompt preparation is the single place where material is made safe for a
 * cloud AI request.  It deliberately records only kinds and counts: this
 * module must never turn a secret into telemetry.
 */
import type { AttachmentBytes, ProviderResponse, SendOptions, StreamOptions, StructuredOutputOptions } from '@/platform/providers/Provider';
import type { AuditEvent } from '@/platform/types/audit';
import type { RunWithEgressAuditOptions } from './sendWithEgressAudit';
import { runWithEgressAudit } from './sendWithEgressAudit';
declare const preparationBrand: unique symbol;
export interface PreparationStamp { readonly [preparationBrand]: 'prepared-cloud-request'; }
const validStamps = new WeakSet();

/** This is deliberately module-private: only this preparation path can stamp a request. */
function createPreparationStamp(): PreparationStamp {
  const stamp = {} as PreparationStamp;
  validStamps.add(stamp);
  return stamp;
}

export function isPreparationStamp(value: unknown): value is PreparationStamp {
  return typeof value === 'object' && value !== null && validStamps.has(value);
}

export type PreparationEnforcementMode = 'off' | 'warn' | 'enforce';
let enforcementMode: PreparationEnforcementMode = 'enforce';

function mayChangeEnforcementForTests(): boolean {
  return import.meta.env.DEV ||
    (typeof process !== 'undefined' && process.env['NODE_ENV'] === 'test');
}

export function setPreparationEnforcementMode(mode: PreparationEnforcementMode): void {
  if (!mayChangeEnforcementForTests()) {
    throw new Error('[prompt preparation] enforcement mode can only change in development or tests');
  }
  enforcementMode = mode;
}

export function getPreparationEnforcementMode(): PreparationEnforcementMode {
  return enforcementMode;
}

/** Cloud adapters call this immediately before their first network request. */
export function assertCloudPreparation(stamp: unknown, provider: string): void {
  if (isPreparationStamp(stamp) || enforcementMode === 'off') return;
  const message = `[prompt preparation] cloud ${provider} request was not prepared`;
  if (enforcementMode === 'enforce') throw new Error(message);
  console.warn(message);
}

export type PromptOrigin =
  | 'typed_question' | 'system_prompt' | 'chat_history' | 'retrieval' | 'open_file' | 'email'
  | 'workflow_input' | 'workflow_file' | 'meeting' | 'client_map' | 'tool_result'
  | 'attachment_text' | 'attachment_binary' | 'attachment_filename';

export type SecretKind =
  | 'url_fragment' | 'signed_url' | 'bearer_token' | 'api_key' | 'password'
  | 'oauth_code' | 'oauth_token' | 'intake_link_secret' | 'cookie' | 'private_key'
  | 'connection_string';

export interface PreparedAttachmentCandidate {
  /** Text extracted locally from a PDF/image. Undefined means it cannot be safely scanned. */
  extractedText?: string;
  /** Whether local redaction can produce a safe upload derivative. */
  canRedact?: boolean;
  /**
   * The actual upload this extracted text belongs to. Supplying it lets the
   * preparation layer replace the bytes, rather than merely changing the
   * surrounding prompt. `attachmentId` is the equivalent lightweight form.
   */
  attachment?: AttachmentBytes;
  attachmentId?: string;
  /** Required when the same file is attached more than once. */
  attachmentIndex?: number;
}

export interface PromptPart {
  id: string;
  origin: PromptOrigin;
  label: string;
  text?: string;
  attachment?: PreparedAttachmentCandidate;
}

export interface SecretFinding {
  partId: string;
  kind: SecretKind;
  count: number;
  /** Safe context only. It never contains a source value or a value length. */
  safePreview: string;
  /** A deliberately broad receipt category for attachment metadata. */
  receiptCategory?: 'attachment/filename';
}


export type AttachmentDisposition = 'none' | 'text_only' | 'redacted_derivative' | 'blocked';
export interface PreparedCloudRequest {
  prompt: string;
  systemPrompt: string | undefined;
  attachmentBytes: AttachmentBytes[] | undefined;
  findings: SecretFinding[];
  preparationId: import('./promptPreparationGuard').PreparationStamp;
  attachmentDisposition: AttachmentDisposition;
}
export type PreparationResult =
  | { status: 'ready'; request: PreparedCloudRequest }
  | { status: 'needs_user_decision'; findings: SecretFinding[]; redactedRequest: PreparedCloudRequest }
  | { status: 'blocked'; reason: 'unscannable_attachment' | 'policy' | 'prompt_review_required'; findings?: SecretFinding[] };

export type PromptDecision = 'send_redacted_copy' | 'cancel';
export type PromptDecisionBroker = (input: { findings: SecretFinding[]; surface: string }) => Promise<PromptDecision>;
let decisionBroker: PromptDecisionBroker | undefined;
let pendingReview: { findings: SecretFinding[]; surface: string } | undefined;
export function setPromptDecisionBroker(broker?: PromptDecisionBroker): void { decisionBroker = broker; }
export function getPendingPromptReview(): Readonly<typeof pendingReview> { return pendingReview; }
/**
 * Test-only cleanup for module state that ordinary callers deliberately cannot
 * clear. A pending review is normally consumed by the review UI; tests that
 * intentionally create one must not leave it for another test file.
 */
export function resetPromptPreparationStateForTests(): void {
  decisionBroker = undefined;
  pendingReview = undefined;
}


const ZERO_WIDTH = /[\u200B-\u200D\uFEFF]/g;
function normalizeForDetection(value: string): string {
  let result = value.normalize('NFC').replace(ZERO_WIDTH, '').replace(/\r?\n[ \t]+/g, '');
  // Decode only ordinary percent escapes. A failed decode is retained as-is.
  try { result = decodeURIComponent(result); } catch { result = value; }
  return result;
}
function redactUrl(url: string): { value: string; kinds: SecretKind[] } {
  const kinds: SecretKind[] = [];
  return {
    value: url.replace(/([a-z][a-z0-9+.-]*:\/\/[^\s<>"')\]]+)(#[^\s<>"')\]]+)/gi, (_all, base: string) => {
      kinds.push(/\/i\/[^/?#]+$/i.test(base) ? 'intake_link_secret' : 'url_fragment');
      return `${base}#[link-fragment-hidden]`;
    }).replace(/([?&])((?:x-amz-[^=&]+|x-goog-[^=&]+|sig|token|access_token|id_token|refresh_token|code|api_key|key|secret|signature|password)=)([^&#\s"')\]]*)/gi,
      (_all, sep: string, key: string) => {
        kinds.push(/^(x-amz-|x-goog-|sig(?:=|$)|signature)/i.test(key) ? 'signed_url' : /^(code|access_token|id_token|refresh_token)/i.test(key) ? 'oauth_token' : 'api_key');
        return `${sep}${key}[private-value-hidden]`;
      }),
    kinds,
  };
}

interface Redaction { text: string; kinds: SecretKind[]; }
function redactText(source: string): Redaction {
  // Normalization is used for detection. Redaction targets the original, which
  // preserves ordinary wording and URL paths. Evasion forms are also redacted
  // by scanning their normalized counterpart and replacing the enclosing value.
  const normalized = normalizeForDetection(source);
  const kinds: SecretKind[] = [];
  let text = source;
  const urlResult = redactUrl(text); text = urlResult.value; kinds.push(...urlResult.kinds);
  const replace = (pattern: RegExp, kind: SecretKind, replacement = '$1[private-value-hidden]') => {
    text = text.replace(pattern, (...args: string[]) => { kinds.push(kind); return replacement.replace('$1', args[1] ?? ''); });
  };
  // Keep folded header continuations inside the value. A line fold is a
  // common way to hide a capability from a line-oriented scanner.
  replace(/(authorization\s*:\s*bearer\s+)[^\s,;]+(?:\r?\n[ \t]+[^\s,;]+)*/gi, 'bearer_token');
  replace(/\b(eyJ[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{8,})\b/g, 'bearer_token', '[private-value-hidden]');
  replace(/\b(sk-(?:ant-|proj-)?|AIza|gh[pousr]_|xox[baprs]-|rk_live_|pk_live_)[A-Za-z0-9_-]{8,}\b/g, 'api_key', '[private-value-hidden]');
  replace(/(-----BEGIN(?: [A-Z]+)? PRIVATE KEY-----)[\s\S]*?-----END(?: [A-Z]+)? PRIVATE KEY-----/g, 'private_key', '$1[private-key-hidden]');
  replace(/\b(cookie\s*:\s*)[^\r\n]+/gi, 'cookie');
  // Accept both prose (`access_token=value`) and JSON (`"access_token":"value"`).
  // Tool results are JSON, so quoted field names are just as sensitive as the
  // command-line and URL forms above.
  replace(/((?:\b(?:password|passwd|pwd)\b|["'](?:password|passwd|pwd)["'])\s*[:=]\s*)(?:["'])?[^\s,;"'}]+/gi, 'password');
  replace(/((?:\b(?:access_token|refresh_token|id_token|client_secret|code_verifier)\b|["'](?:access_token|refresh_token|id_token|client_secret|code_verifier)["'])\s*[:=]\s*)(?:["'])?[^\s,;"'}&]+/gi, 'oauth_token');
  replace(/((?:\b(?:oauth_code|code)\b|["'](?:oauth_code|code)["'])\s*[:=]\s*)(?:["'])?[^\s,;"'}&]+/gi, 'oauth_code');
  replace(/((?:\b(?:api[_-]?key|secret)\b|["'](?:api[_-]?key|secret)["'])\s*[:=]\s*)(?:["'])?[^\s,;"'}&]+/gi, 'api_key');
  replace(/\b([a-z]+:\/\/[^\s:@/]+:)[^\s@/]+@/gi, 'connection_string');
  // Percent encoding, folded headers, and zero-width characters can expose a
  // *second* secret only after normalization. A previous match in the source
  // must not make that hidden value look safe (for example, a visible password
  // followed by an encoded access token). The original positions cannot be
  // mapped safely after decoding, so hide this enclosing value wholesale.
  const normalizedSecret = /(?:authorization:\s*bearer|access_token\s*[:=]|refresh_token\s*[:=]|id_token\s*[:=]|api[_-]?key\s*[:=]|password\s*[:=]|-----BEGIN.*PRIVATE KEY-----)/i.test(normalized);
  if (normalized !== source && normalizedSecret) {
    text = '[private material hidden]';
    if (!kinds.includes('api_key')) kinds.push('api_key');
  }
  return { text, kinds };
}

function findingsFor(partId: string, kinds: SecretKind[]): SecretFinding[] {
  return [...new Set(kinds)].map((kind) => ({ partId, kind, count: kinds.filter((candidate) => candidate === kind).length, safePreview: '[private material hidden]' }));
}

function attachmentFilenameFindings(attachment: AttachmentBytes): SecretFinding[] {
  const redacted = redactText(attachment.att.fileName);
  return findingsFor(`attachment-name-${attachment.att.id}`, redacted.kinds).map((finding) => ({
    ...finding,
    receiptCategory: 'attachment/filename',
  }));
}

function safeAttachmentName(attachment: AttachmentBytes): string {
  return attachment.att.type === 'pdf' ? 'attachment.pdf' : 'attachment-image';
}

function replaceAttachmentName(attachment: AttachmentBytes, fileName: string): AttachmentBytes {
  return { ...attachment, att: { ...attachment.att, fileName } };
}

/**
 * A redacted attachment must be a new file, never the old byte array with a
 * new name.  A tiny self-contained PDF is portable across all current cloud
 * providers and guarantees the original source bytes cannot reach the wire.
 */
function buildRedactedPdfBytes(text: string): Uint8Array {
  const printable = text
    .replace(/[\\()]/g, '\\$&')
    .replace(/[^\x20-\x7E\r\n\t]/g, '?');
  const lines = printable.split(/\r?\n/).flatMap((line) =>
    line.length === 0 ? [' '] : line.match(/.{1,88}/g) ?? [' '],
  );
  const content = ['BT', '/F1 10 Tf', '48 760 Td', '13 TL', ...lines.flatMap((line, index) => [
    `(${line}) Tj`,
    ...(index < lines.length - 1 ? ['T*'] : []),
  ]), 'ET'].join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${String(content.length)} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(pdf.length);
    pdf += `${String(index + 1)} 0 obj\n${objects[index] ?? ''}\nendobj\n`;
  }
  const xref = pdf.length;
  pdf += `xref\n0 ${String(objects.length + 1)}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${String(objects.length + 1)} /Root 1 0 R >>\nstartxref\n${String(xref)}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

function findAttachment(candidate: PreparedAttachmentCandidate, attachments: AttachmentBytes[]): AttachmentBytes | undefined {
  if (candidate.attachmentIndex !== undefined) return attachments[candidate.attachmentIndex];
  if (candidate.attachment) return candidate.attachment;
  if (candidate.attachmentId) return attachments.find(({ att }) => att.id === candidate.attachmentId);
  // A single attachment has an unambiguous owner. Preserve compatibility with
  // the original candidate shape while refusing to guess in a multi-file send.
  return attachments.length === 1 ? attachments[0] : undefined;
}

function findAttachmentIndex(candidate: PreparedAttachmentCandidate, attachments: AttachmentBytes[], source: AttachmentBytes): number {
  if (candidate.attachmentIndex !== undefined) return candidate.attachmentIndex;
  if (candidate.attachment) {
    const exact = attachments.indexOf(candidate.attachment);
    if (exact >= 0) return exact;
  }
  const matches = attachments
    .map(({ att }, index) => ({ index, matches: att.id === source.att.id }))
    .filter(({ matches }) => matches);
  return matches.length === 1 ? matches[0]?.index ?? -1 : -1;
}

function redactedAttachment(candidate: PreparedAttachmentCandidate, attachments: AttachmentBytes[]): AttachmentBytes | undefined {
  const source = findAttachment(candidate, attachments);
  if (!source || source.att.type !== 'pdf' || candidate.extractedText === undefined) return undefined;
  const bytes = buildRedactedPdfBytes(redactText(candidate.extractedText).text);
  return {
    att: {
      ...source.att,
      id: `${source.att.id}-redacted`,
      type: 'pdf',
      mimeType: 'application/pdf',
      fileName: 'redacted-attachment.pdf',
      pathInWorkspace: '',
      byteSize: bytes.byteLength,
      metadata: { ...source.att.metadata, extractionMode: 'text-extract' },
    },
    bytes,
  };
}
export function scanPromptPart(part: PromptPart): { redactedText?: string; findings: SecretFinding[]; blocked?: boolean } {
  if (part.attachment && !part.attachment.extractedText) return { findings: [], blocked: true };
  const source = part.text ?? part.attachment?.extractedText;
  if (source === undefined) return { findings: [] };
  const redacted = redactText(source);
  return { redactedText: redacted.text, findings: findingsFor(part.id, redacted.kinds) };
}

export function prepareCloudRequest(input: { prompt: string; systemPrompt?: string | undefined; parts?: PromptPart[] | undefined; attachmentBytes?: AttachmentBytes[] | undefined }): PreparationResult {
  const parts = input.parts ?? [{ id: 'prompt', origin: 'typed_question' as const, label: 'AI request', text: input.prompt }];
  const findings: SecretFinding[] = [];
  let prompt = input.prompt;
  let systemPrompt = input.systemPrompt;
  let disposition: AttachmentDisposition = input.attachmentBytes?.length ? 'text_only' : 'none';
  const attachments = input.attachmentBytes ?? [];
  const preparedAttachments = input.attachmentBytes?.map((attachment) => replaceAttachmentName(attachment, attachment.att.fileName));
  let containsAttachmentFinding = false;
  for (const [index, attachment] of attachments.entries()) {
    const filenameFindings = attachmentFilenameFindings(attachment);
    findings.push(...filenameFindings);
    if (filenameFindings.length) {
      containsAttachmentFinding = true;
      if (!preparedAttachments) return { status: 'blocked', reason: 'unscannable_attachment', findings };
      preparedAttachments[index] = replaceAttachmentName(attachment, safeAttachmentName(attachment));
      disposition = 'redacted_derivative';
    }
  }
  for (const part of parts) {
    const scan = scanPromptPart(part);
    if (scan.blocked) return { status: 'blocked', reason: 'unscannable_attachment' };
    findings.push(...scan.findings);
    if (part.id === 'prompt' && scan.redactedText !== undefined) prompt = scan.redactedText;
    if (part.attachment && scan.findings.length) {
      containsAttachmentFinding = true;
      if (!part.attachment.canRedact) return { status: 'blocked', reason: 'unscannable_attachment', findings };
      const derivative = redactedAttachment(part.attachment, attachments);
      if (!derivative) return { status: 'blocked', reason: 'unscannable_attachment', findings };
      const source = findAttachment(part.attachment, attachments);
      const index = source ? findAttachmentIndex(part.attachment, attachments, source) : -1;
      if (index < 0 || !preparedAttachments) return { status: 'blocked', reason: 'unscannable_attachment', findings };
      preparedAttachments[index] = derivative;
      disposition = 'redacted_derivative';
    }
  }
  if (input.systemPrompt) {
    const system = redactText(input.systemPrompt);
    findings.push(...findingsFor('system', system.kinds));
    systemPrompt = system.text;
  }
  if (findings.length) {
    return {
      status: 'needs_user_decision',
      findings,
      redactedRequest: {
        prompt,
        systemPrompt,
        attachmentBytes: preparedAttachments,
        findings,
        preparationId: createPreparationStamp(),
        attachmentDisposition: containsAttachmentFinding ? 'redacted_derivative' : disposition,
      },
    };
  }
  return { status: 'ready', request: { prompt, systemPrompt: input.systemPrompt, attachmentBytes: input.attachmentBytes, findings, preparationId: createPreparationStamp(), attachmentDisposition: disposition } };
}
async function decide(surface: string, background: boolean, result: PreparationResult): Promise<{ request?: PreparedCloudRequest; decision: 'clean' | 'redacted_by_user' | 'cancelled' | 'blocked' }> {
  if (result.status === 'ready') return { request: result.request, decision: 'clean' };
  if (result.status === 'blocked') return { decision: 'blocked' };
  if (background || !decisionBroker) { pendingReview = { findings: result.findings, surface }; return { decision: 'blocked' }; }
  if (await decisionBroker({ findings: result.findings, surface }) === 'send_redacted_copy') return { request: result.redactedRequest, decision: 'redacted_by_user' };
  return { decision: 'cancelled' };
}

/**
 * The prepared-send helpers own the provider operation, but otherwise retain
 * every egress-audit detail supplied by their caller. This keeps migrations
 * from silently losing model-call records or future audit context fields.
 */
export type PreparedSendContext<T = ProviderResponse> = Omit<RunWithEgressAuditOptions<T>, 'operation'> & {
  surface: string;
  prompt: string;
  options?: SendOptions;
  parts?: PromptPart[];
  background?: boolean;
  /**
   * Called after the request is prepared and its preparation receipt is
   * recorded, but before any provider method can be invoked. Callers that
   * require durable audit intent records use this as the fail-closed door.
   *
   * It receives the EXACT prepared request that the provider is about to be
   * given (the same frozen object used for the send below), so the durable
   * intent can fingerprint the real transmitted payload — prompt, system
   * prompt, and attachments after redaction — rather than the raw typed input.
   */
  beforeEgress?: (request: Readonly<PreparedCloudRequest>) => void | Promise<void>;
};
type PromptPreparationReceipt = Extract<AuditEvent, { type: 'prompt_preparation' }>['payload'];

function receipt<T>(
  ctx: PreparedSendContext<T>,
  decision: 'clean' | 'redacted_by_user' | 'cancelled' | 'blocked',
  findings: SecretFinding[],
  request?: PreparedCloudRequest,
): void {
  const metadata = {
    surface: ctx.surface,
    destination: ctx.providerId,
    categories: findings.map(({ kind, count, receiptCategory }) => ({ kind: receiptCategory ?? kind, count })),
    decision,
    attachmentDisposition: request?.attachmentDisposition ?? 'blocked',
  } satisfies PromptPreparationReceipt;

  ctx.onAuditLog?.({
    action: 'prompt_preparation',
    description: 'AI request checked for private access links',
    model: undefined,
    inputs: {},
    outputs: {},
    userDecision: undefined,
    metadata,
  });
}
export async function sendPreparedMessageWithEgressAudit(ctx: PreparedSendContext): Promise<ProviderResponse> {
  const result = prepareCloudRequest({ prompt: ctx.prompt, systemPrompt: ctx.options?.systemPrompt, parts: ctx.parts, attachmentBytes: ctx.options?.attachmentBytes });
  const chosen = await decide(ctx.surface, ctx.background ?? false, result);
  receipt(ctx, chosen.decision, result.status === 'ready' ? result.request.findings : result.findings ?? [], chosen.request);
  const request = chosen.request;
  if (!request) throw new Error(chosen.decision === 'blocked' ? 'prompt_review_required' : 'prompt_send_cancelled');
  await ctx.beforeEgress?.(request);
  return runWithEgressAudit({ ...ctx, operation: () => ctx.provider.sendMessage(request.prompt, { ...ctx.options, preparationStamp: request.preparationId, ...(request.systemPrompt ? { systemPrompt: request.systemPrompt } : {}), ...(request.attachmentBytes ? { attachmentBytes: request.attachmentBytes } : {}) }) });
}
export async function sendPreparedStreamingWithEgressAudit(ctx: PreparedSendContext & { options: StreamOptions }): Promise<ProviderResponse> {
  const result = prepareCloudRequest({ prompt: ctx.prompt, systemPrompt: ctx.options.systemPrompt, parts: ctx.parts, attachmentBytes: ctx.options.attachmentBytes });
  const chosen = await decide(ctx.surface, ctx.background ?? false, result);
  receipt(ctx, chosen.decision, result.status === 'ready' ? result.request.findings : result.findings ?? [], chosen.request);
  const request = chosen.request;
  if (!request) throw new Error(chosen.decision === 'blocked' ? 'prompt_review_required' : 'prompt_send_cancelled');
  await ctx.beforeEgress?.(request);
  return runWithEgressAudit({ ...ctx, operation: () => {
    const response = ctx.provider.sendMessageStreaming?.(request.prompt, { ...ctx.options, preparationStamp: request.preparationId, ...(request.systemPrompt ? { systemPrompt: request.systemPrompt } : {}), ...(request.attachmentBytes ? { attachmentBytes: request.attachmentBytes } : {}) });
    if (!response) throw new Error('provider_streaming_unavailable');
    return response;
  } });
}
export async function sendPreparedStructuredWithEgressAudit<T>(ctx: PreparedSendContext<T> & { options: StructuredOutputOptions }): Promise<T> {
  const result = prepareCloudRequest({ prompt: ctx.prompt, systemPrompt: ctx.options.systemPrompt, parts: ctx.parts });
  const chosen = await decide(ctx.surface, ctx.background ?? false, result);
  receipt(ctx, chosen.decision, result.status === 'ready' ? result.request.findings : result.findings ?? [], chosen.request);
  const request = chosen.request;
  if (!request) throw new Error(chosen.decision === 'blocked' ? 'prompt_review_required' : 'prompt_send_cancelled');
  await ctx.beforeEgress?.(request);
  return runWithEgressAudit({ ...ctx, operation: () => ctx.provider.structuredOutput<T>(request.prompt, { ...ctx.options, preparationStamp: request.preparationId, ...(request.systemPrompt ? { systemPrompt: request.systemPrompt } : {}) }) });
}

/** Used by cloud provider tool loops. Tool continuations never have a dialog. */
export function prepareToolResultContinuation(value: string): string {
  const result = prepareCloudRequest({ prompt: value, parts: [{ id: 'tool-result', origin: 'tool_result', label: 'Tool result', text: value }] });
  if (result.status === 'ready') return result.request.prompt;
  pendingReview = { findings: result.status === 'needs_user_decision' ? result.findings : [], surface: 'tool_result' };
  throw new Error('prompt_review_required');
}

/**
 * Workspace rules are background material: there is no safe mid-request
 * review dialog for them. Scan them before a cloud adapter appends them and
 * stop the send if anything needs a redaction decision.
 */
export function prepareBackgroundSystemInstruction(value: string): string {
  const result = prepareCloudRequest({
    prompt: value,
    parts: [{ id: 'prompt', origin: 'system_prompt', label: 'Workspace AI rules', text: value }],
  });
  if (result.status === 'ready') return result.request.prompt;
  pendingReview = {
    findings: result.status === 'needs_user_decision' ? result.findings : [],
    surface: 'system_prompt',
  };
  throw new Error('prompt_review_required');
}
