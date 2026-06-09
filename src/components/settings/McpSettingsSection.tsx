/**
 * MCP Settings Section (M4, v1.5 Flag 2).
 *
 * Shown under Settings → Integrations. Three UI blocks:
 *
 *   1. Status pill — "Ready to install in Claude Desktop" when the bundled
 *      `.mcpb` is on disk, "Bundle not available" in dev builds.
 *   2. Download button — writes the platform `.mcpb` into the user's
 *      Downloads folder via the Tauri dialog plugin, then shows a toast.
 *      The button falls back to "Copy path" when the Downloads folder
 *      isn't writable (hardened Mac sandboxes).
 *   3. Install instructions — a short readme pointing at Claude Desktop.
 *
 * Approval-modal wiring lives separately in `McpApprovalModal.tsx` — this
 * component is read-only so it can be unit-tested without spinning up the
 * polling loop.
 */

import { useEffect, useState, useCallback } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Download, CheckCircle2, AlertCircle, ExternalLink, ShieldOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { mcpBundlePath } from '@/utils/tauri-commands';
import { usePrivilegedMatterModeActive } from '@/hooks/usePrivilegedMatterMode';

export interface McpSettingsSectionProps {
  /** Test hook — override the bundle-path lookup so tests don't have to
   *  stub the global `invoke`. When omitted, calls `mcpBundlePath()`. */
  onResolveBundlePath?: () => Promise<string | null>;
  /** Test hook — invoked when the user clicks Download. Receives the
   *  resolved bundle path. Default implementation opens the OS
   *  file-picker dialog via `@tauri-apps/plugin-dialog`. */
  onDownload?: (bundlePath: string) => Promise<void>;
  /** Override Privileged Matter Mode (tests / surfaces that already hold it).
   *  When omitted the live hook value is used. */
  privilegedMatterMode?: boolean;
}

export function McpSettingsSection({
  onResolveBundlePath,
  onDownload,
  privilegedMatterMode,
}: McpSettingsSectionProps): React.ReactElement {
  const { t } = useTranslation();
  const hookPrivileged = usePrivilegedMatterModeActive();
  const privileged = privilegedMatterMode ?? hookPrivileged;
  const [bundlePath, setBundlePath] = useState<string | null | undefined>(
    undefined,
  );
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const resolve = useCallback(async () => {
    const path = onResolveBundlePath
      ? await onResolveBundlePath()
      : await mcpBundlePath();
    setBundlePath(path);
  }, [onResolveBundlePath]);

  useEffect(() => {
    void resolve();
  }, [resolve]);

  const handleDownload = useCallback(async () => {
    if (!bundlePath) return;
    setStatus(null);
    setError(null);
    try {
      if (onDownload) {
        await onDownload(bundlePath);
      } else {
        // Default: surface the path + copy it to the clipboard. The user
        // can then drag-drop into Claude Desktop, which is the actual
        // install gesture. We deliberately avoid auto-opening the file
        // because Claude Desktop may not be installed yet.
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(bundlePath);
        }
      }
      setStatus(t('settings.mcp.copied-status', { path: bundlePath }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [bundlePath, onDownload]);

  const loading = bundlePath === undefined;
  const hasBundle = !!bundlePath;

  return (
    <div
      data-testid="mcp-settings-section"
      data-privileged-disabled={privileged ? 'true' : 'false'}
      className="space-y-4"
    >
      <div>
        <h3 className="text-base font-semibold">{t('settings.mcp.title')}</h3>
        <p className="text-xs text-muted-foreground mt-1">
          {t('settings.mcp.description')}
        </p>
      </div>

      {privileged && (
        <div
          data-testid="mcp-privileged-disabled"
          className="flex items-start gap-2 rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-900 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200"
        >
          <ShieldOff className="h-4 w-4 mt-0.5 shrink-0" aria-hidden />
          <span>
            <span className="font-semibold">{t('settings.mcp.disabled-title')}</span>{' '}
            {t('settings.mcp.disabled-body')}
          </span>
        </div>
      )}

      <div
        className={cn(privileged && 'opacity-50 pointer-events-none select-none')}
        aria-disabled={privileged}
      >
      <div
        data-testid="mcp-server-status"
        data-status={
          loading ? 'loading' : hasBundle ? 'ready' : 'unavailable'
        }
        className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/20 px-3 py-2"
      >
        {loading ? (
          <>
            <AlertCircle className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="text-sm text-muted-foreground">
              {t('settings.mcp.status.loading')}
            </span>
          </>
        ) : hasBundle ? (
          <>
            <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
            <span className="text-sm">
              {t('settings.mcp.status.ready')}
            </span>
          </>
        ) : (
          <>
            <AlertCircle className="h-4 w-4 text-amber-500 shrink-0" />
            <span className="text-sm">
              <Trans
                i18nKey="settings.mcp.status.unavailable"
                components={{
                  cmd: (
                    <code className="px-1 py-0.5 rounded bg-muted font-mono text-[11px]" />
                  ),
                }}
              />
            </span>
          </>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Button
          data-testid="mcp-download-mcpb"
          onClick={() => {
            void handleDownload();
          }}
          disabled={!hasBundle}
          variant="default"
          size="sm"
          className="gap-1.5 text-xs"
        >
          <Download className="h-3.5 w-3.5" />
          {t('settings.mcp.download-cta')}
        </Button>
        <a
          href="https://modelcontextprotocol.io/quickstart/user"
          target="_blank"
          rel="noreferrer"
          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
        >
          {t('settings.mcp.whats-mcp')} <ExternalLink className="h-3 w-3" />
        </a>
      </div>

      {status && (
        <div
          data-testid="mcp-download-status"
          className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-600 dark:text-emerald-400"
        >
          {status}
        </div>
      )}
      {error && (
        <div
          data-testid="mcp-download-error"
          className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
        >
          {error}
        </div>
      )}

      <div className="rounded-md border border-border/60 p-3 text-xs leading-relaxed text-muted-foreground space-y-2">
        <p className="font-medium text-foreground">{t('settings.mcp.install.heading')}</p>
        <ol className="list-decimal list-inside space-y-1">
          <li>
            <Trans
              i18nKey="settings.mcp.install.step-download"
              components={{ b: <strong /> }}
            />
          </li>
          <li>{t('settings.mcp.install.step-open-claude')}</li>
          <li>
            <Trans
              i18nKey="settings.mcp.install.step-config"
              components={{ b: <strong />, c: <code /> }}
            />
          </li>
          <li>
            {t('settings.mcp.install.step-pick-folder')}
          </li>
        </ol>
        <p className="pt-1">
          {t('settings.mcp.install.after-install')}
        </p>
      </div>
      </div>
    </div>
  );
}

export default McpSettingsSection;
