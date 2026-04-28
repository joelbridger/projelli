/**
 * TrialStatusChip — persistent status-bar indicator during the free trial.
 *
 * Always visible while the trial is active (and the user has not activated
 * a paid license). Color escalates as days run out:
 *   8+ days remaining  → neutral muted
 *   4-7 days           → amber
 *   1-3 days           → red
 *   0 days (expired)   → handled by the per-feature locked banners; this
 *                        chip hides itself once a license is activated
 *
 * Click → opens Settings, which shows the License section by default.
 */

import { Sparkles } from 'lucide-react';
import { useTrial } from '@/hooks/useTrial';
import { useLicense } from '@/hooks/useLicense';
import { cn } from '@/lib/utils';

interface TrialStatusChipProps {
  onClick: () => void;
}

export function TrialStatusChip({ onClick }: TrialStatusChipProps) {
  const trial = useTrial();
  const { isActivated } = useLicense();

  if (isActivated) return null;

  const { daysRemaining, isExpired } = trial;

  let label: string;
  let tone: 'muted' | 'amber' | 'red';
  if (isExpired) {
    label = 'Trial ended · Activate';
    tone = 'red';
  } else if (daysRemaining <= 3) {
    label = `${daysRemaining} day${daysRemaining === 1 ? '' : 's'} left · Upgrade`;
    tone = 'red';
  } else if (daysRemaining <= 7) {
    label = `${daysRemaining} days left · Upgrade`;
    tone = 'amber';
  } else {
    label = `Free trial · ${daysRemaining} days left`;
    tone = 'muted';
  }

  return (
    <button
      type="button"
      data-testid="status-bar-trial-chip"
      onClick={onClick}
      title="View license settings"
      className={cn(
        'flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium transition-colors',
        tone === 'muted' &&
          'text-muted-foreground hover:bg-accent hover:text-foreground',
        tone === 'amber' &&
          'bg-amber-100 text-amber-900 hover:bg-amber-200 dark:bg-amber-900/30 dark:text-amber-200 dark:hover:bg-amber-900/50',
        tone === 'red' &&
          'bg-red-100 text-red-900 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-200 dark:hover:bg-red-900/50'
      )}
    >
      <Sparkles className="h-3 w-3 flex-shrink-0" />
      <span>{label}</span>
    </button>
  );
}
