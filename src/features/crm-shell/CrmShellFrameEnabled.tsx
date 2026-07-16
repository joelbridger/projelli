import { createElement, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useFlag } from '@/platform/flags';
import type { CrmHomeRoute } from '@/features/crm-home';
import { CrmHomeSurfaceContext } from '@/features/crm-home/surfaceContext';
import type { CrmRailDestination } from './crmHomeRegistryAdapter';
import { getCrmShellRailDestinations } from './crmHomeRegistryAdapter';
import type { LiveCrmHomeRuntime } from '@/features/crm-home/shared/LiveCrmHome';

function useDestinationEnabled(
  destination: CrmRailDestination | undefined
): boolean {
  // Each call uses a stable fallback flag so unguarded registry entries still
  // subscribe consistently without creating a second registry policy here.
  const enabled = useFlag(destination?.flagId ?? 'shared-client-bar');
  return (
    destination === undefined || destination.flagId === undefined || enabled
  );
}

function CrmShellRailItem({
  destination,
  selected,
  onSelect,
}: {
  destination: CrmRailDestination;
  selected: boolean;
  onSelect: () => void;
}) {
  const { t } = useTranslation();
  const enabled = useDestinationEnabled(destination);
  if (!enabled) return null;

  const Icon = destination.icon;
  return (
    <button
      aria-current={selected ? 'page' : undefined}
      className={
        selected
          ? 'flex min-h-10 w-full items-center gap-3 rounded-lg bg-slate-900 px-3 text-left text-sm font-semibold text-white shadow-sm'
          : 'flex min-h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-950'
      }
      data-testid={`crm-shell-nav-${destination.route}`}
      onClick={onSelect}
      type="button"
    >
      <Icon aria-hidden="true" className="size-4 shrink-0" />
      <span>{t(destination.labelKey)}</span>
    </button>
  );
}

function CrmShellDestination({
  destination,
  fallback,
  runtime,
  onFallback,
  onNavigate,
}: {
  destination: CrmRailDestination | undefined;
  fallback: CrmRailDestination | undefined;
  runtime: LiveCrmHomeRuntime;
  onFallback: () => void;
  onNavigate: (route: CrmHomeRoute) => void;
}) {
  const { t } = useTranslation();
  const selectedEnabled = useDestinationEnabled(destination);
  const activeDestination = selectedEnabled ? destination : fallback;
  useEffect(() => {
    if (!selectedEnabled && destination && fallback) onFallback();
  }, [destination, fallback, onFallback, selectedEnabled]);
  if (!activeDestination) {
    return (
      <p className="text-sm text-slate-600">{t('crm-shell.content.empty')}</p>
    );
  }
  return (
    <CrmHomeSurfaceContext.Provider
      value={{
        adapter: runtime.adapter,
        route: activeDestination.route,
        navigate: (route) => {
          onNavigate(route as CrmHomeRoute);
        },
        ...(runtime.workflowData ? { workflowData: runtime.workflowData } : {}),
        ...(runtime.workflowHouseholds
          ? { workflowHouseholds: runtime.workflowHouseholds }
          : {}),
        ...(runtime.saveLiveRecord
          ? { saveLiveRecord: runtime.saveLiveRecord }
          : {}),
        undoReport: null,
        reportUndo: () => undefined,
        adapterProvided: runtime.adapterProvided,
      }}
    >
      {createElement(activeDestination.Component)}
    </CrmHomeSurfaceContext.Provider>
  );
}

/** The enabled-only CRM frame. Its destinations come solely from CRM Home. */
export function CrmShellFrameEnabled(runtime: LiveCrmHomeRuntime) {
  const { t } = useTranslation();
  const destinations = getCrmShellRailDestinations();
  const fallback = destinations.find((destination) => !destination.flagId);
  const [activeRoute, setActiveRoute] = useState<CrmHomeRoute | null>(
    () => fallback?.route ?? null
  );
  const activeDestination = destinations.find(
    (destination) => destination.route === activeRoute
  );

  return (
    <div
      className="flex min-h-0 flex-1 overflow-hidden bg-slate-50 text-slate-950"
      data-testid="crm-shell-frame"
    >
      <aside className="flex w-60 shrink-0 flex-col border-r border-slate-200 bg-white px-3 py-5">
        <div className="mb-5 px-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
            {t('crm-shell.rail.eyebrow')}
          </p>
          <h1 className="mt-1 text-lg font-semibold text-slate-950">
            {t('crm-shell.title')}
          </h1>
        </div>
        <nav aria-label={t('crm-shell.rail.label')} className="space-y-1">
          {destinations.map((destination) => {
            const selected = destination.route === activeDestination?.route;
            return (
              <CrmShellRailItem
                destination={destination}
                key={destination.id}
                onSelect={() => {
                  setActiveRoute(destination.route);
                }}
                selected={selected}
              />
            );
          })}
        </nav>
      </aside>

      <main
        aria-live="polite"
        className="flex min-w-0 flex-1 flex-col overflow-auto px-8 py-7"
        data-testid="crm-shell-content"
      >
        <CrmShellDestination
          destination={activeDestination}
          fallback={fallback}
          onFallback={() => {
            if (fallback) setActiveRoute(fallback.route);
          }}
          onNavigate={setActiveRoute}
          runtime={runtime}
        />
      </main>
    </div>
  );
}
