import { describe, it, expect } from 'vitest';
// @ts-expect-error — plain .mjs pure-logic module, no d.ts
import { evaluateHandleFacts } from '../../../scripts/ui-system/lib/handle-eval.mjs';
// @ts-expect-error — plain .mjs pure-logic module, no d.ts
import { evaluateScrollabilityFacts } from '../../../scripts/ui-system/lib/scroll-eval.mjs';

const base = { id: 'x', count: 1, visible: true, pointerNone: false, selfControl: true, selfInput: false, disabled: false };

describe('handle integrity: real-control attachment (round-2 P0)', () => {
  it('passes when the handle IS the control', () => {
    expect(evaluateHandleFacts({ ...base }, 'control').ok).toBe(true);
  });

  it('FAILS when the handle is on a wrapper that only CONTAINS a control', () => {
    const r = evaluateHandleFacts({ ...base, selfControl: false }, 'control');
    expect(r.ok).toBe(false);
    expect(r.issues.join(' ')).toMatch(/wrapper/i);
  });

  it('passes a wrapper ONLY via an explicit ALLOWED_WRAPPERS entry with a live, real target', () => {
    const allowed = { x: { target: 'button', clickPoint: 'center' } };
    const facts = { ...base, selfControl: false, targetExists: true, targetVisible: true, targetEnabled: true, targetControl: true };
    expect(evaluateHandleFacts(facts, 'control', allowed).ok).toBe(true);
  });

  it('FAILS an allowed wrapper when its inner target is disabled', () => {
    const allowed = { x: { target: 'button', clickPoint: 'center' } };
    const facts = { ...base, selfControl: false, targetExists: true, targetVisible: true, targetEnabled: false, targetControl: true };
    expect(evaluateHandleFacts(facts, 'control', allowed).ok).toBe(false);
  });

  it('FAILS an allowed wrapper when its target selector matches nothing', () => {
    const allowed = { x: { target: 'button', clickPoint: 'center' } };
    const facts = { ...base, selfControl: false, targetExists: false };
    expect(evaluateHandleFacts(facts, 'control', allowed).ok).toBe(false);
  });

  // Round-3 MEDIUM: a whitelisted wrapper whose target is a visible NON-control
  // (a plain div) must NOT pass.
  it('FAILS an allowed wrapper whose target is not a real control', () => {
    const allowed = { x: { target: 'div.card', clickPoint: 'center' } };
    const facts = { ...base, selfControl: false, targetExists: true, targetVisible: true, targetEnabled: true, targetControl: false };
    expect(evaluateHandleFacts(facts, 'control', allowed).ok).toBe(false);
  });

  // Round-3 MEDIUM: an entry must store BOTH a target selector and a click point.
  it('FAILS an allowed-wrapper entry that is missing a target selector', () => {
    const allowed = { x: { clickPoint: 'center' } };
    const facts = { ...base, selfControl: false, targetExists: true, targetVisible: true, targetEnabled: true, targetControl: true };
    expect(evaluateHandleFacts(facts, 'control', allowed).ok).toBe(false);
  });
  it('FAILS an allowed-wrapper entry that is missing a click point', () => {
    const allowed = { x: { target: 'button' } };
    const facts = { ...base, selfControl: false, targetExists: true, targetVisible: true, targetEnabled: true, targetControl: true };
    expect(evaluateHandleFacts(facts, 'control', allowed).ok).toBe(false);
  });

  // Round-4: clickPoint must be exactly 'center' or {x,y} finite numbers — a
  // truthy junk value must NOT satisfy the requirement.
  it('accepts only clickPoint "center" or {x,y} finite numbers; rejects junk', () => {
    const facts = { ...base, selfControl: false, targetExists: true, targetVisible: true, targetEnabled: true, targetControl: true };
    const ok = (cp: unknown) => evaluateHandleFacts(facts, 'control', { x: { target: 'button', clickPoint: cp } }).ok;
    // valid
    expect(ok('center')).toBe(true);
    expect(ok({ x: 10, y: 20 })).toBe(true);
    expect(ok({ x: 0, y: 0 })).toBe(true);
    // invalid
    expect(ok(true)).toBe(false);
    expect(ok(1)).toBe(false);
    expect(ok('centre')).toBe(false);
    expect(ok({})).toBe(false);
    expect(ok({ x: 1 })).toBe(false);
    expect(ok({ x: 'a', y: 2 })).toBe(false);
    expect(ok({ x: NaN, y: 2 })).toBe(false);
    expect(ok({ x: Infinity, y: 2 })).toBe(false);
    expect(ok(null)).toBe(false);
  });
});

// Round-3 HIGH: disabled INPUTs must fail exactly like disabled controls —
// both the self path and the allowed-wrapper path.
describe('handle integrity: disabled inputs (round-3 HIGH)', () => {
  it('FAILS a disabled real input (self path)', () => {
    const facts = { ...base, selfControl: false, selfInput: true, disabled: true };
    expect(evaluateHandleFacts(facts, 'input').ok).toBe(false);
  });
  it('FAILS a disabled allowed-wrapper input target', () => {
    const allowed = { x: { target: 'input', clickPoint: 'center' } };
    const facts = { ...base, selfInput: false, targetExists: true, targetVisible: true, targetEnabled: false, targetInput: true };
    expect(evaluateHandleFacts(facts, 'input', allowed).ok).toBe(false);
  });
});

describe('handle integrity: uniqueness / visibility / enabled', () => {
  it('FAILS on a duplicate handle', () => {
    expect(evaluateHandleFacts({ ...base, count: 2 }, 'control').ok).toBe(false);
  });
  it('FAILS when not visible', () => {
    expect(evaluateHandleFacts({ ...base, visible: false }, 'control').ok).toBe(false);
  });
  it('FAILS when pointer-events:none', () => {
    expect(evaluateHandleFacts({ ...base, pointerNone: true }, 'control').ok).toBe(false);
  });
  it('FAILS a disabled control', () => {
    expect(evaluateHandleFacts({ ...base, disabled: true }, 'control').ok).toBe(false);
  });
  it('not present when count is 0', () => {
    const r = evaluateHandleFacts({ ...base, count: 0 }, 'control');
    expect(r.ok).toBe(false);
    expect(r.issues.join(' ')).toMatch(/not present/i);
  });
});

describe('handle integrity: input + region kinds', () => {
  it('input passes when the handle IS an input', () => {
    expect(evaluateHandleFacts({ ...base, selfControl: false, selfInput: true }, 'input').ok).toBe(true);
  });
  it('input FAILS when the handle is not an input', () => {
    expect(evaluateHandleFacts({ ...base, selfControl: false, selfInput: false }, 'input').ok).toBe(false);
  });
  it('region only needs to be visible (no control requirement)', () => {
    expect(evaluateHandleFacts({ ...base, selfControl: false }, 'region').ok).toBe(true);
  });
});

describe('scrollability guard decision', () => {
  it('passes when tall content has a scroll container that reaches bottom', () => {
    const result = evaluateScrollabilityFacts({
      rootPresent: true,
      contentPresent: true,
      contentTallerThanViewport: true,
      rootOverflowed: true,
      scrollContainerCount: 1,
      bestCanScroll: true,
      reachedBottom: true,
    });
    expect(result.ok).toBe(true);
  });

  it('fails when tall content has no scrollable region', () => {
    const result = evaluateScrollabilityFacts({
      rootPresent: true,
      contentPresent: true,
      contentTallerThanViewport: true,
      rootOverflowed: true,
      scrollContainerCount: 0,
      bestCanScroll: false,
      reachedBottom: false,
    });
    expect(result.ok).toBe(false);
    expect(result.issues.join(' ')).toMatch(/no scroll container/i);
  });

  it('does not require a scrollbar when content is not taller than the viewport', () => {
    const result = evaluateScrollabilityFacts({
      rootPresent: true,
      contentPresent: true,
      contentTallerThanViewport: false,
      rootOverflowed: false,
      scrollContainerCount: 0,
      bestCanScroll: false,
      reachedBottom: false,
    });
    expect(result.ok).toBe(true);
  });
});
