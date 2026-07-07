import { describe, it, expect, beforeEach } from 'vitest';
import { NoticeCardSupervisor, type NoticeCardDriver } from './supervisor';
import type { NoticeCardConfig } from './noticeCardTypes';
import type { NoticeEntry } from '../noticeLedger';

/** A controllable fake clock: timers fire only when we advance past their due time. */
class FakeClock {
  private t = 0;
  private seq = 1;
  private timers = new Map<number, { at: number; fn: () => void }>();
  now(): number {
    return this.t;
  }
  setTimeout(fn: () => void, ms: number): number {
    const id = this.seq++;
    this.timers.set(id, { at: this.t + ms, fn });
    return id;
  }
  clearTimeout(id: number): void {
    this.timers.delete(id);
  }
  advance(ms: number): void {
    const target = this.t + ms;
    // Fire due timers in time order until we reach the target.
    for (;;) {
      let next: [number, { at: number; fn: () => void }] | undefined;
      for (const entry of this.timers) {
        if (entry[1].at <= target && (!next || entry[1].at < next[1].at)) next = entry;
      }
      if (!next) break;
      this.t = next[1].at;
      this.timers.delete(next[0]);
      next[1].fn();
    }
    this.t = target;
  }
}

/** A fake driver recording open/close calls; close() can hang, open() can defer. */
class FakeDriver implements NoticeCardDriver {
  opens: NoticeCardConfig[] = [];
  closes = 0;
  announcements: string[] = [];
  private hangNextClose = false;
  private deferNext = false;
  private pendingOpenResolve: (() => void) | null = null;
  private pendingOpenReject: ((e: unknown) => void) | null = null;
  private rejectNextOpen = false;
  private rejectNextClose = false;
  makeNextCloseHang() {
    this.hangNextClose = true;
  }
  makeNextCloseReject() {
    this.rejectNextClose = true;
  }
  /** The next open() stays pending until resolve/rejectPendingOpen() is called. */
  deferNextOpen() {
    this.deferNext = true;
  }
  resolvePendingOpen() {
    const r = this.pendingOpenResolve;
    this.pendingOpenResolve = null;
    this.pendingOpenReject = null;
    r?.();
  }
  rejectPendingOpen() {
    const r = this.pendingOpenReject;
    this.pendingOpenResolve = null;
    this.pendingOpenReject = null;
    r?.(new Error('open failed'));
  }
  makeNextOpenReject() {
    this.rejectNextOpen = true;
  }
  open(config: NoticeCardConfig): Promise<void> {
    this.opens.push(config);
    if (this.rejectNextOpen) {
      this.rejectNextOpen = false;
      return Promise.reject(new Error('open failed with HRESULT 0x8007139F'));
    }
    if (this.deferNext) {
      this.deferNext = false;
      return new Promise<void>((res, rej) => {
        this.pendingOpenResolve = res;
        this.pendingOpenReject = rej;
      });
    }
    return Promise.resolve();
  }
  close(): Promise<void> {
    this.closes += 1;
    if (this.hangNextClose) {
      this.hangNextClose = false;
      return new Promise<void>(() => {}); // never resolves
    }
    if (this.rejectNextClose) {
      this.rejectNextClose = false;
      return Promise.reject(new Error('close failed'));
    }
    return Promise.resolve();
  }
  announce(text: string): Promise<void> {
    this.announcements.push(text);
    return Promise.resolve();
  }
}

const CONFIG: NoticeCardConfig = {
  joinUrl: 'https://teams.microsoft.com/l/meetup-join/abc',
  platform: 'teams',
  displayName: '⏺ Recording Notice — Sarah',
  meetingDir: 'Meetings/2026-07-04-henderson',
  meetingTitle: 'Henderson quarterly review',
};

function make() {
  const clock = new FakeClock();
  const driver = new FakeDriver();
  const ledger: NoticeEntry[] = [];
  const statuses: string[] = [];
  const diagnostics: Array<{ kind: string; reason?: string; message?: string; stage?: string; willRetry?: boolean }> = [];
  const sup = new NoticeCardSupervisor({
    driver,
    clock,
    record: (e) => ledger.push(e),
    onStatus: (s) => statuses.push(s.phase),
    onDiagnostic: (d) => diagnostics.push(d),
    entryAnnouncement: 'This meeting is being recorded',
  });
  return { clock, driver, ledger, statuses, diagnostics, sup };
}
const kinds = (ledger: NoticeEntry[]) => ledger.map((e) => e.kind);

describe('NoticeCardSupervisor — happy path', () => {
  let h: ReturnType<typeof make>;
  beforeEach(() => {
    h = make();
  });

  it('joins on start, ledgers joined on admit, leaves + files full-duration on stop', async () => {
    h.sup.start(CONFIG);
    expect(h.driver.opens).toHaveLength(1);
    expect(h.sup.status.phase).toBe('joining');

    h.sup.handleLobby();
    expect(h.sup.status.phase).toBe('lobby');

    h.sup.handleAdmitted();
    expect(h.sup.status.phase).toBe('present');
    expect(kinds(h.ledger)).toContain('notice-card-joined');
    const joined = h.ledger.find((e) => e.kind === 'notice-card-joined');
    expect(joined).toMatchObject({ platform: 'teams', meetingTitle: 'Henderson quarterly review' });

    await h.sup.stop();
    expect(h.driver.closes).toBeGreaterThanOrEqual(1);
    expect(kinds(h.ledger)).toEqual([
      'notice-card-joined',
      'notice-card-left',
      'notice-card-present-for-entire-recording',
    ]);
    expect(h.sup.status.phase).toBe('left');
  });

  it('speaks the entry phrase on admission and the stop phrase before leaving', async () => {
    h.sup.start(CONFIG);
    h.sup.handleAdmitted();
    await Promise.resolve();
    expect(h.driver.announcements).toContain('This meeting is being recorded');

    await h.sup.stop('Recording stopped');
    expect(h.driver.announcements).toContain('Recording stopped');
    expect(h.sup.status.phase).toBe('left');
  });
});

describe('NoticeCardSupervisor — failure modes', () => {
  it('files failed(denied) and closes when the host denies admission', () => {
    const h = make();
    h.sup.start(CONFIG);
    h.sup.handleLobby();
    h.sup.handleDenied();
    expect(h.sup.status).toEqual({ phase: 'failed', reason: 'denied' });
    expect(kinds(h.ledger)).toEqual(['notice-card-failed']);
    expect((h.ledger[0] as { reason: string }).reason).toBe('denied');
    expect(h.driver.closes).toBeGreaterThanOrEqual(1);
  });

  it('times out to failed(join-timeout) if never admitted within the window', () => {
    const h = make();
    h.sup.start(CONFIG);
    h.sup.handleLobby(); // stuck in lobby, host never admits
    h.clock.advance(200_000); // past the join timeout
    expect(h.sup.status).toEqual({ phase: 'failed', reason: 'join-timeout' });
    expect(kinds(h.ledger)).toEqual(['notice-card-failed']);
    expect(h.driver.closes).toBeGreaterThanOrEqual(1);
  });

  it('refuses to start without a supported platform (no window opened)', () => {
    const h = make();
    h.sup.start({ ...CONFIG, platform: 'meet', joinUrl: 'https://meet.google.com/abc' });
    expect(h.driver.opens).toHaveLength(0);
    expect(h.sup.status).toEqual({ phase: 'failed', reason: 'unsupported-platform' });
    expect(kinds(h.ledger)).toEqual(['notice-card-failed']);
  });

  it('files failed(no-join-url) when there is no link', () => {
    const h = make();
    h.sup.start({ ...CONFIG, platform: 'none', joinUrl: '' });
    expect(h.driver.opens).toHaveLength(0);
    expect((h.ledger[0] as { reason: string }).reason).toBe('no-join-url');
  });
});

describe('NoticeCardSupervisor — one auto-rejoin', () => {
  it('rejoins once on unexpected disconnect and stays present', () => {
    const h = make();
    h.sup.start(CONFIG);
    h.sup.handleAdmitted();
    expect(h.driver.opens).toHaveLength(1);

    h.sup.handleDisconnected(); // first drop → auto-rejoin
    expect(h.sup.status.phase).toBe('joining');
    expect(h.driver.opens).toHaveLength(2);

    h.sup.handleAdmitted(); // rejoin succeeds
    expect(h.sup.status.phase).toBe('present');
  });

  it('gives up after the second disconnect (only one rejoin allowed)', () => {
    const h = make();
    h.sup.start(CONFIG);
    h.sup.handleAdmitted();
    h.sup.handleDisconnected(); // uses the one rejoin
    h.sup.handleAdmitted();
    h.sup.handleDisconnected(); // second drop → give up
    expect(h.sup.status).toEqual({ phase: 'failed', reason: 'window-closed' });
    expect(kinds(h.ledger)).toContain('notice-card-failed');
  });

  it('does NOT claim full-duration presence when it ended in a failed rejoin', async () => {
    const h = make();
    h.sup.start(CONFIG);
    h.sup.handleAdmitted();
    h.sup.handleDisconnected();
    h.sup.handleAdmitted();
    h.sup.handleDisconnected(); // give up
    await h.sup.stop();
    expect(kinds(h.ledger)).not.toContain('notice-card-present-for-entire-recording');
  });
});

describe('NoticeCardSupervisor — admission is a one-way latch (QA-91d)', () => {
  it('presumed-present after admission does NOT fail or close the card', () => {
    const h = make();
    h.sup.start(CONFIG);
    h.sup.handleAdmitted();
    expect(h.sup.status.phase).toBe('present');

    // The runner saw an unrecognized post-admission page (DOM drift). The card is
    // physically in the meeting — this must NEVER become a failure or a close.
    h.sup.handlePresumedPresent();
    expect(h.sup.status.phase).toBe('present-unknown');
    expect(kinds(h.ledger)).not.toContain('notice-card-failed');
    expect(h.driver.closes).toBe(0); // still in the meeting, window untouched
  });

  it('the recorder pill never reads "failed" after an observed admission', () => {
    // Regression for the exact demo bug: tile visible, then "couldn't join".
    const h = make();
    h.sup.start(CONFIG);
    h.sup.handleAdmitted();
    h.sup.handlePresumedPresent();
    // present-unknown must be a PRESENT-ish, non-failed state.
    expect(h.sup.status.phase).not.toBe('failed');
  });

  it('stays alive across repeated drift, then files an honest left on stop', async () => {
    const h = make();
    h.sup.start(CONFIG);
    h.clock.advance(3_000);
    h.sup.handleAdmitted(); // prompt admit
    h.sup.handlePresumedPresent();
    h.sup.handlePresumedPresent(); // more drift ticks
    h.clock.advance(600_000);
    await h.sup.stop();
    expect(h.driver.closes).toBeGreaterThanOrEqual(1);
    // Admitted + never truly dropped → honest full-duration presence still stands.
    expect(kinds(h.ledger)).toEqual([
      'notice-card-joined',
      'notice-card-left',
      'notice-card-present-for-entire-recording',
    ]);
    expect(h.sup.status.phase).toBe('left');
  });

  it('re-admit after drift returns to a clean present state', () => {
    const h = make();
    h.sup.start(CONFIG);
    h.sup.handleAdmitted();
    h.sup.handlePresumedPresent();
    expect(h.sup.status.phase).toBe('present-unknown');
    h.sup.handleAdmitted(); // the in-call DOM became readable again
    expect(h.sup.status.phase).toBe('present');
  });

  it('presumed-present BEFORE any admission is ignored (never fabricates presence)', () => {
    const h = make();
    h.sup.start(CONFIG);
    h.sup.handleLobby();
    h.sup.handlePresumedPresent(); // stray token with no prior admit
    expect(h.sup.status.phase).toBe('lobby'); // unchanged
    expect(kinds(h.ledger)).not.toContain('notice-card-joined');
  });

  it('the NEVER-ADMITTED give-up still fails+closes honestly (after its one pre-admit retry)', () => {
    // The latch must not weaken the honest give-up when the card never got in.
    // With the pre-admit retry (no-knock fix) the FIRST page-unrecognized retries;
    // the SECOND is the honest terminal fail+close. Never fabricates presence.
    const h = make();
    h.sup.start(CONFIG);
    h.sup.handleFailed('page-unrecognized'); // first give-up → one fresh retry
    expect(h.sup.status.phase).toBe('joining');
    expect(h.driver.opens).toHaveLength(2);
    h.sup.handleFailed('page-unrecognized'); // retry also fails → honest terminal
    expect(h.sup.status).toEqual({ phase: 'failed', reason: 'page-unrecognized' });
    expect(kinds(h.ledger)).toEqual(['notice-card-failed']);
    expect(h.driver.closes).toBeGreaterThanOrEqual(1);
  });

  it('a genuinely closed window while presumed-present still triggers the one rejoin', () => {
    const h = make();
    h.sup.start(CONFIG);
    h.sup.handleAdmitted();
    h.sup.handlePresumedPresent(); // drift → presumed present
    h.sup.handleDisconnected(); // the window physically vanished (null title)
    // A real window death is still worth the one rejoin (latch suppresses DOM drift,
    // not an actually-gone window).
    expect(h.sup.status.phase).toBe('joining');
    expect(h.driver.opens).toHaveLength(2);
  });

  it('EVIDENCE INTEGRITY (r2): a detected gap after admission never yields full-duration presence', async () => {
    // The compliance rule: the consent ledger must never claim the card covered the
    // WHOLE recording if there was a detected disconnect gap. A brief drift stays
    // present (presumed present); a real disconnect (grace exceeded / bounce to a
    // non-call page) forfeits the full-duration claim but still honestly files 'left'.
    const h = make();
    h.sup.start(CONFIG);
    h.clock.advance(3_000);
    h.sup.handleAdmitted(); // prompt admit
    h.sup.handlePresumedPresent(); // brief unreadable window (still presumed present)
    h.sup.handleDisconnected(); // grace exceeded → a REAL gap → one rejoin
    expect(h.sup.status.phase).toBe('joining'); // no longer claiming presence
    h.clock.advance(10_000); // stop while still rejoining (before the rejoin times out)
    await h.sup.stop(); // user stops before any re-admit
    // Honest: it WAS in the meeting earlier, so 'left' is filed — but NEVER
    // full-duration presence, because there was a detected gap.
    expect(kinds(h.ledger)).toContain('notice-card-left');
    expect(kinds(h.ledger)).not.toContain('notice-card-present-for-entire-recording');
  });
});

describe('NoticeCardSupervisor — one pre-admission retry (the no-knock fix)', () => {
  it('retries once on a pre-lobby page-unrecognized, then a fresh window opens', () => {
    const h = make();
    h.sup.start(CONFIG);
    expect(h.driver.opens).toHaveLength(1);
    h.sup.handleFailed('page-unrecognized'); // never reached lobby → one clean retry
    expect(h.sup.status.phase).toBe('joining'); // not terminal
    expect(h.driver.opens).toHaveLength(2); // a fresh window/navigation
    expect(kinds(h.ledger)).not.toContain('notice-card-failed'); // no premature give-up
  });

  it('a retried attempt that then admits joins normally', () => {
    const h = make();
    h.sup.start(CONFIG);
    h.sup.handleFailed('page-unrecognized'); // first attempt stuck → retry
    expect(h.driver.opens).toHaveLength(2);
    h.sup.handleLobby();
    h.sup.handleAdmitted(); // the retry got in
    expect(h.sup.status.phase).toBe('present');
    expect(kinds(h.ledger)).toContain('notice-card-joined');
  });

  it('retries once on a pre-lobby join-timeout (never even knocked)', () => {
    const h = make();
    h.sup.start(CONFIG);
    // Never reaches lobby; the 120s join timer fires.
    h.clock.advance(200_000);
    expect(h.sup.status.phase).toBe('joining'); // retried, not failed
    expect(h.driver.opens).toHaveLength(2);
    // The retry also never knocks → the second timeout is the honest terminal.
    h.clock.advance(200_000);
    expect(h.sup.status).toEqual({ phase: 'failed', reason: 'join-timeout' });
    expect(kinds(h.ledger)).toEqual(['notice-card-failed']);
  });

  it('does NOT retry a lobby timeout — the card already knocked (never double-knocks)', () => {
    const h = make();
    h.sup.start(CONFIG);
    h.sup.handleLobby(); // reached the lobby: the host SAW the knock
    h.clock.advance(200_000); // host never admits
    // Re-knocking would double-signal the host; honest single fail instead.
    expect(h.sup.status).toEqual({ phase: 'failed', reason: 'join-timeout' });
    expect(h.driver.opens).toHaveLength(1); // no second window
  });

  it('does NOT retry a denied admission — the host explicitly said no', () => {
    const h = make();
    h.sup.start(CONFIG);
    h.sup.handleDenied();
    expect(h.sup.status).toEqual({ phase: 'failed', reason: 'denied' });
    expect(h.driver.opens).toHaveLength(1); // no re-knock after a refusal
  });

  it('spends only ONE pre-admit retry across mixed give-ups', () => {
    const h = make();
    h.sup.start(CONFIG);
    h.sup.handleFailed('page-unrecognized'); // uses the one retry
    expect(h.driver.opens).toHaveLength(2);
    h.clock.advance(200_000); // retry hits its own join-timeout → no more retries
    expect(h.sup.status.phase).toBe('failed');
    expect(h.driver.opens).toHaveLength(2); // never a third window
  });

  it('a card that admits only on the retry does NOT claim full-duration presence', async () => {
    // The first failed attempt is a real gap before admission — honest evidence
    // must not pretend the card covered the whole recording.
    const h = make();
    h.sup.start(CONFIG);
    h.sup.handleFailed('page-unrecognized'); // ~time passes on attempt 1
    h.clock.advance(40_000);
    h.sup.handleAdmitted(); // the retry finally gets in, late
    h.clock.advance(60_000);
    await h.sup.stop();
    expect(kinds(h.ledger)).toContain('notice-card-joined');
    expect(kinds(h.ledger)).toContain('notice-card-left');
    expect(kinds(h.ledger)).not.toContain('notice-card-present-for-entire-recording');
  });

  it('emits diagnostic breadcrumbs for the attempt trail (missing telemetry, now present)', () => {
    const h = make();
    h.sup.start(CONFIG);
    h.sup.handleFailed('page-unrecognized'); // give-up → retry
    h.sup.handleFailed('page-unrecognized'); // retry give-up → terminal
    const kindsSeen = h.diagnostics.map((d) => d.kind);
    expect(kindsSeen).toContain('attempt'); // at least the initial + the retry
    expect(kindsSeen).toContain('pre-admit-giveup');
    expect(kindsSeen).toContain('terminal');
    // The retry breadcrumb records that a second attempt happened.
    expect(h.diagnostics.filter((d) => d.kind === 'attempt').length).toBeGreaterThanOrEqual(2);
  });

  it('logs the real driver.open error and retries one open failure', async () => {
    const h = make();
    h.driver.makeNextOpenReject();
    h.sup.start(CONFIG);
    await Promise.resolve();
    await Promise.resolve();
    expect(h.driver.opens).toHaveLength(2);
    const openFailed = h.diagnostics.find((d) => d.kind === 'open-failed');
    expect(openFailed?.message).toContain('HRESULT');
    expect(openFailed?.willRetry).toBe(true);
    expect(h.sup.status.phase).toBe('joining');
  });

  it('includes the stalled stage in join-timeout telemetry', () => {
    const h = make();
    h.sup.start(CONFIG);
    h.sup.handleLobby();
    h.clock.advance(200_000);
    const giveup = h.diagnostics.find((d) => d.kind === 'pre-admit-giveup' && d.reason === 'join-timeout');
    expect(giveup?.stage).toBe('lobby');
  });
});

describe('NoticeCardSupervisor — watchdog (the hard leave guarantee)', () => {
  it('always closes the window on stop, even if never admitted', async () => {
    const h = make();
    h.sup.start(CONFIG);
    h.sup.handleLobby();
    await h.sup.stop(); // user stops before the card was admitted
    expect(h.driver.closes).toBeGreaterThanOrEqual(1);
    // Never admitted => honest failure, not a phantom "left".
    expect(kinds(h.ledger)).toContain('notice-card-failed');
  });

  it('force-closes again if the first close hangs (wedged window cannot linger)', () => {
    const h = make();
    h.sup.start(CONFIG);
    h.sup.handleAdmitted();
    h.driver.makeNextCloseHang();
    void h.sup.stop(); // first close() hangs
    expect(h.driver.closes).toBe(1);
    h.clock.advance(60_000); // watchdog fires
    expect(h.driver.closes).toBeGreaterThanOrEqual(2); // forced re-close
  });

  it('is idempotent: a second stop does not double-file left', async () => {
    const h = make();
    h.sup.start(CONFIG);
    h.sup.handleAdmitted();
    await h.sup.stop();
    const after = kinds(h.ledger).length;
    await h.sup.stop();
    expect(kinds(h.ledger).length).toBe(after);
  });

  it('ignores late driver events after a terminal stop', async () => {
    const h = make();
    h.sup.start(CONFIG);
    h.sup.handleAdmitted();
    await h.sup.stop();
    h.sup.handleDisconnected(); // stray late event
    h.sup.handleDenied();
    expect(h.sup.status.phase).toBe('left'); // unchanged
  });

  it('closes a window that finishes opening AFTER stop (stop-before-open race)', async () => {
    const h = make();
    h.driver.deferNextOpen(); // open() stays pending
    h.sup.start(CONFIG);
    expect(h.driver.opens).toHaveLength(1);
    await h.sup.stop(); // stops before the window exists
    const closesAfterStop = h.driver.closes;
    h.driver.resolvePendingOpen(); // the window finishes opening now
    await Promise.resolve();
    await Promise.resolve(); // flush the openWindow continuation
    // The race guard must have closed the just-opened window.
    expect(h.driver.closes).toBeGreaterThan(closesAfterStop);
  });
});

describe('NoticeCardSupervisor — honest full-duration evidence', () => {
  it('does NOT claim full-duration presence when the card was admitted late', async () => {
    const h = make();
    h.sup.start(CONFIG);
    h.clock.advance(40_000); // 40s of lobby/host delay (> the 30s tolerance)
    h.sup.handleAdmitted(); // admitted late — missed the opening minutes
    await h.sup.stop();
    // Honest: it joined and left, but it did NOT cover the whole recording.
    expect(kinds(h.ledger)).toContain('notice-card-joined');
    expect(kinds(h.ledger)).toContain('notice-card-left');
    expect(kinds(h.ledger)).not.toContain('notice-card-present-for-entire-recording');
  });

  it('claims full-duration presence when the card was admitted promptly', async () => {
    const h = make();
    h.sup.start(CONFIG);
    h.clock.advance(5_000); // joined within the tolerance
    h.sup.handleAdmitted();
    h.clock.advance(600_000); // long meeting
    await h.sup.stop();
    expect(kinds(h.ledger)).toContain('notice-card-present-for-entire-recording');
  });

  it('does NOT claim full-duration on a SHORT recording where admit was a large fraction of it', async () => {
    // Joining at 0:25 of a ~0:30 call is within the 30s absolute tolerance but
    // missed most of the meeting — must not claim it covered the whole thing.
    const h = make();
    h.sup.start(CONFIG);
    h.clock.advance(25_000); // 25s of lobby on a very short call
    h.sup.handleAdmitted();
    h.clock.advance(5_000); // stop at ~30s total
    await h.sup.stop();
    expect(kinds(h.ledger)).not.toContain('notice-card-present-for-entire-recording');
  });

  it('does NOT claim full-duration presence after a rejoin gap, even if present at stop', async () => {
    const h = make();
    h.sup.start(CONFIG);
    h.sup.handleAdmitted(); // prompt first admit
    h.sup.handleDisconnected(); // dropped → auto-rejoin (a gap in coverage)
    h.sup.handleAdmitted(); // rejoined, present again
    await h.sup.stop();
    expect(kinds(h.ledger)).toContain('notice-card-left');
    expect(kinds(h.ledger)).not.toContain('notice-card-present-for-entire-recording');
  });
});

describe('NoticeCardSupervisor — watchdog retries a FAILED close', () => {
  it('re-closes when the first close rejects (a real close failure must not be treated as done)', async () => {
    const h = make();
    h.sup.start(CONFIG);
    h.sup.handleAdmitted();
    h.driver.makeNextCloseReject();
    void h.sup.stop(); // first close() rejects
    expect(h.driver.closes).toBe(1);
    await Promise.resolve(); // let the rejection settle
    h.clock.advance(60_000); // watchdog fires
    expect(h.driver.closes).toBeGreaterThanOrEqual(2); // retried
  });
});

describe('NoticeCardSupervisor — late open failure after stop', () => {
  it('a late open() rejection after stop does not append a second failure or change state', async () => {
    const h = make();
    h.driver.deferNextOpen();
    h.sup.start(CONFIG); // open is pending
    await h.sup.stop(); // never admitted → terminal (failed join-timeout)
    const ledgerLen = h.ledger.length;
    const phase = h.sup.status.phase;
    h.driver.rejectPendingOpen(); // the create promise rejects now
    await Promise.resolve();
    await Promise.resolve();
    expect(h.ledger.length).toBe(ledgerLen); // no second failure event
    expect(h.sup.status.phase).toBe(phase); // final state untouched
  });
});
