import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CrmHomeRoute } from '@/features/crm-home';
import { getCrmShellRailDestinations } from './crmHomeRegistryAdapter';

/** The enabled-only CRM frame. Its destinations come solely from CRM Home. */
export function CrmShellFrameEnabled() {
  const { t } = useTranslation();
  const destinations = getCrmShellRailDestinations();
  const [activeRoute, setActiveRoute] = useState<CrmHomeRoute | null>(
    () => destinations[0]?.route ?? null
  );
  const activeDestination =
    destinations.find((destination) => destination.route === activeRoute) ??
    destinations[0];

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
            const Icon = destination.icon;
            const selected = destination.route === activeDestination?.route;
            return (
              <button
                aria-current={selected ? 'page' : undefined}
                className={
                  selected
                    ? 'flex min-h-10 w-full items-center gap-3 rounded-lg bg-slate-900 px-3 text-left text-sm font-semibold text-white shadow-sm'
                    : 'flex min-h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-950'
                }
                data-testid={`crm-shell-nav-${destination.route}`}
                key={destination.id}
                onClick={() => {
                  setActiveRoute(destination.route);
                }}
                type="button"
              >
                <Icon aria-hidden="true" className="size-4 shrink-0" />
                <span>{t(destination.labelKey)}</span>
              </button>
            );
          })}
        </nav>
      </aside>

      <main
        aria-live="polite"
        className="flex min-w-0 flex-1 flex-col overflow-auto px-8 py-7"
        data-testid="crm-shell-content"
      >
        {activeDestination ? (
          <>
            <p className="text-sm font-medium text-slate-500">
              {t('crm-shell.content.eyebrow')}
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">
              {t(activeDestination.labelKey)}
            </h2>
            <p className="mt-3 max-w-xl text-sm leading-6 text-slate-600">
              {t('crm-shell.content.frame-copy')}
            </p>
          </>
        ) : (
          <p className="text-sm text-slate-600">
            {t('crm-shell.content.empty')}
          </p>
        )}
      </main>
    </div>
  );
}
