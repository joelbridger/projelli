/**
 * docxSaveSession — cleanup batch 4 (task #24, QA-34 residual race).
 *
 * Focused unit tests of the persistent per-path save/retry session that lets
 * a `.docx`'s dirty/failing save survive a `DocxEditor` view unmounting (a
 * tab switch away and back). Runs against the REAL session class + a mocked
 * `@tauri-apps/api/core` invoke (not a full React render) so timing is
 * controlled with fake timers instead of real multi-second waits — the
 * equivalent React-level scenarios are covered end-to-end in
 * tests/unit/DocxEditor.test.tsx, but the explicit-discard behavior in
 * particular doesn't need a DOM at all to verify.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (cmd: string, args?: unknown) => invokeMock(cmd, args),
  isTauri: () => true,
}));

import {
  openDocxSession,
  getExistingDocxSession,
  __resetDocxSaveSessions,
} from '@/platform/fs/docxSaveSession';
import {
  isDocxRegistered,
  isDocxUnsaved,
  discardDocxSession,
  flushDocx,
  __resetDocxSaveRegistry,
} from '@/platform/fs/docxSaveRegistry';
import type { DocumentJson } from '@/platform/types/docx';

const DOC: DocumentJson = {
  formatVersion: 1,
  body: [{ kind: 'paragraph', inlines: [{ kind: 'run', text: 'hello' }] }],
  comments: {},
};

function mockInvoke(opts: { save: 'ok' | 'fail' | (() => boolean) }) {
  invokeMock.mockImplementation((cmd: string) => {
    if (cmd === 'docx_open') return Promise.resolve(DOC);
    if (cmd === 'docx_save') {
      const shouldFail = typeof opts.save === 'function' ? opts.save() : opts.save === 'fail';
      return shouldFail ? Promise.reject(new Error('locked')) : Promise.resolve(undefined);
    }
    return Promise.resolve(undefined);
  });
}

describe('docxSaveSession', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    __resetDocxSaveSessions();
    __resetDocxSaveRegistry();
    invokeMock.mockReset();
  });

  afterEach(() => {
    __resetDocxSaveSessions();
    vi.useRealTimers();
  });

  it('opens fresh via docx_open and registers with the shared save registry', async () => {
    mockInvoke({ save: 'ok' });
    const session = await openDocxSession('/ws/a.docx', {});
    expect(session.doc).toEqual(DOC);
    expect(invokeMock).toHaveBeenCalledWith('docx_open', expect.objectContaining({ path: '/ws/a.docx' }));
    expect(isDocxRegistered('/ws/a.docx')).toBe(true);
    expect(isDocxUnsaved('/ws/a.docx')).toBe(false);
  });

  it('resuming an existing session returns the SAME instance and never re-reads disk', async () => {
    mockInvoke({ save: 'ok' });
    const first = await openDocxSession('/ws/a.docx', {});
    const second = await openDocxSession('/ws/a.docx', {});
    expect(second).toBe(first);
    expect(invokeMock.mock.calls.filter((c) => c[0] === 'docx_open')).toHaveLength(1);
  });

  it('scheduleSave debounces, then a successful save clears dirty — the session stays registered and reusable', async () => {
    mockInvoke({ save: 'ok' });
    const session = await openDocxSession('/ws/a.docx', {});
    const edited: DocumentJson = { ...DOC, body: [{ kind: 'paragraph', inlines: [{ kind: 'run', text: 'edited' }] }] };
    session.scheduleSave(edited, 1200);

    expect(isDocxUnsaved('/ws/a.docx')).toBe(true);
    expect(invokeMock).not.toHaveBeenCalledWith('docx_save', expect.anything());

    await vi.advanceTimersByTimeAsync(1200);

    expect(invokeMock).toHaveBeenCalledWith(
      'docx_save',
      expect.objectContaining({ path: '/ws/a.docx', document: edited }),
    );
    expect(isDocxUnsaved('/ws/a.docx')).toBe(false);
    // QA-43 (coordinator P0): a session must NEVER self-dispose as a side
    // effect of a successful save, even with no view currently watching it —
    // doing so let a still-referenced session keep running with its writes
    // silently dropped from the registry on the NEXT failure (see the
    // "re-arms after a successful recovery" test below). It stays registered
    // (clean) and IS the same object a later reopen resumes.
    expect(isDocxRegistered('/ws/a.docx')).toBe(true);
    expect(getExistingDocxSession('/ws/a.docx')).toBe(session);
  });

  it('a failing save retries with backoff and keeps running with no view attached — this is the tab-switch keep-alive fix', async () => {
    let shouldFail = true;
    mockInvoke({ save: () => shouldFail });
    const session = await openDocxSession('/ws/a.docx', {});
    session.scheduleSave(DOC, 1200);
    await vi.advanceTimersByTimeAsync(1200);

    expect(invokeMock.mock.calls.filter((c) => c[0] === 'docx_save')).toHaveLength(1);
    expect(isDocxUnsaved('/ws/a.docx')).toBe(true);
    // Simulate the view unmounting: nothing else touches the session, but its
    // retry timer (a plain setTimeout, not tied to any component) keeps firing.
    await vi.advanceTimersByTimeAsync(750);
    expect(invokeMock.mock.calls.filter((c) => c[0] === 'docx_save')).toHaveLength(2);
    expect(isDocxRegistered('/ws/a.docx')).toBe(true); // still registered — the guards must still see it

    // A later "remount" resumes the SAME session with the SAME latest doc.
    const resumed = await openDocxSession('/ws/a.docx', {});
    expect(resumed).toBe(session);
    expect(invokeMock.mock.calls.filter((c) => c[0] === 'docx_open')).toHaveLength(1);

    // Let the lock clear — the retry that survived the whole round trip lands.
    shouldFail = false;
    await vi.advanceTimersByTimeAsync(1500);
    expect(isDocxUnsaved('/ws/a.docx')).toBe(false);
  });

  // QA-43 (coordinator P0, found live on a cloud bench 2026-07-04): the QA-34
  // fix handles the FIRST lock/fail/recover cycle correctly, but a reported
  // SECOND lock cycle on the SAME document silently stopped persisting while
  // the UI kept calmly showing "Saved" — restart-verified permanent loss.
  // This pins that the save/retry/escalation state machine fully RE-ARMS
  // after a successful recovery: a second, later failure on a NEW edit must
  // be just as visible (dirty + error, retrying) as the first, and the edit
  // that survived it must actually land on disk, not be dropped.
  it('re-arms after a successful recovery — a SECOND later lock cycle is just as visible and the edit survives it', async () => {
    let shouldFail = true;
    const savedDocs: DocumentJson[] = [];
    invokeMock.mockImplementation((cmd: string, args?: Record<string, unknown>) => {
      if (cmd === 'docx_open') return Promise.resolve(DOC);
      if (cmd === 'docx_save') {
        if (shouldFail) return Promise.reject(new Error('locked (cycle)'));
        savedDocs.push(args?.['document'] as DocumentJson);
        return Promise.resolve(undefined);
      }
      return Promise.resolve(undefined);
    });

    const session = await openDocxSession('/ws/a.docx', {});

    // ---- Cycle 1: lock, escalate, recover -------------------------------
    const docCycle1: DocumentJson = { ...DOC, body: [{ kind: 'paragraph', inlines: [{ kind: 'run', text: 'cycle 1 text' }] }] };
    session.scheduleSave(docCycle1, 1200);
    await vi.advanceTimersByTimeAsync(1200); // attempt 1: fails
    expect(session.saveError).not.toBeNull();
    expect(session.isDirty).toBe(true);
    await vi.advanceTimersByTimeAsync(750); // attempt 2: fails
    await vi.advanceTimersByTimeAsync(1500); // attempt 3: fails -> escalates
    expect(session.escalated).toBe(true);

    shouldFail = false;
    await vi.advanceTimersByTimeAsync(3000); // attempt 4: succeeds
    expect(session.isDirty).toBe(false);
    expect(session.saveError).toBeNull();
    expect(session.escalated).toBe(false);
    expect(savedDocs).toHaveLength(1);
    expect(savedDocs[0]).toEqual(docCycle1);

    // ---- Cycle 2: a NEW edit, a SECOND (later) lock cycle ----------------
    // This is the exact regression: after cycle 1's recovery, the state
    // machine must behave IDENTICALLY for a fresh failure — not silently
    // stay "clean" while the write keeps failing.
    shouldFail = true;
    const docCycle2: DocumentJson = { ...DOC, body: [{ kind: 'paragraph', inlines: [{ kind: 'run', text: 'cycle 2 text (must not be lost)' }] }] };
    session.scheduleSave(docCycle2, 1200);
    await vi.advanceTimersByTimeAsync(1200); // attempt 1 of cycle 2: fails

    // The UI must be truthful — NOT "Saved" — the instant this fails.
    expect(session.isDirty).toBe(true);
    expect(session.saveError).not.toBeNull();
    expect(isDocxUnsaved('/ws/a.docx')).toBe(true);

    await vi.advanceTimersByTimeAsync(750); // retry
    await vi.advanceTimersByTimeAsync(1500); // retry -> escalates again
    expect(session.escalated).toBe(true);

    // The lock clears — the SAME edit that survived the second cycle must
    // actually land on disk now, not have been silently dropped.
    shouldFail = false;
    await vi.advanceTimersByTimeAsync(3000);
    expect(session.isDirty).toBe(false);
    expect(session.saveError).toBeNull();
    expect(savedDocs).toHaveLength(2);
    expect(savedDocs[1]).toEqual(docCycle2);
  });

  // QA-81 (P0 silent data loss): the steady-state live-typing shadow save
  // (`persistLive`) must write the un-blurred keystrokes to disk on its own ~2s
  // cadence, but must NOT flood the version-history timeline with a snapshot
  // every couple of seconds — those snapshots mark meaningful COMMITTED edits
  // (blur / accept / redline), which still go through the normal save + DO snap.
  it('persistLive writes the live text to disk but does NOT take a version-history snapshot (committed saves still do)', async () => {
    mockInvoke({ save: 'ok' });
    const onAfterSave = vi.fn();
    const session = await openDocxSession('/ws/a.docx', { onAfterSave });

    const liveDoc: DocumentJson = { ...DOC, body: [{ kind: 'paragraph', inlines: [{ kind: 'run', text: 'live typed, not blurred' }] }] };
    await session.persistLive(liveDoc);

    // The live keystrokes reached disk...
    expect(invokeMock).toHaveBeenCalledWith(
      'docx_save',
      expect.objectContaining({ path: '/ws/a.docx', document: liveDoc }),
    );
    expect(session.isDirty).toBe(false);
    // ...but a mid-typing autosave took NO version snapshot.
    expect(onAfterSave).not.toHaveBeenCalled();

    // A committed (blurred) edit DOES snapshot, so the timeline still captures
    // the finished edit.
    const committed: DocumentJson = { ...DOC, body: [{ kind: 'paragraph', inlines: [{ kind: 'run', text: 'committed on blur' }] }] };
    session.scheduleSave(committed, 1200);
    await vi.advanceTimersByTimeAsync(1200);
    expect(onAfterSave).toHaveBeenCalledTimes(1);
  });

  // QA-81 (P2, review catch): snapshot suppression must survive a RETRY. A live
  // shadow save starts snapshot:false, but if it fails transiently and the
  // backoff retry lands BEFORE the run blurs, that retry must still NOT create a
  // version-history snapshot of uncommitted live typing — otherwise the timeline
  // fills with half-typed shadows. The retry has to carry the snapshot mode
  // through, not fall back to the default (snapshot:true).
  it('a retried live shadow save stays snapshot-free (the retry must not snapshot uncommitted typing)', async () => {
    let shouldFail = true;
    const onAfterSave = vi.fn();
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'docx_open') return Promise.resolve(DOC);
      if (cmd === 'docx_save') return shouldFail ? Promise.reject(new Error('locked')) : Promise.resolve(undefined);
      return Promise.resolve(undefined);
    });
    const session = await openDocxSession('/ws/a.docx', { onAfterSave });

    const liveDoc: DocumentJson = { ...DOC, body: [{ kind: 'paragraph', inlines: [{ kind: 'run', text: 'live typing, not blurred' }] }] };
    void session.persistLive(liveDoc); // attempt 1: fails
    await vi.advanceTimersByTimeAsync(0);
    expect(session.saveError).not.toBeNull();
    expect(session.isDirty).toBe(true);

    // The lock clears; the backoff retry (RETRY_BASE_MS = 750) lands the save.
    shouldFail = false;
    await vi.advanceTimersByTimeAsync(1000);
    expect(session.isDirty).toBe(false);
    expect(session.saveError).toBeNull();
    // The live text is on disk...
    expect(invokeMock).toHaveBeenCalledWith(
      'docx_save',
      expect.objectContaining({ path: '/ws/a.docx', document: liveDoc }),
    );
    // ...but the RETRY must have carried snapshot:false — no version snapshot of
    // still-uncommitted typing.
    expect(onAfterSave).not.toHaveBeenCalled();
  });

  // QA-81 (P2, review catch): a live shadow save can fire DURING a committed
  // edit's 1.2s debounce window (e.g. the user blurred run A, then focused run B
  // and keeps typing). persistLive clears that pending committed save's timer
  // and physically writes the content itself. The committed edit still lands on
  // disk — but its version-history snapshot (onAfterSave) must NOT be lost just
  // because a snapshot-free live save is what wrote it. The snapshot rides with
  // the content (pendingSnapshot), not with the timer.
  it('a live shadow save that absorbs a pending committed edit\'s debounce still takes the committed snapshot', async () => {
    mockInvoke({ save: 'ok' });
    const onAfterSave = vi.fn();
    const session = await openDocxSession('/ws/a.docx', { onAfterSave });

    // A committed edit (blur) is scheduled; its 1.2s debounce has NOT fired yet.
    const committed: DocumentJson = { ...DOC, body: [{ kind: 'paragraph', inlines: [{ kind: 'run', text: 'committed edit' }] }] };
    session.scheduleSave(committed, 1200);
    expect(onAfterSave).not.toHaveBeenCalled();

    // The live autosave fires inside that window — folding the focused run's
    // live text onto the committed content — and shadow-saves, absorbing the
    // committed debounce.
    const shadow: DocumentJson = { ...DOC, body: [{ kind: 'paragraph', inlines: [{ kind: 'run', text: 'committed edit + live' }] }] };
    await session.persistLive(shadow);

    // The content reached disk...
    expect(invokeMock).toHaveBeenCalledWith('docx_save', expect.objectContaining({ path: '/ws/a.docx', document: shadow }));
    expect(session.isDirty).toBe(false);
    // ...and the committed edit's version snapshot was NOT lost.
    expect(onAfterSave).toHaveBeenCalledTimes(1);

    // The absorbed committed debounce must not fire a second save/snapshot later.
    await vi.advanceTimersByTimeAsync(2000);
    expect(onAfterSave).toHaveBeenCalledTimes(1);
    expect(invokeMock.mock.calls.filter((c) => c[0] === 'docx_save')).toHaveLength(1);
  });

  // QA-81 (P2, review catch): a live shadow save FAILS (transient lock) and
  // queues a retry. Before the retry fires, the user BLURS — scheduleSave
  // replaces this.doc with the COMMITTED edit and marks it snapshot-worthy. The
  // retry (which reads the latest doc) must snapshot that committed edit, and
  // the later debounced save must not then find the session clean and skip the
  // snapshot — i.e. the blur commit must keep its version snapshot.
  it('a live-save retry that becomes a committed edit before it fires still snapshots the committed edit', async () => {
    let shouldFail = true;
    const onAfterSave = vi.fn();
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'docx_open') return Promise.resolve(DOC);
      if (cmd === 'docx_save') return shouldFail ? Promise.reject(new Error('locked')) : Promise.resolve(undefined);
      return Promise.resolve(undefined);
    });
    const session = await openDocxSession('/ws/a.docx', { onAfterSave });

    // Live typing shadow-saves and fails → a retry is queued (snapshot-free).
    const liveDoc: DocumentJson = { ...DOC, body: [{ kind: 'paragraph', inlines: [{ kind: 'run', text: 'live typing' }] }] };
    void session.persistLive(liveDoc);
    await vi.advanceTimersByTimeAsync(0);
    expect(session.saveError).not.toBeNull();
    expect(onAfterSave).not.toHaveBeenCalled();

    // Before the retry fires, the user BLURS — committing the edit. this.doc is
    // now the committed edit, which the pending retry will write.
    const committed: DocumentJson = { ...DOC, body: [{ kind: 'paragraph', inlines: [{ kind: 'run', text: 'live typing, committed' }] }] };
    session.scheduleSave(committed, 1200);

    // The lock clears; the backoff retry (RETRY_BASE_MS = 750) writes committed.
    shouldFail = false;
    await vi.advanceTimersByTimeAsync(800);
    expect(session.isDirty).toBe(false);
    expect(invokeMock).toHaveBeenCalledWith('docx_save', expect.objectContaining({ document: committed }));
    // The committed edit's snapshot must NOT be lost.
    expect(onAfterSave).toHaveBeenCalledTimes(1);

    // The later debounced save sees a clean session and neither double-snapshots
    // nor re-snapshots — the count stays exactly 1.
    await vi.advanceTimersByTimeAsync(2000);
    expect(onAfterSave).toHaveBeenCalledTimes(1);
  });

  // QA-81 (P0, Codex review catch): the live-typing autosave fires every ~2s, so
  // if one docx_save runs longer than that, an OLDER live save can complete
  // while a NEWER one is still queued. The older completion must NOT publish a
  // false "Saved" (clean) — a close/quit guard would then believe the newest
  // text is safely on disk when it isn't yet, and could lose it. `persistLive`
  // marks the session dirty before queuing, so only the NEWEST write's own
  // completion clears it.
  it('an overlapping older live save completing does NOT falsely report clean while newer text is still queued', async () => {
    const gates: Array<() => void> = [];
    const savedDocs: DocumentJson[] = [];
    invokeMock.mockImplementation((cmd: string, args?: Record<string, unknown>) => {
      if (cmd === 'docx_open') return Promise.resolve(DOC);
      if (cmd === 'docx_save') {
        return new Promise<void>((resolve) => {
          gates.push(() => {
            savedDocs.push(args?.['document'] as DocumentJson);
            resolve();
          });
        });
      }
      return Promise.resolve(undefined);
    });

    const session = await openDocxSession('/ws/a.docx', {});

    const docA: DocumentJson = { ...DOC, body: [{ kind: 'paragraph', inlines: [{ kind: 'run', text: 'live A' }] }] };
    void session.persistLive(docA); // write A starts, then hangs on its gate
    await vi.advanceTimersByTimeAsync(0);
    expect(gates).toHaveLength(1); // A's docx_save is in flight

    // The user keeps typing — a NEWER live save is scheduled behind A (the write
    // coordinator serializes it, so its docx_save hasn't been CALLED yet).
    const docB: DocumentJson = { ...DOC, body: [{ kind: 'paragraph', inlines: [{ kind: 'run', text: 'live B (newest, must not be lost)' }] }] };
    void session.persistLive(docB);
    await vi.advanceTimersByTimeAsync(0);
    expect(session.doc).toEqual(docB);
    expect(session.isDirty).toBe(true);
    expect(gates).toHaveLength(1); // B still queued behind A — not called yet

    // A lands. Its completion is STALE (doc is now docB) — it must leave the
    // session dirty, not falsely clean.
    gates[0]!();
    await vi.advanceTimersByTimeAsync(0);
    expect(session.isDirty).toBe(true);
    expect(isDocxUnsaved('/ws/a.docx')).toBe(true);
    expect(gates).toHaveLength(2); // now B's write is in flight

    // B lands — NOW the session is truthfully clean, with the newest text saved.
    gates[1]!();
    await vi.advanceTimersByTimeAsync(0);
    expect(session.isDirty).toBe(false);
    expect(isDocxUnsaved('/ws/a.docx')).toBe(false);
    expect(savedDocs.at(-1)).toEqual(docB);
  });

  it('discardDocxSession stops the retry loop for good — a discarded save never lands later', async () => {
    mockInvoke({ save: 'fail' });
    const session = await openDocxSession('/ws/a.docx', {});
    session.scheduleSave(DOC, 1200);
    await vi.advanceTimersByTimeAsync(1200);
    const attemptsAtDiscard = invokeMock.mock.calls.filter((c) => c[0] === 'docx_save').length;
    expect(attemptsAtDiscard).toBeGreaterThanOrEqual(1);
    expect(isDocxRegistered('/ws/a.docx')).toBe(true);

    // The user explicitly chooses "close and lose changes".
    discardDocxSession('/ws/a.docx');
    expect(isDocxRegistered('/ws/a.docx')).toBe(false);
    expect(session.isDisposed).toBe(true);

    // Even if the lock would have cleared, nothing keeps trying — the
    // abandoned edit must never silently land on disk later.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(invokeMock.mock.calls.filter((c) => c[0] === 'docx_save')).toHaveLength(attemptsAtDiscard);
    expect(getExistingDocxSession('/ws/a.docx')).toBeUndefined();
  });

  it('disposeIfClean (a view unmounting while clean) removes the session; a dirty one survives', async () => {
    mockInvoke({ save: 'fail' });
    const session = await openDocxSession('/ws/a.docx', {});
    expect(session.disposeIfClean()).toBe(true);
    expect(isDocxRegistered('/ws/a.docx')).toBe(false);

    const dirtySession = await openDocxSession('/ws/b.docx', {});
    dirtySession.scheduleSave(DOC, 1200);
    await vi.advanceTimersByTimeAsync(1200);
    expect(dirtySession.disposeIfClean()).toBe(false);
    expect(isDocxRegistered('/ws/b.docx')).toBe(true);
  });

  // Codex review catch (P2): flushDocx (what closeDocxTabSafely/quit-flush
  // actually calls) must report the SESSION's truth, not just whether one
  // write happened to land. A write can succeed while already being STALE —
  // a newer edit arrives via scheduleSave while the write is in flight —
  // which correctly keeps `isDirty` true, but the underlying attempt still
  // "succeeded". If flushDocx blindly forwarded that success, a close flow
  // would treat a still-dirty session as safe and discard the newer edit.
  it('flushDocx does not report success while a newer edit raced the in-flight write — it catches up and saves it', async () => {
    const saveGate: { resolve: (() => void) | null } = { resolve: null };
    let saveCallCount = 0;
    const savedDocs: DocumentJson[] = [];
    invokeMock.mockImplementation((cmd: string, args?: Record<string, unknown>) => {
      if (cmd === 'docx_open') return Promise.resolve(DOC);
      if (cmd === 'docx_save') {
        saveCallCount += 1;
        if (saveCallCount === 1) {
          // The FIRST write hangs until the test explicitly resolves it,
          // simulating a save that's still in flight when a newer edit lands.
          return new Promise<void>((resolve) => {
            saveGate.resolve = () => {
              savedDocs.push(args?.['document'] as DocumentJson);
              resolve();
            };
          });
        }
        savedDocs.push(args?.['document'] as DocumentJson);
        return Promise.resolve(undefined);
      }
      return Promise.resolve(undefined);
    });

    const session = await openDocxSession('/ws/a.docx', {});
    const docA: DocumentJson = { ...DOC, body: [{ kind: 'paragraph', inlines: [{ kind: 'run', text: 'doc A' }] }] };
    session.scheduleSave(docA, 1200);
    await vi.advanceTimersByTimeAsync(1200); // attemptSave(docA) starts; docx_save is now hung

    // A NEWER edit lands while docA's write is still in flight.
    const docB: DocumentJson = { ...DOC, body: [{ kind: 'paragraph', inlines: [{ kind: 'run', text: 'doc B (must not be lost)' }] }] };
    session.scheduleSave(docB, 1200);
    expect(session.doc).toEqual(docB);
    expect(session.isDirty).toBe(true);

    // Let docA's (now-stale) write land.
    saveGate.resolve?.();
    await vi.advanceTimersByTimeAsync(0);
    // The stale completion must NOT have cleared isDirty (docB is still unsaved).
    expect(session.isDirty).toBe(true);

    // Something (close/quit) forces a flush right now, before docB's own
    // debounce would have fired on its own.
    const flushed = await flushDocx('/ws/a.docx');
    expect(flushed).toBe(true);
    expect(session.isDirty).toBe(false);
    expect(savedDocs.at(-1)).toEqual(docB);
  });

  // Codex review catch (post-merge, P2): flush()'s retry loop used to require
  // `saveError === null` just to ENTER the loop at all — meaning a
  // close/switch/quit flush called while the session was ALREADY in a failed
  // state (saveError set from a prior attempt) would skip trying again
  // entirely and report failure immediately, even if the underlying lock had
  // JUST cleared. The old (pre-session) registry flush always attempted one
  // more save in this situation; this pins that a final flush must too, so a
  // recoverable transient failure never causes a false "can't save" that
  // could lead the user to discard changes that would actually persist fine.
  it('flush() still attempts a fresh save when called while ALREADY in a failed state — a cleared lock is not falsely reported as unsaveable', async () => {
    let shouldFail = true;
    mockInvoke({ save: () => shouldFail });
    const session = await openDocxSession('/ws/a.docx', {});
    const edited: DocumentJson = { ...DOC, body: [{ kind: 'paragraph', inlines: [{ kind: 'run', text: 'edited while locked' }] }] };
    session.scheduleSave(edited, 1200);
    await vi.advanceTimersByTimeAsync(1200); // attempt 1: fails
    expect(session.saveError).not.toBeNull();
    expect(session.isDirty).toBe(true);
    const attemptsBeforeFlush = invokeMock.mock.calls.filter((c) => c[0] === 'docx_save').length;

    // The lock clears RIGHT NOW, before the natural backoff retry timer
    // fires — the user closes/switches/quits at this exact moment.
    shouldFail = false;
    const flushed = await flushDocx('/ws/a.docx');

    // A fresh attempt MUST have been made (not just "no, still failing from
    // before") — the lock is clear now, so the flush must succeed.
    const attemptsAfterFlush = invokeMock.mock.calls.filter((c) => c[0] === 'docx_save').length;
    expect(attemptsAfterFlush).toBeGreaterThan(attemptsBeforeFlush);
    expect(flushed).toBe(true);
    expect(session.isDirty).toBe(false);
    expect(session.saveError).toBeNull();
  });

  // Companion case: if the lock genuinely never clears, flush() must still
  // give an HONEST failure (not spin forever) — the retry-when-already-
  // failing fix above must stay bounded.
  it('flush() reports honest failure (bounded retries) when the lock genuinely never clears', async () => {
    mockInvoke({ save: 'fail' });
    const session = await openDocxSession('/ws/a.docx', {});
    session.scheduleSave(DOC, 1200);
    await vi.advanceTimersByTimeAsync(1200);
    expect(session.saveError).not.toBeNull();
    const attemptsBeforeFlush = invokeMock.mock.calls.filter((c) => c[0] === 'docx_save').length;

    const flushed = await flushDocx('/ws/a.docx');

    expect(flushed).toBe(false);
    expect(session.isDirty).toBe(true);
    expect(session.saveError).not.toBeNull();
    const attemptsAfterFlush = invokeMock.mock.calls.filter((c) => c[0] === 'docx_save').length;
    // It DID try again (bounded), it just never succeeded.
    expect(attemptsAfterFlush).toBeGreaterThan(attemptsBeforeFlush);
  });
});
