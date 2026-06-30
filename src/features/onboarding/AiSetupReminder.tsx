/**
 * AiSetupReminder — the gentle, persistent nudge shown in the AI pane after a
 * user chose "Set this up later" during onboarding.
 *
 * The point of the skip path is that it must NEVER block onboarding. The cost
 * of that is the AI side is dormant until they connect a model, so this banner
 * is the soft reminder that brings them back without nagging. It:
 *   - only appears when the user actually deferred AND no model is connected yet,
 *   - links straight to where they can connect one,
 *   - can be dismissed for the session (it returns next launch if still unset),
 *   - disappears for good the moment a key/local model is connected (the
 *     deferred flag is cleared on save).
 */

/* eslint-disable lantern-i18n/no-hardcoded-string */
import { useState } from 'react';
import { Sparkles, X } from 'lucide-react';
import { Button } from '@/ui/button';
import { cn } from '@/lib/utils';
import { hasDeferredAiSetup } from '@/features/onboarding/aiSetupState';
import { useProfessionCopy } from '@/features/onboarding/useProfessionCopy';

const SESSION_DISMISS_KEY = 'keepance_ai_setup_reminder_dismissed';

function dismissedThisSession(): boolean {
  try {
    return sessionStorage.getItem(SESSION_DISMISS_KEY) === 'true';
  } catch {
    return false;
  }
}

export interface AiSetupReminderProps {
  /**
   * True when the user has at least one usable model connected (a valid cloud
   * key or a reachable local model). When true the reminder never shows, even
   * if the deferred flag was left set.
   */
  hasModelConnected: boolean;
  /** Open the place where a model can be connected (the AI pane's Keys tab). */
  onConnect: () => void;
  className?: string;
}

export function AiSetupReminder({ hasModelConnected, onConnect, className }: AiSetupReminderProps) {
  const [dismissed, setDismissed] = useState<boolean>(() => dismissedThisSession());
  const professionCopy = useProfessionCopy();

  // Show only when: the user deferred, nothing is connected, and they have not
  // dismissed it this session.
  if (hasModelConnected || dismissed || !hasDeferredAiSetup()) {
    return null;
  }

  const handleDismiss = () => {
    try {
      sessionStorage.setItem(SESSION_DISMISS_KEY, 'true');
    } catch {
      // Ignore; worst case it shows again on the next action this session.
    }
    setDismissed(true);
  };

  return (
    <div
      data-testid="ai-setup-reminder"
      className={cn(
        'flex items-start gap-2 border-b border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900',
        className,
      )}
    >
      <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
      <div className="min-w-0 flex-1">
        <p className="leading-relaxed">
          Connect your Claude or OpenAI account for the best results on {professionCopy.clientWorkNoun}.
          Local models are available but are less capable for {professionCopy.complexWorkDesc}.
        </p>
        <button
          type="button"
          data-testid="ai-setup-reminder-connect"
          onClick={onConnect}
          className="mt-1 font-medium text-amber-900 underline underline-offset-2 hover:text-amber-700"
        >
          Connect an AI
        </button>
      </div>
      <Button
        data-testid="ai-setup-reminder-dismiss"
        variant="ghost"
        size="icon"
        className="h-6 w-6 shrink-0 text-amber-700 hover:text-amber-900"
        onClick={handleDismiss}
        aria-label="Dismiss reminder"
      >
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

export default AiSetupReminder;
