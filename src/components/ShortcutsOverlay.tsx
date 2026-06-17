/**
 * Keyboard shortcuts overlay modal.
 *
 * Triggered by pressing `?` anywhere in the app (outside of an input). Lists
 * every shortcut from the single source of truth at `src/utils/shortcuts.ts`,
 * grouped by category, with a search box that live-filters the list.
 *
 * A11y:
 *   - Uses Radix Dialog with a VISIBLE DialogTitle ("Keyboard shortcuts").
 *     This overlay has a real header — we do NOT repeat the sr-only pattern
 *     used by the command palette (UX-02) here.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation, Trans } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/ui/dialog';
import { Input } from '@/ui/input';
import { Keyboard, Search } from 'lucide-react';
import {
  SHORTCUTS,
  groupShortcutsByCategory,
  isMac,
  type ShortcutCategory,
  type ShortcutDef,
} from '@/utils/shortcuts';

interface ShortcutsOverlayProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function Keys({ keys }: { keys: string[] }) {
  const mac = isMac();
  return (
    <span className="flex items-center gap-1">
      {keys.map((k, i) => {
        let display = k;
        if (mac) {
          if (k === 'Ctrl') display = '⌘';
          else if (k === 'Shift') display = '⇧';
          else if (k === 'Alt') display = '⌥';
        }
        return (
          <span key={`${k}-${i}`} className="flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 rounded border bg-muted text-xs font-mono text-muted-foreground min-w-[1.5rem] text-center">
              {display}
            </kbd>
            {i < keys.length - 1 && !mac && (
              <span className="text-muted-foreground text-xs">+</span>
            )}
          </span>
        );
      })}
    </span>
  );
}

export function ShortcutsOverlay({ open, onOpenChange }: ShortcutsOverlayProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus the search input and reset query whenever the overlay opens.
  useEffect(() => {
    if (open) {
      setQuery('');
      // Radix animates in; delay focus slightly so screen readers and the
      // autofocus don't race.
      const timer = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return SHORTCUTS;
    return SHORTCUTS.filter((s) => {
      const haystack = [
        s.label,
        s.description ?? '',
        s.category,
        s.keys.join(' '),
        s.keys.join('+'),
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [query]);

  const grouped = useMemo(() => groupShortcutsByCategory(filtered), [filtered]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="shortcuts-overlay"
        className="max-w-xl max-h-[80vh] overflow-hidden p-0"
      >
        <DialogHeader className="px-5 pt-5 pb-3 border-b">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Keyboard className="h-4 w-4" />
            Keyboard shortcuts
          </DialogTitle>
          <DialogDescription className="text-xs">
            <Trans
              i18nKey="shortcuts-overlay.description"
              components={{ k: <kbd className="px-1 py-0.5 rounded bg-muted text-[10px]" /> }}
            />
          </DialogDescription>
        </DialogHeader>

        {/* Search */}
        <div className="px-5 pt-3 pb-2">
          <div className="flex items-center gap-2 border rounded-md px-2 py-1.5">
            <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <Input
              ref={inputRef}
              data-testid="shortcuts-overlay-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search shortcuts..."
              className="border-0 h-6 px-0 focus-visible:ring-0 text-sm"
            />
          </div>
        </div>

        {/* List */}
        <div
          className="flex-1 overflow-y-auto px-5 pb-5"
          style={{ maxHeight: 'calc(80vh - 140px)' }}
        >
          {filtered.length === 0 ? (
            <p
              data-testid="shortcuts-overlay-empty"
              className="text-sm text-muted-foreground py-6 text-center"
            >
              {t('shortcuts-overlay.no-match', { query })}
            </p>
          ) : (
            Array.from(grouped.entries()).map(([category, items]) => (
              <CategoryGroup key={category} category={category} items={items} />
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CategoryGroup({
  category,
  items,
}: {
  category: ShortcutCategory;
  items: ShortcutDef[];
}) {
  return (
    <div className="mb-4 last:mb-0">
      <h3 className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide pt-3 pb-1 sticky top-0 bg-background">
        {category}
      </h3>
      <ul className="divide-y">
        {items.map((s) => (
          <li
            key={s.id}
            data-testid={`shortcut-item-${s.id}`}
            className="flex items-center justify-between gap-3 py-2"
          >
            <div className="min-w-0">
              <div className="text-sm truncate">{s.label}</div>
              {s.description && (
                <div className="text-xs text-muted-foreground truncate">
                  {s.description}
                </div>
              )}
            </div>
            <Keys keys={s.keys} />
          </li>
        ))}
      </ul>
    </div>
  );
}

export default ShortcutsOverlay;
