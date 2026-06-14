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
import { useState } from 'react';
import { Briefcase, Globe, Map as MapIcon, Info } from 'lucide-react';
import { useActiveMatter } from '@/stores/matterStore';
import { matterLabel } from '@/modules/memory/matterResolver';
import { useConfidentialityMode } from '@/hooks/useConfidentialityMode';
import { EgressIndicator } from '@/components/privacy/EgressIndicator';
import { DataMapDialog } from '@/components/privacy/DataMapDialog';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

export function ReimaginedTrustBar() {
  const activeMatter = useActiveMatter();
  const confidentialityMode = useConfidentialityMode();
  const [dataMapOpen, setDataMapOpen] = useState(false);

  const scopeSubtitle = activeMatter
    ? 'Scoped to this matter. Nothing from other clients can appear.'
    : 'Searching across every matter. Nothing crosses between clients.';

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
            fontSize: 12.5, fontWeight: 600, color: 'var(--kp-navy)',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 280,
          }}
        >
          {activeMatter ? matterLabel(activeMatter) : 'All matters'}
        </span>
      </div>

      <div style={{ flex: 1 }} />

      {/* The egress hero: compact pill, color-coded by confidentiality state.
          max-w-none overrides the compact variant's default max-w-[260px] so the
          full sentence ("On your machine. Nothing leaves.") never clips at any
          viewport width. The flex-shrink:0 wrapper prevents the pill from being
          squeezed by the sibling matter-scope label. */}
      <div style={{ flexShrink: 0 }}>
        <EgressIndicator provider="anthropic" mode={confidentialityMode} variant="compact" className="max-w-none" />
      </div>

      {/* Info affordance: reveals the full data-routing explanation on hover.
          A7: title added as a standard browser tooltip alongside the Radix tooltip. */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label="Where does my data go?"
            title="What is this?"
            style={{
              width: 24, height: 24, borderRadius: 4, border: 0, background: 'transparent',
              color: 'var(--color-muted-foreground)', cursor: 'pointer', display: 'grid', placeItems: 'center',
              flexShrink: 0,
            }}
          >
            <Info size={14} strokeWidth={1.75} />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" style={{ maxWidth: 340, lineHeight: 1.5 }}>
          <p style={{ marginBottom: 4, fontWeight: 600 }}>Where does your data go?</p>
          <p style={{ marginBottom: 6 }}>{egressTooltip}</p>
          <p style={{ color: 'var(--color-muted-foreground)' }}>{scopeSubtitle}</p>
        </TooltipContent>
      </Tooltip>

      {/* Data Map button — A7: title already set; aria-label retained for screen readers. */}
      <button
        type="button"
        onClick={() => { setDataMapOpen(true); }}
        title="Where your data goes"
        aria-label="Open the Data Map"
        style={{
          width: 24, height: 24, borderRadius: 4, border: 0, background: 'transparent',
          color: 'var(--color-muted-foreground)', cursor: 'pointer', display: 'grid', placeItems: 'center',
          flexShrink: 0,
        }}
      >
        <MapIcon size={14} strokeWidth={1.75} />
      </button>

      <DataMapDialog open={dataMapOpen} onOpenChange={setDataMapOpen} />
    </div>
  );
}
