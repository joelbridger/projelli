import { describe, it, expect } from 'vitest';
import { buildInjectionScript, NOTICE_CARD_TITLE_PREFIX } from './injectionScript';
import type { NoticeCardConfig } from './noticeCardTypes';

const cfg = (over: Partial<NoticeCardConfig> = {}): NoticeCardConfig => ({
  joinUrl: 'https://teams.microsoft.com/l/meetup-join/abc',
  platform: 'teams',
  displayName: '⏺ Recording Notice — Sarah',
  meetingDir: 'Meetings/2026-07-04-henderson',
  meetingTitle: 'Henderson quarterly review',
  ...over,
});

describe('buildInjectionScript', () => {
  it('produces a syntactically valid, self-contained IIFE', () => {
    const src = buildInjectionScript(cfg());
    expect(src.trimStart().startsWith('(function')).toBe(true);
    // Compiles without throwing (validates the serialized adapter methods too).
    expect(() => new Function(src)).not.toThrow();
  });

  it('embeds the display name and the selected adapter source', () => {
    const src = buildInjectionScript(cfg());
    expect(src).toContain(JSON.stringify('⏺ Recording Notice — Sarah'));
    expect(src).toContain('detectPhase('); // Teams adapter method serialized in
  });

  it('serializes the launcher-dismiss method and drives it on the launcher phase (QA-91c)', () => {
    // The "Continue on this browser" chooser must be clicked through before the
    // prejoin is ever reached, or the card soft-fails page-unrecognized at ~29s.
    const src = buildInjectionScript(cfg());
    expect(src).toContain('dismissLauncher('); // method serialized into the runner
    expect(src).toContain("phase === 'launcher'"); // runner acts on the launcher phase
    expect(src).toContain('adapter.dismissLauncher(document)');
    // (the "produces a syntactically valid IIFE" test already compile-checks the
    // full script, including this newly-serialized method.)
  });

  it('fast-fails to page-unrecognized when stuck on the launcher with no clickable control (QA-91c round 2)', () => {
    // Drift: the page still reads as the launcher (by URL) but the continue-in-
    // browser control is gone/disabled, so dismissLauncher can't act. The runner
    // must count each failed attempt toward the unrecognized give-up and fast-fail
    // — never hang on 'joining' until the long supervisor timeout.
    const src = buildInjectionScript(cfg());
    const driftDoc = new DOMParser().parseFromString(
      '<html><body><div class="mainActionsContent"><h1>Join your Teams meeting</h1></div></body></html>',
      'text/html',
    );
    Object.defineProperty(driftDoc, 'URL', {
      value: 'https://teams.live.com/dl/launcher/launcher.html?url=%2Fmeet%2F1',
      configurable: true,
    });
    let tick: (() => void) | undefined;
    const setIntervalStub = (fn: () => void): number => {
      tick = fn;
      return 1;
    };
    // Execute the runner WE just generated (src is our own trusted code, never
    // user input) in a sandbox with a controlled document/window/setInterval so we
    // can drive its tick loop and observe the give-up behavior.
    // eslint-disable-next-line @typescript-eslint/no-implied-eval -- runs our own generated runner to assert its give-up path
    const runRunner = new Function('document', 'window', 'setInterval', src) as (
      d: Document,
      w: object,
      si: (fn: () => void) => number,
    ) => void;
    runRunner(driftDoc, {}, setIntervalStub);
    // The IIFE ran one tick immediately — not enough to give up yet.
    expect(driftDoc.title).not.toContain('unrecognized');
    // Drive past the ~40-tick (~28s) give-up threshold.
    for (let i = 0; i < 45; i++) tick?.();
    expect(driftDoc.title).toBe(NOTICE_CARD_TITLE_PREFIX + 'unrecognized');
  });

  // A live document the runner re-reads each tick, plus its driven tick fn.
  const driveRunner = (src: string, initialHtml: string) => {
    const doc = new DOMParser().parseFromString(initialHtml, 'text/html');
    let tick: (() => void) | undefined;
    const setIntervalStub = (fn: () => void): number => {
      tick = fn;
      return 1;
    };
    // eslint-disable-next-line @typescript-eslint/no-implied-eval -- runs our own generated runner (trusted source)
    const runRunner = new Function('document', 'window', 'setInterval', src) as (
      d: Document,
      w: object,
      si: (fn: () => void) => number,
    ) => void;
    runRunner(doc, {}, setIntervalStub);
    return { doc, tick: () => tick?.() };
  };
  const ADMITTED_HTML =
    '<html><body><button data-tid="hangup-main-btn" aria-label="Leave">Leave</button>' +
    '<span data-tid="call-duration">00:10</span></body></html>';

  it('LATCH (QA-91d): brief post-admission drift → present-unknown, then a heartbeat timeout → disconnected', () => {
    // The demo bug was force-closing the card ~28s after a real admit. Drift must NOT
    // fast-fail to unrecognized. But it also must NOT claim presence FOREVER (r2): once
    // the in-call anchors stay gone past the short grace window, it's a real disconnect.
    const { doc, tick } = driveRunner(buildInjectionScript(cfg()), ADMITTED_HTML);
    expect(doc.title).toBe(NOTICE_CARD_TITLE_PREFIX + 'admitted');
    // In-call anchors vanish to an unrecognized page (jsdom has no live call).
    doc.body.innerHTML = '<div>reconnecting…</div>';
    tick();
    expect(doc.title).toBe(NOTICE_CARD_TITLE_PREFIX + 'present-unknown'); // within grace
    // Never fast-fails to the pre-admission 'unrecognized' give-up.
    for (let i = 0; i < 4; i++) tick();
    expect(doc.title).toBe(NOTICE_CARD_TITLE_PREFIX + 'present-unknown'); // still in grace
    expect(doc.title).not.toContain('unrecognized');
    // …but past the grace window the heartbeat declares a real disconnect (evidence
    // must reflect the gap, not keep reporting presence).
    for (let i = 0; i < 5; i++) tick();
    expect(doc.title).toBe(NOTICE_CARD_TITLE_PREFIX + 'disconnected');
  });

  it('LATCH holds while the in-call anchors are still present (real drift, still in call)', () => {
    // "drifted-but-call-anchors-present": the page mutated but the hangup/call-duration
    // anchors remain → we ARE still in the call. detectPhase reads admitted; the latch
    // holds as admitted (never a disconnect).
    const { doc, tick } = driveRunner(buildInjectionScript(cfg()), ADMITTED_HTML);
    expect(doc.title).toBe(NOTICE_CARD_TITLE_PREFIX + 'admitted');
    // Heavy re-render but the Leave button + call timer survive.
    doc.body.innerHTML =
      '<div class="new-stage-layout"><button data-tid="hangup-main-btn" aria-label="Leave"></button>' +
      '<span data-tid="call-duration">05:42</span></div>';
    for (let i = 0; i < 20; i++) tick();
    expect(doc.title).toBe(NOTICE_CARD_TITLE_PREFIX + 'admitted');
    expect(doc.title).not.toContain('disconnected');
    expect(doc.title).not.toContain('present-unknown');
  });

  it('LATCH: post-admission bounce to the PREJOIN is a real disconnect (not presumed present)', () => {
    // A recognized non-call page after admission = we genuinely left the meeting. This
    // must NOT read as present — the consent evidence must never lie about presence.
    const { doc, tick } = driveRunner(buildInjectionScript(cfg()), ADMITTED_HTML);
    expect(doc.title).toBe(NOTICE_CARD_TITLE_PREFIX + 'admitted');
    // Bounced back to the prejoin (name field) — e.g. the call dropped and reloaded.
    doc.body.innerHTML =
      '<div data-tid="calling-prejoin-screen" role="region">' +
      '<input data-tid="prejoin-display-name-input" type="text" value="" aria-label="Type your name" />' +
      '<button data-tid="prejoin-join-button" aria-label="Join now">Join now</button></div>';
    tick();
    expect(doc.title).toBe(NOTICE_CARD_TITLE_PREFIX + 'disconnected');
    expect(doc.title).not.toContain('present-unknown');
  });

  it('LATCH: post-admission bounce to the LOBBY is a real disconnect', () => {
    const { doc, tick } = driveRunner(buildInjectionScript(cfg()), ADMITTED_HTML);
    expect(doc.title).toBe(NOTICE_CARD_TITLE_PREFIX + 'admitted');
    doc.body.innerHTML =
      '<div data-tid="calling-lobby-screen">Someone in the meeting should let you in soon</div>';
    tick();
    expect(doc.title).toBe(NOTICE_CARD_TITLE_PREFIX + 'disconnected');
  });

  it('LATCH does not fire without an admission — a never-admitted unrecognized page still fast-fails', () => {
    // Guard: the latch must not swallow the honest give-up when the card never got in.
    const src = buildInjectionScript(cfg());
    const doc = new DOMParser().parseFromString(
      '<html><body><div>still loading</div></body></html>',
      'text/html',
    );
    let tick: (() => void) | undefined;
    const setIntervalStub = (fn: () => void): number => {
      tick = fn;
      return 1;
    };
    // eslint-disable-next-line @typescript-eslint/no-implied-eval -- runs our own generated runner
    const runRunner = new Function('document', 'window', 'setInterval', src) as (
      d: Document,
      w: object,
      si: (fn: () => void) => number,
    ) => void;
    runRunner(doc, {}, setIntervalStub);
    for (let i = 0; i < 45; i++) tick?.();
    expect(doc.title).toBe(NOTICE_CARD_TITLE_PREFIX + 'unrecognized');
  });

  it('reports state through the document.title channel and strips the IPC bridge', () => {
    const src = buildInjectionScript(cfg());
    expect(src).toContain(NOTICE_CARD_TITLE_PREFIX);
    // We never CALL invoke, and we actively delete any injected IPC bridge so
    // the untrusted meeting page cannot reference it (defense in depth on top of
    // the capability isolation).
    expect(src).not.toContain('invoke(');
    expect(src).toContain('delete window.__TAURI_INTERNALS__');
    expect(src).toContain('delete window.__TAURI__');
  });

  it('re-asserts the status title when the meeting page overwrites document.title', () => {
    // Guards against Teams/Zoom rewriting document.title and the poller missing
    // the only NC:admitted/NC:lobby signal (Codex R3 P1).
    const src = buildInjectionScript(cfg());
    expect(src).toContain('document.title === desired');
  });

  it('writes status to document.title (the channel the native-title mirror carries)', () => {
    // The status channel is the PAGE's document.title (NC:<phase>). The Rust
    // side mirrors this into the native window title via
    // on_document_title_changed so notice_card_status's title() can read it —
    // reading document.title directly from Rust isn't possible (eval is
    // fire-and-forget). This asserts the source of that channel is document.title,
    // never a native-only mechanism.
    const src = buildInjectionScript(cfg());
    expect(src).toContain('document.title = desired');
  });

  it('selects the Zoom adapter for a Zoom config', () => {
    const src = buildInjectionScript(cfg({ platform: 'zoom', joinUrl: 'https://zoom.us/j/1' }));
    expect(() => new Function(src)).not.toThrow();
    // Zoom's name selector is distinctive.
    expect(src).toContain('#input-for-name');
  });

  it('prepends a camera install script when provided (v2 canvas camera)', () => {
    const src = buildInjectionScript(cfg(), { cameraScript: '/*CAMERA_MARKER*/' });
    expect(src).toContain('/*CAMERA_MARKER*/');
    expect(() => new Function(src)).not.toThrow();
  });

  it('unmutes only while an announcement plays, then re-mutes and blocks overlap', async () => {
    const src = buildInjectionScript(cfg(), {
      cameraScript: `
        window.__events = [];
        window.__NOTICE_CARD_ANNOUNCE_WAV_BASE64__ = function () {
          window.__events.push('speak');
          return new Promise(function (resolve) { window.__finishAnnouncement = resolve; });
        };
      `,
    });
    const doc = new DOMParser().parseFromString(
      '<html><body><button data-tid="toggle-mute" data-cid="toggle-mute-true" aria-checked="false"></button></body></html>',
      'text/html',
    );
    const toggle = doc.querySelector('[data-tid="toggle-mute"]');
    if (!(toggle instanceof HTMLElement)) throw new Error('missing Teams mic toggle');
    toggle.addEventListener('click', () => {
      const muted = toggle.getAttribute('data-cid') === 'toggle-mute-true';
      toggle.setAttribute('data-cid', muted ? 'toggle-mute-false' : 'toggle-mute-true');
    });
    const w: {
      __NOTICE_CARD_ANNOUNCE_WAV_BASE64__?: (b64: string) => Promise<unknown>;
      __finishAnnouncement?: (value: boolean) => void;
      __events?: string[];
    } = {};
    // eslint-disable-next-line @typescript-eslint/no-implied-eval -- runs our own generated runner
    const runRunner = new Function('document', 'window', 'setInterval', src) as (
      d: Document,
      w: object,
      si: (fn: () => void) => number,
    ) => void;
    runRunner(doc, w, () => 1);

    const first = w.__NOTICE_CARD_ANNOUNCE_WAV_BASE64__?.('a');
    expect(toggle.getAttribute('data-cid')).toBe('toggle-mute-false');
    const second = await w.__NOTICE_CARD_ANNOUNCE_WAV_BASE64__?.('b');
    expect(second).toBe(false);
    expect(w.__events).toEqual(['speak']);

    w.__finishAnnouncement?.(true);
    await first;
    expect(toggle.getAttribute('data-cid')).toBe('toggle-mute-true');
  });

  it('throws for a platform with no adapter (defensive; supervisor guards too)', () => {
    expect(() => buildInjectionScript(cfg({ platform: 'meet', joinUrl: 'https://meet.google.com/x' }))).toThrow();
    expect(() => buildInjectionScript(cfg({ platform: 'none', joinUrl: '' }))).toThrow();
  });
});
