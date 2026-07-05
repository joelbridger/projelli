/**
 * QA-57 (P1) — PrivilegeExclusionExplainer stale-async demo guard.
 *
 * Scenario: the "see it work" demo runs retrieval for question A. The user
 * changes the question (or client scope) while it is running. The late result
 * must NOT render as if it proves the exclusion for the NEW question — that
 * would show wrong-context proof to the user.
 */
import '@/i18n';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { PrivilegeExclusionExplainer } from '@/features/ask/PrivilegeExclusionExplainer';
import type { RetrievalScope } from '@/platform/utils/tauri-commands';

type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

describe('PrivilegeExclusionExplainer — QA-57 stale-async question isolation', () => {
  const scope: RetrievalScope = { kind: 'allMatters' };

  it('drops a late demo result after the question changes', async () => {
    const excludedA = deferred<{ id: string; path: string }[]>();
    const includedA = deferred<{ id: string; path: string }[]>();
    const retrieve = vi.fn((_q: string, _k: number, _s: RetrievalScope, incl: boolean) =>
      incl ? includedA.promise : excludedA.promise,
    );

    const { rerender } = render(
      <PrivilegeExclusionExplainer query="question A" scope={scope} retrieve={retrieve} />,
    );
    fireEvent.click(screen.getByTestId('privilege-explainer-trigger'));
    fireEvent.click(screen.getByTestId('privilege-explainer-demo'));

    // User changes the question while the demo for A is still running.
    rerender(
      <PrivilegeExclusionExplainer query="question B" scope={scope} retrieve={retrieve} />,
    );

    // A's retrieval resolves LATE, would have withheld 1 source.
    await act(async () => {
      excludedA.resolve([{ id: 'a', path: '/w/notes/timeline.md' }]);
      includedA.resolve([
        { id: 'p1', path: '/w/privileged/A-settlement-strategy.md' },
        { id: 'a', path: '/w/notes/timeline.md' },
      ]);
      await Promise.resolve();
      await Promise.resolve();
    });

    // The stale result for question A must not be presented as the answer for B.
    await waitFor(() => {
      expect(screen.queryByTestId('privilege-explainer-result')).toBeNull();
    });
  });
});
