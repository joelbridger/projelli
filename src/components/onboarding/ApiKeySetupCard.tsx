// API key setup card for the BYOK onboarding flow (UX-04).
//
// Displayed in the MainPanel's "no file open" slot immediately after a user
// picks a workspace folder when they still don't have an AI key saved.
// Projelli's core value prop is AI + local files, and without a key the AI
// side is dead. Silent dead-ends are the #1 first-run complaint, so this
// card tells users exactly what's missing and gives them one click to fix it.
//
// Dismissal is session-scoped (sessionStorage) so the card reappears on a
// fresh app launch if keys are still missing. The session-storage flag is
// intentionally NOT keyed to app version — app-version keying would be
// appropriate for "What's new" banners, but for a critical onboarding nudge
// we'd rather show the card every session until the user actually adds a key.
//
// Introduced: Wave 2 / UX-04.

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Key, X, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';

const DISMISS_STORAGE_KEY = 'projelli:apiKeyCardDismissed';

export function hasDismissedApiKeyCard(): boolean {
  try {
    return sessionStorage.getItem(DISMISS_STORAGE_KEY) === 'true';
  } catch {
    // sessionStorage may be unavailable in strict privacy modes; treat as not
    // dismissed so the user still sees the nudge.
    return false;
  }
}

export function markApiKeyCardDismissed(): void {
  try {
    sessionStorage.setItem(DISMISS_STORAGE_KEY, 'true');
  } catch {
    // Ignore — worst case we show the card again on next action; still fine.
  }
}

interface ApiKeySetupCardProps {
  onAddKey: () => void;
  onDismiss: () => void;
  className?: string;
}

export function ApiKeySetupCard({ onAddKey, onDismiss, className }: ApiKeySetupCardProps) {
  return (
    <div
      data-testid="api-key-setup-card"
      className={cn(
        'flex-1 flex items-center justify-center p-8 h-full',
        className
      )}
    >
      <Card className="relative max-w-md w-full shadow-md">
        <Button
          data-testid="api-key-setup-card-dismiss"
          variant="ghost"
          size="sm"
          className="absolute right-2 top-2 h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
          onClick={onDismiss}
          aria-label="Dismiss"
          title="Dismiss (will reappear next session)"
        >
          <X className="h-4 w-4" />
        </Button>
        <CardContent className="pt-6 pb-6 px-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="rounded-full bg-primary/10 p-2.5">
              <Key className="h-5 w-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-semibold leading-tight">
                Next step: add your AI key
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                1 min setup
              </p>
            </div>
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Projelli uses your own API key from Anthropic, OpenAI, or Google.
            You only pay the provider for what you use — Projelli doesn&apos;t
            charge a subscription.
          </p>
          <Button
            data-testid="api-key-setup-card-cta"
            onClick={onAddKey}
            className="w-full gap-2"
          >
            Add API key
            <ArrowRight className="h-4 w-4" />
          </Button>
          <p className="text-xs text-muted-foreground text-center">
            Keys are stored locally on your computer — never sent to us.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

export default ApiKeySetupCard;
