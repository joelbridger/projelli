import { describe, it, expect } from 'vitest';
// @ts-expect-error — plain .mjs pure-logic module, no d.ts
import { evaluateHandleFacts } from '../../../scripts/ui-system/lib/handle-eval.mjs';

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

  it('passes a wrapper ONLY via an explicit ALLOWED_WRAPPERS entry with a live target', () => {
    const allowed = { x: { target: 'button' } };
    const facts = { ...base, selfControl: false, targetExists: true, targetVisible: true, targetEnabled: true };
    expect(evaluateHandleFacts(facts, 'control', allowed).ok).toBe(true);
  });

  it('FAILS an allowed wrapper when its inner target is disabled', () => {
    const allowed = { x: { target: 'button' } };
    const facts = { ...base, selfControl: false, targetExists: true, targetVisible: true, targetEnabled: false };
    expect(evaluateHandleFacts(facts, 'control', allowed).ok).toBe(false);
  });

  it('FAILS an allowed wrapper when its target selector matches nothing', () => {
    const allowed = { x: { target: 'button' } };
    const facts = { ...base, selfControl: false, targetExists: false };
    expect(evaluateHandleFacts(facts, 'control', allowed).ok).toBe(false);
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
