import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  integrationHonestyCardIds,
  integrationHonestyCards,
  type IntegrationHonestyCardId,
} from '@/platform/connectors/integrationHonestyCards';

const markdownFiles = {
  wealthbox: 'WEALTHBOX.md',
  email: 'EMAIL.md',
  'onedrive-sharepoint': 'ONEDRIVE-SHAREPOINT.md',
  calendly: 'CALENDLY.md',
} satisfies Record<IntegrationHonestyCardId, string>;

const sectionTitles = [
  'What this connector reads',
  'What this connector writes',
  'What this connector can never touch',
  'How writes are gated',
  'Limits worth knowing',
] as const;

function readCardMarkdown(id: IntegrationHonestyCardId): string {
  return readFileSync(
    path.join(process.cwd(), 'docs/trust/integration-cards', markdownFiles[id]),
    'utf8'
  );
}

function extractLine(markdown: string, label: string): string {
  const match = new RegExp(`^${label}: (.+)$`, 'm').exec(markdown);
  if (!match?.[1]) throw new Error(`Missing ${label}`);
  return match[1].trim();
}

function extractSection(markdown: string, title: string): string {
  const marker = `## ${title}\n\n`;
  const start = markdown.indexOf(marker);
  if (start === -1) throw new Error(`Missing section ${title}`);
  const bodyStart = start + marker.length;
  const nextSection = markdown.indexOf('\n## ', bodyStart);
  const evidenceComment = markdown.indexOf('\n<!--', bodyStart);
  const possibleEnds = [nextSection, evidenceComment].filter((index) => index !== -1);
  const end = possibleEnds.length > 0 ? Math.min(...possibleEnds) : markdown.length;
  return markdown.slice(bodyStart, end).trim();
}

function parseGroupedBullets(markdownSection: string): Array<{ heading: string; items: string[] }> {
  const groups: Array<{ heading: string; items: string[] }> = [];
  let current: { heading: string; items: string[] } | null = null;

  for (const rawLine of markdownSection.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.endsWith(':') && !line.startsWith('- ')) {
      current = { heading: line.slice(0, -1), items: [] };
      groups.push(current);
      continue;
    }
    if (line.startsWith('- ')) {
      if (!current) throw new Error(`Bullet before heading: ${line}`);
      current.items.push(line.slice(2));
    }
  }

  return groups;
}

function parseFlatBullets(markdownSection: string): string[] {
  return markdownSection
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- '))
    .map((line) => line.slice(2));
}

function parseGating(markdownSection: string): Array<{ label: string; detail: string }> {
  return parseFlatBullets(markdownSection).map((line) => {
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) throw new Error(`Gating bullet missing label: ${line}`);
    return {
      label: line.slice(0, colonIndex),
      detail: line.slice(colonIndex + 1).trim(),
    };
  });
}

describe('integration honesty card data', () => {
  it('contains exactly the four shipping connector cards', () => {
    expect(integrationHonestyCardIds).toEqual([
      'wealthbox',
      'email',
      'onedrive-sharepoint',
      'calendly',
    ]);
  });

  it('has complete non-empty sections for every card', () => {
    for (const id of integrationHonestyCardIds) {
      const card = integrationHonestyCards[id];
      expect(card.connectorId).toBe(id);
      expect(card.name).toBeTruthy();
      expect(card.lastVerified).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(card.status).toBeTruthy();
      expect(card.summary).toBeTruthy();
      expect(card.reads.length).toBeGreaterThan(0);
      expect(card.writes.length).toBeGreaterThan(0);
      expect(card.neverTouch.length).toBeGreaterThan(0);
      expect(card.gating.length).toBeGreaterThan(0);
      expect(card.limits.length).toBeGreaterThan(0);

      for (const group of [...card.reads, ...card.writes]) {
        expect(group.heading).toBeTruthy();
        expect(group.items.length).toBeGreaterThan(0);
      }
      for (const gate of card.gating) {
        expect(gate.label).toBeTruthy();
        expect(gate.detail).toBeTruthy();
      }
    }
  });

  it('matches the structural facts in the markdown trust cards', () => {
    for (const id of integrationHonestyCardIds) {
      const card = integrationHonestyCards[id];
      const markdown = readCardMarkdown(id);

      expect(card.lastVerified).toBe(extractLine(markdown, 'Last verified'));
      expect(card.status).toBe(extractLine(markdown, 'Status'));
      expect(card.reads).toEqual(parseGroupedBullets(extractSection(markdown, sectionTitles[0])));
      expect(card.writes).toEqual(parseGroupedBullets(extractSection(markdown, sectionTitles[1])));
      expect(card.neverTouch).toEqual(parseFlatBullets(extractSection(markdown, sectionTitles[2])));
      expect(card.gating).toEqual(parseGating(extractSection(markdown, sectionTitles[3])));
      expect(card.limits).toEqual(parseFlatBullets(extractSection(markdown, sectionTitles[4])));
    }
  });
});
