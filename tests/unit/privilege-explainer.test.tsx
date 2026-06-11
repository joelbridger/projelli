// F-121 (VG-5b) — privilege exclusion explained in-product.
//
// `summarizePrivilegeDiff` is the pure helper behind the "see it work"
// demonstration: it diffs a default retrieval (privileged excluded) against
// an include-privileged retrieval of the same question and reports what the
// exclusion withheld. The component tests render the explainer with a
// mocked demo runner and assert the one-sentence explanation plus each
// demo outcome (withheld / nothing withheld / desktop-only fallback).

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { summarizePrivilegeDiff } from '@/modules/memory/privilegeDiff';
import { PrivilegeExclusionExplainer } from '@/components/ai/PrivilegeExclusionExplainer';
import type { RetrievalScope } from '@/utils/tauri-commands';

describe('summarizePrivilegeDiff', () => {
  it('counts hits present only in the include-privileged result and names the top one', () => {
    const excluded = [{ id: 'a', path: '/w/notes/timeline.md' }];
    const included = [
      { id: 'p1', path: '/w/privileged/settlement-strategy.md' },
      { id: 'a', path: '/w/notes/timeline.md' },
      { id: 'p2', path: '/w/privileged/counsel-memo.md' },
    ];
    expect(summarizePrivilegeDiff(excluded, included)).toEqual({
      withheldCount: 2,
      topWithheldBasename: 'settlement-strategy.md',
    });
  });

  it('reports an empty diff when both retrievals return the same hits', () => {
    const hits = [
      { id: 'a', path: '/w/notes/timeline.md' },
      { id: 'b', path: '/w/notes/filings.md' },
    ];
    expect(summarizePrivilegeDiff(hits, hits)).toEqual({
      withheldCount: 0,
      topWithheldBasename: null,
    });
  });

  it('handles empty results from both queries', () => {
    expect(summarizePrivilegeDiff([], [])).toEqual({
      withheldCount: 0,
      topWithheldBasename: null,
    });
  });

  it('uses the path basename for the top withheld source label', () => {
    const result = summarizePrivilegeDiff(
      [],
      [{ id: 'x', path: 'C:\\workspace\\matters\\acme\\strategy memo.docx' }],
    );
    expect(result).toEqual({
      withheldCount: 1,
      topWithheldBasename: 'strategy memo.docx',
    });
  });
});

describe('PrivilegeExclusionExplainer', () => {
  const scope: RetrievalScope = { kind: 'allMatters' };

  function openExplainer() {
    fireEvent.click(screen.getByTestId('privilege-explainer-trigger'));
  }

  it('opens from the info trigger and explains the exclusion in one sentence', () => {
    render(
      <PrivilegeExclusionExplainer
        query="settlement strategy"
        scope={scope}
        retrieve={vi.fn()}
      />,
    );
    openExplainer();

    expect(screen.getByText('What does privilege exclusion do?')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Sources tagged privileged are filtered out of workspace retrieval itself, ' +
          'before anything reaches the AI. It is enforced in the search engine, not just a label.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByTestId('privilege-explainer-demo')).toHaveTextContent(
      'See it work on my own files',
    );
  });

  it('runs the question both ways and reports what the exclusion withheld', async () => {
    const excluded = [{ id: 'a', path: '/w/notes/timeline.md' }];
    const included = [
      { id: 'p1', path: '/w/privileged/settlement-strategy.md' },
      { id: 'a', path: '/w/notes/timeline.md' },
    ];
    const retrieve = vi.fn(
      (_q: string, _k: number, _s: RetrievalScope, includePrivileged: boolean) =>
        Promise.resolve(includePrivileged ? included : excluded),
    );
    render(
      <PrivilegeExclusionExplainer
        query="settlement strategy"
        scope={scope}
        retrieve={retrieve}
      />,
    );
    openExplainer();
    fireEvent.click(screen.getByTestId('privilege-explainer-demo'));

    await waitFor(() => {
      expect(screen.getByTestId('privilege-explainer-result')).toHaveTextContent(
        'Privilege exclusion is withholding 1 source(s) from this question right now. ' +
          'Top withheld source: settlement-strategy.md.',
      );
    });
    expect(retrieve).toHaveBeenCalledWith('settlement strategy', 8, scope, false);
    expect(retrieve).toHaveBeenCalledWith('settlement strategy', 8, scope, true);
  });

  it('says so honestly when nothing was withheld for this question', async () => {
    const hits = [{ id: 'a', path: '/w/notes/timeline.md' }];
    const retrieve = vi.fn(() => Promise.resolve(hits));
    render(
      <PrivilegeExclusionExplainer query="filing deadlines" scope={scope} retrieve={retrieve} />,
    );
    openExplainer();
    fireEvent.click(screen.getByTestId('privilege-explainer-demo'));

    await waitFor(() => {
      expect(screen.getByTestId('privilege-explainer-result')).toHaveTextContent(
        'No privileged sources matched this question, so nothing was withheld.',
      );
    });
  });

  it('falls back to the desktop-only note when retrieval throws (browser build)', async () => {
    const retrieve = vi.fn(() =>
      Promise.reject(new Error('RAG is only available in the desktop app.')),
    );
    render(
      <PrivilegeExclusionExplainer query="settlement strategy" scope={scope} retrieve={retrieve} />,
    );
    openExplainer();
    fireEvent.click(screen.getByTestId('privilege-explainer-demo'));

    await waitFor(() => {
      expect(screen.getByTestId('privilege-explainer-result')).toHaveTextContent(
        'This live check runs in the desktop app.',
      );
    });
  });

  it('disables the demo with a hint until there is a question to run', () => {
    const retrieve = vi.fn();
    render(<PrivilegeExclusionExplainer query="   " scope={scope} retrieve={retrieve} />);
    openExplainer();

    expect(screen.getByTestId('privilege-explainer-demo')).toBeDisabled();
    expect(
      screen.getByText('Type a question in the chat box first, then run this check.'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('privilege-explainer-demo'));
    expect(retrieve).not.toHaveBeenCalled();
  });
});
