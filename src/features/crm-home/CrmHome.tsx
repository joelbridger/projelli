/* eslint-disable lantern-i18n/no-hardcoded-string -- Frozen CRM screen copy needs its translation catalog in a separate product change. */
import { createElement, useCallback, useEffect, useState } from 'react';
import { Bell } from 'lucide-react';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';
import { crmHomeSurfaceRegistry } from './registry';
import { CrmHomeSurfaceContext } from './surfaceContext';
import { panelStyle } from './shared/ui';
import { LiveCrmHome } from './shared/LiveCrmHome';
import type { CrmHomeProps, CrmHomeRoute } from './routes';
import type { HouseholdChoice, LiveWorkflowData } from '@/features/crm-workflows/Workflows';

export type { CrmHomeProps, CrmHomeRoute } from './routes';

function HomeRail({ route, onNavigate }: { route: CrmHomeRoute; onNavigate: (route: CrmHomeRoute) => void }) {
  const activeParent =
    route.startsWith('firm') ||
    route === 'fields-tags' ||
    route === 'intake-links' ||
    route.includes('migration') ||
    route.includes('fidelity') ||
    route.includes('export') ||
    route === 'workflow-recreation' ||
    route === 'attachment-accounting'
      ? 'firm-setup'
      : route === 'propagation'
        ? 'workflows'
        : route === 'pipeline-settings'
          ? 'pipeline'
          : route;
  return (
    <aside aria-label="Home sections" style={{ width: 184, padding: 'var(--kp-space-md)', borderRight: '1px solid var(--kp-border)', background: 'var(--color-slate-50)', flex: 'none' }}>
      <div style={{ fontWeight: 700, color: 'var(--kp-navy)', marginBottom: 10 }}>Home</div>
      {crmHomeSurfaceRegistry.filter(({ rail }) => rail).map(({ route: item, label, icon: Icon }) => (
        <button
          key={item}
          data-testid={`crm-home-nav-${item}`}
          onClick={() => { onNavigate(item); }}
          aria-current={activeParent === item ? 'page' : undefined}
          style={{
            display: 'flex', width: '100%', alignItems: 'center', gap: 8, border: 0,
            borderRadius: 7, padding: '8px 9px', marginBottom: 3, cursor: 'pointer',
            textAlign: 'left',
            background: activeParent === item ? 'var(--kp-assured-bg)' : 'transparent',
            color: activeParent === item ? 'var(--kp-assured)' : 'var(--kp-text)',
          }}
        >
          <Icon size={16} />
          {label}
        </button>
      ))}
    </aside>
  );
}

export function CrmHomeShell({
  adapter,
  initialRoute = 'today',
  preview = false,
  workflowData,
  workflowHouseholds,
  saveLiveRecord,
  adapterProvided,
}: Required<Pick<CrmHomeProps, 'adapter'>> &
  Omit<CrmHomeProps, 'adapter'> & {
    workflowData?: LiveWorkflowData;
    workflowHouseholds?: readonly HouseholdChoice[];
    saveLiveRecord?: (record: LiveCrmRecord) => Promise<unknown>;
    adapterProvided?: boolean;
  }) {
  const [route, setRoute] = useState<CrmHomeRoute>(initialRoute);
  const [undoReport, setUndoReport] = useState<string | null>(null);
  const jump = (next: CrmHomeRoute) => { setRoute(next); };
  const reportUndo = useCallback(() => {
    const result = adapter.actions.undoPropagation?.() ?? { restored: 0, protectedCells: [] };
    setUndoReport(result.protectedCells.length
      ? `${String(result.restored)} untouched derived cells restored. Protected cells kept: ${result.protectedCells.join(', ')}.`
      : `${String(result.restored)} untouched derived cells restored. No protected cells needed to stay.`);
  }, [adapter]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement | null)?.tagName === 'INPUT') return;
      if (event.key === 'g') {
        (window as Window & { __crmGo?: boolean }).__crmGo = true;
        return;
      }
      if ((window as Window & { __crmGo?: boolean }).__crmGo) {
        const key = event.key.toLowerCase();
        const destination: CrmHomeRoute | null =
          key === 'h' ? 'today' : key === 't' ? 'tasks' : key === 'w' ? 'workflows'
            : key === 'p' ? 'pipeline' : key === 'r' ? 'reports'
              : key === 'f' ? 'firm-setup' : key === 'm' ? 'migration' : null;
        if (destination) { event.preventDefault(); jump(destination); }
        (window as Window & { __crmGo?: boolean }).__crmGo = false;
      }
      if (event.key === '/' && route !== 'tasks') {
        document.querySelector<HTMLInputElement>('[data-testid="crm-ask-input"]')?.focus();
      }
      if (route === 'propagation' && event.key.toLowerCase() === 'u') {
        event.preventDefault();
        reportUndo();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => { window.removeEventListener('keydown', onKeyDown); };
  }, [reportUndo, route]);

  const selectedSurface =
    crmHomeSurfaceRegistry.find((surface) => surface.route === route) ??
    crmHomeSurfaceRegistry.find((surface) => surface.route === 'firm-setup')!;
  const content = (
    <CrmHomeSurfaceContext.Provider value={{
      adapter,
      route,
      navigate: (next) => { jump(next as CrmHomeRoute); },
      ...(workflowData ? { workflowData } : {}),
      ...(workflowHouseholds ? { workflowHouseholds } : {}),
      ...(saveLiveRecord ? { saveLiveRecord } : {}),
      undoReport,
      reportUndo,
      adapterProvided: adapterProvided ?? false,
    }}>
      {createElement(selectedSurface.Component)}
    </CrmHomeSurfaceContext.Provider>
  );

  return (
    <div data-testid="crm-home" style={{ display: 'flex', height: '100%', minHeight: 0, position: 'relative', background: 'var(--color-background)' }}>
      {preview && (
        <div data-testid="crm-home-preview-label" role="status" style={{ position: 'absolute', zIndex: 20, right: 16, bottom: 12, ...panelStyle, padding: 8, borderColor: 'var(--kp-direct)' }}>
          Preview mode. Not connected to CRM data.
        </div>
      )}
      <HomeRail route={route} onNavigate={jump} />
      <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', position: 'relative' }}>
        {content}
        <button data-testid="crm-notifications-button" aria-label="Open notifications" onClick={() => { jump('activity'); }} style={{ position: 'absolute', top: 15, right: 18, border: 0, background: 'transparent', cursor: 'pointer', color: 'var(--kp-navy)' }}>
          <Bell size={20} /> <span aria-label="Open notifications">Notifications</span>
        </button>
      </div>
    </div>
  );
}

export function CrmHome(props: CrmHomeProps) {
  return <LiveCrmHome {...props} />;
}

export default CrmHome;
