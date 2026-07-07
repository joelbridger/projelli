/**
 * TrustBar — the hero trust element.
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
/* eslint-disable lantern-i18n/no-hardcoded-string */
import { Briefcase, Globe, Info, Lock } from 'lucide-react';
import { useActiveMatter } from '@/platform/matter/matterStore';
import { matterLabel } from '@/platform/rag/matterResolver';
import { useConfidentialityMode } from '@/platform/hooks/useConfidentialityMode';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/ui/tooltip';
import { useEntityLabelEnglish } from '@/platform/hooks/useEntityLabel';
import { IconButton } from '@/ui/kp';
import { EV_OPEN_PRIVACY_CENTER } from '@/config/identity';

export function TrustBar() {
  const activeMatter = useActiveMatter();
  const confidentialityMode = useConfidentialityMode();
  // Fixed-English escape hatch: this whole component's copy is exempted from
  // i18n (see the file-level eslint-disable above; KNOWN-I18N-01), so the
  // noun stays English too rather than mixing languages.
  const entityLabel = useEntityLabelEnglish();

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

      {/* The AI-status pill is NOT shown here anymore — it lives once, per tab,
          top-right on each surface header (Ask / Client Map / Workflows). The
          top bar keeps only the info + lock affordances. The full Data Map now
          lives inside the Privacy Center opened by the lock. */}

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
    </div>
  );
}
