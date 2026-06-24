// scripts/robot/__tests__/proof.test.mjs
import { describe, it, expect } from 'vitest';
import { runVerb } from '../proof.mjs';

describe('runVerb', () => {
  it('wraps a success into ok:true with data and a duration', async () => {
    const p = await runVerb('demo', async () => ({ value: 42 }));
    expect(p.verb).toBe('demo');
    expect(p.ok).toBe(true);
    expect(p.data).toEqual({ value: 42 });
    expect(p.error).toBe(null);
    expect(typeof p.durationMs).toBe('number');
  });
  it('marks ok:false and captures the message when the verb throws', async () => {
    const p = await runVerb('boom', async () => { throw new Error('nope'); });
    expect(p.ok).toBe(false);
    expect(p.error).toContain('nope');
  });
  it('honors an explicit ok:false in the returned data', async () => {
    const p = await runVerb('soft', async () => ({ ok: false, leak: 3 }));
    expect(p.ok).toBe(false);
    expect(p.data.leak).toBe(3);
  });
});
