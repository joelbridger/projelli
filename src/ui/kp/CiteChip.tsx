import type { ReactNode } from 'react';

export interface CiteChipProps {
  /** Small numbered badge shown before the phrase, e.g. citation order. */
  index?: number;
  /** The phrase/label the chip wraps (rendered inside the pill itself). */
  children: ReactNode;
  /** Name of the document/source this citation is grounded in. */
  docLabel: string;
  /** The exact quoted excerpt shown in the hover popover. */
  quote: string;
  /** Optional section/heading within the source, appended after docLabel. */
  sourceLabel?: string | undefined;
  icon?: ReactNode;
}

/**
 * Universal "this came from somewhere" chip (UI-INTEGRATION-SPEC §2): a
 * pill that, on hover or keyboard focus, reveals a popover with the exact
 * quoted line it is grounded in. Pure-CSS hover (no JS state) so it never
 * needs a portal or z-index dance beyond --kp-z-popover.
 */
export function CiteChip({ index, children, docLabel, quote, sourceLabel, icon }: CiteChipProps) {
  return (
    <span className="group relative inline-flex align-baseline" data-testid="cite-chip">
      <span
        tabIndex={0}
        className="inline-flex cursor-default items-baseline gap-1 rounded-full border border-slate-300 bg-[var(--kp-bg-soft)] px-2 py-px text-[0.92em] leading-normal text-[var(--kp-navy)] outline-none transition-colors group-hover:border-[rgba(239,35,60,0.55)] group-hover:bg-[rgba(239,35,60,0.06)] group-focus-within:border-[rgba(239,35,60,0.55)] group-focus-within:bg-[rgba(239,35,60,0.06)]"
      >
        {index != null && (
          <span className="inline-flex h-[14px] min-w-[14px] items-center justify-center self-center rounded-full bg-[rgba(43,45,66,0.12)] px-[3px] text-[10px] font-bold text-[var(--kp-navy)] group-hover:bg-[rgba(239,35,60,0.16)] group-hover:text-[var(--kp-accent)] group-focus-within:bg-[rgba(239,35,60,0.16)] group-focus-within:text-[var(--kp-accent)]">
            {index}
          </span>
        )}
        {children}
      </span>
      <span
        role="tooltip"
        data-testid="cite-chip-popover"
        className="invisible absolute left-0 top-[calc(100%+7px)] z-[1200] w-[280px] rounded-lg border border-slate-200 bg-white p-3 text-left opacity-0 shadow-lg transition-opacity duration-100 group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100"
      >
        <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-400">
          {icon}
          {docLabel}
        </span>
        <span className="mt-1.5 block border-l-2 border-[var(--kp-accent)] pl-2 text-[12.5px] leading-snug text-[var(--kp-navy)]">
          &ldquo;{quote}&rdquo;
        </span>
        {sourceLabel != null && sourceLabel !== '' && (
          <span className="mt-1.5 block text-[11.5px] text-slate-400">{sourceLabel}</span>
        )}
      </span>
    </span>
  );
}
