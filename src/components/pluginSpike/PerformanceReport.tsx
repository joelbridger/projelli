// Plugin Spike — Performance histogram for criterion #8.
//
// Renders a simple bar histogram of round-trip durations plus median, p95,
// and max as text. Pure CSS bars (no charting dep) so the spike stays
// dependency-free. Intentionally minimal: this is decision evidence, not a
// production observability surface.
//
// Spec: docs/superpowers/specs/2026-04-28-v2.0-mega-release-design.md §6.3

import { useMemo } from 'react';

import { cn } from '@/lib/utils';

interface PerformanceReportProps {
  /** Round-trip durations in milliseconds. May be empty. */
  durations: number[];
  /** Optional SLO line; default 50ms (criterion #8). */
  thresholdMs?: number;
  /** Number of histogram buckets. Defaults to 10. */
  buckets?: number;
  className?: string;
}

interface PerfStats {
  count: number;
  median: number;
  p95: number;
  max: number;
  min: number;
  mean: number;
}

function computeStats(values: number[]): PerfStats | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const pick = (q: number): number => {
    // Linear interpolation between closest ranks.
    const idx = (sorted.length - 1) * q;
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    if (lo === hi) {
      return sorted[lo] ?? 0;
    }
    const loVal = sorted[lo] ?? 0;
    const hiVal = sorted[hi] ?? 0;
    return loVal + (hiVal - loVal) * (idx - lo);
  };
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  return {
    count: sorted.length,
    median: pick(0.5),
    p95: pick(0.95),
    max: sorted[sorted.length - 1] ?? 0,
    min: sorted[0] ?? 0,
    mean: sum / sorted.length,
  };
}

interface Bucket {
  start: number;
  end: number;
  count: number;
}

function bucketize(values: number[], buckets: number): Bucket[] {
  if (values.length === 0 || buckets < 1) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  // Guard against zero-width range so we still draw something readable.
  const range = max - min || 1;
  const width = range / buckets;
  const out: Bucket[] = Array.from({ length: buckets }, (_, i) => ({
    start: min + i * width,
    end: min + (i + 1) * width,
    count: 0,
  }));
  for (const v of values) {
    let idx = Math.floor((v - min) / width);
    if (idx >= buckets) idx = buckets - 1;
    if (idx < 0) idx = 0;
    const bucket = out[idx];
    if (bucket) bucket.count += 1;
  }
  return out;
}

function fmt(ms: number): string {
  if (ms >= 100) return `${ms.toFixed(0)}ms`;
  if (ms >= 10) return `${ms.toFixed(1)}ms`;
  return `${ms.toFixed(2)}ms`;
}

export function PerformanceReport({
  durations,
  thresholdMs = 50,
  buckets = 10,
  className,
}: PerformanceReportProps) {
  const stats = useMemo(() => computeStats(durations), [durations]);
  const histogram = useMemo(() => bucketize(durations, buckets), [durations, buckets]);
  const maxBucketCount = useMemo(
    () => histogram.reduce((m, b) => Math.max(m, b.count), 0),
    [histogram],
  );

  if (!stats) {
    return (
      <div className={cn('text-sm text-muted-foreground', className)} data-testid="perf-report-empty">
        No timings recorded yet. Run criterion 8 to populate.
      </div>
    );
  }

  const passes = stats.median < thresholdMs;

  return (
    <div className={cn('space-y-3', className)} data-testid="perf-report">
      <div className="grid grid-cols-3 gap-2 text-xs">
        <Stat label="Median" value={fmt(stats.median)} highlight={passes} />
        <Stat label="p95" value={fmt(stats.p95)} />
        <Stat label="Max" value={fmt(stats.max)} />
        <Stat label="Min" value={fmt(stats.min)} />
        <Stat label="Mean" value={fmt(stats.mean)} />
        <Stat label="Count" value={String(stats.count)} />
      </div>
      <div className="flex items-end gap-px h-20 border-b border-l border-border bg-muted/20 px-1 pt-1">
        {histogram.map((b, i) => {
          const height = maxBucketCount === 0 ? 0 : (b.count / maxBucketCount) * 100;
          return (
            <div
              key={i}
              className="flex-1 bg-primary/80 rounded-sm relative group"
              style={{ height: `${height}%`, minHeight: b.count > 0 ? '2px' : '0' }}
              title={`${fmt(b.start)} to ${fmt(b.end)}: ${b.count}`}
            />
          );
        })}
      </div>
      <div className="text-xs text-muted-foreground flex justify-between">
        <span>{fmt(stats.min)}</span>
        <span>
          Threshold: {fmt(thresholdMs)} {' '}
          <span className={passes ? 'text-green-600' : 'text-destructive'}>
            ({passes ? 'pass' : 'fail'})
          </span>
        </span>
        <span>{fmt(stats.max)}</span>
      </div>
    </div>
  );
}

interface StatProps {
  label: string;
  value: string;
  highlight?: boolean;
}

function Stat({ label, value, highlight }: StatProps) {
  return (
    <div className="flex flex-col">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn('font-mono font-medium', highlight && 'text-green-600')}>
        {value}
      </span>
    </div>
  );
}
