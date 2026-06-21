/* eslint-disable keepance-i18n/no-hardcoded-string */
/**
 * SetupChecklist — live setup status shown at the top of Settings, Onboarding.
 *
 * Derives status fresh on mount (not from the onboarding progress map) so
 * it stays accurate even after manual changes in other Settings panels.
 */

import { useEffect, useState } from 'react';
import { CheckCircle2, Circle, RefreshCw } from 'lucide-react';
import { Button } from '@/ui/button';
import { cn } from '@/lib/utils';
import { useApiKeys } from '@/platform/hooks/useApiKeys';
import { useFirm } from '@/platform/hooks/useFirm';
import { mailIsConnected, gmailIsConnected, mailImapIsConnected } from '@/platform/utils/mail-commands';
import type { SettingCategory } from '@/platform/settings/schema';

interface SetupChecklistProps {
  /** Trigger the GuidedOnboarding flow non-destructively (re-shows without clearing data). */
  onRestartOnboarding: () => void;
  /** Navigate to another settings category by id. */
  onNavigate: (category: SettingCategory) => void;
}

interface ChecklistRowProps {
  label: string;
  connected: boolean | null;
  actionLabel?: string;
  onAction: () => void;
}

function ChecklistRow({ label, connected, onAction }: ChecklistRowProps) {
  const isLoading = connected === null;

  return (
    <div className="flex items-center gap-3 py-2">
      {isLoading ? (
        <Circle className="h-4 w-4 text-muted-foreground/40 flex-none animate-pulse" />
      ) : connected ? (
        <CheckCircle2 className="h-4 w-4 text-emerald-600 flex-none" />
      ) : (
        <Circle className="h-4 w-4 text-muted-foreground flex-none" />
      )}
      <span
        className={cn(
          'flex-1 text-sm',
          isLoading && 'text-muted-foreground'
        )}
      >
        {label}
      </span>
      <Button
        variant="outline"
        size="sm"
        onClick={onAction}
        disabled={isLoading}
        className="text-xs"
      >
        {isLoading ? 'Checking...' : connected ? 'Manage' : 'Set up'}
      </Button>
    </div>
  );
}

export function SetupChecklist({ onRestartOnboarding, onNavigate }: SetupChecklistProps) {
  const { apiKeys } = useApiKeys();
  const { isSignedIn: firmSignedIn } = useFirm();
  const [emailConnected, setEmailConnected] = useState<boolean | null>(null);

  const aiConnected = apiKeys.some((k) => k.isValid);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      mailIsConnected().catch(() => false),
      gmailIsConnected().catch(() => false),
      mailImapIsConnected().catch(() => false),
    ]).then(([m365, gmail, imap]) => {
      if (!cancelled) setEmailConnected(m365 || gmail || imap);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div
      data-testid="setup-checklist"
      className="rounded-lg border border-border bg-muted/20 p-4 mb-6 space-y-1"
    >
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
        Setup checklist
      </p>

      <ChecklistRow
        label="AI connected"
        connected={aiConnected}
        onAction={() => { onNavigate('ai'); }}
      />

      <ChecklistRow
        label="Email connected"
        connected={emailConnected}
        onAction={() => {
          window.dispatchEvent(new CustomEvent('keepance:open-account', { detail: { tab: 'connections' } }));
        }}
      />

      <ChecklistRow
        label="Firm"
        connected={firmSignedIn}
        onAction={() => { onNavigate('firm'); }}
      />

      <div className="pt-3 border-t border-border mt-2 flex flex-col gap-1">
        <Button
          data-testid="watch-setup-intro-again"
          variant="ghost"
          size="sm"
          className="gap-1.5 text-xs self-start"
          onClick={onRestartOnboarding}
        >
          <RefreshCw className="h-3 w-3" />
          Watch the setup intro again
        </Button>
        <p className="text-xs text-muted-foreground">Your data and keys are kept.</p>
      </div>
    </div>
  );
}
