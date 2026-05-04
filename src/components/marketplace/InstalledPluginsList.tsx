/**
 * InstalledPluginsList — the "Installed" subview of the Plugins tab.
 *
 * Renders one row per installed plugin from `pluginManagerStore.installedPlugins`.
 * Each row shows: name + version + status badge + state-aware action buttons.
 *
 * Action map per status:
 *   enabled  → [Disable] [Uninstall]
 *   disabled → [Enable]  [Uninstall]
 *   crashed  → [Restart] [Disable] [Uninstall] + inline <PluginErrorPanel />
 *   updating → spinner only
 *   installed (dormant on-disk only) → [Enable] [Uninstall]
 *
 * Uninstall ordering matches PluginDetailView: tear down the worker via
 * `manager.uninstall(id)` BEFORE deleting files via `service.uninstall(id)`.
 *
 * Empty state preserves `data-testid="installed-plugins-empty"` so the
 * Group III PluginsTab test still passes.
 */

import { useCallback, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import {
  Loader2,
  Pause,
  Play,
  Puzzle,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  selectAllInstalled,
  usePluginManagerStore,
} from '@/stores/pluginManagerStore';
import { getActivePluginManager } from '@/modules/plugins/pluginManagerHolder';
import { usePluginsMarketplace } from '@/hooks/usePluginsMarketplace';
import type { PluginInstance, PluginStatus } from '@/types/plugin';
import { PluginErrorPanel } from './PluginErrorPanel';

type ActionKind = 'enable' | 'disable' | 'uninstall' | 'restart';

interface OutcomeState {
  kind: 'success' | 'failure';
  pluginId: string;
  message: string;
}

const STATUS_LABEL: Record<PluginStatus, string> = {
  enabled: 'Enabled',
  disabled: 'Disabled',
  crashed: 'Crashed',
  updating: 'Updating',
  installed: 'Installed',
};

// Color tokens for status pills. `crashed` uses the destructive palette so it
// stands out; `enabled` is green; `updating` is blue; everything else is muted.
const STATUS_PILL: Record<PluginStatus, string> = {
  enabled: 'bg-green-500/15 text-green-700 dark:text-green-400',
  disabled: 'bg-muted text-muted-foreground',
  crashed: 'bg-destructive/15 text-destructive',
  updating: 'bg-blue-500/15 text-blue-700 dark:text-blue-400',
  installed: 'bg-muted text-muted-foreground',
};

export function InstalledPluginsList() {
  const installed = usePluginManagerStore(selectAllInstalled);
  const statusByPluginId = usePluginManagerStore((s) => s.statusByPluginId);
  const { service: marketplaceService } = usePluginsMarketplace();

  const [pendingUninstall, setPendingUninstall] = useState<PluginInstance | null>(
    null,
  );
  const [busy, setBusy] = useState<{ id: string; kind: ActionKind } | null>(null);
  const [outcome, setOutcome] = useState<OutcomeState | null>(null);

  const sortedInstalled = useMemo(() => {
    // Stable order by name for predictable rendering across status changes.
    return [...installed].sort((a, b) =>
      a.manifest.name.localeCompare(b.manifest.name),
    );
  }, [installed]);

  const handleEnable = useCallback(async (id: string) => {
    const manager = getActivePluginManager();
    if (!manager) return;
    setBusy({ id, kind: 'enable' });
    setOutcome(null);
    try {
      await manager.enable(id);
    } catch (err) {
      setOutcome({
        kind: 'failure',
        pluginId: id,
        message: err instanceof Error ? err.message : 'Enable failed.',
      });
    } finally {
      setBusy(null);
    }
  }, []);

  const handleDisable = useCallback(async (id: string) => {
    const manager = getActivePluginManager();
    if (!manager) return;
    setBusy({ id, kind: 'disable' });
    setOutcome(null);
    try {
      await manager.disable(id);
    } catch (err) {
      setOutcome({
        kind: 'failure',
        pluginId: id,
        message: err instanceof Error ? err.message : 'Disable failed.',
      });
    } finally {
      setBusy(null);
    }
  }, []);

  const handleRestart = useCallback(async (id: string) => {
    const manager = getActivePluginManager();
    if (!manager) return;
    setBusy({ id, kind: 'restart' });
    setOutcome(null);
    try {
      await manager.restart(id);
    } catch (err) {
      setOutcome({
        kind: 'failure',
        pluginId: id,
        message: err instanceof Error ? err.message : 'Restart failed.',
      });
    } finally {
      setBusy(null);
    }
  }, []);

  const handleAskUninstall = useCallback((p: PluginInstance) => {
    setOutcome(null);
    setPendingUninstall(p);
  }, []);

  const handleConfirmUninstall = useCallback(async () => {
    if (!pendingUninstall) return;
    const target = pendingUninstall;
    const id = target.manifest.id;
    setBusy({ id, kind: 'uninstall' });
    try {
      // Tear the worker down BEFORE deleting files (avoid racing the
      // plugin's deactivate hook against the FS removal).
      const manager = getActivePluginManager();
      if (manager) {
        try {
          await manager.uninstall(id);
        } catch {
          // Manager teardown is best-effort; the marketplace uninstall is
          // what users see in this list.
        }
      }
      if (marketplaceService) {
        await marketplaceService.uninstall(id);
      }
      setOutcome({
        kind: 'success',
        pluginId: id,
        message: `Uninstalled ${target.manifest.name}.`,
      });
    } catch (err) {
      setOutcome({
        kind: 'failure',
        pluginId: id,
        message:
          err instanceof Error ? err.message : 'Uninstall failed unexpectedly.',
      });
    } finally {
      setBusy(null);
      setPendingUninstall(null);
    }
  }, [marketplaceService, pendingUninstall]);

  if (sortedInstalled.length === 0) {
    return (
      <div
        data-testid="installed-plugins-empty"
        className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground"
      >
        No plugins installed yet. Browse the marketplace to add one.
      </div>
    );
  }

  return (
    <div data-testid="installed-plugins-list" className="space-y-3">
      {outcome && (
        <Card
          data-testid={
            outcome.kind === 'success'
              ? 'installed-plugins-outcome-success'
              : 'installed-plugins-outcome-failure'
          }
          role="status"
          aria-live="polite"
          className={
            outcome.kind === 'success'
              ? 'border-green-500/40 bg-green-500/10'
              : 'border-destructive/40 bg-destructive/10'
          }
        >
          <CardContent className="p-3 flex items-center justify-between gap-2">
            <span className="text-sm">{outcome.message}</span>
            <Button
              data-testid="installed-plugins-outcome-dismiss"
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => setOutcome(null)}
            >
              Dismiss
            </Button>
          </CardContent>
        </Card>
      )}

      <ul className="space-y-2">
        {sortedInstalled.map((plugin) => {
          const id = plugin.manifest.id;
          const status: PluginStatus = statusByPluginId[id] ?? plugin.status;
          const isBusy = busy?.id === id;
          return (
            <li key={id}>
              <Card data-testid={`installed-plugin-${id}`}>
                <CardContent className="p-3 space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1 flex items-center gap-2.5">
                      <Puzzle
                        className="h-4 w-4 shrink-0 text-muted-foreground"
                        aria-hidden="true"
                      />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span
                            data-testid={`installed-plugin-name-${id}`}
                            className="text-sm font-medium truncate"
                            title={plugin.manifest.name}
                          >
                            {plugin.manifest.name}
                          </span>
                          <StatusBadge status={status} pluginId={id} />
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          v{plugin.manifest.version}
                          {' · '}
                          by {plugin.manifest.author.name}
                        </div>
                      </div>
                    </div>

                    <RowActions
                      pluginId={id}
                      status={status}
                      busy={isBusy ? busy.kind : null}
                      onEnable={() => {
                        void handleEnable(id);
                      }}
                      onDisable={() => {
                        void handleDisable(id);
                      }}
                      onRestart={() => {
                        void handleRestart(id);
                      }}
                      onUninstall={() => {
                        handleAskUninstall(plugin);
                      }}
                    />
                  </div>

                  {status === 'crashed' && (
                    <PluginErrorPanel pluginId={id} />
                  )}
                </CardContent>
              </Card>
            </li>
          );
        })}
      </ul>

      <ConfirmDialog
        open={pendingUninstall !== null}
        onOpenChange={(o) => {
          if (!o) setPendingUninstall(null);
        }}
        title="Uninstall plugin?"
        description={
          pendingUninstall
            ? `Remove "${pendingUninstall.manifest.name}" v${pendingUninstall.manifest.version} from this workspace. The plugin's files will be deleted. You can reinstall it later from the marketplace.`
            : ''
        }
        confirmLabel="Uninstall"
        cancelLabel="Cancel"
        variant="destructive"
        onConfirm={() => {
          void handleConfirmUninstall();
        }}
        onCancel={() => setPendingUninstall(null)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

function StatusBadge({
  status,
  pluginId,
}: {
  status: PluginStatus;
  pluginId: string;
}) {
  return (
    <span
      data-testid={`installed-plugin-status-${pluginId}`}
      data-status={status}
      className={cn(
        'text-[10px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded inline-flex items-center gap-1',
        STATUS_PILL[status],
      )}
    >
      {status === 'updating' && (
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
      )}
      {STATUS_LABEL[status]}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Row actions (state-aware)
// ---------------------------------------------------------------------------

interface RowActionsProps {
  pluginId: string;
  status: PluginStatus;
  busy: ActionKind | null;
  onEnable: () => void;
  onDisable: () => void;
  onRestart: () => void;
  onUninstall: () => void;
}

function RowActions({
  pluginId,
  status,
  busy,
  onEnable,
  onDisable,
  onRestart,
  onUninstall,
}: RowActionsProps) {
  const disabled = busy !== null;

  if (status === 'updating') {
    return (
      <div
        data-testid={`installed-plugin-updating-${pluginId}`}
        className="flex items-center gap-1.5 text-xs text-muted-foreground"
      >
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        Updating...
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 shrink-0">
      {status === 'crashed' && (
        <Button
          data-testid={`installed-plugin-restart-${pluginId}`}
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={onRestart}
          disabled={disabled}
        >
          {busy === 'restart' ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          Restart
        </Button>
      )}

      {status === 'enabled' || status === 'crashed' ? (
        <Button
          data-testid={`installed-plugin-disable-${pluginId}`}
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={onDisable}
          disabled={disabled}
        >
          {busy === 'disable' ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <Pause className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          Disable
        </Button>
      ) : null}

      {status === 'disabled' || status === 'installed' ? (
        <Button
          data-testid={`installed-plugin-enable-${pluginId}`}
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={onEnable}
          disabled={disabled}
        >
          {busy === 'enable' ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <Play className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          Enable
        </Button>
      ) : null}

      <Button
        data-testid={`installed-plugin-uninstall-${pluginId}`}
        variant="outline"
        size="sm"
        className="gap-1.5"
        onClick={onUninstall}
        disabled={disabled}
        aria-label="Uninstall"
      >
        {busy === 'uninstall' ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
        )}
        Uninstall
      </Button>
    </div>
  );
}
