/**
 * Workstream B — profession wiring (Phase 1).
 *
 * Two suites:
 *
 * 1. getSamplesForProfession — verifies that the right sample file(s) are
 *    selected for each profession, and that the 'other' fallback is unchanged.
 *
 * 2. prioritizeByProfession — verifies that the correct templates float to the
 *    top of the workflow list for each profession, 'other' is a no-op, and
 *    edge cases (empty list, no matching templates) are handled safely.
 */

import { describe, it, expect } from 'vitest';
import { getSamplesForProfession } from '../../src/onboarding/samples/index';
import { prioritizeByProfession } from '../../src/features/workflows/engine/prioritizeByProfession';
import { ADVISOR_TEMPLATES } from '../../src/features/workflows/engine/templates/advisors/index';
import type { WorkflowTemplate } from '../../src/platform/types/workflow';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal stub that satisfies WorkflowTemplate for ordering tests. */
function stubTemplate(
  id: string,
  category: WorkflowTemplate['category'],
): WorkflowTemplate {
  return {
    id,
    name: id,
    description: '',
    version: '1.0.0',
    category,
    steps: [],
    requiredInputs: [],
    outputs: [],
  };
}

// ---------------------------------------------------------------------------
// Suite 1: getSamplesForProfession
// ---------------------------------------------------------------------------

describe('getSamplesForProfession', () => {
  describe('legal', () => {
    it('returns exactly 2 samples', () => {
      const samples = getSamplesForProfession('legal');
      expect(samples).toHaveLength(2);
    });

    it('first sample is the Matter Overview', () => {
      const samples = getSamplesForProfession('legal');
      expect(samples[0]!.filename).toBe('Sample - Matter Overview.md');
    });

    it('second sample is the Weekly Review', () => {
      const samples = getSamplesForProfession('legal');
      expect(samples[1]!.filename).toBe('Sample - Weekly Review.md');
    });

    it('Matter Overview content starts with a # Sample: heading', () => {
      const samples = getSamplesForProfession('legal');
      expect(samples[0]!.content).toMatch(/^# Sample:\s+/m);
    });

    it('Matter Overview content contains no em dashes (U+2014)', () => {
      const samples = getSamplesForProfession('legal');
      expect(samples[0]!.content).not.toContain('—');
    });

    it('Matter Overview content mentions the AI chat hint', () => {
      const samples = getSamplesForProfession('legal');
      // The spec requires a "Try asking:" hint at the bottom.
      expect(samples[0]!.content).toContain('Try asking:');
    });

    it('Matter Overview content references the fictional matter name', () => {
      const samples = getSamplesForProfession('legal');
      expect(samples[0]!.content).toContain('Garcia v. Meridian Properties LLC');
    });
  });

  describe('tax', () => {
    it('returns exactly 2 samples', () => {
      const samples = getSamplesForProfession('tax');
      expect(samples).toHaveLength(2);
    });

    it('first sample is the Client Research Note', () => {
      const samples = getSamplesForProfession('tax');
      expect(samples[0]!.filename).toBe('Sample - Client Research Note.md');
    });

    it('second sample is the Weekly Review', () => {
      const samples = getSamplesForProfession('tax');
      expect(samples[1]!.filename).toBe('Sample - Weekly Review.md');
    });

    it('Client Research Note content starts with a # Sample: heading', () => {
      const samples = getSamplesForProfession('tax');
      expect(samples[0]!.content).toMatch(/^# Sample:\s+/m);
    });

    it('Client Research Note content contains no em dashes (U+2014)', () => {
      const samples = getSamplesForProfession('tax');
      expect(samples[0]!.content).not.toContain('—');
    });

    it('Client Research Note content references IRC section 280A', () => {
      const samples = getSamplesForProfession('tax');
      expect(samples[0]!.content).toContain('280A');
    });

    it('Client Research Note content includes a verification reminder', () => {
      const samples = getSamplesForProfession('tax');
      expect(samples[0]!.content).toContain('Verification Reminder');
    });
  });

  describe('consulting', () => {
    it('returns exactly 2 samples', () => {
      const samples = getSamplesForProfession('consulting');
      expect(samples).toHaveLength(2);
    });

    it('first sample is the Engagement Summary', () => {
      const samples = getSamplesForProfession('consulting');
      expect(samples[0]!.filename).toBe('Sample - Engagement Summary.md');
    });

    it('second sample is the Weekly Review', () => {
      const samples = getSamplesForProfession('consulting');
      expect(samples[1]!.filename).toBe('Sample - Weekly Review.md');
    });

    it('Engagement Summary content starts with a # Sample: heading', () => {
      const samples = getSamplesForProfession('consulting');
      expect(samples[0]!.content).toMatch(/^# Sample:\s+/m);
    });

    it('Engagement Summary content contains no em dashes (U+2014)', () => {
      const samples = getSamplesForProfession('consulting');
      expect(samples[0]!.content).not.toContain('—');
    });

    it('Engagement Summary content includes the NDA / data-handling note', () => {
      const samples = getSamplesForProfession('consulting');
      // The spec requires a note about what should NOT be uploaded to cloud AI.
      expect(samples[0]!.content).toContain('NDA');
    });

    it('Engagement Summary content references the fictional client', () => {
      const samples = getSamplesForProfession('consulting');
      expect(samples[0]!.content).toContain('Hartwell');
    });
  });

  describe('other (generic fallback)', () => {
    it('returns exactly 3 samples', () => {
      const samples = getSamplesForProfession('other');
      expect(samples).toHaveLength(3);
    });

    it('does not include any profession-specific file', () => {
      const samples = getSamplesForProfession('other');
      const names = samples.map((s) => s.filename);
      expect(names).not.toContain('Sample - Matter Overview.md');
      expect(names).not.toContain('Sample - Client Research Note.md');
      expect(names).not.toContain('Sample - Engagement Summary.md');
    });

    it('includes the original generic samples', () => {
      const samples = getSamplesForProfession('other');
      const names = samples.map((s) => s.filename);
      expect(names).toContain('Sample - Weekly Review.md');
      expect(names).toContain('Sample - Client Intake.md');
      expect(names).toContain('Sample - Pricing Strategy.md');
    });
  });

  describe('content quality across all profession samples', () => {
    const professions = ['legal', 'tax', 'consulting', 'other'] as const;

    for (const p of professions) {
      it(`no sample for '${p}' contains an em dash`, () => {
        const samples = getSamplesForProfession(p);
        for (const s of samples) {
          expect(s.content, `${s.filename} contains an em dash`).not.toContain('—');
        }
      });

      it(`every sample for '${p}' is non-trivial (> 500 chars)`, () => {
        const samples = getSamplesForProfession(p);
        for (const s of samples) {
          expect(s.content.length, `${s.filename} is too short`).toBeGreaterThan(500);
        }
      });
    }
  });
});

// ---------------------------------------------------------------------------
// Suite 2: prioritizeByProfession
// ---------------------------------------------------------------------------

describe('prioritizeByProfession', () => {
  const legalA = stubTemplate('legal-a', 'legal');
  const legalB = stubTemplate('legal-b', 'legal');
  const taxA = stubTemplate('tax-a', 'tax');
  const consultingA = stubTemplate('consulting-a', 'consulting');
  const general1 = stubTemplate('kickoff-1', 'kickoff');
  const general2 = stubTemplate('analysis-1', 'analysis');

  const allTemplates = [general1, taxA, legalA, consultingA, legalB, general2];

  it("legal: legal templates float to the top, order is preserved within the group", () => {
    const result = prioritizeByProfession(allTemplates, 'legal');
    expect(result[0]!.id).toBe('legal-a');
    expect(result[1]!.id).toBe('legal-b');
  });

  it('legal: non-legal templates follow, original relative order preserved', () => {
    const result = prioritizeByProfession(allTemplates, 'legal');
    const rest = result.slice(2);
    // The non-legal templates from allTemplates: general1, taxA, consultingA, general2
    expect(rest.map((t) => t.id)).toEqual(['kickoff-1', 'tax-a', 'consulting-a', 'analysis-1']);
  });

  it('tax: tax templates float to the top', () => {
    const result = prioritizeByProfession(allTemplates, 'tax');
    expect(result[0]!.id).toBe('tax-a');
  });

  it('consulting: consulting templates float to the top', () => {
    const result = prioritizeByProfession(allTemplates, 'consulting');
    expect(result[0]!.id).toBe('consulting-a');
  });

  it('advisor: advisor templates float to the top', () => {
    const allWorkflows = ADVISOR_TEMPLATES.concat(allTemplates);
    const result = prioritizeByProfession(allWorkflows, 'advisor');
    const advisorIds = ADVISOR_TEMPLATES.map((t) => t.id);
    const topIds = result.slice(0, ADVISOR_TEMPLATES.length).map((w) => w.id);
    expect(topIds).toEqual(expect.arrayContaining(advisorIds));
  });

  it('advisor: non-advisor templates follow after reordering', () => {
    const allWorkflows = ADVISOR_TEMPLATES.concat(allTemplates);
    const result = prioritizeByProfession(allWorkflows, 'advisor');
    const nonAdvisorResults = result.slice(ADVISOR_TEMPLATES.length);
    const advisorIds = new Set(ADVISOR_TEMPLATES.map((t) => t.id));
    expect(nonAdvisorResults.every((t) => !advisorIds.has(t.id))).toBe(true);
  });

  it("other: returns the list unchanged (same array reference when no reordering needed)", () => {
    const result = prioritizeByProfession(allTemplates, 'other');
    expect(result).toBe(allTemplates);
  });

  it('returns the original reference when no templates match the profession', () => {
    const noLegal = [general1, taxA, general2];
    const result = prioritizeByProfession(noLegal, 'legal');
    expect(result).toBe(noLegal);
  });

  it('handles an empty template list without throwing', () => {
    const result = prioritizeByProfession([], 'legal');
    expect(result).toEqual([]);
  });

  it('total template count is unchanged after reordering', () => {
    const result = prioritizeByProfession(allTemplates, 'legal');
    expect(result).toHaveLength(allTemplates.length);
  });

  it('no templates are duplicated after reordering', () => {
    const result = prioritizeByProfession(allTemplates, 'legal');
    const ids = result.map((t) => t.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it('all original templates are still present after reordering', () => {
    const result = prioritizeByProfession(allTemplates, 'legal');
    for (const original of allTemplates) {
      expect(result.some((t) => t.id === original.id)).toBe(true);
    }
  });
});
