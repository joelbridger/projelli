/**
 * Notice Card — the real driver + status poller (desktop only).
 *
 * `makeTauriDriver` implements the supervisor's `NoticeCardDriver` against the
 * isolated companion-webview Rust commands. `applyTitleStatus` translates the
 * one-way `document.title` status channel into supervisor handler calls, and
 * `startStatusPoller` runs that translation on an interval.
 *
 * VERIFY-LIVE: the round-trip through the real webview is exercised on the
 * bench. `applyTitleStatus` is pure and unit-tested here; the invoke plumbing
 * is thin.
 */
import { invoke, isTauri } from '@tauri-apps/api/core';
import { buildInjectionScript } from './injectionScript';
import { parseNoticeCardTitle } from './injectionScript';
import type { NoticeCardDriver } from './supervisor';

/** The subset of the supervisor the poller drives. */
export interface SupervisorEventSink {
  handleLobby(): void;
  handleAdmitted(): void;
  handleDenied(): void;
  handleDisconnected(): void;
  handleFailed(reason: 'page-unrecognized'): void;
}

/** Build a driver that opens/closes the isolated companion window via Rust. */
export function makeTauriDriver(label: string, opts?: { cameraScript?: string }): NoticeCardDriver {
  return {
    async open(config) {
      const initScript = buildInjectionScript(config, opts);
      await invoke('notice_card_open', { label, joinUrl: config.joinUrl, initScript });
    },
    async close() {
      // Idempotent on the Rust side; swallow errors so a teardown race never
      // rejects the watchdog.
      try {
        await invoke('notice_card_close', { label });
      } catch {
        /* window already gone */
      }
    },
  };
}

/**
 * Translate a raw window title (or null when the window is gone) into the right
 * supervisor handler call. Pure; the poller and tests both use it. `'joining'`
 * and any non-ours title are ignored (the supervisor is already joining).
 */
export function applyTitleStatus(sup: SupervisorEventSink, title: string | null | undefined): void {
  if (title === null || title === undefined) {
    // The window vanished unexpectedly — treat as a disconnect (the supervisor
    // decides whether to rejoin or give up; it ignores this once terminal).
    sup.handleDisconnected();
    return;
  }
  const status = parseNoticeCardTitle(title);
  switch (status) {
    case 'lobby':
      sup.handleLobby();
      break;
    case 'admitted':
      sup.handleAdmitted();
      break;
    case 'denied':
      sup.handleDenied();
      break;
    case 'disconnected':
      sup.handleDisconnected();
      break;
    case 'unrecognized':
      sup.handleFailed('page-unrecognized');
      break;
    // 'joining' and null-parse (non-ours title) are intentionally ignored.
    default:
      break;
  }
}

/**
 * Poll the companion window's status title on an interval, driving the
 * supervisor. Returns a stop function. No-op off desktop.
 */
export function startStatusPoller(
  label: string,
  sup: SupervisorEventSink,
  intervalMs = 700,
): () => void {
  if (!isTauri()) return () => {};
  // No stop flag: clearInterval stops future ticks, and a single in-flight poll
  // that resolves after teardown only calls the supervisor, which ignores events
  // once terminal. This keeps setInterval's callback synchronous (no misused
  // promise) and avoids a closure-boolean the linter can't reason about.
  const handle = setInterval(() => {
    void (async () => {
      try {
        const title = await invoke<string | null>('notice_card_status', { label });
        applyTitleStatus(sup, title);
      } catch {
        /* transient invoke failure; next tick retries */
      }
    })();
  }, intervalMs);
  return () => {
    clearInterval(handle);
  };
}
