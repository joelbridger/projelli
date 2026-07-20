/**
 * WHOLE-DATE **OFFSET** clock, installed by `scripts/sweep-test-clock-bombs.mjs`.
 *
 * TWO instrument defects are guarded here, and I hit the second one myself:
 *
 * 1. TORN CLOCK (the previous lane's disclosed mistake). Patching only
 *    `Date.now()` and leaving `new Date()` at real time manufactured three
 *    false date bombs. So this replaces the WHOLE `Date` binding and proves it.
 *
 * 2. FROZEN CLOCK (MY mistake — see the result file). My first version returned
 *    a CONSTANT instant. Time then never elapses, so any test that measures a
 *    DURATION between two clock reads ("wait 5 ms, now the 1 ms cache TTL has
 *    expired") fails for a reason that has nothing to do with the calendar.
 *    That manufactured false bombs of a different shape. The clock here is an
 *    OFFSET: `shifted = real + (TARGET - realAtInstall)`. It reads as the target
 *    instant AND still ticks at real speed.
 *
 * Positive controls below THROW on either defect.
 */

const RAW = process.env.CLOCK_PROBE_AT;
if (!RAW) {
  throw new Error('[clock-probe] CLOCK_PROBE_AT is not set — refusing to run a probe with no clock.');
}
const TARGET = Date.parse(RAW);
if (!Number.isFinite(TARGET)) {
  throw new Error(`[clock-probe] CLOCK_PROBE_AT is not a parseable instant: ${RAW}`);
}

const RealDate = globalThis.Date;
const OFFSET = TARGET - RealDate.now();

class ProbeDate extends RealDate {
  constructor(...args: unknown[]) {
    if (args.length === 0) {
      super(RealDate.now() + OFFSET);
      return;
    }
    // @ts-expect-error - forwarding the real constructor's overloads verbatim
    super(...args);
  }

  static now(): number {
    return RealDate.now() + OFFSET;
  }
}

globalThis.Date = ProbeDate as unknown as DateConstructor;

// ── POSITIVE CONTROLS — every one THROWS if the instrument is defective ──────
const TOLERANCE_MS = 5_000;

// (a) the shift took at all
const nowValue = Date.now();
if (Math.abs(nowValue - TARGET) > TOLERANCE_MS) {
  throw new Error(`[clock-probe] FAILED: Date.now() is ${new RealDate(nowValue).toISOString()}, expected ~${RAW}`);
}

// (b) the constructor half took too — this is the TORN-CLOCK control
const ctorValue = new Date().getTime();
if (Math.abs(ctorValue - TARGET) > TOLERANCE_MS) {
  throw new Error(
    `[clock-probe] FAILED (TORN CLOCK): new Date() is ${new RealDate(ctorValue).toISOString()}, ` +
      `expected ~${RAW}. Date.now() shifted but the constructor did not.`
  );
}

// (c) TIME STILL ELAPSES — this is the FROZEN-CLOCK control. A busy-wait on the
//     REAL clock must be visible on the shifted one, through BOTH halves.
{
  const realStart = RealDate.now();
  const shiftedStartNow = Date.now();
  const shiftedStartCtor = new Date().getTime();
  while (RealDate.now() - realStart < 3) {
    /* busy-wait ~3 real ms; setTimeout is not available synchronously here */
  }
  const realElapsed = RealDate.now() - realStart;
  const nowElapsed = Date.now() - shiftedStartNow;
  const ctorElapsed = new Date().getTime() - shiftedStartCtor;
  if (nowElapsed < realElapsed - 1 || ctorElapsed < realElapsed - 1) {
    throw new Error(
      `[clock-probe] FAILED (FROZEN CLOCK): ${realElapsed}ms of real time elapsed but the shifted clock ` +
        `advanced ${nowElapsed}ms via Date.now() and ${ctorElapsed}ms via new Date(). A frozen clock reds ` +
        `every duration-measuring test and those failures are the instrument, not a date bomb.`
    );
  }
}

// (d) the real parser and the arg-taking constructor are untouched
const parsed = Date.parse('2020-01-02T03:04:05.000Z');
if (parsed !== 1577934245000) {
  throw new Error(`[clock-probe] FAILED: Date.parse was corrupted (got ${parsed})`);
}
const withArgs = new Date('2020-01-02T03:04:05.000Z').toISOString();
if (withArgs !== '2020-01-02T03:04:05.000Z') {
  throw new Error(`[clock-probe] FAILED: new Date(arg) was corrupted (got ${withArgs})`);
}

// Written straight to fd 2 — vitest intercepts `console.log` and hides it for
// PASSING files, which would leave the green half of a two-direction flip with
// no printed proof that the clock actually moved.
// eslint-disable-next-line @typescript-eslint/no-var-requires
require('node:fs').writeSync(
  2,
  `[clock-probe] WHOLE Date OFFSET by ${OFFSET}ms: Date.now()=${new RealDate(Date.now()).toISOString()} ` +
    `new Date()=${new Date().toISOString()} (ticking)\n`
);
