import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';

import type { RagStatusSnapshot } from '@/platform/hooks/useRagStatus';
import { usePdfIndexProgressStore } from '@/platform/rag/pdfIndexProgressStore';
import { RagProgressBanner } from '@/platform/rag/ui/RagProgressBanner';

const idleStatus: RagStatusSnapshot = {
  status: 'idle',
  processed: 0,
  total: 0,
  currentPath: null,
  skipped: 0,
  failed: 0,
  timedOut: 0,
  cleanupFailed: 0,
  skippedPaths: [],
  migrating: false,
  reused: 0,
  reindexed: 0,
  deleted: 0,
};

afterEach(() => {
  cleanup();
  usePdfIndexProgressStore.getState().clear();
  vi.useRealTimers();
});

describe('RagProgressBanner PDF work', () => {
  it('stays hidden without real work, appears during indexing, and clears when work ends', () => {
    render(<RagProgressBanner status={idleStatus} />);
    expect(screen.queryByTestId('rag-progress-banner')).not.toBeInTheDocument();

    act(() => {
      usePdfIndexProgressStore.getState().set({
        processed: 0,
        total: 1,
        currentPath: 'C:/workspace/statement.pdf',
      });
    });
    expect(screen.getByTestId('rag-pdf-progress')).toHaveTextContent(
      'Indexing PDFs: 0 / 1'
    );

    act(() => {
      usePdfIndexProgressStore.getState().clear();
    });
    expect(screen.queryByTestId('rag-progress-banner')).not.toBeInTheDocument();
  });

  it('does not let an older run reclaim or clear a newer run', async () => {
    vi.useFakeTimers();
    const progress = usePdfIndexProgressStore.getState();
    progress.begin({ processed: 0, total: 2, currentPath: 'old.pdf' }, 'old-run');
    progress.begin({ processed: 0, total: 1, currentPath: 'new.pdf' }, 'new-run');

    progress.set({ processed: 2, total: 2, currentPath: 'old.pdf' }, 'old-run');
    progress.clearSoon('old-run');
    await vi.advanceTimersByTimeAsync(4000);

    expect(usePdfIndexProgressStore.getState().current?.currentPath).toBe('new.pdf');
    progress.clear('new-run');
  });
});
