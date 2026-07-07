/**
 * LocalAiSettingsControl — the user-facing "Download Lantern Local AI" control.
 * Drives the opt-in download: a button when absent, progress while running, a
 * ready confirmation, and a resume affordance on error. Off-desktop it hides.
 */

import { render, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LocalAiSettingsControl } from '@/features/settings/LocalAiSettingsControl';
import type { LocalLlmStatusSnapshot } from '@/platform/hooks/useLocalLlmModelStatus';

const makeSnap = (
  overrides: Partial<LocalLlmStatusSnapshot> = {},
): LocalLlmStatusSnapshot => ({
  state: 'idle',
  bytesDone: 0,
  bytesTotal: 2_497_280_736,
  message: null,
  stalled: false,
  probed: true,
  start: vi.fn(),
  retry: vi.fn(),
  ...overrides,
});

describe('LocalAiSettingsControl', () => {
  it('renders nothing off-desktop (idle/unprobed)', () => {
    const { container } = render(
      <LocalAiSettingsControl status={makeSnap({ state: 'idle' })} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('shows a Download button when absent, and clicking it starts the download', () => {
    const start = vi.fn();
    const { getByTestId } = render(
      <LocalAiSettingsControl status={makeSnap({ state: 'absent', start })} />,
    );
    const btn = getByTestId('local-ai-download-button');
    fireEvent.click(btn);
    expect(start).toHaveBeenCalledOnce();
  });

  it('shows progress while downloading', () => {
    const { getByTestId, getByRole } = render(
      <LocalAiSettingsControl
        status={makeSnap({
          state: 'downloading',
          bytesDone: 624_320_184, // a quarter of the total
          bytesTotal: 2_497_280_736,
        })}
      />,
    );
    expect(getByTestId('local-ai-download-progress')).toBeInTheDocument();
    expect(getByRole('progressbar')).toHaveAttribute('aria-valuenow', '25');
  });

  it('shows a ready confirmation when installed', () => {
    const { getByTestId } = render(
      <LocalAiSettingsControl status={makeSnap({ state: 'ready' })} />,
    );
    expect(getByTestId('local-ai-ready')).toBeInTheDocument();
  });

  it('shows a Resume button on error that calls retry', () => {
    const retry = vi.fn();
    const { getByTestId } = render(
      <LocalAiSettingsControl status={makeSnap({ state: 'error', retry })} />,
    );
    fireEvent.click(getByTestId('local-ai-retry-button'));
    expect(retry).toHaveBeenCalledOnce();
  });
});
