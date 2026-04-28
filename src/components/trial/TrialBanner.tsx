/**
 * TrialBanner — top-of-app banner that surfaces the free-trial countdown
 * during the final week, then converts to an "activate now" CTA on expiry.
 *
 * Visibility rules:
 *   - Hidden when a paid license is active.
 *   - Hidden during early trial (more than 7 days remain) — the status-bar
 *     chip is enough; a banner here would be needless visual noise.
 *   - Visible during last 7 days, escalating in tone (amber → red).
 *   - Visible (and not dismissible) after expiry, with a clear Activate CTA.
 *
 * Dismissal: the banner can be hidden for the current session via the X
 * button. The dismissal is held in sessionStorage, so it re-appears on the
 * next launch (we want users to keep seeing it as time runs out — once-and-
 * done dismissal is too easy to forget).
 */

import { useState, useEffect } from 'react';
import { Sparkles, X } from 'lucide-react';
import { useTrial } from '@/hooks/useTrial';
import { useLicense } from '@/hooks/useLicense';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const SESSION_DISMISS_KEY = 'projelli_trial_banner_dismissed_at';
// Re-show banner if the dismissal is older than this many minutes (so a
// long-running app eventually nags again as the day-count drops).
const RESHOW_AFTER_MIN = 60;

interface TrialBannerProps {
  onActivate: () => void;
}

export function TrialBanner({ onActivate }: TrialBannerProps) {
  const trial = useTrial();
  const { isActivated } = useLicense();
  const [dismissed, setDismissed] = useState<boolean>(() => isFreshDismiss());

  // Re-evaluate dismissal as trial state changes (so the banner can come
  // back when the day-count drops past a threshold).
  useEffect(() => {
    setDismissed(isFreshDismiss());
  }, [trial.daysRemaining, trial.isExpired]);

  if (isActivated) return null;

  const { daysRemaining, isExpired, trialDays } = trial;

  // Only show in the final week or after expiry.
  if (!isExpired && daysRemaining > 7) return null;

  // Expired banner is not dismissible — the app is locked.
  if (!isExpired && dismissed) return null;

  const tone: 'amber' | 'red' = isExpired || daysRemaining <= 3 ? 'red' : 'amber';

  let headline: string;
  let body: string;
  if (isExpired) {
    headline = 'Your trial has ended.';
    body = `Your ${trialDays}-day free trial is over. Activate a license to keep using AI chat and workflows. Your files stay readable either way.`;
  } else if (daysRemaining === 1) {
    headline = '1 day left in your free trial.';
    body = 'After tomorrow, AI chat and workflows pause until you activate a license. Existing files stay accessible.';
  } else {
    headline = `${daysRemaining} days left in your free trial.`;
    body = 'Activate a license now to keep AI chat and workflows running once the trial ends.';
  }

  return (
    <div
      data-testid="trial-banner"
      data-trial-tone={tone}
      className={cn(
        'flex items-center gap-3 px-4 py-2 border-b text-sm',
        tone === 'amber' &&
          'bg-amber-50 text-amber-950 border-amber-200 dark:bg-amber-950/30 dark:text-amber-100 dark:border-amber-900/50',
        tone === 'red' &&
          'bg-red-50 text-red-950 border-red-200 dark:bg-red-950/30 dark:text-red-100 dark:border-red-900/50'
      )}
    >
      <Sparkles className="h-4 w-4 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <span className="font-semibold">{headline}</span>{' '}
        <span className="opacity-90">{body}</span>
      </div>
      <Button
        size="sm"
        variant={tone === 'red' ? 'default' : 'outline'}
        onClick={onActivate}
        data-testid="trial-banner-activate"
      >
        {isExpired ? 'Activate license' : 'Get a license'}
      </Button>
      {!isExpired && (
        <button
          type="button"
          data-testid="trial-banner-dismiss"
          aria-label="Dismiss for this session"
          className="opacity-60 hover:opacity-100"
          onClick={() => {
            sessionStorage.setItem(SESSION_DISMISS_KEY, String(Date.now()));
            setDismissed(true);
          }}
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

function isFreshDismiss(): boolean {
  const raw = sessionStorage.getItem(SESSION_DISMISS_KEY);
  if (!raw) return false;
  const ts = Number(raw);
  if (!Number.isFinite(ts)) return false;
  const ageMin = (Date.now() - ts) / 60000;
  return ageMin < RESHOW_AFTER_MIN;
}
