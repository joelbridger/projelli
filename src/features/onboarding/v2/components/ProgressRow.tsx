/**
 * ProgressRow — a labeled green progress bar for the "Setting up your firm"
 * screen. Drives off the real setup-progress backend:
 *   - `pct` 0..100 renders a determinate fill (with a shimmer while active)
 *   - `pct == null` while `active` renders an indeterminate sweeping bar
 *     (used for counts with no known total, e.g. email/CRM imports)
 *   - `done` forces a solid full green bar
 *   - `failed` renders a red failed state with an optional retry action
 */

import type { ReactNode } from 'react';

export interface ProgressRowProps {
  /** Text label, or a logo node. */
  label: ReactNode;
  /** 0..100, or null for indeterminate. */
  pct: number | null;
  done: boolean;
  active: boolean;
  /** Right-aligned status text (e.g. "64%", "Working...", "Done"). */
  status: string;
  failed?: boolean | undefined;
  retryLabel?: string | undefined;
  onRetry?: (() => void) | undefined;
  /** Optional sub-detail under the label (e.g. "128 imported"). */
  detail?: string | undefined;
  testId?: string;
}

export function ProgressRow({
  label,
  pct,
  done,
  active,
  status,
  failed = false,
  retryLabel,
  onRetry,
  detail,
  testId,
}: ProgressRowProps) {
  const indeterminate = active && pct == null && !done;
  const width = failed || done ? 100 : Math.max(0, Math.min(100, pct ?? 0));
  const fillClass = failed ? 'bg-[#d64545]' : 'bg-[#1fa971]';

  return (
    <div className="flex items-center gap-4" data-testid={testId}>
      <div className="flex w-44 shrink-0 flex-col">
        <div className="text-sm font-semibold text-[var(--kp-navy)]">{label}</div>
        {detail ? <div className="text-xs text-[#5b6b80]">{detail}</div> : null}
      </div>
      <div className="relative h-2.5 flex-1 overflow-hidden rounded-full bg-[rgba(var(--kp-navy-rgb),0.10)]">
        {indeterminate ? (
          <div className="kp-onbv2-indet" data-testid="progress-indeterminate" />
        ) : (
          <div
            className={`relative h-full rounded-full ${fillClass} transition-[width] duration-500 ${
              active && !done && !failed ? 'kp-onbv2-shimmer' : ''
            }`}
            style={{ width: `${String(width)}%` }}
            data-testid="progress-fill"
            data-pct={width}
          />
        )}
      </div>
      <div className="flex w-24 shrink-0 items-center justify-end gap-2 text-right text-sm font-medium text-[#5b6b80]">
        <span className={failed ? 'text-[#b83232]' : ''} data-testid="progress-status">
          {status}
        </span>
        {failed && onRetry && retryLabel ? (
          <button
            type="button"
            onClick={onRetry}
            className="rounded border border-[#d64545]/30 px-2 py-1 text-xs font-bold text-[#b83232] hover:bg-[#d64545]/10"
          >
            {retryLabel}
          </button>
        ) : null}
      </div>
    </div>
  );
}
