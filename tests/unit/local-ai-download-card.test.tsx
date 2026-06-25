/**
 * LocalAiDownloadCard — the opt-in Keepance Local AI download PROGRESS banner.
 * It must stay invisible when there's nothing to show (idle/absent/ready) so the
 * big optional download never nags, and surface progress / errors while active.
 */

import { render, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LocalAiDownloadCard } from '@/platform/rag/ui/LocalAiDownloadCard';
import type { LocalLlmStatusSnapshot } from '@/platform/hooks/useLocalLlmModelStatus';

const makeSnap = (
  overrides: Partial<LocalLlmStatusSnapshot> = {},
): LocalLlmStatusSnapshot => ({
  state: 'idle',
  bytesDone: 0,
  bytesTotal: 2_497_280_736,
  message: null,
  stalled: false,
  start: vi.fn(),
  retry: vi.fn(),
  ...overrides,
});

describe('LocalAiDownloadCard', () => {
  it('renders nothing when idle, absent, or ready (no nag)', () => {
    for (const state of ['idle', 'absent', 'ready'] as const) {
      const { container } = render(
        <LocalAiDownloadCard status={makeSnap({ state })} />,
      );
      expect(container.firstChild).toBeNull();
    }
  });

  it('shows a progress bar with the right percentage while downloading', () => {
    const snap = makeSnap({
      state: 'downloading',
      bytesDone: 1_248_640_368, // exactly half of the total
      bytesTotal: 2_497_280_736,
    });
    const { getByTestId, getByRole } = render(
      <LocalAiDownloadCard status={snap} />,
    );
    expect(getByTestId('local-ai-download-card')).toBeInTheDocument();
    expect(getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50');
  });

  it('shows an error banner with a Resume button that calls retry', () => {
    const retry = vi.fn();
    const snap = makeSnap({ state: 'error', message: 'connection reset', retry });
    const { getByTestId, getByRole } = render(
      <LocalAiDownloadCard status={snap} />,
    );
    expect(getByTestId('local-ai-download-card')).toBeInTheDocument();
    fireEvent.click(getByRole('button'));
    expect(retry).toHaveBeenCalledOnce();
  });
});
