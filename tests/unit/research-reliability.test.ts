/**
 * Workstream G — Research reliability tests.
 *
 * Verifies that:
 *   (a) TaxResearchMemo's systemPrompt contains the word "VERIFICATION"
 *   (b) requiresVerification is true on TaxResearchMemo, EvidenceGapAnalyzer,
 *       and PrivilegeLogDrafter
 *   (c) requiresVerification is true on EngagementLetterBuilder (all regulated
 *       templates carry the flag as of T2-1)
 */

import { describe, it, expect } from 'vitest';
import { TaxResearchMemo } from '@/modules/workflow/templates/tax/TaxResearchMemo';
import { EvidenceGapAnalyzer } from '@/modules/workflow/templates/legal/EvidenceGapAnalyzer';
import { PrivilegeLogDrafter } from '@/modules/workflow/templates/legal/PrivilegeLogDrafter';
import { EngagementLetterBuilder } from '@/modules/workflow/templates/tax/EngagementLetterBuilder';
import type { GenerateStepConfig } from '@/types/workflow';

/** Pull the systemPrompt from the first generate step of a template. */
function getSystemPrompt(template: { steps: { type: string; config: unknown }[] }): string {
  const step = template.steps.find((s) => s.type === 'generate');
  if (!step) throw new Error('No generate step found');
  return (step.config as GenerateStepConfig).systemPrompt ?? '';
}

describe('Workstream G — research reliability', () => {
  describe('TaxResearchMemo', () => {
    it('systemPrompt contains the word VERIFICATION', () => {
      const prompt = getSystemPrompt(TaxResearchMemo);
      expect(prompt).toContain('VERIFICATION');
    });

    it('requiresVerification is true', () => {
      expect(TaxResearchMemo.requiresVerification).toBe(true);
    });
  });

  describe('EvidenceGapAnalyzer', () => {
    it('requiresVerification is true', () => {
      expect(EvidenceGapAnalyzer.requiresVerification).toBe(true);
    });

    it('systemPrompt contains evidence grounding discipline instruction', () => {
      const prompt = getSystemPrompt(EvidenceGapAnalyzer);
      expect(prompt).toContain('Do not assert that a piece of evidence definitively exists or does not exist without a document basis');
    });
  });

  describe('PrivilegeLogDrafter', () => {
    it('requiresVerification is true', () => {
      expect(PrivilegeLogDrafter.requiresVerification).toBe(true);
    });

    it('systemPrompt contains privilege characterization flag instruction', () => {
      const prompt = getSystemPrompt(PrivilegeLogDrafter);
      expect(prompt).toContain('Flag any privilege characterization for attorney review');
    });
  });

  describe('EngagementLetterBuilder (regulated template — T2-1)', () => {
    it('requiresVerification is true', () => {
      expect(EngagementLetterBuilder.requiresVerification).toBe(true);
    });
  });
});
