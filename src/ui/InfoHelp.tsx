// InfoHelp — a small "i" icon that reveals explanatory text on hover/focus.
// Used to move passive gray helper paragraphs out of the default view (the
// UI Simplification Pass): the title stays, the explanation moves into this
// tooltip so nothing shows until the user asks for it.
import * as React from 'react';
import { Info } from 'lucide-react';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/ui/tooltip';
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
  const contentId = React.useId();
  const [open, setOpen] = React.useState(false);
  const [pinned, setPinned] = React.useState(false);

  const triggerClassName = cn(
    'inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-muted-foreground/70',
    'hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
    className,
  );

  const show = () => {
    setOpen(true);
  };

  const hideIfUnpinned = () => {
    if (!pinned) setOpen(false);
  };

  const close = () => {
    setPinned(false);
    setOpen(false);
  };

  const togglePinned = (e: React.SyntheticEvent) => {
    stopEventPropagation(e);
    setPinned((wasPinned) => {
      const nextPinned = !wasPinned;
      setOpen(nextPinned);
      return nextPinned;
    });
  };

  const sharedTriggerProps = {
    'aria-label': label,
    'aria-describedby': open ? contentId : undefined,
    className: triggerClassName,
    onMouseEnter: show,
    onMouseLeave: hideIfUnpinned,
    onFocus: show,
    onBlur: hideIfUnpinned,
    onClick: togglePinned,
    onPointerDown: stopEventPropagation,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        stopEventPropagation(e);
        close();
        return;
      }
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        togglePinned(e);
      }
    },
  };

  const trigger =
    as === 'span' ? (
      <span
        role="button"
        tabIndex={0}
        {...sharedTriggerProps}
      >
        <Info className="h-3.5 w-3.5" aria-hidden />
      </span>
    ) : (
      <button
        type="button"
        {...sharedTriggerProps}
      >
        <Info className="h-3.5 w-3.5" aria-hidden />
      </button>
    );

  return (
    // Self-contained provider: InfoHelp is dropped into dozens of call sites
    // (and their tests) that shouldn't each need to know Radix's Tooltip.Root
    // requires a TooltipProvider ancestor. The app root (main.tsx) also mounts
    // one with these same values, so this nested provider is a no-op there.
    <TooltipProvider delayDuration={0} skipDelayDuration={0}>
      <Tooltip
        open={open}
        onOpenChange={(nextOpen) => {
          if (nextOpen) {
            setOpen(true);
          } else if (!pinned) {
            setOpen(false);
          }
        }}
      >
        <TooltipTrigger asChild>{trigger}</TooltipTrigger>
        <TooltipContent
          id={contentId}
          {...(side ? { side } : {})}
          className="max-w-xs text-left font-normal"
          onEscapeKeyDown={(e) => {
            e.preventDefault();
            close();
          }}
          onPointerDownOutside={close}
        >
          {content}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export default InfoHelp;
