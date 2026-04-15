/**
 * Auto-save indicator (UX-17)
 *
 * Reactive replacement for the old static "Auto-save" badge. The indicator
 * observes the active tab's dirty / lastSaved state and cycles through
 * these visual states:
 *
 *   idle         — no file open → "Saved" in muted foreground
 *   dirty        — content modified, pending save → "Unsaved changes"
 *   saving       — save in progress → spinner + "Saving..."
 *   saved-recent — clean and saved recently → "Saved · Ns ago" (updating)
 *   error        — save failed → destructive "Save failed" + Retry button
 *
 * The `saving` and `error` states are controlled by the parent (MainPanel)
 * because only the save handler knows when a save is in flight or failed.
 * Dirty / clean is derived from the editor store. "Seconds ago" uses a
 * self-updating timer driven by a 1s setInterval when the indicator is
 * mounted and the tab is clean with a recent save.
 */

import { useEffect, useState } from 'react';
import { Loader2, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type AutoSaveState = 'idle' | 'dirty' | 'saving' | 'saved-recent' | 'error';

interface AutoSaveIndicatorProps {
  /**
   * True if any tab in the workspace has unsaved changes OR the specific
   * active tab is dirty — the parent decides which scope matters.
   */
  isDirty: boolean;
  /**
   * Timestamp (ms) of the most recent successful save for the active
   * tab. Undefined when no tab is open or the tab has never been saved.
   */
  lastSavedAt?: number | undefined;
  /** True while a save is in flight. */
  isSaving?: boolean;
  /** Latest error from a failed save (string message), if any. */
  error?: string | null;
  /** Fired when the user clicks "Retry" while in the error state. */
  onRetry?: () => void;
  className?: string;
}

/**
 * Human-readable "3s ago" / "1m ago" formatter. Resolution is capped at
 * seconds so the rendered string updates at most once per second.
 */
function formatRelative(ms: number, now: number): string {
  const delta = Math.max(0, now - ms);
  const secs = Math.floor(delta / 1000);
  if (secs < 1) return 'just now';
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ago`;
}

export function AutoSaveIndicator({
  isDirty,
  lastSavedAt,
  isSaving = false,
  error = null,
  onRetry,
  className,
}: AutoSaveIndicatorProps) {
  // Self-updating "now" so the "Ns ago" label refreshes each second.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (isDirty || isSaving || error) return;
    if (!lastSavedAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isDirty, isSaving, error, lastSavedAt]);

  // State machine. Order matters: error > saving > dirty > saved-recent > idle.
  let state: AutoSaveState = 'idle';
  if (error) state = 'error';
  else if (isSaving) state = 'saving';
  else if (isDirty) state = 'dirty';
  else if (lastSavedAt) state = 'saved-recent';

  return (
    <span
      data-testid="auto-save-indicator"
      data-state={state}
      className={cn(
        'text-xs flex items-center gap-1 mr-2',
        state === 'error' ? 'text-destructive' : 'text-muted-foreground',
        className
      )}
      title={
        state === 'saved-recent' && lastSavedAt
          ? `Last saved ${formatRelative(lastSavedAt, now)}`
          : state === 'saving'
            ? 'Saving…'
            : state === 'dirty'
              ? 'Unsaved changes — auto-save will run shortly'
              : state === 'error'
                ? `Save failed: ${error ?? 'unknown error'}`
                : 'No file open'
      }
    >
      {state === 'saving' ? (
        <Loader2
          data-testid="auto-save-indicator-icon"
          className="h-3 w-3 animate-spin"
        />
      ) : (
        <Save data-testid="auto-save-indicator-icon" className="h-3 w-3" />
      )}
      <span data-testid="auto-save-indicator-label">
        {state === 'idle' && 'Saved'}
        {state === 'dirty' && 'Unsaved changes'}
        {state === 'saving' && 'Saving…'}
        {state === 'saved-recent' && lastSavedAt && `Saved · ${formatRelative(lastSavedAt, now)}`}
        {state === 'error' && 'Save failed'}
      </span>
      {state === 'error' && onRetry && (
        <Button
          data-testid="auto-save-indicator-retry"
          variant="ghost"
          size="sm"
          className="h-5 px-1.5 text-[11px] text-destructive hover:text-destructive"
          onClick={onRetry}
        >
          Retry
        </Button>
      )}
    </span>
  );
}
