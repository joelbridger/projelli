/**
 * ProgressRow — a labeled green progress bar for the "Setting up your firm"
 * screen. Drives off the real setup-progress backend:
 *   - `pct` 0..100 renders a determinate fill (with a shimmer while active)
 *   - `pct == null` while `active` renders an indeterminate sweeping bar
 *     (used for counts with no known total, e.g. email/CRM imports)
 *   - `done` forces a solid full green bar
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
  /** Optional sub-detail under the label (e.g. "128 imported"). */
  detail?: string | undefined;
  testId?: string;
}

export function ProgressRow({ label, pct, done, active, status, detail, testId }: ProgressRowProps) {
  const indeterminate = active && pct == null && !done;
  const width = done ? 100 : Math.max(0, Math.min(100, pct ?? 0));

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
            className={`relative h-full rounded-full bg-[#1fa971] transition-[width] duration-500 ${
              active && !done ? 'kp-onbv2-shimmer' : ''
            }`}
            style={{ width: `${String(width)}%` }}
            data-testid="progress-fill"
            data-pct={width}
          />
        )}
      </div>
      <div className="w-20 shrink-0 text-right text-sm font-medium text-[#5b6b80]" data-testid="progress-status">
        {status}
      </div>
    </div>
  );
}
