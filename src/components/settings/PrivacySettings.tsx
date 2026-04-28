/**
 * PrivacySettings — controls for the two opt-ins offered at first launch.
 *
 *   - Anonymous telemetry: lifecycle events (no PII, no content). Toggle
 *     can be flipped on or off at any time.
 *   - Email updates: the user's address (if they gave one) and the option
 *     to remove themselves. Currently unsubscribe is manual ("reply UNSUB
 *     to any email"); this panel just shows what's been recorded.
 *
 * Designed to be the most boring, transparent screen in the app — the
 * pitch is "you control this, and we tell you exactly what's collected."
 */

import { Button } from '@/components/ui/button';
import { useTelemetryConsent } from '@/hooks/useTelemetryConsent';
import { getInstallId } from '@/utils/installId';

export function PrivacySettings() {
  const { consent, setConsent } = useTelemetryConsent();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Privacy</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Projelli is local-first. Your files, your AI prompts, and your
          API keys never leave your machine. The two opt-ins below are
          the only data Projelli ever collects, and both default to off.
        </p>
      </div>

      {/* Telemetry opt-in */}
      <div className="rounded-lg border border-border bg-card p-6 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <h3 className="text-base font-semibold">Anonymous usage stats</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Help improve Projelli by sending lifecycle events: app launches,
              trial start, trial end, license activated, license deactivated.
              No content, no files, no AI prompts, no email.
            </p>
          </div>
          <Button
            variant={consent === 'enabled' ? 'default' : 'outline'}
            size="sm"
            onClick={() =>
              setConsent(consent === 'enabled' ? 'disabled' : 'enabled')
            }
            data-testid="privacy-telemetry-toggle"
          >
            {consent === 'enabled' ? 'Enabled' : 'Disabled'}
          </Button>
        </div>
        <div className="border-t pt-4 space-y-2 text-xs text-muted-foreground">
          <p className="font-medium text-foreground">What is sent, exactly:</p>
          <ul className="space-y-1 ml-4 list-disc">
            <li>
              <code>install_id</code>: a random UUID generated on this machine
              (visible below). Not tied to your email or license.
            </li>
            <li>
              <code>app_version</code>, <code>platform</code>: which build of
              Projelli, and macOS / Windows / Linux.
            </li>
            <li>
              <code>event</code>: one of <code>app_launch</code>,
              <code> trial_start</code>, <code> trial_end</code>,
              <code> license_activated</code>, <code> license_deactivated</code>.
            </li>
            <li>
              <code>license_tier</code> (when relevant): trial, pro, lifetime.
            </li>
          </ul>
          <p>
            Endpoint: <code>projelli.com/api/forms/projelli/app-event</code>.
            JSONL stored on Jameson's server. Used only for funnel metrics
            and roadmap decisions.
          </p>
          <p>
            Your install ID:{' '}
            <code className="px-1 py-0.5 rounded bg-muted">{getInstallId()}</code>
          </p>
        </div>
      </div>

      {/* Email updates note */}
      <div className="rounded-lg border border-border bg-card p-6 space-y-3">
        <h3 className="text-base font-semibold">Email updates</h3>
        <p className="text-sm text-muted-foreground">
          If you opted into email updates at first launch (or via the website),
          you'll get launch announcements and discount codes. No drip campaigns,
          no weekly newsletters.
        </p>
        <p className="text-sm text-muted-foreground">
          To remove yourself from the list, reply <code>UNSUB</code> to any email
          from Jameson — they all forward straight to him.
        </p>
      </div>
    </div>
  );
}
