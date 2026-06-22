import { describe, it, expect } from 'vitest';
import { resolveEffectiveEgress } from '@/platform/privacy/resolvePersonalEgressDefault';

describe('resolveEffectiveEgress (personal installs)', () => {
  it('blocks cloud generation when no choice has been made', () => {
    const r = resolveEffectiveEgress({ isFirm: false, storedMode: undefined, choiceMade: false });
    expect(r.allowCloudGeneration).toBe(false);
    expect(r.effectiveMode).toBe('local-only');
    expect(r.needsChoice).toBe(true);
  });

  it('honors an explicit cloud (direct) choice once made', () => {
    const r = resolveEffectiveEgress({ isFirm: false, storedMode: 'direct', choiceMade: true });
    expect(r.allowCloudGeneration).toBe(true);
    expect(r.effectiveMode).toBe('direct');
    expect(r.needsChoice).toBe(false);
  });

  it('honors an explicit local-only choice', () => {
    const r = resolveEffectiveEgress({ isFirm: false, storedMode: 'local-only', choiceMade: true });
    expect(r.allowCloudGeneration).toBe(false);
    expect(r.effectiveMode).toBe('local-only');
    expect(r.needsChoice).toBe(false);
  });

  it('firm installs keep their stored mode and never need the personal choice gate', () => {
    const r = resolveEffectiveEgress({ isFirm: true, storedMode: 'assured', choiceMade: false });
    expect(r.allowCloudGeneration).toBe(true);
    expect(r.effectiveMode).toBe('assured');
    expect(r.needsChoice).toBe(false);
  });

  it('firm installs default to direct when no mode is stored', () => {
    const r = resolveEffectiveEgress({ isFirm: true, storedMode: undefined, choiceMade: false });
    expect(r.effectiveMode).toBe('direct');
    expect(r.allowCloudGeneration).toBe(true);
    expect(r.needsChoice).toBe(false);
  });
});
