/**
 * ReimaginedTrustBar — the hero trust element.
 *
 * Research finding (Streams A + C converge): the egress indicator was the
 * single most emotionally powerful moment in the persona study, yet today it
 * is buried among nine items in a 24px status strip. Here it is elevated to a
 * prominent, always-visible bar: which matter you are in (scope) on the left,
 * and exactly where an AI request would go (egress) on the right. Composes the
 * already-wired EgressIndicator + matter scope + Data Map, so the trust state
 * is real, not a mock. Rendered only in the reimagined shell.
 *
 * Compact redesign: single tight line — matter scope on the left, egress pill
 * on the right — with a small info icon that reveals the full data-routing
 * explanation on demand (tooltip). The always-visible two-line paragraph is
 * removed; the meaning (three confidentiality states, color-coded) stays.
 */
/* eslint-disable keepance-i18n/no-hardcoded-string */
import { useState, useMemo } from 'react';
import { Briefcase, Globe, Map as MapIcon, Info } from 'lucide-react';
import { useActiveMatter } from '@/platform/matter/matterStore';
import { matterLabel } from '@/platform/rag/matterResolver';
import { useConfidentialityMode } from '@/platform/hooks/useConfidentialityMode';
import { EgressIndicator } from '@/platform/privacy/ui/EgressIndicator';
import { DataMapDialog } from '@/platform/privacy/ui/DataMapDialog';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/ui/tooltip';
import { useEntityLabel } from '@/platform/hooks/useEntityLabel';
import { IconButton } from '@/ui/kp';
import type { EgressProvider } from '@/platform/privacy/egress';

/**
 * Derive the active AI provider for the egress pill.
 *
 * The TrustBar lives at app-shell level, outside any specific chat, so there is
 * no single "active chat provider" available. We derive the truthful pill value
 * in priority order:
 *   1. local-only mode => always "ollama" (nothing leaves regardless of config).
 *   2. First cloud provider for which the user has saved an API key in
 *      localStorage (same storage used by useApiKeys), checked in the same order
 *      the settings UI presents providers: anthropic > openai > google.
 *   3. Fallback: 'anthropic' (the most common default; resolveEgress labels it
 *      accurately, so this only fires when no key exists yet).
 */
function useActiveEgressProvider(mode: string): EgressProvider {
  return useMemo(() => {
    if (mode === 'local-only') return 'ollama';
    const order: EgressProvider[] = ['anthropic', 'openai', 'google'];
    for (const p of order) {
      try {
        if (localStorage.getItem(`apiKey_${p}`)) return p;
      } catch {
        // localStorage may be unavailable in some environments; fall through.
      }
    }
    return 'anthropic';
  // Re-derive when the confidentiality mode changes; localStorage is not
  // reactive, but provider selection is stable within a session.
  }, [mode]);
}

export function ReimaginedTrustBar() {
  const activeMatter = useActiveMatter();
  const confidentialityMode = useConfidentialityMode();
  const activeProvider = useActiveEgressProvider(confidentialityMode);
  const [dataMapOpen, setDataMapOpen] = useState(false);
  const entityLabel = useEntityLabel();

  const scopeSubtitle = activeMatter
    ? `Scoped to this ${entityLabel.one}. Nothing from other clients can appear.`
    : `Searching across every ${entityLabel.one}. Answers may draw on more than one client. Nothing leaves your machine.`;

  const egressTooltip =
    confidentialityMode === 'local-only'
      ? 'On this computer only: AI runs on your machine. Nothing leaves your device.'
      : confidentialityMode === 'assured'
        ? 'Assured: requests route through your firm\'s zero-retention proxy. Keepance never sees content.'
        : 'Sent to your AI provider account. Sent straight from your machine to your provider with your own API key. Keepance is not in between. Your provider receives the prompt and may keep it briefly for abuse monitoring; control training opt-out in your provider account.';

  return (
    <div
      data-testid="trust-bar"
      aria-label="Trust and confidentiality status"
      style={{
        display: 'flex', alignItems: 'center', gap: 10, height: 36,
        padding: '0 14px 0 16px', flex: 'none',
        background: 'var(--color-background)', borderBottom: '1px solid var(--color-border)',
      }}
    >
      {/* Matter scope — icon + label only, tight */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
        {activeMatter
          ? <Briefcase size={14} strokeWidth={1.75} style={{ color: 'var(--kp-navy)', flex: 'none' }} />
          : <Globe size={14} strokeWidth={1.75} style={{ color: 'var(--kp-navy)', flex: 'none' }} />}
        <span
          style={{
            fontSize: 'var(--kp-font-xs)', fontWeight: 'var(--kp-weight-semibold)', color: 'var(--kp-navy)',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 280,
          }}
        >
          {activeMatter ? matterLabel(activeMatter) : `All ${entityLabel.other}`}
        </span>
      </div>

      <div style={{ flex: 1 }} />

      {/* The egress hero: compact pill, color-coded by confidentiality state.
          max-w-none overrides the compact variant's default max-w-[260px] so the
          full sentence ("On your machine. Nothing leaves.") never clips at any
          viewport width. The flex-shrink:0 wrapper prevents the pill from being
          squeezed by the sibling matter-scope label. */}
      <div style={{ flexShrink: 0 }}>
        <EgressIndicator provider={activeProvider} mode={confidentialityMode} variant="compact" className="max-w-none" />
      </div>

      {/* Info affordance: reveals the full data-routing explanation on hover.
          A7: title added as a standard browser tooltip alongside the Radix tooltip. */}
      <Tooltip>
        <TooltipTrigger asChild>
          <IconButton
            icon={Info}
            label="Where does my data go?"
            variant="ghost"
            size="xs"
            title="What is this?"
            style={{ flexShrink: 0 }}
          />
        </TooltipTrigger>
        <TooltipContent side="bottom" style={{ maxWidth: 340, lineHeight: 1.5, zIndex: 'var(--kp-z-tooltip)' as unknown as number }}>
          <p style={{ marginBottom: 4, fontWeight: 600 }}>Where does your data go?</p>
          <p style={{ marginBottom: 6 }}>{egressTooltip}</p>
          <p style={{ color: 'var(--color-muted-foreground)' }}>{scopeSubtitle}</p>
        </TooltipContent>
      </Tooltip>

      {/* Data Map button — A7: title already set; aria-label retained for screen readers. */}
      <IconButton
        icon={MapIcon}
        label="Open the Data Map"
        variant="ghost"
        size="xs"
        title="Where your data goes"
        onClick={() => { setDataMapOpen(true); }}
        style={{ flexShrink: 0 }}
      />

      <DataMapDialog open={dataMapOpen} onOpenChange={setDataMapOpen} />
    </div>
  );
}
