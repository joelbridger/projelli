/**
 * Stream D-web Group IV · Task 4.4 — DemoLimitGate tests.
 *
 * Three triggers to verify:
 *   1. Five `keepance:demo-message-sent` events open the modal.
 *   2. A 10-minute-old session opens the modal on the next event tick.
 *   3. A `keepance:demo-limit-hit` event opens the modal immediately.
 *
 * jsdom + fake timers + manual localStorage seeding cover all three.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { DemoLimitGate } from '@/web-demo/DemoLimitGate';
import { DEMO_MESSAGE_COUNT_STORAGE_KEY } from '@/web-demo/DemoExitModal';

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
});

function fireMessageSent() {
  act(() => {
    window.dispatchEvent(new CustomEvent('keepance:demo-message-sent'));
  });
}

describe('DemoLimitGate', () => {
  it('opens the modal after 5 demo-message-sent events', () => {
    render(<DemoLimitGate />);
    expect(screen.queryByTestId('demo-exit-modal')).not.toBeInTheDocument();

    for (let i = 0; i < 5; i += 1) {
      fireMessageSent();
    }

    expect(screen.getByTestId('demo-exit-modal')).toBeInTheDocument();
  });

  it('does not open the modal before 5 messages', () => {
    render(<DemoLimitGate />);
    fireMessageSent();
    fireMessageSent();
    expect(screen.queryByTestId('demo-exit-modal')).not.toBeInTheDocument();
  });

  it('opens the modal when the session age exceeds 10 minutes on the next event', () => {
    // Seed a session that started 11 minutes ago.
    const elevenMinutesAgo = Date.now() - 11 * 60 * 1000;
    localStorage.setItem(
      DEMO_MESSAGE_COUNT_STORAGE_KEY,
      JSON.stringify({ count: 1, sessionStart: elevenMinutesAgo }),
    );

    render(<DemoLimitGate />);
    // No modal yet (constructor doesn't auto-open; we wait for an event tick).
    expect(screen.queryByTestId('demo-exit-modal')).not.toBeInTheDocument();

    fireMessageSent();

    expect(screen.getByTestId('demo-exit-modal')).toBeInTheDocument();
  });

  it('opens the modal in response to a keepance:demo-limit-hit event', () => {
    render(<DemoLimitGate />);
    expect(screen.queryByTestId('demo-exit-modal')).not.toBeInTheDocument();

    act(() => {
      window.dispatchEvent(
        new CustomEvent('keepance:demo-limit-hit', {
          detail: { reason: 'rate-limited', message: 'rate limit' },
        }),
      );
    });

    expect(screen.getByTestId('demo-exit-modal')).toBeInTheDocument();
  });

  it('limit-hit overrides a prior dismissal', () => {
    render(<DemoLimitGate />);

    // Trigger and dismiss.
    for (let i = 0; i < 5; i += 1) fireMessageSent();
    expect(screen.getByTestId('demo-exit-modal')).toBeInTheDocument();

    act(() => {
      screen.getByTestId('demo-exit-continue-browsing').click();
    });
    expect(screen.queryByTestId('demo-exit-modal')).not.toBeInTheDocument();

    // A further message-sent event should NOT reopen (dismissed flag).
    fireMessageSent();
    expect(screen.queryByTestId('demo-exit-modal')).not.toBeInTheDocument();

    // But a hard limit-hit event SHOULD reopen.
    act(() => {
      window.dispatchEvent(
        new CustomEvent('keepance:demo-limit-hit', {
          detail: { reason: 'budget-exhausted', message: 'budget' },
        }),
      );
    });
    expect(screen.getByTestId('demo-exit-modal')).toBeInTheDocument();
  });

  it('persists the message counter to localStorage', () => {
    render(<DemoLimitGate />);
    fireMessageSent();
    fireMessageSent();

    const raw = localStorage.getItem(DEMO_MESSAGE_COUNT_STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw as string) as { count: number; sessionStart: number };
    expect(parsed.count).toBe(2);
    expect(typeof parsed.sessionStart).toBe('number');
  });
});
