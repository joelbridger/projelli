/**
 * ErrorBoundary — a generic React error boundary.
 *
 * Catches render/lifecycle errors thrown anywhere in its subtree and shows a
 * CONTAINED fallback instead of letting the error bubble up and white-screen the
 * whole app. Use it to wrap a single surface (e.g. the Activity Log) so one
 * malformed row can never take down the rest of the application — the user sees
 * a small, recoverable error card scoped to that surface and the rest of the app
 * keeps working.
 *
 * Light-theme default fallback (the app is light-theme first). A custom
 * `fallback` render prop is supported for surfaces that want their own styling.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';

export interface ErrorBoundaryProps {
  children: ReactNode;
  /**
   * Short label for the surface being protected, e.g. "Activity Log". Shown in
   * the default fallback so the user knows what failed.
   */
  label?: string;
  /**
   * Custom fallback. Receives the caught error and a `reset` callback that
   * re-attempts rendering the children. When omitted, a light-theme card is shown.
   */
  fallback?: (error: Error, reset: () => void) => ReactNode;
  /** Called when an error is caught — for telemetry/logging. Never rethrow here. */
  onError?: (error: Error, info: ErrorInfo) => void;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    this.props.onError?.(error, info);
    // Keep a console trail so a contained failure is still debuggable, without
    // breaking the UI.
    console.error(`[ErrorBoundary]${this.props.label ? ` ${this.props.label}` : ''}`, error, info.componentStack);
  }

  private reset = (): void => {
    this.setState({ error: null });
  };

  override render(): ReactNode {
    const { error } = this.state;
    if (error !== null) {
      if (this.props.fallback) return this.props.fallback(error, this.reset);
      const what = this.props.label ?? 'This section';
      return (
        <div
          role="alert"
          data-testid="error-boundary-fallback"
          style={{
            margin: 'var(--kp-gutter, 16px)',
            padding: '20px 22px',
            borderRadius: 'var(--radius-lg, 12px)',
            border: '1px solid var(--color-border, #e2e8f0)',
            background: 'var(--color-background, #ffffff)',
            color: 'var(--kp-navy, var(--kp-navy))',
            maxWidth: 560,
          }}
        >
          {/* eslint-disable lantern-i18n/no-hardcoded-string */}
          <div style={{ fontSize: 'var(--kp-font-md, 15px)', fontWeight: 700, marginBottom: 6 }}>
            {what} couldn&apos;t be displayed
          </div>
          <div
            style={{
              fontSize: 'var(--kp-font-sm, 13px)',
              color: 'var(--color-muted-foreground, #64748b)',
              lineHeight: 1.5,
              marginBottom: 14,
            }}
          >
            Something in this section ran into a problem, so it was contained here to
            keep the rest of the app working. Your data is safe. You can try again,
            or move to another section.
          </div>
          <button
            type="button"
            data-testid="error-boundary-retry"
            onClick={this.reset}
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
            Try again
          </button>
          {/* eslint-enable lantern-i18n/no-hardcoded-string */}
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
