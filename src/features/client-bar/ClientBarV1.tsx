import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown } from 'lucide-react';
import { useClientContextStore } from '@/platform/client-context';
import type { SharedClientIdentity } from '@/platform/client-context';
import { ClientPickerModal } from './ClientPickerModal';
import type { ClientPickerHousehold } from './clientPickerHouseholds';
import { fetchClientPickerHouseholds } from './fetchClientPickerHouseholds';
import { type ClientBarQuickAction } from './quickActions';

export interface ClientBarV1Props {
  households?: readonly ClientPickerHousehold[] | undefined;
  quickActions?: readonly ClientBarQuickAction[] | undefined;
  onNavigate?: ((surfaceId: string) => void) | undefined;
  /** Called when the picker button is opened, for shell telemetry or focus handling. */
  onChooseClient?: (() => void) | undefined;
}

export function ClientBarV1({
  households,
  quickActions = [],
  onChooseClient,
  onNavigate,
}: ClientBarV1Props) {
  const { t } = useTranslation();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [loadedHouseholds, setLoadedHouseholds] = useState<
    readonly ClientPickerHousehold[]
  >([]);
  const [householdsLoading, setHouseholdsLoading] = useState(false);
  const [householdsLoadFailed, setHouseholdsLoadFailed] = useState(false);
  const householdRequestId = useRef(0);
  const client = useClientContextStore((state) => state.client);
  const setClient = useClientContextStore((state) => state.setClient);
  const clearClient = useClientContextStore((state) => state.clearClient);
  const pickerHouseholds = households ?? loadedHouseholds;

  const loadHouseholds = useCallback(async () => {
    if (households) return;

    const requestId = householdRequestId.current + 1;
    householdRequestId.current = requestId;
    setHouseholdsLoading(true);
    setHouseholdsLoadFailed(false);
    try {
      const nextHouseholds = await fetchClientPickerHouseholds();
      if (householdRequestId.current !== requestId) return;
      setLoadedHouseholds(nextHouseholds);
    } catch {
      if (householdRequestId.current !== requestId) return;
      setLoadedHouseholds([]);
      setHouseholdsLoadFailed(true);
    } finally {
      if (householdRequestId.current === requestId) {
        setHouseholdsLoading(false);
      }
    }
  }, [households]);

  useEffect(
    () => () => {
      householdRequestId.current += 1;
    },
    []
  );

  const openPicker = () => {
    onChooseClient?.();
    setPickerOpen(true);
    void loadHouseholds();
  };

  const selectClient = (nextClient: SharedClientIdentity) => {
    setClient(nextClient);
  };

  const clearSelectedClient = () => {
    clearClient();
  };

  return (
    <>
      <section
        aria-label={t('shared-client.bar.label')}
        className="flex min-h-14 flex-wrap items-center gap-x-3 gap-y-2 border-b border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-700"
        data-testid="client-bar-v1"
      >
        <span className="font-medium text-slate-500">
          {t('shared-client.bar.label')}
        </span>
        <button
          aria-haspopup="dialog"
          aria-label={t('client-bar.picker.trigger')}
          className={`inline-flex min-h-9 items-center gap-2 rounded-full border px-3 py-1 text-left font-semibold shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-600 ${
            client
              ? 'border-rose-500 bg-rose-50 text-slate-900 hover:bg-rose-100'
              : 'border-slate-300 bg-white text-slate-600 hover:border-slate-400 hover:bg-slate-50'
          }`}
          data-testid="client-bar-picker"
          onClick={openPicker}
          type="button"
        >
          {client ? (
            <span aria-hidden="true">{initials(client.displayName)} ·</span>
          ) : null}
          <span data-testid="client-bar-current">
            {client?.displayName ?? t('shared-client.bar.empty')}
          </span>
          <ChevronDown aria-hidden="true" className="size-4 text-slate-500" />
        </button>
        {client ? (
          <button
            className="rounded-md px-2 py-1 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
            data-testid="client-bar-clear"
            onClick={clearSelectedClient}
            type="button"
          >
            {t('shared-client.bar.clear')}
          </button>
        ) : null}
        <span className="min-w-[18rem] flex-1 text-slate-500">
          {client
            ? t('client-bar.helper.selected')
            : t('client-bar.helper.empty')}
        </span>
        <div
          aria-label={t('client-bar.quick-actions-label')}
          className="flex items-center gap-1"
        >
          {quickActions.map((action) => (
            <QuickAction
              action={action}
              key={action.id}
              label={t('client-bar.actions.open', {
                surface: t(action.labelKey),
              })}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      </section>
      <ClientPickerModal
        loadFailed={householdsLoadFailed}
        loading={householdsLoading}
        households={pickerHouseholds}
        onClear={clearSelectedClient}
        onOpenChange={setPickerOpen}
        onRetry={loadHouseholds}
        onSelect={selectClient}
        open={pickerOpen}
        selectedHouseholdId={client?.householdId ?? null}
      />
    </>
  );
}

function QuickAction({
  action,
  label,
  onNavigate,
}: {
  action: ClientBarQuickAction;
  label: string;
  onNavigate?: ((surfaceId: string) => void) | undefined;
}) {
  return (
    <button
      className="rounded-md px-2 py-1 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
      data-testid={`client-bar-open-${action.id}`}
      onClick={() => {
        onNavigate?.(action.id);
      }}
      type="button"
    >
      {label}
    </button>
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
