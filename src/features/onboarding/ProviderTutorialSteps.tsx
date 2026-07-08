/**
 * Per-provider API-key tutorial content for the ApiKeyWizard Step 2.
 *
 * Shape: one `ProviderTutorial` per provider, with 3-5 short steps
 * each describing a click or value. Intentionally text-first + SVG-
 * illustrated so the tutorial doesn't depend on live screenshots
 * (which rot when providers redesign their dashboards).
 *
 * Accessed from:
 *   1. ApiKeyWizard step 2 (tabbed content)
 *   2. Settings, Onboarding, "View API Key Tutorial" action
 */
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ExternalLink } from 'lucide-react';
import { openExternal } from '@/platform/utils/openExternal';
import { Button } from '@/ui/button';
import { BRAND } from '@/config/brand';

export type ProviderId = 'anthropic' | 'openai' | 'google';

export interface TutorialStep {
  title: string;
  body: string;
  /** Optional hint line rendered under the body. */
  hint?: string;
}

export interface ProviderTutorial {
  providerId: ProviderId;
  providerName: string;
  /** Direct URL to the API keys page. */
  consoleUrl: string;
  /** Direct URL to billing / usage page (shown at end of tutorial). */
  billingUrl: string;
  steps: TutorialStep[];
}

export const PROVIDER_TUTORIALS: Record<ProviderId, ProviderTutorial> = {
  anthropic: {
    providerId: 'anthropic',
    providerName: 'Anthropic (Claude)',
    consoleUrl: 'https://console.anthropic.com/settings/keys',
    billingUrl: 'https://console.anthropic.com/settings/billing',
    steps: [
      {
        title: 'Open console.anthropic.com',
        body: 'Sign up or log in. First-time users get free tier credits automatically.',
      },
      {
        title: 'Go to Settings, then API Keys',
        body: 'The left sidebar has a "Settings" entry. Inside, click "API Keys" (look for API Keys in the sidebar).',
      },
      {
        title: 'Click "Create Key"',
        body: `A dialog opens. Give it a label like "${BRAND.name}" so you remember where it goes. Leave the Anthropic "Workspace" dropdown on its default (this is Anthropic's billing workspace, not your ${BRAND.name} workspace).`,
      },
      {
        title: 'Copy the key and paste it here',
        body: 'Anthropic shows the key once in this dialog. Copy it and paste it into the field below.',
        hint: 'Keys start with sk-ant-. If you lose it, you can always create another one.',
      },
      {
        title: 'Add credits (if needed)',
        body: 'New accounts have free-tier credits for about a week. After that, add a credit balance at Settings, then Billing.',
      },
    ],
  },
  openai: {
    providerId: 'openai',
    providerName: 'OpenAI (GPT)',
    consoleUrl: 'https://platform.openai.com/api-keys',
    billingUrl: 'https://platform.openai.com/settings/organization/billing',
    steps: [
      {
        title: 'Open platform.openai.com',
        body: 'This is NOT the same as chat.openai.com (your ChatGPT subscription). API access is a separate product with separate billing.',
        hint: 'If you only have ChatGPT Plus, you need a new account here. They do not share credits.',
      },
      {
        title: 'Go to API Keys',
        body: 'Left sidebar, then "API Keys" (under "Organization" section).',
      },
      {
        title: 'Click "Create new secret key"',
        body: `Name it "${BRAND.name}". Permissions: "All" is fine. Click Create.`,
      },
      {
        title: 'Copy the key and paste it here',
        body: 'The key is shown once in this dialog. Copy it and paste it into the field below. If you lose it, you can always create another one. Starts with sk-proj- or sk-.',
      },
      {
        title: 'Add billing credit',
        body: 'OpenAI requires prepaid credit for API use (unlike ChatGPT Plus). Go to Billing, add a payment method, and add an initial credit balance.',
      },
    ],
  },
  google: {
    providerId: 'google',
    providerName: 'Google (Gemini)',
    consoleUrl: 'https://aistudio.google.com/app/apikey',
    billingUrl: 'https://ai.google.dev/pricing',
    steps: [
      {
        title: 'Open aistudio.google.com',
        body: 'Sign in with a regular Google account. No credit card required for the free tier.',
      },
      {
        title: 'Click "Get API key"',
        body: 'Usually a big button in the top-right. If not, the left nav has "API keys".',
      },
      {
        title: 'Click "Create API key"',
        body: 'A dialog asks whether to create in an existing Cloud project or a new one. Pick "Create API key in new project" if unsure; easiest path.',
      },
      {
        title: 'Copy the key and paste it here',
        body: 'Starts with AIza. Paste it into the field below. You can return to Google AI Studio any time to view or create keys.',
        hint: 'Google keys are the most forgiving, visible anytime in the AI Studio UI.',
      },
      {
        title: 'Free tier is usually enough',
        body: 'Gemini Flash free tier is 1500 requests/day with 1M tokens/minute. Most users never exceed this. No billing setup needed unless you want higher limits.',
      },
    ],
  },
};

export function ProviderTutorialList({ tutorial }: { tutorial: ProviderTutorial }): ReactNode {
  const { t } = useTranslation();
  const handleOpen = (url: string) => {
    void openExternal(url);
  };
  return (
    <div className="space-y-4" data-testid={`api-key-tutorial-${tutorial.providerId}`}>
      <div className="text-sm text-muted-foreground">
        <strong>{tutorial.providerName}</strong>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          onClick={() => handleOpen(tutorial.consoleUrl)}
          data-testid={`api-key-tutorial-open-console-${tutorial.providerId}`}
          className="gap-1.5"
        >
          {t('onboarding.tutorial.open-api-keys')}
          <ExternalLink className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => handleOpen(tutorial.billingUrl)}
          data-testid={`api-key-tutorial-open-billing-${tutorial.providerId}`}
          className="gap-1.5"
        >
          Billing / pricing
          <ExternalLink className="h-3.5 w-3.5" />
        </Button>
      </div>
      <ol className="space-y-3 list-decimal list-inside">
        {tutorial.steps.map((step, index) => (
          <li
            key={index}
            className="text-sm"
            data-testid={`api-key-tutorial-step-${tutorial.providerId}-${index + 1}`}
          >
            <span className="font-semibold">{step.title}</span>
            <p className="ml-6 mt-1 text-muted-foreground">{step.body}</p>
            {step.hint && (
              <p className="ml-6 mt-1 text-xs italic text-muted-foreground border-l-2 border-muted pl-3">
                {step.hint}
              </p>
            )}
          </li>
        ))}
      </ol>
      <div className="text-xs text-muted-foreground pt-2 border-t space-y-1">
        <div>
          {t('onboarding.tutorial.direct-urls')}
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          <button
            type="button"
            onClick={() => handleOpen(tutorial.consoleUrl)}
            className="underline text-left break-all hover:text-foreground"
          >
            {tutorial.consoleUrl}
          </button>
          <button
            type="button"
            onClick={() => handleOpen(tutorial.billingUrl)}
            className="underline text-left break-all hover:text-foreground"
          >
            {tutorial.billingUrl}
          </button>
        </div>
      </div>
    </div>
  );
}
