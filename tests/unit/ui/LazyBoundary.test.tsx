/**
 * LazyBoundary — the second layer of the "failed chunk fetch must never
 * white-screen the app" fix. A bare Suspense doesn't catch a rejected
 * dynamic import; only an error boundary above it does, and only a FRESH
 * lazy() wrapper (not a plain state reset) actually re-triggers the fetch
 * on retry.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { LazyBoundary } from '@/ui/LazyBoundary';

afterEach(cleanup);

describe('LazyBoundary', () => {
  it('renders the lazily-loaded component once import() resolves', async () => {
    const loader = vi.fn().mockResolvedValue({ default: () => <div data-testid="loaded">hi</div> });
    render(
      <LazyBoundary loader={loader} fallback={<div data-testid="loading" />}>
        {(Comp) => <Comp />}
      </LazyBoundary>,
    );
    await waitFor(() => expect(screen.getByTestId('loaded')).toBeInTheDocument());
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('shows a contained retry card instead of crashing when the chunk fetch fails, and never unmounts a sibling', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const loader = vi.fn().mockRejectedValueOnce(new Error('ERR_INSUFFICIENT_RESOURCES'));
    expect(() =>
      render(
        <div>
          <div data-testid="sibling">still here</div>
          <LazyBoundary loader={loader} label="Account settings">
            {(Comp) => <Comp />}
          </LazyBoundary>
        </div>,
      ),
    ).not.toThrow();
    await waitFor(() => expect(screen.getByTestId('lazy-boundary-fallback')).toBeInTheDocument());
    expect(screen.getByTestId('lazy-boundary-fallback')).toHaveTextContent(/Couldn.t load this panel/i);
    expect(screen.getByTestId('lazy-boundary-retry')).toBeInTheDocument();
    // The rest of the tree — a sibling completely outside the boundary —
    // is unaffected; the app did not unmount.
    expect(screen.getByTestId('sibling')).toBeInTheDocument();
    spy.mockRestore();
  });

  it('retry re-triggers the dynamic import (not just clearing boundary state) and recovers once the mock heals', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const loader = vi
      .fn()
      .mockRejectedValueOnce(new Error('chunk load failed'))
      .mockResolvedValueOnce({ default: () => <div data-testid="recovered">back</div> });
    render(
      <LazyBoundary loader={loader}>
        {(Comp) => <Comp />}
      </LazyBoundary>,
    );
    await waitFor(() => expect(screen.getByTestId('lazy-boundary-fallback')).toBeInTheDocument());
    expect(loader).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId('lazy-boundary-retry'));

    await waitFor(() => expect(screen.getByTestId('recovered')).toBeInTheDocument());
    expect(loader).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId('lazy-boundary-fallback')).toBeNull();
    spy.mockRestore();
  });

  it('retrying multiple times keeps re-invoking the loader (no permanently-cached rejection)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const loader = vi
      .fn()
      .mockRejectedValueOnce(new Error('first failure'))
      .mockRejectedValueOnce(new Error('second failure'))
      .mockResolvedValueOnce({ default: () => <div data-testid="recovered">back</div> });
    render(
      <LazyBoundary loader={loader}>
        {(Comp) => <Comp />}
      </LazyBoundary>,
    );
    await waitFor(() => expect(screen.getByTestId('lazy-boundary-fallback')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('lazy-boundary-retry'));
    await waitFor(() => expect(loader).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByTestId('lazy-boundary-fallback')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('lazy-boundary-retry'));
    await waitFor(() => expect(screen.getByTestId('recovered')).toBeInTheDocument());
    expect(loader).toHaveBeenCalledTimes(3);
    spy.mockRestore();
  });

  it('also catches a render error thrown by the loaded component itself', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const Boom = () => {
      throw new Error('render kaboom');
    };
    const loader = vi.fn().mockResolvedValue({ default: Boom });
    render(
      <LazyBoundary loader={loader} label="Widget">
        {(Comp) => <Comp />}
      </LazyBoundary>,
    );
    await waitFor(() => expect(screen.getByTestId('lazy-boundary-fallback')).toBeInTheDocument());
    expect(screen.getByTestId('lazy-boundary-fallback')).toHaveTextContent(/Widget/);
    spy.mockRestore();
  });

  it('renders the NEW component when loader changes at the same slot (e.g. switching tabs), not the previously-resolved one', async () => {
    const loaderA = vi.fn().mockResolvedValue({ default: () => <div data-testid="panel-a">A</div> });
    const loaderB = vi.fn().mockResolvedValue({ default: () => <div data-testid="panel-b">B</div> });

    const { rerender } = render(
      <LazyBoundary loader={loaderA}>{(Comp) => <Comp />}</LazyBoundary>,
    );
    await waitFor(() => expect(screen.getByTestId('panel-a')).toBeInTheDocument());

    // Same LazyBoundary JSX slot, a DIFFERENT loader — mirrors MainPanel
    // swapping from one file-type branch to another, or MattersHome
    // swapping between Documents/Email/Activity sub-tabs.
    rerender(<LazyBoundary loader={loaderB}>{(Comp) => <Comp />}</LazyBoundary>);

    await waitFor(() => expect(screen.getByTestId('panel-b')).toBeInTheDocument());
    expect(screen.queryByTestId('panel-a')).toBeNull();
    expect(loaderB).toHaveBeenCalledTimes(1);
  });

  it('a loader swap clears a stale error card from the PREVIOUS loader instead of leaving it stuck', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const loaderA = vi.fn().mockRejectedValueOnce(new Error('A failed'));
    const loaderB = vi.fn().mockResolvedValue({ default: () => <div data-testid="panel-b">B</div> });

    const { rerender } = render(
      <LazyBoundary loader={loaderA} label="Panel A">{(Comp) => <Comp />}</LazyBoundary>,
    );
    await waitFor(() => expect(screen.getByTestId('lazy-boundary-fallback')).toBeInTheDocument());

    rerender(<LazyBoundary loader={loaderB} label="Panel B">{(Comp) => <Comp />}</LazyBoundary>);

    await waitFor(() => expect(screen.getByTestId('panel-b')).toBeInTheDocument());
    expect(screen.queryByTestId('lazy-boundary-fallback')).toBeNull();
    spy.mockRestore();
  });

  it('calls onError with the caught error', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const onError = vi.fn();
    const loader = vi.fn().mockRejectedValueOnce(new Error('boom'));
    render(
      <LazyBoundary loader={loader} onError={onError}>
        {(Comp) => <Comp />}
      </LazyBoundary>,
    );
    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(Error);
    spy.mockRestore();
  });
});
