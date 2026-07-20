/**
 * ConfidentialityModeSettings — the visible "confidentiality spectrum" picker.
 *
 * Three modes, shown as selectable cards so the whole spectrum is legible at a
 * glance (the adoption blocker is that lawyers can't *explain* where data goes;
 * seeing the range, with the active one marked, is the fix):
 *
 *   - Local-only  Documents and prompts are never sent to a cloud AI: only
 *                 on-device models are usable (the built-in Lantern Local AI
 *                 by default, or the user's own Ollama) and cloud AI providers
 *                 and outside connectors are paused by Network lockdown.
 *                 Selecting this constrains the model picker elsewhere.
 *   - Direct      Default. Your own key, straight to your chosen provider.
 *   - Assured     Selectable once the firm admin sets a managed key; routed
 *                 through the firm's zero-retention proxy (managed key + DPA).
 *
 * Light-theme first.
 */
/*
 * The confidentiality-mode copy is legal-precision, audience-checked wording
 * that is intentionally inlined (not split into i18n keys); localising the
 * privacy/data story is a separate, careful effort. Disable the
 * hardcoded-string rule for this file only.
 */
/* eslint-disable lantern-i18n/no-hardcoded-string */

import { useEffect, useRef, useState } from 'react';
import { Laptop, Cloud, ShieldCheck, ShieldOff, Check, Download, Loader2, KeyRound } from 'lucide-react';
import { cn } from '@/lib/utils';
import { InfoHelp } from '@/ui/InfoHelp';
import {
  useConfidentialityMode,
  useRecordConfidentialityChoice,
} from '@/platform/hooks/useConfidentialityMode';
import { modeNeedsManagedKey, type ConfidentialityMode } from '@/platform/privacy/egress';
import { brandText } from '@/config/brandText';
import {
  usePrivilegedMatterMode,
  useSetPrivilegedMatterMode,
} from '@/platform/hooks/usePrivilegedMatterMode';
import { useFirmStore } from '@/platform/firm/firmStore';
import { useLocalLlmModelStatus } from '@/platform/hooks/useLocalLlmModelStatus';
import { KeychainService, type KeyProvider } from '@/platform/providers/KeychainService';
import { getKeyCheckStatus } from '@/platform/providers/keyVerification';
import { EV_EGRESS_CONFIG_CHANGE, SK_DEFAULT_MODEL, SK_DEFAULT_PROVIDER } from '@/config/identity';
import { useNativeNetworkLockdownBridgeState } from '@/platform/privacy/nativeNetworkLockdownBridge';
import { NetworkLockdownRetryButton } from '@/platform/privacy/ui/NetworkLockdownRetryButton';
import { BRAND } from '@/config/brand';

interface ModeCard {
  mode: ConfidentialityMode;
  icon: typeof Laptop;
  title: string;
  blurb: string;
  /** Light-theme accent for the selected ring + icon. */
  accent: string;
  comingSoon?: boolean;
  /**
   * A short, honest descriptor shown as a small badge next to the card title
   * (e.g. "Most capable", "Most private"). Deliberately NOT a bare
   * "Recommended" badge: this app's whole pitch is the privacy spectrum, so
   * badging one option as THE recommendation (especially the less-private
   * one) reads as steering users away from the option that best matches
   * their own stated priority. Each card names its own actual strength
   * instead, so the user picks based on what they value.
   */
  tag?: string;
}

/** The two cards shown to solo (non-firm) users. */
const SOLO_CARDS: ModeCard[] = [
  {
    mode: 'local-only',
    icon: Laptop,
    title: 'On this computer only',
    blurb:
      `AI runs on your machine: your documents and prompts are never sent to a cloud AI. Cloud AI providers are turned off and only on-device models are used — the built-in ${BRAND.name} Local AI, or your own Ollama. Outside connectors pause so nothing leaves this computer. Use this for your most sensitive client work.`,
    accent: 'text-emerald-700 border-emerald-400 dark:text-emerald-300 dark:border-emerald-700',
    tag: 'Most private',
  },
  {
    mode: 'direct',
    icon: Cloud,
    title: 'Cloud AI (your account)',
    blurb:
      `Your own API key talks directly to your chosen AI provider (Anthropic, OpenAI, or Google). ${BRAND.name} is not in between. The provider sees your prompt, so control retention and training in your provider account.`,
    accent: 'text-sky-700 border-sky-400 dark:text-sky-300 dark:border-sky-700',
    tag: 'Most capable',
  },
];

/** The Assured card shown only in a firm context. */
const ASSURED_CARD: ModeCard = {
  mode: 'assured',
  icon: ShieldCheck,
  title: 'Assured',
  blurb:
    `Cloud inference routed through the ${BRAND.name} zero-retention proxy using your firm's managed key. We keep nothing (DPA + provider zero-retention). Available once your firm admin sets a managed key.`,
  accent: 'text-indigo-700 border-indigo-400 dark:text-indigo-300 dark:border-indigo-700',
};

const PROVIDER_NAMES: Record<KeyProvider, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google AI',
};

function keyStatusLabel(provider: KeyProvider): string {
  const status = getKeyCheckStatus(provider).status;
  if (status === 'verified') return 'working';
  if (status === 'invalid') return 'needs attention';
  return 'saved';
}

function readCurrentCloudModel(): { provider: string; model: string } {
  try {
    return {
      provider: localStorage.getItem(SK_DEFAULT_PROVIDER)?.trim() || '',
      model: localStorage.getItem(SK_DEFAULT_MODEL)?.trim() || '',
    };
  } catch {
    return { provider: '', model: '' };
  }
}

function cloudProviderLabel(provider: string): string {
  if (provider === 'anthropic' || provider === 'openai' || provider === 'google') {
    return PROVIDER_NAMES[provider];
  }
  return provider;
}

function LocalAiCardDetails() {
  const snap = useLocalLlmModelStatus();
  const downloading =
    snap.state === 'checking' ||
    snap.state === 'downloading' ||
    snap.state === 'verifying';
  const pct =
    snap.bytesTotal && snap.bytesTotal > 0
      ? Math.min(100, Math.round((snap.bytesDone / snap.bytesTotal) * 100))
      : 0;

  if (snap.state === 'idle') {
    return (
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
        {`
        ${BRAND.name} Local AI is available in the desktop app.
      `}</p>
    );
  }

  if (snap.state === 'ready') {
    return (
      <p
        data-testid="local-ai-ready"
        className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-900"
      >
        {`
        ${BRAND.name} Local AI is installed and ready.
      `}</p>
    );
  }

  return (
    <div className="mt-3 rounded-md border border-border bg-background/70 px-3 py-3 text-xs">
      <div className="flex items-center justify-between gap-3">
        <span className="font-medium text-foreground">{`${BRAND.name} Local AI`}</span>
        {snap.state === 'absent' && (
          <button
            type="button"
            data-testid="local-ai-download-button"
            onClick={snap.start}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1.5 font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Download className="h-3.5 w-3.5" />
            Install
          </button>
        )}
        {snap.state === 'error' && (
          <button
            type="button"
            data-testid="local-ai-retry-button"
            onClick={snap.retry}
            className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 font-medium text-foreground hover:bg-muted"
          >
            <Download className="h-3.5 w-3.5" />
            Resume
          </button>
        )}
      </div>
      {snap.state === 'absent' && (
        <p className="mt-2 text-muted-foreground">
          Install the local model to answer without sending prompts or files to a cloud AI.
        </p>
      )}
      {downloading && (
        <div className="mt-2" data-testid="local-ai-download-progress">
          <div className="flex items-center gap-2 text-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
            {snap.state === 'verifying' ? 'Verifying download' : `Downloading ${String(pct)}%`}
          </div>
          <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded bg-muted">
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={pct}
              className="h-full rounded bg-primary transition-[width]"
              style={{ width: `${String(pct)}%` }}
            />
          </div>
        </div>
      )}
      {snap.state === 'error' && (
        <p className="mt-2 text-destructive">
          Local AI needs attention{snap.message ? `: ${snap.message}` : '.'}
        </p>
      )}
    </div>
  );
}

function CloudAiCardDetails({
  onManageApiKeys,
}: {
  onManageApiKeys?: (() => void) | undefined;
}) {
  const [storedKeys, setStoredKeys] = useState(() => new KeychainService().getStoredKeys());
  const [currentModel, setCurrentModel] = useState(readCurrentCloudModel);

  useEffect(() => {
    const refresh = () => {
      setStoredKeys(new KeychainService().getStoredKeys());
      setCurrentModel(readCurrentCloudModel());
    };
    window.addEventListener(EV_EGRESS_CONFIG_CHANGE, refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener(EV_EGRESS_CONFIG_CHANGE, refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);

  return (
    <div className="mt-3 rounded-md border border-border bg-background/70 px-3 py-3 text-xs">
      <div className="flex items-center gap-1.5 font-medium text-foreground">
        <KeyRound className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
        Account keys
      </div>
      {storedKeys.length === 0 ? (
        <p className="mt-2 text-muted-foreground">No account keys saved yet.</p>
      ) : (
        <ul className="mt-2 space-y-1">
          {storedKeys.map((key) => (
            <li key={key.provider} className="flex items-center justify-between gap-2">
              <span>{PROVIDER_NAMES[key.provider]}</span>
              <span className="text-muted-foreground">{keyStatusLabel(key.provider)}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 border-t border-border/70 pt-3">
        <div className="font-medium text-foreground">Current model</div>
        <p className="mt-1 text-muted-foreground">
          {currentModel.model
            ? `${currentModel.provider ? `${cloudProviderLabel(currentModel.provider)}: ` : ''}${currentModel.model}`
            : 'No default model selected yet.'}
        </p>
      </div>
      <button
        type="button"
        data-testid="confidentiality-manage-cloud-keys"
        onClick={onManageApiKeys}
        className="mt-3 inline-flex items-center justify-center rounded-md border border-border bg-background px-3 py-1.5 font-medium text-foreground hover:bg-muted"
      >
        Add, change, or remove keys
      </button>
    </div>
  );
}

export function ConfidentialityModeSettings({
  onManageApiKeys,
}: {
  onManageApiKeys?: () => void;
}) {
  const active = useConfidentialityMode();
  const setMode = useRecordConfidentialityChoice();
  const privileged = usePrivilegedMatterMode();
  const setPrivileged = useSetPrivilegedMatterMode();
  const nativeLockdown = useNativeNetworkLockdownBridgeState();
  const enforcedLockdownOn = nativeLockdown.status === 'on';
  const lockdownStatusKnown = nativeLockdown.status !== 'unknown';
  // Show the isolation affirmation callout briefly after the user manually
  // enables network lockdown. Not shown for auto-forced states (those have
  // their own forced-note already).
  const [showLockdownAffirmation, setShowLockdownAffirmation] = useState(false);
  const lockdownAffirmationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Assured is selectable once the firm has at least one managed provider key.
  // The egress indicator does the precise per-provider check at send time.
  const assuredAvailable = useFirmStore((s) => s.assuredProviders.length > 0);
  // Show the Assured card only when the user is in a firm context.
  const isFirmUser = useFirmStore((s) => !!s.session?.activated);
  const cards: ModeCard[] = isFirmUser ? [...SOLO_CARDS, ASSURED_CARD] : SOLO_CARDS;

  return (
    <div
      data-testid="confidentiality-mode-settings"
      data-active-mode={active}
      className="py-3 border-b border-border/50"
    >
      <div className="mb-3 flex items-center gap-1.5">
        <h3 className="text-sm font-medium">Where AI requests go</h3>
        <InfoHelp
          content={
            <div className="space-y-2">
              <p>Choose whether AI requests stay on your computer or are sent to a cloud provider you control.</p>
              {isFirmUser && (
                <p>{brandText(`Firm security: the Assured option below routes AI requests through your firm's zero-retention proxy so ${BRAND.name} retains nothing.`)}</p>
              )}
            </div>
          }
        />
      </div>

      <div className={cn('grid gap-3', isFirmUser ? 'sm:grid-cols-3' : 'sm:grid-cols-2')}>
        {cards.map((card) => {
          const Icon = card.icon;
          const blurb = brandText(card.blurb);
          const selected = active === card.mode;
          // Assured is gated on a managed key being configured; others are always on.
          const disabled =
            (!!card.comingSoon && card.mode !== 'assured') ||
            modeNeedsManagedKey(card.mode, assuredAvailable);
          // The card is a NON-interactive container. Selection happens through
          // an invisible "stretched" button covering the whole card, and the
          // per-card InfoHelp is a real sibling button layered above it — so no
          // focusable control is ever nested inside another (which broke
          // keyboard/screen-reader behavior and made the help unreachable on
          // disabled cards). The rendered pixels are identical to the old
          // single-<button> card.
          return (
            <div
              key={card.mode}
              data-testid={`confidentiality-mode-card-${card.mode}`}
              data-selected={selected ? 'true' : 'false'}
              data-disabled={disabled ? 'true' : 'false'}
              className={cn(
                'relative text-left rounded-lg border p-4 transition-colors',
                disabled
                  ? 'opacity-60 border-border bg-muted/20'
                  : selected
                    ? cn('bg-background shadow-md ring-2 ring-primary/20', card.accent)
                    : 'border-border bg-card hover:bg-muted/30',
              )}
            >
              <button
                type="button"
                data-testid={`confidentiality-mode-${card.mode}`}
                disabled={disabled}
                aria-pressed={selected}
                aria-label={card.title}
                onClick={() => {
                  if (!disabled) setMode(card.mode);
                }}
                className={cn(
                  // -inset-px stretches over the card's 1px border so the
                  // clickable area and focus ring match the old full-card button.
                  'absolute -inset-px rounded-lg',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  disabled && 'cursor-not-allowed',
                )}
              />
              <div className="pointer-events-none relative flex items-center justify-between gap-2 mb-1">
                <span
                  className={cn(
                    'inline-flex items-center gap-1.5 font-medium text-sm',
                    selected && !disabled ? '' : 'text-foreground',
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" aria-hidden />
                  {card.title}
                  <InfoHelp
                    className="pointer-events-auto"
                    content={blurb}
                    label={`About ${card.title}`}
                  />
                </span>
                <span className="flex items-center gap-1.5 shrink-0">
                  {card.tag && (
                    <span
                      data-testid={`confidentiality-mode-${card.mode}-tag`}
                      className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary"
                    >
                      {card.tag}
                    </span>
                  )}
                  {selected && !disabled && (
                    <Check className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-label="Selected" />
                  )}
                  {disabled && (
                    <span className="text-[10px] uppercase tracking-wide rounded-full px-1.5 py-0.5 bg-muted text-muted-foreground">
                      Needs admin key
                    </span>
                  )}
                </span>
              </div>
              {card.mode === 'local-only' && <LocalAiCardDetails />}
              {card.mode === 'direct' && (
                <CloudAiCardDetails onManageApiKeys={onManageApiKeys} />
              )}
            </div>
          );
        })}
      </div>

      {active === 'local-only' && (
        <p
          data-testid="confidentiality-local-active-note"
          className="mt-2 text-xs rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200"
        >
          {enforcedLockdownOn
            ? <>On this computer only is on. Your documents and prompts are never sent
                to a cloud AI — answers run on a local model on your machine (the
                built-in {brandText(`${BRAND.name} Local AI`)} when it&rsquo;s ready, or your own Ollama).
                Cloud AI providers are disabled in the chat picker. Outside connectors
                pause so nothing leaves this computer.</>
            : <>{`On this computer only is selected. Outside connectors stay paused while
                ${BRAND.name} `}{nativeLockdown.pending ? 'updates' : 'checks'} the desktop privacy guard.</>}
        </p>
      )}

      {/* Network lockdown (Isolated matter) toggle. Manual switch + an honest note
          about the auto-on behaviour. When a matter with network lockdown is active
          or Local-only is selected, the mode is forced on and the switch is disabled. */}
      <div
        data-testid="privileged-matter-mode-toggle"
        data-active={lockdownStatusKnown ? String(enforcedLockdownOn) : 'unknown'}
        data-requested={privileged.active ? 'true' : 'false'}
        data-forced={privileged.forced ? 'true' : 'false'}
        className="mt-4 rounded-lg border border-rose-200 dark:border-rose-900/60 p-3"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <span className="inline-flex items-center gap-1.5 text-sm font-medium">
              <ShieldOff className="h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" aria-hidden />
              Network lockdown
              <InfoHelp content="Turns off network-capable extensions so confidential work cannot leave your machine through one. Network plugins are blocked and MCP servers are disabled. Everything else keeps working." />
            </span>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={lockdownStatusKnown ? enforcedLockdownOn : undefined}
            aria-busy={nativeLockdown.pending || !lockdownStatusKnown}
            aria-label="Network lockdown"
            data-testid="privileged-matter-mode-switch"
            disabled={
              privileged.forced ||
              nativeLockdown.pending ||
              !lockdownStatusKnown ||
              nativeLockdown.error !== null
            }
            onClick={() => {
              if (
                !privileged.forced &&
                !nativeLockdown.pending &&
                lockdownStatusKnown &&
                nativeLockdown.error === null
              ) {
                const turningOn = !enforcedLockdownOn;
                setPrivileged(turningOn);
                if (turningOn) {
                  setShowLockdownAffirmation(true);
                  if (lockdownAffirmationTimer.current) clearTimeout(lockdownAffirmationTimer.current);
                  lockdownAffirmationTimer.current = setTimeout(() => {
                    setShowLockdownAffirmation(false);
                  }, 5000);
                } else {
                  setShowLockdownAffirmation(false);
                  if (lockdownAffirmationTimer.current) clearTimeout(lockdownAffirmationTimer.current);
                }
              }
            }}
            className={cn(
              'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              !lockdownStatusKnown
                ? 'bg-amber-300'
                : enforcedLockdownOn
                  ? 'bg-rose-600'
                  : 'bg-muted-foreground/30',
              (privileged.forced || nativeLockdown.pending || !lockdownStatusKnown || nativeLockdown.error !== null) &&
                'opacity-70 cursor-not-allowed',
            )}
          >
            <span
              className={cn(
                'inline-block h-4 w-4 transform rounded-full bg-white transition-transform',
                !lockdownStatusKnown
                  ? 'translate-x-2.5'
                  : enforcedLockdownOn
                    ? 'translate-x-4'
                    : 'translate-x-0.5',
              )}
            />
          </button>
        </div>
        {!nativeLockdown.error && (nativeLockdown.pending || !lockdownStatusKnown) && (
          <p
            role="status"
            data-testid="network-lockdown-status-unconfirmed"
            className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-950"
          >
            {nativeLockdown.pending
              ? 'Privacy protection is updating. Outside connections stay paused until the desktop guard confirms the change.'
              : `${BRAND.name} is checking the desktop privacy guard. Outside connections stay paused until its state can be confirmed.`}
          </p>
        )}
        {nativeLockdown.error && (
          <div
            role="alert"
            data-testid="network-lockdown-update-failed"
            className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-950"
          >
            <p>{nativeLockdown.error}</p>
            <NetworkLockdownRetryButton testId="privacy-settings-network-lockdown-retry" />
          </div>
        )}
        {privileged.forced && (
          <p
            data-testid="privileged-matter-mode-forced-note"
            className="mt-2 text-xs rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-rose-900 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200"
          >
            {enforcedLockdownOn
              ? privileged.trigger === 'privileged-matter'
                ? 'On automatically because the active client has network lockdown. It stays on until you switch to a different client.'
                : 'On automatically because On this computer only is selected. It stays on while that option is active.'
              : `This privacy choice requires Network lockdown. Outside connections stay paused while ${BRAND.name} confirms the desktop guard.`}
          </p>
        )}
        {/* Affirmation: shown for ~5 s after the user manually turns lockdown on */}
        {showLockdownAffirmation && !privileged.forced && enforcedLockdownOn && (
          <div
            data-testid="lockdown-manual-affirmation"
            className="mt-2 flex items-start gap-2 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs text-emerald-900"
            style={{ background: 'linear-gradient(90deg, #ecfdf5 0%, #f0f9ff 100%)' }}
          >
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
            <span>Network lockdown is on. AI requests stay on this computer, and outside network connections are blocked so nothing can leave through an extension.</span>
          </div>
        )}
      </div>

    </div>
  );
}

export default ConfidentialityModeSettings;
