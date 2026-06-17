/**
 * F1 (Workstream F, Phase 1) — Compact AI spend summary for the Settings panel.
 *
 * Shows three rolling totals sourced from the aiChatStore daily buckets:
 *   - Today
 *   - Rolling 7 days
 *   - This calendar month
 *
 * Also surfaces a plain-English note clarifying that these costs come
 * directly from the user's API provider, not from Keepance.
 *
 * Intentionally self-contained: no audit-log dependency, no props needed
 * beyond an optional `now` override for deterministic tests.
 */

import { useTodayCost, useLast7DaysCost, useThisMonthCost } from '@/platform/state/aiChatStore';
import { formatCostLong } from '@/features/ask/ChatCostChip';
import { cn } from '@/lib/utils';

export interface CostDashboardProps {
  /** Override the current date for tests. Passed through to hooks. */
  now?: Date;
  className?: string;
}

interface StatRowProps {
  label: string;
  value: string;
  testid?: string;
}

function StatRow({ label, value, testid }: StatRowProps) {
  return (
    <div
      data-testid={testid}
      className="flex items-center justify-between py-2.5 border-b border-border/40 last:border-b-0"
    >
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-mono font-medium tabular-nums">{value}</span>
    </div>
  );
}

export function CostDashboard({ now, className }: CostDashboardProps) {
  const today = useTodayCost();
  const week = useLast7DaysCost(now);
  const month = useThisMonthCost(now);

  // Determine which providers appear in today's data for the disclosure note.
  const providerNames = Object.keys(today.byProvider)
    .filter((k) => today.byProvider[k]! > 0)
    .map((k) => {
      switch (k) {
        case 'anthropic': return 'Anthropic';
        case 'openai': return 'OpenAI';
        case 'google': return 'Google';
        case 'ollama': return 'Ollama';
        default: return k;
      }
    });

  const providerPhrase =
    providerNames.length === 0
      ? 'your AI provider'
      : providerNames.length === 1
        ? providerNames[0]!
        : providerNames.slice(0, -1).join(', ') + ' and ' + providerNames[providerNames.length - 1];

  return (
    <div
      data-testid="cost-dashboard"
      className={cn('rounded-lg border border-border bg-card p-5', className)}
    >
      <div className="mb-3">
        <h3 className="text-sm font-semibold">AI Usage</h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          Costs are billed directly by {providerPhrase}, not by Keepance.
        </p>
      </div>

      <div className="space-y-0">
        <StatRow
          label="Today"
          value={formatCostLong(today.cost)}
          testid="cost-dashboard-today"
        />
        <StatRow
          label="Last 7 days"
          value={formatCostLong(week.cost)}
          testid="cost-dashboard-week"
        />
        <StatRow
          label="This month"
          value={formatCostLong(month.cost)}
          testid="cost-dashboard-month"
        />
      </div>

      {today.inputTokens + today.outputTokens > 0 && (
        <p
          data-testid="cost-dashboard-token-note"
          className="mt-3 text-[11px] text-muted-foreground"
        >
          Today: {today.inputTokens.toLocaleString()} tokens in,{' '}
          {today.outputTokens.toLocaleString()} tokens out
        </p>
      )}

      <p className="mt-3 text-[10px] text-muted-foreground/70">
        Figures come from this device only and reset when you clear app data. Full history is in the Cost &amp; Usage tab.
      </p>
    </div>
  );
}

export default CostDashboard;
