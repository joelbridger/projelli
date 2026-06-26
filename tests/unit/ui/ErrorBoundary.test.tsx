/**
 * ErrorBoundary — contains a child render error instead of letting it propagate
 * and white-screen the whole app. This is the second layer of the Activity Log
 * crash fix: even a future malformed row (or any other surface error) shows a
 * contained, recoverable card rather than blanking the app.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ErrorBoundary } from '@/ui/ErrorBoundary';

afterEach(cleanup);

function Boom({ when = true }: { when?: boolean }): React.ReactElement {
  if (when) throw new Error('kaboom');
  return <div data-testid="ok-child">all good</div>;
}

describe('ErrorBoundary', () => {
  it('renders children normally when nothing throws', () => {
    render(
      <ErrorBoundary label="Activity Log">
        <div data-testid="child">hello</div>
      </ErrorBoundary>,
    );
    expect(screen.getByTestId('child')).toBeInTheDocument();
    expect(screen.queryByTestId('error-boundary-fallback')).toBeNull();
  });

  it('catches a child render error and shows a contained fallback (does not rethrow)', () => {
    // Suppress React's expected error logging for this intentional throw.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() =>
      render(
        <ErrorBoundary label="Activity Log">
          <Boom />
        </ErrorBoundary>,
      ),
    ).not.toThrow();
    const fallback = screen.getByTestId('error-boundary-fallback');
    expect(fallback).toBeInTheDocument();
    // The label is surfaced so the user knows what failed.
    expect(fallback).toHaveTextContent(/Activity Log/i);
    expect(screen.getByTestId('error-boundary-retry')).toBeInTheDocument();
    spy.mockRestore();
  });

  it('calls onError with the caught error', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const onError = vi.fn();
    render(
      <ErrorBoundary label="X" onError={onError}>
        <Boom />
      </ErrorBoundary>,
    );
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(Error);
    spy.mockRestore();
  });

  it('uses a custom fallback render prop when provided', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(
      <ErrorBoundary fallback={(err) => <div data-testid="custom">caught: {err.message}</div>}>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByTestId('custom')).toHaveTextContent('caught: kaboom');
    expect(screen.queryByTestId('error-boundary-fallback')).toBeNull();
    spy.mockRestore();
  });

  it('reset clears the error so a now-healthy subtree renders again', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    // A controllable child: throws first, then renders fine after we flip the ref.
    const state = { throwing: true };
    function Controlled(): React.ReactElement {
      if (state.throwing) throw new Error('boom');
      return <div data-testid="recovered">recovered</div>;
    }
    render(
      <ErrorBoundary>
        <Controlled />
      </ErrorBoundary>,
    );
    expect(screen.getByTestId('error-boundary-fallback')).toBeInTheDocument();
    // Heal the underlying condition, then click "Try again".
    state.throwing = false;
    fireEvent.click(screen.getByTestId('error-boundary-retry'));
    expect(screen.getByTestId('recovered')).toBeInTheDocument();
    expect(screen.queryByTestId('error-boundary-fallback')).toBeNull();
    spy.mockRestore();
  });
});
