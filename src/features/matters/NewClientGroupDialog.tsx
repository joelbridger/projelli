/**
 * NewClientGroupDialog (feedback line 13) — name a group of clients, then add
 * clients to it with a searchable multi-select.
 *
 * Groups are a local-first rail convenience (see clientGroupStore): they hold
 * matter ids only, never content, so nothing new leaves the machine. A client
 * can be in many groups; a group can be created empty and filled later.
 *
 * Light theme, lean — one name field and a compact, searchable client list with
 * checkboxes. Create is enabled as soon as the group has a name.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Search, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/dialog';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { cn } from '@/lib/utils';
import { useActiveMatters } from '@/platform/matter/matterStore';
import { useClientGroupStore } from '@/platform/matter/clientGroupStore';
import { matterLabel } from '@/platform/rag/matterResolver';

export interface NewClientGroupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function NewClientGroupDialog({ open, onOpenChange }: NewClientGroupDialogProps) {
  const { t } = useTranslation();
  const matters = useActiveMatters();
  const createGroup = useClientGroupStore((s) => s.createGroup);
  const setGroupMembers = useClientGroupStore((s) => s.setGroupMembers);

  const [name, setName] = useState('');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const submittingRef = useRef(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset the form when the dialog opens so a reopen starts blank.
      setName('');
      setQuery('');
      setSelected(new Set());
      submittingRef.current = false;
      const id = window.setTimeout(() => nameRef.current?.focus(), 0);
      return () => {
        window.clearTimeout(id);
      };
    }
    return undefined;
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return matters;
    return matters.filter((m) => matterLabel(m).toLowerCase().includes(q));
  }, [matters, query]);

  // The currently-selected members, always shown as removable chips so the
  // group's membership stays visible even while the search filter hides the
  // matching rows below.
  const selectedMatters = useMemo(
    () => matters.filter((m) => selected.has(m.id)),
    [matters, selected],
  );

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleCreate = () => {
    if (submittingRef.current) return;
    if (!name.trim()) return;
    submittingRef.current = true;
    const group = createGroup(name);
    if (group && selected.size > 0) {
      setGroupMembers(group.id, Array.from(selected));
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="new-group-dialog" className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('matter.group.new-title')}</DialogTitle>
          <DialogDescription className="sr-only">
            {t('matter.group.new-description')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label htmlFor="new-group-name">{t('matter.group.name-label')}</Label>
          <Input
            id="new-group-name"
            ref={nameRef}
            data-testid="new-group-name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
            }}
            placeholder={t('matter.group.name-placeholder')}
          />
        </div>

        <div className="space-y-1.5">
          <Label>{t('matter.group.add-clients-label')}</Label>

          {/* Selected members — always visible + removable, so the search
              filter can never hide what's already in the group. */}
          {selectedMatters.length > 0 && (
            <div
              data-testid="new-group-selected-chips"
              className="flex flex-wrap gap-1.5 pb-0.5"
            >
              {selectedMatters.map((m) => (
                <span
                  key={m.id}
                  data-testid={`new-group-chip-${m.id}`}
                  className="inline-flex items-center gap-1 rounded-full border bg-primary/5 py-0.5 pl-2 pr-1 text-xs"
                >
                  <span className="max-w-[12rem] truncate">{matterLabel(m)}</span>
                  <button
                    type="button"
                    data-testid={`new-group-chip-remove-${m.id}`}
                    aria-label={t('matter.group.remove-client', { name: matterLabel(m) })}
                    onClick={() => {
                      toggle(m.id);
                    }}
                    className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          )}

          <div className="flex items-center gap-2 rounded-md border px-2">
            <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <input
              data-testid="new-group-client-search"
              type="search"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
              }}
              placeholder={t('matter.group.search-placeholder')}
              aria-label={t('matter.group.search-placeholder')}
              className="h-8 w-full border-0 bg-transparent text-sm outline-none"
            />
          </div>
          <div
            className="max-h-52 overflow-y-auto rounded-md border divide-y"
            data-testid="new-group-client-list"
          >
            {matters.length === 0 ? (
              <p className="px-3 py-2 text-xs text-muted-foreground">
                {t('matter.group.no-clients')}
              </p>
            ) : filtered.length === 0 ? (
              <p className="px-3 py-2 text-xs text-muted-foreground">
                {t('matter.group.no-match')}
              </p>
            ) : (
              filtered.map((m) => {
                const checked = selected.has(m.id);
                return (
                  <button
                    key={m.id}
                    type="button"
                    data-testid={`new-group-client-${m.id}`}
                    data-checked={checked ? 'true' : 'false'}
                    onClick={() => {
                      toggle(m.id);
                    }}
                    className={cn(
                      'flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm hover:bg-accent',
                      checked && 'bg-primary/5',
                    )}
                  >
                    <span
                      className={cn(
                        'flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                        checked
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-muted-foreground/40',
                      )}
                    >
                      {checked && <Check className="h-3 w-3" />}
                    </span>
                    <span className="truncate">{matterLabel(m)}</span>
                  </button>
                );
              })
            )}
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            data-testid="new-group-cancel"
            onClick={() => {
              onOpenChange(false);
            }}
          >
            {t('matter.group.cancel')}
          </Button>
          <Button
            data-testid="new-group-create"
            onClick={handleCreate}
            disabled={!name.trim()}
          >
            {t('matter.group.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default NewClientGroupDialog;
