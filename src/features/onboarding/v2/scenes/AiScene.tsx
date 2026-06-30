/* eslint-disable lantern-i18n/no-hardcoded-string */
/**
 * AiScene — "1. Connect your AI".
 *
 * Prototype two-card layout (cloud BYOK vs local AI), wired to the REAL setup
 * primitives, not a mockup:
 *   - Cloud "Connect" live-validates the key (validateApiKeyLive) then persists
 *     it via onSaveKey -> KeychainService.setKey, and clears the deferred flag.
 *   - "Try Local AI" really starts the ~2.5 GB local-model download
 *     (useLocalLlmModelStatus().start) and switches to local-only mode.
 *   - "I need help setting this up" opens the real redacted help-ticket dialog
 *     (AiSetupHelpLink).
 *
 * The "What is this?" and "Tell me more" modals carry the verbatim prototype
 * explainer copy.
 */

import { useEffect, useState } from 'react';
import { Check, Info, X } from 'lucide-react';

import { openExternal } from '@/platform/utils/openExternal';
import type { KeyProvider } from '@/platform/providers/KeychainService';
import { validateApiKeyLive } from '@/platform/providers/apiKeyValidation';
import { markKeyVerified } from '@/platform/providers/keyVerification';
import { detectOllama } from '@/platform/providers/OllamaProvider';
import {
  useRecordConfidentialityChoice,
  snapshotConfidentialityChoice,
  restoreConfidentialityChoice,
} from '@/platform/hooks/useConfidentialityMode';
import { useLocalLlmModelStatus } from '@/platform/hooks/useLocalLlmModelStatus';

import { PROVIDER_TUTORIALS, type ProviderId } from '../../ProviderTutorialSteps';
import { AiSetupHelpLink } from '../../AiSetupHelpLink';
import { clearAiSetupDeferred } from '../../aiSetupState';
import { ApiKeyTester } from '../../ApiKeyTester';
import { ONB_COPY } from '../copy';

const PROVIDERS: { id: ProviderId; label: string }[] = [
  { id: 'openai', label: 'OpenAI' },
  { id: 'anthropic', label: 'Anthropic' },
  { id: 'google', label: 'Google' },
];

export interface AiSceneProps {
  onSaveKey: (provider: KeyProvider, key: string) => void | Promise<void>;
  /** Advance to the next scene (used by the "Try Local AI" shortcut). */
  onAdvance: () => void;
  /** Called once the user makes a real AI choice (cloud key saved or local
   *  started) so the orchestrator knows AI setup was NOT skipped. */
  onAiResolved?: () => void;
}

export function AiScene({ onSaveKey, onAdvance, onAiResolved }: AiSceneProps) {
  const C = ONB_COPY.ai;
  const [provider, setProvider] = useState<ProviderId>('anthropic');
  const [keyText, setKeyText] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [connected, setConnected] = useState(false);
  // Key was saved but a live verification couldn't complete (network/unreachable
  // provider). We DON'T claim "connected/ready" for this — only "saved".
  const [savedUnverified, setSavedUnverified] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [localOpen, setLocalOpen] = useState(false);

  const recordChoice = useRecordConfidentialityChoice();
  const localLlm = useLocalLlmModelStatus();
  const localBusy = localLlm.state === 'downloading' || localLlm.state === 'checking';
  const localReady = localLlm.state === 'ready';

  // Detect an already-installed Ollama (localhost:11434). If the user already
  // runs Ollama with a model, we offer to USE it instead of downloading our
  // 2.4 GB embedded model — no point making them wait for a second copy.
  const [ollamaModels, setOllamaModels] = useState<string[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    void detectOllama().then((r) => {
      if (!cancelled && r.reachable && r.models.length > 0) {
        setOllamaModels(r.models);
      }
    });
    return () => { cancelled = true; };
  }, []);

  const tutorial = PROVIDER_TUTORIALS[provider];
  const providerLabel = PROVIDERS.find((p) => p.id === provider)?.label ?? 'your provider';

  function changeProvider(id: ProviderId) {
    setProvider(id);
    setKeyText('');
    setError(null);
    setConnected(false);
    setSavedUnverified(false);
  }

  async function handleConnect() {
    const key = keyText.trim();
    if (!key) {
      setError('Paste your key first.');
      return;
    }
    // Commit the cloud BYOK choice BEFORE validating. Two reasons:
    //  1. On a fresh install the default is local-only fail-closed, which makes
    //     validateApiKeyLive short-circuit to 'network' (skipping the real
    //     format + provider check) — so without this the Connect button would
    //     "accept" any non-empty string. Recording 'direct' (mode + choiceMade)
    //     turns off the fail-closed guard so the key is genuinely validated.
    //  2. choiceMade is what unlocks cloud generation post-onboarding
    //     (resolveEffectiveEgress gates cloud on it). Saving a key without it
    //     leaves the provider connected but unusable.
    // Snapshot first so a malformed/rejected/errored attempt can be rolled
    // back below — otherwise a bad key would still leave 'direct'/choiceMade
    // recorded with no key actually saved, which is the exact state the
    // always-visible egress indicator promises never to misreport.
    const priorChoice = snapshotConfidentialityChoice();
    recordChoice('direct');
    setConnecting(true);
    setError(null);
    // Bound the live check so a hung provider can't spin "Connecting..." forever
    // (mirrors ApiKeyWizard's 15s guard).
    const ac = new AbortController();
    const timeout = setTimeout(() => { ac.abort(); }, 15_000);
    try {
      const result = await validateApiKeyLive(provider, key, ac.signal);
      if (result.outcome === 'malformed' || result.outcome === 'rejected') {
        restoreConfidentialityChoice(priorChoice);
        setError(result.message);
        return;
      }
      // 'ok' or 'network' (couldn't reach provider, but the key looks valid) — save it.
      await onSaveKey(provider, key);
      clearAiSetupDeferred();
      if (result.outcome === 'ok') {
        // A real live check passed — only NOW is the key genuinely "ready".
        markKeyVerified(provider);
        setConnected(true);
        setSavedUnverified(false);
      } else {
        // 'network': the key looks valid but we couldn't reach the provider to
        // verify it. Save it, but be honest — don't claim "connected/ready".
        // It gets verified the first time it's actually used.
        setSavedUnverified(true);
        setConnected(false);
      }
      // Either way the user made a real AI choice, so onboarding wasn't skipped.
      onAiResolved?.();
    } catch (e) {
      restoreConfidentialityChoice(priorChoice);
      setError(e instanceof Error ? e.message : 'Could not save your key.');
    } finally {
      clearTimeout(timeout);
      setConnecting(false);
    }
  }

  function handleTryLocal() {
    // Start the real download (no-op off-desktop), record the local-only choice
    // (mode + choiceMade, same as GuidedOnboarding), then advance.
    localLlm.start();
    recordChoice('local-only');
    clearAiSetupDeferred();
    onAiResolved?.();
    onAdvance();
  }

  function handleUseOllama() {
    // The user already has Ollama running — record the local-only choice and
    // advance WITHOUT downloading the embedded model. They'll pick their Ollama
    // model in the chat model picker; local-only keeps everything on-device.
    recordChoice('local-only');
    clearAiSetupDeferred();
    onAiResolved?.();
    onAdvance();
  }

  return (
    <div className="flex w-full flex-col items-center" data-testid="onboarding-v2-ai">
      <h1 className="text-3xl font-extrabold tracking-[-0.01em] text-[var(--kp-navy)] md:text-4xl">
        {C.headline}
      </h1>

      <div className="mt-10 grid w-full max-w-[1120px] grid-cols-1 gap-6 text-left lg:grid-cols-2">
        {/* ---- Card 1: Cloud BYOK ---- */}
        <div
          className={`rounded-[22px] border-2 bg-white p-7 transition-shadow ${
            connected ? 'border-[#1fa971]' : 'border-[rgba(var(--kp-navy-rgb),0.10)]'
          }`}
          data-testid="ai-card-cloud"
        >
          <h2 className="text-xl font-bold text-[var(--kp-navy)]">{C.cloud.title}</h2>
          <ul className="mt-4 space-y-2.5">
            {C.cloud.bullets.map((b, i) => (
              <li key={b} className="flex items-start gap-2.5 text-sm text-[var(--kp-navy)]">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-[var(--kp-blue)]" strokeWidth={3} aria-hidden="true" />
                <span>
                  {b}
                  {i === C.cloud.bullets.length - 1 ? (
                    <button
                      type="button"
                      onClick={() => { setPayOpen(true); }}
                      className="ml-2 font-semibold text-[var(--kp-accent)] underline-offset-2 hover:underline"
                      data-testid="ai-what-is-this"
                    >
                      {C.cloud.whatLink}
                    </button>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>

          <div className="mt-6 text-xs font-bold tracking-[0.08em] text-[#5b6b80]">
            {C.cloud.pickLabel}
          </div>
          <div className="mt-3 inline-flex rounded-full bg-[#f5f7fb] p-1" role="group" aria-label="Choose a provider">
            {PROVIDERS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => { changeProvider(p.id); }}
                aria-pressed={provider === p.id}
                data-testid={`ai-provider-${p.id}`}
                className={`rounded-full px-5 py-2 text-sm font-semibold transition-colors ${
                  provider === p.id ? 'bg-[var(--kp-accent)] text-white' : 'text-[#5b6b80] hover:text-[var(--kp-navy)]'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Numbered steps */}
          <ol className="mt-5 space-y-3">
            <li className="flex items-start gap-3">
              <StepBadge n={1} />
              <span className="text-sm text-[var(--kp-navy)]">
                Open the{' '}
                <button
                  type="button"
                  onClick={() => void openExternal(tutorial.consoleUrl)}
                  className="font-semibold text-[var(--kp-accent)] underline underline-offset-2"
                  data-testid="ai-open-console"
                >
                  {providerLabel} API keys page
                </button>{' '}
                and sign in.
              </span>
            </li>
            <li className="flex items-start gap-3">
              <StepBadge n={2} />
              <span className="text-sm text-[var(--kp-navy)]">Create a free key.</span>
            </li>
            <li className="flex items-start gap-3">
              <StepBadge n={3} />
              <span className="text-sm text-[var(--kp-navy)]">Paste it below.</span>
            </li>
          </ol>

          {/* Key input + Connect */}
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <input
              type="password"
              value={keyText}
              onChange={(e) => {
                setKeyText(e.target.value);
                setConnected(false);
                setSavedUnverified(false);
                setError(null);
              }}
              placeholder={`Paste your ${providerLabel} key`}
              data-testid="ai-key-input"
              className="flex-1 rounded-xl border border-[rgba(var(--kp-navy-rgb),0.15)] bg-[#f5f7fb] px-4 py-3 text-sm outline-none focus:border-[var(--kp-accent)]"
            />
            <button
              type="button"
              onClick={() => void handleConnect()}
              disabled={connecting || keyText.trim().length === 0}
              data-testid="ai-connect"
              className="rounded-xl bg-[var(--kp-accent)] px-6 py-3 text-sm font-bold text-white transition-transform active:translate-y-px disabled:opacity-50"
            >
              {connecting ? 'Connecting...' : connected ? 'Connected' : savedUnverified ? 'Saved' : C.cloud.connect}
            </button>
          </div>

          {keyText.trim().length > 0 && !connected ? (
            <div className="mt-2">
              <ApiKeyTester provider={provider} apiKey={keyText} />
            </div>
          ) : null}

          {connected ? (
            <div
              className="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold text-[#1fa971]"
              data-testid="ai-connected"
            >
              <Check className="h-4 w-4" strokeWidth={3} /> Connected. You can continue.
            </div>
          ) : null}
          {savedUnverified ? (
            <div
              className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800"
              data-testid="ai-saved-unverified"
              role="status"
            >
              I saved your key, but I couldn&apos;t reach {providerLabel} just now to check it. You
              can continue — I&apos;ll verify it the first time you use it.
            </div>
          ) : null}
          {error ? (
            <div className="mt-2 text-sm text-red-600" data-testid="ai-error" role="alert">
              {error}
            </div>
          ) : null}

          <div className="mt-3">
            <AiSetupHelpLink
              provider={provider}
              providerName={providerLabel}
              context="onboarding · ai-key-step-v2"
            />
          </div>
        </div>

        {/* ---- Card 2: Local AI ---- */}
        <div className="rounded-[22px] border-2 border-[rgba(var(--kp-navy-rgb),0.10)] bg-white p-7" data-testid="ai-card-local">
          <h2 className="text-xl font-bold text-[var(--kp-navy)]">{C.local.title}</h2>
          <ul className="mt-4 space-y-2.5">
            {C.local.bullets.map((b) => (
              <li key={b} className="flex items-start gap-2.5 text-sm text-[var(--kp-navy)]">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-[var(--kp-blue)]" strokeWidth={3} aria-hidden="true" />
                <span>{b}</span>
              </li>
            ))}
          </ul>

          <button
            type="button"
            onClick={() => { setLocalOpen(true); }}
            className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--kp-accent)] hover:underline"
            data-testid="ai-tell-me-more"
          >
            <Info className="h-4 w-4" aria-hidden="true" />
            {C.local.moreLink}
          </button>

          {ollamaModels ? (
            <div
              className="mt-5 rounded-xl border border-[#1fa971]/30 bg-[#1fa971]/[0.06] p-4"
              data-testid="ai-ollama-detected"
            >
              <div className="text-sm font-bold text-[var(--kp-navy)]">
                We found Ollama on this computer
              </div>
              <div className="mt-1 text-xs text-[#41506a]">
                {ollamaModels.length === 1
                  ? '1 model is installed'
                  : `${String(ollamaModels.length)} models are installed`}
                . You can use it now — no download needed.
              </div>
              <button
                type="button"
                onClick={handleUseOllama}
                data-testid="ai-use-ollama"
                className="mt-3 w-full rounded-xl bg-[var(--kp-accent)] px-6 py-3 text-sm font-bold text-white transition-transform active:translate-y-px"
              >
                Use my Ollama
              </button>
              <button
                type="button"
                onClick={handleTryLocal}
                disabled={localBusy}
                data-testid="ai-try-local"
                className="mt-2 w-full rounded-xl border border-[var(--kp-accent)] px-6 py-3 text-sm font-bold text-[var(--kp-accent)] transition-transform active:translate-y-px disabled:opacity-60"
              >
                {localReady ? 'Local AI ready, continue' : localBusy ? 'Starting download...' : 'Or download the built-in model'}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={handleTryLocal}
              disabled={localBusy}
              data-testid="ai-try-local"
              className="mt-5 w-full rounded-xl bg-[var(--kp-accent)] px-6 py-3 text-sm font-bold text-white transition-transform active:translate-y-px disabled:opacity-60"
            >
              {localReady ? 'Local AI ready, continue' : localBusy ? 'Starting download...' : C.local.tryLocal}
            </button>
          )}
          <div className="mt-2 text-center text-xs text-[#8a93a3]">{C.local.switchNote}</div>
        </div>
      </div>

      {payOpen ? (
        <OnbModal title={C.payModal.title} body={C.payModal.body} cta={C.payModal.got} onClose={() => { setPayOpen(false); }} testId="ai-pay-modal" />
      ) : null}
      {localOpen ? (
        <OnbModal title={C.localModal.title} body={C.localModal.body} cta={C.localModal.got} onClose={() => { setLocalOpen(false); }} testId="ai-local-modal" />
      ) : null}
    </div>
  );
}

function StepBadge({ n }: { n: number }) {
  return (
    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--kp-accent)] text-xs font-bold text-white">
      {n}
    </span>
  );
}

function OnbModal({
  title,
  body,
  cta,
  onClose,
  testId,
}: {
  title: string;
  body: string;
  cta: string;
  onClose: () => void;
  testId: string;
}) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-[rgba(var(--kp-navy-rgb),0.45)] p-6"
      onClick={onClose}
      data-testid={testId}
    >
      <div
        className="relative max-w-[640px] rounded-[22px] bg-white p-8 text-left shadow-[0_30px_80px_rgba(var(--kp-navy-rgb),0.32)]"
        onClick={(e) => { e.stopPropagation(); }}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-5 top-5 text-[#9aa4b4] hover:text-[var(--kp-navy)]"
        >
          <X className="h-6 w-6" />
        </button>
        <h3 className="text-2xl font-extrabold text-[var(--kp-navy)]">{title}</h3>
        <p className="mt-3 text-base leading-relaxed text-[rgba(var(--kp-navy-rgb),0.80)]">{body}</p>
        <button
          type="button"
          onClick={onClose}
          className="mt-6 rounded-full bg-[var(--kp-accent)] px-7 py-2.5 text-sm font-bold text-white"
        >
          {cta}
        </button>
      </div>
    </div>
  );
}
