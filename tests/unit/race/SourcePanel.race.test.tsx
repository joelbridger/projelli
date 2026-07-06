/**
 * QA-56 (P1) / QA-85 — SourcePanel citation-verify stale-async guard.
 *
 * QA-85 replaced the manual "Verify against source" button with an automatic
 * check: the moment a citation appears, SourcePanel fires the REAL backend
 * verifier for it (batched, no click). This test locks in that the async race
 * QA-56 fixed still holds under the automatic design: verdicts are keyed by
 * (id, matterId, EXCERPT), so a citation whose quoted excerpt changes in place
 * (same card identity, new quote) can never show a verdict computed for the
 * OLD quote — the old key's late-arriving result lands under a key nobody
 * reads anymore.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';

const { mockRagVerifyCitationsBatch } = vi.hoisted(() => ({ mockRagVerifyCitationsBatch: vi.fn() }));
vi.mock('@/platform/utils/tauri-commands', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/platform/utils/tauri-commands')>();
  return { ...actual, ragVerifyCitationsBatch: mockRagVerifyCitationsBatch };
});

import { SourcePanel } from '@/features/ask/SourcePanel';
import { resetCitationVerificationForTests } from '@/features/ask/citationVerification';

type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

beforeEach(() => {
  // The verdict store is app-global and content-addressed (shared with the
  // answer header, lp/badge-consistency) — clear it between tests.
  resetCitationVerificationForTests();
  mockRagVerifyCitationsBatch.mockReset();
});

describe('SourcePanel — QA-56/QA-85 stale citation-verify isolation', () => {
  it('does not paint a late verdict onto a card whose quote changed mid-verify', async () => {
    const dA = deferred<{ verdict: string }[]>();
    const dB = deferred<{ verdict: string }[]>();
    mockRagVerifyCitationsBatch.mockImplementation((cites: { quotedText: string }[]) => {
      const quote = cites[0]?.quotedText;
      if (quote === 'Original quote A.') return dA.promise;
      if (quote === 'A totally different quote B.') return dB.promise;
      throw new Error(`unexpected quote: ${String(quote)}`);
    });

    const citeA = {
      n: 1, label: 'contract.docx', excerpt: 'Original quote A.',
      path: '/ws/contract.docx', locator: 'contract.docx §3',
      verified: false, id: 'chunk-X', matterId: 'matter-1',
    };
    const { rerender } = render(
      <SourcePanel citations={[citeA]} selectedN={null} onSelect={() => {}} />,
    );
    await waitFor(() => expect(mockRagVerifyCitationsBatch).toHaveBeenCalledTimes(1));

    // Same identity (id + matterId), but the quoted excerpt changed in place —
    // the card stays mounted (key unchanged) and now shows a DIFFERENT quote,
    // firing a SECOND, independent batch check for the new excerpt.
    const citeB = { ...citeA, excerpt: 'A totally different quote B.' };
    rerender(<SourcePanel citations={[citeB]} selectedN={null} onSelect={() => {}} />);
    await waitFor(() => expect(mockRagVerifyCitationsBatch).toHaveBeenCalledTimes(2));

    // The verify for the OLD quote resolves LATE with a problem verdict.
    await act(async () => {
      dA.resolve([{ verdict: 'notFound' }]);
      await Promise.resolve();
      await Promise.resolve();
    });

    // The stale verdict for quote A must NOT be shown against quote B's card —
    // B's own check is still pending, so the card stays neutral.
    expect(screen.queryByTestId('verify-verdict')).toBeNull();
    expect(screen.getByTestId('verify-status').textContent).toMatch(/source found/i);

    // Now B's own check resolves — its verdict (and only its verdict) shows.
    await act(async () => {
      dB.resolve([{ verdict: 'notFound' }]);
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByTestId('verify-verdict')).toBeInTheDocument());
    expect(screen.getByTestId('verify-verdict')).toHaveAttribute('data-verdict', 'notFound');
  });

  it('a citation whose verify was in flight when it disappeared upgrades from that SAME batch when it reappears (QA-85 round 2, reworked for the shared store)', async () => {
    // QA-85 round 2 guaranteed a citation that vanished mid-verify and then
    // reappeared never sat "pending" forever. The original mechanism dropped
    // the abandoned batch's result and RE-FETCHED on reappearance (2 backend
    // calls + 2 audit entries). lp/badge-consistency moved verdicts into a
    // shared, content-addressed store: an in-flight batch's result now ALWAYS
    // lands (verdicts are keyed by id+matterId+excerpt, so they are valid for
    // whoever shows the citation next), and the reappearing citation upgrades
    // from the FIRST call — same user-visible guarantee, no duplicate fetch.
    const deferreds: Deferred<{ verdict: string }[]>[] = [];
    mockRagVerifyCitationsBatch.mockImplementation(() => {
      const d = deferred<{ verdict: string }[]>();
      deferreds.push(d);
      return d.promise;
    });

    const cite = {
      n: 1, label: 'plan.docx', excerpt: 'A durable quote.',
      path: '/ws/plan.docx', locator: 'plan.docx §2',
      verified: false, id: 'chunk-Z', matterId: 'matter-9',
    };

    const { rerender } = render(
      <SourcePanel citations={[cite]} selectedN={null} onSelect={() => {}} />,
    );
    await waitFor(() => expect(mockRagVerifyCitationsBatch).toHaveBeenCalledTimes(1));

    // The citation disappears (e.g. the user switches away) BEFORE the first
    // batch resolves...
    rerender(<SourcePanel citations={[]} selectedN={null} onSelect={() => {}} />);

    // ...then the SAME citation (same id/matterId/excerpt) reappears. The
    // first batch is still in flight — single-flight dedup means NO second
    // backend call is issued for the same content key.
    rerender(<SourcePanel citations={[cite]} selectedN={null} onSelect={() => {}} />);
    expect(mockRagVerifyCitationsBatch).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('verify-status').textContent).toMatch(/source found/i);

    // The in-flight batch resolves — its result lands in the shared store and
    // the reappeared card upgrades normally: never stuck pending.
    await act(async () => {
      deferreds[0]!.resolve([{ verdict: 'verified' }]);
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(screen.getByTestId('verify-status').textContent).toMatch(/verified against source/i),
    );
  });
});
