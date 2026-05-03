/**
 * Stream A1 — Inline warning shown above the send button when the user has
 * at least one pending image attachment but the selected model does not
 * support vision.
 *
 * Shows the provider's error message and an auto-suggest button to swap to a
 * known-good vision model in the same provider. The send button in
 * AIChatViewer is kept disabled while this banner is visible.
 */
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface VisionWarningBannerProps {
  /** Error message returned by provider.supportsAttachment(). */
  message: string;
  /** Suggested model ID to switch to. Empty string hides the swap button. */
  suggestedModel: string;
  onSwitchModel: (model: string) => void;
  className?: string;
}

export function VisionWarningBanner({
  message,
  suggestedModel,
  onSwitchModel,
  className,
}: VisionWarningBannerProps) {
  return (
    <div
      data-testid="vision-warning-banner"
      role="alert"
      className={cn(
        'flex items-start gap-2 rounded-md border border-amber-400/60',
        'bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-xs',
        'text-amber-900 dark:text-amber-200',
        className
      )}
    >
      <AlertTriangle
        className="h-4 w-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400"
        aria-hidden
      />
      <div className="flex-1 space-y-1">
        <p>{message}</p>
        {suggestedModel && (
          <Button
            data-testid="vision-warning-switch-button"
            type="button"
            variant="link"
            size="sm"
            className="h-auto p-0 text-xs text-amber-700 dark:text-amber-300 underline"
            onClick={() => onSwitchModel(suggestedModel)}
          >
            Switch to {suggestedModel}
          </Button>
        )}
      </div>
    </div>
  );
}

export default VisionWarningBanner;
