import {
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
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

export interface RailShellVirtualizationOptions {
  /** Opt-in only: existing consumers render every row unless this is enabled. */
  enabled?: boolean | undefined;
  /** Initial row-height estimate; the virtualizer measures real mounted rows. */
  estimateSize?: number | (() => number) | undefined;
  overscan?: number | undefined;
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
  virtualization?: RailShellVirtualizationOptions | undefined;
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
  virtualization,
}: RailShellProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const pendingFocusIdRef = useRef<string | null>(null);
  const enabledItems = useMemo(() => items.filter((item) => !item.disabled), [items]);
  const activeItemIndex = useMemo(() => items.findIndex((item) => item.id === activeId), [activeId, items]);
  const tabStopItemId = useMemo(() => {
    const activeEnabledItem = enabledItems.find((item) => item.id === activeId);
    return activeEnabledItem?.id ?? enabledItems[0]?.id ?? null;
  }, [activeId, enabledItems]);
  const virtualEstimate = virtualization?.estimateSize;
  const virtualEstimateSize = useMemo(() => {
    if (typeof virtualEstimate === 'function') return virtualEstimate;
    const size = virtualEstimate ?? 56;
    return () => size;
  }, [virtualEstimate]);
  const getScrollElement = useCallback(() => scrollRef.current, []);
  const virtualEnabled = Boolean(virtualization?.enabled && items.length > 0);
  // eslint-disable-next-line react-hooks/incompatible-library -- intentional opt-in virtual list, matching the existing SheetGrid pattern.
  const rowVirtualizer = useVirtualizer({
    count: items.length,
    getScrollElement,
    estimateSize: virtualEstimateSize,
    overscan: virtualization?.overscan ?? 8,
    enabled: virtualEnabled,
  });

  const focusRowById = (id: string) => {
    const row = rowRefs.current.get(id);
    if (!row) return false;
    row.focus({ preventScroll: true });
    return true;
  };

  const selectItem = (id: string, focusRow = false) => {
    onSelect(id);
    if (focusRow) {
      if (virtualEnabled) {
        const index = items.findIndex((item) => item.id === id);
        if (index >= 0) {
          pendingFocusIdRef.current = id;
          rowVirtualizer.scrollToIndex(index, { align: 'auto' });
          if (focusRowById(id)) pendingFocusIdRef.current = null;
          return;
        }
      }
      focusRowById(id);
    }
  };

  useEffect(() => {
    if (!scrollActiveIntoView || !activeId || activeItemIndex < 0) return;
    if (virtualEnabled) {
      rowVirtualizer.scrollToIndex(activeItemIndex, { align: 'auto' });
      return;
    }
    const activeRow = rowRefs.current.get(activeId);
    activeRow?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeId, activeItemIndex, rowVirtualizer, scrollActiveIntoView, virtualEnabled]);

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

  const renderRow = (item: RailShellItem) => {
    const isActive = item.id === activeId;
    const rowAriaLabel = item.ariaLabel ?? (typeof item.label === 'string' ? item.label : undefined);
    return (
      <div
        key={item.id}
        ref={(node) => {
          if (node) {
            rowRefs.current.set(item.id, node);
            if (pendingFocusIdRef.current === item.id) {
              queueMicrotask(() => {
                if (pendingFocusIdRef.current === item.id && rowRefs.current.get(item.id) === node) {
                  node.focus({ preventScroll: true });
                  pendingFocusIdRef.current = null;
                }
              });
            }
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
          ref={scrollRef}
          role="listbox"
          aria-label={listAriaLabel}
          className={cn('flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto overflow-x-hidden p-3 [scrollbar-width:thin]', listClassName)}
        >
          {items.length === 0 && emptyState ? <div className="p-2">{emptyState}</div> : null}
          {virtualEnabled ? (
            <div style={{ flexShrink: 0, height: rowVirtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
              {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                const item = items[virtualRow.index];
                if (!item) return null;
                return (
                  <div
                    key={item.id}
                    data-index={virtualRow.index}
                    ref={rowVirtualizer.measureElement}
                    role="presentation"
                    style={{
                      boxSizing: 'border-box',
                      left: 0,
                      paddingBottom: 4,
                      position: 'absolute',
                      top: 0,
                      transform: `translateY(${String(virtualRow.start)}px)`,
                      width: '100%',
                    }}
                  >
                    {renderRow(item)}
                  </div>
                );
              })}
            </div>
          ) : (
            items.map((item) => renderRow(item))
          )}
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
