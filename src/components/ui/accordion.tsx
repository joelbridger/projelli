/**
 * Minimal accessible Accordion primitive.
 *
 * Built without @radix-ui/react-accordion (that dep is not in package.json).
 * Follows the same pattern as the other shadcn/ui components in this directory:
 * forwardRef, cn(), data-state attributes that match what Radix would emit so
 * existing tests can assert on them.
 *
 * Exports:
 *   Accordion          — root; manages which item is open (single-open mode)
 *   AccordionItem      — one collapsible section; needs a unique `value` prop
 *   AccordionTrigger   — clickable header row; toggles the item
 *   AccordionContent   — the body that appears when the item is open
 */

import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

/* ─── Context ─────────────────────────────────────────────────────────────── */

interface AccordionContextValue {
  openValue: string | null;
  toggle: (value: string) => void;
}

const AccordionContext = React.createContext<AccordionContextValue>({
  openValue: null,
  toggle: () => undefined,
});

/* ─── Accordion root ──────────────────────────────────────────────────────── */

export interface AccordionProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Initially open item value. If omitted all items start closed. */
  defaultValue?: string;
}

export const Accordion = React.forwardRef<HTMLDivElement, AccordionProps>(
  ({ defaultValue, className, children, ...props }, ref) => {
    const [openValue, setOpenValue] = React.useState<string | null>(defaultValue ?? null);

    const toggle = React.useCallback((value: string) => {
      setOpenValue((prev) => (prev === value ? null : value));
    }, []);

    return (
      <AccordionContext.Provider value={{ openValue, toggle }}>
        <div ref={ref} className={cn('w-full', className)} {...props}>
          {children}
        </div>
      </AccordionContext.Provider>
    );
  },
);
Accordion.displayName = 'Accordion';

/* ─── Item context ────────────────────────────────────────────────────────── */

interface ItemContextValue {
  value: string;
  isOpen: boolean;
  toggle: () => void;
}

const ItemContext = React.createContext<ItemContextValue>({
  value: '',
  isOpen: false,
  toggle: () => undefined,
});

/* ─── AccordionItem ───────────────────────────────────────────────────────── */

export interface AccordionItemProps extends React.HTMLAttributes<HTMLDivElement> {
  value: string;
}

export const AccordionItem = React.forwardRef<HTMLDivElement, AccordionItemProps>(
  ({ value, className, children, ...props }, ref) => {
    const { openValue, toggle } = React.useContext(AccordionContext);
    const isOpen = openValue === value;

    const handleToggle = React.useCallback(() => {
      toggle(value);
    }, [toggle, value]);

    return (
      <ItemContext.Provider value={{ value, isOpen, toggle: handleToggle }}>
        <div
          ref={ref}
          data-state={isOpen ? 'open' : 'closed'}
          className={cn('border-b border-border/60 last:border-b-0', className)}
          {...props}
        >
          {children}
        </div>
      </ItemContext.Provider>
    );
  },
);
AccordionItem.displayName = 'AccordionItem';

/* ─── AccordionTrigger ────────────────────────────────────────────────────── */

export const AccordionTrigger = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement>
>(({ className, children, ...props }, ref) => {
  const { isOpen, toggle } = React.useContext(ItemContext);

  return (
    <button
      ref={ref}
      type="button"
      aria-expanded={isOpen}
      onClick={toggle}
      className={cn(
        'flex w-full items-center justify-between py-3 text-sm font-semibold text-foreground transition-colors hover:text-foreground/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        className,
      )}
      {...props}
    >
      {children}
      <ChevronDown
        className={cn(
          'h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200',
          isOpen && 'rotate-180',
        )}
      />
    </button>
  );
});
AccordionTrigger.displayName = 'AccordionTrigger';

/* ─── AccordionContent ────────────────────────────────────────────────────── */

export const AccordionContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, children, ...props }, ref) => {
  const { isOpen } = React.useContext(ItemContext);

  if (!isOpen) return null;

  return (
    <div
      ref={ref}
      className={cn('pb-3 text-sm text-muted-foreground', className)}
      {...props}
    >
      {children}
    </div>
  );
});
AccordionContent.displayName = 'AccordionContent';
