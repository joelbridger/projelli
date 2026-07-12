// Export helpers for the Privacy Center trust overview.

import { DATA_MAP_ROWS } from '@/platform/privacy/ui/DataMapDialog';
import { resolveEgress } from '@/platform/privacy/egress';
import { BRAND } from '@/config/brand';
import { saveFile } from '@/platform/utils/saveFile';
import {
  openPrintWindow,
  exportMarkdownAsPdf,
} from '@/features/documents/pdf-export';

const LOCAL_ONLY_EGRESS = resolveEgress({
  provider: 'ollama',
  mode: 'local-only',
});
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
    `- Local-only: ${LOCAL_ONLY_EGRESS.note} (${LOCAL_ONLY_EGRESS.dataLeaves ? 'data may leave the device' : 'nothing leaves the device'}).`,
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
    '## Intake / secure client links',
    '',
    "For Lantern Intake secure links, the honest client page encrypts each submitted answer and document in the browser before upload to a key held in the advisor's operating system keychain. The relay is a mailbox for encrypted submissions, not an archive.",
    '',
    '### Relay data boundary',
    '',
    'The relay can see the intake ID, the creating seat or organization identity, lifecycle and submission timestamps, opaque item IDs, ciphertext sizes and chunk counts, the checklist version, a token hash, and ordinary connection details such as IP address and user agent.',
    '',
    "The relay cannot see a client's name, email address or phone number in v1, checklist labels, answers including Social Security numbers, file names or file contents. It does not receive the private key needed to decrypt a submission.",
    '',
    'The secure-link claim depends on page integrity. A compromised hosted page could read information typed during that session before encryption. The design requires a self-contained page with no third-party code, analytics, or CDN, plus restrictive browser rules, published build hashes, and a deploy-time integrity check.',
    '',
    "Email fallback is a separate channel with the confidentiality of the firm's email system. It is not end-to-end encrypted, and email-sourced items must remain clearly labeled as such.",
    '',
    '## Intake reviewer checklist',
    '',
    '- Verify the deployed page has no third-party code, analytics, or CDN.',
    '- Verify the published build hash and deploy-time integrity check.',
    '- Verify access-log retention and rate limits match the relay metadata boundary.',
    '- Verify the relay deletes ciphertext only after local durable storage.',
    '- Confirm email fallback is not end-to-end encrypted in every message.',
    '- Set the firm retention rules before collecting restricted information.',
    '',
    '## Firm review notes',
    '',
    'Lantern runs as a desktop app on your own computer. Lantern has no content server for your documents, prompts, or client records.',
    '',
    'AI keys are stored in the operating system keychain. Lantern never holds AI keys and never charges for AI usage.',
    '',
    'Your client data is encrypted on your device; the relay stores only ciphertext and opaque handles and never sees client names or documents. Information barriers are enforced by withholding keys, not by hiding records in the interface.',
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
    `Questions can be sent to ${BRAND.urls.developersEmail}.`
  );

  return lines.join('\n');
}

export async function exportPrivacyCenterOverviewDocx(): Promise<void> {
  const { markdownToDocxBytes } = await import('@/platform/utils/docx-io');
  const bytes = await markdownToDocxBytes(
    privacyCenterSecurityOverviewMarkdown(),
    OVERVIEW_DOCX_NAME
  );
  await saveFile(bytes, {
    suggestedName: OVERVIEW_DOCX_NAME,
    defaultExtension: 'docx',
    types: [
      {
        description: 'Word document',
        accept: {
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
            ['.docx'],
        },
      },
    ],
  });
}

export async function exportPrivacyCenterOverviewPdf(
  printWindow: Window | null = openPrintWindow()
): Promise<void> {
  await exportMarkdownAsPdf(
    privacyCenterSecurityOverviewMarkdown(),
    OVERVIEW_PDF_NAME,
    printWindow
  );
}
