// Plugin Spike — automated end-to-end coverage for all 8 spike criteria.
//
// Drives `buildScenarios({ makeBridge })` against the paired-bridge mock
// factory in `tests/helpers/spikeMockFactory.ts`. Each criterion is a
// separate `it()` so failures localize cleanly. Pass-signals match the
// criteria table in the plan exactly; see
// docs/superpowers/plans/2026-05-03-stream-c2-plugin-spike.md.
//
// Stability: this file is designed to run 5x consecutively without flakes.
// To verify locally:
//
//     for i in 1 2 3 4 5; do
//       npx vitest run tests/integration/pluginSpike/all-criteria.test.ts \
//         || { echo "run $i failed"; exit 1; };
//     done
//
// Criterion-1 caveat: in jsdom, `document` and `window` are defined, so the
// mock plugin fixture lies and reports `'undefined'` for both — exercising
// the scenario's pass-path. The real isolation guarantee can only be
// verified by running the harness in a real browser / Tauri webview; the
// memo writeup notes this.
//
// Criterion-8 perf threshold defaults to 50ms median round-trip and can be
// raised via `SPIKE_PERF_THRESHOLD_MS` for slow CI hardware. Actual median,
// p95, and max are logged regardless of pass/fail so the memo can quote
// real numbers.
//
// Spec: docs/superpowers/specs/2026-04-28-v2.0-mega-release-design.md §6.3
// Plan: docs/superpowers/plans/2026-05-03-stream-c2-plugin-spike.md

import { describe, expect, it } from 'vitest';

import { buildScenarios } from '@/modules/pluginSpike/scenarios';

import { makePairedBridgeFactory } from '../../helpers/spikeMockFactory';

const PERF_THRESHOLD_MS = Number(process.env.SPIKE_PERF_THRESHOLD_MS ?? 50);

describe('plugin spike — all 8 criteria (automated)', () => {
  it('criterion 1: worker isolation — document/window report as undefined', async () => {
    // jsdom caveat acknowledged in file header. Real-Worker isolation is a
    // manual smoke test; the memo's per-criterion table flags this as
    // "automated pass + manual verification pending" until the harness
    // runs in a real browser.
    const map = buildScenarios({ makeBridge: makePairedBridgeFactory() });
    const outcome = await map[1]!();
    expect(outcome.status).toBe('pass');
    expect(outcome.details).toContain('document/window are undefined');
  }, 1000);

  it('criterion 2: round-trip command returns expected payload', async () => {
    const map = buildScenarios({ makeBridge: makePairedBridgeFactory() });
    const outcome = await map[2]!();
    expect(outcome.status).toBe('pass');
    expect(outcome.details).toContain('round-trip');
  }, 1000);

  it('criterion 3: filesystem access denied with structured error', async () => {
    const map = buildScenarios({ makeBridge: makePairedBridgeFactory() });
    const outcome = await map[3]!();
    expect(outcome.status).toBe('pass');
    expect(outcome.details).toContain('permission-denied');
  }, 1000);

  it('criterion 4: panel-render produces a sidebarSpec of expected shape', async () => {
    const map = buildScenarios({ makeBridge: makePairedBridgeFactory() });
    const outcome = await map[4]!();
    expect(outcome.status).toBe('pass');
    expect(outcome.sidebarSpec).toBeDefined();
    expect(outcome.sidebarSpec?.id).toBe('spike-panel');
    expect(outcome.sidebarSpec?.title).toBe('Spike Panel');
    expect(outcome.sidebarSpec?.html).toContain('hello from the plugin sandbox');
  }, 1000);

  it('criterion 5: hot-load + reload + unload cycle completes cleanly', async () => {
    const map = buildScenarios({ makeBridge: makePairedBridgeFactory() });
    const outcome = await map[5]!();
    expect(outcome.status).toBe('pass');
    expect(outcome.details).toContain('load + reload + unload');
  }, 2000);

  it('criterion 6: permitted plugin succeeds, denied plugin fails', async () => {
    const map = buildScenarios({ makeBridge: makePairedBridgeFactory() });
    const outcome = await map[6]!();
    expect(outcome.status).toBe('pass');
    expect(outcome.details).toContain('permission-denied');
  }, 1500);

  it('criterion 7: plugin throws do not crash main thread; heartbeat continues', async () => {
    // Handler holds the heartbeat for ~1s; budget 5s total to avoid flaky
    // failures under contention.
    const map = buildScenarios({ makeBridge: makePairedBridgeFactory() });
    const outcome = await map[7]!();
    expect(outcome.status).toBe('pass');
    expect(outcome.metrics?.heartbeatTicks).toBeGreaterThanOrEqual(5);
  }, 5000);

  it('criterion 8: 100 round-trips, median < threshold', async () => {
    const map = buildScenarios({ makeBridge: makePairedBridgeFactory() });
    const outcome = await map[8]!();

    expect(outcome.status).toBe('pass');
    // 100 runs minus 5 warmup discards = 95 measured timings.
    expect(outcome.timings).toBeDefined();
    expect(outcome.timings).toHaveLength(95);
    expect(outcome.metrics?.count).toBe(95);

    const median = outcome.metrics?.medianMs ?? Number.NaN;
    const p95 = outcome.metrics?.p95Ms ?? Number.NaN;
    const max = outcome.metrics?.maxMs ?? Number.NaN;

    // Always log — the memo quotes these numbers.
    // eslint-disable-next-line no-console
    console.log(
      `[criterion-8] median=${median.toFixed(3)}ms p95=${p95.toFixed(3)}ms max=${max.toFixed(3)}ms ` +
        `threshold=${String(PERF_THRESHOLD_MS)}ms n=95`,
    );

    expect(median).toBeGreaterThanOrEqual(0);
    expect(median).toBeLessThan(PERF_THRESHOLD_MS);
  }, 10000);
});
