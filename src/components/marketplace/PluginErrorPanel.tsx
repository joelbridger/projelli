/**
 * PluginErrorPanel — surfaces a crashed plugin's error message + the last 50
 * relevant audit log lines, with [Restart] and [Disable] actions.
 *
 * Designed to render inline beneath an InstalledPluginsList row, but also
 * usable standalone (e.g. from a future Settings → Plugins detail view).
 *
 * Audit log filtering: AuditService doesn't expose a per-plugin filter today.
 * We read recent entries via `query({ limit: 200 })` and match in JS on either
 * `metadata.id` or `metadata.pluginId` (depending on which audit event variant
 * the entry came from). This keeps the panel cheap on large logs.
 *
 * Caller may inject an explicit `auditService`; otherwise we fall back to a
 * tiny `'plugins'`-scoped service which mirrors what `PluginManager` writes to.
 */

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { AlertTriangle, Loader2, Pause, RotateCcw } from 'lucide-react';
import { AuditService } from '@/modules/audit/AuditService';
import { getActivePluginManager } from '@/modules/plugins/pluginManagerHolder';
import {
  selectError,
  usePluginManagerStore,
} from '@/stores/pluginManagerStore';
import type { AuditEntry } from '@/types/audit';

const MAX_LOG_LINES = 50;
const AUDIT_QUERY_LIMIT = 200;

export interface PluginErrorPanelProps {
  pluginId: string;
  /**
   * Inject an audit service for tests. Defaults to a `'plugins'`-scoped
   * AuditService matching what PluginManager writes to.
   */
  auditService?: AuditService;
}

type ActionKind = 'restart' | 'disable' | null;

export function PluginErrorPanel({
  pluginId,
  auditService,
}: PluginErrorPanelProps) {
  const { t } = useTranslation();
  const error = usePluginManagerStore(selectError(pluginId));
  const [busy, setBusy] = useState<ActionKind>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [logEntries, setLogEntries] = useState<AuditEntry[]>([]);

  // Default audit service is 'plugins'-scoped so it reads the same store
  // PluginManager writes to. Memoized to avoid re-instantiating per render.
  const audit = useMemo(
    () => auditService ?? new AuditService('plugins'),
    [auditService],
  );

  // Re-read the audit log whenever the plugin's error state changes (a crash
  // or restart will append entries). Cheap: we cap at 200 entries and filter
  // in JS.
  useEffect(() => {
    const recent = audit.query({ limit: AUDIT_QUERY_LIMIT });
    const filtered = recent.filter((e) => {
      const meta = e.metadata as { id?: unknown; pluginId?: unknown };
      return meta.id === pluginId || meta.pluginId === pluginId;
    });
    // query() returns most-recent-first; preserve that order, take the most
    // recent 50 lines.
    setLogEntries(filtered.slice(0, MAX_LOG_LINES));
  }, [audit, error, pluginId]);

  const handleRestart = async () => {
    const manager = getActivePluginManager();
    if (!manager) return;
    setBusy('restart');
    setActionError(null);
    try {
      await manager.restart(pluginId);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Restart failed.');
    } finally {
      setBusy(null);
    }
  };

  const handleDisable = async () => {
    const manager = getActivePluginManager();
    if (!manager) return;
    setBusy('disable');
    setActionError(null);
    try {
      await manager.disable(pluginId);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Disable failed.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div
      data-testid={`plugin-error-panel-${pluginId}`}
      className="rounded-md border border-destructive/40 bg-destructive/5 p-3 space-y-2"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle
          className="h-4 w-4 text-destructive shrink-0 mt-0.5"
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium text-destructive">
            Plugin error
          </div>
          <div
            data-testid={`plugin-error-message-${pluginId}`}
            className="text-xs text-destructive/90 mt-0.5 break-words"
          >
            {error ?? 'This plugin crashed. Restart to retry, or disable it.'}
          </div>
          {actionError && (
            <div
              data-testid={`plugin-error-action-error-${pluginId}`}
              className="text-xs text-destructive mt-1"
            >
              {actionError}
            </div>
          )}
        </div>
      </div>

      {logEntries.length > 0 && (
        <details
          data-testid={`plugin-error-log-${pluginId}`}
          className="text-xs"
        >
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground select-none">
            {t('marketplace.plugin-error.show-recent-log', { count: logEntries.length })}
          </summary>
          <ul
            data-testid={`plugin-error-log-list-${pluginId}`}
            className="mt-2 space-y-1 font-mono text-[11px] max-h-48 overflow-y-auto"
          >
            {logEntries.map((entry) => (
              <li
                key={entry.id}
                data-testid={`plugin-error-log-entry-${entry.id}`}
                className="text-muted-foreground break-all"
              >
                <span className="text-muted-foreground/70">
                  {formatTime(entry.timestamp)}
                </span>{' '}
                <span className="text-foreground">{entry.action}</span>
                {entry.description && entry.description !== entry.action && (
                  <span className="text-muted-foreground">
                    {' '}
                    {entry.description}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="flex items-center gap-1.5">
        <Button
          data-testid={`plugin-error-restart-${pluginId}`}
          variant="outline"
          size="sm"
          className="gap-1.5 h-7 text-xs"
          onClick={() => {
            void handleRestart();
          }}
          disabled={busy !== null}
        >
          {busy === 'restart' ? (
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
          ) : (
            <RotateCcw className="h-3 w-3" aria-hidden="true" />
          )}
          Restart
        </Button>
        <Button
          data-testid={`plugin-error-disable-${pluginId}`}
          variant="outline"
          size="sm"
          className="gap-1.5 h-7 text-xs"
          onClick={() => {
            void handleDisable();
          }}
          disabled={busy !== null}
        >
          {busy === 'disable' ? (
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
          ) : (
            <Pause className="h-3 w-3" aria-hidden="true" />
          )}
          Disable
        </Button>
      </div>
    </div>
  );
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return iso;
  }
}
