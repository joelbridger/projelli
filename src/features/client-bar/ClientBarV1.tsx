import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown } from 'lucide-react';
import {
  issueSharedClientSelection,
  replaceCanonicalHouseholdDirectory,
  requestClearClientSelection,
  requestSharedClientSelection,
  useClientContextStore,
} from '@/platform/client-context';
import type { SharedClientIdentity } from '@/platform/client-context';
import { ClientPickerModal } from './ClientPickerModal';
import type { ClientPickerHousehold } from './clientPickerHouseholds';
import { type ClientBarQuickAction } from './quickActions';

export interface ClientBarV1Props {
  households?: readonly ClientPickerHousehold[] | undefined;
  quickActions?: readonly ClientBarQuickAction[] | undefined;
  onNavigate?: ((surfaceId: string) => void) | undefined;
  /** Called when the picker button is opened, for shell telemetry or focus handling. */
  onChooseClient?: (() => void) | undefined;
}

export function ClientBarV1({
  households = [],
  quickActions = [],
  onChooseClient,
  onNavigate,
}: ClientBarV1Props) {
  const { t } = useTranslation();
  const [pickerOpen, setPickerOpen] = useState(false);
  const client = useClientContextStore((state) => state.client);

  useEffect(() => {
    replaceCanonicalHouseholdDirectory('wealthbox', households);
  }, [households]);

  const openPicker = () => {
    onChooseClient?.();
    setPickerOpen(true);
  };

  const selectClient = (nextClient: SharedClientIdentity) => {
    const request = issueSharedClientSelection(nextClient);
    void requestSharedClientSelection(request).catch((error: unknown) => {
      console.error('[ClientBar] Client selection failed.', error);
    });
  };

  const clearSelectedClient = () => {
    requestClearClientSelection();
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
              label={
                action.id === 'matters'
                  ? t('client-bar.actions.open-crm')
                  : t(action.labelKey)
              }
              onNavigate={onNavigate}
            />
          ))}
        </div>
      </section>
      <ClientPickerModal
        households={households}
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
