/**
 * Fold seam for Intake AI requests.
 *
 * The UX-simplify branch owns the real prompt-preparation layer. Keep this
 * signature byte-for-byte compatible with its prepared structured-send helper
 * so the fold can replace this pass-through with that import.
 */
import type {
  AttachmentBytes,
  ProviderResponse,
  SendOptions,
  StructuredOutputOptions,
} from '@/platform/providers/Provider';
import type { RunWithEgressAuditOptions } from '@/platform/privacy/sendWithEgressAudit';
import { runWithEgressAudit } from '@/platform/privacy/sendWithEgressAudit';

export type PromptOrigin =
  | 'typed_question'
  | 'system_prompt'
  | 'chat_history'
  | 'retrieval'
  | 'open_file'
  | 'email'
  | 'workflow_input'
  | 'workflow_file'
  | 'meeting'
  | 'client_map'
  | 'tool_result'
  | 'attachment_text'
  | 'attachment_binary'
  | 'attachment_filename';

export interface PreparedAttachmentCandidate {
  extractedText?: string;
  canRedact?: boolean;
  attachment?: AttachmentBytes;
  attachmentId?: string;
  attachmentIndex?: number;
}

export interface PromptPart {
  id: string;
  origin: PromptOrigin;
  label: string;
  text?: string;
  attachment?: PreparedAttachmentCandidate;
}

export type PreparedSendContext<T = ProviderResponse> = Omit<
  RunWithEgressAuditOptions<T>,
  'operation'
> & {
  surface: string;
  prompt: string;
  options?: SendOptions;
  parts?: PromptPart[];
  background?: boolean;
  beforeEgress?: () => void | Promise<void>;
};

export async function sendPreparedStructuredWithEgressAudit<T>(
  ctx: PreparedSendContext<T> & { options: StructuredOutputOptions }
): Promise<T> {
  // TODO-FOLD(scrub-migration): replace this pass-through with the matching
  // prepared-send export from @/platform/privacy/promptPreparation.
  return runWithEgressAudit({
    ...ctx,
    operation: () => ctx.provider.structuredOutput<T>(ctx.prompt, ctx.options),
  });
}
