/**
 * Composes the optional, approval-gated "compliance summary" CRM note from the
 * receipts of a just-approved review-card send. Pure; no IO. Consent/retention
 * lines appear only when the caller supplies them (Wave 3+ meeting sources).
 */

import type { ProposedCrmWrite } from '@/platform/state/crmWriteQueueStore';

export interface ComplianceNoteMeta {
  clientLabel: string;
  whenIso: string;
  consent?: { status: 'noted' | 'standing' | 'not-applicable'; method?: string; atIso?: string };
  retentionPolicy?: string;
}

export function composeComplianceNote(
  items: ProposedCrmWrite[],
  meta: ComplianceNoteMeta,
): { title: string; body: string } {
  const sent = items.filter((i) => i.status === 'sent');
  const lines: string[] = [
    `Compliance summary for ${meta.clientLabel}`,
    `Approved by the advisor: ${meta.whenIso}`,
    '',
    'Records filed:',
    ...sent.map(
      (i) => `- ${i.kind === 'note' ? 'Note' : 'Task'}: "${i.title}" (receipt ${i.remoteId ?? 'pending'}; source ${i.sourceRef})`,
    ),
  ];
  if (meta.consent) {
    lines.push(
      '',
      `Consent: ${meta.consent.status}${meta.consent.method ? ` (${meta.consent.method})` : ''}${meta.consent.atIso ? ` at ${meta.consent.atIso}` : ''}`,
    );
  }
  if (meta.retentionPolicy) lines.push(`Retention policy: ${meta.retentionPolicy}`);
  return { title: `Compliance summary: ${meta.clientLabel} (${meta.whenIso.slice(0, 10)})`, body: lines.join('\n') };
}
