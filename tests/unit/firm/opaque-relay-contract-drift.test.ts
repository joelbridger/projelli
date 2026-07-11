import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('opaque firm relay contract', () => {
  it('keeps the authoritative contract free of legacy plaintext routing', () => {
    const contract = readFileSync('src/platform/firm/contract.ts', 'utf8');

    expect(contract).toContain('V2 firm relay: opaque routing only');
    expect(contract).not.toMatch(/\b(?:client_name|matter_id|doc_id)\b/);
    expect(contract).not.toContain('/matter/:id');
    expect(contract).not.toContain('/org/matters');
  });
});
