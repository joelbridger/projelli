import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const intakePack = readFileSync(
  resolve(process.cwd(), 'docs/trust/it-pack/INTAKE-IT-PACK.md'),
  'utf8'
).toLowerCase();

describe('Lantern Intake IT Gatekeeper Pack claims discipline', () => {
  it('does not use forbidden security overclaims', () => {
    expect(intakePack).not.toContain('military-grade');
    expect(intakePack).not.toContain('unhackable');
  });

  it('only uses zero-knowledge and SOC 2 certified as explicit negations', () => {
    for (const match of intakePack.matchAll(/zero[- ]knowledge/g)) {
      const before = intakePack.slice(
        Math.max(0, (match.index ?? 0) - 48),
        match.index
      );
      expect(before).toMatch(/not|does not|never/);
    }

    for (const match of intakePack.matchAll(/soc 2 certified/g)) {
      const before = intakePack.slice(
        Math.max(0, (match.index ?? 0) - 24),
        match.index
      );
      expect(before).toMatch(/not|never/);
    }

    expect(intakePack).toContain('lantern is not soc 2 certified');
  });

  it('keeps email fallback explicitly outside the encrypted-link channel', () => {
    expect(intakePack).toContain('separate fallback channel');
    expect(intakePack).toContain(
      'must not describe email fallback as end-to-end encrypted'
    );
  });

  it('states that the firm remains the regulated entity', () => {
    expect(intakePack).toContain('the firm remains the regulated entity');
  });
});
