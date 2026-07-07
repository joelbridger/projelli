import type { ClientMap, ClientMapEditHistoryEntry, ClientMapItem, SourceRef } from '@/platform/clientMap/types';
import { useProfileStore } from '@/platform/profile/profileStore';
import { SK_FIRM_NAME } from '@/config/identity';

function escapeMarkdown(text: string): string {
  return text.replace(/\|/g, '\\|').trim();
}

function sourceLabel(source: SourceRef): string {
  const file = source.ref.split('?')[0]?.split('/').pop() ?? source.ref;
  const locator = source.locator ? `, ${source.locator}` : '';
  return `${source.kind}: ${file}${locator}`;
}

function itemLine(item: ClientMapItem): string {
  const sourceText =
    item.sources.length > 0
      ? ` Source: ${item.sources.map(sourceLabel).join('; ')}.`
      : item.isAssumption
        ? ' Source: working assumption.'
        : ' Source: added by advisor.';
  return `- ${escapeMarkdown(item.text)}${sourceText}`;
}

function firmName(): string {
  const profile = useProfileStore.getState();
  const fromProfile = profile.firmName.trim() || profile.soloName.trim();
  if (fromProfile) return fromProfile;
  try {
    return localStorage.getItem(SK_FIRM_NAME)?.trim() || 'Advisor Prep Hero';
  } catch {
    return 'Advisor Prep Hero';
  }
}

function formatHistory(entry: ClientMapEditHistoryEntry): string {
  const sourceText =
    entry.sources.length > 0
      ? entry.sources.map(sourceLabel).join('; ')
      : 'no cited source';
  const before = entry.beforeText ? ` From: ${entry.beforeText}` : '';
  const after = entry.afterText ? ` To: ${entry.afterText}` : '';
  return `- ${entry.timestamp} - ${entry.actor} - ${entry.action.replace(/_/g, ' ')} - ${entry.sectionTitle}.${before}${after} Source: ${sourceText}.`;
}

export function suggestClientMapExportName(clientName: string): string {
  const clean = clientName
    .trim()
    .replace(/[^\w\s.-]+/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80);
  return `${clean || 'Client'}-Client-Map.docx`;
}

export function suggestClientMapPdfExportName(clientName: string): string {
  return suggestClientMapExportName(clientName).replace(/\.docx$/i, '.pdf');
}

export function clientMapToMarkdown(map: ClientMap, clientName: string, generatedAt = new Date()): string {
  const generated = generatedAt.toLocaleString();
  const lines: string[] = [
    `# Advisor Prep Hero Client Map: ${clientName}`,
    '',
    `Prepared for ${firmName()}`,
    `Updated ${generated}`,
    '',
    'This map is built from the client files Advisor Prep Hero can read. Review the sources before using it with a client.',
    '',
  ];

  for (const section of map.sections) {
    lines.push(`## ${section.title}`, '');
    if (section.items.length === 0) {
      lines.push('- Nothing recorded yet.', '');
      continue;
    }
    for (const item of section.items) lines.push(itemLine(item));
    lines.push('');
  }

  lines.push('## What I am still missing', '');
  const gaps = map.completeness.ask;
  if (gaps.length === 0) {
    lines.push('- Nothing outstanding.', '');
  } else {
    for (const gap of gaps) lines.push(`- ${escapeMarkdown(gap.text)}`);
    lines.push('');
  }

  lines.push('## Edit history', '');
  const history = map.editHistory ?? [];
  if (history.length === 0) {
    lines.push('- No edits recorded yet.', '');
  } else {
    for (const entry of history.slice().reverse()) lines.push(formatHistory(entry));
    lines.push('');
  }

  return lines.join('\n');
}

export async function clientMapToDocxBytes(map: ClientMap, clientName: string): Promise<Uint8Array> {
  const { markdownToDocxBytes, applyLetterheadIfConfigured } = await import('@/platform/utils/docx-io');
  const fileName = suggestClientMapExportName(clientName);
  const bytes = await markdownToDocxBytes(clientMapToMarkdown(map, clientName), fileName, {
    firmName: firmName(),
  });
  return applyLetterheadIfConfigured(bytes);
}

export async function exportClientMapPdf(map: ClientMap, clientName: string): Promise<void> {
  const printWindow = window.open(
    'about:blank',
    '_blank',
    'width=800,height=600,menubar=no,toolbar=no,location=no,status=no',
  );
  const { exportMarkdownAsPdf } = await import('@/features/documents/pdf-export');
  await exportMarkdownAsPdf(
    clientMapToMarkdown(map, clientName),
    suggestClientMapPdfExportName(clientName),
    printWindow,
  );
}
