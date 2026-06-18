/**
 * ApiKeyWizard — guided 3-step wizard for adding an AI provider API key (Q20, Wave 1.5).
 *
 * Used during first-run onboarding as an alternative to the flat
 * ApiKeySettings surface in the app Settings modal. Three steps:
 *   1. Open the provider's API-keys console in the default browser
 *   2. Show a labeled illustrated mock of where to click in the provider UI
 *   3. Paste the key, optionally show/hide, submit
 *
 * Submission calls the same save path as ApiKeySettings
 * (`onSaveKey(provider, key)`). Storage is unchanged — keys flow into the
 * existing KeychainService via the parent-supplied handler.
 *
 * Design notes:
 *   - Real provider screenshots are out of scope for this wave (Jameson-only
 *     per JAMESON_ACTION_PACK). Step 2 uses a stylized SVG mock of a generic
 *     "Create API key" dashboard instead.
 *   - The Anthropic URL is `console.anthropic.com/settings/keys`, OpenAI is
 *     `platform.openai.com/api-keys`, Google is
 *     `aistudio.google.com/app/apikey`. These are the exact canonical
 *     entry points specified in the Q20 ticket.
 *   - Format validation: Anthropic keys start with `sk-ant-`, OpenAI keys
 *     start with `sk-`. Google keys have no fixed prefix, so we only check
 *     for non-empty and reasonable length.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation, Trans } from 'react-i18next';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/ui/dialog';
import { openExternal } from '@/platform/utils/openExternal';
import { ExternalLink, Eye, EyeOff, Check, CheckCircle, XCircle, Loader2, AlertCircle, ArrowLeft, ArrowRight, RefreshCw, Cpu } from 'lucide-react';
import { cn } from '@/lib/utils';
import { detectOllama } from '@/platform/providers/OllamaProvider';
import {
  validateApiKeyLive,
  type ValidationProvider,
  type ValidationOutcome,
} from '@/platform/providers/apiKeyValidation';
import { PROVIDER_TUTORIALS, ProviderTutorialList, type ProviderId } from './ProviderTutorialSteps';

export type WizardProvider = 'anthropic' | 'openai' | 'google' | 'ollama';

interface ProviderMeta {
  id: WizardProvider;
  name: string;
  consoleUrl: string;
  placeholder: string;
  prefix: RegExp | null;
  costLine: string;
  step2Title: string;
  /** Short friendly description of the provider dashboard structure. */
  dashboardLabel: string;
}

const PROVIDERS: Record<WizardProvider, ProviderMeta> = {
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic (Claude)',
    consoleUrl: 'https://console.anthropic.com/settings/keys',
    placeholder: 'sk-ant-api03-...',
    prefix: /^sk-ant-/,
    costLine: 'Typical professional use: $2-5/month on Claude Haiku.',
    step2Title: 'Find "Create Key" on the Anthropic console',
    dashboardLabel: 'Anthropic Console',
  },
  openai: {
    id: 'openai',
    name: 'OpenAI (GPT)',
    consoleUrl: 'https://platform.openai.com/api-keys',
    placeholder: 'sk-...',
    prefix: /^sk-/,
    costLine: 'Typical professional use: $3-8/month on gpt-4o-mini.',
    step2Title: 'Find "Create new secret key" on the OpenAI platform',
    dashboardLabel: 'OpenAI Platform',
  },
  google: {
    id: 'google',
    name: 'Google AI (Gemini)',
    consoleUrl: 'https://aistudio.google.com/app/apikey',
    placeholder: 'AIza...',
    prefix: null, // Google keys have no fixed prefix
    costLine: 'Typical professional use: free tier usually covers it on Gemini 2.5 Flash.',
    step2Title: 'Find "Create API key" on Google AI Studio',
    dashboardLabel: 'Google AI Studio',
  },
  ollama: {
    id: 'ollama',
    name: 'Ollama (local)',
    consoleUrl: 'https://ollama.com/download',
    placeholder: '', // no key
    prefix: null,
    costLine: '$0/month. Inference runs on your own machine.',
    step2Title: 'Install Ollama and pull a model',
    dashboardLabel: 'Ollama',
  },
};

export interface ApiKeyWizardProps {
  /** Controls visibility of the modal. */
  open: boolean;
  /** Invoked when the user closes / completes / cancels the wizard. */
  onOpenChange: (open: boolean) => void;
  /**
   * Called with the final key text on submit. Should route into the same
   * storage path as ApiKeySettings (KeychainService). Called only when format
   * validation passes.
   */
  onSaveKey: (provider: WizardProvider, key: string) => void | Promise<void>;
  /** Initial provider to show. Defaults to `'anthropic'`. */
  initialProvider?: WizardProvider;
  /**
   * When true, the wizard renders only the step 2 tutorial content
   * (no step 1 console-launcher, no step 3 key-paste). Used by Settings,
   * Onboarding, "View API Key Tutorial" so users can revisit the guide
   * any time without going through the save path.
   */
  tutorialOnly?: boolean;
}

export function ApiKeyWizard({
  open,
  onOpenChange,
  onSaveKey,
  initialProvider = 'anthropic',
  tutorialOnly = false,
}: ApiKeyWizardProps) {
  const { t } = useTranslation();
  const [provider, setProvider] = useState<WizardProvider>(initialProvider);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [keyText, setKeyText] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Result of the live "is this key accepted by the provider?" check that runs
  // when the user clicks Save. `null` = not yet checked / nothing to show.
  const [validation, setValidation] = useState<
    { outcome: ValidationOutcome; message: string } | null
  >(null);
  const validationAbortRef = useRef<AbortController | null>(null);
  const [ollamaStatus, setOllamaStatus] = useState<'idle' | 'checking' | 'ok' | 'missing'>('idle');
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);

  const meta = PROVIDERS[provider];

  // Abort any in-flight validation when the wizard unmounts.
  useEffect(() => {
    return () => {
      validationAbortRef.current?.abort();
    };
  }, []);

  // Auto-detect Ollama when the user lands on step 3 of the Ollama flow.
  useEffect(() => {
    if (provider !== 'ollama' || step !== 3) return;
    let cancelled = false;
    setOllamaStatus('checking');
    void detectOllama().then((result) => {
      if (cancelled) return;
      setOllamaStatus(result.reachable ? 'ok' : 'missing');
      setOllamaModels(result.models);
    });
    return () => {
      cancelled = true;
    };
  }, [provider, step]);

  const reset = () => {
    setStep(1);
    setKeyText('');
    setShowKey(false);
    setError(null);
    setSubmitting(false);
    setValidation(null);
    validationAbortRef.current?.abort();
    validationAbortRef.current = null;
  };

  const changeProvider = (next: WizardProvider) => {
    setProvider(next);
    reset();
  };

  const handleOpenConsole = async () => {
    try {
      await openExternal(meta.consoleUrl);
    } catch (err) {
      console.warn('[ApiKeyWizard] failed to open console URL:', err);
    }
  };

  const validateFormat = (value: string): string | null => {
    const trimmed = value.trim();
    if (!trimmed) return 'Paste a key to continue.';
    if (trimmed.length < 8) return 'That looks too short to be an API key.';
    if (meta.prefix && !meta.prefix.test(trimmed)) {
      // Be helpful rather than pedantic: warn, but let users with forked prefixes through.
      return `${meta.name} keys usually start with "${meta.prefix.source.replace(/[\\^$]/g, '')}". Double-check you copied the right one.`;
    }
    return null;
  };

  const handleSubmit = async () => {
    if (provider === 'ollama') {
      // Ollama has no key — the "submit" gesture is confirming the
      // detected connection. Pass an empty string to onSaveKey so callers
      // that track configured-providers see the provider activate.
      setSubmitting(true);
      try {
        await onSaveKey(provider, '');
        onOpenChange(false);
        reset();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setSubmitting(false);
      }
      return;
    }
    const err = validateFormat(keyText);
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    setValidation(null);
    setSubmitting(true);

    const trimmedKey = keyText.trim();

    // Verify the key with the provider BEFORE declaring success. We reuse the
    // same minimal-call path the "Test this key" button uses (validateApiKeyLive),
    // so a rejected (401/403) key surfaces clearly instead of saving silently.
    // A 15s timeout means a slow/offline network falls back to "saved anyway"
    // rather than hanging the user forever.
    validationAbortRef.current?.abort();
    const ac = new AbortController();
    validationAbortRef.current = ac;
    const timeout = setTimeout(() => { ac.abort(); }, 15_000);

    let result: { outcome: ValidationOutcome; message: string };
    try {
      result = await validateApiKeyLive(
        provider as ValidationProvider,
        trimmedKey,
        ac.signal,
      );
    } catch (e) {
      // Unexpected throw — treat as "couldn't verify", let the save proceed.
      result = { outcome: 'network', message: e instanceof Error ? e.message : String(e) };
    } finally {
      clearTimeout(timeout);
      validationAbortRef.current = null;
    }

    // A clearly rejected key (bad/expired) must NOT be treated as a success.
    // Keep the wizard open so the user can paste a corrected key.
    if (result.outcome === 'rejected' || result.outcome === 'malformed') {
      setValidation(result);
      setSubmitting(false);
      return;
    }

    // 'ok' (verified) or 'network' (couldn't verify right now) both save.
    // For 'network' we save anyway and tell the user we couldn't verify it.
    setValidation(
      result.outcome === 'network'
        ? {
            outcome: 'network',
            message: "Couldn't verify the key right now, but it has been saved. We'll use it on your next request.",
          }
        : { outcome: 'ok', message: 'Key verified.' },
    );

    try {
      await onSaveKey(provider, trimmedKey);
      // Close on successful save.
      onOpenChange(false);
      reset();
    } catch (e) {
      setValidation({ outcome: 'rejected', message: e instanceof Error ? e.message : String(e) });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-xl flex flex-col max-h-[85vh] gap-0" data-testid="api-key-wizard">
        <DialogHeader className="shrink-0">
          <DialogTitle>{tutorialOnly ? 'API Key Tutorial' : 'Add an AI provider key'}</DialogTitle>
          <DialogDescription>
            {tutorialOnly
              ? 'Step-by-step guide to get an API key from each provider. Revisit any time.'
              : 'A 3-step walk-through. Your key never leaves your computer.'}
          </DialogDescription>
        </DialogHeader>

        {/* Scrollable body: the header above and the step navigation below stay
            pinned, while this region scrolls when the modal is taller than the
            window (e.g. the 800px-tall default desktop window). */}
        <div className="flex-1 min-h-0 overflow-y-auto space-y-4 py-4">

        {/* Provider selector (tabs) — exclude Ollama in tutorialOnly mode (no key needed) */}
        <div className="flex gap-2 border-b border-border pb-3">
          {(Object.values(PROVIDERS) as ProviderMeta[])
            .filter((p) => !tutorialOnly || p.id !== 'ollama')
            .map((p) => (
              <button
                key={p.id}
                data-testid={`api-key-wizard-provider-${p.id}`}
                onClick={() => changeProvider(p.id)}
                className={cn(
                  'px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
                  provider === p.id
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                )}
              >
                {p.name}
              </button>
            ))}
        </div>

        {/* Stepper (hidden in tutorial-only mode) */}
        {!tutorialOnly && <Stepper currentStep={step} />}

        {/* Tutorial-only mode: render the step-by-step content directly,
            no Visual tab and no save path. */}
        {tutorialOnly && provider !== 'ollama' && (
          <StepShell testid="api-key-wizard-step-2" title={meta.step2Title} description="Follow these steps on the provider's dashboard.">
            <ProviderTutorialList tutorial={PROVIDER_TUTORIALS[provider as ProviderId]} />
          </StepShell>
        )}

        {/* Step bodies (skipped entirely in tutorial-only mode) */}
        {!tutorialOnly && step === 1 && (
          <StepShell testid="api-key-wizard-step-1" title="Step 1. Go to the provider" description="We'll open their API keys page in your default browser.">
            <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3 text-sm">
              <p className="text-muted-foreground">
                <Trans
                  i18nKey="onboarding.api-key-wizard.step-1.body"
                  components={{ s: <strong className="text-foreground" /> }}
                  values={{ dashboard: meta.dashboardLabel }}
                />
              </p>
              <Button onClick={handleOpenConsole} className="gap-2" size="sm">
                Open {meta.dashboardLabel}
                <ExternalLink className="h-3.5 w-3.5" />
              </Button>
              <p className="text-xs text-muted-foreground">
                Link: <code className="text-foreground">{meta.consoleUrl}</code>
              </p>
            </div>
          </StepShell>
        )}

        {!tutorialOnly && step === 2 && provider !== 'ollama' && (
          <StepShell testid="api-key-wizard-step-2" title="Step 2. Find the Create Key button" description={meta.step2Title}>
            <ProviderTutorialList tutorial={PROVIDER_TUTORIALS[provider as ProviderId]} />
          </StepShell>
        )}

        {!tutorialOnly && step === 2 && provider === 'ollama' && (
          <StepShell testid="api-key-wizard-step-2" title="Step 2. Install Ollama and pull a model" description={meta.step2Title}>
            <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-2 text-sm">
              <p className="text-muted-foreground">
                <Trans
                  i18nKey="onboarding.api-key-wizard.step-2-ollama.body"
                  components={{ c: <code className="text-foreground" /> }}
                />
              </p>
            </div>
          </StepShell>
        )}

        {!tutorialOnly && step === 3 && provider !== 'ollama' && (
          <StepShell testid="api-key-wizard-step-3" title="Step 3. Paste your key" description="We'll store it in your OS keychain (or localStorage in browser mode).">
            <div className="space-y-3">
              <div className="relative">
                <Input
                  data-testid="api-key-wizard-input"
                  type={showKey ? 'text' : 'password'}
                  value={keyText}
                  onChange={(e) => {
                    setKeyText(e.target.value);
                    setError(null);
                    setValidation(null);
                  }}
                  placeholder={meta.placeholder}
                  className={cn('pr-10 font-mono text-sm', (error || validation?.outcome === 'rejected') && 'border-destructive')}
                />
                <button
                  type="button"
                  onClick={() => setShowKey((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label={showKey ? 'Hide key' : 'Show key'}
                >
                  {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {error && (
                <p className="text-xs text-destructive flex items-center gap-1.5">
                  <AlertCircle className="h-3.5 w-3.5" />
                  {error}
                </p>
              )}
              {submitting && !validation && (
                <p
                  data-testid="api-key-wizard-verifying"
                  className="text-xs text-muted-foreground flex items-center gap-1.5"
                >
                  <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                  {`Checking your key with ${meta.name.replace(/\s*\(.*\)\s*$/, '')}...`}
                </p>
              )}
              {validation && <WizardValidationBadge outcome={validation.outcome} message={validation.message} />}
              <p className="text-xs text-muted-foreground italic">{meta.costLine}</p>
            </div>
          </StepShell>
        )}

        {!tutorialOnly && step === 3 && provider === 'ollama' && (
          <StepShell
            testid="api-key-wizard-step-3"
            title="Step 3. Check your Ollama connection"
            description="No API key needed. Ollama runs on your own machine."
          >
            <div className="space-y-3">
              <div className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/20 px-3 py-2">
                {ollamaStatus === 'checking' && (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">Pinging Ollama...</span>
                  </>
                )}
                {ollamaStatus === 'ok' && (
                  <>
                    <Check className="h-4 w-4 text-emerald-500" />
                    <span className="text-sm">
                      {t('onboarding.api-key-wizard.ollama-running')}{' '}
                      <span className="text-muted-foreground">
                        ({t('onboarding.api-key-wizard.ollama-models-ready', { count: ollamaModels.length })})
                      </span>
                    </span>
                  </>
                )}
                {ollamaStatus === 'missing' && (
                  <>
                    <AlertCircle className="h-4 w-4 text-amber-500" />
                    <span className="text-sm">
                      {t('onboarding.api-key-wizard.ollama-not-running')}
                    </span>
                  </>
                )}
              </div>
              <Button
                data-testid="api-key-wizard-ollama-check"
                size="sm"
                variant="outline"
                onClick={async () => {
                  setOllamaStatus('checking');
                  const result = await detectOllama();
                  setOllamaStatus(result.reachable ? 'ok' : 'missing');
                  setOllamaModels(result.models);
                }}
                className="gap-1.5"
              >
                <Cpu className="h-3.5 w-3.5" />
                {t('onboarding.api-key-wizard.check-ollama')}
              </Button>
              <p className="text-xs text-muted-foreground italic">{meta.costLine}</p>
            </div>
          </StepShell>
        )}

        </div>
        {/* end scrollable body */}

        {/* Footer actions — pinned (shrink-0) so the step navigation stays
            reachable even when the body above scrolls. */}
        {tutorialOnly ? (
          <div className="shrink-0 flex items-center justify-end pt-4 border-t border-border bg-background">
            <Button
              data-testid="api-key-wizard-tutorial-close"
              size="sm"
              onClick={() => onOpenChange(false)}
              className="gap-1.5"
            >
              <Check className="h-3.5 w-3.5" />
              Close
            </Button>
          </div>
        ) : (
        <div className="shrink-0 flex items-center justify-between pt-4 border-t border-border bg-background">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setStep((s) => (s > 1 ? ((s - 1) as 1 | 2 | 3) : s))}
            disabled={step === 1}
            className="gap-1.5"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back
          </Button>
          {step < 3 ? (
            <Button
              size="sm"
              onClick={() => setStep((s) => ((s + 1) as 1 | 2 | 3))}
              className="gap-1.5"
            >
              Next
              <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          ) : (
            <Button
              data-testid="api-key-wizard-submit"
              size="sm"
              onClick={handleSubmit}
              disabled={
                submitting ||
                (provider === 'ollama' ? ollamaStatus !== 'ok' : !keyText.trim())
              }
              className="gap-1.5"
            >
              {submitting ? 'Saving...' : (
                <>
                  <Check className="h-3.5 w-3.5" />
                  {provider === 'ollama' ? 'Finish' : 'Save key'}
                </>
              )}
            </Button>
          )}
        </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

interface StepperProps {
  currentStep: 1 | 2 | 3;
}

function Stepper({ currentStep }: StepperProps) {
  const labels = ['Open console', 'Create key', 'Paste & save'];
  return (
    <ol className="flex items-center gap-2 py-3">
      {labels.map((label, idx) => {
        const n = (idx + 1) as 1 | 2 | 3;
        const isDone = n < currentStep;
        const isActive = n === currentStep;
        return (
          <li key={label} className="flex items-center gap-2 flex-1">
            <span
              className={cn(
                'inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold transition-colors',
                isActive
                  ? 'bg-primary text-primary-foreground'
                  : isDone
                    ? 'bg-primary/30 text-primary'
                    : 'bg-muted text-muted-foreground'
              )}
            >
              {isDone ? <Check className="h-3 w-3" /> : n}
            </span>
            <span
              className={cn(
                'text-xs',
                isActive ? 'text-foreground font-medium' : 'text-muted-foreground'
              )}
            >
              {label}
            </span>
            {idx < labels.length - 1 && (
              <span
                className={cn(
                  'flex-1 h-px',
                  n < currentStep ? 'bg-primary/40' : 'bg-border'
                )}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

interface StepShellProps {
  testid: string;
  title: string;
  description: string;
  children: ReactNode;
}

function StepShell({ testid, title, description, children }: StepShellProps) {
  return (
    <div data-testid={testid} className="space-y-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="text-xs text-muted-foreground">{description}</p>
      <div className="pt-1">{children}</div>
    </div>
  );
}

interface WizardValidationBadgeProps {
  outcome: ValidationOutcome;
  message: string;
}

/**
 * Inline result of the on-save key verification. Light-theme styling, matching
 * ApiKeyTester's ResultBadge: green check for a verified key, amber for the
 * "saved but couldn't verify right now" network fallback, destructive for a
 * key the provider rejected.
 */
function WizardValidationBadge({ outcome, message }: WizardValidationBadgeProps) {
  if (outcome === 'ok') {
    return (
      <p
        data-testid="api-key-wizard-result-ok"
        className="flex items-center gap-1.5 text-xs text-emerald-700 font-medium"
      >
        <CheckCircle className="h-3.5 w-3.5 shrink-0" />
        {message}
      </p>
    );
  }

  if (outcome === 'network') {
    return (
      <p
        data-testid="api-key-wizard-result-network"
        className="flex items-center gap-1.5 text-xs text-amber-700"
      >
        <AlertCircle className="h-3.5 w-3.5 shrink-0" />
        {message}
      </p>
    );
  }

  // 'rejected' or 'malformed' — the key did not work.
  return (
    <p
      data-testid={`api-key-wizard-result-${outcome}`}
      className="flex items-center gap-1.5 text-xs text-destructive"
    >
      <XCircle className="h-3.5 w-3.5 shrink-0" />
      {message}
    </p>
  );
}

export default ApiKeyWizard;
