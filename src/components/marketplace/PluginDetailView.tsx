/**
 * PluginDetailView — full-page (within Marketplace tab) plugin detail.
 *
 * Mirrors `TemplateDetailView` (Stream C1) in shape but adds two plugin-only
 * concerns: pre-install consent and lifecycle actions (Disable / Enable /
 * Restart) bound to the active `PluginManager`.
 *
 * State-aware action button:
 *   not-installed                       → [Install]
 *   installed-current and enabled       → [Disable] + [Uninstall]
 *   installed-current and disabled      → [Enable] + [Uninstall]
 *   installed-current and crashed       → [Restart] + [Disable] + [Uninstall]
 *   installed-current and updating      → spinner only, all actions disabled
 *   installed but update available      → [Update] + [Uninstall]
 *
 * Install flow (Group IV contract):
 *   1. Fetch the catalog manifest (manifest.json at `entry.manifestUrl`).
 *   2. Show the consent dialog with the manifest's permissions.
 *   3. On approve: call `service.install(id)` (download + verify + extract
 *      + index + audit `plugin_installed`), then register with the active
 *      PluginManager so the worker spawns and UI registrations land.
 *   4. On decline: bail. No FS work, no audit, surface a "Cancelled" outcome.
 *
 * Update flow: same as install but passes `isUpdate: true` + `fromVersion` so
 * the audit emitter records a `plugin_updated` event (or its current
 * fallback per Group I).
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  ArrowLeft,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  FileCode2,
  ImageOff,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Trash2,
  XCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type {
  CatalogEntry,
  InstalledEntry,
} from '@/types/marketplace';
import type {
  InstallPhase,
  MarketplaceService,
} from '@/modules/marketplace';
import type {
  PluginManifest,
  PluginStatus,
} from '@/types/plugin';
import { validatePluginManifest } from '@/modules/plugins/PluginManifestSchema';
import { getActivePluginManager } from '@/modules/plugins/pluginManagerHolder';
import {
  selectError,
  selectStatus,
  usePluginManagerStore,
} from '@/stores/pluginManagerStore';
import { PluginPermissionsList } from './PluginPermissionsList';
import { usePluginConsentDialog } from './PluginConsentDialog';

interface PluginDetailViewProps {
  entry: CatalogEntry;
  service: MarketplaceService;
  /** Already-installed entry, if any (drives the action-button state). */
  installed?: InstalledEntry | undefined;
  /** True when `installed.version` is older than `entry.version`. */
  updateAvailable?: boolean;
  /** Back arrow handler (returns to the catalog grid). */
  onBack: () => void;
  /** Called after a successful install/update so the parent can refresh state. */
  onInstalled?: (e: InstalledEntry) => void;
  /** Called after a successful uninstall. */
  onUninstalled?: (id: string) => void;
  /**
   * Called once the manifest is fetched so the parent (PluginsTab) can show
   * a permission-count badge on the catalog card without each card having
   * to fetch the manifest itself.
   */
  onManifestLoaded?: (id: string, permissionCount: number) => void;
}

interface ProgressState {
  phase: InstallPhase;
  pct: number;
}

interface OutcomeState {
  kind: 'success' | 'failure' | 'cancelled';
  message: string;
  detail?: string;
}

type BusyKind =
  | 'install'
  | 'update'
  | 'uninstall'
  | 'enable'
  | 'disable'
  | 'restart'
  | null;

const PHASE_LABEL: Record<InstallPhase, string> = {
  download: 'Downloading plugin',
  checksum: 'Verifying checksum',
  extract: 'Extracting files',
  validate: 'Validating manifest',
  audit: 'Recording audit entry',
};

export function PluginDetailView({
  entry,
  service,
  installed,
  updateAvailable = false,
  onBack,
  onInstalled,
  onUninstalled,
  onManifestLoaded,
}: PluginDetailViewProps) {
  const { t } = useTranslation();
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [outcome, setOutcome] = useState<OutcomeState | null>(null);
  const [busy, setBusy] = useState<BusyKind>(null);
  const [manifest, setManifest] = useState<PluginManifest | null>(null);
  const [files, setFiles] = useState<string[] | null>(null);

  // Live status pulled from the PluginManager's store. When the plugin isn't
  // tracked (not installed, or just before the manager catches up post-install)
  // we fall back to 'installed' which the action-button switch treats as a
  // dormant on-disk install.
  const status = usePluginManagerStore(selectStatus(entry.id));
  const lastError = usePluginManagerStore(selectError(entry.id));
  void lastError;

  const { confirm, dialog } = usePluginConsentDialog();

  // Fetch the plugin manifest once on mount (or when the entry changes).
  // We do it from `manifestUrl` rather than the on-disk install because:
  //   1. The detail view needs the manifest BEFORE install for consent.
  //   2. The shared MarketplaceService's `readInstalledManifest` validates
  //      against the template schema, not the plugin schema.
  useEffect(() => {
    let cancelled = false;
    setManifest(null);
    setFiles(null);
    void (async () => {
      try {
        const res = await fetch(entry.manifestUrl);
        if (!res.ok) return;
        const raw = (await res.json()) as unknown;
        const parsed = validatePluginManifest(raw);
        if (!parsed.ok || cancelled) return;
        setManifest(parsed.manifest);
        onManifestLoaded?.(entry.id, parsed.manifest.permissions.length);
      } catch {
        // Network or parse failure is non-fatal; the action button still
        // works (we'll re-fetch via the catalog inside the install path).
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [entry.id, entry.manifestUrl, onManifestLoaded]);

  // If installed, list the files in the install dir so users can audit what
  // landed on disk. We try the active PluginManager's installPath first
  // (more authoritative); fall back to nothing on failure.
  useEffect(() => {
    let cancelled = false;
    if (!installed) {
      setFiles(null);
      return;
    }
    void (async () => {
      const manager = getActivePluginManager();
      if (!manager) return;
      const instance = manager
        .listInstalled()
        .find((p) => p.manifest.id === entry.id);
      if (!instance) return;
      try {
        // The PluginManager exposes its FS backend indirectly via list();
        // we can't list files without an FS handle, so fall back to showing
        // just the manifest's `main` entry which is always present.
        if (!cancelled) setFiles([instance.manifest.main, 'manifest.json']);
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [entry.id, installed]);

  // ---------------------------------------------------------------------
  // Install + update
  // ---------------------------------------------------------------------

  const runInstall = useCallback(
    async (isUpdate: boolean) => {
      const busyKind: BusyKind = isUpdate ? 'update' : 'install';
      setBusy(busyKind);
      setOutcome(null);
      setProgress(null);

      // Step 1: ensure we have a manifest to show in consent. Re-fetch if the
      // first attempt failed silently.
      let liveManifest = manifest;
      if (!liveManifest) {
        try {
          const res = await fetch(entry.manifestUrl);
          if (res.ok) {
            const raw = (await res.json()) as unknown;
            const parsed = validatePluginManifest(raw);
            if (parsed.ok) {
              liveManifest = parsed.manifest;
              setManifest(parsed.manifest);
            }
          }
        } catch {
          // fall through; we'll fail with a friendly message below.
        }
      }
      if (!liveManifest) {
        setOutcome({
          kind: 'failure',
          message: 'Plugin manifest unavailable.',
          detail:
            'Could not load the plugin manifest. Check your connection and try again.',
        });
        setBusy(null);
        return;
      }

      // Step 2: consent.
      const approved = await confirm(liveManifest);
      if (!approved) {
        setOutcome({
          kind: 'cancelled',
          message: 'Install cancelled.',
          detail: 'No files were installed and no permissions were granted.',
        });
        setBusy(null);
        return;
      }

      // Step 3: download + verify + extract + index via the marketplace.
      setProgress({ phase: 'download', pct: 0 });
      try {
        const installOpts: Parameters<MarketplaceService['install']>[1] = {
          onProgress: (phase, pct) => {
            setProgress({ phase, pct });
          },
        };
        if (isUpdate && installed) {
          installOpts.isUpdate = true;
          installOpts.fromVersion = installed.version;
        }
        const result = await service.install(entry.id, installOpts);
        setProgress({ phase: 'audit', pct: 100 });

        // Step 4: hand off to the PluginManager so the worker spawns and UI
        // registrations (toolbar buttons, sidebar panels, commands) land.
        // Consent already happened, so the manager's onConsent is short-circuited.
        const manager = getActivePluginManager();
        if (manager) {
          try {
            await manager.installFromTarball(result.installedPath, {
              onConsent: () => Promise.resolve(true),
            });
          } catch (mgrErr) {
            // The marketplace install succeeded (files on disk + audit logged)
            // but the manager couldn't register the plugin. Surface a partial
            // failure so the user knows Restart / Reload is needed.
            setOutcome({
              kind: 'failure',
              message: 'Installed but failed to load.',
              detail:
                mgrErr instanceof Error ? mgrErr.message : String(mgrErr),
            });
            setBusy(null);
            return;
          }
        }

        setOutcome({
          kind: 'success',
          message: isUpdate
            ? `Updated ${entry.name} to v${entry.version}.`
            : `Installed ${entry.name}.`,
          detail: 'A record of this install was added to your audit log.',
        });
        onInstalled?.(result);
      } catch (err) {
        const mapped = mapInstallError(err);
        setOutcome({
          kind: 'failure',
          message: mapped.headline,
          detail: mapped.detail,
        });
        setProgress(null);
      } finally {
        setBusy(null);
      }
    },
    [
      confirm,
      entry.id,
      entry.manifestUrl,
      entry.name,
      entry.version,
      installed,
      manifest,
      onInstalled,
      service,
    ],
  );

  const handleInstall = useCallback(() => {
    void runInstall(false);
  }, [runInstall]);

  const handleUpdate = useCallback(() => {
    void runInstall(true);
  }, [runInstall]);

  // ---------------------------------------------------------------------
  // Lifecycle actions (Disable / Enable / Uninstall / Restart)
  // ---------------------------------------------------------------------

  const handleUninstall = useCallback(async () => {
    setBusy('uninstall');
    setOutcome(null);
    try {
      // Tear down the worker first so the FS delete doesn't race with an
      // in-flight write from the plugin's deactivate hook.
      const manager = getActivePluginManager();
      if (manager) {
        try {
          await manager.uninstall(entry.id);
        } catch {
          // The manager teardown is best-effort; the marketplace uninstall
          // is what users see in the Installed list.
        }
      }
      await service.uninstall(entry.id);
      setOutcome({
        kind: 'success',
        message: `Uninstalled ${entry.name}.`,
        detail: 'The plugin was removed from your workspace.',
      });
      onUninstalled?.(entry.id);
    } catch (err) {
      setOutcome({
        kind: 'failure',
        message: 'Uninstall failed.',
        detail: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(null);
    }
  }, [entry.id, entry.name, onUninstalled, service]);

  const handleEnable = useCallback(async () => {
    const manager = getActivePluginManager();
    if (!manager) return;
    setBusy('enable');
    setOutcome(null);
    try {
      await manager.enable(entry.id);
      setOutcome({
        kind: 'success',
        message: `Enabled ${entry.name}.`,
      });
    } catch (err) {
      setOutcome({
        kind: 'failure',
        message: 'Enable failed.',
        detail: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(null);
    }
  }, [entry.id, entry.name]);

  const handleDisable = useCallback(async () => {
    const manager = getActivePluginManager();
    if (!manager) return;
    setBusy('disable');
    setOutcome(null);
    try {
      await manager.disable(entry.id);
      setOutcome({
        kind: 'success',
        message: `Disabled ${entry.name}.`,
      });
    } catch (err) {
      setOutcome({
        kind: 'failure',
        message: 'Disable failed.',
        detail: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(null);
    }
  }, [entry.id, entry.name]);

  const handleRestart = useCallback(async () => {
    const manager = getActivePluginManager();
    if (!manager) return;
    setBusy('restart');
    setOutcome(null);
    try {
      await manager.restart(entry.id);
      setOutcome({
        kind: 'success',
        message: `Restarted ${entry.name}.`,
      });
    } catch (err) {
      setOutcome({
        kind: 'failure',
        message: 'Restart failed.',
        detail: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(null);
    }
  }, [entry.id, entry.name]);

  const handleViewAuditLog = useCallback(() => {
    window.dispatchEvent(
      new CustomEvent('projelli:open-audit-log', {
        detail: { source: 'marketplace', pluginId: entry.id },
      }),
    );
  }, [entry.id]);

  // The status to use for action-button selection. When not installed at all,
  // fall back to a synthetic 'not-installed' kind handled by ActionButtons.
  const effectiveStatus: PluginStatus | 'not-installed' = installed
    ? status
    : 'not-installed';

  return (
    <div className="space-y-4" data-testid="plugin-detail-view">
      {dialog}

      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
          data-testid="plugin-detail-back"
          className="gap-1.5 -ml-2"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          {t('marketplace.detail.back-to-catalog')}
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
        {/* Left: media + description + permissions + files */}
        <div className="space-y-4 min-w-0">
          <ScreenshotCarousel screenshots={entry.screenshots ?? []} />

          <div>
            <h2
              data-testid="plugin-detail-name"
              className="text-2xl font-semibold tracking-tight"
            >
              {entry.name}
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              v{entry.version} by {entry.author.name} {' '}
              <span className="text-muted-foreground/60">
                · {entry.category}
              </span>
            </p>
          </div>

          <p
            data-testid="plugin-detail-description"
            className="text-sm leading-relaxed whitespace-pre-line"
          >
            {entry.description}
          </p>

          {entry.tags.length > 0 && (
            <div
              className="flex flex-wrap gap-1.5"
              data-testid="plugin-detail-tags"
            >
              {entry.tags.map((tag) => (
                <span
                  key={tag}
                  className="text-xs rounded-full border px-2 py-0.5 text-muted-foreground"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}

          <div data-testid="plugin-detail-permissions">
            <h3 className="text-sm font-medium mb-2">Required permissions</h3>
            {manifest ? (
              <PluginPermissionsList permissions={manifest.permissions} />
            ) : (
              <div
                data-testid="plugin-detail-permissions-loading"
                className="rounded-md border border-dashed p-3 text-sm text-muted-foreground"
              >
                Loading permissions...
              </div>
            )}
          </div>

          {files && files.length > 0 && (
            <Card>
              <CardContent className="p-4">
                <h3 className="text-sm font-medium mb-2 flex items-center gap-2">
                  <FileCode2 className="h-4 w-4" aria-hidden="true" />
                  {t('marketplace.detail.files-in-plugin')}
                </h3>
                <ul
                  data-testid="plugin-detail-files"
                  className="text-xs text-muted-foreground space-y-1 font-mono"
                >
                  {files.map((path) => (
                    <li key={path} className="truncate">
                      {path}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right: action sidebar */}
        <aside className="space-y-4">
          <Card>
            <CardContent className="p-4 space-y-3">
              <div>
                <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
                  Author
                </div>
                <div
                  data-testid="plugin-detail-author"
                  className="text-sm font-medium"
                >
                  {entry.author.name}
                </div>
                {entry.author.githubUser && (
                  <a
                    data-testid="plugin-detail-github-link"
                    href={`https://github.com/${entry.author.githubUser}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-muted-foreground hover:underline inline-flex items-center gap-1 mt-0.5"
                  >
                    @{entry.author.githubUser}
                    <ExternalLink
                      className="h-3 w-3"
                      aria-hidden="true"
                    />
                  </a>
                )}
              </div>

              <div className="border-t pt-3 space-y-2">
                <ActionButtons
                  status={effectiveStatus}
                  updateAvailable={updateAvailable}
                  busy={busy}
                  onInstall={handleInstall}
                  onUpdate={handleUpdate}
                  onUninstall={() => {
                    void handleUninstall();
                  }}
                  onEnable={() => {
                    void handleEnable();
                  }}
                  onDisable={() => {
                    void handleDisable();
                  }}
                  onRestart={() => {
                    void handleRestart();
                  }}
                />
              </div>
            </CardContent>
          </Card>

          {progress && <ProgressPanel progress={progress} />}

          {outcome && (
            <OutcomePanel
              outcome={outcome}
              {...(outcome.kind === 'success'
                ? { onViewAuditLog: handleViewAuditLog }
                : {})}
              {...(outcome.kind === 'failure' && busy === null
                ? { onRetry: handleInstall }
                : {})}
              onDismiss={() => setOutcome(null)}
            />
          )}
        </aside>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Action buttons (state-aware)
// ---------------------------------------------------------------------------

interface ActionButtonsProps {
  status: PluginStatus | 'not-installed';
  updateAvailable: boolean;
  busy: BusyKind;
  onInstall: () => void;
  onUpdate: () => void;
  onUninstall: () => void;
  onEnable: () => void;
  onDisable: () => void;
  onRestart: () => void;
}

function ActionButtons({
  status,
  updateAvailable,
  busy,
  onInstall,
  onUpdate,
  onUninstall,
  onEnable,
  onDisable,
  onRestart,
}: ActionButtonsProps) {
  const disabled = busy !== null;

  if (status === 'not-installed') {
    return (
      <Button
        data-testid="plugin-detail-install"
        className="w-full gap-1.5"
        onClick={onInstall}
        disabled={disabled}
      >
        {busy === 'install' ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <Download className="h-4 w-4" aria-hidden="true" />
        )}
        {busy === 'install' ? 'Installing...' : 'Install'}
      </Button>
    );
  }

  if (status === 'updating') {
    return (
      <Button
        data-testid="plugin-detail-updating"
        className="w-full gap-1.5"
        disabled
      >
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        Updating...
      </Button>
    );
  }

  if (updateAvailable) {
    return (
      <div className="space-y-2">
        <Button
          data-testid="plugin-detail-update"
          className="w-full gap-1.5"
          onClick={onUpdate}
          disabled={disabled}
        >
          {busy === 'update' ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
          )}
          {busy === 'update' ? 'Updating...' : 'Update'}
        </Button>
        <UninstallButton busy={busy} onUninstall={onUninstall} />
      </div>
    );
  }

  if (status === 'crashed') {
    return (
      <div className="space-y-2">
        <Button
          data-testid="plugin-detail-restart"
          className="w-full gap-1.5"
          onClick={onRestart}
          disabled={disabled}
        >
          {busy === 'restart' ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
          )}
          {busy === 'restart' ? 'Restarting...' : 'Restart'}
        </Button>
        <Button
          data-testid="plugin-detail-disable"
          variant="outline"
          className="w-full gap-1.5"
          onClick={onDisable}
          disabled={disabled}
        >
          {busy === 'disable' ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Pause className="h-4 w-4" aria-hidden="true" />
          )}
          {busy === 'disable' ? 'Disabling...' : 'Disable'}
        </Button>
        <UninstallButton busy={busy} onUninstall={onUninstall} />
      </div>
    );
  }

  if (status === 'disabled') {
    return (
      <div className="space-y-2">
        <Button
          data-testid="plugin-detail-enable"
          className="w-full gap-1.5"
          onClick={onEnable}
          disabled={disabled}
        >
          {busy === 'enable' ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Play className="h-4 w-4" aria-hidden="true" />
          )}
          {busy === 'enable' ? 'Enabling...' : 'Enable'}
        </Button>
        <UninstallButton busy={busy} onUninstall={onUninstall} />
      </div>
    );
  }

  // status === 'enabled' or 'installed' (dormant on-disk install)
  return (
    <div className="space-y-2">
      <Button
        data-testid="plugin-detail-disable"
        variant="outline"
        className="w-full gap-1.5"
        onClick={onDisable}
        disabled={disabled}
      >
        {busy === 'disable' ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <Pause className="h-4 w-4" aria-hidden="true" />
        )}
        {busy === 'disable' ? 'Disabling...' : 'Disable'}
      </Button>
      <UninstallButton busy={busy} onUninstall={onUninstall} />
    </div>
  );
}

function UninstallButton({
  busy,
  onUninstall,
}: {
  busy: BusyKind;
  onUninstall: () => void;
}) {
  return (
    <Button
      data-testid="plugin-detail-uninstall"
      variant="outline"
      className="w-full gap-1.5"
      onClick={onUninstall}
      disabled={busy !== null}
    >
      {busy === 'uninstall' ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      ) : (
        <Trash2 className="h-4 w-4" aria-hidden="true" />
      )}
      {busy === 'uninstall' ? 'Uninstalling...' : 'Uninstall'}
    </Button>
  );
}

// ---------------------------------------------------------------------------
// Progress + outcome panels
// ---------------------------------------------------------------------------

function ProgressPanel({ progress }: { progress: ProgressState }) {
  return (
    <Card data-testid="plugin-detail-progress" data-phase={progress.phase}>
      <CardContent className="p-4 space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className="font-medium">{PHASE_LABEL[progress.phase]}</span>
          <span className="text-muted-foreground tabular-nums">
            {progress.pct}%
          </span>
        </div>
        <div
          className="h-1.5 w-full rounded-full bg-muted overflow-hidden"
          role="progressbar"
          aria-valuenow={progress.pct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            data-testid="plugin-detail-progress-bar"
            className="h-full bg-primary transition-[width] duration-200"
            style={{ width: `${Math.max(0, Math.min(100, progress.pct))}%` }}
          />
        </div>
      </CardContent>
    </Card>
  );
}

interface OutcomePanelProps {
  outcome: OutcomeState;
  onViewAuditLog?: () => void;
  onRetry?: () => void;
  onDismiss?: () => void;
}

function OutcomePanel({
  outcome,
  onViewAuditLog,
  onRetry,
  onDismiss,
}: OutcomePanelProps) {
  const { t } = useTranslation();
  const isSuccess = outcome.kind === 'success';
  const isFailure = outcome.kind === 'failure';
  const Icon = isSuccess ? CheckCircle2 : XCircle;

  const testId =
    outcome.kind === 'success'
      ? 'plugin-detail-outcome-success'
      : outcome.kind === 'failure'
        ? 'plugin-detail-outcome-failure'
        : 'plugin-detail-outcome-cancelled';

  return (
    <Card
      data-testid={testId}
      data-status={outcome.kind}
      role="status"
      aria-live="polite"
      className={cn(
        'border',
        isSuccess
          ? 'border-green-500/40 bg-green-500/10'
          : isFailure
            ? 'border-destructive/40 bg-destructive/10'
            : 'border-muted bg-muted/40',
      )}
    >
      <CardContent className="p-4 flex gap-3">
        <Icon
          className={cn(
            'h-5 w-5 shrink-0 mt-0.5',
            isSuccess
              ? 'text-green-600 dark:text-green-400'
              : isFailure
                ? 'text-destructive'
                : 'text-muted-foreground',
          )}
          aria-hidden="true"
        />
        <div className="flex-1 min-w-0 space-y-2">
          <div>
            <div className="text-sm font-medium">{outcome.message}</div>
            {outcome.detail && (
              <div className="text-xs text-muted-foreground mt-0.5">
                {outcome.detail}
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {onViewAuditLog && (
              <Button
                data-testid="plugin-detail-view-audit-log"
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={onViewAuditLog}
              >
                {t('marketplace.detail.view-audit-log')}
              </Button>
            )}
            {onRetry && (
              <Button
                data-testid="plugin-detail-retry"
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={onRetry}
              >
                Retry
              </Button>
            )}
            {onDismiss && (
              <Button
                data-testid="plugin-detail-outcome-dismiss"
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                onClick={onDismiss}
              >
                Dismiss
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Screenshot carousel (mirrors TemplateDetailView; stays inline for now since
// the surface area is small and the two views diverge on every other axis).
// ---------------------------------------------------------------------------

interface ScreenshotCarouselProps {
  screenshots: string[];
}

function ScreenshotCarousel({ screenshots }: ScreenshotCarouselProps) {
  const [index, setIndex] = useState(0);
  const total = screenshots.length;

  if (total === 0) {
    return (
      <div
        data-testid="plugin-detail-carousel-empty"
        className="aspect-video w-full bg-muted rounded-lg flex items-center justify-center"
      >
        <ImageOff
          className="h-10 w-10 text-muted-foreground/50"
          aria-hidden="true"
        />
      </div>
    );
  }

  const handlePrev = () => setIndex((i) => (i - 1 + total) % total);
  const handleNext = () => setIndex((i) => (i + 1) % total);

  const current = screenshots[index];

  return (
    <div
      data-testid="plugin-detail-carousel"
      className="relative aspect-video w-full bg-muted rounded-lg overflow-hidden group"
    >
      {current && (
        <img
          src={current}
          alt={`Screenshot ${(index + 1).toString()} of ${total.toString()}`}
          className="h-full w-full object-cover"
        />
      )}

      {total > 1 && (
        <>
          <button
            type="button"
            data-testid="plugin-detail-carousel-prev"
            onClick={handlePrev}
            className="absolute left-2 top-1/2 -translate-y-1/2 h-8 w-8 rounded-full bg-background/80 backdrop-blur-sm border flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity focus:opacity-100"
            aria-label="Previous screenshot"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            data-testid="plugin-detail-carousel-next"
            onClick={handleNext}
            className="absolute right-2 top-1/2 -translate-y-1/2 h-8 w-8 rounded-full bg-background/80 backdrop-blur-sm border flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity focus:opacity-100"
            aria-label="Next screenshot"
          >
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
          <div
            data-testid="plugin-detail-carousel-dots"
            className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1.5"
          >
            {screenshots.map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setIndex(i)}
                aria-label={`Go to screenshot ${(i + 1).toString()}`}
                className={cn(
                  'h-1.5 rounded-full transition-all',
                  i === index ? 'w-6 bg-foreground' : 'w-1.5 bg-foreground/40',
                )}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Error mapping (same categories as templates; copy adjusted for plugins).
// ---------------------------------------------------------------------------

interface MappedError {
  headline: string;
  detail: string;
}

function mapInstallError(err: unknown): MappedError {
  const raw = err instanceof Error ? err.message : String(err);
  const lower = raw.toLowerCase();

  if (lower.includes('not found in catalog')) {
    return {
      headline: 'Plugin not found.',
      detail:
        'The catalog entry for this plugin no longer exists. Try refreshing the catalog.',
    };
  }
  if (lower.includes('checksum mismatch') || lower.includes('checksum')) {
    return {
      headline: 'Tarball corrupt.',
      detail:
        'The downloaded file failed integrity verification. The publisher may have republished, or the network connection dropped. Try again.',
    };
  }
  if (lower.includes('manifest invalid') || lower.includes('manifest')) {
    return {
      headline: 'Manifest invalid.',
      detail:
        'The plugin package is missing required fields or has an unsupported format. Contact the plugin author.',
    };
  }
  if (
    lower.includes('failed to fetch') ||
    lower.includes('http ') ||
    lower.includes('network') ||
    lower.includes('econnrefused') ||
    lower.includes('enotfound')
  ) {
    return {
      headline: 'Catalog unreachable.',
      detail:
        'Could not reach the plugins catalog. Check your internet connection and try again.',
    };
  }
  if (lower.includes('aborted') || lower.includes('abort')) {
    return {
      headline: 'Install cancelled.',
      detail: 'The install was stopped before it finished.',
    };
  }
  return {
    headline: 'Install failed.',
    detail: raw,
  };
}
