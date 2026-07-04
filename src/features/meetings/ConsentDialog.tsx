/**
 * Task 13 — the consent dialog: opens before every recording starts.
 * Copy is exact per the plan (see docs/plans/lantern-plus/2026-07-02-wave-3-meeting-capture.md,
 * Task 13) — the i18n values ARE that exact English text, translated for de/es.
 *
 * Also carries the macOS first-run permission explainer: when `capture_start`
 * fails with the sidecar's permission-denied error, the dialog swaps to this
 * explainer instead of closing, with a button straight to System Settings.
 * `docs/plans/lantern-plus/notes-macos-permission.md` (the doc meant to carry
 * the exact on-screen OS prompt wording, captured on a live macOS bench run)
 * doesn't exist yet on this branch — that hardware step hasn't run for this
 * wave — so this uses the plan's own specified copy directly rather than
 * sourcing it from that doc.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/ui/dialog';
import { Button } from '@/ui/button';
import type { ConsentEntry } from './consentLedger';

/** Substring match against the Rust sidecar's stderr-derived error message
 *  for a macOS permission denial (exit code 3). Lane w3b's exact error
 *  string isn't landed on this branch yet — this is a best-effort match to
 *  reconcile once it is. */
export function isMacPermissionError(message: string): boolean {
  return /permission/i.test(message);
}

export const MAC_SYSTEM_SETTINGS_URL = 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture';

export interface ConsentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  consentMode: 'one-party' | 'two-party';
  /** False when the advisor's state isn't on file — the two-party guidance
   *  then reads conditionally ("If your state requires everyone's consent…")
   *  instead of asserting a legal fact we don't actually know. */
  stateKnown?: boolean;
  standingConsent: ConsentEntry | null;
  /** Set when the prior recording attempt failed with a macOS permission
   *  error — swaps the dialog body to the explainer instead of the normal
   *  consent copy. */
  macPermissionError?: boolean;
  /** A non-permission start failure (sidecar missing, mic busy, disk full):
   *  shown inline so the dialog never closes on silence — the advisor must
   *  never believe a failed recording is running. */
  errorMessage?: string | null;
  onConfirm: (opts: { note?: string }) => void;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString();
}

export function ConsentDialog({ open, onOpenChange, consentMode, stateKnown = true, standingConsent, macPermissionError, errorMessage, onConfirm }: ConsentDialogProps) {
  const { t } = useTranslation();
  const [checked, setChecked] = useState(standingConsent !== null);

  // codex-review (P2): the dialog stays mounted across opens (the parent
  // renders it unconditionally, toggling `open`), so state from a PRIOR
  // confirmation would otherwise leak into the next one — re-derive the
  // checkbox from standingConsent every time the dialog opens (or once
  // standingConsent resolves after an already-open dialog's async load).
  // Done as a render-time state adjustment (not an effect) per
  // react.dev/learn/you-might-not-need-an-effect.
  const [prevGate, setPrevGate] = useState<{ open: boolean; sc: ConsentEntry | null }>({ open, sc: standingConsent });
  if (open !== prevGate.open || standingConsent !== prevGate.sc) {
    setPrevGate({ open, sc: standingConsent });
    if (open) setChecked(standingConsent !== null);
  }

  if (macPermissionError) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[420px]" data-testid="mac-permission-explainer">
          <DialogHeader>
            <DialogTitle>{t('meetings.consent.mac-permission-title')}</DialogTitle>
          </DialogHeader>
          <p style={{ fontSize: 'var(--kp-font-sm)', color: 'var(--kp-navy)' }}>
            {t('meetings.consent.mac-permission-body')}
          </p>
          <DialogFooter>
            <Button variant="secondary" onClick={() => { onOpenChange(false); }}>
              {t('meetings.dictation.cancel')}
            </Button>
            <Button asChild>
              <a href={MAC_SYSTEM_SETTINGS_URL} data-testid="mac-open-system-settings">
                {t('meetings.consent.mac-permission-button')}
              </a>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]" data-testid="consent-dialog">
        <DialogHeader>
          <DialogTitle>{t('meetings.consent.title')}</DialogTitle>
        </DialogHeader>
        <p style={{ fontSize: 'var(--kp-font-sm)', color: 'var(--kp-navy)' }}>
          {t('meetings.consent.body-local')}
        </p>
        {consentMode === 'two-party' && (
          <p style={{ fontSize: 'var(--kp-font-sm)', color: 'var(--kp-navy)' }}>
            {stateKnown ? t('meetings.consent.two-party-note') : t('meetings.consent.two-party-note-unknown')}
          </p>
        )}
        {standingConsent && (
          <p data-testid="standing-consent-note" style={{ fontSize: 'var(--kp-font-xs)', color: 'var(--color-muted-foreground)' }}>
            {t('meetings.consent.standing-note', { date: formatDate(standingConsent.confirmedAt) })}
          </p>
        )}
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--kp-font-sm)' }}>
          <input
            type="checkbox"
            data-testid="consent-checkbox"
            checked={checked}
            onChange={(e) => { setChecked(e.target.checked); }}
          />
          {t('meetings.consent.checkbox')}
        </label>
        <p style={{ fontSize: 'var(--kp-font-2xs)', color: 'var(--color-muted-foreground)' }}>
          {t('meetings.consent.disclaimer')}
        </p>
        {errorMessage && (
          <p data-testid="consent-error" role="alert" style={{ fontSize: 'var(--kp-font-sm)', color: 'var(--kp-danger)', margin: 0 }}>
            {t('meetings.consent.start-failed', { message: errorMessage })}
          </p>
        )}
        <DialogFooter>
          <Button variant="secondary" onClick={() => { onOpenChange(false); }}>
            {t('meetings.dictation.cancel')}
          </Button>
          <Button
            data-testid="consent-start-button"
            disabled={!checked}
            onClick={() => { onConfirm({}); }}
          >
            {t('meetings.consent.start-button')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ConsentDialog;
