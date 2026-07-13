import '@/i18n';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnswerCitation } from './askHelpers';
import { CitationText } from './CitationText';
import {
  citationTrustState,
  useCitationVerdictsStore,
  verifyKey,
  resetCitationVerificationForTests,
} from './citationVerification';
import { crmVerifyCitations } from '@/features/crm-ask/verification';

vi.mock('@/features/crm-ask/verification', () => ({
  crmVerifyCitations: vi.fn(),
}));

const verifyMock = vi.mocked(crmVerifyCitations);

function crmCitation(overrides: Partial<AnswerCitation> = {}): AnswerCitation {
  return {
    n: 1,
    label: 'Internal note',
    excerpt: 'Retire at 62',
    path: 'crm:note:note-1',
    locator: 'CRM note',
    // Bind-time flags a legacy build trusted blindly — they must NOT drive green.
    verified: true,
    grounded: true,
    sourceType: 'crm',
    id: 'crm:note:note-1',
    matterId: 'client-a',
    ...overrides,
  };
}

beforeEach(() => {
  resetCitationVerificationForTests();
  verifyMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('CRM trust label lies (Ask-seam defect #5)', () => {
  it('does NOT paint a CRM chip green until the live record is checked (matterMismatch)', async () => {
    verifyMock.mockResolvedValue([{ verdict: 'matterMismatch', actualMatter: 'client-b' }]);

    render(
      <CitationText
        text="The note says this. {1}"
        citations={[crmCitation()]}
        selected={null}
        onSelect={() => undefined}
      />,
    );

    const chip = screen.getByTestId('ask-citation-chip-1');
    // Even though the citation carries bind-time verified:true + grounded:true,
    // the live check refuted it — the chip must be a definitive NOT-verified.
    await waitFor(() => {
      expect(chip).toHaveAttribute('data-verified', 'false');
    });
    expect(chip).not.toHaveAttribute('data-verified', 'true');
  });

  it('stays neutral (never green) when the live CRM check is unavailable', async () => {
    // Browser/dev: the verifier throws → verdict settles 'unavailable'.
    verifyMock.mockRejectedValue(new Error('no backend'));

    render(
      <CitationText
        text="The note says this. {1}"
        citations={[crmCitation()]}
        selected={null}
        onSelect={() => undefined}
      />,
    );

    const chip = screen.getByTestId('ask-citation-chip-1');
    await waitFor(() => {
      expect(verifyMock).toHaveBeenCalled();
    });
    // Grounded-but-unverified: honest amber "source found, not verified",
    // NEVER the green data-verified='true' the bind-time flag would have given.
    expect(chip).not.toHaveAttribute('data-verified', 'true');
  });

  it('DOES paint green once the live record verifies (happy path preserved)', async () => {
    verifyMock.mockResolvedValue([{ verdict: 'verified' }]);

    render(
      <CitationText
        text="The note says this. {1}"
        citations={[crmCitation()]}
        selected={null}
        onSelect={() => undefined}
      />,
    );

    const chip = screen.getByTestId('ask-citation-chip-1');
    await waitFor(() => {
      expect(chip).toHaveAttribute('data-verified', 'true');
    });
  });
});

describe('citationTrustState no longer trusts grounded CRM blindly (defect #5)', () => {
  it('returns "checking" for a grounded CRM citation with no live verdict yet', () => {
    const cite = crmCitation();
    // Empty store: pre-fix this returned "verified" purely from grounded:true.
    expect(citationTrustState(cite, new Map())).toBe('checking');
  });

  it('maps a live matterMismatch verdict to "unverified"', () => {
    const cite = crmCitation();
    const verdicts = new Map([
      [verifyKey('crm:note:note-1', 'client-a', cite.excerpt), 'matterMismatch' as const],
    ]);
    expect(citationTrustState(cite, verdicts)).toBe('unverified');
    useCitationVerdictsStore.setState({ verdicts: new Map(), retryTick: 0 });
  });

  it('maps a live verified verdict to "verified"', () => {
    const cite = crmCitation();
    const verdicts = new Map([
      [verifyKey('crm:note:note-1', 'client-a', cite.excerpt), 'verified' as const],
    ]);
    expect(citationTrustState(cite, verdicts)).toBe('verified');
  });
});
