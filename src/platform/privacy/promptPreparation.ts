/**
 * Prompt preparation is the single place where material is made safe for a
 * cloud AI request.  It deliberately records only kinds and counts: this
 * module must never turn a secret into telemetry.
 */
import type { AttachmentBytes, ProviderResponse, SendOptions, StreamOptions, StructuredOutputOptions } from '@/platform/providers/Provider';
import type { AuditEvent } from '@/platform/types/audit';
import type { RunWithEgressAuditOptions } from './sendWithEgressAudit';
import { runWithEgressAudit } from './sendWithEgressAudit';
export {
  assertCloudPreparation,
  getPreparationEnforcementMode,
  isPreparationStamp,
  setPreparationEnforcementMode,
  type PreparationEnforcementMode,
  type PreparationStamp,
} from './promptPreparationGuard';
import { createPreparationStamp } from './promptPreparationGuard';

export type PromptOrigin =
  | 'typed_question' | 'chat_history' | 'retrieval' | 'open_file' | 'email'
  | 'workflow_input' | 'workflow_file' | 'meeting' | 'client_map' | 'tool_result'
  | 'attachment_text' | 'attachment_binary';

export type SecretKind =
  | 'url_fragment' | 'signed_url' | 'bearer_token' | 'api_key' | 'password'
  | 'oauth_code' | 'oauth_token' | 'intake_link_secret' | 'cookie' | 'private_key'
  | 'connection_string';

export interface PreparedAttachmentCandidate {
  /** Text extracted locally from a PDF/image. Undefined means it cannot be safely scanned. */
  extractedText?: string;
  /** Whether local redaction can produce a safe upload derivative. */
  canRedact?: boolean;
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
  | { status: 'needs_user_decision'; findings: SecretFinding[] }
  | { status: 'blocked'; reason: 'unscannable_attachment' | 'policy' | 'prompt_review_required'; findings?: SecretFinding[] };

export type PromptDecision = 'send_redacted_copy' | 'cancel';
export type PromptDecisionBroker = (input: { findings: SecretFinding[]; surface: string }) => Promise<PromptDecision>;
let decisionBroker: PromptDecisionBroker | undefined;
let pendingReview: { findings: SecretFinding[]; surface: string } | undefined;
export function setPromptDecisionBroker(broker?: PromptDecisionBroker): void { decisionBroker = broker; }
export function getPendingPromptReview(): Readonly<typeof pendingReview> { return pendingReview; }


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
      return `${base}#[private-link-hidden]`;
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
  replace(/(authorization\s*:\s*bearer\s+)[^\s,;]+/gi, 'bearer_token');
  replace(/\b(eyJ[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{8,})\b/g, 'bearer_token', '[private-value-hidden]');
  replace(/\b(sk-(?:ant-|proj-)?|AIza|gh[pousr]_|xox[baprs]-|rk_live_|pk_live_)[A-Za-z0-9_-]{8,}\b/g, 'api_key', '[private-value-hidden]');
  replace(/(-----BEGIN(?: [A-Z]+)? PRIVATE KEY-----)[\s\S]*?-----END(?: [A-Z]+)? PRIVATE KEY-----/g, 'private_key', '$1[private-key-hidden]');
  replace(/\b(cookie\s*:\s*)[^\r\n]+/gi, 'cookie');
  replace(/\b((?:password|passwd|pwd)\s*[:=]\s*)[^\s,;"'}]+/gi, 'password');
  replace(/\b((?:access_token|refresh_token|id_token|client_secret|code_verifier)\s*[:=]\s*)[^\s,;"'}&]+/gi, 'oauth_token');
  replace(/\b((?:oauth_code|code)\s*[:=]\s*)[^\s,;"'}&]+/gi, 'oauth_code');
  replace(/\b((?:api[_-]?key|secret)\s*[:=]\s*)[^\s,;"'}&]+/gi, 'api_key');
  replace(/\b([a-z]+:\/\/[^\s:@/]+:)[^\s@/]+@/gi, 'connection_string');
  // URL encoded, folded, or zero-width secrets may not have an exactly matching
  // original token. Redact the containing named field rather than risk sending it.
  if (/(?:authorization:\s*bearer|access_token\s*[:=]|api[_-]?key\s*[:=]|password\s*[:=]|-----BEGIN.*PRIVATE KEY-----)/i.test(normalized) && kinds.length === 0) {
    text = '[private material hidden]'; kinds.push('api_key');
  }
  return { text, kinds };
}

function findingsFor(partId: string, kinds: SecretKind[]): SecretFinding[] {
  return [...new Set(kinds)].map((kind) => ({ partId, kind, count: kinds.filter((candidate) => candidate === kind).length, safePreview: '[private material hidden]' }));
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
  let disposition: AttachmentDisposition = input.attachmentBytes?.length ? 'text_only' : 'none';
  for (const part of parts) {
    const scan = scanPromptPart(part);
    if (scan.blocked) return { status: 'blocked', reason: 'unscannable_attachment' };
    findings.push(...scan.findings);
    if (part.id === 'prompt' && scan.redactedText !== undefined) prompt = scan.redactedText;
    if (part.attachment && scan.findings.length) {
      if (!part.attachment.canRedact) return { status: 'blocked', reason: 'unscannable_attachment', findings };
      disposition = 'redacted_derivative';
    }
  }
  if (input.systemPrompt) {
    const system = redactText(input.systemPrompt);
    findings.push(...findingsFor('system', system.kinds));
    input = { ...input, systemPrompt: system.text };
  }
  if (findings.length) return { status: 'needs_user_decision', findings };
  return { status: 'ready', request: { prompt, systemPrompt: input.systemPrompt, attachmentBytes: input.attachmentBytes, findings, preparationId: createPreparationStamp(), attachmentDisposition: disposition } };
}

function redactedRequest(input: { prompt: string; systemPrompt?: string | undefined; attachmentBytes?: AttachmentBytes[] | undefined }, findings: SecretFinding[]): PreparedCloudRequest {
  return { prompt: redactText(input.prompt).text, systemPrompt: input.systemPrompt ? redactText(input.systemPrompt).text : undefined, attachmentBytes: input.attachmentBytes, findings, preparationId: createPreparationStamp(), attachmentDisposition: input.attachmentBytes?.length ? 'redacted_derivative' : 'none' };
}
async function decide(input: { prompt: string; systemPrompt?: string | undefined; attachmentBytes?: AttachmentBytes[] | undefined }, surface: string, background: boolean, result: PreparationResult): Promise<{ request?: PreparedCloudRequest; decision: 'clean' | 'redacted_by_user' | 'cancelled' | 'blocked' }> {
  if (result.status === 'ready') return { request: result.request, decision: 'clean' };
  if (result.status === 'blocked') return { decision: 'blocked' };
  if (background || !decisionBroker) { pendingReview = { findings: result.findings, surface }; return { decision: 'blocked' }; }
  if (await decisionBroker({ findings: result.findings, surface }) === 'send_redacted_copy') return { request: redactedRequest(input, result.findings), decision: 'redacted_by_user' };
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
};
type PromptPreparationReceipt = Extract<AuditEvent, { type: 'prompt_preparation' }>['payload'];

function receipt(ctx: PreparedSendContext, decision: 'clean' | 'redacted_by_user' | 'cancelled' | 'blocked', request?: PreparedCloudRequest): void {
  const metadata = {
    surface: ctx.surface,
    destination: ctx.providerId,
    categories: (request?.findings ?? []).map(({ kind, count }) => ({ kind, count })),
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
  const chosen = await decide({ prompt: ctx.prompt, systemPrompt: ctx.options?.systemPrompt, attachmentBytes: ctx.options?.attachmentBytes }, ctx.surface, ctx.background ?? false, result);
  receipt(ctx, chosen.decision, chosen.request);
  if (!chosen.request) throw new Error(chosen.decision === 'blocked' ? 'prompt_review_required' : 'prompt_send_cancelled');
  return runWithEgressAudit({ ...ctx, operation: () => ctx.provider.sendMessage(chosen.request!.prompt, { ...ctx.options, ...(chosen.request!.systemPrompt ? { systemPrompt: chosen.request!.systemPrompt } : {}), ...(chosen.request!.attachmentBytes ? { attachmentBytes: chosen.request!.attachmentBytes } : {}) }) });
}
export async function sendPreparedStreamingWithEgressAudit(ctx: PreparedSendContext & { options: StreamOptions }): Promise<ProviderResponse> {
  const result = prepareCloudRequest({ prompt: ctx.prompt, systemPrompt: ctx.options.systemPrompt, parts: ctx.parts, attachmentBytes: ctx.options.attachmentBytes });
  const chosen = await decide({ prompt: ctx.prompt, systemPrompt: ctx.options.systemPrompt, attachmentBytes: ctx.options.attachmentBytes }, ctx.surface, ctx.background ?? false, result);
  receipt(ctx, chosen.decision, chosen.request); if (!chosen.request) throw new Error(chosen.decision === 'blocked' ? 'prompt_review_required' : 'prompt_send_cancelled');
  return runWithEgressAudit({ ...ctx, operation: () => ctx.provider.sendMessageStreaming!(chosen.request!.prompt, { ...ctx.options, ...(chosen.request!.systemPrompt ? { systemPrompt: chosen.request!.systemPrompt } : {}), ...(chosen.request!.attachmentBytes ? { attachmentBytes: chosen.request!.attachmentBytes } : {}) }) });
}
export async function sendPreparedStructuredWithEgressAudit<T>(ctx: PreparedSendContext<T> & { options: StructuredOutputOptions }): Promise<T> {
  const result = prepareCloudRequest({ prompt: ctx.prompt, systemPrompt: ctx.options.systemPrompt, parts: ctx.parts });
  const chosen = await decide({ prompt: ctx.prompt, systemPrompt: ctx.options.systemPrompt }, ctx.surface, ctx.background ?? false, result);
  receipt(ctx, chosen.decision, chosen.request); if (!chosen.request) throw new Error(chosen.decision === 'blocked' ? 'prompt_review_required' : 'prompt_send_cancelled');
  return runWithEgressAudit({ ...ctx, operation: () => ctx.provider.structuredOutput<T>(chosen.request!.prompt, { ...ctx.options, ...(chosen.request!.systemPrompt ? { systemPrompt: chosen.request!.systemPrompt } : {}) }) });
}

/** Used by cloud provider tool loops. Tool continuations never have a dialog. */
export function prepareToolResultContinuation(value: string): string {
  const result = prepareCloudRequest({ prompt: value, parts: [{ id: 'tool-result', origin: 'tool_result', label: 'Tool result', text: value }] });
  if (result.status === 'ready') return result.request.prompt;
  pendingReview = { findings: result.status === 'needs_user_decision' ? result.findings : [], surface: 'tool_result' };
  throw new Error('prompt_review_required');
}
