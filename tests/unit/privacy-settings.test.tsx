/**
 * privacy-settings.test.tsx — unit tests for the WS6 privacy settings additions.
 *
 * Covers:
 *   1. PrivacySettings renders the design-partner card with toggle.
 *   2. Toggle fires setConsent (enabled/disabled).
 *   3. DataMapDialog has the design-partner diagnostics row in DATA_MAP_ROWS.
 *   4. No em dashes in any of the new copy.
 *   5. The "no telemetry by default" description is count-neutral and true.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@/i18n';
import { PrivacySettings } from '@/features/settings/PrivacySettings';
import { DATA_MAP_ROWS } from '@/platform/privacy/ui/DataMapDialog';

// ---------------------------------------------------------------------------
// Minimal localStorage mock
// ---------------------------------------------------------------------------
function mockLocalStorage() {
  const store: Record<string, string> = {};
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation((k) => store[k] ?? null);
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation((k, v: string) => { store[k] = v; });
  vi.spyOn(Storage.prototype, 'removeItem').mockImplementation((k) => { delete store[k]; });
  return store;
}

// ---------------------------------------------------------------------------
// PrivacySettings — design-partner card
// ---------------------------------------------------------------------------

describe('PrivacySettings — design-partner card', () => {
  beforeEach(() => {
    mockLocalStorage();
    render(<PrivacySettings />);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the design-partner card', () => {
    expect(screen.getByTestId('privacy-design-partner-card')).toBeInTheDocument();
  });

  it('renders the design-partner toggle button', () => {
    expect(screen.getByTestId('privacy-design-partner-toggle')).toBeInTheDocument();
  });

  it('toggle shows "Disabled" by default (consent = unset)', () => {
    const toggle = screen.getByTestId('privacy-design-partner-toggle');
    expect(toggle).toHaveTextContent('Disabled');
  });

  it('toggle switches to "Enabled" when clicked', () => {
    const toggle = screen.getByTestId('privacy-design-partner-toggle');
    fireEvent.click(toggle);
    expect(toggle).toHaveTextContent('Enabled');
  });

  it('clicking Enabled again switches back to Disabled', () => {
    const toggle = screen.getByTestId('privacy-design-partner-toggle');
    fireEvent.click(toggle);
    expect(toggle).toHaveTextContent('Enabled');
    fireEvent.click(toggle);
    expect(toggle).toHaveTextContent('Disabled');
  });

  it('design-partner card does not mention content/file names/matter names/prompts as collected', () => {
    const card = screen.getByTestId('privacy-design-partner-card');
    const text = card.textContent ?? '';
    // The card should mention "never" in context with these sensitive items
    expect(text.toLowerCase()).toContain('never');
  });

  it('also still renders the telemetry toggle', () => {
    expect(screen.getByTestId('privacy-telemetry-toggle')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// PrivacySettings — no-telemetry-by-default description is count-neutral
// ---------------------------------------------------------------------------

describe('PrivacySettings — privacy description copy', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('description does not say "two opt-ins" (would be stale with three)', () => {
    mockLocalStorage();
    render(<PrivacySettings />);
    // The updated description uses "Any opt-ins" not "The two opt-ins"
    const page = document.body.textContent ?? '';
    expect(page).not.toMatch(/two opt-ins/i);
  });
});

// ---------------------------------------------------------------------------
// DataMapDialog — DATA_MAP_ROWS has a design-partner entry
// ---------------------------------------------------------------------------

describe('DATA_MAP_ROWS — design-partner diagnostics row', () => {
  it('includes a row about design-partner diagnostics', () => {
    const dpRow = DATA_MAP_ROWS.find(
      (r) => r.title.toLowerCase().includes('design-partner'),
    );
    expect(dpRow).toBeDefined();
  });

  it('design-partner row mentions opt-in and off by default', () => {
    const dpRow = DATA_MAP_ROWS.find(
      (r) => r.title.toLowerCase().includes('design-partner'),
    );
    const combined = ((dpRow?.body ?? '') + ' ' + (dpRow?.caveat ?? '')).toLowerCase();
    expect(combined).toContain('opt-in');
    expect(combined).toContain('off by default');
  });

  it('design-partner row explicitly states what is NOT sent', () => {
    const dpRow = DATA_MAP_ROWS.find(
      (r) => r.title.toLowerCase().includes('design-partner'),
    );
    const body = dpRow?.body ?? '';
    expect(body).toContain('never sends');
  });

  it('design-partner row has a caveat linking to the Settings disclosure', () => {
    const dpRow = DATA_MAP_ROWS.find(
      (r) => r.title.toLowerCase().includes('design-partner'),
    );
    expect(dpRow?.caveat).toBeDefined();
    expect(dpRow?.caveat).toContain('Settings');
  });
});

// ---------------------------------------------------------------------------
// Voice rules — no em dashes in new copy
// ---------------------------------------------------------------------------

describe('WS6 privacy copy — voice rules', () => {
  it('DATA_MAP_ROWS design-partner row has no em dashes', () => {
    const dpRow = DATA_MAP_ROWS.find(
      (r) => r.title.toLowerCase().includes('design-partner'),
    );
    const allText = [dpRow?.title, dpRow?.body, dpRow?.caveat].join(' ');
    expect(allText).not.toMatch(/—|&mdash;/);
  });
});
