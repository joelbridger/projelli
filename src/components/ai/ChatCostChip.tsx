/**
 * Q3 (Wave 1.2) — Real-time API cost chip for the chat pane.
 *
 * A small, unobtrusive chip anchored in the chat input area that shows
 * two running totals:
 *   - This chat so far (per-chat aggregate)
 *   - Today across all chats (per-day aggregate, keyed by local YYYY-MM-DD)
 *
 * Hover reveals a tooltip with today's breakdown by provider.
 *
 * Design notes:
 *   - Reads cost directly from `useAIChatStore` via selectors, not props,
 *     so the chip auto-updates when `recordCost` fires.
 *   - Zero / unknown costs render as an em-dash-free placeholder ("-").
 *   - Cost formatting: 2 decimals below $1, 1 decimal otherwise. Per
 *     Jameson's no-em-dash rule, we use ASCII hyphens throughout.
 */

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  useChatCost,
  useTodayCost,
  type TodayCostSummary,
} from '@/stores/aiChatStore';
import { cn } from '@/lib/utils';

export interface ChatCostChipProps {
  chatId: string;
  className?: string;
}

const PROVIDER_LABELS: Record<string, string> = {
  anthropic: 'Claude',
  openai: 'OpenAI',
  google: 'Gemini',
  ollama: 'Ollama',
  unknown: 'Other',
};

/**
 * Formats a USD cost for display on the chip. Returns a leading "$" or
 * the placeholder "-" when the value is 0 / NaN / not-a-finite-number.
 */
export function formatCostShort(cost: number): string {
  if (!Number.isFinite(cost) || cost <= 0) return '-';
  if (cost < 1) return `$${cost.toFixed(2)}`;
  return `$${cost.toFixed(1)}`;
}

export function formatCostLong(cost: number): string {
  if (!Number.isFinite(cost) || cost <= 0) return '$0.00';
  if (cost < 1) return `$${cost.toFixed(3)}`;
  return `$${cost.toFixed(2)}`;
}

function buildBreakdownRows(summary: TodayCostSummary): Array<{
  provider: string;
  label: string;
  cost: number;
}> {
  return Object.entries(summary.byProvider)
    .filter(([, cost]) => cost > 0)
    .map(([provider, cost]) => ({
      provider,
      label: PROVIDER_LABELS[provider] ?? provider,
      cost,
    }))
    .sort((a, b) => b.cost - a.cost);
}

export function ChatCostChip({ chatId, className }: ChatCostChipProps) {
  const chatCost = useChatCost(chatId);
  const today = useTodayCost();

  const chatStr = formatCostShort(chatCost.cost);
  const todayStr = formatCostShort(today.cost);
  const rows = buildBreakdownRows(today);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          data-testid="chat-cost-chip"
          className={cn(
            'inline-flex items-center gap-1 rounded-full border border-border/60',
            'bg-background/80 px-2 py-0.5 text-[11px] leading-tight text-muted-foreground',
            'cursor-default select-none',
            className
          )}
          aria-label={`Cost: ${chatStr} this chat, ${todayStr} today`}
        >
          <span data-testid="chat-cost-chip-chat">{chatStr} this chat</span>
          <span aria-hidden className="text-muted-foreground/40">
            {'\u00B7'}
          </span>
          <span data-testid="chat-cost-chip-today">{todayStr} today</span>
        </div>
      </TooltipTrigger>
      <TooltipContent
        data-testid="chat-cost-chip-tooltip"
        side="top"
        align="end"
        className="max-w-[260px]"
      >
        <div className="space-y-1.5 py-0.5">
          <div className="font-medium text-[11px]">
            Today so far: {formatCostLong(today.cost)}
          </div>
          {rows.length === 0 ? (
            <div className="text-[11px] text-muted-foreground">
              No AI requests yet today.
            </div>
          ) : (
            <ul className="space-y-0.5 text-[11px]">
              {rows.map((row) => (
                <li
                  key={row.provider}
                  data-testid={`chat-cost-chip-tooltip-row-${row.provider}`}
                  className="flex items-center justify-between gap-3"
                >
                  <span>{row.label}</span>
                  <span className="font-mono">{formatCostLong(row.cost)}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="pt-1 border-t border-border/30 text-[10px] text-muted-foreground/80">
            This chat: {formatCostLong(chatCost.cost)} ({chatCost.inputTokens}
            {' in / '}
            {chatCost.outputTokens} out)
          </div>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

export default ChatCostChip;
