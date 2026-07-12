/**
 * Privacy-owned send route for firm meeting-template fills.
 *
 * Template fills contain the meeting transcript, so they must use the same
 * prompt-preparation door as every other cloud AI surface.  Keeping this
 * adapter here means the rendering panel receives only a prepared sender,
 * never a raw Provider it could accidentally call directly.
 */
import { AuditService } from '@/platform/audit/AuditService';
import type { ResolvedGlanceProvider } from '@/platform/matter/matterAtAGlance';
import type { AuditEntry } from '@/platform/types/audit';
import type { EgressAuditLogger } from '@/platform/privacy/sendWithEgressAudit';
import { modelAuditMetrics } from '@/platform/privacy/sendWithEgressAudit';
import { sendPreparedMessageWithEgressAudit } from '@/platform/privacy/promptPreparation';
import type { MeetingTemplateFillProvider } from '@/platform/meetingTemplates';

const meetingTemplateAudit = new AuditService('meetings');

function logMeetingTemplateAudit(entry: Omit<AuditEntry, 'id' | 'timestamp'>): void {
  meetingTemplateAudit.log(entry.action, entry.description, {
    ...(entry.model !== undefined ? { model: entry.model } : {}),
    inputs: entry.inputs,
    outputs: entry.outputs,
    ...(entry.userDecision !== undefined ? { userDecision: entry.userDecision } : {}),
    metadata: entry.metadata,
    ...(entry.tokensIn !== undefined ? { tokensIn: entry.tokensIn } : {}),
    ...(entry.tokensOut !== undefined ? { tokensOut: entry.tokensOut } : {}),
    ...(entry.costUsd !== undefined ? { costUsd: entry.costUsd } : {}),
    ...(entry.provider !== undefined ? { provider: entry.provider } : {}),
  });
}

export interface PreparedMeetingTemplateFillProviderInput {
  matterId: string;
  resolved: ResolvedGlanceProvider;
  /** An injected recorder makes the privacy receipt testable without changing
   * the real app's append-only meetings audit trail. */
  onAuditLog?: EgressAuditLogger;
}

/**
 * Creates the only provider-shaped value the meeting-template UI may use.
 * It prepares the entire template-plus-transcript prompt, records its receipt,
 * then performs the audited provider operation.
 */
export function createPreparedMeetingTemplateFillProvider(
  input: PreparedMeetingTemplateFillProviderInput,
): MeetingTemplateFillProvider {
  const onAuditLog = input.onAuditLog ?? logMeetingTemplateAudit;
  const { matterId, resolved } = input;

  return {
    send: async (prompt, options) =>
      await sendPreparedMessageWithEgressAudit({
        provider: resolved.provider,
        providerId: resolved.providerId,
        model: resolved.model,
        prompt,
        options,
        surface: 'meeting_template_fill',
        parts: [{
          // promptPreparation replaces the outbound body only for its canonical
          // prompt part. The descriptive label still makes the receipt useful.
          id: 'prompt',
          origin: 'meeting',
          label: 'Meeting template transcript',
          text: prompt,
        }],
        onAuditLog,
        scope: { kind: 'matter', matterId },
        modelCall: (response) => ({
          action: 'model_call',
          description: `Meeting template fill to ${resolved.model}`,
          model: resolved.model,
          inputs: { matterId, promptLength: prompt.length },
          outputs: { contentLength: response.content.length },
          userDecision: 'approved',
          metadata: { feature: 'meeting_template_fill' },
          ...modelAuditMetrics(response),
          provider: resolved.providerId,
        }),
      }),
  };
}
