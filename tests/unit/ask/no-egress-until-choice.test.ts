/**
 * Task 1.3 — Block cloud generation until an explicit confidentiality choice.
 *
 * A personal install (no active firm seat) must NEVER reach a cloud AI provider
 * for generation until the user has made an explicit, informed confidentiality
 * choice. The gate lives at the send paths: `assertCloudGenerationAllowed` in
 * localOnlyGuard.ts, called from useChatSending and buildProviderAsync.
 *
 * Tested via the pure gate function (`assertCloudGenerationAllowed`), so the
 * test does not require rendering React components or mounting hooks — the same
 * approach used by the existing local-only-egress-guard tests.
 *
 * Assertions:
 *   1. Personal install, choiceMade=false → throws ConfidentialityChoiceRequiredError
 *      (the same kind of guard error as LocalOnlyEgressError — surfaces as an
 *      inline assistant message through the existing catch blocks).
 *   2. Personal install, choiceMade=false, storedMode='local-only' → still throws
 *      (the stored mode is not a choice; only the explicit marker counts).
 *   3. Personal install, choiceMade=true, storedMode='direct' → does NOT throw
 *      (cloud generation is permitted once the user has chosen).
 *   4. Firm install (activated seat), choiceMade=false → does NOT throw
 *      (firm installs bypass the personal gate entirely).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

/* ------------------------------------------------------------------ */
/* Shared mutable state (hoisted above vi.mock factories)              */
/* ------------------------------------------------------------------ */
const h = vi.hoisted(() => ({
  mode: 'direct' as string,
  choiceMade: false,
  firmActivated: false,
}));

/* ------------------------------------------------------------------ */
/* Mocks                                                               */
/* ------------------------------------------------------------------ */

vi.mock('@/platform/hooks/useConfidentialityMode', () => ({
  getConfidentialityMode: () => h.mode,
}));

vi.mock('@/platform/settings/settingsStore', () => ({
  useSettingsStore: {
    getState: () => ({
      getSetting: (key: string) => {
        if (key === 'confidentialityChoiceMade') return h.choiceMade;
        if (key === 'confidentialityMode') return h.mode;
        return undefined;
      },
    }),
  },
}));

vi.mock('@/platform/firm/firmStore', () => ({
  useFirmStore: {
    getState: () => ({
      session: h.firmActivated ? { activated: true } : null,
    }),
  },
}));

/* ------------------------------------------------------------------ */
/* Import under test (AFTER mocks are registered)                     */
/* ------------------------------------------------------------------ */

import {
  assertCloudGenerationAllowed,
  ConfidentialityChoiceRequiredError,
} from '@/platform/privacy/localOnlyGuard';

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */

describe('assertCloudGenerationAllowed — personal install, no choice made', () => {
  beforeEach(() => {
    h.mode = 'direct';
    h.choiceMade = false;
    h.firmActivated = false;
  });

  it('throws ConfidentialityChoiceRequiredError when choiceMade is false', () => {
    expect(() => assertCloudGenerationAllowed()).toThrow(ConfidentialityChoiceRequiredError);
  });

  it('throws even when storedMode is "local-only" (stored mode is not a choice)', () => {
    h.mode = 'local-only';
    h.choiceMade = false;
    expect(() => assertCloudGenerationAllowed()).toThrow(ConfidentialityChoiceRequiredError);
  });

  it('error message mentions the privacy/confidentiality setting so the user knows where to go', () => {
    expect(() => assertCloudGenerationAllowed()).toThrow(/Settings.*Privacy|Privacy.*Settings|privacy center/i);
  });
});

describe('assertCloudGenerationAllowed — personal install, choice made', () => {
  beforeEach(() => {
    h.mode = 'direct';
    h.choiceMade = true;
    h.firmActivated = false;
  });

  it('does NOT throw when the user has made an explicit choice (direct mode)', () => {
    h.mode = 'direct';
    expect(() => assertCloudGenerationAllowed()).not.toThrow();
  });

  it('does NOT throw when the user chose local-only (no cloud anyway — localOnlyGuard handles that)', () => {
    h.mode = 'local-only';
    expect(() => assertCloudGenerationAllowed()).not.toThrow();
  });
});

describe('assertCloudGenerationAllowed — firm install', () => {
  beforeEach(() => {
    h.mode = 'direct';
    h.choiceMade = false;
    h.firmActivated = true;
  });

  it('does NOT throw for a firm install, even when choiceMade is false', () => {
    expect(() => assertCloudGenerationAllowed()).not.toThrow();
  });

  it('firm install with assured mode and no choice still does NOT throw', () => {
    h.mode = 'assured';
    h.choiceMade = false;
    expect(() => assertCloudGenerationAllowed()).not.toThrow();
  });
});
