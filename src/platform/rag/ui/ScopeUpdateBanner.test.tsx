/**
 * QA-44 — ScopeUpdateBanner visibility test. The banner is the honest signal
 * that a privilege/client scope change has NOT yet applied to search, replacing
 * the old silent 'active' after a swallowed re-tag failure.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
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
    expect(screen.getByTestId('scope-update-message').textContent).toMatch(/updating search scope/i);
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
    expect(screen.getByTestId('scope-update-message').textContent).toMatch(/failed - retrying/i);
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
});
