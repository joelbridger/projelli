/**
 * ConfidentialityModeSettings — the visible "confidentiality spectrum" picker.
 *
 * Three modes, shown as selectable cards so the whole spectrum is legible at a
 * glance (the adoption blocker is that lawyers can't *explain* where data goes;
 * seeing the range, with the active one marked, is the fix):
 *
 *   - Local-only  Documents and prompts are never sent to a cloud AI: only
 *                 on-device models are usable (the built-in Advisor Prep Hero Local AI
 *                 by default, or the user's own Ollama) and cloud AI providers
 *                 are disabled. (User-authorized connectors still sync.)
 *                 Selecting this constrains the model picker elsewhere.
 *   - Direct      Default. Your own key, straight to your chosen provider.
 *   - Assured     Selectable once the firm admin sets a managed key; routed
 *                 through the firm's zero-retention proxy (managed key + DPA).
 *
 * Also hosts the entry point to the full Data Map ("Where your data lives…").
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

import { useState, useRef } from 'react';
import { Laptop, Cloud, ShieldCheck, ShieldOff, MapPin, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/ui/button';
import {
  useConfidentialityMode,
  useRecordConfidentialityChoice,
} from '@/platform/hooks/useConfidentialityMode';
import { modeNeedsManagedKey, type ConfidentialityMode } from '@/platform/privacy/egress';
import { DataMapDialog } from '@/platform/privacy/ui/DataMapDialog';
import {
  usePrivilegedMatterMode,
  useSetPrivilegedMatterMode,
} from '@/platform/hooks/usePrivilegedMatterMode';
import { useFirmStore } from '@/platform/firm/firmStore';

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
      'AI runs on your machine: your documents and prompts are never sent to a cloud AI. Cloud AI providers are turned off and only on-device models are used — the built-in Advisor Prep Hero Local AI, or your own Ollama. Connectors you have set up still sync. Use this for your most sensitive client work.',
    accent: 'text-emerald-700 border-emerald-400 dark:text-emerald-300 dark:border-emerald-700',
    tag: 'Most private',
  },
  {
    mode: 'direct',
    icon: Cloud,
    title: 'Cloud AI (your account)',
    blurb:
      'Your own API key talks directly to your chosen AI provider (Anthropic, OpenAI, or Google). Advisor Prep Hero is not in between. The provider sees your prompt, so control retention and training in your provider account.',
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
    "Cloud inference routed through the Advisor Prep Hero zero-retention proxy using your firm's managed key. We keep nothing (DPA + provider zero-retention). Available once your firm admin sets a managed key.",
  accent: 'text-indigo-700 border-indigo-400 dark:text-indigo-300 dark:border-indigo-700',
};

export function ConfidentialityModeSettings() {
  const active = useConfidentialityMode();
  const setMode = useRecordConfidentialityChoice();
  const [dataMapOpen, setDataMapOpen] = useState(false);
  const privileged = usePrivilegedMatterMode();
  const setPrivileged = useSetPrivilegedMatterMode();
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
      <div className="mb-3">
        <h3 className="text-sm font-medium">Where AI requests go</h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          Choose whether AI requests stay on your computer or are sent to a cloud provider you control.
        </p>
      </div>

      <div className={cn('grid gap-2', isFirmUser ? 'sm:grid-cols-3' : 'sm:grid-cols-2')}>
        {cards.map((card) => {
          const Icon = card.icon;
          const selected = active === card.mode;
          // Assured is gated on a managed key being configured; others are always on.
          const disabled =
            (!!card.comingSoon && card.mode !== 'assured') ||
            modeNeedsManagedKey(card.mode, assuredAvailable);
          return (
            <button
              key={card.mode}
              type="button"
              data-testid={`confidentiality-mode-${card.mode}`}
              data-selected={selected ? 'true' : 'false'}
              data-disabled={disabled ? 'true' : 'false'}
              disabled={disabled}
              aria-pressed={selected}
              onClick={() => {
                if (!disabled) setMode(card.mode);
              }}
              className={cn(
                'relative text-left rounded-lg border p-3 transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                disabled
                  ? 'opacity-60 cursor-not-allowed border-border bg-muted/20'
                  : selected
                    ? cn('bg-background shadow-sm', card.accent)
                    : 'border-border hover:bg-muted/30',
              )}
            >
              <div className="flex items-center justify-between gap-2 mb-1">
                <span
                  className={cn(
                    'inline-flex items-center gap-1.5 font-medium text-sm',
                    selected && !disabled ? '' : 'text-foreground',
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" aria-hidden />
                  {card.title}
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
              <p className="text-xs text-muted-foreground leading-relaxed">{card.blurb}</p>
            </button>
          );
        })}
      </div>

      {/* Firm security note — shown when the user is a firm member so Assured is visible */}
      {isFirmUser && (
        <p className="mt-1 text-[11px] text-muted-foreground">
          Firm security: the Assured option above routes AI requests through your firm's zero-retention proxy so Advisor Prep Hero retains nothing.
        </p>
      )}

      {active === 'local-only' && (
        <p
          data-testid="confidentiality-local-active-note"
          className="mt-2 text-xs rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200"
        >
          On this computer only is on. Your documents and prompts are never sent
          to a cloud AI — answers run on a local model on your machine (the
          built-in Advisor Prep Hero Local AI when it&rsquo;s ready, or your own Ollama).
          Cloud AI providers are disabled in the chat picker. Connectors you have
          set up still sync.
        </p>
      )}

      {/* Network lockdown (Isolated matter) toggle. Manual switch + an honest note
          about the auto-on behaviour. When a matter with network lockdown is active
          or Local-only is selected, the mode is forced on and the switch is disabled. */}
      <div
        data-testid="privileged-matter-mode-toggle"
        data-active={privileged.active ? 'true' : 'false'}
        data-forced={privileged.forced ? 'true' : 'false'}
        className="mt-4 rounded-lg border border-rose-200 dark:border-rose-900/60 p-3"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <span className="inline-flex items-center gap-1.5 text-sm font-medium">
              <ShieldOff className="h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" aria-hidden />
              Network lockdown
            </span>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              Turns off network-capable extensions so confidential work cannot
              leave your machine through one. Network plugins are blocked and MCP
              servers are disabled. Everything else keeps working.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={privileged.active}
            aria-label="Network lockdown"
            data-testid="privileged-matter-mode-switch"
            disabled={privileged.forced}
            onClick={() => {
              if (!privileged.forced) {
                const turningOn = !privileged.manual;
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
              privileged.active ? 'bg-rose-600' : 'bg-muted-foreground/30',
              privileged.forced && 'opacity-70 cursor-not-allowed',
            )}
          >
            <span
              className={cn(
                'inline-block h-4 w-4 transform rounded-full bg-white transition-transform',
                privileged.active ? 'translate-x-4' : 'translate-x-0.5',
              )}
            />
          </button>
        </div>
        {privileged.forced && (
          <p
            data-testid="privileged-matter-mode-forced-note"
            className="mt-2 text-xs rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-rose-900 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200"
          >
            {privileged.trigger === 'privileged-matter'
              ? 'On automatically because the active client has network lockdown. It stays on until you switch to a different client.'
              : 'On automatically because On this computer only is selected. It stays on while that option is active.'}
          </p>
        )}
        {/* Affirmation: shown for ~5 s after the user manually turns lockdown on */}
        {showLockdownAffirmation && !privileged.forced && (
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

      <div className="mt-3">
        <Button
          data-testid="open-data-map"
          variant="outline"
          size="sm"
          className="gap-1.5 text-xs"
          onClick={() => {
            setDataMapOpen(true);
          }}
        >
          <MapPin className="h-3.5 w-3.5" />
          Where your data lives and who can see it
        </Button>
      </div>

      <DataMapDialog open={dataMapOpen} onOpenChange={setDataMapOpen} />
    </div>
  );
}

export default ConfidentialityModeSettings;
