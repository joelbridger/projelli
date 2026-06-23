/**
 * UseWithFirmPrompt — a small, dismissible in-app card that surfaces the
 * "Use this with my firm" flow where firm value is obvious.
 *
 * It is its OWN component (not the trial banner). It only shows for a solo user
 * (no active firm seat), can be dismissed for the session, and opens the
 * UseWithFirmFlow in a dialog. Honest, short copy. No em dashes.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Building2, X } from 'lucide-react';
import { Button } from '@/ui/button';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/ui/dialog';
import { useFirm } from '@/platform/hooks/useFirm';
import { UseWithFirmFlow } from '@/features/firm/UseWithFirmFlow';

export function UseWithFirmPrompt() {
  const { t } = useTranslation();
  const firm = useFirm();
  const hasSeat = firm.isSignedIn && firm.hasActiveSeat;

  const [dismissed, setDismissed] = useState(false);
  const [open, setOpen] = useState(false);

  // Only solo users (no active firm seat) ever see this, and never once dismissed.
  if (hasSeat || dismissed) return null;

  return (
    <>
      <div
        data-testid="use-with-firm-prompt"
        className="flex items-start gap-3 rounded-lg border border-primary/20 bg-primary/5 p-3"
      >
        <Building2 className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
        <div className="min-w-0 flex-1 space-y-1.5">
          <p className="text-sm font-medium">{t('firm.prompt.title')}</p>
          <p className="text-xs text-muted-foreground">{t('firm.prompt.body')}</p>
          <Button
            type="button"
            size="sm"
            className="h-7 px-2 text-xs"
            data-testid="use-with-firm-prompt-action"
            onClick={() => {
              setOpen(true);
            }}
          >
            {t('firm.prompt.action')}
          </Button>
        </div>
        <button
          type="button"
          aria-label={t('firm.prompt.dismiss')}
          data-testid="use-with-firm-prompt-dismiss"
          className="rounded p-1 text-muted-foreground hover:bg-muted/50"
          onClick={() => {
            setDismissed(true);
          }}
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogTitle className="sr-only">{t('firm.bridge.heading')}</DialogTitle>
          <DialogDescription className="sr-only">{t('firm.bridge.intro')}</DialogDescription>
          <UseWithFirmFlow
            onClose={() => {
              setOpen(false);
            }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
