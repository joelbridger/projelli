/**
 * Minimal accessible Accordion primitive.
 *
 * Built without @radix-ui/react-accordion (that dep is not in package.json).
 * Follows the same pattern as the other shadcn/ui components in this directory:
 * forwardRef, cn(), data-state attributes that match what Radix would emit so
 * existing tests can assert on them.
 *
 * ARIA wiring (WAI-ARIA Accordion pattern):
 *   - Each trigger has aria-expanded and aria-controls pointing to its panel id.
 *   - Each panel has role="region" and aria-labelledby the trigger id.
 *   - Arrow Up/Down move keyboard focus between triggers; Home/End jump to
 *     first/last trigger in the accordion.
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
  /** Registry of trigger elements for arrow-key navigation. */
  registerTrigger: (value: string, el: HTMLButtonElement | null) => void;
  /** Move keyboard focus to the next/previous trigger, wrapping at ends. */
  focusAdjacentTrigger: (currentValue: string, direction: 'up' | 'down' | 'home' | 'end') => void;
}

const AccordionContext = React.createContext<AccordionContextValue>({
  openValue: null,
  toggle: () => undefined,
  registerTrigger: () => undefined,
  focusAdjacentTrigger: () => undefined,
});

/* ─── Accordion root ──────────────────────────────────────────────────────── */

export interface AccordionProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Initially open item value. If omitted all items start closed. */
  defaultValue?: string;
}

export const Accordion = React.forwardRef<HTMLDivElement, AccordionProps>(
  ({ defaultValue, className, children, ...props }, ref) => {
    const [openValue, setOpenValue] = React.useState<string | null>(defaultValue ?? null);

    // Ordered registry: maps item value → trigger button element.
    // We use a Map to preserve insertion order so arrow keys navigate in DOM order.
    const triggerMapRef = React.useRef<Map<string, HTMLButtonElement | null>>(new Map());

    const toggle = React.useCallback((value: string) => {
      setOpenValue((prev) => (prev === value ? null : value));
    }, []);

    const registerTrigger = React.useCallback(
      (value: string, el: HTMLButtonElement | null) => {
        triggerMapRef.current.set(value, el);
      },
      [],
    );

    const focusAdjacentTrigger = React.useCallback(
      (currentValue: string, direction: 'up' | 'down' | 'home' | 'end') => {
        // Collect only entries whose element reference is still mounted.
        const buttons: HTMLButtonElement[] = [];
        for (const [, el] of triggerMapRef.current.entries()) {
          if (el != null) buttons.push(el);
        }
        if (buttons.length === 0) return;

        if (direction === 'home') {
          buttons.at(0)?.focus();
          return;
        }
        if (direction === 'end') {
          buttons.at(-1)?.focus();
          return;
        }

        // Find the index of the current trigger in the buttons array.
        // We locate by identity (the element registered for currentValue).
        const currentEl = triggerMapRef.current.get(currentValue);
        const currentIdx = currentEl != null ? buttons.indexOf(currentEl) : -1;
        if (currentIdx === -1) return;

        const nextIdx =
          direction === 'down'
            ? (currentIdx + 1) % buttons.length
            : (currentIdx - 1 + buttons.length) % buttons.length;
        buttons.at(nextIdx)?.focus();
      },
      [],
    );

    return (
      <AccordionContext.Provider value={{ openValue, toggle, registerTrigger, focusAdjacentTrigger }}>
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
  triggerId: string;
  panelId: string;
}

const ItemContext = React.createContext<ItemContextValue>({
  value: '',
  isOpen: false,
  toggle: () => undefined,
  triggerId: '',
  panelId: '',
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

    // Stable, collision-free ids derived from the item value.
    // The value prop is caller-supplied and is the natural key already used
    // for state tracking; using it here keeps ids deterministic across renders.
    const safeId = value.replace(/[^a-zA-Z0-9-_]/g, '-');
    const triggerId = `accordion-trigger-${safeId}`;
    const panelId = `accordion-panel-${safeId}`;

    return (
      <ItemContext.Provider value={{ value, isOpen, toggle: handleToggle, triggerId, panelId }}>
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
  const { isOpen, toggle, value, triggerId, panelId } = React.useContext(ItemContext);
  const { registerTrigger, focusAdjacentTrigger } = React.useContext(AccordionContext);

  // Merge the forwarded ref with our local registration callback.
  const innerRef = React.useCallback(
    (el: HTMLButtonElement | null) => {
      registerTrigger(value, el);
      if (typeof ref === 'function') {
        ref(el);
      } else if (ref) {
        (ref as React.MutableRefObject<HTMLButtonElement | null>).current = el;
      }
    },
    [ref, registerTrigger, value],
  );

  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        focusAdjacentTrigger(value, 'down');
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        focusAdjacentTrigger(value, 'up');
      } else if (e.key === 'Home') {
        e.preventDefault();
        focusAdjacentTrigger(value, 'home');
      } else if (e.key === 'End') {
        e.preventDefault();
        focusAdjacentTrigger(value, 'end');
      }
    },
    [focusAdjacentTrigger, value],
  );

  return (
    <button
      ref={innerRef}
      type="button"
      id={triggerId}
      aria-expanded={isOpen}
      aria-controls={panelId}
      onClick={toggle}
      onKeyDown={handleKeyDown}
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
  const { isOpen, panelId, triggerId } = React.useContext(ItemContext);

  if (!isOpen) return null;

  return (
    <div
      ref={ref}
      id={panelId}
      role="region"
      aria-labelledby={triggerId}
      className={cn('pb-3 text-sm text-muted-foreground', className)}
      {...props}
    >
      {children}
    </div>
  );
});
AccordionContent.displayName = 'AccordionContent';
