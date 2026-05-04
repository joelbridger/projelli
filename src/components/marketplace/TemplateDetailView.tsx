/**
 * TemplateDetailView — full-page (within Marketplace tab) template detail.
 *
 * Renders the catalog entry's full description, a screenshot carousel
 * (in-house, no extra dep), version + author, file list pulled from the
 * installed manifest (if installed), and a state-aware action button.
 *
 * Action button states:
 *   not-installed         → [Install]
 *   installed-current     → [Uninstall]
 *   installed-stale       → [Update] + secondary [Uninstall]
 *
 * Install progress is wired to `service.install`'s `onProgress` callback.
 * Each phase (`download`, `checksum`, `extract`, `validate`, `audit`) renders
 * a label + a percent bar. On success/failure we show an inline status panel
 * (success copy includes a "View in Audit Log" affordance that dispatches a
 * window event for App.tsx to optionally surface).
 *
 * Failure copy is mapped from the service error message to actionable text.
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
  ImageOff,
  Loader2,
  RefreshCw,
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
import type { TemplateManifest, TemplateFileEntry } from '@/types/templateManifest';
import { validateTemplateManifest } from '@/modules/marketplace';

interface TemplateDetailViewProps {
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
  /** Called after a successful uninstall (Group VII wires the real action). */
  onUninstalled?: (id: string) => void;
}

interface ProgressState {
  phase: InstallPhase;
  pct: number;
}

interface OutcomeState {
  kind: 'success' | 'failure';
  message: string;
  /** Optional sub-line: detail or instruction. */
  detail?: string;
}

const PHASE_LABEL: Record<InstallPhase, string> = {
  download: 'Downloading template',
  checksum: 'Verifying checksum',
  extract: 'Extracting files',
  validate: 'Validating manifest',
  audit: 'Recording audit entry',
};

export function TemplateDetailView({
  entry,
  service,
  installed,
  updateAvailable = false,
  onBack,
  onInstalled,
  onUninstalled,
}: TemplateDetailViewProps) {
  const { t } = useTranslation();
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [outcome, setOutcome] = useState<OutcomeState | null>(null);
  const [busy, setBusy] = useState<'install' | 'uninstall' | null>(null);
  const [manifest, setManifest] = useState<TemplateManifest | null>(null);

  // If the template is installed, attempt to read its manifest via the
  // service so we can show the file list. We tolerate a missing/invalid
  // manifest because installed templates from older flows might predate the
  // validator — `readInstalledManifest` returns null in that case.
  useEffect(() => {
    let cancelled = false;
    if (!installed) {
      setManifest(null);
      return;
    }
    void (async () => {
      try {
        const m = await service.readInstalledManifest(installed.id);
        if (!cancelled) setManifest(m);
      } catch {
        if (!cancelled) setManifest(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [installed, service]);

  const handleInstall = useCallback(async () => {
    setBusy('install');
    setOutcome(null);
    setProgress({ phase: 'download', pct: 0 });
    try {
      // Group VIII: when re-running an install on top of an existing version,
      // flag the call so MarketplaceService emits `template_updated` (carrying
      // fromVersion + toVersion) instead of the generic install audit event.
      const installOpts: Parameters<MarketplaceService['install']>[1] = {
        onProgress: (phase, pct) => {
          setProgress({ phase, pct });
        },
      };
      if (updateAvailable && installed) {
        installOpts.isUpdate = true;
        installOpts.fromVersion = installed.version;
      }
      const result = await service.install(entry.id, installOpts);
      setProgress({ phase: 'audit', pct: 100 });
      setOutcome({
        kind: 'success',
        message: updateAvailable
          ? `Updated ${entry.name} to v${entry.version}.`
          : `Installed ${entry.name}.`,
        detail: 'A record of this install was added to your audit log.',
      });
      onInstalled?.(result);
    } catch (err) {
      const mapped = mapInstallError(err);
      setOutcome({ kind: 'failure', message: mapped.headline, detail: mapped.detail });
      setProgress(null);
    } finally {
      setBusy(null);
    }
  }, [entry.id, entry.name, entry.version, installed, onInstalled, service, updateAvailable]);

  const handleUninstall = useCallback(async () => {
    setBusy('uninstall');
    setOutcome(null);
    try {
      await service.uninstall(entry.id);
      setOutcome({
        kind: 'success',
        message: `Uninstalled ${entry.name}.`,
        detail: 'The template was removed from your workspace.',
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

  const handleViewAuditLog = useCallback(() => {
    // Fire a window-level event so the App shell (which owns the AuditLog
    // panel) can optionally focus / open it. No-op if no listener is wired.
    window.dispatchEvent(
      new CustomEvent('projelli:open-audit-log', {
        detail: { source: 'marketplace', templateId: entry.id },
      }),
    );
  }, [entry.id]);

  // Validate any embedded files list from the catalog entry's manifestUrl is
  // out of scope — we only show files if we already have a parsed manifest.
  const fileList: TemplateFileEntry[] = manifest?.files ?? [];
  void validateTemplateManifest;

  return (
    <div className="space-y-4" data-testid="template-detail-view">
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
          data-testid="template-detail-back"
          className="gap-1.5 -ml-2"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          {t('marketplace.detail.back-to-catalog')}
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
        {/* Left: media + description + files */}
        <div className="space-y-4 min-w-0">
          <ScreenshotCarousel screenshots={entry.screenshots ?? []} />

          <div>
            <h2
              data-testid="template-detail-name"
              className="text-2xl font-semibold tracking-tight"
            >
              {entry.name}
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              v{entry.version} · {entry.category}
            </p>
          </div>

          <p
            data-testid="template-detail-description"
            className="text-sm leading-relaxed whitespace-pre-line"
          >
            {entry.description}
          </p>

          {entry.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5" data-testid="template-detail-tags">
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

          {fileList.length > 0 && (
            <Card>
              <CardContent className="p-4">
                <h3 className="text-sm font-medium mb-2">{t('marketplace.detail.files-in-template')}</h3>
                <ul
                  data-testid="template-detail-files"
                  className="text-xs text-muted-foreground space-y-1 font-mono"
                >
                  {fileList.map((f) => (
                    <li key={f.path} className="flex items-center justify-between gap-2">
                      <span className="truncate">{f.path}</span>
                      <span className="shrink-0 text-muted-foreground/70">{f.type}</span>
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
                  data-testid="template-detail-author"
                  className="text-sm font-medium"
                >
                  {entry.author.name}
                </div>
                {entry.author.githubUser && (
                  <a
                    data-testid="template-detail-github-link"
                    href={`https://github.com/${entry.author.githubUser}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-muted-foreground hover:underline inline-flex items-center gap-1 mt-0.5"
                  >
                    @{entry.author.githubUser}
                    <ExternalLink className="h-3 w-3" aria-hidden="true" />
                  </a>
                )}
              </div>

              <div className="border-t pt-3 space-y-2">
                <ActionButtons
                  installed={Boolean(installed)}
                  updateAvailable={updateAvailable}
                  busy={busy}
                  onInstall={handleInstall}
                  onUninstall={handleUninstall}
                />
              </div>
            </CardContent>
          </Card>

          {progress && (
            <ProgressPanel progress={progress} />
          )}

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
// Action buttons (Install / Update / Uninstall)
// ---------------------------------------------------------------------------

interface ActionButtonsProps {
  installed: boolean;
  updateAvailable: boolean;
  busy: 'install' | 'uninstall' | null;
  onInstall: () => void;
  onUninstall: () => void;
}

function ActionButtons({
  installed,
  updateAvailable,
  busy,
  onInstall,
  onUninstall,
}: ActionButtonsProps) {
  if (!installed) {
    return (
      <Button
        data-testid="template-detail-install"
        className="w-full gap-1.5"
        onClick={onInstall}
        disabled={busy !== null}
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

  if (updateAvailable) {
    return (
      <div className="space-y-2">
        <Button
          data-testid="template-detail-update"
          className="w-full gap-1.5"
          onClick={onInstall}
          disabled={busy !== null}
        >
          {busy === 'install' ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
          )}
          {busy === 'install' ? 'Updating...' : 'Update'}
        </Button>
        <Button
          data-testid="template-detail-uninstall"
          variant="outline"
          className="w-full gap-1.5"
          onClick={onUninstall}
          disabled={busy !== null}
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
          {busy === 'uninstall' ? 'Uninstalling...' : 'Uninstall'}
        </Button>
      </div>
    );
  }

  return (
    <Button
      data-testid="template-detail-uninstall"
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
    <Card data-testid="template-detail-progress" data-phase={progress.phase}>
      <CardContent className="p-4 space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className="font-medium">{PHASE_LABEL[progress.phase]}</span>
          <span className="text-muted-foreground tabular-nums">{progress.pct}%</span>
        </div>
        <div
          className="h-1.5 w-full rounded-full bg-muted overflow-hidden"
          role="progressbar"
          aria-valuenow={progress.pct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            data-testid="template-detail-progress-bar"
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

function OutcomePanel({ outcome, onViewAuditLog, onRetry, onDismiss }: OutcomePanelProps) {
  const { t } = useTranslation();
  const isSuccess = outcome.kind === 'success';
  const Icon = isSuccess ? CheckCircle2 : XCircle;

  return (
    <Card
      data-testid={
        isSuccess ? 'template-detail-outcome-success' : 'template-detail-outcome-failure'
      }
      data-status={outcome.kind}
      role="status"
      aria-live="polite"
      className={cn(
        'border',
        isSuccess
          ? 'border-green-500/40 bg-green-500/10'
          : 'border-destructive/40 bg-destructive/10',
      )}
    >
      <CardContent className="p-4 flex gap-3">
        <Icon
          className={cn(
            'h-5 w-5 shrink-0 mt-0.5',
            isSuccess ? 'text-green-600 dark:text-green-400' : 'text-destructive',
          )}
          aria-hidden="true"
        />
        <div className="flex-1 min-w-0 space-y-2">
          <div>
            <div className="text-sm font-medium">{outcome.message}</div>
            {outcome.detail && (
              <div className="text-xs text-muted-foreground mt-0.5">{outcome.detail}</div>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {onViewAuditLog && (
              <Button
                data-testid="template-detail-view-audit-log"
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
                data-testid="template-detail-retry"
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
                data-testid="template-detail-outcome-dismiss"
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
// Screenshot carousel
//
// In-house implementation: prev/next arrows + dot indicators + index state.
// We avoid pulling in Embla/Swiper for a low-frequency surface; if the
// catalog grows to need more (zoom, swipe gestures), revisit.
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
        data-testid="template-detail-carousel-empty"
        className="aspect-video w-full bg-muted rounded-lg flex items-center justify-center"
      >
        <ImageOff className="h-10 w-10 text-muted-foreground/50" aria-hidden="true" />
      </div>
    );
  }

  const handlePrev = () => setIndex((i) => (i - 1 + total) % total);
  const handleNext = () => setIndex((i) => (i + 1) % total);

  const current = screenshots[index];

  return (
    <div
      data-testid="template-detail-carousel"
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
            data-testid="template-detail-carousel-prev"
            onClick={handlePrev}
            className="absolute left-2 top-1/2 -translate-y-1/2 h-8 w-8 rounded-full bg-background/80 backdrop-blur-sm border flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity focus:opacity-100"
            aria-label="Previous screenshot"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            data-testid="template-detail-carousel-next"
            onClick={handleNext}
            className="absolute right-2 top-1/2 -translate-y-1/2 h-8 w-8 rounded-full bg-background/80 backdrop-blur-sm border flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity focus:opacity-100"
            aria-label="Next screenshot"
          >
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
          <div
            data-testid="template-detail-carousel-dots"
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
// Error mapping
//
// MarketplaceService throws plain `Error` instances with patterned messages.
// We map them to actionable user copy so the failure panel is helpful rather
// than dumping a stack trace.
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
      headline: 'Template not found.',
      detail: 'The catalog entry for this template no longer exists. Try refreshing the catalog.',
    };
  }
  if (lower.includes('checksum mismatch') || lower.includes('checksum')) {
    return {
      headline: 'Tarball corrupt.',
      detail:
        'The downloaded file failed integrity verification. This usually means the network connection dropped, or the publisher republished the template. Try again.',
    };
  }
  if (lower.includes('manifest invalid') || lower.includes('manifest')) {
    return {
      headline: 'Manifest invalid.',
      detail:
        'The template package is missing required fields or has an unsupported format. Contact the template author.',
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
        'Could not reach the templates catalog. Check your internet connection and try again.',
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
