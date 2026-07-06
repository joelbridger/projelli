/**
 * sourceProvenance — recognizing the OUTPUT of external advisor tools
 * (RightCapital financial plans, Jump meeting notes) wherever it lands in the
 * pile, so Lantern can label it honestly, date it, de-duplicate it, and warn
 * when a plan snapshot is stale.
 *
 * Per docs/strategy/2026-06-29-connector-access-options-rightcapital-jump.md:
 * these are RECOGNIZED SOURCE TYPES inside the generic ingester, not branded
 * connectors. Recognition is conservative — better to miss than to mislabel an
 * ordinary email that merely *mentions* a tool.
 */
import { describe, it, expect } from 'vitest';
import {
  recognizeProvenance,
  extractExportDate,
  isStalePlan,
  ageInDays,
  provenanceDedupeKey,
  provenanceBadgeLabel,
  describeProvenanceForPrompt,
  formatExportDate,
  type RecognizedProvenance,
} from '@/platform/rag/sourceProvenance';

describe('recognizeProvenance — RightCapital plan', () => {
  it('recognizes a RightCapital plan from the filename', () => {
    const p = recognizeProvenance({
      path: 'clients/Caldwell/RightCapital-Plan-2026-06-12.pdf',
      sourceType: 'pdf',
    });
    expect(p?.tool).toBe('rightcapital');
    expect(p?.kind).toBe('plan');
    expect(p?.toolLabel).toBe('RightCapital');
    expect(p?.confidence).toBe('high');
  });

  it('recognizes a "Right Capital" (spaced) filename', () => {
    const p = recognizeProvenance({ path: 'Right Capital Retirement Report.pdf', sourceType: 'pdf' });
    expect(p?.tool).toBe('rightcapital');
  });

  it('recognizes a RightCapital plan from body branding + plan structure', () => {
    const p = recognizeProvenance({
      path: 'onedrive:drive1:plan.pdf',
      sourceType: 'onedrive',
      text: 'Prepared by RightCapital, Inc.\nRetirement Analysis\nProbability of Success: 87%',
    });
    expect(p?.tool).toBe('rightcapital');
    expect(p?.confidence).toBe('medium');
  });

  it('does NOT tag an email that merely mentions RightCapital', () => {
    const p = recognizeProvenance({
      path: 'mail:abc123',
      sourceType: 'mail',
      text: "Hi, can you update the plan in RightCapital before our meeting? Thanks.",
    });
    expect(p).toBeNull();
  });

  it('does NOT tag a note that names the brand but has no report structure', () => {
    const p = recognizeProvenance({
      path: 'crm:note:55',
      sourceType: 'crm',
      text: 'Client asked whether we still use RightCapital for planning. We do.',
    });
    expect(p).toBeNull();
  });

  it('never tags a mail source, even if its path/body contains a tool name (Codex)', () => {
    // mail is never an export — guard the FILENAME signal too, not just the body.
    expect(recognizeProvenance({ path: 'mail:RightCapital-Plan-2026-06-12', sourceType: 'mail' })).toBeNull();
    expect(recognizeProvenance({
      path: 'mail:abc',
      sourceType: 'mail',
      text: 'RightCapital Retirement Analysis Net Worth Cash Flow jump.ai Meeting Summary Action Items',
    })).toBeNull();
  });
});

describe('recognizeProvenance — Jump meeting note', () => {
  it('recognizes a Jump note PDF from the filename', () => {
    const p = recognizeProvenance({ path: 'Jump-Note-2026-06-01.pdf', sourceType: 'pdf' });
    expect(p?.tool).toBe('jump');
    expect(p?.kind).toBe('meeting-note');
    expect(p?.confidence).toBe('high');
  });

  it('recognizes a Jump note synced into a CRM from body branding + structure', () => {
    const p = recognizeProvenance({
      path: 'crm:note:991',
      sourceType: 'crm',
      text: 'Meeting Summary\nAttendees: advisor, client\nAction Items: open a Roth\n\nPowered by Jump (jump.ai)',
    });
    expect(p?.tool).toBe('jump');
    expect(p?.confidence).toBe('medium');
  });

  it('does NOT tag an unrelated file that contains the word "jump"', () => {
    const p = recognizeProvenance({ path: 'long-jump-training-results.pdf', sourceType: 'pdf' });
    expect(p).toBeNull();
  });

  it('does NOT tag a meeting note with structure but no Jump brand marker', () => {
    const p = recognizeProvenance({
      path: 'crm:note:77',
      sourceType: 'crm',
      text: 'Meeting Summary\nAttendees: advisor, client\nAction Items: rebalance',
    });
    expect(p).toBeNull();
  });
});

describe('recognizeProvenance — non-matches', () => {
  it('returns null for an ordinary document', () => {
    expect(recognizeProvenance({ path: 'clients/x/tax-return-2025.pdf', sourceType: 'pdf', text: 'Form 1040' })).toBeNull();
  });
  it('returns null for empty input', () => {
    expect(recognizeProvenance({})).toBeNull();
  });
});

describe('extractExportDate', () => {
  it('prefers a labeled date ("as of")', () => {
    expect(extractExportDate('Net worth as of June 12, 2026. Other figures from 2020.')).toBe('2026-06-12');
  });
  it('parses ISO dates', () => {
    expect(extractExportDate('Report date: 2026-06-12')).toBe('2026-06-12');
  });
  it('parses US-style dates', () => {
    expect(extractExportDate('Prepared on 06/12/2026 for the client')).toBe('2026-06-12');
  });
  it('rejects impossible dates', () => {
    expect(extractExportDate('Feb 30, 2026 is not real and neither is 13/40/2026')).toBeNull();
  });
  it('returns null when there is no date', () => {
    expect(extractExportDate('no dates here')).toBeNull();
  });
});

describe('date in filename', () => {
  it('reads the export date out of the filename', () => {
    const p = recognizeProvenance({ path: 'RightCapital-Plan-2026-06-12.pdf', sourceType: 'pdf' });
    expect(p?.exportedAt).toBe('2026-06-12');
  });
  it('reads a US-ordered date out of the filename', () => {
    const p = recognizeProvenance({ path: 'rightcapital_plan_06-12-2026.pdf', sourceType: 'pdf' });
    expect(p?.exportedAt).toBe('2026-06-12');
  });
});

describe('staleness', () => {
  const now = new Date('2026-06-29T12:00:00Z');
  const plan = (exportedAt?: string): RecognizedProvenance => ({
    tool: 'rightcapital', toolLabel: 'RightCapital', kind: 'plan', confidence: 'high',
    ...(exportedAt ? { exportedAt } : {}),
  });
  const note = (exportedAt?: string): RecognizedProvenance => ({
    tool: 'jump', toolLabel: 'Jump', kind: 'meeting-note', confidence: 'high',
    ...(exportedAt ? { exportedAt } : {}),
  });

  it('flags a plan older than the limit', () => {
    expect(isStalePlan(plan('2026-01-01'), now, 90)).toBe(true);
  });
  it('does not flag a recent plan', () => {
    expect(isStalePlan(plan('2026-06-01'), now, 90)).toBe(false);
  });
  it('never flags a meeting note as stale', () => {
    expect(isStalePlan(note('2020-01-01'), now, 90)).toBe(false);
  });
  it('does not flag a plan with no detectable date', () => {
    expect(isStalePlan(plan(), now, 90)).toBe(false);
  });
  it('computes age in days', () => {
    expect(ageInDays('2026-06-22', now)).toBe(7);
  });
});

describe('dedupe key', () => {
  it('matches the same artifact across two arrival paths', () => {
    const fromCrm = recognizeProvenance({ path: 'crm:note:1', sourceType: 'crm', text: 'Meeting Summary\nAction Items\njump.ai\nMeeting date: 2026-06-01' })!;
    const fromPdf = recognizeProvenance({ path: 'Jump-Note-2026-06-01.pdf', sourceType: 'pdf' })!;
    const k1 = provenanceDedupeKey(fromCrm, 'matter-7');
    const k2 = provenanceDedupeKey(fromPdf, 'matter-7');
    expect(k1).not.toBeNull();
    expect(k1).toBe(k2);
  });
  it('keeps different dates distinct', () => {
    const a = provenanceDedupeKey({ tool: 'jump', toolLabel: 'Jump', kind: 'meeting-note', confidence: 'high', exportedAt: '2026-06-01' }, 'm');
    const b = provenanceDedupeKey({ tool: 'jump', toolLabel: 'Jump', kind: 'meeting-note', confidence: 'high', exportedAt: '2026-06-08' }, 'm');
    expect(a).not.toBe(b);
  });
  it('returns null without a date (do not merge undated artifacts)', () => {
    expect(provenanceDedupeKey({ tool: 'jump', toolLabel: 'Jump', kind: 'meeting-note', confidence: 'high' }, 'm')).toBeNull();
  });
});

describe('presentation', () => {
  it('formats the export date', () => {
    expect(formatExportDate('2026-06-12')).toBe('Jun 12, 2026');
  });
  it('badge label includes tool + dated mechanism (honest, no "integration")', () => {
    const label = provenanceBadgeLabel({ tool: 'rightcapital', toolLabel: 'RightCapital', kind: 'plan', confidence: 'high', exportedAt: '2026-06-12' });
    expect(label).toBe('RightCapital · exported Jun 12, 2026');
    expect(label.toLowerCase()).not.toContain('integ');
  });
  it('badge label degrades gracefully without a date', () => {
    expect(provenanceBadgeLabel({ tool: 'jump', toolLabel: 'Jump', kind: 'meeting-note', confidence: 'high' })).toBe('Jump · saved meeting note');
  });
  it('prompt description marks the source as a point-in-time snapshot with its age', () => {
    const desc = describeProvenanceForPrompt(
      { tool: 'rightcapital', toolLabel: 'RightCapital', kind: 'plan', confidence: 'high', exportedAt: '2026-06-12' },
      new Date('2026-06-29T00:00:00Z'),
    );
    expect(desc).toContain('point-in-time snapshot');
    expect(desc).toContain('Jun 12, 2026');
    expect(desc).toContain('17 days old');
  });
});
