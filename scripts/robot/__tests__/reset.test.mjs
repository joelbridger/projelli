import { describe, it, expect } from 'vitest';
import { RESIDUE_KEYS } from '../verbs/reset.mjs';

describe('RESIDUE_KEYS', () => {
  it('includes every known residue store that skewed past runs', () => {
    for (const k of ['keepance:client-maps','ai-chat-storage','keepance:matter-ui-snapshots','keepance:client-map-templates','workspace_versions']) {
      expect(RESIDUE_KEYS.exact).toContain(k);
    }
    expect(RESIDUE_KEYS.prefixes.some((re) => re.test('workspace_tabs_abc'))).toBe(true);
    expect(RESIDUE_KEYS.prefixes.some((re) => re.test('workspace_expanded_xyz'))).toBe(true);
  });
  it('never strips legit config keys', () => {
    for (const keep of ['apiKey_openai','keepance:matters','keepance:settings','keepance_profession']) {
      expect(RESIDUE_KEYS.exact).not.toContain(keep);
    }
  });
});
