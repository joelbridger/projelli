/**
 * P4 (trust review) — the three onboarding "trust pill" claims are checkable,
 * and a compliance-minded reader will scrutinize them. Each must be honestly
 * scoped:
 *   - The servers pill must be scoped to documents/prompts, not "no data at
 *     all": firm/Assured sync stores server-side matter records
 *     (`client_name`) and encrypted CRDT blobs for shared notes/co-edited
 *     docs (see FirmApiClient.pushUpdate / createMatterRequest). Content is
 *     unreadable, but metadata does exist server-side, so an unqualified
 *     "stores none of your data" overclaims for firm users (caught in Codex
 *     self-review of this same fix).
 *   - "Fully encrypted (AES-256)" implied every workspace is encrypted by
 *     default; the vault is opt-in (see VaultControlCard / vaultStore), so the
 *     pill must say so.
 *   - SOC 2 certification belongs to the cloud AI provider, never to
 *     Advisor Prep Hero itself, and only applies when cloud AI is used at all
 *     (Local AI has no third-party provider in the picture).
 */
import { describe, it, expect } from 'vitest';
import { ONB_COPY } from '@/features/onboarding/v2/copy';

describe('ONB_COPY.intro.pills — honest trust pills (P4)', () => {
  const pills = ONB_COPY.intro.pills.join(' | ').toLowerCase();

  it('never attributes SOC 2 certification to Advisor Prep Hero itself', () => {
    expect(pills).not.toMatch(/advisor prep hero.{0,20}soc 2 certified/);
  });

  it('scopes the SOC 2 claim to cloud AI providers, not the app', () => {
    const soc2Pill = ONB_COPY.intro.pills.find((p) => /soc 2/i.test(p));
    expect(soc2Pill).toBeDefined();
    expect((soc2Pill ?? '').toLowerCase()).toContain('provider');
  });

  it('does not claim the workspace is fully encrypted by default (vault is opt-in)', () => {
    // "Fully encrypted (AES-256)" with no qualifier would overclaim: the vault
    // that provides AES-256 file encryption is an opt-in feature the user must
    // turn on (vaultStore.enableVault), not the default state of a workspace.
    expect(pills).not.toMatch(/^fully encrypted|(?<!optional )fully encrypted \(aes-256\)/);
    const encryptionPill = ONB_COPY.intro.pills.find((p) => /aes-256/i.test(p));
    expect(encryptionPill).toBeDefined();
    expect((encryptionPill ?? '').toLowerCase()).toMatch(/optional|can|available/);
  });

  it('scopes the servers claim to documents/prompts, not "no data at all" (firm sync stores metadata)', () => {
    const storagePill = ONB_COPY.intro.pills.find((p) => /our servers/i.test(p));
    expect(storagePill).toBeDefined();
    const lower = (storagePill ?? '').toLowerCase();
    expect(lower).toContain('server');
    // Must NOT be the old unqualified "stores none of your data" — firm/Assured
    // sync stores server-side matter metadata (client_name) and encrypted blobs.
    expect(lower).not.toMatch(/stores none of your data/);
    expect(lower).toMatch(/document|prompt/);
  });
});
