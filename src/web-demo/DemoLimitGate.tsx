/**
 * Stream D-web Group IV · Task 4.2
 *
 * DemoLimitGate is the policy layer that decides when to interrupt the demo
 * with the conversion modal. It does not wrap the chat send call directly;
 * instead it observes three signals and renders <DemoExitModal /> when any
 * of them trips.
 *
 *   1. `keepance:demo-message-sent` — fired by `demoAIProvider` after every
 *      successful proxy call. Each event increments a localStorage-persisted
 *      counter; at 5 messages the gate opens the modal.
 *   2. Wall-clock session age — `sessionStartTime` is recorded on mount; at
 *      10 minutes elapsed (checked on each event tick AND on a 30s timer)
 *      the gate opens the modal.
 *   3. `keepance:demo-limit-hit` — the proxy or the demoAIProvider can fire
 *      this directly (rate-limited / budget-exhausted / proxy error). The
 *      gate forwards it straight to the modal.
 *
 * Persistence: the counter and session start are stored in localStorage so a
 * page reload doesn't reset the demo limits. The pair has a 24h TTL; after
 * that we treat it as a fresh session and reset both fields.
 *
 * "Continue browsing" dismisses the modal and re-arms it on the next message
 * (`messageCountSinceDismissal >= 1`). "Reset session" is wired in
 * <DemoExitModal /> directly: it resets the proxy session token AND clears
 * the localStorage counter so the gate starts over.
 */

import { useEffect, useRef, useState } from 'react';
import {
  DemoExitModal,
  DEMO_MESSAGE_COUNT_STORAGE_KEY,
} from './DemoExitModal';
import {
  DEMO_LIMIT_HIT_EVENT,
  DEMO_MESSAGE_SENT_EVENT_NAME,
} from './demoAIProvider';
import {
  trackDemoAiFirstMessage,
  trackDemoLimitHit,
} from './demoPlausible';

const MESSAGE_LIMIT = 5;
const SESSION_LIMIT_MS = 10 * 60 * 1000; // 10 minutes
const COUNTER_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const TIMER_TICK_MS = 30 * 1000;

interface PersistedCounter {
  count: number;
  sessionStart: number;
}

function readCounter(): PersistedCounter {
  try {
    const raw = localStorage.getItem(DEMO_MESSAGE_COUNT_STORAGE_KEY);
    if (!raw) return { count: 0, sessionStart: Date.now() };
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'count' in parsed &&
      'sessionStart' in parsed &&
      typeof (parsed as PersistedCounter).count === 'number' &&
      typeof (parsed as PersistedCounter).sessionStart === 'number'
    ) {
      const stored = parsed as PersistedCounter;
      if (Date.now() - stored.sessionStart > COUNTER_TTL_MS) {
        return { count: 0, sessionStart: Date.now() };
      }
      return stored;
    }
    return { count: 0, sessionStart: Date.now() };
  } catch {
    return { count: 0, sessionStart: Date.now() };
  }
}

function writeCounter(counter: PersistedCounter): void {
  try {
    localStorage.setItem(
      DEMO_MESSAGE_COUNT_STORAGE_KEY,
      JSON.stringify(counter),
    );
  } catch {
    // tolerate
  }
}

export function DemoLimitGate() {
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const counterRef = useRef<PersistedCounter>(readCounter());

  useEffect(() => {
    // Persist whatever we read on mount so the entry timestamp is captured
    // even if the user never sends a message.
    writeCounter(counterRef.current);
  }, []);

  useEffect(() => {
    function maybeOpen(reason: 'count' | 'time' | 'limit-hit', detail?: string) {
      // Plausible: every modal open counts. The reason prop lets us see the
      // mix in the funnel report (count vs time vs proxy-quota).
      trackDemoLimitHit(detail ?? reason);
      if (reason === 'limit-hit') {
        // Limit-hit events from the proxy always open, even if the user
        // recently dismissed: this is a hard quota signal.
        setDismissed(false);
        setOpen(true);
        return;
      }
      if (dismissed) return;
      setOpen(true);
    }

    function onMessageSent() {
      // First proxy-backed message in this session is a key conversion
      // signal: the user actually tried the product. Fire once per tab.
      trackDemoAiFirstMessage();
      const next: PersistedCounter = {
        count: counterRef.current.count + 1,
        sessionStart: counterRef.current.sessionStart,
      };
      counterRef.current = next;
      writeCounter(next);
      if (next.count >= MESSAGE_LIMIT) {
        maybeOpen('count');
        return;
      }
      if (Date.now() - next.sessionStart >= SESSION_LIMIT_MS) {
        maybeOpen('time');
      }
    }

    function onLimitHit(event: Event) {
      const reason =
        event instanceof CustomEvent &&
        event.detail &&
        typeof (event.detail as { reason?: unknown }).reason === 'string'
          ? (event.detail as { reason: string }).reason
          : 'proxy-error';
      maybeOpen('limit-hit', reason);
    }

    window.addEventListener(DEMO_MESSAGE_SENT_EVENT_NAME, onMessageSent);
    window.addEventListener(DEMO_LIMIT_HIT_EVENT, onLimitHit);

    const timer = window.setInterval(() => {
      if (Date.now() - counterRef.current.sessionStart >= SESSION_LIMIT_MS) {
        maybeOpen('time');
      }
    }, TIMER_TICK_MS);

    return () => {
      window.removeEventListener(DEMO_MESSAGE_SENT_EVENT_NAME, onMessageSent);
      window.removeEventListener(DEMO_LIMIT_HIT_EVENT, onLimitHit);
      window.clearInterval(timer);
    };
  }, [dismissed]);

  function handleContinueBrowsing() {
    setOpen(false);
    setDismissed(true);
  }

  function handleReset() {
    // DemoExitModal's onReset already cleared session token + counter.
    counterRef.current = { count: 0, sessionStart: Date.now() };
    writeCounter(counterRef.current);
    setOpen(false);
    setDismissed(false);
  }

  // `?clean` disables the exit gate so the app can be screen-recorded for the
  // marketing site without the conversion modal interrupting.
  if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('clean')) {
    return null;
  }

  return (
    <DemoExitModal
      open={open}
      onContinueBrowsing={handleContinueBrowsing}
      onReset={handleReset}
    />
  );
}

export const DEMO_LIMIT_GATE_MESSAGE_LIMIT = MESSAGE_LIMIT;
export const DEMO_LIMIT_GATE_SESSION_LIMIT_MS = SESSION_LIMIT_MS;
