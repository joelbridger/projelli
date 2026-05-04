/**
 * Q4 (Wave 1.2) — Monthly cost dashboard.
 *
 * Visualizes the last 30 days of AI API spend using an inline SVG bar
 * chart (no chart library dependency) plus a per-provider breakdown.
 *
 * Data source: AuditEntry[] pulled directly from the caller (usually
 * `App.tsx`'s live `auditEntries` state). Entries are considered a
 * "cost contribution" if any of these conditions hold:
 *   - `entry.costUsd` is a finite number > 0, OR
 *   - `entry.outputs.cost` / `metadata.cost_usd` / `outputs.cost_usd`
 *     is a finite number > 0 (backward compat with older logs)
 *
 * Retroactive entries without cost data are skipped silently; the
 * dashboard surfaces a small "Data from v1.5+" note explaining the
 * behavior.
 *
 * Kept free of Zustand / DOM dependencies so tests can render it with
 * a plain array of fixture entries.
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { AuditEntry } from '@/types/audit';

export interface CostMetricsProps {
  entries: AuditEntry[];
  /** Override "now" for deterministic rendering in tests. */
  now?: Date;
  className?: string;
}

interface DailyTotal {
  date: string; // YYYY-MM-DD (local)
  total: number;
  byProvider: Record<string, number>;
  count: number;
}

interface Extracted {
  cost: number;
  provider: string;
  timestamp: number;
}

const PROVIDER_COLORS: Record<string, string> = {
  anthropic: '#C15F3C', // Claude brand-ish warm tone
  openai: '#1BA37E',
  google: '#4285F4',
  ollama: '#7C7CE0',
  unknown: '#9CA3AF',
};

const PROVIDER_LABELS: Record<string, string> = {
  anthropic: 'Claude',
  openai: 'OpenAI',
  google: 'Gemini',
  ollama: 'Ollama',
  unknown: 'Other',
};

/**
 * Extract cost + provider from an AuditEntry, tolerating old entries
 * that stored the values under `outputs` / `metadata` rather than as
 * top-level fields. Returns null when no cost can be attributed.
 */
function extractCost(entry: AuditEntry): Extracted | null {
  const haystacks: Array<Record<string, unknown>> = [
    entry as unknown as Record<string, unknown>,
    entry.outputs,
    entry.metadata,
  ];
  const costKeys = ['costUsd', 'cost_usd', 'cost'];
  const providerKeys = ['provider', 'providerId'];

  let cost: number | null = null;
  let provider: string | null = null;

  for (const h of haystacks) {
    if (cost === null) {
      for (const k of costKeys) {
        const v = h[k];
        if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
          cost = v;
          break;
        }
      }
    }
    if (provider === null) {
      for (const k of providerKeys) {
        const v = h[k];
        if (typeof v === 'string' && v.trim() !== '') {
          provider = v;
          break;
        }
      }
    }
  }

  // Fallback: infer provider from model name if possible.
  if (provider === null && entry.model) {
    const m = entry.model.toLowerCase();
    if (m.includes('claude')) provider = 'anthropic';
    else if (m.includes('gpt') || m.includes('o1')) provider = 'openai';
    else if (m.includes('gemini')) provider = 'google';
  }

  if (cost === null) return null;
  const t = Date.parse(entry.timestamp);
  if (!Number.isFinite(t)) return null;
  return {
    cost,
    provider: provider ?? 'unknown',
    timestamp: t,
  };
}

function toLocalDateKey(t: number): string {
  const d = new Date(t);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatCost(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '$0.00';
  // Two decimals for everything at/above a cent; 4 decimals for
  // sub-cent to keep tiny numbers visible. Below $0.001 rounds to
  // $0.00 but we still return that to avoid noise.
  if (value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}

/**
 * Build a 30-day series anchored at `now`, one entry per day, filled
 * with zero where no data exists. Earliest day is at index 0. Pure for
 * testability.
 */
export function buildDailySeries(
  entries: AuditEntry[],
  now: Date = new Date()
): DailyTotal[] {
  // Build empty series first.
  const series: DailyTotal[] = [];
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  for (let i = 29; i >= 0; i--) {
    const d = new Date(end);
    d.setDate(d.getDate() - i);
    series.push({
      date: toLocalDateKey(d.getTime()),
      total: 0,
      byProvider: {},
      count: 0,
    });
  }
  const keyIndex = new Map(series.map((s, i) => [s.date, i]));

  // Fold entries in.
  const startOfWindow = new Date(end);
  startOfWindow.setDate(startOfWindow.getDate() - 29);
  startOfWindow.setHours(0, 0, 0, 0);
  const windowStartMs = startOfWindow.getTime();
  const windowEndMs = end.getTime();

  for (const entry of entries) {
    const ex = extractCost(entry);
    if (!ex) continue;
    if (ex.timestamp < windowStartMs || ex.timestamp > windowEndMs) continue;
    const key = toLocalDateKey(ex.timestamp);
    const idx = keyIndex.get(key);
    if (idx === undefined) continue;
    const bucket = series[idx]!;
    bucket.total += ex.cost;
    bucket.byProvider[ex.provider] =
      (bucket.byProvider[ex.provider] ?? 0) + ex.cost;
    bucket.count += 1;
  }

  return series;
}

/**
 * Month-to-date totals: sum across all days in the current calendar
 * month (local time). Also counts call volume. Pure for testability.
 */
export function computeMonthTotals(
  entries: AuditEntry[],
  now: Date = new Date()
): { total: number; count: number; byProvider: Record<string, number> } {
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  let total = 0;
  let count = 0;
  const byProvider: Record<string, number> = {};

  for (const entry of entries) {
    const ex = extractCost(entry);
    if (!ex) continue;
    if (ex.timestamp < monthStart.getTime()) continue;
    if (ex.timestamp > monthEnd.getTime()) continue;
    total += ex.cost;
    count += 1;
    byProvider[ex.provider] = (byProvider[ex.provider] ?? 0) + ex.cost;
  }
  return { total, count, byProvider };
}

export function CostMetrics({ entries, now, className }: CostMetricsProps) {
  const { t } = useTranslation();
  const resolvedNow = now ?? new Date();

  const series = useMemo(
    () => buildDailySeries(entries, resolvedNow),
    // We want the memo key to be stable across re-renders with the
    // same data. If the caller passes a fresh Date() every render we
    // still get a stable result because the day bucket is the same;
    // but for correctness we also include the day string.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entries, toLocalDateKey(resolvedNow.getTime())]
  );

  const month = useMemo(
    () => computeMonthTotals(entries, resolvedNow),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entries, toLocalDateKey(resolvedNow.getTime())]
  );

  const maxTotal = series.reduce((m, d) => Math.max(m, d.total), 0);
  const yMax = maxTotal > 0 ? maxTotal : 0.01; // avoid divide-by-zero
  const chartHeight = 120;
  const chartWidth = 520;
  const barGap = 2;
  const barWidth = (chartWidth - barGap * (series.length - 1)) / series.length;

  const sortedProviderTotals = Object.entries(month.byProvider)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]);

  return (
    <div
      data-testid="cost-metrics"
      className={className}
    >
      <div className="mb-3">
        <div className="text-base font-semibold">Cost &amp; Usage</div>
        <div className="text-xs text-muted-foreground mt-0.5">
          {t('analysis.cost-metrics.description')}
        </div>
      </div>

      <div
        data-testid="cost-metrics-total"
        className="mb-4 text-sm"
      >
        <span className="font-medium">This month: </span>
        <span data-testid="cost-metrics-total-amount" className="font-mono">
          {formatCost(month.total)}
        </span>{' '}
        <span className="text-muted-foreground">
          across {month.count} call{month.count === 1 ? '' : 's'}
        </span>
      </div>

      {/* Last 30 days chart */}
      <div className="mb-4">
        <div className="text-xs text-muted-foreground mb-1">
          Last 30 days
        </div>
        <svg
          data-testid="cost-metrics-chart"
          width="100%"
          viewBox={`0 0 ${chartWidth} ${chartHeight + 18}`}
          role="img"
          aria-label="Cost per day for the last 30 days"
          className="block w-full h-auto"
        >
          {/* Bars */}
          {series.map((day, i) => {
            const x = i * (barWidth + barGap);
            const providerEntries = Object.entries(day.byProvider).sort(
              (a, b) => (PROVIDER_LABELS[a[0]] ?? a[0]).localeCompare(
                PROVIDER_LABELS[b[0]] ?? b[0]
              )
            );
            let yCursor = chartHeight;
            return (
              <g key={day.date}>
                {day.total === 0 ? (
                  // Empty day: faint tick at the baseline so the chart
                  // isn't visually empty.
                  <rect
                    x={x}
                    y={chartHeight - 1}
                    width={Math.max(barWidth, 1)}
                    height={1}
                    fill="currentColor"
                    opacity={0.15}
                  />
                ) : (
                  providerEntries.map(([provider, cost]) => {
                    const h = (cost / yMax) * chartHeight;
                    yCursor -= h;
                    return (
                      <rect
                        key={provider}
                        data-testid={`cost-metrics-bar-${day.date}-${provider}`}
                        x={x}
                        y={yCursor}
                        width={Math.max(barWidth, 1)}
                        height={h}
                        fill={PROVIDER_COLORS[provider] ?? PROVIDER_COLORS['unknown']}
                      >
                        <title>
                          {day.date}: {formatCost(cost)} (
                          {PROVIDER_LABELS[provider] ?? provider})
                        </title>
                      </rect>
                    );
                  })
                )}
              </g>
            );
          })}
          {/* Baseline */}
          <line
            x1={0}
            x2={chartWidth}
            y1={chartHeight}
            y2={chartHeight}
            stroke="currentColor"
            strokeOpacity={0.3}
            strokeWidth={0.5}
          />
          {/* First / last date labels */}
          <text
            x={0}
            y={chartHeight + 14}
            fontSize={9}
            fill="currentColor"
            opacity={0.6}
          >
            {series[0]?.date ?? ''}
          </text>
          <text
            x={chartWidth}
            y={chartHeight + 14}
            fontSize={9}
            fill="currentColor"
            opacity={0.6}
            textAnchor="end"
          >
            {series[series.length - 1]?.date ?? ''}
          </text>
        </svg>
      </div>

      {/* Per-provider breakdown (this month) */}
      <div data-testid="cost-metrics-breakdown">
        <div className="text-xs text-muted-foreground mb-1">
          {t('analysis.cost-metrics.by-provider')}
        </div>
        {sortedProviderTotals.length === 0 ? (
          <div className="text-sm text-muted-foreground py-2">
            {t('analysis.cost-metrics.no-costs')}
          </div>
        ) : (
          <ul className="space-y-1">
            {sortedProviderTotals.map(([provider, cost]) => (
              <li
                key={provider}
                data-testid={`cost-metrics-provider-${provider}`}
                className="flex items-center justify-between gap-3 text-sm py-1"
              >
                <span className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className="inline-block w-3 h-3 rounded-sm"
                    style={{
                      backgroundColor:
                        PROVIDER_COLORS[provider] ?? PROVIDER_COLORS['unknown'],
                    }}
                  />
                  {PROVIDER_LABELS[provider] ?? provider}
                </span>
                <span className="font-mono text-xs">{formatCost(cost)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default CostMetrics;
