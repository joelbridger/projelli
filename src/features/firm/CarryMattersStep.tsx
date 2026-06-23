/**
 * CarryMattersStep — the guided, one-time solo-to-firm carry-over step.
 *
 * Lists every eligible local matter (excludes archived + already-shared) and
 * lets the user choose, per matter, whether to leave it private or share it
 * with the firm. Sharing a PRIVILEGED matter is gated behind an explicit
 * informed-consent confirm (it turns on the encrypted relay sync). On submit it
 * runs the proven bulk carry-over routine and reports a per-matter outcome.
 *
 * It never re-implements firm-matter creation or key publishing; it calls
 * carryMattersToFirm (which wraps promoteMatterToShared). The whole step is
 * skippable; the user can share any matter later from the normal matter screen.
 *
 * Light theme, navy accent, plain copy. No em dashes in user-facing strings.
 */
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Share2, Lock, ShieldAlert, Check, AlertTriangle } from 'lucide-react';
import { Button } from '@/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/ui/alert-dialog';
import { useMatterStore } from '@/platform/matter/matterStore';
import { useFirmStore } from '@/platform/firm/firmStore';
import {
  carryMattersToFirm,
  type CarrySelection,
  type CarryMatterOutcome,
} from '@/features/firm/logic/carryMattersToFirm';

export interface CarryMattersStepProps {
  onDone: (outcomes: CarryMatterOutcome[]) => void;
  onSkip: () => void;
}

type CarryAction = 'private' | 'share';

export function CarryMattersStep({ onDone, onSkip }: CarryMattersStepProps) {
  const { t } = useTranslation();
  const getClient = useFirmStore((s) => s.client);

  // Eligible matters: not archived, and not already linked to the firm. We
  // check BOTH `shared` and `firmMatterId` so a matter that is linked but has a
  // stale/missing `shared` flag is never offered again (which would create a
  // duplicate firm shell).
  const eligible = useMatterStore((s) =>
    s.matters.filter((m) => !m.archived && !m.shared && !m.firmMatterId),
  );

  // Per-matter choice. Default everything to private (the safe default).
  const [actions, setActions] = useState<Record<string, CarryAction>>({});
  // The privileged matter the user is currently being asked to confirm sharing.
  const [pendingPrivilegedId, setPendingPrivilegedId] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [outcomes, setOutcomes] = useState<CarryMatterOutcome[] | null>(null);

  const actionFor = (id: string): CarryAction => actions[id] ?? 'private';

  const setShare = (id: string) => {
    setActions((prev) => ({ ...prev, [id]: 'share' }));
  };
  const setPrivate = (id: string) => {
    setActions((prev) => ({ ...prev, [id]: 'private' }));
  };

  /** Try to set a matter to "share". Privileged matters route through a confirm. */
  const requestShare = (id: string, privileged: boolean) => {
    if (privileged) {
      setPendingPrivilegedId(id);
      return;
    }
    setShare(id);
  };

  const confirmPrivilegedShare = () => {
    if (pendingPrivilegedId) setShare(pendingPrivilegedId);
    setPendingPrivilegedId(null);
  };

  const cancelPrivilegedShare = () => {
    // Explicit cancel: leave the matter private, clear the pending state.
    if (pendingPrivilegedId) setPrivate(pendingPrivilegedId);
    setPendingPrivilegedId(null);
  };

  // Dismissing the dialog any other way (Escape / outside click) just clears
  // the pending state. The matter stays private (its default), so there is no
  // need to force it private again, and doing so would clobber an accept that
  // already set it to share before the close event fires.
  const dismissPrivilegedConfirm = () => {
    setPendingPrivilegedId(null);
  };

  const matterById = useMemo(() => {
    const map = new Map<string, (typeof eligible)[number]>();
    for (const m of eligible) map.set(m.id, m);
    return map;
  }, [eligible]);

  const handleSubmit = async () => {
    const selections: CarrySelection[] = eligible.map((m) => ({
      matterId: m.id,
      clientName: m.client.trim() || m.name,
      action: actionFor(m.id),
    }));
    setSubmitting(true);
    setProgress({ done: 0, total: selections.filter((s) => s.action === 'share').length });
    const results = await carryMattersToFirm(selections, getClient(), (done, total) => {
      setProgress({ done, total });
    });
    // Show the per-matter results screen so partial failures are visible. The
    // flow advances (onDone) only when the user clicks Continue there, so a
    // failed matter is never silently hidden by closing the step.
    setOutcomes(results);
    setSubmitting(false);
  };

  // ── Empty state: nothing eligible to bring over ──────────────────────────
  if (eligible.length === 0) {
    return (
      <div data-testid="carry-matters-step" className="space-y-4">
        <header className="space-y-1">
          <h2 className="text-lg font-semibold">{t('firm.carry.heading')}</h2>
          <p className="text-sm text-muted-foreground">{t('firm.carry.empty')}</p>
        </header>
        <div className="flex justify-end">
          <Button type="button" data-testid="carry-skip" onClick={onSkip}>
            {t('firm.carry.continue-action')}
          </Button>
        </div>
      </div>
    );
  }

  // ── Results state: show what happened per matter ─────────────────────────
  if (outcomes) {
    return (
      <div data-testid="carry-matters-step" className="space-y-4">
        <header className="space-y-1">
          <h2 className="text-lg font-semibold">{t('firm.carry.done-heading')}</h2>
        </header>
        <ul className="space-y-1.5">
          {outcomes.map((o) => {
            const m = matterById.get(o.matterId);
            const label = m ? m.client.trim() || m.name : o.matterId;
            return (
              <li
                key={o.matterId}
                data-testid={`carry-outcome-${o.matterId}`}
                className="flex items-center justify-between rounded-md border border-border/60 px-3 py-2 text-sm"
              >
                <span className="font-medium">{label}</span>
                {o.status === 'shared' && (
                  <span className="flex items-center gap-1.5 text-xs text-primary">
                    <Share2 className="h-3.5 w-3.5" aria-hidden />
                    {t('firm.carry.outcome-shared')}
                  </span>
                )}
                {o.status === 'kept-private' && (
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Lock className="h-3.5 w-3.5" aria-hidden />
                    {t('firm.carry.outcome-private')}
                  </span>
                )}
                {o.status === 'failed' && (
                  <span
                    data-testid={`carry-outcome-error-${o.matterId}`}
                    className="flex items-center gap-1.5 text-xs text-destructive"
                  >
                    <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                    {t('firm.carry.outcome-failed', { error: o.error })}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
        <div className="flex justify-end">
          <Button
            type="button"
            data-testid="carry-done"
            onClick={() => {
              onDone(outcomes);
            }}
          >
            {t('firm.carry.continue-action')}
          </Button>
        </div>
      </div>
    );
  }

  // ── Selection state: per-matter private/share choice ─────────────────────
  return (
    <div data-testid="carry-matters-step" className="space-y-4">
      <header className="space-y-1">
        <h2 className="text-lg font-semibold">{t('firm.carry.heading')}</h2>
        <p className="text-sm text-muted-foreground">{t('firm.carry.intro')}</p>
      </header>

      <ul className="space-y-2">
        {eligible.map((m) => {
          const action = actionFor(m.id);
          const label = m.client.trim() || m.name;
          return (
            <li
              key={m.id}
              data-testid={`carry-row-${m.id}`}
              className="rounded-md border border-border/60 px-3 py-2"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate font-medium text-sm">{label}</span>
                    {m.privileged && (
                      <span
                        data-testid={`carry-privileged-badge-${m.id}`}
                        className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800"
                      >
                        <ShieldAlert className="h-3 w-3" aria-hidden />
                        {t('firm.carry.privileged-badge')}
                      </span>
                    )}
                  </div>
                  {label !== m.name && (
                    <span className="block truncate text-xs text-muted-foreground">{m.name}</span>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant={action === 'private' ? 'default' : 'outline'}
                    className="h-7 gap-1 px-2 text-xs"
                    data-testid={`carry-private-${m.id}`}
                    aria-pressed={action === 'private'}
                    onClick={() => {
                      setPrivate(m.id);
                    }}
                  >
                    <Lock className="h-3.5 w-3.5" aria-hidden />
                    {t('firm.carry.keep-private-action')}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={action === 'share' ? 'default' : 'outline'}
                    className="h-7 gap-1 px-2 text-xs"
                    data-testid={`carry-share-${m.id}`}
                    aria-pressed={action === 'share'}
                    onClick={() => {
                      requestShare(m.id, !!m.privileged);
                    }}
                  >
                    <Share2 className="h-3.5 w-3.5" aria-hidden />
                    {t('firm.carry.share-action')}
                  </Button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {progress && submitting && (
        <p data-testid="carry-progress" className="text-xs text-muted-foreground">
          {t('firm.carry.progress', { done: progress.done, total: progress.total })}
        </p>
      )}

      <div className="flex items-center justify-between">
        <Button type="button" variant="ghost" data-testid="carry-skip" onClick={onSkip}>
          {t('firm.carry.skip-action')}
        </Button>
        <Button
          type="button"
          data-testid="carry-submit"
          disabled={submitting}
          onClick={() => void handleSubmit()}
        >
          <Check className="mr-1 h-4 w-4" aria-hidden />
          {submitting ? t('firm.carry.submitting') : t('firm.carry.submit-action')}
        </Button>
      </div>

      {/* Privileged informed-consent confirm */}
      <AlertDialog
        open={pendingPrivilegedId !== null}
        onOpenChange={(open) => {
          if (!open) dismissPrivilegedConfirm();
        }}
      >
        <AlertDialogContent data-testid="privileged-share-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('firm.carry.privileged-confirm-title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('firm.carry.privileged-confirm-body')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              data-testid="privileged-share-confirm-cancel"
              onClick={cancelPrivilegedShare}
            >
              {t('firm.carry.privileged-confirm-cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              data-testid="privileged-share-confirm-accept"
              onClick={confirmPrivilegedShare}
            >
              {t('firm.carry.privileged-confirm-accept')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
