import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BRAND } from '@/config/brand';

const intakePack = readFileSync(
  resolve(process.cwd(), 'docs/trust/it-pack/INTAKE-IT-PACK.md'),
  'utf8'
).toLowerCase();

describe('Advisor Prep Hero Intake IT Gatekeeper Pack claims discipline', () => {
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

    expect(intakePack).toContain(
      `${BRAND.name.toLowerCase()} is not soc 2 certified`
    );
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

  it('describes the automatic expiry deletion sweep accurately, without promising instant deletion', () => {
    // Fold note (2026-07): the sweep is real (confirmed against
    // backend/src/server.ts's startIntakeRetentionSweep - boot + daily,
    // deletes intakes past expires_at), so this guard now checks the doc
    // claims it correctly - present, but bounded by the sweep's own
    // up-to-24-hour cadence - rather than checking for its absence.
    expect(intakePack).toContain(
      "the relay deletes ciphertext when the advisor's app acknowledges a durable local save"
    );
    expect(intakePack).toContain('daily retention sweep');
    expect(intakePack).not.toMatch(
      /deletes? .*ciphertext .*(instantly|immediately) .*(at|on) expiry/
    );
    expect(intakePack).toContain(
      "up to a 24-hour window between a link's expiry and its ciphertext actually being deleted"
    );
  });

  it('describes the new-device indicator accurately, including its known first-submission limitation', () => {
    // Fold note (2026-07): the session-marker mechanism is wired end-to-end
    // (confirmed against IntakeSyncClient.ts's isKnownSession check), so
    // this guard now checks the doc names the one real known gap - a
    // false-positive on the client's own first submission - rather than
    // hedging that the whole mechanism isn't wired yet.
    expect(intakePack).not.toMatch(
      /every submission from (a )?(previously unseen |new )?session has a new-device indicator/
    );
    expect(intakePack).toContain('the advisor sees each submission with its provenance');
    expect(intakePack).toContain('new-device indicator');
    expect(intakePack).toContain(
      "a known limitation currently causes the client's own first-ever submission on a link to sometimes flag as a new device"
    );
  });
});
