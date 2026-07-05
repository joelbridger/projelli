/**
 * QA-56 (P1) — SourcePanel citation-verify stale-async guard.
 *
 * The SOURCES cards are keyed by citation identity (id + matterId), so a card
 * whose id/matterId changes remounts with fresh state. This test closes the
 * residual gap: while a verify is in flight, the SAME card's cite can change
 * in place (same id/matterId, different quoted excerpt). The late verdict —
 * computed for the OLD excerpt — must NOT paint onto the new quote.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

const { mockRagVerifyCitation } = vi.hoisted(() => ({ mockRagVerifyCitation: vi.fn() }));
vi.mock('@/platform/utils/tauri-commands', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/platform/utils/tauri-commands')>();
  return { ...actual, ragVerifyCitation: mockRagVerifyCitation };
});

import { SourcePanel } from '@/features/ask/SourcePanel';

type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

beforeEach(() => {
  mockRagVerifyCitation.mockReset();
});

describe('SourcePanel — QA-56 stale citation-verify isolation', () => {
  it('does not paint a late verdict onto a card whose quote changed mid-verify', async () => {
    const d = deferred<{ verdict: string }>();
    mockRagVerifyCitation.mockReturnValue(d.promise);

    const citeA = {
      n: 1, label: 'contract.docx', excerpt: 'Original quote A.',
      path: '/ws/contract.docx', locator: 'contract.docx §3',
      verified: false, id: 'chunk-X', matterId: 'matter-1',
    };
    const { rerender } = render(
      <SourcePanel citations={[citeA]} selectedN={null} onSelect={() => {}} />,
    );
    fireEvent.click(screen.getByTestId('verify-citation-btn'));

    // Same identity (id + matterId), but the quoted excerpt changed in place —
    // the card stays mounted (key unchanged) and now shows a DIFFERENT quote.
    const citeB = { ...citeA, excerpt: 'A totally different quote B.' };
    rerender(<SourcePanel citations={[citeB]} selectedN={null} onSelect={() => {}} />);

    // The verify for the OLD quote resolves LATE with a problem verdict.
    await act(async () => {
      d.resolve({ verdict: 'notFound' });
      await Promise.resolve();
      await Promise.resolve();
    });

    // The stale verdict must NOT be shown against the new quote.
    await waitFor(() => {
      expect(screen.queryByTestId('verify-verdict')).toBeNull();
    });
    // ...and the verify button must be actionable again (not stuck on 'loading'),
    // so the user can re-verify the CURRENT quote.
    expect(screen.getByTestId('verify-citation-btn')).toBeInTheDocument();
    expect(screen.getByTestId('verify-citation-btn')).not.toBeDisabled();
  });
});
