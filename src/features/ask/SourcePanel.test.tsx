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
import { render, screen, waitFor } from '@testing-library/react';
import { SourcePanel } from './SourcePanel';
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
  ragVerifyCitationsBatchMock.mockReset();
  useStillImportingMock.mockReset().mockReturnValue('idle');
});

describe('SourcePanel — negative verdicts during an active import (QA-92 round 2)', () => {
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
