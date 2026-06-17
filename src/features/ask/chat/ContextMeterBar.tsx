/**
 * Stream A4 — shows live context utilization and projected next-message cost.
 *
 * Props:
 *   usedTokens      - tokens already consumed by history + injected context
 *   limitTokens     - chatContextTokenLimit setting value
 *   projectedCost   - estimated cost of next send (from provider pricing)
 *   modelLabel      - short model name for display ("Sonnet", "gpt-4o", etc.)
 *   onCompressClick - called when user clicks [Compress]
 */

import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { formatContextSize } from '@/modules/models/context-limits';
import { formatCostShort } from '@/features/ask/ChatCostChip';

export interface ContextMeterBarProps {
  usedTokens: number;
  limitTokens: number;
  projectedCost: number | null;
  modelLabel: string;
  onCompressClick: () => void;
  className?: string;
}

export function ContextMeterBar({
  usedTokens,
  limitTokens,
  projectedCost,
  modelLabel,
  onCompressClick,
  className,
}: ContextMeterBarProps) {
  const { t } = useTranslation();
  const pct = limitTokens > 0 ? Math.min(usedTokens / limitTokens, 1) : 0;
  const isNearLimit = pct >= 0.8;
  const showCompress = pct >= 0.5;

  const usedLabel = formatContextSize(usedTokens);
  const limitLabel = formatContextSize(limitTokens);
  const costLabel = projectedCost != null ? formatCostShort(projectedCost) : null;

  return (
    <div
      className={cn(
        'flex items-center gap-2 text-[11px] text-muted-foreground select-none',
        className
      )}
      data-testid="context-meter-bar"
    >
      {/* Utilization text */}
      <span data-testid="context-meter-usage">
        Context: {usedLabel} of {limitLabel}
      </span>

      {/* Cost preview — only shown when we have a projection */}
      {costLabel && (
        <>
          <span aria-hidden className="text-muted-foreground/40">{'·'}</span>
          <span data-testid="context-meter-cost">
            {t('chat.context-meter.next-msg', { cost: costLabel, model: modelLabel })}
          </span>
        </>
      )}

      {/* 80% warning chip */}
      {isNearLimit && (
        <span
          data-testid="context-meter-warning"
          className="rounded-full bg-amber-100 text-amber-700 px-1.5 py-0.5 font-medium"
        >
          Context {Math.round(pct * 100)}% full
        </span>
      )}

      {/* Compress button — spacer pushes it right */}
      <span className="flex-1" />
      {showCompress && (
        <button
          data-testid="context-meter-compress-btn"
          onClick={onCompressClick}
          className="rounded px-1.5 py-0.5 text-[11px] border border-border/60 hover:bg-muted transition-colors"
          type="button"
          aria-label="Compress older messages to free context space"
        >
          Compress
        </button>
      )}
    </div>
  );
}

export default ContextMeterBar;
