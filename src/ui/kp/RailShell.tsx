import {
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
} from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { IconButton } from './IconButton';
import type { IconType } from './types';

/**
 * Shared master-detail rail for surfaces that should read like Documents:
 *
 * <RailShell
 *   header={<RailShellHeader title={t('email.rail-title')} actions={...} />}
 *   listAriaLabel={t('email.rail-list-label')}
 *   items={emails.map((email) => ({ id: email.id, label: email.subject }))}
 *   activeId={selectedEmailId}
 *   onSelect={setSelectedEmailId}
 * >
 *   <EmailViewer emailId={selectedEmailId} />
 * </RailShell>
 *
 * Keep screen-specific logic outside this primitive. This component owns only
 * the fixed left rail, active-row state, keyboard selection, and scroll-to-active behavior.
 */

export interface RailShellItem {
  id: string;
  label: ReactNode;
  supportingText?: ReactNode;
  /** Rich row body for dense lists. Keep nested controls deliberate. */
  content?: ReactNode;
  leading?: ReactNode;
  trailing?: ReactNode;
  disabled?: boolean | undefined;
  testId?: string | undefined;
  ariaLabel?: string | undefined;
}

export interface RailShellProps {
  header: ReactNode;
  listAriaLabel: string;
  items: RailShellItem[];
  activeId: string | null | undefined;
  onSelect: (id: string) => void;
  children: ReactNode;
  emptyState?: ReactNode;
  className?: string | undefined;
  railClassName?: string | undefined;
  listClassName?: string | undefined;
  contentClassName?: string | undefined;
  railWidth?: number | string | undefined;
  scrollActiveIntoView?: boolean | undefined;
}

export interface RailShellHeaderProps {
  title: ReactNode;
  actions?: ReactNode;
  className?: string | undefined;
}

export interface RailShellActionMenuProps {
  icon: IconType;
  label: string;
  children: ReactNode;
  align?: 'start' | 'center' | 'end';
  className?: string | undefined;
  contentClassName?: string | undefined;
}

function getRailWidthStyle(railWidth: number | string | undefined): CSSProperties {
  const width = railWidth ?? 252;
  return { width, minWidth: width, maxWidth: width };
}

function eventStartedInNestedControl(currentTarget: HTMLElement, target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  const interactive = target.closest(
    'a,button,input,textarea,select,[tabindex]:not([tabindex="-1"]),[role="button"],[role="checkbox"],[role="link"],[role="menuitem"],[role="option"],[role="radio"],[role="switch"],[role="tab"],[role="textbox"]',
  );
  return Boolean(interactive && interactive !== currentTarget);
}

export function RailShell({
  header,
  listAriaLabel,
  items,
  activeId,
  onSelect,
  children,
  emptyState,
  className,
  railClassName,
  listClassName,
  contentClassName,
  railWidth,
  scrollActiveIntoView = true,
}: RailShellProps) {
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const enabledItems = useMemo(() => items.filter((item) => !item.disabled), [items]);
  const activeItemIndex = useMemo(() => items.findIndex((item) => item.id === activeId), [activeId, items]);
  const tabStopItemId = useMemo(() => {
    const activeEnabledItem = enabledItems.find((item) => item.id === activeId);
    return activeEnabledItem?.id ?? enabledItems[0]?.id ?? null;
  }, [activeId, enabledItems]);

  const selectItem = (id: string, focusRow = false) => {
    onSelect(id);
    if (focusRow) {
      rowRefs.current.get(id)?.focus({ preventScroll: true });
    }
  };

  useEffect(() => {
    if (!scrollActiveIntoView || !activeId || activeItemIndex < 0) return;
    const activeRow = rowRefs.current.get(activeId);
    activeRow?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeId, activeItemIndex, scrollActiveIntoView]);

  const selectByOffset = (currentId: string, offset: number) => {
    if (enabledItems.length === 0) return;
    const currentIndex = enabledItems.findIndex((item) => item.id === currentId);
    const safeCurrentIndex = currentIndex >= 0 ? currentIndex : 0;
    const nextIndex = Math.min(Math.max(safeCurrentIndex + offset, 0), enabledItems.length - 1);
    selectItem(enabledItems[nextIndex]?.id ?? currentId, true);
  };

  const handleRowClick = (event: MouseEvent<HTMLDivElement>, itemId: string, disabled: boolean | undefined) => {
    if (disabled || eventStartedInNestedControl(event.currentTarget, event.target)) return;
    selectItem(itemId);
  };

  const handleRowKeyDown = (event: KeyboardEvent<HTMLDivElement>, itemId: string) => {
    if (eventStartedInNestedControl(event.currentTarget, event.target)) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      selectByOffset(itemId, 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      selectByOffset(itemId, -1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      const first = enabledItems[0];
      if (first) selectItem(first.id, true);
    } else if (event.key === 'End') {
      event.preventDefault();
      const last = enabledItems[enabledItems.length - 1];
      if (last) selectItem(last.id, true);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      selectItem(itemId);
    }
  };

  return (
    <section className={cn('flex h-full min-h-0 min-w-0 overflow-hidden bg-[var(--color-background)]', className)}>
      <aside
        className={cn(
          'flex h-full min-h-0 flex-col border-r border-[var(--kp-divider)] bg-[var(--kp-side-bg)] text-[var(--kp-side-fg)]',
          railClassName,
        )}
        style={getRailWidthStyle(railWidth)}
      >
        {header}
        <div
          role="listbox"
          aria-label={listAriaLabel}
          className={cn('flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto overflow-x-hidden p-3 [scrollbar-width:thin]', listClassName)}
        >
          {items.length === 0 && emptyState ? <div className="p-2">{emptyState}</div> : null}
          {items.map((item) => {
            const isActive = item.id === activeId;
            const rowAriaLabel = item.ariaLabel ?? (typeof item.label === 'string' ? item.label : undefined);
            return (
              <div
                key={item.id}
                ref={(node) => {
                  if (node) {
                    rowRefs.current.set(item.id, node);
                  } else {
                    rowRefs.current.delete(item.id);
                  }
                }}
                role="option"
                tabIndex={item.disabled || item.id !== tabStopItemId ? -1 : 0}
                aria-selected={isActive}
                aria-disabled={item.disabled || undefined}
                aria-label={rowAriaLabel}
                data-testid={item.testId}
                className={cn(
                  'group flex min-h-10 w-full items-center gap-2 rounded-md border border-transparent px-2.5 py-2 text-left text-sm transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--kp-navy)] focus-visible:ring-offset-2',
                  item.disabled && 'cursor-not-allowed opacity-[var(--kp-opacity-disabled)]',
                  isActive
                    ? 'border-[var(--kp-divider-strong)] bg-[var(--kp-side-active-bg)] text-[var(--kp-navy)]'
                    : 'text-[var(--kp-side-fg)] hover:bg-[var(--kp-accent-softer)] hover:text-[var(--kp-navy)]',
                )}
                onClick={(event) => {
                  handleRowClick(event, item.id, item.disabled);
                }}
                onKeyDown={(event) => {
                  if (item.disabled) return;
                  handleRowKeyDown(event, item.id);
                }}
              >
                {item.content ? (
                  <div className="min-w-0 flex-1">{item.content}</div>
                ) : (
                  <>
                    {item.leading ? (
                      <span className="flex shrink-0 items-center text-[var(--kp-side-fg-dim)]">{item.leading}</span>
                    ) : null}
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate font-medium leading-tight">{item.label}</span>
                      {item.supportingText ? (
                        <span className="truncate text-xs leading-snug text-[var(--kp-side-fg-dim)]">{item.supportingText}</span>
                      ) : null}
                    </span>
                    {item.trailing ? <span className="ml-auto flex shrink-0 items-center">{item.trailing}</span> : null}
                  </>
                )}
              </div>
            );
          })}
        </div>
      </aside>
      <main className={cn('flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden', contentClassName)}>
        {children}
      </main>
    </section>
  );
}

export function RailShellHeader({ title, actions, className }: RailShellHeaderProps) {
  return (
    <div
      className={cn(
        'flex min-h-[52px] shrink-0 items-center justify-between gap-2 border-b border-[var(--kp-divider)] px-3 py-2',
        className,
      )}
    >
      <div className="min-w-0 truncate text-sm font-semibold leading-tight text-[var(--kp-navy)]">{title}</div>
      {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
    </div>
  );
}

export function RailShellActionMenu({
  icon,
  label,
  children,
  align = 'end',
  className,
  contentClassName,
}: RailShellActionMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton icon={icon} label={label} size="sm" variant="ghost" {...(className ? { className } : {})} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className={cn('w-48', contentClassName)}>
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
