/**
 * Notice Card — lifecycle supervisor.
 *
 * The correctness-critical heart of the feature. One supervisor manages one
 * card for one recording: it opens the isolated companion window on
 * record-start, drives it toward "admitted", and — the hard guarantee — always
 * leaves (closes the window) on record-stop, no matter what state it is in. A
 * wedged window can never linger past the recording: stop() always closes, and
 * a watchdog force-closes again if the first close hangs.
 *
 * It is deliberately framework-free (no React, no Zustand, no Tauri) so it can
 * be exhaustively unit-tested with a fake clock and a fake driver. The store
 * wires a real driver (Rust webview commands) + a real ledger sink + real Tauri
 * events into the `handle*` methods.
 *
 * It records nothing from the meeting and holds no meeting media — it only
 * observes join state and writes notice events to the consent ledger.
 */
import type {
  NoticeCardConfig,
  NoticeCardFailureReason,
  NoticeCardPlatform,
} from './noticeCardTypes';
import { canAutoJoin } from './noticeCardTypes';
import type { NoticeEntry } from '../noticeLedger';

/** The four card events the supervisor appends to the consent ledger. */
export type NoticeCardLedgerEvent = Extract<
  NoticeEntry,
  {
    kind:
      | 'notice-card-joined'
      | 'notice-card-left'
      | 'notice-card-failed'
      | 'notice-card-present-for-entire-recording';
  }
>;

/** The companion-window driver. MUST make `close()` idempotent and forceful. */
export interface NoticeCardDriver {
  /** Create the isolated companion window and begin the guest join. */
  open(config: NoticeCardConfig): Promise<void>;
  /** Tear down the window. Idempotent; a hard kill, not a polite request. */
  close(): Promise<void>;
}

/** Injectable clock so timeouts are deterministic in tests. */
export interface SupervisorClock {
  setTimeout(fn: () => void, ms: number): number;
  clearTimeout(handle: number): void;
}

const realClock: SupervisorClock = {
  setTimeout: (fn, ms) => setTimeout(fn, ms) as unknown as number,
  clearTimeout: (h) => {
    clearTimeout(h as unknown as ReturnType<typeof setTimeout>);
  },
};

/** UI-facing status of the card for one recording. */
export type NoticeCardStatus =
  | { phase: 'idle' }
  | { phase: 'joining'; platform: NoticeCardPlatform; meetingTitle?: string | undefined }
  | { phase: 'lobby'; platform: NoticeCardPlatform; meetingTitle?: string | undefined }
  | { phase: 'present'; platform: NoticeCardPlatform; meetingTitle?: string | undefined }
  | { phase: 'failed'; reason: NoticeCardFailureReason }
  | { phase: 'left' };

export interface SupervisorDeps {
  driver: NoticeCardDriver;
  record: (entry: NoticeCardLedgerEvent) => void;
  clock?: SupervisorClock;
  onStatus?: (status: NoticeCardStatus) => void;
  /** Max time from first open until "admitted" before we give up. */
  joinTimeoutMs?: number;
  /** If a close() hasn't confirmed within this, force another close. */
  watchdogMs?: number;
}

const DEFAULT_JOIN_TIMEOUT_MS = 120_000; // 2 min covers a slow host admit
const DEFAULT_WATCHDOG_MS = 5_000;

export class NoticeCardSupervisor {
  private readonly driver: NoticeCardDriver;
  private readonly record: (entry: NoticeCardLedgerEvent) => void;
  private readonly clock: SupervisorClock;
  private readonly onStatus?: ((status: NoticeCardStatus) => void) | undefined;
  private readonly joinTimeoutMs: number;
  private readonly watchdogMs: number;

  private _status: NoticeCardStatus = { phase: 'idle' };
  private config: NoticeCardConfig | null = null;
  private everAdmitted = false;
  private rejoinUsed = false;
  private terminal = false;
  private joinTimer: number | null = null;
  private watchdogTimer: number | null = null;

  constructor(deps: SupervisorDeps) {
    this.driver = deps.driver;
    this.record = deps.record;
    this.clock = deps.clock ?? realClock;
    this.onStatus = deps.onStatus;
    this.joinTimeoutMs = deps.joinTimeoutMs ?? DEFAULT_JOIN_TIMEOUT_MS;
    this.watchdogMs = deps.watchdogMs ?? DEFAULT_WATCHDOG_MS;
  }

  get status(): NoticeCardStatus {
    return this._status;
  }

  private setStatus(status: NoticeCardStatus): void {
    this._status = status;
    this.onStatus?.(status);
  }

  private nowIso(): string {
    // The ledger's `at` is a wall-clock stamp; the store passes a real Date at
    // append time in production. Kept out of the injected clock (which is a
    // monotonic timer, not a calendar) so tests stay deterministic.
    return new Date().toISOString();
  }

  /** The meeting dir for ledger entries; '' if start() hasn't run (never in
   *  practice, but keeps the type honest without a non-null assertion). */
  private meetingDir(): string {
    return this.config?.meetingDir ?? '';
  }

  private startJoinTimer(): void {
    this.clearJoinTimer();
    this.joinTimer = this.clock.setTimeout(() => {
      this.joinTimer = null;
      this.fail('join-timeout');
    }, this.joinTimeoutMs);
  }

  private clearJoinTimer(): void {
    if (this.joinTimer !== null) {
      this.clock.clearTimeout(this.joinTimer);
      this.joinTimer = null;
    }
  }

  /** Begin a fresh recording's card lifecycle. Resets all prior state. */
  start(config: NoticeCardConfig): void {
    this.config = config;
    this.everAdmitted = false;
    this.rejoinUsed = false;
    this.terminal = false;
    this.clearJoinTimer();

    if (!config.joinUrl.trim()) {
      this.failWithoutWindow('no-join-url');
      return;
    }
    if (!canAutoJoin(config.platform)) {
      // Meet / unknown URL: no adapter. The dialog shouldn't have offered this,
      // but we guard so we never open a window we can't drive.
      this.failWithoutWindow('unsupported-platform');
      return;
    }
    this.setStatus({ phase: 'joining', platform: config.platform, meetingTitle: config.meetingTitle });
    void this.openWindow();
    this.startJoinTimer();
  }

  private async openWindow(): Promise<void> {
    if (!this.config) return;
    try {
      await this.driver.open(this.config);
    } catch {
      this.fail('internal');
    }
  }

  // ── Driver events (wired from Tauri events by the store) ───────────────────

  handleLobby(): void {
    if (this.terminal) return;
    if (this._status.phase !== 'joining') return;
    this.setStatus({
      phase: 'lobby',
      platform: this._status.platform,
      meetingTitle: this._status.meetingTitle,
    });
  }

  handleAdmitted(): void {
    if (this.terminal) return;
    if (this._status.phase !== 'joining' && this._status.phase !== 'lobby') return;
    this.clearJoinTimer();
    const platform = this._status.platform;
    const meetingTitle = this._status.meetingTitle;
    if (!this.everAdmitted) {
      this.everAdmitted = true;
      this.record({
        kind: 'notice-card-joined',
        meetingDir: this.meetingDir(),
        at: this.nowIso(),
        platform,
        meetingTitle,
      });
    }
    this.setStatus({ phase: 'present', platform, meetingTitle });
  }

  handleDenied(): void {
    if (this.terminal) return;
    this.fail('denied');
  }

  handleDisconnected(): void {
    if (this.terminal) return;
    if (this._status.phase !== 'present') return; // only meaningful once in-meeting
    const platform = this._status.platform;
    const meetingTitle = this._status.meetingTitle;
    if (!this.rejoinUsed) {
      this.rejoinUsed = true;
      this.setStatus({ phase: 'joining', platform, meetingTitle });
      void this.openWindow();
      this.startJoinTimer();
      return;
    }
    // We already spent our one rejoin. Give up honestly.
    this.fail('window-closed');
  }

  /** Any other adapter-reported failure (page drift, internal error, …). */
  handleFailed(reason: NoticeCardFailureReason): void {
    if (this.terminal) return;
    this.fail(reason);
  }

  // ── Stop (the hard leave guarantee) ────────────────────────────────────────

  /**
   * Leave the meeting because recording stopped. Always closes the window.
   * Files `left` (+ the full-duration fact when the card covered the whole
   * recording) if the card had joined; otherwise files an honest failure that
   * the card never made it in. Idempotent.
   */
  stop(): Promise<void> {
    if (this.terminal) return Promise.resolve();
    this.terminal = true;
    this.clearJoinTimer();
    const current = this._status;
    const wasPresent = current.phase === 'present';
    const platform = wasPresent ? current.platform : this.config?.platform ?? 'none';

    if (wasPresent) {
      const meetingDir = this.meetingDir();
      this.record({ kind: 'notice-card-left', meetingDir, at: this.nowIso() });
      this.record({
        kind: 'notice-card-present-for-entire-recording',
        meetingDir,
        at: this.nowIso(),
        platform,
      });
      this.setStatus({ phase: 'left' });
    } else if (this.everAdmitted) {
      // Joined earlier but dropped / mid-rejoin at stop: honest left, but NOT
      // full-duration presence (there was a gap).
      this.record({ kind: 'notice-card-left', meetingDir: this.meetingDir(), at: this.nowIso() });
      this.setStatus({ phase: 'left' });
    } else {
      // Never admitted before the user stopped: the card did not join.
      this.record({
        kind: 'notice-card-failed',
        meetingDir: this.config?.meetingDir ?? '',
        at: this.nowIso(),
        reason: 'join-timeout',
      });
      this.setStatus({ phase: 'failed', reason: 'join-timeout' });
    }
    this.closeWithWatchdog();
    return Promise.resolve();
  }

  // ── Internal helpers ───────────────────────────────────────────────────────

  /** Enter a terminal failed state: file the reason and close the window. */
  private fail(reason: NoticeCardFailureReason): void {
    this.terminal = true;
    this.clearJoinTimer();
    this.record({
      kind: 'notice-card-failed',
      meetingDir: this.config?.meetingDir ?? '',
      at: this.nowIso(),
      reason,
    });
    this.setStatus({ phase: 'failed', reason });
    this.closeWithWatchdog();
  }

  /** Fail before any window was opened (no close needed, but harmless). */
  private failWithoutWindow(reason: NoticeCardFailureReason): void {
    this.terminal = true;
    this.record({
      kind: 'notice-card-failed',
      meetingDir: this.config?.meetingDir ?? '',
      at: this.nowIso(),
      reason,
    });
    this.setStatus({ phase: 'failed', reason });
  }

  /**
   * Close the window and guarantee it dies. Fires close immediately (does not
   * block on it), then arms a watchdog that force-closes again if the first
   * close hasn't confirmed — so a hung close can never leave the card lingering.
   */
  private closeWithWatchdog(): void {
    if (this.watchdogTimer !== null) {
      this.clock.clearTimeout(this.watchdogTimer);
      this.watchdogTimer = null;
    }
    let confirmed = false;
    const attempt = () => {
      this.driver.close().then(
        () => {
          confirmed = true;
        },
        () => {
          /* a failed close still counts as "we tried"; watchdog retries */
        },
      );
    };
    attempt();
    this.watchdogTimer = this.clock.setTimeout(() => {
      this.watchdogTimer = null;
      if (!confirmed) attempt();
    }, this.watchdogMs);
  }
}
