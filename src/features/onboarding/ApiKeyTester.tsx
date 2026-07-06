/**
 * ApiKeyTester - "Test this key" button + result display.
 *
 * Used inline next to the API key input in both:
 *   - FirstRunWizard's apikey step
 *   - ApiKeySettings's ProviderKeyCard (editing state)
 *
 * On click, it runs one cheap validation call to the provider via
 * validateApiKeyLive() and shows:
 *   - Green check + "This key works." on success
 *   - Plain-English error on failure, distinguishing:
 *       malformed  - client-side format problem (no network call)
 *       rejected   - provider refused the key (auth error)
 *       network    - couldn't reach the provider
 *
 * The button is disabled while a test is in flight. An AbortController cancels
 * a pending test when the component unmounts or when the key changes.
 */

import { useRef, useState, useEffect, useCallback } from 'react';
import { CheckCircle, XCircle, AlertCircle, Loader2, Wifi } from 'lucide-react';
import { Button } from '@/ui/button';
import { cn } from '@/lib/utils';
import {
  validateApiKeyLive,
  type ValidationProvider,
  type ValidationOutcome,
} from '@/platform/providers/apiKeyValidation';

interface ApiKeyTesterProps {
  provider: ValidationProvider;
  /** Current value of the key input (may be unsaved). */
  apiKey: string;
  className?: string;
}

type TestState =
  | { status: 'idle' }
  | { status: 'testing' }
  | { status: 'done'; outcome: ValidationOutcome; message: string };

export function ApiKeyTester({ provider, apiKey, className }: ApiKeyTesterProps) {
  const [state, setState] = useState<TestState>({ status: 'idle' });
  const abortRef = useRef<AbortController | null>(null);

  // Reset to idle whenever the key changes so stale results don't linger.
  useEffect(() => {
    setState({ status: 'idle' });
    abortRef.current?.abort();
    abortRef.current = null;
  }, [apiKey, provider]);

  // Abort on unmount.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const runTest = useCallback(async () => {
    // Cancel any in-flight test.
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    setState({ status: 'testing' });

    // Bound the live check so a hung/slow provider can't spin "Testing..."
    // forever (mirrors AiScene's 15s guard). Use an object flag so the timeout
    // mutation is visible to the post-await branch.
    const guard = { timedOut: false };
    const timer = setTimeout(() => {
      guard.timedOut = true;
      ac.abort();
    }, 15_000);

    try {
      const result = await validateApiKeyLive(provider, apiKey, ac.signal);

      // Ignore if aborted because the component unmounted or the key changed
      // mid-flight (but NOT if we aborted it ourselves on timeout — that we want
      // to surface).
      if (ac.signal.aborted && !guard.timedOut) return;

      if (guard.timedOut) {
        setState({
          status: 'done',
          outcome: 'network',
          message: "That took too long — I couldn't reach the provider. Check your connection and try again.",
        });
      } else {
        setState({ status: 'done', outcome: result.outcome, message: result.message });
      }
    } finally {
      clearTimeout(timer);
      if (abortRef.current === ac) abortRef.current = null;
    }
  }, [provider, apiKey]);

  const isTesting = state.status === 'testing';
  const trimmedKey = apiKey.trim();
  const canTest = trimmedKey.length >= 8 && !isTesting;

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={runTest}
        disabled={!canTest}
        data-testid="api-key-tester-button"
        className="gap-1.5 w-fit"
      >
        {isTesting ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Testing...
          </>
        ) : (
          <>
            <Wifi className="h-3.5 w-3.5" />
            Test this key
          </>
        )}
      </Button>

      {state.status === 'done' && (
        <ResultBadge outcome={state.outcome} message={state.message} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Internal sub-components
// ---------------------------------------------------------------------------

interface ResultBadgeProps {
  outcome: ValidationOutcome;
  message: string;
}

function ResultBadge({ outcome, message }: ResultBadgeProps) {
  if (outcome === 'ok') {
    return (
      <p
        data-testid="api-key-tester-result-ok"
        className="flex items-center gap-1.5 text-xs text-emerald-700 font-medium"
      >
        <CheckCircle className="h-3.5 w-3.5 shrink-0" />
        {message}
      </p>
    );
  }

  // rate_limited: the key IS real (it authenticated) — a warning, not a
  // rejection, so it gets amber styling rather than the destructive red X.
  if (outcome === 'rate_limited') {
    return (
      <p
        data-testid="api-key-tester-result-rate_limited"
        className="flex items-center gap-1.5 text-xs text-amber-700"
      >
        <AlertCircle className="h-3.5 w-3.5 shrink-0" />
        {message}
      </p>
    );
  }

  return (
    <p
      data-testid={`api-key-tester-result-${outcome}`}
      className="flex items-center gap-1.5 text-xs text-destructive"
    >
      <XCircle className="h-3.5 w-3.5 shrink-0" />
      {message}
    </p>
  );
}

export default ApiKeyTester;
