// R6 (Tier B trust guard) — the one honest confirm before a whole-practice
// question ships a short summary of EVERY client to the cloud AI provider.
// Names the real client count and the real provider; offers a remember choice
// but defaults to asking. Skipped entirely in local-only mode (see Ask.tsx).
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/ui/dialog';
import { Button } from '@/ui/button';

export interface WholePracticeSendConfirmProps {
  open: boolean;
  clientCount: number;
  /** Real provider name (e.g. "Anthropic"), or null when not yet resolved. */
  providerName: string | null;
  onConfirm: (opts: { remember: boolean }) => void;
  onCancel: () => void;
}

export function WholePracticeSendConfirm({ open, clientCount, providerName, onConfirm, onCancel }: WholePracticeSendConfirmProps) {
  const { t } = useTranslation();
  const [remember, setRemember] = useState(false);
  // The dialog stays mounted across opens (open is a controlled prop), so reset
  // the remember choice each time it reopens — otherwise a checked-then-cancelled
  // box would silently carry into a later, different confirmation and store
  // consent the advisor didn't grant this time (Codex review).
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setRemember(false);
  }
  const provider = providerName ?? t('ask.whole-practice-confirm.provider-fallback');

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent className="sm:max-w-[440px]" data-testid="whole-practice-confirm">
        <DialogHeader>
          <DialogTitle>{t('ask.whole-practice-confirm.title')}</DialogTitle>
        </DialogHeader>
        <p
          data-testid="whole-practice-confirm-body"
          style={{ fontSize: 'var(--kp-font-sm)', color: 'var(--kp-navy)' }}
        >
          {t('ask.whole-practice-confirm.body', { count: clientCount, provider })}
        </p>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--kp-font-sm)' }}>
          <input
            type="checkbox"
            data-testid="whole-practice-confirm-remember"
            checked={remember}
            onChange={(e) => { setRemember(e.target.checked); }}
          />
          {t('ask.whole-practice-confirm.remember')}
        </label>
        <DialogFooter>
          <Button variant="secondary" data-testid="whole-practice-confirm-cancel" onClick={onCancel}>
            {t('ask.whole-practice-confirm.cancel')}
          </Button>
          <Button
            data-testid="whole-practice-confirm-continue"
            onClick={() => { onConfirm({ remember }); }}
          >
            {t('ask.whole-practice-confirm.continue')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default WholePracticeSendConfirm;
