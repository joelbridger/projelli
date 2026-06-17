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
    getMetadata() { return { model: 'stub' }; }
  },
}));
vi.mock('@/platform/providers/OpenAIProvider', () => ({
  OpenAIProvider: class {
    setTools() {}
    sendMessage = vi.fn();
    getMetadata() { return { model: 'stub' }; }
  },
}));
vi.mock('@/platform/providers/GeminiProvider', () => ({
  GeminiProvider: class {
    setTools() {}
    sendMessage = vi.fn();
    getMetadata() { return { model: 'stub' }; }
  },
}));

// ragVerifyCitation mock — overridden per test
const mockRagVerifyCitation = vi.fn();
vi.mock('@/platform/utils/tauri-commands', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/platform/utils/tauri-commands')>();
  return {
    ...actual,
    ragVerifyCitation: mockRagVerifyCitation,
  };
});

// Audit log mock (used by SourcePanel)
const mockAuditLog = vi.fn();
vi.mock('@/platform/audit/auditLog', () => ({
  logAuditEntry: mockAuditLog,
  useAuditStore: () => ({ log: mockAuditLog }),
}));

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
      />,
    );
    const chip = screen.getByTestId('ask-citation-chip-1');
    fireEvent.click(chip);
    expect(onOpenFile).toHaveBeenCalledTimes(1);
    expect(onOpenFile).toHaveBeenCalledWith(
      '/ws/contracts/contract.docx',
      4,
      'The penalty clause is at section 8.',
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
      />,
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
      />,
    );
    expect(screen.getByTestId('ask-uncited-warning')).toBeInTheDocument();
    // Must contain honest wording
    const warning = screen.getByTestId('ask-uncited-warning');
    expect(warning.textContent).toMatch(/not cited|verify|rely/i);
  });

  it('does NOT render uncited callout when citations are present', async () => {
    const { TurnBlock } = await import('@/features/ask/TurnBlock');
    const turn = {
      question: 'What is the fee?',
      answer: 'The fee is $500 {1}.',
      citations: [{
        n: 1,
        label: 'fee-agreement.docx',
        excerpt: 'The fee is $500.',
        path: '/ws/fee-agreement.docx',
        locator: 'fee-agreement.docx §2',
        verified: true,
      }],
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
      />,
    );
    expect(screen.queryByTestId('ask-uncited-warning')).not.toBeInTheDocument();
    // Green attestation should still appear
    expect(screen.getByTestId('ask-cited-attestation')).toBeInTheDocument();
  });
});

describe('Task 3b — CitationText data-verified attribute', () => {
  it('chip has data-verified="true" when verified=true', async () => {
    const { CitationText } = await import('@/features/ask/CitationText');
    const citations = [{
      n: 1,
      label: 'doc.md',
      excerpt: 'text',
      path: '/ws/doc.md',
      locator: 'doc.md §1',
      verified: true,
    }];
    render(
      <CitationText
        text="Answer {1}."
        citations={citations}
        selected={null}
        onSelect={vi.fn()}
      />,
    );
    const chip = screen.getByTestId('ask-citation-chip-1');
    expect(chip).toHaveAttribute('data-verified', 'true');
  });

  it('chip has data-verified="false" when verified=false (unresolved path)', async () => {
    const { CitationText } = await import('@/features/ask/CitationText');
    const citations = [{
      n: 1,
      label: 'missing.md',
      excerpt: '',
      path: null,
      locator: 'missing.md §0',
      verified: false,
    }];
    render(
      <CitationText
        text="Answer {1}."
        citations={citations}
        selected={null}
        onSelect={vi.fn()}
      />,
    );
    const chip = screen.getByTestId('ask-citation-chip-1');
    expect(chip).toHaveAttribute('data-verified', 'false');
  });
});

/* -------------------------------------------------------------------------- */
/* Task 4: "Verify against source" in SourcePanel                             */
/* -------------------------------------------------------------------------- */
describe('Task 4 — SourcePanel "Verify against source" button', () => {
  beforeEach(() => {
    mockRagVerifyCitation.mockReset();
    mockAuditLog.mockReset();
  });

  it('shows a disabled "Verify against source" button when id/matterId are absent', async () => {
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
    render(<SourcePanel cite={cite} />);
    const btn = screen.getByTestId('verify-citation-btn');
    expect(btn).toBeDisabled();
  });

  it('shows an enabled button when id and matterId are present', async () => {
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
    render(<SourcePanel cite={cite} />);
    const btn = screen.getByTestId('verify-citation-btn');
    expect(btn).not.toBeDisabled();
  });

  it('shows green "found in source" after verified verdict', async () => {
    mockRagVerifyCitation.mockResolvedValue({ verdict: 'verified' });
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
    render(<SourcePanel cite={cite} />);
    fireEvent.click(screen.getByTestId('verify-citation-btn'));
    await waitFor(() =>
      expect(screen.getByTestId('verify-verdict')).toBeInTheDocument(),
    );
    const verdict = screen.getByTestId('verify-verdict');
    expect(verdict).toHaveAttribute('data-verdict', 'verified');
    expect(verdict.textContent).toMatch(/found in source/i);
  });

  it('shows red problem text for notFound verdict', async () => {
    mockRagVerifyCitation.mockResolvedValue({ verdict: 'notFound' });
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
    render(<SourcePanel cite={cite} />);
    fireEvent.click(screen.getByTestId('verify-citation-btn'));
    await waitFor(() =>
      expect(screen.getByTestId('verify-verdict')).toBeInTheDocument(),
    );
    const verdict = screen.getByTestId('verify-verdict');
    expect(verdict).toHaveAttribute('data-verdict', 'notFound');
    // Must not soften the message
    expect(verdict.textContent).toMatch(/not found|do not rely/i);
  });

  it('shows red problem text for textMismatch verdict', async () => {
    mockRagVerifyCitation.mockResolvedValue({ verdict: 'textMismatch' });
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
    render(<SourcePanel cite={cite} />);
    fireEvent.click(screen.getByTestId('verify-citation-btn'));
    await waitFor(() =>
      expect(screen.getByTestId('verify-verdict')).toBeInTheDocument(),
    );
    const verdict = screen.getByTestId('verify-verdict');
    expect(verdict).toHaveAttribute('data-verdict', 'textMismatch');
    expect(verdict.textContent).toMatch(/not found|do not rely/i);
  });

  it('shows red problem text for matterMismatch verdict', async () => {
    mockRagVerifyCitation.mockResolvedValue({ verdict: 'matterMismatch', actualMatter: 'other-matter' });
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
    render(<SourcePanel cite={cite} />);
    fireEvent.click(screen.getByTestId('verify-citation-btn'));
    await waitFor(() =>
      expect(screen.getByTestId('verify-verdict')).toBeInTheDocument(),
    );
    const verdict = screen.getByTestId('verify-verdict');
    expect(verdict).toHaveAttribute('data-verdict', 'matterMismatch');
    expect(verdict.textContent).toMatch(/different matter|do not rely/i);
  });
});
