// Export helpers for the Privacy Center trust overview.

import { DATA_MAP_ROWS } from '@/platform/privacy/ui/DataMapDialog';
import { resolveEgress } from '@/platform/privacy/egress';
import { BRAND } from '@/config/brand';
import { saveFile } from '@/platform/utils/saveFile';
import { openPrintWindow, exportMarkdownAsPdf } from '@/features/documents/pdf-export';

const LOCAL_ONLY_EGRESS = resolveEgress({ provider: 'ollama', mode: 'local-only' });
const DIRECT_EGRESS = resolveEgress({ provider: 'anthropic', mode: 'direct' });
const ASSURED_EGRESS = resolveEgress({
  provider: 'anthropic',
  mode: 'assured',
  assuredAvailable: true,
});

const OVERVIEW_DOCX_NAME = 'Lantern Privacy Center Security Overview.docx';
const OVERVIEW_PDF_NAME = 'Lantern Privacy Center Security Overview.pdf';

export function privacyCenterSecurityOverviewMarkdown(): string {
  const lines: string[] = [
    '# Lantern Privacy Center security overview',
    '',
    'This overview is exported from the Privacy Center. It summarizes where data lives, what can leave the device, and what a reviewer should know before approving Lantern.',
    '',
    '## Privacy modes',
    '',
    `- Local AI only: ${LOCAL_ONLY_EGRESS.note} Other approved Lantern features may still connect unless Offline Mode is on.`,
    `- Direct (bring your own key): ${DIRECT_EGRESS.note} Data leaves to your chosen AI provider, not to Lantern.`,
    `- Assured (firm option): ${ASSURED_EGRESS.note} Data passes through the firm's zero-retention proxy under a DPA.`,
    '',
    '## Data Map',
    '',
  ];

  for (const row of DATA_MAP_ROWS) {
    lines.push(`### ${row.title}`, '', row.body, '');
    if (row.caveat) lines.push(`Note: ${row.caveat}`, '');
  }

  lines.push(
    '## Firm review notes',
    '',
    'Lantern runs as a desktop app on your own computer. Lantern has no content server for your documents, prompts, or client records.',
    '',
    'AI keys are stored in the operating system keychain. Lantern never holds AI keys and never charges for AI usage.',
    '',
    'Shared firm workspaces sync only as end-to-end encrypted data. The relay can only see ciphertext. Information barriers are enforced by withholding keys, not by hiding records in the interface.',
    '',
    '## Current assurance status',
    '',
    'Lantern is not SOC 2 certified. A readiness and gap-analysis assessment is complete, but a formal independent audit has not yet completed.',
    '',
    'A Data Processing Agreement is available on request and should be reviewed by qualified counsel before execution.',
    '',
    '## Questions to ask',
    '',
    '- Where exactly is my data stored, and who has access?',
    '- What leaves the device when I use a cloud AI model?',
    '- How do information barriers work across shared clients?',
    '- What is the status of your SOC 2 examination?',
    '- Can I see the DPA before we sign?',
    '',
    `Questions can be sent to ${BRAND.urls.developersEmail}.`,
  );

  return lines.join('\n');
}

export async function exportPrivacyCenterOverviewDocx(): Promise<void> {
  const { markdownToDocxBytes } = await import('@/platform/utils/docx-io');
  const bytes = await markdownToDocxBytes(
    privacyCenterSecurityOverviewMarkdown(),
    OVERVIEW_DOCX_NAME,
  );
  await saveFile(bytes, {
    suggestedName: OVERVIEW_DOCX_NAME,
    defaultExtension: 'docx',
    types: [
      {
        description: 'Word document',
        accept: {
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
        },
      },
    ],
  });
}

export async function exportPrivacyCenterOverviewPdf(
  printWindow: Window | null = openPrintWindow(),
): Promise<void> {
  await exportMarkdownAsPdf(
    privacyCenterSecurityOverviewMarkdown(),
    OVERVIEW_PDF_NAME,
    printWindow,
  );
}
