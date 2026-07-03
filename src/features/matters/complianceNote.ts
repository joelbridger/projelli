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

// Codex review catch (P2, Task 9c integration): this hardcoded to Note/Task
// before field updates existed, so an approved field write showed up in the
// compliance record mislabeled as "Task" — a real accuracy problem for a
// compliance/audit artifact.
function crmWriteKindLabel(kind: ProposedCrmWrite['kind']): string {
  switch (kind) {
    case 'note': return 'Note';
    case 'task': return 'Task';
    case 'field': return 'Field update';
  }
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
      (i) => `- ${crmWriteKindLabel(i.kind)}: "${i.title}" (receipt ${i.remoteId ?? 'pending'}; source ${i.sourceRef})`,
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
