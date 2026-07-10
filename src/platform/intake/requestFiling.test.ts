import { describe, expect, it } from 'vitest';
import { intakeOnboardingFolder, intakeRequestFolder } from './intakeFiling';
import { assertRequestSlug, createOpaqueItemHandle, createRequestSlug } from './requestIdentity';

describe('request filing identity', () => {
  it('keeps onboarding exactly where it has always been and separates standing folders', () => {
    expect(intakeOnboardingFolder('/workspace/Sarah')).toBe('/workspace/Sarah/Requests/onboarding');
    expect(intakeRequestFolder('/workspace/Sarah', 'tax-return-a1')).toBe('/workspace/Sarah/Requests/tax-return-a1');
    expect(intakeRequestFolder('/workspace/Sarah', 'bank-statements-b2')).toBe('/workspace/Sarah/Requests/bank-statements-b2');
  });

  it('uses safe generated names and rejects traversal', () => {
    expect(createRequestSlug('Tax Return')).toMatch(/^tax-return-[a-f0-9]{16}$/u);
    expect(() => assertRequestSlug('../escape')).toThrow();
    expect(() => intakeRequestFolder('/workspace/Sarah', 'bad/name')).toThrow();
  });

  it('creates opaque item handles with no semantic content', () => {
    const first = createOpaqueItemHandle();
    const second = createOpaqueItemHandle();
    expect(first).not.toBe(second);
    expect(first).toMatch(/^ri_[a-f0-9]{36}$/u);
    expect(first).not.toContain('income');
    expect(first).not.toContain('tax-return');
  });
});
