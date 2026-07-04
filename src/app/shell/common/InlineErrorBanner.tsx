/**
 * InlineErrorBanner — a plain, dismissible strip for a failure that must
 * never be silent (QA-33). Reuses the same red/AlertCircle styling
 * WorkspaceSelector's own error banner uses, for a component that isn't
 * mounted from inside WorkspaceSelector (e.g. the main app shell, where a
 * failed "switch to a different recent project" has nowhere else to show).
 *
 * Why not a toast library: same reasoning as UndoToast — one persistent,
 * dismissible strip is all this needs; swap for a shared toast system if one
 * gets added later.
 */

import { AlertCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

interface InlineErrorBannerProps {
  message: string;
  onDismiss: () => void;
  className?: string;
}

export function InlineErrorBanner({ message, onDismiss, className }: InlineErrorBannerProps) {
  const { t } = useTranslation();
  return (
    <div
      role="alert"
      data-testid="inline-error-banner"
      className={cn(
        'flex items-start gap-2 border-b border-destructive/20 bg-destructive/5 px-4 py-2 text-sm text-destructive',
        className,
      )}
    >
      <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
      <span className="flex-1" data-testid="inline-error-banner-message">{message}</span>
      <button
        type="button"
        data-testid="inline-error-banner-dismiss"
        onClick={onDismiss}
        className="text-xs underline underline-offset-2 shrink-0"
      >
        {t('workspace.open-error.dismiss')}
      </button>
    </div>
  );
}
