/**
 * Notice Card — store lifecycle glue.
 *
 * Ties the supervisor + Tauri driver + status poller + camera script into a
 * single start/stop pair the meeting store calls on record-start / record-stop.
 * Holds the one active card as a module singleton (mirrors the store's
 * `activeWorkspaceService` pattern) so the store body stays thin.
 *
 * The join automation itself is only truly verifiable on the desktop bench;
 * this glue is intentionally small and defensive.
 */
import { makeTauriDriver, startStatusPoller } from './tauriDriver';
import { NoticeCardSupervisor } from './supervisor';
import type { NoticeCardStatus, NoticeCardLedgerEvent } from './supervisor';
import { buildCameraScript, type NoticeCardVisual } from './canvasCard';
import type { NoticeCardConfig } from './noticeCardTypes';

export interface StartNoticeCardParams {
  config: NoticeCardConfig;
  /** v2 visual card copy; when present the canvas camera is installed. */
  cameraVisual?: NoticeCardVisual;
  /** Wall-clock start (ms) for the live "Recording · M:SS" timer. */
  startEpochMs: number;
  /** Append a card event to the consent ledger (fire-and-forget upstream). */
  record: (event: NoticeCardLedgerEvent) => void;
  /** Status updates for the record pill. */
  onStatus: (status: NoticeCardStatus) => void;
}

let counter = 0;
let active: { supervisor: NoticeCardSupervisor; stopPoller: () => void } | null = null;

/** Begin one card for the current recording. Tears down any prior card first. */
export function startNoticeCard(params: StartNoticeCardParams): void {
  void stopNoticeCard();
  counter += 1;
  const label = `notice-card-${String(counter)}`;
  const cameraScript = params.cameraVisual
    ? buildCameraScript(params.cameraVisual, { startEpochMs: params.startEpochMs })
    : undefined;
  const driver = makeTauriDriver(label, cameraScript ? { cameraScript } : undefined);
  const supervisor = new NoticeCardSupervisor({
    driver,
    record: params.record,
    onStatus: params.onStatus,
  });
  const stopPoller = startStatusPoller(label, supervisor);
  active = { supervisor, stopPoller };
  supervisor.start(params.config);
}

/**
 * Leave + tear down the active card. The hard guarantee: this always closes the
 * window (the supervisor's stop() closes even from a failed state, with a
 * watchdog). Safe to call when no card is active.
 */
export async function stopNoticeCard(): Promise<void> {
  if (!active) return;
  const { supervisor, stopPoller } = active;
  active = null;
  try {
    stopPoller();
  } catch {
    /* ignore */
  }
  await supervisor.stop();
}

/** Test-only: is a card currently active? */
export function isNoticeCardActive(): boolean {
  return active !== null;
}
