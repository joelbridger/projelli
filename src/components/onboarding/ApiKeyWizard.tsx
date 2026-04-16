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

import { useEffect, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { openExternal } from '@/utils/openExternal';
import { ExternalLink, Eye, EyeOff, Check, AlertCircle, ArrowLeft, ArrowRight, RefreshCw, Cpu } from 'lucide-react';
import { cn } from '@/lib/utils';
import { detectOllama } from '@/modules/models/OllamaProvider';

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
    costLine: 'Typical founder use: $2-5/month on Claude Haiku.',
    step2Title: 'Find "Create Key" on the Anthropic console',
    dashboardLabel: 'Anthropic Console',
  },
  openai: {
    id: 'openai',
    name: 'OpenAI (GPT)',
    consoleUrl: 'https://platform.openai.com/api-keys',
    placeholder: 'sk-...',
    prefix: /^sk-/,
    costLine: 'Typical founder use: $3-8/month on gpt-4o-mini.',
    step2Title: 'Find "Create new secret key" on the OpenAI platform',
    dashboardLabel: 'OpenAI Platform',
  },
  google: {
    id: 'google',
    name: 'Google AI (Gemini)',
    consoleUrl: 'https://aistudio.google.com/app/apikey',
    placeholder: 'AIza...',
    prefix: null, // Google keys have no fixed prefix
    costLine: 'Typical founder use: free tier usually covers it on Gemini 2.5 Flash.',
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
}

export function ApiKeyWizard({
  open,
  onOpenChange,
  onSaveKey,
  initialProvider = 'anthropic',
}: ApiKeyWizardProps) {
  const [provider, setProvider] = useState<WizardProvider>(initialProvider);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [keyText, setKeyText] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [ollamaStatus, setOllamaStatus] = useState<'idle' | 'checking' | 'ok' | 'missing'>('idle');
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);

  const meta = PROVIDERS[provider];

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
    setSubmitting(true);
    try {
      await onSaveKey(provider, keyText.trim());
      // Close on successful save.
      onOpenChange(false);
      reset();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
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
      <DialogContent className="max-w-xl" data-testid="api-key-wizard">
        <DialogHeader>
          <DialogTitle>Add an AI provider key</DialogTitle>
          <DialogDescription>
            A 3-step walk-through. Your key never leaves your computer.
          </DialogDescription>
        </DialogHeader>

        {/* Provider selector (tabs) */}
        <div className="flex gap-2 border-b border-border pb-3">
          {(Object.values(PROVIDERS) as ProviderMeta[]).map((p) => (
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

        {/* Stepper */}
        <Stepper currentStep={step} />

        {/* Step bodies */}
        {step === 1 && (
          <StepShell testid="api-key-wizard-step-1" title="Step 1. Go to the provider" description="We'll open their API keys page in your default browser.">
            <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3 text-sm">
              <p className="text-muted-foreground">
                Click the button below to open <strong className="text-foreground">{meta.dashboardLabel}</strong> in your browser.
                You'll need to sign in (or sign up) to get to the keys page.
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

        {step === 2 && (
          <StepShell testid="api-key-wizard-step-2" title="Step 2. Find the Create Key button" description={meta.step2Title}>
            <ProviderMockSvg label={meta.dashboardLabel} />
            <p className="text-xs text-muted-foreground mt-3">
              Look for a button labeled <strong className="text-foreground">Create API key</strong> (or similar).
              Click it, give the key a name like "Projelli", and copy the key it gives you.
              Most providers only show the full key once, so copy it right away.
            </p>
          </StepShell>
        )}

        {step === 3 && provider !== 'ollama' && (
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
                  }}
                  placeholder={meta.placeholder}
                  className={cn('pr-10 font-mono text-sm', error && 'border-destructive')}
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
              <p className="text-xs text-muted-foreground italic">{meta.costLine}</p>
            </div>
          </StepShell>
        )}

        {step === 3 && provider === 'ollama' && (
          <StepShell
            testid="api-key-wizard-step-3"
            title="Step 3. Check your Ollama connection"
            description="No API key needed — Ollama runs on your own machine."
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
                      Ollama is running{' '}
                      <span className="text-muted-foreground">
                        ({ollamaModels.length} model{ollamaModels.length === 1 ? '' : 's'} ready)
                      </span>
                    </span>
                  </>
                )}
                {ollamaStatus === 'missing' && (
                  <>
                    <AlertCircle className="h-4 w-4 text-amber-500" />
                    <span className="text-sm">
                      Ollama is not running. Install it, then click Check.
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
                Check Ollama connection
              </Button>
              <p className="text-xs text-muted-foreground italic">{meta.costLine}</p>
            </div>
          </StepShell>
        )}

        {/* Footer actions */}
        <div className="flex items-center justify-between pt-4 border-t border-border">
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

/**
 * Stylized SVG mock of a generic provider "API keys" dashboard, with the
 * "Create API key" button highlighted. Deliberately abstract so it works for
 * all three providers without misrepresenting any of them.
 */
function ProviderMockSvg({ label }: { label: string }) {
  return (
    <div className="rounded-lg border border-border bg-muted/20 p-3">
      <svg
        viewBox="0 0 420 200"
        className="w-full h-auto"
        role="img"
        aria-label={`${label} mock showing the Create API key button`}
      >
        {/* Window chrome */}
        <rect x="0" y="0" width="420" height="200" rx="8" className="fill-background" stroke="currentColor" strokeOpacity="0.15" />
        <circle cx="14" cy="14" r="3" className="fill-red-500/70" />
        <circle cx="26" cy="14" r="3" className="fill-yellow-500/70" />
        <circle cx="38" cy="14" r="3" className="fill-green-500/70" />
        {/* URL bar */}
        <rect x="54" y="8" width="340" height="14" rx="3" className="fill-muted" />
        <text x="62" y="18" fontSize="8" className="fill-muted-foreground" fontFamily="monospace">
          {label}
        </text>
        {/* Page header */}
        <text x="20" y="50" fontSize="14" fontWeight="bold" className="fill-foreground">
          API Keys
        </text>
        <text x="20" y="66" fontSize="9" className="fill-muted-foreground">
          Manage keys that authenticate your applications.
        </text>
        {/* Highlighted Create API key button */}
        <g>
          <rect
            x="290"
            y="44"
            width="110"
            height="28"
            rx="6"
            className="fill-primary"
          />
          <text x="345" y="62" fontSize="11" fontWeight="600" textAnchor="middle" className="fill-primary-foreground">
            Create API key
          </text>
          {/* pulsing ring */}
          <rect
            x="287"
            y="41"
            width="116"
            height="34"
            rx="8"
            fill="none"
            className="stroke-primary"
            strokeWidth="2"
            strokeDasharray="4 3"
            opacity="0.6"
          />
        </g>
        {/* Existing-keys table */}
        <rect x="20" y="90" width="380" height="1" className="fill-border" />
        <text x="20" y="108" fontSize="9" className="fill-muted-foreground">Name</text>
        <text x="180" y="108" fontSize="9" className="fill-muted-foreground">Created</text>
        <text x="280" y="108" fontSize="9" className="fill-muted-foreground">Last used</text>
        <rect x="20" y="114" width="380" height="1" className="fill-border" />
        {/* Empty state text */}
        <text x="210" y="155" fontSize="10" textAnchor="middle" className="fill-muted-foreground">
          You haven't created any keys yet. Click Create API key above.
        </text>
        {/* Arrow pointing at the button */}
        <path
          d="M 260 60 Q 275 60 285 58"
          fill="none"
          className="stroke-primary"
          strokeWidth="1.5"
          markerEnd="url(#arrowhead)"
        />
        <defs>
          <marker id="arrowhead" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
            <path d="M0,0 L0,6 L6,3 z" className="fill-primary" />
          </marker>
        </defs>
      </svg>
    </div>
  );
}

export default ApiKeyWizard;
