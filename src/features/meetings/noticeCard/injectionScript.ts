/**
 * Notice Card — companion-webview injection script builder.
 *
 * Produces the self-contained JavaScript that Tauri injects into the isolated
 * companion window as its initialization script. That script runs in the
 * meeting page's own (untrusted) context; it is handed NO Tauri/IPC handle, so
 * the page can never reach the app's internals. State flows OUT only, one-way,
 * by writing an opaque status token into `document.title` — which the app polls
 * from the Rust side (`notice_card_status`). The page can set only its own
 * title; it gains zero authority over the app.
 *
 * SECURITY: every dynamic value interpolated into the script is passed through
 * `JSON.stringify` so it becomes a safely-escaped string/JSON literal — never
 * raw concatenation. The adapter methods are our own trusted source, serialized
 * with `Function.prototype.toString`.
 */
import type { NoticeCardConfig } from './noticeCardTypes';
import { adapterFor } from './adapters';

/** Prefix the injected script writes into document.title, e.g. "NC:admitted". */
export const NOTICE_CARD_TITLE_PREFIX = 'NC:';

/** How often the in-page runner inspects the join page. */
const POLL_MS = 700;
/** Ticks in an unrecognized "loading" state before we declare page drift. */
const UNRECOGNIZED_TICKS = 40; // ~28s at POLL_MS

/**
 * Build the injection script for one card. `cameraScript` (v2) is prepended so
 * the canvas-camera getUserMedia interception is installed before the page's
 * own scripts run. Throws for platforms with no adapter (the supervisor guards
 * against ever reaching here for those).
 */
export function buildInjectionScript(
  config: NoticeCardConfig,
  opts?: { cameraScript?: string },
): string {
  const adapter = adapterFor(config.platform);
  if (!adapter) {
    throw new Error(`No Notice Card adapter for platform "${config.platform}"`);
  }
  // Serialize the four adapter methods as object-literal method shorthand. Each
  // `toString()` yields `name(args){...}`, which is valid inside `{ ... }`.
  // These references are only stringified (never invoked here), so `this`
  // binding is irrelevant — the unbound-method rule doesn't apply.
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const methods = [adapter.detectPhase, adapter.fillGuestName, adapter.ensureMuted, adapter.clickJoin]
    .map((fn) => fn.toString())
    .join(',\n');

  const displayName = JSON.stringify(config.displayName);
  const prefix = JSON.stringify(NOTICE_CARD_TITLE_PREFIX);
  const pollMs = JSON.stringify(POLL_MS);
  const unrecognizedTicks = JSON.stringify(UNRECOGNIZED_TICKS);
  const camera = opts?.cameraScript ?? '';

  return `(function () {
  try {
${camera}
    var DISPLAY_NAME = ${displayName};
    var TITLE_PREFIX = ${prefix};
    var POLL_MS = ${pollMs};
    var UNRECOGNIZED_TICKS = ${unrecognizedTicks};
    var adapter = {
${methods}
    };
    var lastReported = '';
    var everAdmitted = false;
    var loadingTicks = 0;
    function report(status) {
      // Re-assert even when the status is unchanged if the meeting page has
      // overwritten our title (Teams/Zoom rewrite document.title constantly).
      // Otherwise the app-side poller could miss the only NC:admitted/NC:lobby
      // title and wrongly time out a card that actually joined.
      var desired = TITLE_PREFIX + status;
      if (status === lastReported && document.title === desired) return;
      lastReported = status;
      try { document.title = desired; } catch (e) {}
    }
    function tick() {
      try {
        var phase = adapter.detectPhase(document);
        if (phase === 'name-entry') {
          adapter.fillGuestName(document, DISPLAY_NAME);
          adapter.ensureMuted(document);
          report('joining');
        } else if (phase === 'ready-to-join') {
          adapter.ensureMuted(document);
          adapter.clickJoin(document);
          report('joining');
        } else if (phase === 'lobby') {
          report('lobby');
        } else if (phase === 'admitted') {
          everAdmitted = true;
          loadingTicks = 0;
          report('admitted');
        } else if (phase === 'denied') {
          report('denied');
        } else {
          // loading / nothing recognized
          if (everAdmitted) {
            report('disconnected');
          } else {
            loadingTicks++;
            if (loadingTicks > UNRECOGNIZED_TICKS) report('unrecognized');
          }
        }
        // A drop back out of the call after being admitted is a disconnect.
        if (everAdmitted && phase !== 'admitted' && phase !== 'denied') {
          report('disconnected');
        }
      } catch (e) {
        /* never throw into the meeting page */
      }
    }
    setInterval(tick, POLL_MS);
    tick();
  } catch (e) {}
})();`;
}

/**
 * Map a `document.title` status token (minus the prefix) to how the supervisor
 * should be driven. Returned by the app-side poller. Kept here so the token
 * vocabulary has one home.
 */
export type NoticeCardTitleStatus =
  | 'joining'
  | 'lobby'
  | 'admitted'
  | 'denied'
  | 'disconnected'
  | 'unrecognized';

/** Parse a raw window title into a status token, or null if it isn't ours. */
export function parseNoticeCardTitle(title: string | null | undefined): NoticeCardTitleStatus | null {
  if (!title || !title.startsWith(NOTICE_CARD_TITLE_PREFIX)) return null;
  const token = title.slice(NOTICE_CARD_TITLE_PREFIX.length);
  switch (token) {
    case 'joining':
    case 'lobby':
    case 'admitted':
    case 'denied':
    case 'disconnected':
    case 'unrecognized':
      return token;
    default:
      return null;
  }
}
