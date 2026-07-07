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
  /** Speak a short phrase through the card's fake microphone stream. */
  announce?(text: string): Promise<void>;
  /** Tear down the window. Idempotent; a hard kill, not a polite request. */
  close(): Promise<void>;
}

/**
 * Diagnostic breadcrumbs (no-knock investigation). Emitted alongside status so a
 * live bench run can see HOW FAR each join attempt got and which give-up fired —
 * the telemetry that was missing to prove the intermittent "never knocked" no-show.
 * These are logs, NOT consent-ledger evidence (the ledger stays untouched).
 */
export type NoticeCardDiagnostic =
  | { kind: 'attempt'; attempt: number; reason: 'initial' | 'pre-admit-retry' }
  | { kind: 'open-failed'; attempt: number; message: string; willRetry: boolean }
  | { kind: 'pre-admit-giveup'; reason: NoticeCardFailureReason; willRetry: boolean; stage: string }
  | { kind: 'admitted'; attempt: number }
  | { kind: 'terminal'; reason: NoticeCardFailureReason };

/** Injectable clock so timeouts + elapsed measurement are deterministic in tests. */
export interface SupervisorClock {
  setTimeout(fn: () => void, ms: number): number;
  clearTimeout(handle: number): void;
  /** Monotonic-ish milliseconds, for measuring admit latency vs record-start. */
  now(): number;
}

const realClock: SupervisorClock = {
  setTimeout: (fn, ms) => setTimeout(fn, ms) as unknown as number,
  clearTimeout: (h) => {
    clearTimeout(h as unknown as ReturnType<typeof setTimeout>);
  },
  now: () => Date.now(),
};

/** UI-facing status of the card for one recording. */
export type NoticeCardStatus =
  | { phase: 'idle' }
  | { phase: 'joining'; platform: NoticeCardPlatform; meetingTitle?: string | undefined }
  | { phase: 'lobby'; platform: NoticeCardPlatform; meetingTitle?: string | undefined }
  | { phase: 'present'; platform: NoticeCardPlatform; meetingTitle?: string | undefined }
  // Admitted, then the page stopped matching (QA-91d one-way latch): the card is
  // physically in the meeting but the DOM is momentarily unreadable. A PRESENT-ish,
  // never-failed state — the recorder widget must not read "couldn't join" here.
  | { phase: 'present-unknown'; platform: NoticeCardPlatform; meetingTitle?: string | undefined }
  | { phase: 'failed'; reason: NoticeCardFailureReason }
  | { phase: 'left' };

export interface SupervisorDeps {
  driver: NoticeCardDriver;
  record: (entry: NoticeCardLedgerEvent) => void;
  clock?: SupervisorClock;
  onStatus?: (status: NoticeCardStatus) => void;
  /** Attempt-trail breadcrumbs for the no-knock investigation (see NoticeCardDiagnostic). */
  onDiagnostic?: (event: NoticeCardDiagnostic) => void;
  /** Spoken by the card once it is admitted into the meeting. */
  entryAnnouncement?: string;
  /** Max time from first open until "admitted" before we give up. */
  joinTimeoutMs?: number;
  /** If a close() hasn't confirmed within this, force another close. */
  watchdogMs?: number;
  /** Max admit latency (from record-start) that still counts as the card having
   *  covered the WHOLE recording. A late admit (slow host/lobby) means the card
   *  missed the opening minutes, so it must NOT claim full-duration presence. */
  fullPresenceToleranceMs?: number;
}

const DEFAULT_JOIN_TIMEOUT_MS = 120_000; // 2 min covers a slow host admit
const DEFAULT_WATCHDOG_MS = 5_000;
const DEFAULT_FULL_PRESENCE_TOLERANCE_MS = 30_000; // "joined promptly" window

export class NoticeCardSupervisor {
  private readonly driver: NoticeCardDriver;
  private readonly record: (entry: NoticeCardLedgerEvent) => void;
  private readonly clock: SupervisorClock;
  private readonly onStatus?: ((status: NoticeCardStatus) => void) | undefined;
  private readonly onDiagnostic?: ((event: NoticeCardDiagnostic) => void) | undefined;
  private readonly entryAnnouncement?: string | undefined;
  private readonly joinTimeoutMs: number;
  private readonly watchdogMs: number;
  private readonly fullPresenceToleranceMs: number;

  private _status: NoticeCardStatus = { phase: 'idle' };
  private config: NoticeCardConfig | null = null;
  private everAdmitted = false;
  private everReachedLobby = false;
  private rejoinUsed = false;
  // The card gets exactly ONE fresh re-open before it ever knocks (no-knock fix):
  // a single transient pre-lobby failure (unrecognized page / stuck launcher /
  // cold-load timing) otherwise becomes a permanent no-show, the observed ~1/3.
  private preAdmitRetryUsed = false;
  private terminal = false;
  private joinTimer: number | null = null;
  private watchdogTimer: number | null = null;
  private startedAtMs: number | null = null;
  private admittedAtMs: number | null = null;
  private lastStage: 'not-started' | 'opening' | 'joining' | 'lobby' | 'present' | 'present-unknown' = 'not-started';

  constructor(deps: SupervisorDeps) {
    this.driver = deps.driver;
    this.record = deps.record;
    this.clock = deps.clock ?? realClock;
    this.onStatus = deps.onStatus;
    this.onDiagnostic = deps.onDiagnostic;
    this.entryAnnouncement = deps.entryAnnouncement;
    this.joinTimeoutMs = deps.joinTimeoutMs ?? DEFAULT_JOIN_TIMEOUT_MS;
    this.watchdogMs = deps.watchdogMs ?? DEFAULT_WATCHDOG_MS;
    this.fullPresenceToleranceMs = deps.fullPresenceToleranceMs ?? DEFAULT_FULL_PRESENCE_TOLERANCE_MS;
  }

  get status(): NoticeCardStatus {
    return this._status;
  }

  private setStatus(status: NoticeCardStatus): void {
    this._status = status;
    switch (status.phase) {
      case 'joining':
        this.lastStage = 'joining';
        break;
      case 'lobby':
        this.lastStage = 'lobby';
        break;
      case 'present':
        this.lastStage = 'present';
        break;
      case 'present-unknown':
        this.lastStage = 'present-unknown';
        break;
      default:
        break;
    }
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
      this.failOrRetryPreAdmission('join-timeout');
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
    this.everReachedLobby = false;
    this.rejoinUsed = false;
    this.preAdmitRetryUsed = false;
    this.terminal = false;
    this.startedAtMs = this.clock.now();
    this.admittedAtMs = null;
    this.lastStage = 'not-started';
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
    this.onDiagnostic?.({ kind: 'attempt', attempt: 1, reason: 'initial' });
    void this.openWindow();
    this.startJoinTimer();
  }

  private async openWindow(): Promise<void> {
    if (!this.config) return;
    this.lastStage = 'opening';
    try {
      await this.driver.open(this.config);
      // Race guard: if the recording was stopped (or the card failed) while this
      // open was in flight, the window would otherwise be left behind — close it
      // immediately. The hard leave guarantee must survive a stop-before-open.
      if (this.terminal) {
        void this.driver.close();
      }
    } catch (err) {
      // A late open rejection AFTER we've already stopped/failed must not append
      // a second failure or overwrite the final left/stopped state — no-op.
      if (this.terminal) return;
      const message = err instanceof Error ? err.message : String(err);
      this.failOrRetryOpenFailure(message);
    }
  }

  // ── Driver events (wired from Tauri events by the store) ───────────────────

  handleLobby(): void {
    if (this.terminal) return;
    if (this._status.phase !== 'joining') return;
    // The card physically knocked — the host saw a join request. Past this point a
    // timeout is an admission delay, NOT a no-show: never re-knock (that would
    // double-signal the host), so the pre-admit retry is disabled once here.
    this.everReachedLobby = true;
    this.setStatus({
      phase: 'lobby',
      platform: this._status.platform,
      meetingTitle: this._status.meetingTitle,
    });
  }

  handleAdmitted(): void {
    if (this.terminal) return;
    // Allow re-admit from 'present-unknown' too (QA-91d): when the in-call DOM becomes
    // readable again after drift, snap back to a clean 'present'. The everAdmitted guard
    // below keeps the 'notice-card-joined' ledger entry to exactly once.
    if (
      this._status.phase !== 'joining' &&
      this._status.phase !== 'lobby' &&
      this._status.phase !== 'present-unknown'
    ) {
      return;
    }
    this.clearJoinTimer();
    const platform = this._status.platform;
    const meetingTitle = this._status.meetingTitle;
    if (!this.everAdmitted) {
      this.everAdmitted = true;
      this.admittedAtMs = this.clock.now();
      this.onDiagnostic?.({ kind: 'admitted', attempt: this.preAdmitRetryUsed ? 2 : 1 });
      if (this.entryAnnouncement) {
        void this.announce(this.entryAnnouncement);
      }
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

  /**
   * The runner observed an unrecognized page AFTER admission (QA-91d one-way latch).
   * The card is physically in the meeting, so we NEVER fail or close here — that is
   * exactly the false "couldn't join" the demo hit ~28s after a real admit. Downgrade
   * to a present-but-state-unknown status and keep the card alive until stop() ends the
   * recording normally. Defensive: ignored before a real admission (never fabricates
   * presence) and once terminal.
   */
  handlePresumedPresent(): void {
    if (this.terminal) return;
    if (!this.everAdmitted) return; // never claim presence we didn't actually reach
    this.clearJoinTimer(); // admission already happened; no give-up clock applies
    // Already left the call for real (rejoin exhausted → failed) can't reach here
    // (terminal). From 'present' or a prior 'present-unknown', re-assert presumed
    // present. Carry the platform/title from config (stable across the whole card).
    if (this._status.phase === 'failed' || this._status.phase === 'left') return;
    this.setStatus({
      phase: 'present-unknown',
      platform: this.config?.platform ?? 'none',
      meetingTitle: this.config?.meetingTitle,
    });
  }

  handleDisconnected(): void {
    if (this.terminal) return;
    // Meaningful only once in-meeting. Includes 'present-unknown' (QA-91d): a genuinely
    // CLOSED window while presumed-present is still a real drop worth one rejoin — the
    // latch only suppresses DOM-drift disconnects, not an actually-gone window.
    if (this._status.phase !== 'present' && this._status.phase !== 'present-unknown') return;
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
    this.failOrRetryPreAdmission(reason);
  }

  /**
   * A pre-lobby give-up (the card never even knocked). Grant EXACTLY ONE fresh
   * re-open before the honest terminal failure — the no-knock fix. A single
   * transient pre-lobby hiccup (unrecognized page, stuck launcher, cold-load
   * timing) would otherwise become a permanent no-show (the observed ~1/3),
   * because the pre-admission leg had no retry (the one existing rejoin is
   * post-admission only).
   *
   * Retry ONLY when: never admitted, never reached the lobby (so we never
   * re-knock and double-signal the host), the retry is unused, and the reason is
   * a "stuck/unrecognized" one — NEVER a `denied` (the host said no) or a lobby
   * timeout. A fresh `openWindow()` destroys + re-navigates the companion window,
   * re-running the whole launcher→prejoin→knock flow. `startedAtMs` is NOT reset,
   * so a late admit on the retry correctly forfeits full-duration presence.
   */
  private failOrRetryPreAdmission(reason: NoticeCardFailureReason): void {
    if (this.terminal) return;
    const eligible =
      !this.everAdmitted &&
      !this.everReachedLobby &&
      !this.preAdmitRetryUsed &&
      (reason === 'page-unrecognized' || reason === 'join-timeout');
    this.onDiagnostic?.({ kind: 'pre-admit-giveup', reason, willRetry: eligible, stage: this.lastStage });
    if (!eligible) {
      this.fail(reason);
      return;
    }
    this.preAdmitRetryUsed = true;
    this.clearJoinTimer();
    this.setStatus({
      phase: 'joining',
      platform: this.config?.platform ?? 'none',
      meetingTitle: this.config?.meetingTitle,
    });
    this.onDiagnostic?.({ kind: 'attempt', attempt: 2, reason: 'pre-admit-retry' });
    // Fire-and-forget like the other open sites (start/rejoin): openWindow has its
    // own try/catch and never rejects, so there is nothing to await or handle.
    // eslint-disable-next-line lantern-async/no-silent-failure -- openWindow catches internally; it cannot reject
    void this.openWindow();
    this.startJoinTimer();
  }

  private failOrRetryOpenFailure(message: string): void {
    if (this.terminal) return;
    const eligible = !this.everAdmitted && !this.everReachedLobby && !this.preAdmitRetryUsed;
    this.onDiagnostic?.({
      kind: 'open-failed',
      attempt: this.preAdmitRetryUsed ? 2 : 1,
      message,
      willRetry: eligible,
    });
    if (!eligible) {
      this.fail('internal');
      return;
    }
    this.preAdmitRetryUsed = true;
    this.clearJoinTimer();
    this.setStatus({
      phase: 'joining',
      platform: this.config?.platform ?? 'none',
      meetingTitle: this.config?.meetingTitle,
    });
    this.onDiagnostic?.({ kind: 'attempt', attempt: 2, reason: 'pre-admit-retry' });
    void this.openWindow();
    this.startJoinTimer();
  }

  // ── Stop (the hard leave guarantee) ────────────────────────────────────────

  /**
   * Leave the meeting because recording stopped. Always closes the window.
   * Files `left` (+ the full-duration fact when the card covered the whole
   * recording) if the card had joined; otherwise files an honest failure that
   * the card never made it in. Idempotent.
   */
  async stop(stopAnnouncement?: string): Promise<void> {
    if (this.terminal) return Promise.resolve();
    this.terminal = true;
    this.clearJoinTimer();
    const current = this._status;
    // 'present-unknown' counts as present (QA-91d): the card was admitted and never
    // actually left — the DOM was just momentarily unreadable. Filing 'left' (and, if
    // it joined promptly and never truly dropped, full-duration) is the honest record.
    const wasPresent = current.phase === 'present' || current.phase === 'present-unknown';
    const platform =
      current.phase === 'present' || current.phase === 'present-unknown'
        ? current.platform
        : this.config?.platform ?? 'none';

    if (wasPresent) {
      if (stopAnnouncement) {
        await this.announce(stopAnnouncement);
      }
      const meetingDir = this.meetingDir();
      this.record({ kind: 'notice-card-left', meetingDir, at: this.nowIso() });
      // Only claim the card covered the WHOLE recording when: it was admitted
      // promptly after record-start (absolute cap), the missed opening is a
      // small FRACTION of the recording (so a late admit on a SHORT call can't
      // claim full coverage — e.g. joining at 0:25 of a 0:30 call is not
      // "entire"), and it was never dropped mid-meeting. A late/partial presence
      // must NOT overstate the evidence — the honest `left` above still records
      // that the card was present at the end.
      const admitLatency =
        this.admittedAtMs !== null && this.startedAtMs !== null
          ? this.admittedAtMs - this.startedAtMs
          : Infinity;
      const recordingMs = this.startedAtMs !== null ? this.clock.now() - this.startedAtMs : 0;
      const coveredWhole =
        admitLatency <= this.fullPresenceToleranceMs &&
        admitLatency <= recordingMs * 0.1 &&
        !this.rejoinUsed;
      if (coveredWhole) {
        this.record({
          kind: 'notice-card-present-for-entire-recording',
          meetingDir,
          at: this.nowIso(),
          platform,
        });
      }
      this.setStatus({ phase: 'left' });
    } else if (this.everAdmitted) {
      // Joined earlier but dropped / mid-rejoin at stop: honest left, but NOT
      // full-duration presence (there was a gap).
      if (stopAnnouncement) {
        await this.announce(stopAnnouncement);
      }
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

  private async announce(text: string): Promise<void> {
    try {
      await this.driver.announce?.(text);
    } catch (err) {
      this.onDiagnostic?.({
        kind: 'open-failed',
        attempt: this.preAdmitRetryUsed ? 2 : 1,
        message: `announce failed: ${err instanceof Error ? err.message : String(err)}`,
        willRetry: false,
      });
    }
  }

  // ── Internal helpers ───────────────────────────────────────────────────────

  /** Enter a terminal failed state: file the reason and close the window. */
  private fail(reason: NoticeCardFailureReason): void {
    this.terminal = true;
    this.clearJoinTimer();
    this.onDiagnostic?.({ kind: 'terminal', reason });
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
