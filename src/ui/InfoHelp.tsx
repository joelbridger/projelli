// InfoHelp — a small "i" icon that reveals explanatory text on hover/focus.
// Used to move passive gray helper paragraphs out of the default view (the
// UI Simplification Pass): the title stays, the explanation moves into this
// tooltip so nothing shows until the user asks for it.
import * as React from 'react';
import { Info } from 'lucide-react';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/ui/tooltip';
import { cn } from '@/lib/utils';

interface InfoHelpProps {
  /** The explanatory text shown in the tooltip on hover/focus. */
  content: React.ReactNode;
  /** Accessible name for the trigger; defaults to a generic "More info". */
  label?: string;
  className?: string;
  /**
   * Render the trigger as a <span role="button"> instead of a <button>.
   * Use this when InfoHelp is nested inside another interactive element
   * (e.g. a selectable card that is itself a <button>) — a real <button>
   * cannot be nested inside another <button> without breaking the DOM.
   */
  as?: 'button' | 'span';
  side?: React.ComponentProps<typeof TooltipContent>['side'];
}

/** Stops the click/keypress from reaching a parent interactive element (e.g. a selectable card). */
function stopEventPropagation(e: React.SyntheticEvent) {
  e.stopPropagation();
}

export function InfoHelp({ content, label = 'More info', className, as = 'button', side }: InfoHelpProps) {
  const triggerClassName = cn(
    'inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-muted-foreground/70',
    'hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
    className,
  );

  const trigger =
    as === 'span' ? (
      <span
        role="button"
        tabIndex={0}
        aria-label={label}
        className={triggerClassName}
        onClick={stopEventPropagation}
        onPointerDown={stopEventPropagation}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') e.stopPropagation();
        }}
      >
        <Info className="h-3.5 w-3.5" aria-hidden />
      </span>
    ) : (
      <button
        type="button"
        aria-label={label}
        className={triggerClassName}
        onClick={stopEventPropagation}
      >
        <Info className="h-3.5 w-3.5" aria-hidden />
      </button>
    );

  return (
    <Tooltip>
      <TooltipTrigger asChild>{trigger}</TooltipTrigger>
      <TooltipContent {...(side ? { side } : {})} className="max-w-xs text-left font-normal">
        {content}
      </TooltipContent>
    </Tooltip>
  );
}

export default InfoHelp;
