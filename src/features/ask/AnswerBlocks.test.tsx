/**
 * AnswerBlocks — header/summary badges must agree with the source cards
 * (lp/badge-consistency, dry-run Run-2 finding, evidence run2-06).
 *
 * Bug: the per-answer tally pills and the per-block trust labels derived
 * "verified" from the STATIC bind-time `AnswerCitation.verified` flag, while
 * the Sources cards (QA-85) show the REAL backend verifier's result
 * (`rag_verify_citations_batch`). A post-hoc citation the real check verifies
 * turned the card green while the header sat on "1 source found · not
 * verified" (amber) forever — two contradictory verification labels for the
 * same citation at the same moment.
 *
 * Fix under test: the header aggregates the SAME live per-citation verdicts
 * the cards show (shared verdict store), updates when verification completes,
 * and keeps honest tri-state semantics — a genuinely-unverified citation
 * stays amber in both places, and a real negative verdict downgrades even a
 * bind-time-verified citation.
 */
import '@/i18n';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { AnswerBlocks } from './AnswerBlocks';
import { resetCitationVerificationForTests } from './citationVerification';
import type { AnswerBlock, AnswerCitation } from './askHelpers';
import type { CitationVerdict } from '@/platform/utils/tauri-commands';
import type { ImportStatus } from './useStillImporting';

const { ragVerifyCitationsBatchMock, useStillImportingMock } = vi.hoisted(() => ({
  ragVerifyCitationsBatchMock: vi.fn(),
  useStillImportingMock: vi.fn<() => ImportStatus>(),
}));

vi.mock('@/platform/utils/tauri-commands', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/platform/utils/tauri-commands')>();
  return {
    ...original,
    ragVerifyCitationsBatch: (...args: unknown[]): unknown => ragVerifyCitationsBatchMock(...args),
  };
});

vi.mock('./useStillImporting', async (importOriginal) => {
  const original = await importOriginal<typeof import('./useStillImporting')>();
  return { ...original, useStillImporting: (): ImportStatus => useStillImportingMock() };
});

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

let uniqueId = 0;

function makeCitation(overrides: Partial<AnswerCitation> = {}): AnswerCitation {
  uniqueId += 1;
  return {
    n: 1,
    label: 'plan.docx',
    excerpt: `The client wants to retire at 62. (${String(uniqueId)})`,
    path: 'clients/jane/plan.docx',
    locator: 'p.1',
    verified: false,
    grounded: true,
    id: `chunk-${String(uniqueId)}`,
    matterId: 'matter-1',
    ...overrides,
  };
}

function filesBlock(citations: AnswerCitation[]): AnswerBlock {
  const chips = citations.map((c) => `{${String(c.n)}}`).join(' ');
  return { kind: 'files', text: `A cited claim from the files. ${chips}`, citations };
}

const generalBlock: AnswerBlock = {
  kind: 'general',
  text: 'Some general guidance to keep the tally-pill footer path active.',
  citations: [],
};

function renderBlocks(blocks: AnswerBlock[]) {
  return render(<AnswerBlocks blocks={blocks} selected={null} onSelect={() => {}} />);
}

beforeEach(() => {
  resetCitationVerificationForTests();
  ragVerifyCitationsBatchMock.mockReset();
  useStillImportingMock.mockReset().mockReturnValue('idle');
});

describe('AnswerBlocks — header badge agrees with the live citation verifier (run2-06)', () => {
  it('turns the header green once the real verifier confirms a post-hoc citation (no stuck amber)', async () => {
    // Post-hoc match: bind-time flag says NOT verified — the exact run2-06 shape.
    const cite = makeCitation({ verified: false });
    ragVerifyCitationsBatchMock.mockResolvedValue([
      { verdict: 'verified' } satisfies CitationVerdict,
    ]);

    renderBlocks([filesBlock([cite]), generalBlock]);

    // Once the card would read "Verified against source", the header must
    // agree: green cited pill present, amber "not verified" pill GONE.
    await waitFor(() => {
      expect(screen.getByTestId('ask-tally-cited')).toBeTruthy();
    });
    expect(screen.queryByTestId('ask-tally-unverified')).toBeNull();
    expect(screen.getByTestId('ask-block-label-files')).toBeTruthy();
    expect(screen.queryByTestId('ask-block-label-files-unverified')).toBeNull();
  });

  it('a real negative verdict keeps the header amber even for a bind-time-verified citation', async () => {
    // Reverse disagreement: static flag says verified, the REAL check refutes it.
    const cite = makeCitation({ verified: true });
    ragVerifyCitationsBatchMock.mockResolvedValue([
      { verdict: 'textMismatch' } satisfies CitationVerdict,
    ]);

    renderBlocks([filesBlock([cite]), generalBlock]);

    await waitFor(() => {
      expect(screen.getByTestId('ask-tally-unverified')).toBeTruthy();
    });
    expect(screen.queryByTestId('ask-tally-cited')).toBeNull();
    expect(screen.getByTestId('ask-block-label-files-unverified')).toBeTruthy();
  });

  it('a genuinely-unverified citation stays amber in the header (honest tri-state)', async () => {
    const cite = makeCitation({ verified: false });
    ragVerifyCitationsBatchMock.mockResolvedValue([
      { verdict: 'notFound' } satisfies CitationVerdict,
    ]);

    renderBlocks([filesBlock([cite]), generalBlock]);

    await waitFor(() => {
      expect(screen.getByTestId('ask-tally-unverified')).toBeTruthy();
    });
    expect(screen.queryByTestId('ask-tally-cited')).toBeNull();
    expect(screen.queryByTestId('ask-block-label-files')).toBeNull();
  });

  it('shows a neutral checking state while the verifier is still running — never a premature verdict', async () => {
    const cite = makeCitation({ verified: false });
    const gate = deferred<CitationVerdict[]>();
    ragVerifyCitationsBatchMock.mockReturnValue(gate.promise);

    renderBlocks([filesBlock([cite]), generalBlock]);

    await waitFor(() => {
      expect(screen.getByTestId('ask-tally-checking')).toBeTruthy();
    });
    expect(screen.queryByTestId('ask-tally-cited')).toBeNull();
    expect(screen.queryByTestId('ask-tally-unverified')).toBeNull();

    gate.resolve([{ verdict: 'verified' }]);
    await waitFor(() => {
      expect(screen.getByTestId('ask-tally-cited')).toBeTruthy();
    });
    expect(screen.queryByTestId('ask-tally-checking')).toBeNull();
  });

  it('keeps the header neutral when the checker cannot run at all (browser/dev)', async () => {
    // Two citations, one bind-time verified and one post-hoc; the real check
    // is unavailable (no backend). Neither one may turn the header green,
    // because no live quote check actually ran.
    const explicit = makeCitation({ n: 1, verified: true });
    const postHoc = makeCitation({ n: 2, verified: false });
    ragVerifyCitationsBatchMock.mockRejectedValue(new Error('no tauri backend'));

    renderBlocks([filesBlock([explicit]), filesBlock([postHoc]), generalBlock]);

    await waitFor(() => {
      expect(screen.getByTestId('ask-tally-checking')).toBeTruthy();
    });
    expect(screen.queryByTestId('ask-tally-cited')).toBeNull();
    expect(screen.queryByTestId('ask-tally-unverified')).toBeNull();
    expect(screen.getAllByTestId('ask-block-label-files-checking')).toHaveLength(2);
  });

  it('a pure-files answer earns the attestation only after live verification completes', async () => {
    const cite = makeCitation({ verified: false });
    const gate = deferred<CitationVerdict[]>();
    ragVerifyCitationsBatchMock.mockReturnValue(gate.promise);

    renderBlocks([filesBlock([cite])]);

    // Pending: no "every cited claim can be checked" attestation yet.
    expect(screen.queryByTestId('ask-cited-attestation')).toBeNull();

    gate.resolve([{ verdict: 'verified' }]);
    await waitFor(() => {
      expect(screen.getByTestId('ask-cited-attestation')).toBeTruthy();
    });
    expect(screen.queryByTestId('ask-tally-unverified')).toBeNull();
  });

  it('shows the per-answer receipt with verified claims, local sources, and provider route', async () => {
    const cite = makeCitation({ verified: false });
    ragVerifyCitationsBatchMock.mockResolvedValue([
      { verdict: 'verified' } satisfies CitationVerdict,
    ]);

    render(
      <AnswerBlocks
        blocks={[filesBlock([cite])]}
        selected={null}
        onSelect={() => {}}
        readSources={[
          {
            id: 'clients/jane/plan.docx',
            label: 'plan.docx',
            path: 'clients/jane/plan.docx',
            sourceType: 'docx',
            chunkCount: 1,
          },
        ]}
        providerId="openai"
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('ask-answer-receipt').textContent).toContain(
        '1 claim verified against 1 local source; sent direct to OpenAI; nothing to Lantern',
      );
    });
  });
});
