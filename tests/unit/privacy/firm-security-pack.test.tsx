/**
 * Firm Security Pack tests.
 *
 * Hard rules (task-secpack-brief.md):
 *   1. Renders without crashing.
 *   2. Contains the exact per-mode egress facts (Local-only / Direct / Assured).
 *   3. The strings "guaranteed compliant" and "fully compliant" never appear.
 *   4. No em dash character appears in the rendered document.
 *   5. The assurance section does NOT claim SOC 2 certification.
 *
 * Per-mode egress facts are verified against egress.ts canonical output
 * (not hand-checked strings) so they stay in sync automatically.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FirmSecurityPackContent } from '@/features/privacy/FirmSecurityPack';
import { resolveEgress } from '@/platform/privacy/egress';

// DataMapContent is a large trust document tested elsewhere; mock it so these
// tests focus only on FirmSecurityPack assertions.
vi.mock('@/platform/privacy/ui/DataMapDialog', () => ({
  DataMapContent: () => (
    <div data-testid="data-map-content-mock">data-map-content</div>
  ),
  DataMapDialog: () => null,
  DATA_MAP_ROWS: [],
}));

// ---------------------------------------------------------------------------
// Canonical egress facts we'll assert against — derived from egress.ts, not
// hand-typed, so the test stays in sync with the source of truth.
// ---------------------------------------------------------------------------
const LOCAL_ONLY_NOTE = resolveEgress({
  provider: 'ollama',
  mode: 'local-only',
}).note;
const DIRECT_NOTE = resolveEgress({
  provider: 'anthropic',
  mode: 'direct',
}).note;
const ASSURED_NOTE = resolveEgress({
  provider: 'anthropic',
  mode: 'assured',
  assuredAvailable: true,
}).note;

// Helper: render and return the container text once.
function renderAndGetText(): string {
  const { container } = render(<FirmSecurityPackContent />);
  return container.textContent ?? '';
}

// ---------------------------------------------------------------------------
// 1. Renders without crashing
// ---------------------------------------------------------------------------

describe('FirmSecurityPack — renders without crashing', () => {
  it('renders the content component', () => {
    render(<FirmSecurityPackContent />);
    expect(screen.getByTestId('firm-security-pack-content')).toBeTruthy();
  });

  it('shows the document title', () => {
    render(<FirmSecurityPackContent />);
    const content = screen.getByTestId('firm-security-pack-content');
    expect(content.textContent).toContain('Lantern security overview');
  });

  it('shows the opening disclaimer', () => {
    render(<FirmSecurityPackContent />);
    expect(
      screen.getByTestId('firm-security-pack-content').textContent
    ).toContain('Every claim here matches how the software actually works');
  });
});

// ---------------------------------------------------------------------------
// 2. Per-mode egress facts — asserted against egress.ts canonical output
// ---------------------------------------------------------------------------

describe('FirmSecurityPack — per-mode egress facts', () => {
  it('contains the Local-only egress fact from egress.ts', () => {
    const text = renderAndGetText();
    // The canonical note from resolveEgress for local-only mode must appear.
    expect(text).toContain(LOCAL_ONLY_NOTE);
  });

  it('contains the Direct (BYOK) egress fact from egress.ts', () => {
    const text = renderAndGetText();
    expect(text).toContain(DIRECT_NOTE);
  });

  it('contains the Assured mode egress fact from egress.ts', () => {
    const text = renderAndGetText();
    expect(text).toContain(ASSURED_NOTE);
  });

  it('labels the three modes clearly', () => {
    const text = renderAndGetText();
    expect(text).toContain('Local-only');
    expect(text).toContain('Direct');
    expect(text).toContain('Assured');
  });
});

// ---------------------------------------------------------------------------
// 3. Compliance claim guards — must NEVER appear
// ---------------------------------------------------------------------------

describe('FirmSecurityPack — no false compliance claims', () => {
  it('never contains "guaranteed compliant"', () => {
    const text = renderAndGetText();
    expect(text.toLowerCase()).not.toContain('guaranteed compliant');
  });

  it('never contains "fully compliant"', () => {
    const text = renderAndGetText();
    expect(text.toLowerCase()).not.toContain('fully compliant');
  });
});

// ---------------------------------------------------------------------------
// 4. No em dash
// ---------------------------------------------------------------------------

describe('FirmSecurityPack — no em dash', () => {
  it('contains no em dash character (U+2014)', () => {
    const text = renderAndGetText();
    expect(text).not.toContain('—');
  });

  it('contains no em dash in section headings', () => {
    render(<FirmSecurityPackContent />);
    const headings = screen.getAllByRole('heading');
    for (const h of headings) {
      expect(h.textContent ?? '').not.toContain('—');
    }
  });
});

// ---------------------------------------------------------------------------
// 5. Real assurance status — no false SOC 2 certification claim
// ---------------------------------------------------------------------------

describe('FirmSecurityPack — honest assurance status', () => {
  it('does not claim "SOC 2 certified" without negation — every occurrence', () => {
    const text = renderAndGetText().toLowerCase();
    // Check EVERY occurrence of "soc 2 certified" — not just the first one.
    // Each instance must be preceded by "not" within the 10 chars before it,
    // so a future edit that adds an unqualified "SOC 2 certified" anywhere fails.
    const matches = [...text.matchAll(/soc 2 certified/g)];
    for (const match of matches) {
      const idx = match.index ?? 0;
      const before = text.slice(Math.max(0, idx - 10), idx);
      expect(before).toContain('not');
    }
    // Also assert the SOC 2 section IS present so the test cannot pass by omission.
    expect(text).toContain('soc 2');
  });

  it('does not claim "SOC 2 compliant"', () => {
    const text = renderAndGetText().toLowerCase();
    // Same guard: "soc 2 compliant" must not appear (would imply compliance).
    expect(text).not.toContain('soc 2 compliant');
  });

  it('states that Lantern is not SOC 2 certified', () => {
    const text = renderAndGetText().toLowerCase();
    expect(text).toContain('not soc 2 certified');
  });

  it('mentions DPA availability', () => {
    const text = renderAndGetText().toLowerCase();
    expect(text).toContain('data processing agreement');
  });

  it('states DPA is available on request', () => {
    const text = renderAndGetText().toLowerCase();
    expect(text).toContain('available on request');
  });

  it('discloses that the Assured proxy is not yet generally available', () => {
    // The security pack must NOT represent the Assured zero-retention proxy as
    // a live, independently audited, generally available production service.
    // It must include a plain disclosure to that effect so a GC reviewer is
    // not misled. We assert the key truthful phrases from the DPA Section 6.4
    // status note are present in the rendered output.
    const text = renderAndGetText().toLowerCase();
    // Must say "not yet" in relation to general availability or independent audit.
    expect(text).toContain('not yet');
    // Must mention that the independent audit is not yet complete.
    expect(text).toContain('independent audit');
    // Must indicate the proxy is not yet generally available or not yet a
    // production service.
    expect(text).toMatch(
      /not yet.*generally available|generally available.*not yet|not yet.*production/
    );
  });
});

// ---------------------------------------------------------------------------
// 6. Structural sections present
// ---------------------------------------------------------------------------

describe('FirmSecurityPack — required sections', () => {
  it('has a "What Lantern is" section', () => {
    const text = renderAndGetText();
    expect(text).toContain('What Lantern is');
  });

  it('has a "Where data lives" section', () => {
    const text = renderAndGetText();
    expect(text).toContain('Where data lives');
  });

  it('has a "Firm collaboration security" section', () => {
    const text = renderAndGetText();
    expect(text).toContain('Firm collaboration security');
  });

  it('uses the scoped relay description for firm collaboration', () => {
    const text = renderAndGetText();
    expect(text).toContain('Your client data is encrypted on your device');
    expect(text).toContain('ciphertext and opaque handles');
    expect(text).toContain('never sees client names or documents');
    expect(text).not.toContain('end-to-end encrypted data');
  });

  it('has a "What to ask us" section', () => {
    const text = renderAndGetText();
    expect(text).toContain('What to ask us');
  });

  it('has a "Keys and accounts" section', () => {
    const text = renderAndGetText();
    expect(text).toContain('Keys and accounts');
  });

  it('has the secure client links review section with the honest relay boundary', () => {
    const text = renderAndGetText();
    expect(text).toContain('Intake / secure client links');
    expect(text).toContain('The relay can see');
    expect(text).toContain("It cannot see a client's name");
    expect(text).toContain('Social Security numbers');
    expect(text).toContain('file names or file contents');
    expect(text).toContain('Email fallback is a separate channel');
  });

  it('gives reviewers a checklist before secure links are enabled', () => {
    const text = renderAndGetText();
    expect(text).toContain('Reviewer checklist before enabling Intake');
    expect(text).toContain('no third-party code, analytics, or CDN');
    expect(text).toContain('email fallback is not end-to-end encrypted');
  });
});
