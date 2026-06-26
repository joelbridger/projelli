/**
 * EgressIndicator — the always-visible "where does this go?" badge.
 *
 * Renders the truth from `resolveEgress(...)`: for the active chat's provider
 * and the active confidentiality mode, it states exactly where the NEXT AI
 * request will travel. Two variants:
 *
 *   - variant="full"    The composer badge: icon + label + an honest one-liner.
 *   - variant="compact" The status-bar mirror: icon + short label, with the
 *                        full note in the title tooltip.
 *
 * The component does NOT decide policy; it reflects it. All wording is keyed
 * to i18n but mirrors the canonical copy in `egress.ts` so the data story is
 * identical wherever it appears. Light-theme first, with dark-mode-safe colours.
 */

import { useTranslation } from 'react-i18next';
import { Laptop, Cloud, AlertTriangle, ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  resolveEgress,
  providerDisplayName,
  type EgressProvider,
  type ConfidentialityMode,
  type EgressInfo,
} from '@/platform/privacy/egress';
import { useConfidentialityMode } from '@/platform/hooks/useConfidentialityMode';
import { IS_DEMO } from '@/web-demo/demoModeFlag';

const BYOK_STORAGE_KEY = 'byokKey';

/** Demo-only: has the user pasted a personal key? Mirrors demoAIProvider. */
function hasDemoByokKey(): boolean {
  if (!IS_DEMO) return false;
  try {
    const raw = localStorage.getItem(BYOK_STORAGE_KEY);
    return !!raw && raw.trim().length > 0;
  } catch {
    return false;
  }
}

export interface EgressIndicatorProps {
  /**
   * Provider the next send will use (the active chat's provider), or `null` when
   * the embedded local-model status probe has not resolved yet. `null` renders a
   * neutral "Checking local AI" badge (nothing leaves) instead of guessing a
   * destination — the composer disables send for the same window.
   */
  provider: EgressProvider | null;
  /**
   * Override the confidentiality mode. When omitted the hook value is used.
   * Exposed for tests and for surfaces that already hold the mode.
   */
  mode?: ConfidentialityMode;
  /**
   * Whether the firm has a managed assured key for this provider. Only matters
   * when the mode is 'assured': true routes through the zero-retention proxy,
   * false falls back to the honest BYOK-direct story.
   */
  assuredAvailable?: boolean;
  variant?: 'full' | 'compact';
  className?: string;
}

const SEVERITY_STYLES: Record<EgressInfo['severity'], string> = {
  // Light-theme palette; dark variants keep contrast without going neon.
  safe: 'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200',
  direct:
    'border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-200',
  // Assured: indigo reads as "managed / contractual" — distinct from BYOK sky.
  assured:
    'border-indigo-300 bg-indigo-50 text-indigo-900 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-200',
  warn: 'border-amber-400 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200',
};

/**
 * Render the destination icon inline (not as a `const Icon = ...` reference) so
 * the icon's component identity never changes across renders. `className` lets
 * the two variants size it differently.
 */
function EgressIcon({ info, className }: { info: EgressInfo; className: string }) {
  if (info.destination === 'local') return <Laptop className={className} aria-hidden />;
  if (info.destination === 'demo-proxy')
    return <AlertTriangle className={className} aria-hidden />;
  if (info.destination === 'assured-proxy')
    return <ShieldCheck className={className} aria-hidden />;
  return <Cloud className={className} aria-hidden />;
}

/**
 * Build the EgressInfo plus the i18n label/note. We keep `resolveEgress` as the
 * authority for destination/severity/dataLeaves and only translate the user-
 * facing strings, so the facts can't drift between code and copy.
 */
function useEgressView(
  provider: EgressProvider | null,
  modeOverride?: ConfidentialityMode,
  assuredAvailable = false,
) {
  const { t } = useTranslation();
  const hookMode = useConfidentialityMode();
  // Local-model status probe still pending: we genuinely don't know the
  // destination yet, so show a neutral "checking" badge instead of guessing.
  // Nothing leaves while we're in this state (the composer disables send too).
  if (provider === null) {
    return {
      pending: true as const,
      label: t('privacy.egress.checking.label'),
      note: t('privacy.egress.checking.note'),
    };
  }
  const mode = modeOverride ?? hookMode;
  const info = resolveEgress({
    provider,
    mode,
    isDemo: IS_DEMO,
    hasDemoByokKey: hasDemoByokKey(),
    assuredAvailable,
  });

  const name = providerDisplayName(info.provider);
  let label: string;
  let note: string;
  switch (info.destination) {
    case 'local':
      label = t('privacy.egress.local.label');
      // Name the actual local engine (Keepance Local AI vs a user-run Ollama)
      // so the privacy copy never mislabels which model is running.
      note = t('privacy.egress.local.note', { provider: name });
      break;
    case 'demo-proxy':
      label = t('privacy.egress.demo.label');
      note = t('privacy.egress.demo.note');
      break;
    case 'assured-proxy':
      // New firm path: use the canonical, audience-checked copy from egress.ts
      // (not yet split into i18n keys, like the confidentiality-mode copy).
      label = info.label;
      note = info.note;
      break;
    case 'provider-direct':
    default:
      label = t('privacy.egress.direct.label', { provider: name });
      note = t('privacy.egress.direct.note', { provider: name });
      break;
  }
  return { pending: false as const, info, label, note };
}

export function EgressIndicator({
  provider,
  mode,
  assuredAvailable = false,
  variant = 'full',
  className,
}: EgressIndicatorProps) {
  const view = useEgressView(provider, mode, assuredAvailable);

  // Neutral "checking" badge while the local-model status probe is unresolved.
  // data-data-leaves is hard "false" — nothing can leave during this window.
  if (view.pending) {
    const pendingStyles =
      'border-slate-300 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-300';
    if (variant === 'compact') {
      return (
        <div
          data-testid="egress-indicator-compact"
          data-destination="pending"
          data-data-leaves="false"
          className={cn(
            'flex items-center gap-1 max-w-[260px] rounded px-1.5 py-0.5 border',
            pendingStyles,
            className,
          )}
          title={`${view.label}. ${view.note}`}
        >
          <Laptop className="h-3 w-3 shrink-0 animate-pulse" aria-hidden />
          <span className="truncate">{view.label}</span>
        </div>
      );
    }
    return (
      <div
        data-testid="egress-indicator"
        data-destination="pending"
        data-data-leaves="false"
        role="status"
        aria-live="polite"
        className={cn(
          'flex items-start gap-2 rounded-md border px-3 py-2 text-xs leading-relaxed',
          pendingStyles,
          className,
        )}
      >
        <Laptop className="h-4 w-4 mt-0.5 shrink-0 animate-pulse" aria-hidden />
        <div className="min-w-0">
          <span data-testid="egress-indicator-label" className="font-semibold">
            {view.label}
          </span>
          <span data-testid="egress-indicator-note" className="ml-1.5 font-normal opacity-90">
            {view.note}
          </span>
        </div>
      </div>
    );
  }

  const { info, label, note } = view;

  if (variant === 'compact') {
    return (
      <div
        data-testid="egress-indicator-compact"
        data-destination={info.destination}
        data-severity={info.severity}
        data-data-leaves={info.dataLeaves ? 'true' : 'false'}
        className={cn(
          'flex items-center gap-1 max-w-[260px] rounded px-1.5 py-0.5 border',
          SEVERITY_STYLES[info.severity],
          className,
        )}
        title={`${label}. ${note}`}
      >
        <EgressIcon info={info} className="h-3 w-3 shrink-0" />
        <span className="truncate">{label}</span>
      </div>
    );
  }

  return (
    <div
      data-testid="egress-indicator"
      data-destination={info.destination}
      data-severity={info.severity}
      data-data-leaves={info.dataLeaves ? 'true' : 'false'}
      role="status"
      aria-live="polite"
      className={cn(
        'flex items-start gap-2 rounded-md border px-3 py-2 text-xs leading-relaxed',
        SEVERITY_STYLES[info.severity],
        className,
      )}
    >
      <EgressIcon info={info} className="h-4 w-4 mt-0.5 shrink-0" />
      <div className="min-w-0">
        <span data-testid="egress-indicator-label" className="font-semibold">
          {label}
        </span>
        {note && (
          <span data-testid="egress-indicator-note" className="ml-1.5 font-normal opacity-90">
            {note}
          </span>
        )}
      </div>
    </div>
  );
}

export default EgressIndicator;
