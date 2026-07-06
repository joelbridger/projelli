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

  it('LATCH (QA-91d): after admission, an unrecognized page reports present-unknown, never a give-up', () => {
    // The exact demo bug: the card was admitted + visible, then ~28s later the runner
    // hit an unrecognized post-admission page and reported page-unrecognized, so the app
    // force-closed the card and told the presenter "couldn't join". Once admitted, drift
    // must downgrade to present-unknown and NEVER reach unrecognized/disconnected.
    const src = buildInjectionScript(cfg());
    // One live document we mutate between ticks (the runner re-reads it each tick).
    const doc = new DOMParser().parseFromString(
      '<html><body><button data-tid="hangup-main-btn" aria-label="Leave">Leave</button>' +
        '<span data-tid="call-duration">00:10</span></body></html>',
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
    // Immediate tick saw the real admitted DOM.
    expect(doc.title).toBe(NOTICE_CARD_TITLE_PREFIX + 'admitted');
    // Now the in-call DOM drifts to something the adapter doesn't recognize.
    doc.body.innerHTML = '<div>reconnecting…</div>';
    tick?.();
    expect(doc.title).toBe(NOTICE_CARD_TITLE_PREFIX + 'present-unknown');
    // Drive well past the ~40-tick give-up threshold — it must STAY present-unknown,
    // never flip to unrecognized or disconnected.
    for (let i = 0; i < 60; i++) tick?.();
    expect(doc.title).toBe(NOTICE_CARD_TITLE_PREFIX + 'present-unknown');
    expect(doc.title).not.toContain('unrecognized');
    expect(doc.title).not.toContain('disconnected');
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

  it('throws for a platform with no adapter (defensive; supervisor guards too)', () => {
    expect(() => buildInjectionScript(cfg({ platform: 'meet', joinUrl: 'https://meet.google.com/x' }))).toThrow();
    expect(() => buildInjectionScript(cfg({ platform: 'none', joinUrl: '' }))).toThrow();
  });
});
