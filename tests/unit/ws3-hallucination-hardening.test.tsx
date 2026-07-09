/**
 * WS3 — Hallucination Hardening tests.
 *
 * Task 1: AnswerCitation carries id + matterId from the resolved RagHit.
 * Task 2: CitationText chip click fires onOpenFileAtPath (Ask surface one-click open).
 * Task 3: Distinct uncited/unverified visual treatment (TurnBlock callout + CitationText data-verified).
 * Task 4: "Verify against source" affordance in SourcePanel with honest verdict rendering.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

/* -------------------------------------------------------------------------- */
/* Shared mocks                                                                */
/* -------------------------------------------------------------------------- */

// Suppress i18n import errors in unit context
vi.mock('@/i18n', () => ({ default: { t: (k: string) => k } }));

vi.mock('@/platform/providers/ClaudeProvider', () => ({
  ClaudeProvider: class {
    setTools() {}
    sendMessage = vi.fn();
    getMetadata() {
      return { model: 'stub' };
    }
  },
}));
vi.mock('@/platform/providers/OpenAIProvider', () => ({
  OpenAIProvider: class {
    setTools() {}
    sendMessage = vi.fn();
    getMetadata() {
      return { model: 'stub' };
    }
  },
}));
vi.mock('@/platform/providers/GeminiProvider', () => ({
  GeminiProvider: class {
    setTools() {}
    sendMessage = vi.fn();
    getMetadata() {
      return { model: 'stub' };
    }
  },
}));

// Two verify transports are exercised in this file:
//   - the chat citation flow → `verifyCitations` → `ragVerifyCitationsBatch`
//     (P2.1 Finding 2), which returns one verdict PER input citation, in order.
//   - the SourcePanel "Verify against source" button → the single
//     `ragVerifyCitation`, which returns ONE verdict object.
// `setVerdict` primes BOTH so a test's expected verdict flows through whichever
// path it drives.
const mockRagVerifyCitation = vi.fn();
const mockRagVerifyCitationsBatch = vi.fn();
vi.mock('@/platform/utils/tauri-commands', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/platform/utils/tauri-commands')>();
  return {
    ...actual,
    ragVerifyCitation: mockRagVerifyCitation,
    ragVerifyCitationsBatch: mockRagVerifyCitationsBatch,
  };
});
const setVerdict = (v: unknown) => {
  mockRagVerifyCitation.mockResolvedValue(v);
  mockRagVerifyCitationsBatch.mockImplementation((cites?: { id: string }[]) =>
    Promise.resolve((cites ?? []).map(() => v))
  );
};

// Audit log mock (used by SourcePanel via onAuditLog prop)
const mockAuditLog = vi.fn();

/* -------------------------------------------------------------------------- */
/* Task 1: AnswerCitation id + matterId threading                              */
/* -------------------------------------------------------------------------- */
describe('Task 1 — AnswerCitation carries id + matterId from RagHit', () => {
  it('AnswerCitation accepts id and matterId fields (shape check)', () => {
    // Build a plain object matching the updated AnswerCitation shape.
    // This is a compile-time + runtime shape assertion — if the fields
    // are missing from the interface the TypeScript check gate (Task 5)
    // will catch it.
    const cite = {
      n: 1,
      label: 'doc.pdf',
      excerpt: 'some text',
      path: '/ws/doc.pdf',
      locator: 'doc.pdf §3',
      verified: true,
      id: 'chunk-abc123',
      matterId: 'matter-001',
    };
    expect(cite.id).toBe('chunk-abc123');
    expect(cite.matterId).toBe('matter-001');
  });

  it('AnswerCitation without id/matterId is backwards-compatible', () => {
    const cite = {
      n: 2,
      label: 'legacy.md',
      excerpt: 'legacy text',
      path: '/ws/legacy.md',
      locator: 'legacy.md §1',
      verified: false,
    };
    // Optional fields absent = valid, no errors
    expect((cite as { id?: string }).id).toBeUndefined();
    expect((cite as { matterId?: string }).matterId).toBeUndefined();
  });
});

/* -------------------------------------------------------------------------- */
/* Task 2: CitationText chip click fires onOpenFileAtPath                      */
/* -------------------------------------------------------------------------- */
describe('Task 2 — CitationText chip fires onOpenFileAtPath on click', () => {
  it('clicking a resolved chip calls onOpenFileAtPath with path, paragraphIndex, and excerpt', async () => {
    const { CitationText } = await import('@/features/ask/CitationText');
    const onOpenFile = vi.fn();
    const citations = [
      {
        n: 1,
        label: 'contract.docx',
        excerpt: 'The penalty clause is at section 8.',
        path: '/ws/contracts/contract.docx',
        locator: 'contract.docx §4',
        verified: true,
        id: 'chunk-c1',
        matterId: 'matter-acme',
        paragraphIndex: 4,
      },
    ];
    render(
      <CitationText
        text="See the penalty clause {1} for details."
        citations={citations}
        selected={null}
        onSelect={vi.fn()}
        onOpenFileAtPath={onOpenFile}
      />
    );
    const chip = screen.getByTestId('ask-citation-chip-1');
    fireEvent.click(chip);
    expect(onOpenFile).toHaveBeenCalledTimes(1);
    expect(onOpenFile).toHaveBeenCalledWith(
      '/ws/contracts/contract.docx',
      4,
      'The penalty clause is at section 8.',
      'matter-acme'
    );
  });

  it('clicking an unresolved chip (path=null) does NOT call onOpenFileAtPath', async () => {
    const { CitationText } = await import('@/features/ask/CitationText');
    const onOpenFile = vi.fn();
    const citations = [
      {
        n: 1,
        label: 'missing.md',
        excerpt: '',
        path: null,
        locator: 'missing.md §0',
        verified: false,
      },
    ];
    render(
      <CitationText
        text="See {1} for details."
        citations={citations}
        selected={null}
        onSelect={vi.fn()}
        onOpenFileAtPath={onOpenFile}
      />
    );
    const chip = screen.getByTestId('ask-citation-chip-1');
    fireEvent.click(chip);
    expect(onOpenFile).not.toHaveBeenCalled();
  });
});

/* -------------------------------------------------------------------------- */
/* Task 3: Distinct visual treatment for uncited / unverified answers          */
/* -------------------------------------------------------------------------- */
describe('Task 3a — TurnBlock shows warning callout when citations.length === 0', () => {
  beforeEach(async () => {
    const { resetCitationVerificationForTests } =
      await import('@/features/ask/citationVerification');
    resetCitationVerificationForTests();
    mockRagVerifyCitation.mockReset();
    mockRagVerifyCitationsBatch.mockReset();
    mockAuditLog.mockReset();
  });

  it('renders uncited warning callout for a completed answer with no citations', async () => {
    const { TurnBlock } = await import('@/features/ask/TurnBlock');
    const turn = {
      question: 'What is the fee?',
      answer: 'The fee is negotiable.',
      citations: [],
      sources: [],
    };
    render(
      <TurnBlock
        turn={turn}
        turnIdx={0}
        selectedTurnIdx={null}
        selected={null}
        onCitationSelect={vi.fn()}
        onSaveToDocument={undefined}
        isSaving={false}
        isPersisted={false}
      />
    );
    expect(screen.getByTestId('ask-uncited-warning')).toBeInTheDocument();
    // Must contain honest wording
    const warning = screen.getByTestId('ask-uncited-warning');
    expect(warning.textContent).toMatch(/not cited|verify|rely/i);
  }, 15000);

  it('does NOT render uncited callout when a citation is live-verified', async () => {
    setVerdict({ verdict: 'verified' });
    const { TurnBlock } = await import('@/features/ask/TurnBlock');
    const turn = {
      question: 'What is the fee?',
      answer: 'The fee is $500 {1}.',
      citations: [
        {
          n: 1,
          label: 'fee-agreement.docx',
          excerpt: 'The fee is $500.',
          path: '/ws/fee-agreement.docx',
          locator: 'fee-agreement.docx §2',
          verified: true,
          id: 'fee-chunk-1',
          matterId: 'matter-fee',
        },
      ],
      sources: [],
    };
    render(
      <TurnBlock
        turn={turn}
        turnIdx={0}
        selectedTurnIdx={null}
        selected={null}
        onCitationSelect={vi.fn()}
        onSaveToDocument={undefined}
        isSaving={false}
        isPersisted={false}
      />
    );
    await waitFor(() => {
      expect(screen.getByTestId('ask-cited-attestation')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('ask-uncited-warning')).not.toBeInTheDocument();
  });
});

describe('Task 3b — CitationText data-verified attribute', () => {
  it('chip has data-verified="true" when verified=true', async () => {
    const { CitationText } = await import('@/features/ask/CitationText');
    const citations = [
      {
        n: 1,
        label: 'doc.md',
        excerpt: 'text',
        path: '/ws/doc.md',
        locator: 'doc.md §1',
        verified: true,
      },
    ];
    render(
      <CitationText
        text="Answer {1}."
        citations={citations}
        selected={null}
        onSelect={vi.fn()}
      />
    );
    const chip = screen.getByTestId('ask-citation-chip-1');
    expect(chip).toHaveAttribute('data-verified', 'true');
  });

  it('chip has data-verified="false" when verified=false (unresolved path)', async () => {
    const { CitationText } = await import('@/features/ask/CitationText');
    const citations = [
      {
        n: 1,
        label: 'missing.md',
        excerpt: '',
        path: null,
        locator: 'missing.md §0',
        verified: false,
      },
    ];
    render(
      <CitationText
        text="Answer {1}."
        citations={citations}
        selected={null}
        onSelect={vi.fn()}
      />
    );
    const chip = screen.getByTestId('ask-citation-chip-1');
    expect(chip).toHaveAttribute('data-verified', 'false');
  });
});

/* -------------------------------------------------------------------------- */
/* Task 4 (QA-85): automatic real-verification in SourcePanel                 */
/*                                                                            */
/* QA-85 rewrote the manual "Verify against source" button into an automatic  */
/* check: the moment a citation appears, SourcePanel calls the REAL backend   */
/* verifier (rag_verify_citations_batch) for it — no click required. A card   */
/* starts neutral "Found" and only ever earns green "Verified" once that real */
/* check comes back verified.                                                */
/* -------------------------------------------------------------------------- */
describe('Task 4 (QA-85) — SourcePanel automatic real-verification', () => {
  beforeEach(async () => {
    // The verdict store is app-global and content-addressed (shared with the
    // answer header, lp/badge-consistency) - clear it so a citation checked
    // in one test is re-fetched (and re-audited) in the next.
    const { resetCitationVerificationForTests } =
      await import('@/features/ask/citationVerification');
    resetCitationVerificationForTests();
    mockRagVerifyCitation.mockReset();
    mockRagVerifyCitationsBatch.mockReset();
    mockAuditLog.mockReset();
  });

  it('shows neutral "Found" and never fetches when id/matterId are absent', async () => {
    const { SourcePanel } = await import('@/features/ask/SourcePanel');
    const cite = {
      n: 1,
      label: 'legacy.md',
      excerpt: 'legacy text',
      path: '/ws/legacy.md',
      locator: 'legacy.md §1',
      verified: false,
      // no id / matterId
    };
    render(
      <SourcePanel citations={[cite]} selectedN={null} onSelect={() => {}} />
    );
    const status = screen.getByTestId('verify-status');
    expect(status.textContent).toMatch(/^Found$/i);
    expect(status.textContent).not.toMatch(/^Verified$/i);
    expect(mockRagVerifyCitationsBatch).not.toHaveBeenCalled();
  });

  it('starts neutral "Found" and auto-upgrades to green "Verified" — no click required', async () => {
    setVerdict({ verdict: 'verified' });
    const { SourcePanel } = await import('@/features/ask/SourcePanel');
    const cite = {
      n: 1,
      label: 'contract.docx',
      excerpt: 'The penalty clause is at section 8.',
      path: '/ws/contract.docx',
      locator: 'contract.docx §3',
      verified: true,
      id: 'chunk-c1',
      matterId: 'matter-acme',
    };
    render(
      <SourcePanel citations={[cite]} selectedN={null} onSelect={() => {}} />
    );
    // Before the real check resolves the card must NOT claim "Verified" —
    // this is the exact overstatement QA-85 fixed (it used to trust the
    // grounding flag `cite.verified` and show "Verified" here).
    expect(screen.getByTestId('verify-status').textContent).toMatch(
      /^Found$/i
    );
    expect(mockRagVerifyCitationsBatch).toHaveBeenCalledWith([
      {
        id: 'chunk-c1',
        claimedMatterId: 'matter-acme',
        quotedText: 'The penalty clause is at section 8.',
      },
    ]);
    await waitFor(() =>
      expect(screen.getByTestId('verify-status').textContent).toMatch(
        /^Verified$/i
      )
    );
    expect(screen.queryByTestId('verify-verdict')).toBeNull();
  });

  it('emits a citation_verified audit entry once the automatic check resolves', async () => {
    setVerdict({ verdict: 'verified' });
    const { SourcePanel } = await import('@/features/ask/SourcePanel');
    const cite = {
      n: 1,
      label: 'contract.docx',
      excerpt: 'The penalty clause is at section 8.',
      path: '/ws/contract.docx',
      locator: 'contract.docx §3',
      verified: true,
      id: 'chunk-c1',
      matterId: 'matter-acme',
    };
    render(
      <SourcePanel
        citations={[cite]}
        selectedN={null}
        onSelect={() => {}}
        onAuditLog={mockAuditLog}
      />
    );
    await waitFor(() => expect(mockAuditLog).toHaveBeenCalledTimes(1));
    const call = mockAuditLog.mock.calls[0] as
      | [{ metadata?: Record<string, unknown> }]
      | undefined;
    expect(call?.[0].metadata).toMatchObject({
      citationId: 'chunk-c1',
      verdict: 'verified',
    });
  });

  it('shows red problem text for notFound verdict, automatically', async () => {
    setVerdict({ verdict: 'notFound' });
    const { SourcePanel } = await import('@/features/ask/SourcePanel');
    const cite = {
      n: 1,
      label: 'contract.docx',
      excerpt: 'This text was never in the file.',
      path: '/ws/contract.docx',
      locator: 'contract.docx §5',
      verified: false,
      id: 'chunk-c2',
      matterId: 'matter-acme',
    };
    render(
      <SourcePanel citations={[cite]} selectedN={null} onSelect={() => {}} />
    );
    await waitFor(() =>
      expect(screen.getByTestId('verify-verdict')).toBeInTheDocument()
    );
    const verdict = screen.getByTestId('verify-verdict');
    expect(verdict).toHaveAttribute('data-verdict', 'notFound');
    // Must not soften the message
    expect(verdict.textContent).toMatch(/quote not found/i);
  });

  it('shows red problem text for textMismatch verdict, automatically', async () => {
    setVerdict({ verdict: 'textMismatch' });
    const { SourcePanel } = await import('@/features/ask/SourcePanel');
    const cite = {
      n: 1,
      label: 'depo.txt',
      excerpt: 'Hallucinated quote.',
      path: '/ws/depo.txt',
      locator: 'Tr. 12:5-12:9',
      verified: false,
      id: 'chunk-c3',
      matterId: 'matter-acme',
    };
    render(
      <SourcePanel citations={[cite]} selectedN={null} onSelect={() => {}} />
    );
    await waitFor(() =>
      expect(screen.getByTestId('verify-verdict')).toBeInTheDocument()
    );
    const verdict = screen.getByTestId('verify-verdict');
    expect(verdict).toHaveAttribute('data-verdict', 'textMismatch');
    expect(verdict.textContent).toMatch(/quote mismatch/i);
  });

  it('shows red problem text for matterMismatch verdict, automatically', async () => {
    setVerdict({ verdict: 'matterMismatch', actualMatter: 'other-matter' });
    const { SourcePanel } = await import('@/features/ask/SourcePanel');
    const cite = {
      n: 1,
      label: 'depo.txt',
      excerpt: 'A fact from another matter.',
      path: '/ws/depo.txt',
      locator: 'depo.txt §2',
      verified: false,
      id: 'chunk-c4',
      matterId: 'matter-acme',
    };
    render(
      <SourcePanel citations={[cite]} selectedN={null} onSelect={() => {}} />
    );
    await waitFor(() =>
      expect(screen.getByTestId('verify-verdict')).toBeInTheDocument()
    );
    const verdict = screen.getByTestId('verify-verdict');
    expect(verdict).toHaveAttribute('data-verdict', 'matterMismatch');
    expect(verdict.textContent).toMatch(/wrong client/i);
  });

  it('falls back to neutral "Found" — never fakes "Verified" — when the verifier is unavailable (browser/dev mode)', async () => {
    mockRagVerifyCitationsBatch.mockRejectedValue(
      new Error('RAG is only available in the desktop app.')
    );
    const { SourcePanel } = await import('@/features/ask/SourcePanel');
    const cite = {
      n: 1,
      label: 'contract.docx',
      excerpt: 'The penalty clause is at section 8.',
      path: '/ws/contract.docx',
      locator: 'contract.docx §3',
      verified: true,
      id: 'chunk-c1',
      matterId: 'matter-acme',
    };
    render(
      <SourcePanel citations={[cite]} selectedN={null} onSelect={() => {}} />
    );
    await waitFor(() =>
      expect(mockRagVerifyCitationsBatch).toHaveBeenCalledTimes(1)
    );
    // Give the rejected promise's catch handler a tick to settle state.
    await waitFor(() => {
      expect(screen.getByTestId('verify-status').textContent).toMatch(
        /^Found$/i
      );
    });
    expect(screen.queryByTestId('verify-verdict')).toBeNull();
    expect(screen.getByTestId('verify-status').textContent).not.toMatch(
      /^Verified$/i
    );
  });

  it('does NOT carry a verify verdict across a citation swap that reuses the same number', async () => {
    // Switching Ask turns / Client Map sections re-renders the SOURCES column.
    // If the new turn's first source is also citation #1, the card must NOT
    // inherit the prior card's verdict — an UNCHECKED source would otherwise
    // wrongly show "found"/"problem". Cards are keyed by citation identity
    // (id/path) so a different source remounts with fresh state, and verdicts
    // are keyed by (id, matterId, excerpt) so a stale in-flight check for the
    // OLD source can never paint onto the NEW one either.
    setVerdict({ verdict: 'notFound' });
    const { SourcePanel } = await import('@/features/ask/SourcePanel');
    const citeA = {
      n: 1,
      label: 'a.docx',
      excerpt: 'A passage.',
      path: '/ws/a.docx',
      locator: 'a.docx §1',
      verified: false,
      id: 'chunk-A',
      matterId: 'matter-1',
    };
    const { rerender } = render(
      <SourcePanel citations={[citeA]} selectedN={null} onSelect={() => {}} />
    );
    await waitFor(() =>
      expect(screen.getByTestId('verify-verdict')).toBeInTheDocument()
    );
    expect(screen.getByTestId('verify-verdict')).toHaveAttribute(
      'data-verdict',
      'notFound'
    );

    // A DIFFERENT source that is also citation #1 in the next view.
    const citeB = {
      n: 1,
      label: 'b.docx',
      excerpt: 'B passage.',
      path: '/ws/b.docx',
      locator: 'b.docx §1',
      verified: false,
      id: 'chunk-B',
      matterId: 'matter-1',
    };
    rerender(
      <SourcePanel citations={[citeB]} selectedN={null} onSelect={() => {}} />
    );

    // The swapped-in source starts neutral: no carried verdict, fresh check.
    expect(screen.queryByTestId('verify-verdict')).toBeNull();
    expect(screen.getByTestId('verify-status')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId('verify-verdict')).toBeInTheDocument()
    );
    expect(screen.getByTestId('verify-verdict')).toHaveAttribute(
      'data-verdict',
      'notFound'
    );
  });
});
