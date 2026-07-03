/**
 * TrustBarScope / TrustBarActions — the trust elements, folded into the
 * single merged app header (Wave B / S4: "no permanent second header").
 *
 * Research finding (Streams A + C converge): the egress indicator was the
 * single most emotionally powerful moment in the persona study, yet today it
 * is buried among nine items in a 24px status strip. These two pieces
 * compose the already-wired EgressIndicator + matter scope + Data Map, so the
 * trust state is real, not a mock — previously rendered as their own
 * full-width bar directly under the app header (workspace switcher / gear /
 * Ctrl+K); now they render AS PART of that same bar so a screen never shows
 * two near-identical, empty-feeling header rows stacked on top of each other.
 *
 * `TrustBarScope` — which matter you're in (the "client crumb"/"scope
 * chip"), rendered on the left, next to the workspace switcher.
 * `TrustBarActions` — the info tooltip + Data Map + Privacy Center shortcuts,
 * rendered on the right, next to the theme toggle / settings gear / Ctrl+K.
 * (The actual AI-status/egress PILL lives once, per tab, top-right on each
 * surface header — unchanged by this split.)
 */
/* eslint-disable lantern-i18n/no-hardcoded-string */
import { useState } from 'react';
import { Briefcase, Globe, Map as MapIcon, Info, Lock } from 'lucide-react';
import { useActiveMatter } from '@/platform/matter/matterStore';
import { matterLabel } from '@/platform/rag/matterResolver';
import { useConfidentialityMode } from '@/platform/hooks/useConfidentialityMode';
import { DataMapDialog } from '@/platform/privacy/ui/DataMapDialog';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/ui/tooltip';
import { useEntityLabel } from '@/platform/hooks/useEntityLabel';
import { IconButton } from '@/ui/kp';
import { EV_OPEN_PRIVACY_CENTER } from '@/config/identity';

/** The matter-scope label — icon + "This client" / "All clients" name. */
export function TrustBarScope() {
  const activeMatter = useActiveMatter();
  const entityLabel = useEntityLabel();

  return (
    <div
      data-testid="trust-bar-scope"
      aria-label="Current client scope"
      style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}
    >
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
  );
}

/** Info / Data Map / Privacy Center shortcuts — the right-hand trust cluster. */
export function TrustBarActions() {
  const activeMatter = useActiveMatter();
  const confidentialityMode = useConfidentialityMode();
  const [dataMapOpen, setDataMapOpen] = useState(false);
  const entityLabel = useEntityLabel();

  // BUG-023: this describes SCOPE (which clients' data the answer can draw on),
  // NOT egress. The old all-matters copy claimed "Nothing leaves your machine"
  // unconditionally, which is false in Direct/Assured cloud modes. Egress is
  // conveyed separately by the mode-aware egress indicator + `egressTooltip`.
  const scopeSubtitle = activeMatter
    ? `Scoped to this ${entityLabel.one}. Nothing from other clients can appear.`
    : `Searching across every ${entityLabel.one}. Answers may draw on more than one client.`;

  const egressTooltip =
    confidentialityMode === 'local-only'
      ? 'On this computer only: AI runs on your machine. No AI prompt or file is sent to a cloud AI.'
      : confidentialityMode === 'assured'
        ? 'Assured: requests route through your firm\'s zero-retention proxy. Advisor Prep Hero never sees content.'
        : 'Sent to your AI provider account. Sent straight from your machine to your provider with your own API key. Advisor Prep Hero is not in between. Your provider receives the prompt and may keep it briefly for abuse monitoring; control training opt-out in your provider account.';

  return (
    <div
      data-testid="trust-bar"
      aria-label="Trust and confidentiality status"
      style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 'none' }}
    >
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

      {/* Privacy Center shortcut — one click away from anywhere in the app. */}
      <IconButton
        icon={Lock}
        label="Open Privacy Center"
        variant="ghost"
        size="xs"
        title="Privacy Center"
        onClick={() => { window.dispatchEvent(new CustomEvent(EV_OPEN_PRIVACY_CENTER)); }}
        style={{ flexShrink: 0 }}
      />

      <DataMapDialog open={dataMapOpen} onOpenChange={setDataMapOpen} />
    </div>
  );
}
