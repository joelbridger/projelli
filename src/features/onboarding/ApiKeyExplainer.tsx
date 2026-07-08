/**
 * ApiKeyExplainer - plain-English "what is an API key" callout.
 *
 * Framed as a privacy feature, not a technical chore. Used in both the
 * onboarding wizard's API key step and the Settings panel's provider cards.
 *
 * Design:
 *   - Shows by default in onboarding (where users need it most).
 *   - Collapsible in Settings (where returning users may not need it every time).
 *   - No em dashes, no jargon, honest framing: prompts go to the provider,
 *     not through Lantern's servers. We do NOT claim "never leaves your machine"
 *     (the AI call does leave), only that Lantern never sees your work.
 */

import { useState } from 'react';
import { Info, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';

interface ApiKeyExplainerProps {
  /**
   * When true (onboarding), the explainer is open by default and not collapsible.
   * When false (settings), it collapses after first render and shows a toggle.
   */
  defaultOpen?: boolean;
  className?: string;
}

export function ApiKeyExplainer({
  defaultOpen = true,
  className,
}: ApiKeyExplainerProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(defaultOpen);
  const collapsible = !defaultOpen;

  return (
    <div
      className={cn(
        'rounded-lg border border-border bg-blue-50/60 text-sm',
        className
      )}
    >
      {collapsible ? (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center gap-2 px-4 py-3 text-left text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
          aria-expanded={open}
        >
          <Info className="h-3.5 w-3.5 shrink-0 text-blue-500" />
          <span>What is an API key?</span>
          {open ? (
            <ChevronUp className="h-3.5 w-3.5 ml-auto" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 ml-auto" />
          )}
        </button>
      ) : (
        <div className="flex items-center gap-2 px-4 pt-3 pb-1">
          <Info className="h-3.5 w-3.5 shrink-0 text-blue-500" />
          <span className="text-xs font-medium text-foreground">What is an API key?</span>
        </div>
      )}

      {open && (
        <div className="px-4 pb-4 space-y-2 text-xs text-muted-foreground leading-relaxed">
          {!collapsible && <div className="h-1" />}
          <p>
            {t('onboarding.api-key-explainer.what-is-body')}
          </p>
          <p>
            {t('onboarding.api-key-explainer.privacy-body')}
          </p>
          <p>
            You pay the provider directly for what you use. Most professional
            users spend a couple of dollars a month.
          </p>
        </div>
      )}
    </div>
  );
}

export default ApiKeyExplainer;
