/**
 * Unit tests for sampleMatterDemo — profession-aware demo data.
 *
 * Verifies that getDemoQuestions and getDemoAnswerForWorkspace return the
 * correct domain content for each profession. These tests run against the
 * real module (no mocks of sampleMatterDemo itself) so they catch regressions
 * in the data, not just the wiring.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock professionStore so getProfession() is controllable without localStorage.
let mockedProfession = 'legal';
vi.mock('@/stores/professionStore', () => ({
  useProfessionStore: (selector: (s: { profession: string }) => unknown) =>
    selector({ profession: mockedProfession }),
  getProfession: () => mockedProfession,
}));

import {
  getDemoQuestions,
  getDemoAnswerForWorkspace,
  getSampleMatterName,
} from '@/onboarding/samples/sampleMatterDemo';
import type { Profession } from '@/onboarding/professionModel';

beforeEach(() => {
  mockedProfession = 'legal';
});

// ─────────────────────────────────────────────────────────────────────────────
// getSampleMatterName
// ─────────────────────────────────────────────────────────────────────────────

describe('getSampleMatterName', () => {
  it('returns legal matter name for "legal"', () => {
    expect(getSampleMatterName('legal')).toBe('Garcia v. Meridian Properties LLC');
  });

  it('returns tax matter name for "tax"', () => {
    expect(getSampleMatterName('tax')).toBe('Dwyer - 2025 Form 1040');
  });

  it('returns consulting matter name for "consulting"', () => {
    expect(getSampleMatterName('consulting')).toBe('Northwind - Go-to-Market Engagement');
  });

  it('returns a non-empty string for all valid professions', () => {
    const professions: Profession[] = ['legal', 'tax', 'consulting', 'advisor', 'other'];
    for (const p of professions) {
      expect(getSampleMatterName(p).length).toBeGreaterThan(0);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getDemoQuestions
// ─────────────────────────────────────────────────────────────────────────────

describe('getDemoQuestions', () => {
  it('returns exactly 4 questions for every profession', () => {
    const professions: Profession[] = ['legal', 'tax', 'consulting', 'advisor', 'other'];
    for (const p of professions) {
      const questions = getDemoQuestions(p);
      expect(questions).toHaveLength(4);
    }
  });

  it('returns LEGAL questions for "legal" profession', () => {
    const questions = getDemoQuestions('legal');
    expect(questions[0]).toBe('What are the open issues in this matter?');
    expect(questions[1]).toBe('Summarize the Garcia matter for me.');
    expect(questions).toContain('What is the fee arrangement?');
  });

  it('returns TAX questions for "tax" profession', () => {
    const questions = getDemoQuestions('tax');
    expect(questions[0]).toBe('Can Diane deduct her home office?');
    expect(questions[1]).toBe('What open questions remain for the Dwyer return?');
    // Must NOT contain legal-specific questions
    expect(questions).not.toContain('Summarize the Garcia matter for me.');
    expect(questions).not.toContain('What is the status of the Meridian correspondence?');
  });

  it('returns CONSULTING questions for "consulting" profession', () => {
    const questions = getDemoQuestions('consulting');
    expect(questions[0]).toBe('What are the key findings so far?');
    expect(questions[1]).toBe('What is the engagement scope?');
    // Must NOT contain legal or tax questions
    expect(questions).not.toContain('Summarize the Garcia matter for me.');
    expect(questions).not.toContain('Can Diane deduct her home office?');
  });

  it('TAX questions all relate to tax domain (no HVAC or lease)', () => {
    const questions = getDemoQuestions('tax');
    const combined = questions.join(' ').toLowerCase();
    expect(combined).not.toContain('hvac');
    expect(combined).not.toContain('lease');
    expect(combined).not.toContain('garcia');
  });

  it('CONSULTING questions all relate to consulting domain', () => {
    const questions = getDemoQuestions('consulting');
    const combined = questions.join(' ').toLowerCase();
    expect(combined).not.toContain('garcia');
    expect(combined).not.toContain('deduct');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getDemoAnswerForWorkspace — profession routing
// ─────────────────────────────────────────────────────────────────────────────

describe('getDemoAnswerForWorkspace — profession routing', () => {
  const WORKSPACE = '/workspace/test';

  it('returns a TAX answer for a tax question when profession is "tax"', () => {
    const result = getDemoAnswerForWorkspace(
      'Can Diane deduct her home office?',
      WORKSPACE,
      'tax',
    );
    expect(result).not.toBeNull();
    expect(result!.answer).toContain('280A');
    expect(result!.citations.length).toBeGreaterThan(0);
  });

  it('returns null for a LEGAL question when profession is "tax"', () => {
    const result = getDemoAnswerForWorkspace(
      'Summarize the Garcia matter for me.',
      WORKSPACE,
      'tax',
    );
    expect(result).toBeNull();
  });

  it('returns null for a TAX question when profession is "legal"', () => {
    const result = getDemoAnswerForWorkspace(
      'Can Diane deduct her home office?',
      WORKSPACE,
      'legal',
    );
    expect(result).toBeNull();
  });

  it('returns a CONSULTING answer for a consulting question when profession is "consulting"', () => {
    const result = getDemoAnswerForWorkspace(
      'What are the key findings so far?',
      WORKSPACE,
      'consulting',
    );
    expect(result).not.toBeNull();
    expect(result!.answer).toContain('Springfield');
    expect(result!.citations.length).toBeGreaterThan(0);
  });

  it('returns null for a LEGAL question when profession is "consulting"', () => {
    const result = getDemoAnswerForWorkspace(
      'Summarize the Garcia matter for me.',
      WORKSPACE,
      'consulting',
    );
    expect(result).toBeNull();
  });

  it('returns null for a CONSULTING question when profession is "legal"', () => {
    const result = getDemoAnswerForWorkspace(
      'What are the key findings so far?',
      WORKSPACE,
      'legal',
    );
    expect(result).toBeNull();
  });

  it('returns a LEGAL answer for the original Garcia questions when profession is "legal"', () => {
    const result = getDemoAnswerForWorkspace(
      'Summarize the Garcia matter for me.',
      WORKSPACE,
      'legal',
    );
    expect(result).not.toBeNull();
    expect(result!.answer.toLowerCase()).toContain('garcia');
  });

  it('defaults to the current profession from getProfession() when no profession arg passed', () => {
    mockedProfession = 'tax';
    const result = getDemoAnswerForWorkspace(
      'Can Diane deduct her home office?',
      WORKSPACE,
    );
    expect(result).not.toBeNull();
    expect(result!.answer).toContain('280A');
  });

  it('defaults to legal (current profession) and returns null for a tax question', () => {
    mockedProfession = 'legal';
    const result = getDemoAnswerForWorkspace(
      'Can Diane deduct her home office?',
      WORKSPACE,
    );
    expect(result).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Citation path resolution
// ─────────────────────────────────────────────────────────────────────────────

describe('getDemoAnswerForWorkspace — path resolution', () => {
  it('resolves {WORKSPACE_ROOT} in tax citation paths', () => {
    const result = getDemoAnswerForWorkspace(
      'Can Diane deduct her home office?',
      '/my/workspace',
      'tax',
    );
    expect(result).not.toBeNull();
    for (const cite of result!.citations) {
      if (cite.path !== null) {
        expect(cite.path).toContain('/my/workspace');
        expect(cite.path).not.toContain('{WORKSPACE_ROOT}');
      }
    }
  });

  it('resolves {WORKSPACE_ROOT} in consulting citation paths', () => {
    const result = getDemoAnswerForWorkspace(
      'What is the engagement scope?',
      '/consulting/workspace',
      'consulting',
    );
    expect(result).not.toBeNull();
    for (const cite of result!.citations) {
      if (cite.path !== null) {
        expect(cite.path).toContain('/consulting/workspace');
        expect(cite.path).not.toContain('{WORKSPACE_ROOT}');
      }
    }
  });

  it('tax citations point to the Client Research Note file', () => {
    const result = getDemoAnswerForWorkspace(
      'Can Diane deduct her home office?',
      '/workspace',
      'tax',
    );
    expect(result).not.toBeNull();
    const paths = result!.citations.map((c) => c.path).filter(Boolean);
    expect(paths.some((p) => p!.includes('Client Research Note'))).toBe(true);
  });

  it('consulting citations point to the Engagement Summary file', () => {
    const result = getDemoAnswerForWorkspace(
      'What are the key findings so far?',
      '/workspace',
      'consulting',
    );
    expect(result).not.toBeNull();
    const paths = result!.citations.map((c) => c.path).filter(Boolean);
    expect(paths.some((p) => p!.includes('Engagement Summary'))).toBe(true);
  });

  it('all citations have verified: true', () => {
    const professionQuestionPairs: [Profession, string][] = [
      ['legal', 'What is the fee arrangement?'],
      ['tax', 'Can Diane deduct her home office?'],
      ['consulting', 'What are the key findings so far?'],
    ];
    for (const [prof, question] of professionQuestionPairs) {
      const result = getDemoAnswerForWorkspace(question, '/workspace', prof);
      expect(result).not.toBeNull();
      for (const cite of result!.citations) {
        expect(cite.verified).toBe(true);
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Content quality
// ─────────────────────────────────────────────────────────────────────────────

describe('demo content quality', () => {
  it('no tax answer contains an em dash (voice rule)', () => {
    const taxQuestions = [
      'Can Diane deduct her home office?',
      'What open questions remain for the Dwyer return?',
      'Which deduction method should we use?',
      'What is the exclusive-use test?',
    ];
    for (const q of taxQuestions) {
      const result = getDemoAnswerForWorkspace(q, '/workspace', 'tax');
      expect(result, `answer for "${q}" should exist`).not.toBeNull();
      expect(result!.answer, `answer for "${q}" must have no em dash`).not.toContain('—');
    }
  });

  it('no consulting answer contains an em dash (voice rule)', () => {
    const consultingQuestions = [
      'What are the key findings so far?',
      'What is the engagement scope?',
      'What are the next steps for Hartwell?',
      'Why does the Springfield facility have a longer fulfillment lag?',
    ];
    for (const q of consultingQuestions) {
      const result = getDemoAnswerForWorkspace(q, '/workspace', 'consulting');
      expect(result, `answer for "${q}" should exist`).not.toBeNull();
      expect(result!.answer, `answer for "${q}" must have no em dash`).not.toContain('—');
    }
  });

  it('all tax answers cite real excerpts from the Client Research Note', () => {
    const taxQuestions = [
      'Can Diane deduct her home office?',
      'What open questions remain for the Dwyer return?',
      'Which deduction method should we use?',
      'What is the exclusive-use test?',
    ];
    for (const q of taxQuestions) {
      const result = getDemoAnswerForWorkspace(q, '/workspace', 'tax');
      expect(result).not.toBeNull();
      expect(result!.citations.length).toBeGreaterThan(0);
      // Every citation label must be the Client Research Note
      for (const cite of result!.citations) {
        expect(cite.label).toBe('Sample - Client Research Note.md');
      }
    }
  });

  it('all consulting answers cite real excerpts from the Engagement Summary', () => {
    const consultingQuestions = [
      'What are the key findings so far?',
      'What is the engagement scope?',
      'What are the next steps for Hartwell?',
      'Why does the Springfield facility have a longer fulfillment lag?',
    ];
    for (const q of consultingQuestions) {
      const result = getDemoAnswerForWorkspace(q, '/workspace', 'consulting');
      expect(result).not.toBeNull();
      expect(result!.citations.length).toBeGreaterThan(0);
      for (const cite of result!.citations) {
        expect(cite.label).toBe('Sample - Engagement Summary.md');
      }
    }
  });
});
