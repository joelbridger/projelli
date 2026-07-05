/**
 * Notice Card — join-adapter contract.
 *
 * An adapter is the platform-specific automation that runs INSIDE the companion
 * webview (injected via the window's initialization script — see
 * `../injectionScript.ts`). It reads the meeting client's own join page and
 * drives it: fill the guest name, mute the mic, click join, and report which
 * phase the join is in.
 *
 * Every adapter function is deliberately SELF-CONTAINED — it takes a `Document`
 * and uses only DOM APIs, no imports, no module-scope closures — so that (a) it
 * can be unit-tested against recorded page fixtures in jsdom, and (b) the exact
 * same source can be serialized (`Function.prototype.toString`) into the
 * injected script that runs in the real page. Keep them closure-free.
 */
import type { NoticeCardPlatform } from '../noticeCardTypes';

/** Where a guest join currently stands, as read off the page DOM. */
export type AdapterPhase =
  | 'loading' // page still initializing; nothing actionable recognized yet
  | 'name-entry' // a guest-name field is present (and needs filling)
  | 'ready-to-join' // name is set; a join / continue control is available
  | 'lobby' // admitted request sent; waiting for the host to let us in
  | 'admitted' // we are in the meeting
  | 'denied' // admission declined, or we were removed
  | 'unrecognized'; // the page matched nothing this adapter knows (web-client drift)

export interface JoinAdapter {
  readonly platform: NoticeCardPlatform;
  /** Classify the current page. Pure read; no side effects. */
  detectPhase(doc: Document): AdapterPhase;
  /** Fill the guest display-name field. Returns true if it found + set one. */
  fillGuestName(doc: Document, name: string): boolean;
  /** Ensure the mic is muted before joining. Returns true if muted/already. */
  ensureMuted(doc: Document): boolean;
  /** Click the join / continue control. Returns true if it clicked one. */
  clickJoin(doc: Document): boolean;
}
