/**
 * TrustBar — the hero trust element.
 *
 * Research finding (Streams A + C converge): the egress indicator was the
 * single most emotionally powerful moment in the persona study, yet today it
 * is buried among nine items in a 24px status strip. Here it is elevated to a
 * prominent, always-visible set of controls: where an AI request would go,
 * how to inspect routing, and a one-click Privacy Center. The visible client
 * scope label no longer lives here.
 *
 * Chrome redesign: the client scope label moved out of the top bar. This wrapper
 * keeps the right-side trust controls together so desktop harnesses still grip
 * data-testid="trust-bar".
 */
import { Info, Lock } from 'lucide-react';
import { useActiveMatter } from '@/platform/matter/matterStore';
import { useConfidentialityMode } from '@/platform/hooks/useConfidentialityMode';
import { useActiveEgressDestination } from '@/platform/hooks/useActiveEgressProvider';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/ui/tooltip';
import { useEntityLabelEnglish } from '@/platform/hooks/useEntityLabel';
import { IconButton } from '@/ui/kp';
import { EV_OPEN_PRIVACY_CENTER, EV_OPEN_SETTINGS } from '@/config/identity';
import { EgressIndicator } from '@/platform/privacy/ui/EgressIndicator';

interface TrustBarProps {
  inline?: boolean;
}

export function TrustBar({ inline = false }: TrustBarProps) {
  const activeMatter = useActiveMatter();
  const confidentialityMode = useConfidentialityMode();
  // Single source of truth: provider id + whether the firm assured proxy is live,
  // so the badge renders the real destination (incl. assured) — never a provider
  // the send won't use. null == "checking" (mode just changed / not settled yet).
  const egressDestination = useActiveEgressDestination(confidentialityMode);
  const egressProvider = egressDestination?.providerId ?? null;
  const assuredAvailable = egressDestination?.assuredAvailable ?? false;
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
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-end',
        gap: 10,
        height: inline ? 48 : 36,
        padding: inline ? '0 2px 0 0' : '0 14px 0 16px',
        flex: inline ? '1 1 auto' : 'none',
        minWidth: 0,
        background: inline ? 'transparent' : 'var(--color-background)',
        borderBottom: inline ? 'none' : '1px solid var(--color-border)',
      }}
    >
      {/* Info affordance: reveals the full data-routing explanation on hover.
          A7: title added as a standard browser tooltip alongside the Radix tooltip. */}
      <Tooltip>
        <TooltipTrigger asChild>
          <IconButton
            icon={Info}
            label="Data flow"
            variant="ghost"
            size="xs"
            {...(inline ? { className: 'hidden sm:inline-flex' } : {})}
            title="Data flow"
            style={{ flexShrink: 0 }}
          />
        </TooltipTrigger>
        <TooltipContent side="bottom" style={{ maxWidth: 340, lineHeight: 1.5, zIndex: 'var(--kp-z-tooltip)' as unknown as number }}>
          <p style={{ marginBottom: 4, fontWeight: 600 }}>Data flow</p>
          <p style={{ marginBottom: 6 }}>{egressTooltip}</p>
          <p style={{ color: 'var(--color-muted-foreground)' }}>{scopeSubtitle}</p>
        </TooltipContent>
      </Tooltip>

      {/* F1: the ONE always-visible egress pill for the whole app. The short
          status form ("Using local AI" / "Using cloud AI" / "No AI connected");
          the full provider detail stays in its tooltip + the inspectable data-*
          attributes. The per-surface duplicate pills (Ask, Client Map, Workflow
          template) were removed so this can never be contradicted on one screen. */}
      <EgressIndicator
        provider={egressProvider}
        mode={confidentialityMode}
        assuredAvailable={assuredAvailable}
        variant="status"
        onClick={() => { window.dispatchEvent(new CustomEvent(EV_OPEN_SETTINGS, { detail: { category: 'ai' } })); }}
        {...(inline
          ? { className: 'min-w-0 shrink overflow-hidden' }
          : {})}
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
    </div>
  );
}
