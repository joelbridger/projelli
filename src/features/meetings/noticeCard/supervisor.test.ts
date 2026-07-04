import { describe, it, expect, beforeEach } from 'vitest';
import { NoticeCardSupervisor, type NoticeCardDriver } from './supervisor';
import type { NoticeCardConfig } from './noticeCardTypes';
import type { NoticeEntry } from '../noticeLedger';

/** A controllable fake clock: timers fire only when we advance past their due time. */
class FakeClock {
  now = 0;
  private seq = 1;
  private timers = new Map<number, { at: number; fn: () => void }>();
  setTimeout(fn: () => void, ms: number): number {
    const id = this.seq++;
    this.timers.set(id, { at: this.now + ms, fn });
    return id;
  }
  clearTimeout(id: number): void {
    this.timers.delete(id);
  }
  advance(ms: number): void {
    const target = this.now + ms;
    // Fire due timers in time order until we reach the target.
    for (;;) {
      let next: [number, { at: number; fn: () => void }] | undefined;
      for (const entry of this.timers) {
        if (entry[1].at <= target && (!next || entry[1].at < next[1].at)) next = entry;
      }
      if (!next) break;
      this.now = next[1].at;
      this.timers.delete(next[0]);
      next[1].fn();
    }
    this.now = target;
  }
}

/** A fake driver recording open/close calls; close() can be made to hang. */
class FakeDriver implements NoticeCardDriver {
  opens: NoticeCardConfig[] = [];
  closes = 0;
  private hangNextClose = false;
  makeNextCloseHang() {
    this.hangNextClose = true;
  }
  open(config: NoticeCardConfig): Promise<void> {
    this.opens.push(config);
    return Promise.resolve();
  }
  close(): Promise<void> {
    this.closes += 1;
    if (this.hangNextClose) {
      this.hangNextClose = false;
      return new Promise<void>(() => {}); // never resolves
    }
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
  const sup = new NoticeCardSupervisor({
    driver,
    clock,
    record: (e) => ledger.push(e),
    onStatus: (s) => statuses.push(s.phase),
  });
  return { clock, driver, ledger, statuses, sup };
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
});
