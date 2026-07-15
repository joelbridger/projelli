import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Search } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/dialog';
import type { SharedClientIdentity } from '@/platform/client-context';
import type { ClientPickerHousehold } from './clientPickerHouseholds';

interface ClientPickerModalProps {
  households?: readonly ClientPickerHousehold[] | undefined;
  loadFailed?: boolean | undefined;
  loading?: boolean | undefined;
  onClear: () => void;
  onOpenChange: (open: boolean) => void;
  onRetry?: (() => void) | undefined;
  onSelect: (client: SharedClientIdentity) => void;
  open: boolean;
  selectedHouseholdId: string | null;
}

export function ClientPickerModal({
  households = [],
  loadFailed = false,
  loading = false,
  onClear,
  onOpenChange,
  onRetry,
  onSelect,
  open,
  selectedHouseholdId,
}: ClientPickerModalProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const results = useMemo(
    () =>
      households.filter((household) =>
        [
          household.displayName,
          household.description,
          ...(household.primaryPeople ?? []),
        ]
          .join(' ')
          .toLocaleLowerCase()
          .includes(normalizedQuery)
      ),
    [households, normalizedQuery]
  );

  const close = () => {
    setQuery('');
    onOpenChange(false);
  };

  const selectClient = (household: ClientPickerHousehold) => {
    onSelect({
      householdId: household.householdId,
      displayName: household.displayName,
      ...(household.primaryPeople
        ? { primaryPeople: household.primaryPeople }
        : {}),
    });
    close();
  };

  const clearClient = () => {
    onClear();
    close();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) onOpenChange(true);
        else close();
      }}
    >
      <DialogContent
        className="max-w-[520px] gap-0 overflow-hidden rounded-xl border-slate-200 bg-white p-0 shadow-2xl"
        data-testid="client-picker-modal"
      >
        <DialogHeader className="border-b border-slate-200 px-6 py-5">
          <DialogTitle className="text-lg font-semibold text-slate-950">
            {t('client-bar.picker.title')}
          </DialogTitle>
        </DialogHeader>
        <div className="px-6 py-4">
          <label className="relative block">
            <span className="sr-only">
              {t('client-bar.picker.search-label')}
            </span>
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400"
            />
            <input
              autoFocus
              className="h-10 w-full rounded-md border border-slate-300 bg-white pl-9 pr-3 text-sm text-slate-950 outline-none placeholder:text-slate-400 focus:border-rose-600 focus:ring-2 focus:ring-rose-100"
              data-testid="client-picker-search"
              onChange={(event) => {
                setQuery(event.target.value);
              }}
              placeholder={t('client-bar.picker.search-placeholder')}
              type="search"
              value={query}
            />
          </label>
        </div>
        <div
          className="max-h-[360px] overflow-y-auto px-3 pb-3"
          role="listbox"
          aria-label={t('client-bar.picker.title')}
        >
          {loading ? (
            <p
              aria-live="polite"
              className="px-3 py-8 text-center text-sm text-slate-500"
              data-testid="client-picker-loading"
            >
              {t('client-bar.picker.loading')}
            </p>
          ) : loadFailed ? (
            <div
              className="flex flex-col items-center gap-3 px-3 py-8 text-center text-sm text-slate-500"
              data-testid="client-picker-error"
            >
              <p>{t('client-bar.picker.load-error')}</p>
              {onRetry ? (
                <button
                  className="rounded-md border border-slate-300 bg-white px-3 py-2 font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-600"
                  data-testid="client-picker-retry"
                  onClick={onRetry}
                  type="button"
                >
                  {t('client-bar.picker.retry')}
                </button>
              ) : null}
            </div>
          ) : results.length ? (
            results.map((household) => {
              const selected = household.householdId === selectedHouseholdId;
              return (
                <button
                  aria-selected={selected}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left hover:bg-rose-50 focus-visible:bg-rose-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-600"
                  data-testid={`client-picker-option-${household.householdId}`}
                  key={household.householdId}
                  onClick={() => {
                    selectClient(household);
                  }}
                  role="option"
                  type="button"
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-rose-50 text-xs font-semibold text-rose-700">
                    {initials(household.displayName)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-slate-900">
                      {household.displayName}
                    </span>
                    <span className="mt-0.5 block truncate text-sm text-slate-500">
                      {household.description ??
                        t('client-bar.picker.household-description')}
                    </span>
                  </span>
                  {selected ? (
                    <Check
                      aria-label={t('client-bar.picker.selected')}
                      className="size-4 text-rose-700"
                    />
                  ) : null}
                </button>
              );
            })
          ) : (
            <p
              className="px-3 py-8 text-center text-sm text-slate-500"
              data-testid="client-picker-empty"
            >
              {t('client-bar.picker.no-results')}
            </p>
          )}
        </div>
        <DialogFooter className="border-t border-slate-200 bg-slate-50 px-6 py-4 sm:justify-between">
          <button
            className="rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
            data-testid="client-picker-clear"
            onClick={clearClient}
            type="button"
          >
            {t('client-bar.picker.clear')}
          </button>
          <button
            className="rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
            data-testid="client-picker-cancel"
            onClick={close}
            type="button"
          >
            {t('client-bar.picker.cancel')}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}
