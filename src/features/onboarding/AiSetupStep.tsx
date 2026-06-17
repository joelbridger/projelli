/**
 * AiSetupStep — the rebuilt "connect an AI" step of first-run onboarding.
 *
 * THE CORE FIX. UX research found the single biggest first-run drop-off was the
 * old "paste your API key" step: a non-technical attorney hit "paste your API
 * key", did not know what that was, and abandoned. This step is rebuilt so that
 * a non-technical lawyer:
 *
 *   1. reads plain English BEFORE any jargon (what an AI account is, where the
 *      data goes, who they pay),
 *   2. chooses between three clear paths instead of one intimidating field,
 *   3. never dead-ends: "Set this up later" is always available and shameless.
 *
 * The three paths:
 *   - Use your own AI account (recommended): guided "get your key" steps per
 *     provider (Claude / OpenAI / Gemini) + a link, then paste, then the
 *     existing "Test this key" button (praised in research, kept verbatim).
 *   - Keep everything on your computer (Ollama): for the most sensitive work.
 *     Ties to Local-only confidentiality mode and detects Ollama; guides if it
 *     is not installed.
 *   - Set this up later: sets a flag and lets onboarding finish. The AI pane
 *     shows a gentle, persistent reminder until a model is connected.
 *
 * COPY ACCURACY IS LOAD-BEARING. This audience distrusts jargon and marketing.
 * The wording here is the product, so it is intentionally inlined (not split
 * into i18n keys) for exactness, the same decision made for DataMapDialog.
 * Localising it is a separate, careful effort.
 */

/* eslint-disable keepance-i18n/no-hardcoded-string */
import { useEffect, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Cloud,
  Laptop,
  Clock,
  Check,
  ExternalLink,
  RefreshCw,
  ShieldCheck,
  HelpCircle,
} from 'lucide-react';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { cn } from '@/lib/utils';
import { ApiKeyTester } from '@/features/onboarding/ApiKeyTester';
import {
  PROVIDER_TUTORIALS,
  type ProviderId,
} from '@/features/onboarding/ProviderTutorialSteps';
import { detectOllama } from '@/platform/providers/OllamaProvider';
import { useSetConfidentialityMode } from '@/platform/hooks/useConfidentialityMode';
import { openExternal } from '@/platform/utils/openExternal';
import { clearAiSetupDeferred } from '@/features/onboarding/aiSetupState';
import type { KeyProvider } from '@/platform/providers/KeychainService';
import { useProfessionCopy } from '@/features/onboarding/useProfessionCopy';
import { sendDiagnosticEvent } from '@/platform/utils/diagnostics';

/** Which screen of the AI-setup step the user is on. */
type View = 'choose' | 'own-account' | 'local';

export interface AiSetupStepProps {
  /** Pre-select a provider for the "own account" flow (from the profession default). */
  defaultProvider?: ProviderId;
  /** Back to the previous wizard step (the data-map step). */
  onBack: () => void;
  /**
   * Called when the user successfully connects a cloud key. The handler should
   * route into the same save path Settings uses (KeychainService.setKey). The
   * step advances the wizard after this resolves.
   */
  onSaveKey: (provider: KeyProvider, key: string) => void | Promise<void>;
  /**
   * Called when the user confirms a local model (Ollama). Lets the host wizard
   * advance and record that a local model is connected.
   */
  onUseLocal: () => void;
  /** Called when the user genuinely skips ("Set this up later"). */
  onSkip: () => void;
  /** Open the always-available "Where does my data go?" data map. */
  onOpenDataMap: () => void;
}

const PROVIDER_ORDER: ProviderId[] = ['anthropic', 'openai', 'google'];

export function AiSetupStep({
  defaultProvider = 'anthropic',
  onBack,
  onSaveKey,
  onUseLocal,
  onSkip,
  onOpenDataMap,
}: AiSetupStepProps) {
  const [view, setView] = useState<View>('choose');

  return (
    <div className="space-y-6" data-testid="ai-setup-step">
      {view === 'choose' && (
        <ChooseView
          onPickOwnAccount={() => { setView('own-account'); }}
          onPickLocal={() => { setView('local'); }}
          onSkip={onSkip}
          onBack={onBack}
          onOpenDataMap={onOpenDataMap}
        />
      )}
      {view === 'own-account' && (
        <OwnAccountView
          defaultProvider={defaultProvider}
          onSaveKey={onSaveKey}
          onBack={() => { setView('choose'); }}
          onOpenDataMap={onOpenDataMap}
        />
      )}
      {view === 'local' && (
        <LocalView
          onUseLocal={onUseLocal}
          onBack={() => { setView('choose'); }}
          onOpenDataMap={onOpenDataMap}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// View 1 — plain English, then the three paths.
// ---------------------------------------------------------------------------

interface ChooseViewProps {
  onPickOwnAccount: () => void;
  onPickLocal: () => void;
  onSkip: () => void;
  onBack: () => void;
  onOpenDataMap: () => void;
}

function ChooseView({
  onPickOwnAccount,
  onPickLocal,
  onSkip,
  onBack,
  onOpenDataMap,
}: ChooseViewProps) {
  const professionCopy = useProfessionCopy();
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight" style={{ color: 'var(--kp-navy)' }}>Connect your AI provider account</h2>
        <p className="text-base text-muted-foreground mt-1">
          One short choice, then you are done. There is no wrong answer here.
        </p>
      </div>

      {/* Plain English subtitle + data-map link. */}
      <div className="space-y-1">
        <p className="text-sm text-muted-foreground leading-relaxed">
          Keepance connects to your own AI account. Your questions go straight there, never through us.
        </p>
        <button
          type="button"
          data-testid="ai-setup-data-map-link-choose"
          onClick={onOpenDataMap}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-primary underline underline-offset-2 hover:text-primary/80"
        >
          <ShieldCheck className="h-3.5 w-3.5" />
          Where does my data go?
        </button>
      </div>

      {/* Three paths. BYOK is the recommended default; Skip is last, lighter. */}
      <div className="space-y-3">
        <PathCard
          testId="ai-path-own-account"
          icon={Cloud}
          tone="text-sky-700 bg-sky-50"
          title="Connect your AI provider account"
          badge="Recommended for legal work"
          prominent
          body={`Connect your Claude, OpenAI, or Gemini account with a few clicks. We walk you through it step by step. Your AI usage goes straight to your provider. ${professionCopy.estimatedCostDesc}`}
          onClick={onPickOwnAccount}
        />
        <PathCard
          testId="ai-path-local"
          icon={Laptop}
          tone="text-emerald-700 bg-emerald-50"
          title="Keep everything on your computer"
          badge="Maximum privacy. Less capable for legal work."
          body="Run a free AI model on your own machine with a tool called Ollama. Nothing is sent over the internet, not even to an AI company. We will check whether it is installed and help you if it is not."
          onClick={onPickLocal}
        />
        <SkipCard
          testId="ai-path-later"
          onSkip={onSkip}
        />
      </div>

      <div className="flex justify-between pt-4 border-t border-border">
        <Button variant="ghost" onClick={onBack} className="gap-1.5">
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
      </div>
    </div>
  );
}

interface PathCardProps {
  testId: string;
  icon: typeof Cloud;
  tone: string;
  title: string;
  badge?: string;
  body: string;
  onClick: () => void;
  /** When true, renders with the navy border + shadow to signal the recommended path. */
  prominent?: boolean;
}

function PathCard({ testId, icon: Icon, tone, title, badge, body, onClick, prominent }: PathCardProps) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      className="group flex w-full items-start gap-4 rounded-lg border bg-card p-4 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring hover:bg-muted/30"
      style={prominent
        ? { borderColor: '#0a2540', boxShadow: '0 2px 10px rgba(10,37,64,0.12)' }
        : undefined}
    >
      <div className={cn('shrink-0 h-10 w-10 rounded-md flex items-center justify-center', tone)} aria-hidden>
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="text-sm font-semibold text-muted-foreground">{title}</h3>
          {badge && (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
              {badge}
            </span>
          )}
        </div>
        <p className="mt-1 text-xs text-muted-foreground leading-relaxed">{body}</p>
      </div>
      <ArrowRight className="h-4 w-4 shrink-0 self-center text-muted-foreground transition-colors group-hover:text-primary" />
    </button>
  );
}

/** The "skip for now" option. Styled as a secondary, lighter card. */
function SkipCard({ testId, onSkip }: { testId: string; onSkip: () => void }) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onSkip}
      className="group flex w-full items-center gap-4 rounded-lg border border-border bg-muted/10 p-4 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring hover:bg-muted/20"
    >
      <div className="shrink-0 h-10 w-10 rounded-md flex items-center justify-center text-slate-700 bg-slate-100" aria-hidden>
        <Clock className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="text-sm font-semibold text-foreground">Skip for now</h3>
        <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">
          Your files, templates, and workflows work without an AI. You can connect one any time in Settings.
        </p>
      </div>
      <ArrowRight className="h-4 w-4 shrink-0 self-center text-foreground transition-colors group-hover:text-primary" />
    </button>
  );
}

// ---------------------------------------------------------------------------
// View 2 — "Use your own AI account": guided get-your-key + paste + test.
// ---------------------------------------------------------------------------

interface OwnAccountViewProps {
  defaultProvider: ProviderId;
  onSaveKey: (provider: KeyProvider, key: string) => void | Promise<void>;
  onBack: () => void;
  onOpenDataMap: () => void;
}

/** Plain, jargon-light names for the provider chooser. */
const PROVIDER_PLAIN_NAME: Record<ProviderId, string> = {
  anthropic: 'Claude',
  openai: 'OpenAI',
  google: 'Gemini',
};

function OwnAccountView({ defaultProvider, onSaveKey, onBack, onOpenDataMap }: OwnAccountViewProps) {
  const [provider, setProvider] = useState<ProviderId>(defaultProvider);
  const [keyText, setKeyText] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tutorial = PROVIDER_TUTORIALS[provider];

  const handleSave = async () => {
    setError(null);
    setSaving(true);
    try {
      await onSaveKey(provider as KeyProvider, keyText.trim());
      // Saved successfully: this is no longer "deferred".
      clearAiSetupDeferred();
      // WS6 diagnostics — provider name only, no key content captured.
      void sendDiagnosticEvent({ event: 'provider_connected', provider }).catch(() => undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-3xl font-bold tracking-tight" style={{ color: 'var(--kp-navy)' }}>Connect your AI provider account</h2>
        <p className="text-base text-muted-foreground mt-1">
          Pick a provider, follow the steps to get your account key, then paste it below.
        </p>
      </div>

      {/* Provider chooser, plain names. */}
      <div className="flex gap-2" role="tablist" aria-label="AI provider">
        {PROVIDER_ORDER.map((id) => {
          const selected = provider === id;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={selected}
              data-testid={`ai-provider-tab-${id}`}
              onClick={() => {
                setProvider(id);
                setKeyText('');
                setError(null);
              }}
              className={cn(
                'flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                selected
                  ? 'border-primary bg-primary/10 text-foreground'
                  : 'border-border text-muted-foreground hover:bg-muted/30',
              )}
            >
              {PROVIDER_PLAIN_NAME[id]}
            </button>
          );
        })}
      </div>

      {/* "What's that?" one-liner, the first time we name the key. */}
      <p className="text-xs text-muted-foreground">
        You will copy a short code called an <span className="font-medium text-foreground">account key</span>.{' '}
        <span className="italic">
          What is that? It is like a password that lets your computer talk directly to {PROVIDER_PLAIN_NAME[provider]}. You create it on their site, paste it here once, and Keepance stores it in your computer&rsquo;s secure keychain, never on a server.
        </span>
      </p>

      {/* Guided "get your key" steps for this provider. */}
      <div className="rounded-lg border border-border bg-muted/20 p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-semibold text-foreground">
            How to get your {PROVIDER_PLAIN_NAME[provider]} key
          </p>
          <Button
            type="button"
            size="sm"
            onClick={() => void openExternal(tutorial.consoleUrl)}
            data-testid={`ai-open-console-${provider}`}
            className="gap-1.5"
          >
            Open {PROVIDER_PLAIN_NAME[provider]}
            <ExternalLink className="h-3.5 w-3.5" />
          </Button>
        </div>
        <ol className="space-y-2 text-xs text-muted-foreground">
          {tutorial.steps.map((step, i) => (
            <li key={i} className="flex gap-2" data-testid={`ai-get-key-step-${provider}-${String(i + 1)}`}>
              <span className="shrink-0 inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
                {i + 1}
              </span>
              <span>
                <span className="font-medium text-foreground">{step.title}.</span> {step.body}
              </span>
            </li>
          ))}
        </ol>
      </div>

      {/* Paste + test. */}
      <div className="space-y-2">
        <label htmlFor="ai-setup-key-input" className="text-sm font-medium text-foreground">
          Paste your {PROVIDER_PLAIN_NAME[provider]} account key here
        </label>
        <Input
          id="ai-setup-key-input"
          type="password"
          placeholder={provider === 'anthropic' ? 'sk-ant-api03-...' : provider === 'openai' ? 'sk-...' : 'AIza...'}
          value={keyText}
          onChange={(e) => { setKeyText(e.target.value); }}
          className="font-mono"
          data-testid="ai-setup-key-input"
        />
        {/* Existing, research-praised "Test this key" button + result states. */}
        {keyText.trim() && <ApiKeyTester provider={provider} apiKey={keyText} />}
        {error && (
          <p className="text-xs text-destructive" data-testid="ai-setup-save-error">
            {error}
          </p>
        )}
        <button
          type="button"
          data-testid="ai-setup-data-map-link-own"
          onClick={onOpenDataMap}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <HelpCircle className="h-3.5 w-3.5" />
          Where does my data go when I use {PROVIDER_PLAIN_NAME[provider]}?
        </button>
      </div>

      <div className="flex items-center justify-between gap-2 pt-4 border-t border-border">
        <Button variant="ghost" onClick={onBack} className="gap-1.5" disabled={saving}>
          <ArrowLeft className="h-4 w-4" />
          Other options
        </Button>
        <Button
          onClick={() => void handleSave()}
          size="lg"
          disabled={!keyText.trim() || saving}
          data-testid="ai-setup-save-key"
        >
          {saving ? 'Saving...' : 'Save and continue'}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// View 3 — "Keep everything on your computer" (Ollama / Local-only).
// ---------------------------------------------------------------------------

interface LocalViewProps {
  onUseLocal: () => void;
  onBack: () => void;
  onOpenDataMap: () => void;
}

type OllamaStatus =
  | { kind: 'checking' }
  | { kind: 'ready'; models: string[] }
  | { kind: 'reachable-no-models' }
  | { kind: 'missing' };

const OLLAMA_DOWNLOAD_URL = 'https://ollama.com/download';

function LocalView({ onUseLocal, onBack, onOpenDataMap }: LocalViewProps) {
  const setMode = useSetConfidentialityMode();
  const [status, setStatus] = useState<OllamaStatus>({ kind: 'checking' });
  const professionCopy = useProfessionCopy();

  const check = () => {
    setStatus({ kind: 'checking' });
    void detectOllama().then((result) => {
      if (!result.reachable) {
        setStatus({ kind: 'missing' });
      } else if (result.models.length === 0) {
        setStatus({ kind: 'reachable-no-models' });
      } else {
        setStatus({ kind: 'ready', models: result.models });
      }
    });
  };

  useEffect(() => {
    // Defer to microtask so the synchronous setStatus('checking') inside check()
    // does not fire directly in the effect body (satisfies react-hooks/set-state-in-effect).
    void Promise.resolve().then(check);
    // Run once on mount.

  }, []);

  const handleConfirm = () => {
    // Tie this path to Local-only confidentiality mode: in that mode nothing
    // leaves the machine. Clearing the deferred flag because AI is now usable.
    setMode('local-only');
    clearAiSetupDeferred();
    onUseLocal();
  };

  return (
    <div className="space-y-5" data-testid="ai-setup-local-view">
      <div>
        <h2 className="text-3xl font-bold tracking-tight" style={{ color: 'var(--kp-navy)' }}>Maximum privacy. Less capable for legal work.</h2>
        <p className="text-base text-muted-foreground mt-1">
          Run the AI on your own machine. Nothing is sent over the internet, not
          even to an AI company.
        </p>
      </div>

      <div className="rounded-lg border border-border bg-emerald-50/60 p-4 text-sm text-foreground leading-relaxed space-y-2">
        <p>
          Local models keep everything on your machine, but are meaningfully less capable for legal drafting
          and analysis than Claude or GPT. Most attorneys use their own cloud key.
          This uses a free tool called <span className="font-medium">Ollama</span> that runs an AI model
          directly on your computer. Nothing ever leaves your machine, and it is a good fit for {professionCopy.sensitiveWorkDesc}.
          A fast computer helps.
        </p>
        <p className="text-muted-foreground">
          Choosing this turns on <span className="font-medium text-foreground">Local-only mode</span>, which keeps Keepance
          on local models so nothing can leave your machine by accident. You can
          change this later in Settings.
        </p>
      </div>

      {/* Detection result. */}
      <div className="rounded-lg border border-border p-4" data-testid="ollama-status">
        {status.kind === 'checking' && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <RefreshCw className="h-4 w-4 animate-spin" />
            Checking your computer for Ollama...
          </p>
        )}

        {status.kind === 'ready' && (
          <div className="space-y-1" data-testid="ollama-status-ready">
            <p className="flex items-center gap-2 text-sm font-medium text-emerald-700">
              <Check className="h-4 w-4" />
              Ollama is running, with {status.models.length === 1 ? '1 model' : `${String(status.models.length)} models`} ready.
            </p>
            <p className="text-xs text-muted-foreground">
              You are all set to run AI privately on this machine.
            </p>
          </div>
        )}

        {status.kind === 'reachable-no-models' && (
          <div className="space-y-2" data-testid="ollama-status-no-models">
            <p className="text-sm font-medium text-foreground">
              Ollama is installed, but you have not downloaded a model yet.
            </p>
            <p className="text-xs text-muted-foreground">
              Open a terminal and run{' '}
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-foreground">ollama pull llama3.2</code>{' '}
              to download a good starter model, then check again.
            </p>
            <Button type="button" size="sm" variant="outline" onClick={check} className="gap-1.5">
              <RefreshCw className="h-3.5 w-3.5" />
              Check again
            </Button>
          </div>
        )}

        {status.kind === 'missing' && (
          <div className="space-y-2" data-testid="ollama-status-missing">
            <p className="text-sm font-medium text-foreground">
              We could not find Ollama on this computer.
            </p>
            <p className="text-xs text-muted-foreground">
              Ollama is a free download. Install it, start it, then come back and
              check again. It takes a few minutes.
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              <Button
                type="button"
                size="sm"
                onClick={() => void openExternal(OLLAMA_DOWNLOAD_URL)}
                data-testid="ollama-download-link"
                className="gap-1.5"
              >
                Get Ollama (free)
                <ExternalLink className="h-3.5 w-3.5" />
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={check} className="gap-1.5">
                <RefreshCw className="h-3.5 w-3.5" />
                Check again
              </Button>
            </div>
          </div>
        )}
      </div>

      <button
        type="button"
        data-testid="ai-setup-data-map-link-local"
        onClick={onOpenDataMap}
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        <HelpCircle className="h-3.5 w-3.5" />
        Where does my data go?
      </button>

      <div className="flex items-center justify-between gap-2 pt-4 border-t border-border">
        <Button variant="ghost" onClick={onBack} className="gap-1.5">
          <ArrowLeft className="h-4 w-4" />
          Other options
        </Button>
        <Button
          onClick={handleConfirm}
          size="lg"
          disabled={status.kind !== 'ready'}
          data-testid="ai-setup-use-local"
        >
          Use local AI and continue
        </Button>
      </div>
    </div>
  );
}

export default AiSetupStep;
