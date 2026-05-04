// Plugin runner — sidebar panels contributed by installed plugins.
//
// Each plugin-contributed panel renders inside a fully-sandboxed iframe via
// `srcDoc`. The `sandbox=""` attribute disables scripts, forms, popups, and
// same-origin access; even though the plugin already runs inside a Worker
// the iframe gives the rendered HTML a hard boundary against the host page.
//
// Pattern adapted from the Stream C2 spike (`SpikeSidebarPreview.tsx`).
//
// When more than one plugin panel is registered we surface a tab strip at
// the top so the user can switch between them without leaving the Plugins
// section. When only one is registered we render it directly.
//
// Plan: docs/superpowers/plans/2026-05-03-stream-c3-plugin-runner.md (task 8.2)

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';
import { usePluginRegistryStore } from '@/stores/pluginRegistryStore';

interface PluginSidebarPanelsProps {
  className?: string;
}

const PANEL_FRAME_STYLES = `
  :root { color-scheme: light dark; }
  body {
    margin: 0;
    padding: 12px;
    font-family: ui-sans-serif, system-ui, sans-serif;
    font-size: 14px;
    line-height: 1.4;
    color: inherit;
    background: transparent;
  }
  body * { max-width: 100%; }
  a { color: inherit; }
`;

function buildSrcDoc(html: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${PANEL_FRAME_STYLES}</style></head><body>${html}</body></html>`;
}

export function PluginSidebarPanels({ className }: PluginSidebarPanelsProps) {
  const { t } = useTranslation();
  const panels = usePluginRegistryStore((state) => state.sidebar);
  const [activePanelId, setActivePanelId] = useState<string | null>(null);

  // Keep the active panel id valid as the registry grows / shrinks. If the
  // current selection disappears (plugin disabled), drop back to the first.
  useEffect(() => {
    if (panels.length === 0) {
      if (activePanelId !== null) setActivePanelId(null);
      return;
    }
    const stillExists = panels.some((p) => p.id === activePanelId);
    if (!stillExists) {
      setActivePanelId(panels[0]?.id ?? null);
    }
  }, [panels, activePanelId]);

  const activePanel = useMemo(
    () => panels.find((p) => p.id === activePanelId) ?? panels[0] ?? null,
    [panels, activePanelId],
  );

  const srcDoc = useMemo(
    () => (activePanel?.html ? buildSrcDoc(activePanel.html) : ''),
    [activePanel],
  );

  if (panels.length === 0) {
    return (
      <div
        data-testid="plugin-sidebar-empty"
        className={cn(
          'rounded-md border border-dashed border-border bg-muted/20 p-3 m-3 text-xs text-muted-foreground',
          className,
        )}
      >
        {t('plugins.sidebar.no-panels')}
      </div>
    );
  }

  return (
    <div
      data-testid="plugin-sidebar-panels"
      className={cn('flex flex-col h-full', className)}
    >
      {panels.length > 1 && (
        <div
          data-testid="plugin-sidebar-tabs"
          role="tablist"
          aria-label="Plugin panels"
          className="flex items-center gap-0.5 px-2 py-1 border-b overflow-x-auto"
        >
          {panels.map((p) => {
            const isActive = activePanel?.id === p.id;
            return (
              <button
                key={p.id}
                role="tab"
                aria-selected={isActive}
                data-testid={`plugin-sidebar-tab-${p.id}`}
                data-plugin-id={p.pluginId}
                className={cn(
                  'shrink-0 px-2 py-1 text-xs rounded',
                  isActive
                    ? 'bg-accent text-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/50',
                )}
                onClick={() => setActivePanelId(p.id)}
              >
                {p.title}
              </button>
            );
          })}
        </div>
      )}

      {activePanel && (
        <div
          data-testid="plugin-sidebar-panel"
          data-panel-id={activePanel.id}
          data-plugin-id={activePanel.pluginId}
          className="flex-1 overflow-hidden flex flex-col"
        >
          {panels.length === 1 && (
            <div className="border-b px-3 py-1.5 text-xs font-medium text-foreground">
              {activePanel.title}
            </div>
          )}
          {activePanel.html ? (
            <iframe
              key={activePanel.id}
              title={`plugin-panel-${activePanel.id}`}
              sandbox=""
              srcDoc={srcDoc}
              className="flex-1 w-full bg-transparent border-0"
              data-testid="plugin-sidebar-iframe"
            />
          ) : (
            <div className="p-3 text-xs text-muted-foreground">
              {t('plugins.sidebar.no-html')}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default PluginSidebarPanels;
