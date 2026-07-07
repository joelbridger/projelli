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
 * AFTER admission only (QA-91d r2 heartbeat): how many CONSECUTIVE polls with the
 * in-call anchors ABSENT and no recognized page we tolerate as brief DOM drift
 * (still presumed present) before declaring a real disconnect. Small on purpose — a
 * healthy in-call page always carries the call-duration/hangup anchors (→ 'admitted'),
 * so this window only spans a sub-second re-render, never a genuine drop. Keeps a
 * real network drop / reconnect from being reported as presence forever.
 */
const PRESENT_UNKNOWN_GRACE_TICKS = 5; // ~3.5s at POLL_MS

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
  /* eslint-disable @typescript-eslint/unbound-method */
  const methods = [
    adapter.detectPhase,
    adapter.dismissLauncher,
	    adapter.fillGuestName,
	    adapter.ensureMuted,
	    adapter.setMuted,
	    adapter.clickJoin,
	  ]
    /* eslint-enable @typescript-eslint/unbound-method */
    .map((fn) => fn.toString())
    .join(',\n');

  const displayName = JSON.stringify(config.displayName);
  const prefix = JSON.stringify(NOTICE_CARD_TITLE_PREFIX);
  const pollMs = JSON.stringify(POLL_MS);
  const unrecognizedTicks = JSON.stringify(UNRECOGNIZED_TICKS);
  const graceTicks = JSON.stringify(PRESENT_UNKNOWN_GRACE_TICKS);
  const camera = opts?.cameraScript ?? '';

  return `(function () {
  try {
    // Defense in depth. The companion window is already capability-isolated (its
    // label is in NO capability, so no Tauri command is reachable), but strip
    // any injected IPC bridge globals too so the untrusted meeting page cannot
    // even reference them. This runs before the page's own scripts.
    try { delete window.__TAURI_INTERNALS__; } catch (e) {}
    try { delete window.__TAURI__; } catch (e) {}
    try { delete window.__TAURI_INVOKE__; } catch (e) {}
    try { delete window.__TAURI_METADATA__; } catch (e) {}
${camera}
    var DISPLAY_NAME = ${displayName};
    var TITLE_PREFIX = ${prefix};
    var POLL_MS = ${pollMs};
    var UNRECOGNIZED_TICKS = ${unrecognizedTicks};
    var PRESENT_UNKNOWN_GRACE_TICKS = ${graceTicks};
	    var adapter = {
${methods}
	    };
	    var announcementInFlight = false;
	    var rawAnnounce = window.__NOTICE_CARD_ANNOUNCE_WAV_BASE64__;
	    if (rawAnnounce) {
	      window.__NOTICE_CARD_ANNOUNCE_WAV_BASE64__ = function (b64) {
	        if (announcementInFlight) return Promise.resolve(false);
	        announcementInFlight = true;
	        try { adapter.setMuted(document, false); } catch (e) {}
	        return Promise.resolve(rawAnnounce(b64)).then(function (value) {
	          try { adapter.setMuted(document, true); } catch (e) {}
	          announcementInFlight = false;
	          return value;
	        }, function (err) {
	          try { adapter.setMuted(document, true); } catch (e) {}
	          announcementInFlight = false;
	          throw err;
	        });
	      };
	    }
	    var lastReported = '';
    var everAdmitted = false;
    var loadingTicks = 0;
    var driftTicks = 0;
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
        // ── AFTER admission: one-way latch, but distinguish drift from a real exit ──
        // (QA-91d r2). The latch must NEVER silence a genuine disconnect: the consent
        // evidence must not record presence while the notice was actually absent.
        if (everAdmitted) {
          if (phase === 'admitted') {
            // Still in the call (the in-call anchors are present). Latch holds.
            driftTicks = 0;
            report('admitted');
          } else if (phase === 'denied') {
            // The host removed the card mid-meeting — a real, honest terminal.
            report('denied');
          } else if (
            phase === 'lobby' ||
            phase === 'launcher' ||
            phase === 'name-entry' ||
            phase === 'ready-to-join'
          ) {
            // A RECOGNIZED non-call page after admission = we genuinely bounced OUT of
            // the meeting (network reconnect, back to prejoin, re-lobby). This is a
            // real disconnect — NEVER keep claiming presence. Signal it so the
            // supervisor rejoins / reports honestly and the evidence ledger reflects
            // the gap (a rejoin forfeits the full-duration-presence claim).
            report('disconnected');
          } else {
            // Unrecognized/loading AND the in-call anchors are absent (else detectPhase
            // would have returned 'admitted'). This is the ONLY genuine drift case:
            // either a sub-second in-call re-render, or a drop whose page we don't
            // recognize. Heartbeat — tolerate a SHORT grace window as presumed-present,
            // but if the in-call anchors stay gone past it, declare a real disconnect.
            // Never present-unknown forever.
            driftTicks++;
            if (driftTicks > PRESENT_UNKNOWN_GRACE_TICKS) {
              report('disconnected');
            } else {
              report('present-unknown');
            }
          }
          return;
        }
        // ── BEFORE admission: the join flow (unchanged) ──
        if (phase === 'launcher') {
          // "Continue on this browser" vs "Open the Teams app" chooser: click
          // through it so the page advances to the real prejoin. A SUCCESSFUL
          // click reports 'joining' (like name-entry) and doesn't count toward the
          // give-up clock. But if dismissLauncher can't act — the continue-in-
          // browser control is absent/disabled/renamed (drift), yet the page still
          // reads as the launcher (e.g. by URL) — we must NOT sit on 'joining'
          // forever. Count each failed attempt toward the SAME unrecognized give-up
          // as the loading path, so the card fast-fails to page-unrecognized (and
          // the honest say-the-notice-aloud fallback) instead of hanging until the
          // long supervisor timeout.
          if (adapter.dismissLauncher(document)) {
            report('joining');
          } else {
            loadingTicks++;
            if (loadingTicks > UNRECOGNIZED_TICKS) report('unrecognized');
          }
        } else if (phase === 'name-entry') {
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
          driftTicks = 0;
          report('admitted');
        } else if (phase === 'denied') {
          report('denied');
        } else {
          // loading / nothing recognized, and never admitted → the honest fast-fail.
          loadingTicks++;
          if (loadingTicks > UNRECOGNIZED_TICKS) report('unrecognized');
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
  | 'present-unknown' // admitted, then an unrecognized page — presumed still present (QA-91d latch)
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
    case 'present-unknown':
    case 'denied':
    case 'disconnected':
    case 'unrecognized':
      return token;
    default:
      return null;
  }
}
