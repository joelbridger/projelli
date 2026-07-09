/**
 * SourcePanel — citation verification retry during import (QA-92 round 2).
 *
 * Bug: verification verdicts are keyed by (id, matterId, excerpt) and never
 * retried once fetched. If the real backend check (`rag_verify_citations_batch`)
 * runs while boot repair / re-indexing is still in flight, a genuinely correct
 * source can transiently come back `notFound` / `matterMismatch` and then stay
 * falsely red forever, until the panel remounts.
 *
 * Fix: a negative verdict that lands while a content import is unsettled
 * (`useStillImporting` reporting anything other than `'idle'`) is held back —
 * the card stays "pending" — and is released for one retry the moment
 * indexing settles to idle.
 */
import '@/i18n';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SourcePanel } from './SourcePanel';
import {
  CITATION_VERDICT_CACHE_MAX_ENTRIES,
  getCitationVerificationCacheSnapshotForTests,
  handleRagContentInvalidatedForCitationVerification,
  handleRagIndexingProgressForCitationVerification,
  resetCitationVerificationForTests,
  verifyKey,
} from './citationVerification';
import type { AnswerCitation } from './askHelpers';
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

function makeCitation(overrides: Partial<AnswerCitation> = {}): AnswerCitation {
  return {
    n: 1,
    label: 'plan.docx',
    excerpt: 'The client wants to retire at 62.',
    path: 'clients/jane/plan.docx',
    locator: 'p.1',
    verified: false,
    id: 'chunk-1',
    matterId: 'matter-1',
    ...overrides,
  };
}

beforeEach(() => {
  // The verdict store is app-global (shared with the answer header) and
  // content-addressed - clear it so verdicts never leak across tests.
  resetCitationVerificationForTests();
  ragVerifyCitationsBatchMock.mockReset();
  useStillImportingMock.mockReset().mockReturnValue('idle');
});

describe('SourcePanel — negative verdicts during an active import (QA-92 round 2)', () => {
  it('shows the actual local source identities the AI read for the answer', () => {
    render(
      <SourcePanel
        citations={[]}
        readSources={[
          {
            id: 'clients/jane/plan.pdf',
            label: 'plan.pdf',
            path: 'clients/jane/plan.pdf',
            sourceType: 'pdf',
            locators: ['p. 2'],
            chunkCount: 2,
          },
        ]}
        selectedN={null}
        onSelect={() => {}}
      />,
    );

    const receipt = screen.getByTestId('source-panel-read-sources');
    expect(receipt.textContent).toContain('AI read');
    expect(receipt.textContent).toContain('plan.pdf (p. 2)');
    expect(receipt.textContent).toContain('2 chunks');
  });

  it('starts long source previews collapsed and expands them without opening the source', () => {
    ragVerifyCitationsBatchMock.mockResolvedValueOnce([
      { verdict: 'verified' } satisfies CitationVerdict,
    ]);
    const onSelect = vi.fn();
    const onOpenCitation = vi.fn();
    const cite = makeCitation({
      excerpt: [
        'Line one gives context.',
        'Line two adds a fact.',
        'Line three is still preview.',
        'Line four should start hidden until expanded.',
      ].join('\n'),
    });

    render(
      <SourcePanel
        citations={[cite]}
        selectedN={null}
        onSelect={onSelect}
        onOpenCitation={onOpenCitation}
      />,
    );

    expect(screen.getByTestId('source-card-preview').getAttribute('data-expanded')).toBe('false');
    fireEvent.click(screen.getByTestId('source-card-preview-toggle'));

    expect(screen.getByTestId('source-card-preview').getAttribute('data-expanded')).toBe('true');
    expect(onSelect).not.toHaveBeenCalled();
    expect(onOpenCitation).not.toHaveBeenCalled();
  });

  it('holds a negative verdict as pending while indexing is active, then retries and turns verified once idle', async () => {
    useStillImportingMock.mockReturnValue('importing');
    ragVerifyCitationsBatchMock.mockResolvedValueOnce([
      { verdict: 'notFound' } satisfies CitationVerdict,
    ]);

    const cite = makeCitation();
    const { rerender } = render(<SourcePanel citations={[cite]} selectedN={null} onSelect={() => {}} />);

    await waitFor(() => {
      expect(ragVerifyCitationsBatchMock).toHaveBeenCalledTimes(1);
    });

    // Held back — never renders the red problem line while indexing is active.
    expect(screen.queryByTestId('verify-verdict')).toBeNull();
    expect(screen.getByTestId('verify-status').dataset['state']).toBe('pending');

    ragVerifyCitationsBatchMock.mockResolvedValueOnce([
      { verdict: 'verified' } satisfies CitationVerdict,
    ]);
    useStillImportingMock.mockReturnValue('idle');
    rerender(<SourcePanel citations={[cite]} selectedN={null} onSelect={() => {}} />);

    await waitFor(() => {
      expect(ragVerifyCitationsBatchMock).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(screen.getByTestId('verify-status').dataset['state']).toBe('verified');
    });
  });

  it('shows a negative verdict as a real problem immediately when nothing is importing (existing behavior)', async () => {
    useStillImportingMock.mockReturnValue('idle');
    ragVerifyCitationsBatchMock.mockResolvedValueOnce([
      { verdict: 'notFound' } satisfies CitationVerdict,
    ]);

    const cite = makeCitation({ id: 'chunk-2' });
    render(<SourcePanel citations={[cite]} selectedN={null} onSelect={() => {}} />);

    await waitFor(() => {
      expect(screen.getByTestId('verify-verdict')).toBeTruthy();
    });
    expect(screen.getByTestId('verify-verdict').dataset['verdict']).toBe('notFound');
  });

  it('holds (and auto-retries) a negative verdict from a batch ISSUED while unsettled, even if indexing finishes before the result lands (round 2 race)', async () => {
    useStillImportingMock.mockReturnValue('importing');
    const firstCall = deferred<CitationVerdict[]>();
    ragVerifyCitationsBatchMock.mockReturnValueOnce(firstCall.promise);

    const cite = makeCitation({ id: 'chunk-race' });
    const { rerender } = render(<SourcePanel citations={[cite]} selectedN={null} onSelect={() => {}} />);

    await waitFor(() => {
      expect(ragVerifyCitationsBatchMock).toHaveBeenCalledTimes(1);
    });

    // Indexing settles to idle WHILE the first batch call is still in flight.
    useStillImportingMock.mockReturnValue('idle');
    rerender(<SourcePanel citations={[cite]} selectedN={null} onSelect={() => {}} />);

    // Primed for the automatic retry this race should still trigger.
    ragVerifyCitationsBatchMock.mockResolvedValueOnce([
      { verdict: 'verified' } satisfies CitationVerdict,
    ]);

    // The FIRST call — issued while unsettled — now resolves negative. Buggy
    // code would read `importUnsettledRef.current` (already false/idle) at
    // this point and store the negative directly, turning the card red
    // forever with no second call ever issued.
    firstCall.resolve([{ verdict: 'notFound' } satisfies CitationVerdict]);

    await waitFor(() => {
      expect(ragVerifyCitationsBatchMock).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(screen.getByTestId('verify-status').dataset['state']).toBe('verified');
    });
    expect(screen.queryByTestId('verify-verdict')).toBeNull();
  });

  it('stays pending (never held forever) when indexing is merely unknown, not confirmed importing', async () => {
    useStillImportingMock.mockReturnValue('unknown');
    ragVerifyCitationsBatchMock.mockResolvedValueOnce([
      { verdict: 'matterMismatch', actualMatter: 'other-matter' } satisfies CitationVerdict,
    ]);

    const cite = makeCitation({ id: 'chunk-3' });
    render(<SourcePanel citations={[cite]} selectedN={null} onSelect={() => {}} />);

    await waitFor(() => {
      expect(ragVerifyCitationsBatchMock).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByTestId('verify-verdict')).toBeNull();
    expect(screen.getByTestId('verify-status').dataset['state']).toBe('pending');
  });
});

describe('SourcePanel — shared citation verdict cache hardening', () => {
  it('bounds the shared verdict cache and evicts the same oldest keys from requested tracking', async () => {
    ragVerifyCitationsBatchMock.mockImplementation((batch: Array<{ quotedText: string }>) =>
      Promise.resolve(batch.map(() => ({ verdict: 'verified' } satisfies CitationVerdict))),
    );

    const citations = Array.from({ length: CITATION_VERDICT_CACHE_MAX_ENTRIES + 1 }, (_, i) =>
      makeCitation({
        n: i + 1,
        id: `chunk-lru-${String(i)}`,
        excerpt: `LRU quote ${String(i)}.`,
      }),
    );
    render(<SourcePanel citations={citations} selectedN={null} onSelect={() => {}} />);

    await waitFor(() => {
      expect(getCitationVerificationCacheSnapshotForTests().verdictKeys).toHaveLength(
        CITATION_VERDICT_CACHE_MAX_ENTRIES,
      );
    });

    const firstKey = verifyKey('chunk-lru-0', 'matter-1', 'LRU quote 0.');
    const snapshot = getCitationVerificationCacheSnapshotForTests();
    expect(snapshot.verdictKeys).not.toContain(firstKey);
    expect(snapshot.requestedKeys).not.toContain(firstKey);
    expect(snapshot.lruKeys).not.toContain(firstKey);
    expect(snapshot.requestedKeys).toHaveLength(CITATION_VERDICT_CACHE_MAX_ENTRIES);
    expect(snapshot.lruKeys).toHaveLength(CITATION_VERDICT_CACHE_MAX_ENTRIES);
  }, 30000);

  it('bounds held-for-retry keys together with requested tracking while indexing is unsettled', async () => {
    useStillImportingMock.mockReturnValue('importing');
    ragVerifyCitationsBatchMock.mockImplementation((batch: Array<{ quotedText: string }>) =>
      Promise.resolve(batch.map(() => ({ verdict: 'notFound' } satisfies CitationVerdict))),
    );

    const citations = Array.from({ length: CITATION_VERDICT_CACHE_MAX_ENTRIES + 1 }, (_, i) =>
      makeCitation({
        n: i + 1,
        id: `chunk-held-${String(i)}`,
        excerpt: `Held quote ${String(i)}.`,
      }),
    );
    render(<SourcePanel citations={citations} selectedN={null} onSelect={() => {}} />);

    await waitFor(() => {
      expect(getCitationVerificationCacheSnapshotForTests().heldForRetryKeys).toHaveLength(
        CITATION_VERDICT_CACHE_MAX_ENTRIES,
      );
    });

    const firstKey = verifyKey('chunk-held-0', 'matter-1', 'Held quote 0.');
    const snapshot = getCitationVerificationCacheSnapshotForTests();
    expect(snapshot.heldForRetryKeys).not.toContain(firstKey);
    expect(snapshot.requestedKeys).not.toContain(firstKey);
    expect(snapshot.lruKeys).not.toContain(firstKey);
  }, 30000);

  it('clears old verdicts on RAG indexing progress so changed source content gets checked again', async () => {
    const cite = makeCitation({ id: 'chunk-stale', excerpt: 'The old cached quote.' });
    ragVerifyCitationsBatchMock.mockResolvedValueOnce([
      { verdict: 'verified' } satisfies CitationVerdict,
    ]);

    const { rerender } = render(<SourcePanel citations={[cite]} selectedN={null} onSelect={() => {}} />);

    await waitFor(() => {
      expect(screen.getByTestId('verify-status').dataset['state']).toBe('verified');
    });
    expect(ragVerifyCitationsBatchMock).toHaveBeenCalledTimes(1);

    ragVerifyCitationsBatchMock.mockResolvedValueOnce([
      { verdict: 'textMismatch' } satisfies CitationVerdict,
    ]);
    handleRagIndexingProgressForCitationVerification({
      status: 'done',
      processed: 1,
      total: 1,
      currentPath: 'clients/jane/plan.docx',
      reindexed: 1,
    });
    rerender(<SourcePanel citations={[cite]} selectedN={null} onSelect={() => {}} />);

    await waitFor(() => {
      expect(ragVerifyCitationsBatchMock).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(screen.getByTestId('verify-verdict').dataset['verdict']).toBe('textMismatch');
    });
  });

  it('clears old verdicts on RAG content invalidation so deleted connector content gets checked again', async () => {
    const cite = makeCitation({ id: 'chunk-purged', excerpt: 'The cached connector quote.' });
    ragVerifyCitationsBatchMock.mockResolvedValueOnce([
      { verdict: 'verified' } satisfies CitationVerdict,
    ]);

    const { rerender } = render(<SourcePanel citations={[cite]} selectedN={null} onSelect={() => {}} />);

    await waitFor(() => {
      expect(screen.getByTestId('verify-status').dataset['state']).toBe('verified');
    });
    expect(ragVerifyCitationsBatchMock).toHaveBeenCalledTimes(1);

    ragVerifyCitationsBatchMock.mockResolvedValueOnce([
      { verdict: 'notFound' } satisfies CitationVerdict,
    ]);
    handleRagContentInvalidatedForCitationVerification({
      source: 'onedrive',
      deleted: 1,
    });
    rerender(<SourcePanel citations={[cite]} selectedN={null} onSelect={() => {}} />);

    await waitFor(() => {
      expect(ragVerifyCitationsBatchMock).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(screen.getByTestId('verify-verdict').dataset['verdict']).toBe('notFound');
    });
  });
});
