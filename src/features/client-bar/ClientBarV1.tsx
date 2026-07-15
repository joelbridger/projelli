import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown } from 'lucide-react';
import { useClientContextStore } from '@/platform/client-context';
import {
  useActiveMatters,
  useMatterStore,
} from '@/platform/matter/matterStore';
import type { SharedClientIdentity } from '@/platform/client-context';
import { ClientPickerModal } from './ClientPickerModal';
import type { ClientPickerHousehold } from './clientPickerHouseholds';

export type ClientBarDestination = 'crm' | 'ask' | 'meetings';

export interface ClientBarV1Props {
  households?: readonly ClientPickerHousehold[] | undefined;
  /** Lets the shell own navigation while this feature stays surface-agnostic. */
  onNavigate?: ((destination: ClientBarDestination) => void) | undefined;
  /** Called when the picker button is opened, for shell telemetry or focus handling. */
  onChooseClient?: (() => void) | undefined;
}

export function ClientBarV1({
  households,
  onNavigate,
  onChooseClient,
}: ClientBarV1Props) {
  const { t } = useTranslation();
  const [pickerOpen, setPickerOpen] = useState(false);
  const client = useClientContextStore((state) => state.client);
  const setClient = useClientContextStore((state) => state.setClient);
  const clearClient = useClientContextStore((state) => state.clearClient);
  const activeMatters = useActiveMatters();
  const liveHouseholds = useMemo<readonly ClientPickerHousehold[]>(
    () =>
      activeMatters.map((matter) => ({
        householdId: matter.id,
        displayName: matter.client || matter.name,
        description: matter.name,
      })),
    [activeMatters]
  );
  const pickerHouseholds =
    households ?? (liveHouseholds.length ? liveHouseholds : undefined);

  const openPicker = () => {
    onChooseClient?.();
    setPickerOpen(true);
  };

  const selectClient = (nextClient: SharedClientIdentity) => {
    setClient(nextClient);
    useMatterStore
      .getState()
      .setActiveMatter(
        activeMatters.some((matter) => matter.id === nextClient.householdId)
          ? nextClient.householdId
          : null
      );
  };

  const clearSelectedClient = () => {
    clearClient();
    useMatterStore.getState().setActiveMatter(null);
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
          className="inline-flex min-h-9 items-center gap-2 rounded-full border border-slate-300 bg-white py-1 pl-1 pr-2.5 text-left font-medium text-slate-900 shadow-sm hover:border-slate-400 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
          data-testid="client-bar-picker"
          onClick={openPicker}
          type="button"
        >
          {client ? (
            <span
              className="flex size-7 items-center justify-center rounded-full bg-blue-100 text-[11px] font-bold text-blue-700"
              aria-hidden="true"
            >
              {initials(client.displayName)}
            </span>
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
          <QuickAction
            destination="crm"
            label={t('client-bar.actions.crm')}
            onNavigate={onNavigate}
          />
          <QuickAction
            destination="ask"
            label={t('client-bar.actions.ask')}
            onNavigate={onNavigate}
          />
          <QuickAction
            destination="meetings"
            label={t('client-bar.actions.meetings')}
            onNavigate={onNavigate}
          />
        </div>
      </section>
      <ClientPickerModal
        households={pickerHouseholds}
        onClear={clearSelectedClient}
        onOpenChange={setPickerOpen}
        onSelect={selectClient}
        open={pickerOpen}
        selectedHouseholdId={client?.householdId ?? null}
      />
    </>
  );
}

function QuickAction({
  destination,
  label,
  onNavigate,
}: {
  destination: ClientBarDestination;
  label: string;
  onNavigate?: ((destination: ClientBarDestination) => void) | undefined;
}) {
  return (
    <button
      className="rounded-md px-2 py-1 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
      data-testid={`client-bar-open-${destination}`}
      onClick={() => {
        onNavigate?.(destination);
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
