/**
 * InstalledTemplatesList — the "Installed" subview of the Templates tab.
 *
 * Renders one row per `InstalledEntry`: name, version, installed-at,
 * provenance badge, and an [Uninstall] button. Uninstall is gated by a
 * confirm dialog (shared `ConfirmDialog`) so a stray click can't wipe a
 * template that took bandwidth + setup to install.
 *
 * State is owned by the parent (`TemplatesTab`); this component is a pure
 * presentation surface that calls `service.uninstall(id)` and bubbles the
 * removal up via `onUninstalled`. The audit event is emitted by the service.
 *
 * i18n: TODO Stream E — strings here are not yet routed through an
 * extraction layer.
 */

import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/ui/button';
import { Card, CardContent } from '@/ui/card';
import { ConfirmDialog } from '@/ui/ConfirmDialog';
import { Loader2, Trash2 } from 'lucide-react';
import type { MarketplaceService } from '@/features/workflows/marketplace/svc';
import type { InstalledEntry, TemplateProvenance } from '@/features/workflows/types/marketplace';
import { TEMPLATE_PROVENANCE_LABELS } from '@/features/workflows/marketplace/svc';

export interface InstalledTemplatesListProps {
  service: MarketplaceService;
  installed: InstalledEntry[];
  /** Called after a successful uninstall so the parent can refresh state. */
  onUninstalled?: (id: string) => void;
}

interface OutcomeState {
  kind: 'success' | 'failure';
  templateId: string;
  message: string;
}

export function InstalledTemplatesList({
  service,
  installed,
  onUninstalled,
}: InstalledTemplatesListProps) {
  const { t } = useTranslation();
  const [pending, setPending] = useState<InstalledEntry | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<OutcomeState | null>(null);

  const handleAskUninstall = useCallback((entry: InstalledEntry) => {
    setOutcome(null);
    setPending(entry);
  }, []);

  const handleConfirmUninstall = useCallback(async () => {
    if (!pending) return;
    const target = pending;
    setBusyId(target.id);
    try {
      await service.uninstall(target.id);
      onUninstalled?.(target.id);
      setOutcome({
        kind: 'success',
        templateId: target.id,
        message: `Uninstalled ${target.name}.`,
      });
    } catch (err) {
      setOutcome({
        kind: 'failure',
        templateId: target.id,
        message:
          err instanceof Error ? err.message : 'Uninstall failed unexpectedly.',
      });
    } finally {
      setBusyId(null);
      setPending(null);
    }
  }, [onUninstalled, pending, service]);

  if (installed.length === 0) {
    return (
      <div
        data-testid="installed-templates-empty"
        className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground"
      >
        {t('marketplace.installed-templates.empty')}
      </div>
    );
  }

  return (
    <div data-testid="installed-templates-list" className="space-y-3">
      {outcome && (
        <Card
          data-testid={
            outcome.kind === 'success'
              ? 'installed-templates-outcome-success'
              : 'installed-templates-outcome-failure'
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
              data-testid="installed-templates-outcome-dismiss"
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
        {installed.map((entry) => (
          <li key={entry.id}>
            <Card data-testid={`installed-template-${entry.id}`}>
              <CardContent className="p-3 flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      data-testid={`installed-template-name-${entry.id}`}
                      className="text-sm font-medium truncate"
                      title={entry.name}
                    >
                      {entry.name}
                    </span>
                    <ProvenanceBadge
                      provenance={entry.provenance}
                      templateId={entry.id}
                    />
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    v{entry.version}
                    {' · '}
                    Installed {formatInstalledAt(entry.installedAt)}
                  </div>
                </div>

                <Button
                  data-testid={`installed-template-uninstall-${entry.id}`}
                  variant="outline"
                  size="sm"
                  className="gap-1.5 shrink-0"
                  onClick={() => handleAskUninstall(entry)}
                  disabled={busyId !== null}
                  aria-label={`Uninstall ${entry.name}`}
                >
                  {busyId === entry.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                  {busyId === entry.id ? 'Uninstalling...' : 'Uninstall'}
                </Button>
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>

      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(o) => {
          if (!o) setPending(null);
        }}
        title="Uninstall template?"
        description={
          pending
            ? `Remove "${pending.name}" v${pending.version} from this workspace. The template files will be deleted. You can reinstall it later from the marketplace.`
            : ''
        }
        confirmLabel="Uninstall"
        cancelLabel="Cancel"
        variant="destructive"
        onConfirm={() => {
          void handleConfirmUninstall();
        }}
        onCancel={() => setPending(null)}
      />
    </div>
  );
}

function ProvenanceBadge({
  provenance,
  templateId,
}: {
  provenance: TemplateProvenance;
  templateId: string;
}) {
  const label = TEMPLATE_PROVENANCE_LABELS[provenance];
  const tone =
    provenance === 'community'
      ? 'bg-primary/10 text-primary'
      : provenance === 'custom'
        ? 'bg-muted text-foreground'
        : 'bg-muted text-muted-foreground';
  return (
    <span
      data-testid={`installed-template-provenance-${templateId}`}
      data-provenance={provenance}
      className={`text-[10px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded ${tone}`}
    >
      {label}
    </span>
  );
}

function formatInstalledAt(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins.toString()}m ago`;
    if (diffMins < 1440) return `${Math.floor(diffMins / 60).toString()}h ago`;
    if (diffMins < 60 * 24 * 14) {
      return `${Math.floor(diffMins / 1440).toString()}d ago`;
    }
    return d.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}
