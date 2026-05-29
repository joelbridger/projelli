/**
 * Stream D-web Group IV · Task 4.4 — DemoExitModal tests.
 *
 * Verifies the three OS-specific download buttons are wired with UTM params,
 * the "Continue browsing" button calls the dismiss handler, and the
 * "Reset session" button clears the local message counter and resets the
 * proxy session token via the helper.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  DemoExitModal,
  DEMO_EXIT_DOWNLOAD_URLS,
  DEMO_MESSAGE_COUNT_STORAGE_KEY,
} from '@/web-demo/DemoExitModal';

vi.mock('@/web-demo/demoSessionToken', async () => {
  const actual = await vi.importActual<typeof import('@/web-demo/demoSessionToken')>(
    '@/web-demo/demoSessionToken',
  );
  return {
    ...actual,
    resetDemoSessionToken: vi.fn(() => 'keepance-demo-test-2026-05-04'),
  };
});

import { resetDemoSessionToken } from '@/web-demo/demoSessionToken';

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

describe('DemoExitModal', () => {
  it('does not render when open=false', () => {
    render(
      <DemoExitModal
        open={false}
        onContinueBrowsing={() => {}}
        onReset={() => {}}
      />,
    );
    expect(screen.queryByTestId('demo-exit-modal')).not.toBeInTheDocument();
  });

  it('renders the three OS-specific download buttons with UTM params', () => {
    render(
      <DemoExitModal
        open
        onContinueBrowsing={() => {}}
        onReset={() => {}}
      />,
    );

    // Button asChild forwards data-testid to the <a> Slot directly.
    const mac = screen.getByTestId('demo-exit-download-mac');
    const windowsBtn = screen.getByTestId('demo-exit-download-windows');
    const linux = screen.getByTestId('demo-exit-download-linux');

    expect(mac.getAttribute('href')).toBe(DEMO_EXIT_DOWNLOAD_URLS.mac);
    expect(windowsBtn.getAttribute('href')).toBe(DEMO_EXIT_DOWNLOAD_URLS.windows);
    expect(linux.getAttribute('href')).toBe(DEMO_EXIT_DOWNLOAD_URLS.linux);

    for (const url of Object.values(DEMO_EXIT_DOWNLOAD_URLS)) {
      expect(url).toContain('utm_source=demo');
      expect(url).toContain('utm_campaign=v2-launch');
      expect(url).toContain('utm_content=exit_modal');
    }
  });

  it('Continue browsing calls onContinueBrowsing', () => {
    const onContinueBrowsing = vi.fn();
    render(
      <DemoExitModal
        open
        onContinueBrowsing={onContinueBrowsing}
        onReset={() => {}}
      />,
    );

    screen.getByTestId('demo-exit-continue-browsing').click();
    expect(onContinueBrowsing).toHaveBeenCalledTimes(1);
  });

  it('Reset session resets the proxy token, clears localStorage, and calls onReset', () => {
    const onReset = vi.fn();
    localStorage.setItem(
      DEMO_MESSAGE_COUNT_STORAGE_KEY,
      JSON.stringify({ count: 4, sessionStart: Date.now() }),
    );

    render(
      <DemoExitModal
        open
        onContinueBrowsing={() => {}}
        onReset={onReset}
      />,
    );

    screen.getByTestId('demo-exit-reset-session').click();

    expect(resetDemoSessionToken).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(DEMO_MESSAGE_COUNT_STORAGE_KEY)).toBeNull();
    expect(onReset).toHaveBeenCalledTimes(1);
  });
});
