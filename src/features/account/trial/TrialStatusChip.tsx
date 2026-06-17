/**
 * TrialStatusChip — persistent status-bar license/trial indicator.
 *
 * Three states:
 *   - Activated license → green "Personal / Professional / Practice active" chip (reassurance)
 *   - Trial, 5+ days    → amber "Free trial · N days left · Upgrade"
 *   - Trial, 1-4 days   → red "N days left · Upgrade"
 *   - Expired           → red "Trial ended · Activate"
 *
 * Click → opens Settings to the License section in every state.
 */

import { Sparkles, CheckCircle2 } from 'lucide-react';
import { useTrial } from '@/platform/hooks/useTrial';
import { useLicense } from '@/platform/hooks/useLicense';
import { cn } from '@/lib/utils';

interface TrialStatusChipProps {
  onClick: () => void;
}

export function TrialStatusChip({ onClick }: TrialStatusChipProps) {
  const trial = useTrial();
  const { isActivated, tier } = useLicense();

  let label: string;
  let tone: 'green' | 'amber' | 'red';
  let Icon = Sparkles;

  if (isActivated) {
    const tierLabel =
      tier === 'practice' ? 'Practice' :
      tier === 'professional' ? 'Professional' :
      tier === 'personal' ? 'Personal' :
      'Activated';
    label = `${tierLabel} license · Active`;
    tone = 'green';
    Icon = CheckCircle2;
  } else if (trial.isExpired) {
    label = 'Trial ended · Activate';
    tone = 'red';
  } else if (trial.daysRemaining < 5) {
    label = `${trial.daysRemaining} day${trial.daysRemaining === 1 ? '' : 's'} left · Upgrade`;
    tone = 'red';
  } else {
    label = `Free trial · ${trial.daysRemaining} days left · Upgrade`;
    tone = 'amber';
  }

  return (
    <button
      type="button"
      data-testid="status-bar-trial-chip"
      data-trial-tone={tone}
      onClick={onClick}
      title="View license settings"
      className={cn(
        'flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium transition-colors',
        tone === 'green' &&
          'bg-green-100 text-green-900 hover:bg-green-200 dark:bg-green-900/30 dark:text-green-200 dark:hover:bg-green-900/50',
        tone === 'amber' &&
          'bg-amber-100 text-amber-900 hover:bg-amber-200 dark:bg-amber-900/30 dark:text-amber-200 dark:hover:bg-amber-900/50',
        tone === 'red' &&
          'bg-red-100 text-red-900 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-200 dark:hover:bg-red-900/50'
      )}
    >
      <Icon className="h-3 w-3 flex-shrink-0" />
      <span>{label}</span>
    </button>
  );
}
