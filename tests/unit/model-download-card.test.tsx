/**
 * ModelDownloadCard render contract:
 *  - idle / ready → renders nothing
 *  - downloading with a known total → title, MB-of-MB text, progressbar
 *  - downloading with unknown total → MB-so-far text
 *  - stalled mid-transfer → distinct stalled line, progress bar stays,
 *    NO Resume button (restarting the app is the only honest remedy)
 *  - error → error title + Resume button wired to retry()
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ModelDownloadCard } from '@/components/memory/ModelDownloadCard';

const MB = 1024 * 1024;

function snap(over: Record<string, unknown>) {
  return {
    state: 'idle',
    bytesDone: 0,
    bytesTotal: null,
    message: null,
    stalled: false,
    retry: vi.fn(),
    ...over,
  } as never;
}

describe('ModelDownloadCard', () => {
  it('renders nothing when idle or ready', () => {
    const { container, rerender } = render(
      <ModelDownloadCard status={snap({ state: 'idle' })} />,
    );
    expect(container.firstChild).toBeNull();
    rerender(<ModelDownloadCard status={snap({ state: 'ready' })} />);
    expect(container.firstChild).toBeNull();
  });

  it('shows progress with a known total', () => {
    render(
      <ModelDownloadCard
        status={snap({
          state: 'downloading',
          bytesDone: 100 * MB,
          bytesTotal: 465 * MB,
        })}
      />,
    );
    expect(screen.getByTestId('model-download-card')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
    // The body copy also mentions "465 MB", so assert the full
    // interpolated progress line rather than a bare /465 MB/.
    expect(screen.getByText(/100 MB of 465 MB/)).toBeInTheDocument();
  });

  it('shows MB-so-far when total is unknown', () => {
    render(
      <ModelDownloadCard
        status={snap({ state: 'downloading', bytesDone: 42 * MB })}
      />,
    );
    expect(screen.getByText(/42 MB/)).toBeInTheDocument();
  });

  it('shows the stalled line, keeps the progress bar, and offers NO resume button when stalled', () => {
    render(
      <ModelDownloadCard
        status={snap({
          state: 'downloading',
          bytesDone: 100 * MB,
          bytesTotal: 465 * MB,
          stalled: true,
        })}
      />,
    );
    // Distinct stalled copy replaces the normal body line.
    expect(screen.getByText(/looks stuck/i)).toBeInTheDocument();
    expect(
      screen.queryByText(/downloading its private search engine/i),
    ).toBeNull();
    // Progress bar stays visible.
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
    // Resume belongs to the error state only.
    expect(screen.queryByRole('button', { name: /resume/i })).toBeNull();
  });

  it('shows a resume button on error that calls retry', () => {
    const retry = vi.fn();
    render(
      <ModelDownloadCard
        status={snap({ state: 'error', message: 'network unreachable', retry })}
      />,
    );
    const btn = screen.getByRole('button', { name: /resume/i });
    fireEvent.click(btn);
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
