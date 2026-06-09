/**
 * ConfidentialityModeSettings — the visible "confidentiality spectrum" picker.
 *
 * Three modes, shown as selectable cards so the whole spectrum is legible at a
 * glance (the adoption blocker is that lawyers can't *explain* where data goes;
 * seeing the range, with the active one marked, is the fix):
 *
 *   - Local-only  Only local models (Ollama) are usable; cloud providers are
 *                 disabled. Nothing leaves the machine. Selecting this
 *                 constrains the model picker elsewhere.
 *   - Direct      Default. Your own key, straight to your chosen provider.
 *   - Assured     Coming soon — shown disabled so the future zero-retention
 *                 option is visible, but it is not selectable yet.
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
/* eslint-disable keepance-i18n/no-hardcoded-string */

import { useState } from 'react';
import { Laptop, Cloud, ShieldCheck, ShieldOff, MapPin, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  useConfidentialityMode,
  useSetConfidentialityMode,
} from '@/hooks/useConfidentialityMode';
import { modeIsComingSoon, type ConfidentialityMode } from '@/modules/privacy/egress';
import { DataMapDialog } from '@/components/privacy/DataMapDialog';
import {
  usePrivilegedMatterMode,
  useSetPrivilegedMatterMode,
} from '@/hooks/usePrivilegedMatterMode';

interface ModeCard {
  mode: ConfidentialityMode;
  icon: typeof Laptop;
  title: string;
  blurb: string;
  /** Light-theme accent for the selected ring + icon. */
  accent: string;
  comingSoon?: boolean;
}

const CARDS: ModeCard[] = [
  {
    mode: 'local-only',
    icon: Laptop,
    title: 'Local-only',
    blurb:
      'Nothing leaves your machine. Only local models (Ollama) can be selected; cloud providers are turned off. Use this for your most sensitive client work.',
    accent: 'text-emerald-700 border-emerald-400 dark:text-emerald-300 dark:border-emerald-700',
  },
  {
    mode: 'direct',
    icon: Cloud,
    title: 'Direct (your key)',
    blurb:
      'Your own API key talks directly to your chosen provider (Anthropic, OpenAI, or Google). Keepance is not in between. The provider sees your prompt, so control retention and training in your provider account.',
    accent: 'text-sky-700 border-sky-400 dark:text-sky-300 dark:border-sky-700',
  },
  {
    mode: 'assured',
    icon: ShieldCheck,
    title: 'Assured',
    blurb:
      'A future zero-retention relay for teams that need a contractual no-logging guarantee on top of a cloud model. Not available yet.',
    accent: 'text-slate-600 border-slate-300 dark:text-slate-400 dark:border-slate-700',
    comingSoon: true,
  },
];

export function ConfidentialityModeSettings() {
  const active = useConfidentialityMode();
  const setMode = useSetConfidentialityMode();
  const [dataMapOpen, setDataMapOpen] = useState(false);
  const privileged = usePrivilegedMatterMode();
  const setPrivileged = useSetPrivilegedMatterMode();

  return (
    <div
      data-testid="confidentiality-mode-settings"
      data-active-mode={active}
      className="py-3 border-b border-border/50"
    >
      <div className="mb-3">
        <h3 className="text-sm font-medium">Confidentiality mode</h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          Controls where AI requests are allowed to go. This drives the egress
          indicator you see while chatting.
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        {CARDS.map((card) => {
          const Icon = card.icon;
          const selected = active === card.mode;
          const disabled = !!card.comingSoon || modeIsComingSoon(card.mode);
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
                {selected && !disabled && (
                  <Check className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-label="Selected" />
                )}
                {disabled && (
                  <span className="text-[10px] uppercase tracking-wide rounded-full px-1.5 py-0.5 bg-muted text-muted-foreground">
                    Coming soon
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">{card.blurb}</p>
            </button>
          );
        })}
      </div>

      {active === 'local-only' && (
        <p
          data-testid="confidentiality-local-active-note"
          className="mt-2 text-xs rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200"
        >
          Local-only is on. Cloud providers are disabled in the chat picker, so
          only local models (Ollama) can be used, and nothing leaves your
          machine. Make sure Ollama is installed and running (Settings →
          Integrations).
        </p>
      )}

      {/* Privileged Matter Mode toggle. Manual switch + an honest note about the
          auto-on behaviour. When a privileged matter is active or Local-only is
          selected, the mode is forced on and the switch is disabled (you cannot
          allow network extensions on a privileged matter). */}
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
              Privileged Matter Mode
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
            data-testid="privileged-matter-mode-switch"
            disabled={privileged.forced}
            onClick={() => {
              if (!privileged.forced) setPrivileged(!privileged.manual);
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
              ? 'On automatically because the active matter is privileged. It stays on until you switch to a non-privileged matter.'
              : 'On automatically because Local-only is selected. It stays on while Local-only is the confidentiality mode.'}
          </p>
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
