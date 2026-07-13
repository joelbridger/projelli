/**
 * QA-44 — ScopeUpdateBanner visibility test. The banner is the honest signal
 * that a privilege/client scope change has NOT yet applied to search, replacing
 * the old silent 'active' after a swallowed re-tag failure.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { ScopeUpdateBanner } from '@/platform/rag/ui/ScopeUpdateBanner';
import { useScopeUpdateStore } from '@/platform/rag/scopeUpdateStore';

const { queueDepth } = vi.hoisted(() => ({ queueDepth: vi.fn(() => Promise.resolve(0)) }));

vi.mock('@/platform/utils/tauri-commands', () => ({
  ragScopeWriteQueueDepth: queueDepth,
}));

afterEach(() => {
  cleanup();
  useScopeUpdateStore.getState().clearAll();
  queueDepth.mockReset();
  queueDepth.mockResolvedValue(0);
});

describe('ScopeUpdateBanner', () => {
  it('renders nothing when there are no scope updates', () => {
    render(<ScopeUpdateBanner />);
    expect(screen.queryByTestId('scope-update-banner')).toBeNull();
  });

  it('shows an updating message while a re-tag is retrying', () => {
    useScopeUpdateStore.getState().begin({ id: 'privilege:/ws/x', kind: 'privilege', label: 'x' });
    render(<ScopeUpdateBanner />);
    expect(screen.getByTestId('scope-update-message')).toHaveTextContent(
      'Applying your updated search privacy rules',
    );
    expect(screen.getByTestId('scope-update-message')).toHaveTextContent('0 of 1 privacy rules ready');
  });

  it('shows a failure message (rule not live yet) once a re-tag has failed', () => {
    useScopeUpdateStore.getState().begin({
      id: 'matter:/ws/Acme',
      kind: 'matter',
      label: 'Acme',
      excludeFolders: ['/ws/Acme'],
    });
    useScopeUpdateStore.getState().markFailed('matter:/ws/Acme');
    render(<ScopeUpdateBanner />);
    expect(screen.getByTestId('scope-update-message')).toHaveTextContent(
      'Client search update needs attention',
    );
    expect(screen.getByTestId('scope-update-message')).toHaveTextContent(
      'You can still open and read every client',
    );
    expect(screen.getByTestId('scope-update-message')).toHaveTextContent(
      'Some search results are paused',
    );
  });

  it('says queued instead of failed while another index writer has the store', async () => {
    queueDepth.mockResolvedValue(1);
    useScopeUpdateStore.getState().begin({
      id: 'matter:/ws/Acme',
      kind: 'matter',
      label: 'Acme',
      excludeFolders: ['/ws/Acme'],
    });
    render(<ScopeUpdateBanner />);
    await waitFor(() => {
      expect(screen.getByTestId('scope-update-message').textContent).toMatch(
        /queued behind another search update/i
      );
    });
    expect(screen.getByTestId('scope-update-message').textContent).not.toMatch(/failed/i);
  });

  it('names client preparation, advances its count, shows completion, then clears', async () => {
    vi.useFakeTimers();
    const store = useScopeUpdateStore.getState();
    for (const client of ['Abernathy', 'Brennan', 'Caldwell']) {
      store.begin({
        id: `matter:/ws/${client}`,
        kind: 'matter',
        label: client,
        excludeFolders: [`/ws/${client}`],
      });
    }
    render(<ScopeUpdateBanner />);

    expect(screen.getByTestId('scope-update-message')).toHaveTextContent(
      'Getting your client files ready for search',
    );
    expect(screen.getByTestId('scope-update-message')).toHaveTextContent('0 of 3 folders ready');

    act(() => { useScopeUpdateStore.getState().complete('matter:/ws/Abernathy'); });
    expect(screen.getByTestId('scope-update-message')).toHaveTextContent('1 of 3 folders ready');

    act(() => {
      useScopeUpdateStore.getState().complete('matter:/ws/Brennan');
      useScopeUpdateStore.getState().complete('matter:/ws/Caldwell');
    });
    expect(screen.getByTestId('scope-update-complete')).toHaveTextContent(
      'Your client files are ready for search',
    );

    await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
    expect(screen.queryByTestId('scope-update-banner')).not.toBeInTheDocument();
    vi.useRealTimers();
  });
});
