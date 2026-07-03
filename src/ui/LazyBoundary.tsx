/**
 * LazyBoundary — Suspense + error boundary combo for every React.lazy() site.
 *
 * A failed dynamic-import chunk fetch (slow network, disk pressure, browser
 * resource limits) throws during render just like any other render error, and
 * an uncaught render error unmounts the whole React tree — a single missed
 * chunk must never white-screen the app. Wrap every `lazy()` usage in this
 * component instead of a bare `<Suspense>`.
 *
 * Retry is not just "clear the error and re-render": React.lazy() memoizes a
 * REJECTED import() promise forever on the specific lazy() instance it
 * wraps, so re-rendering the SAME lazy component after a failure just
 * replays the cached rejection. LazyBoundary re-creates the lazy() wrapper
 * (and therefore re-invokes `loader`, re-triggering a fresh import()) on
 * every retry, via a `retryNonce` in the memo's dependency array.
 *
 * The error boundary ALSO has to reset whenever the CALLER swaps `loader` to
 * a different lazy target while reusing the same JSX slot — e.g. MainPanel's
 * per-file-type branches, or MattersHome's Documents/Email/Activity
 * sub-tabs, are all typed `<LazyBoundary>` at what React sees as one
 * reconciliation slot. Without this, switching tabs/sub-tabs would REUSE the
 * mounted error-boundary instance and keep showing a stale failure card for
 * a target the caller already moved on from. `getDerivedStateFromProps`
 * handles that: it runs on every render (not just on error) and clears the
 * error whenever `loader` no longer matches what produced it.
 *
 * `loader` identity alone isn't always enough, though: MainPanel reuses the
 * SAME module-level `loadDocxEditor` for every `.docx` tab, so a render error
 * on one file would otherwise survive switching to a different file of the
 * SAME type — the error card would stay stuck even though the caller moved on
 * to genuinely different content. Callers that reuse one `loader` across
 * multiple pieces of content pass a `resetKey` (e.g. the tab path, or a
 * per-client scope id) identifying WHICH content is being rendered; the
 * boundary resets on either `loader` OR `resetKey` changing.
 */

import {
  Component,
  Suspense,
  lazy,
  useMemo,
  useState,
  type ComponentType,
  type ErrorInfo,
  type ReactNode,
} from 'react';

export interface LazyBoundaryProps<P extends object> {
  /** The dynamic import — same shape passed directly to React.lazy(). */
  loader: () => Promise<{ default: ComponentType<P> }>;
  /** Render prop so callers keep full control over the component's own props. */
  children: (Component: ComponentType<P>) => ReactNode;
  /** Suspense fallback shown while the chunk is loading. Defaults to nothing. */
  fallback?: ReactNode;
  /** Short label surfaced in the error card, e.g. "Account settings". */
  label?: string;
  /** Called when a chunk-load or render error is caught — for telemetry. */
  onError?: (error: Error, info: ErrorInfo) => void;
  /**
   * Identity of the CONTENT being rendered through this `loader`, when the
   * same `loader` is reused across multiple pieces of content at the same
   * JSX slot (e.g. a tab path, a per-client scope id). Optional — omit when
   * one `LazyBoundary` call site only ever renders one thing. A change here
   * resets the error boundary exactly like a `loader` change does.
   */
  resetKey?: unknown;
}

export function LazyBoundary<P extends object>({
  loader,
  children,
  fallback = null,
  label,
  onError,
  resetKey,
}: LazyBoundaryProps<P>) {
  const [retryNonce, setRetryNonce] = useState(0);

  // Cast: React.lazy()'s generic infers T from the union type `ComponentType<P>`
  // itself rather than distributing to the underlying props, which produces a
  // structurally-nonsensical type for LazyExoticComponent's props. The runtime
  // value is a perfectly ordinary ComponentType<P> either way — Suspense
  // renders it, and callers pass real P props to it via the render prop below.
  const LazyComponent = useMemo(() => {
    // `retryNonce` isn't used by the import itself — it's the deliberate
    // recompute trigger for a plain retry (same loader). A `loader` identity
    // change recomputes too, via its own presence in the dependency array.
    void retryNonce;
    return lazy(loader) as unknown as ComponentType<P>;
  }, [loader, retryNonce]);

  return (
    <LazyBoundaryCatch
      loader={loader}
      resetKey={resetKey}
      label={label}
      onError={onError}
      onRetry={() => {
        setRetryNonce((n) => n + 1);
      }}
    >
      <Suspense fallback={fallback}>{children(LazyComponent)}</Suspense>
    </LazyBoundaryCatch>
  );
}

interface CatchProps {
  children: ReactNode;
  /** Identity token used purely to detect a loader swap — see getDerivedStateFromProps. */
  loader: unknown;
  /** See LazyBoundaryProps.resetKey. */
  resetKey?: unknown;
  label?: string | undefined;
  onError?: ((error: Error, info: ErrorInfo) => void) | undefined;
  onRetry: () => void;
}

interface CatchState {
  error: Error | null;
  loaderAtLastRender: unknown;
  resetKeyAtLastRender: unknown;
}

class LazyBoundaryCatch extends Component<CatchProps, CatchState> {
  override state: CatchState = {
    error: null,
    loaderAtLastRender: this.props.loader,
    resetKeyAtLastRender: this.props.resetKey,
  };

  static getDerivedStateFromError(error: Error): Partial<CatchState> {
    return { error };
  }

  // Runs on every render (mount, update, AND the render right after
  // getDerivedStateFromError fires) — clears a stale error the moment the
  // caller has moved on to a different loader OR different content (via
  // resetKey), without needing a `key`-driven full remount.
  static getDerivedStateFromProps(props: CatchProps, state: CatchState): Partial<CatchState> | null {
    if (props.loader !== state.loaderAtLastRender || props.resetKey !== state.resetKeyAtLastRender) {
      return { error: null, loaderAtLastRender: props.loader, resetKeyAtLastRender: props.resetKey };
    }
    return null;
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    this.props.onError?.(error, info);
    console.error(`[LazyBoundary]${this.props.label ? ` ${this.props.label}` : ''}`, error, info.componentStack);
  }

  private retry = (): void => {
    this.setState({ error: null });
    this.props.onRetry();
  };

  override render(): ReactNode {
    const { error } = this.state;
    if (error !== null) {
      const what = this.props.label ?? 'This panel';
      return (
        <div
          role="alert"
          data-testid="lazy-boundary-fallback"
          style={{
            margin: 'var(--kp-gutter, 16px)',
            padding: '20px 22px',
            borderRadius: 'var(--radius-lg, 12px)',
            border: '1px solid var(--color-border, #e2e8f0)',
            background: 'var(--color-background, #ffffff)',
            color: 'var(--kp-navy, var(--kp-navy))',
            maxWidth: 420,
          }}
        >
          {/* eslint-disable lantern-i18n/no-hardcoded-string */}
          <div style={{ fontSize: 'var(--kp-font-md, 15px)', fontWeight: 700, marginBottom: 6 }}>
            Couldn&apos;t load this panel
          </div>
          <div
            style={{
              fontSize: 'var(--kp-font-sm, 13px)',
              color: 'var(--color-muted-foreground, #64748b)',
              lineHeight: 1.5,
              marginBottom: 14,
            }}
          >
            {what} couldn&apos;t be fetched — usually a slow connection or a one-off
            hiccup. Your data is safe. Retry, or move to another section.
          </div>
          <button
            type="button"
            data-testid="lazy-boundary-retry"
            onClick={this.retry}
            style={{
              height: 32,
              padding: '0 14px',
              borderRadius: 'var(--radius-md, 8px)',
              border: '1px solid var(--color-border, #e2e8f0)',
              background: 'var(--color-background, #ffffff)',
              color: 'var(--kp-navy, var(--kp-navy))',
              fontSize: 'var(--kp-font-sm, 13px)',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Retry
          </button>
          {/* eslint-enable lantern-i18n/no-hardcoded-string */}
        </div>
      );
    }
    return this.props.children;
  }
}

export default LazyBoundary;
