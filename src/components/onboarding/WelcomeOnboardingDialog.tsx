/**
 * WelcomeOnboardingDialog — first-launch consent dialog.
 *
 * Two opt-ins, both default-OFF, presented in a single moment so the
 * user has one decision instead of two:
 *   1. Email updates: "Send me launch updates, tips, and discount codes."
 *   2. Anonymous telemetry: "Help me improve Projelli with anonymous
 *      usage stats." (no PII, no content, just lifecycle events)
 *
 * Both can be skipped entirely. Skipping marks onboarding complete so
 * this never re-prompts.
 *
 * Lives in `~/projelli/src/components/onboarding/`. Mounted once from
 * App.tsx after the workspace is open (so the very first impression is
 * still the workspace, not a modal — but the consent comes before any
 * meaningful AI usage).
 */

import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useOnboardingCompleted } from '@/hooks/useOnboarding';
import { setTelemetryConsent } from '@/hooks/useTelemetryConsent';
import { sendEvent } from '@/utils/telemetry';

const SIGNUP_ENDPOINT = 'https://projelli.com/api/forms/projelli/app-onboarding';

interface WelcomeOnboardingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function WelcomeOnboardingDialog({ open, onOpenChange }: WelcomeOnboardingDialogProps) {
  const { markCompleted } = useOnboardingCompleted();
  const [email, setEmail] = useState('');
  const [emailOptIn, setEmailOptIn] = useState(false);
  const [telemetryOptIn, setTelemetryOptIn] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const close = () => {
    markCompleted();
    onOpenChange(false);
  };

  const handleSkip = () => {
    // Neither consent given. Telemetry stays 'unset' (no events sent).
    sendEventIfConsent('onboarding_skipped');
    close();
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    if (telemetryOptIn) {
      setTelemetryConsent('enabled');
    } else {
      setTelemetryConsent('disabled');
    }
    if (emailOptIn && email.trim() && isValidEmail(email)) {
      try {
        await fetch(SIGNUP_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email.trim(), source: 'app-onboarding' }),
        });
      } catch {
        // Best-effort — never block the close.
      }
      sendEventIfConsent('onboarding_email_submitted');
    } else {
      sendEventIfConsent('onboarding_completed_no_email');
    }
    setSubmitting(false);
    close();
  };

  const canSubmit =
    !emailOptIn || (email.trim().length > 0 && isValidEmail(email));

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleSkip(); else onOpenChange(o); }}>
      <DialogContent className="sm:max-w-lg" data-testid="welcome-onboarding-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <Sparkles className="h-5 w-5 text-primary" />
            Welcome to Projelli
          </DialogTitle>
          <DialogDescription>
            A couple of optional things — both off by default. Skip if you'd rather not.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Email opt-in */}
          <div className="space-y-2">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={emailOptIn}
                onChange={(e) => setEmailOptIn(e.target.checked)}
                className="mt-1 h-4 w-4 rounded border-border"
                data-testid="onboarding-email-optin"
              />
              <div className="space-y-1 flex-1">
                <p className="text-sm font-medium">
                  Email me launch updates, tips, and discount codes
                </p>
                <p className="text-xs text-muted-foreground">
                  Real updates only — no drip campaigns, no weekly newsletters.
                  Unsubscribe any time. Goes straight to Jameson.
                </p>
              </div>
            </label>
            {emailOptIn && (
              <div className="ml-7">
                <Label htmlFor="onboarding-email" className="sr-only">
                  Email
                </Label>
                <Input
                  id="onboarding-email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={submitting}
                  data-testid="onboarding-email-input"
                />
              </div>
            )}
          </div>

          {/* Telemetry opt-in */}
          <div>
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={telemetryOptIn}
                onChange={(e) => setTelemetryOptIn(e.target.checked)}
                className="mt-1 h-4 w-4 rounded border-border"
                data-testid="onboarding-telemetry-optin"
              />
              <div className="space-y-1 flex-1">
                <p className="text-sm font-medium">
                  Help improve Projelli with anonymous usage stats
                </p>
                <p className="text-xs text-muted-foreground">
                  Sends a random install ID, the app version, your platform,
                  and lifecycle events (trial started, license activated, etc.).
                  No content, no files, no AI prompts, no email.
                  You can turn this off in Settings → Privacy.
                </p>
              </div>
            </label>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="ghost" onClick={handleSkip} disabled={submitting} data-testid="onboarding-skip">
            Skip
          </Button>
          <Button onClick={handleSubmit} disabled={submitting || !canSubmit} data-testid="onboarding-save">
            {submitting ? 'Saving…' : 'Save and continue'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 254;
}

// Send an event only if telemetry is enabled. Onboarding-time milestones
// fire after consent is set, so this respects the just-flipped value.
function sendEventIfConsent(name: string): void {
  // sendEvent already gates on consent, so we can call it directly.
  void sendEvent(name);
}
