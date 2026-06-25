/**
 * WS-C — egress indicator + confidentiality mode + data map.
 *
 * The data story is the load-bearing trust feature for the legal ICP, so these
 * tests pin the ACCURACY of what we tell the user:
 *
 *   1. resolveEgress() returns the correct destination/severity/dataLeaves for
 *      every provider × mode combination, including the browser-demo proxy
 *      path (the one path that must warn).
 *   2. EgressIndicator renders the matching label/severity:
 *        - Ollama (or Local-only mode) => "nothing leaves", severity=safe.
 *        - cloud provider, Direct mode  => "Sent to your <Provider> account" + the honest
 *          provider-sees-the-prompt note, severity=direct.
 *   3. Local-only mode disables the cloud new-chat buttons in the model picker.
 *   4. The data map renders the accurate, plain-English claims.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

import {
  resolveEgress,
  isLocalProvider,
  providerDisplayName,
  CONFIDENTIALITY_MODE_SETTING_KEY,
  DEFAULT_CONFIDENTIALITY_MODE,
} from '@/platform/privacy/egress';
import { EgressIndicator } from '@/platform/privacy/ui/EgressIndicator';
import { effectiveChatProvider } from '@/features/ask/chat/providerModelResolution';
import { DataMapDialog } from '@/platform/privacy/ui/DataMapDialog';
import { useSettingsStore } from '@/platform/settings/settingsStore';
import type { ConfidentialityMode } from '@/platform/privacy/egress';

function setMode(mode: ConfidentialityMode) {
  useSettingsStore.getState().setSetting(CONFIDENTIALITY_MODE_SETTING_KEY, mode);
}

beforeEach(() => {
  // Reset settings + BYOK demo flag between tests.
  useSettingsStore.setState({ values: {} });
  try {
    localStorage.removeItem('byokKey');
  } catch {
    /* jsdom always has localStorage; tolerate anyway */
  }
});

// ---------------------------------------------------------------------------
// 1. Pure logic
// ---------------------------------------------------------------------------

describe('resolveEgress (the single source of truth)', () => {
  it('Ollama => nothing leaves the machine', () => {
    const info = resolveEgress({ provider: 'ollama', mode: 'direct' });
    expect(info.destination).toBe('local');
    expect(info.severity).toBe('safe');
    expect(info.dataLeaves).toBe(false);
    expect(info.label).toMatch(/nothing leaves/i);
  });

  it('cloud provider in Direct mode => direct-to-provider, data leaves, honest note', () => {
    for (const provider of ['anthropic', 'openai', 'google'] as const) {
      const info = resolveEgress({ provider, mode: 'direct' });
      expect(info.destination).toBe('provider-direct');
      expect(info.severity).toBe('direct');
      expect(info.dataLeaves).toBe(true);
      // The label names the actual provider the user picked and makes clear it is THEIR account.
      const expectedName = { anthropic: 'Anthropic', openai: 'OpenAI', google: 'Google' }[provider];
      expect(info.label).toContain(expectedName);
      expect(info.label).toMatch(/Sent to your/i);
      // The note is honest that the provider sees the prompt + that Keepance isn't in between.
      expect(info.note).toMatch(/receives the prompt/i);
      expect(info.note).toMatch(/Keepance is not in between/i);
    }
  });

  it('Local-only mode forces local even when the chat stored a cloud provider', () => {
    const info = resolveEgress({ provider: 'anthropic', mode: 'local-only' });
    expect(info.destination).toBe('local');
    expect(info.severity).toBe('safe');
    expect(info.dataLeaves).toBe(false);
  });

  it('browser-demo build with NO personal key => shared-proxy WARNING', () => {
    const info = resolveEgress({ provider: 'anthropic', mode: 'direct', isDemo: true, hasDemoByokKey: false });
    expect(info.destination).toBe('demo-proxy');
    expect(info.severity).toBe('warn');
    expect(info.note).toMatch(/shared Keepance relay/i);
    expect(info.label).toMatch(/do not use with client data/i);
  });

  it('browser-demo build WITH a personal key => direct to provider (no proxy)', () => {
    const info = resolveEgress({ provider: 'anthropic', mode: 'direct', isDemo: true, hasDemoByokKey: true });
    expect(info.destination).toBe('provider-direct');
    expect(info.severity).toBe('direct');
  });

  it('the default mode is Direct (matches shipping behaviour)', () => {
    expect(DEFAULT_CONFIDENTIALITY_MODE).toBe('direct');
  });

  // Embedded Keepance Local AI engine (llama.cpp) — local-model initiative.
  it('Keepance Local AI => nothing leaves the machine, named correctly', () => {
    const info = resolveEgress({ provider: 'keepance-local', mode: 'direct' });
    expect(info.destination).toBe('local');
    expect(info.severity).toBe('safe');
    expect(info.dataLeaves).toBe(false);
    expect(info.provider).toBe('keepance-local');
    // The honest note names the actual local engine, not Ollama.
    expect(info.note).toMatch(/Keepance Local AI/);
    expect(info.note).not.toMatch(/Ollama/);
  });

  it('Ollama local note still names Ollama (no regression)', () => {
    const info = resolveEgress({ provider: 'ollama', mode: 'direct' });
    expect(info.note).toMatch(/\(Ollama\)/);
  });

  it('both local providers are recognised as local; cloud is not', () => {
    expect(isLocalProvider('keepance-local')).toBe(true);
    expect(isLocalProvider('ollama')).toBe(true);
    expect(isLocalProvider('anthropic')).toBe(false);
    expect(providerDisplayName('keepance-local')).toBe('Keepance Local AI');
  });
});

// ---------------------------------------------------------------------------
// 2. The indicator UI reflects the resolved destination
// ---------------------------------------------------------------------------

describe('EgressIndicator', () => {
  it('shows "nothing leaves" (safe) for an Ollama chat', () => {
    setMode('direct');
    render(<EgressIndicator provider="ollama" />);
    const el = screen.getByTestId('egress-indicator');
    expect(el.getAttribute('data-destination')).toBe('local');
    expect(el.getAttribute('data-severity')).toBe('safe');
    expect(el.getAttribute('data-data-leaves')).toBe('false');
    expect(screen.getByTestId('egress-indicator-label').textContent).toMatch(/nothing leaves/i);
  });

  it('names the embedded Keepance Local AI engine in the note (not Ollama)', () => {
    // Regression: the local note used a static i18n string that hard-coded
    // "(Ollama)"; for a keepance-local chat it must name the actual engine.
    setMode('direct');
    render(<EgressIndicator provider="keepance-local" />);
    const el = screen.getByTestId('egress-indicator');
    expect(el.getAttribute('data-destination')).toBe('local');
    expect(el.getAttribute('data-data-leaves')).toBe('false');
    const note = screen.getByTestId('egress-indicator-note').textContent || '';
    expect(note).toMatch(/Keepance Local AI/);
    expect(note).not.toMatch(/Ollama/);
  });

  it('BLOCKER regression: an unset-provider chat with the local model ready shows data-destination=local (never "data leaves")', () => {
    // The exact bad state Codex flagged: a chat with no saved provider while the
    // embedded model is ready. effectiveChatProvider must resolve it to
    // 'keepance-local' (not the old 'anthropic' fallback), so the badge the user
    // sees says nothing leaves — matching the on-device send.
    setMode('direct');
    const provider = effectiveChatProvider(undefined, /* local */ 'ready');
    render(<EgressIndicator provider={provider} />);
    const el = screen.getByTestId('egress-indicator');
    expect(el.getAttribute('data-destination')).toBe('local');
    expect(el.getAttribute('data-data-leaves')).toBe('false');
  });

  it('BLOCKER 2 regression: while the local-model probe is pending the badge shows "Checking" and never "data leaves"', () => {
    // The initial-load race: an unset-provider chat before the status probe
    // resolves. effectiveChatProvider returns null, and the badge must render a
    // neutral "checking" state (data-data-leaves=false) instead of guessing a
    // cloud destination — even though the confidentiality mode is Direct.
    setMode('direct');
    const provider = effectiveChatProvider(undefined, /* local */ 'unknown');
    expect(provider).toBeNull();
    render(<EgressIndicator provider={provider} />);
    const el = screen.getByTestId('egress-indicator');
    expect(el.getAttribute('data-destination')).toBe('pending');
    expect(el.getAttribute('data-data-leaves')).toBe('false');
    expect(screen.getByTestId('egress-indicator-label').textContent).toMatch(/Checking local AI/i);
  });

  it('shows "Sent to your Anthropic account" with the provider-sees-prompt note in Direct mode', () => {
    setMode('direct');
    render(<EgressIndicator provider="anthropic" />);
    const el = screen.getByTestId('egress-indicator');
    expect(el.getAttribute('data-destination')).toBe('provider-direct');
    expect(el.getAttribute('data-severity')).toBe('direct');
    expect(el.getAttribute('data-data-leaves')).toBe('true');
    expect(screen.getByTestId('egress-indicator-label').textContent).toMatch(/Sent to your Anthropic account/i);
    expect(screen.getByTestId('egress-indicator-note').textContent).toMatch(/receives the prompt/i);
  });

  it('names OpenAI / Google correctly for those providers', () => {
    setMode('direct');
    const { rerender } = render(<EgressIndicator provider="openai" />);
    expect(screen.getByTestId('egress-indicator-label').textContent).toMatch(/Sent to your OpenAI account/i);
    rerender(<EgressIndicator provider="google" />);
    expect(screen.getByTestId('egress-indicator-label').textContent).toMatch(/Sent to your Google account/i);
  });

  it('reflects Local-only mode: a cloud-provider chat shows nothing-leaves', () => {
    setMode('local-only');
    render(<EgressIndicator provider="anthropic" />);
    const el = screen.getByTestId('egress-indicator');
    expect(el.getAttribute('data-destination')).toBe('local');
    expect(el.getAttribute('data-severity')).toBe('safe');
    expect(screen.getByTestId('egress-indicator-label').textContent).toMatch(/nothing leaves/i);
  });

  it('compact variant carries the same destination/severity data attributes', () => {
    setMode('direct');
    render(<EgressIndicator provider="anthropic" variant="compact" />);
    const el = screen.getByTestId('egress-indicator-compact');
    expect(el.getAttribute('data-destination')).toBe('provider-direct');
    expect(el.getAttribute('data-severity')).toBe('direct');
    expect(el.textContent).toMatch(/Sent to your Anthropic account/i);
  });

  it('honors an explicit mode prop over the stored setting', () => {
    setMode('direct');
    render(<EgressIndicator provider="anthropic" mode="local-only" />);
    expect(screen.getByTestId('egress-indicator').getAttribute('data-destination')).toBe('local');
  });
});

// ---------------------------------------------------------------------------
// 3. The data map content is accurate
// ---------------------------------------------------------------------------

describe('DataMapDialog', () => {
  it('renders the accurate, plain-English claims', () => {
    render(<DataMapDialog open onOpenChange={() => {}} />);
    expect(screen.getByTestId('data-map-dialog')).toBeTruthy();

    // Files stay local.
    expect(screen.getByText(/stay on your machine/i)).toBeTruthy();
    expect(screen.getByText(/no Keepance cloud holding copies/i)).toBeTruthy();

    // Keys in the OS keychain.
    expect(screen.getByText(/operating system keychain/i)).toBeTruthy();

    // Cloud prompt goes direct to the provider, with the honest asterisk.
    expect(screen.getByText(/directly from your machine to that provider/i)).toBeTruthy();
    expect(screen.getByText(/honest asterisk/i)).toBeTruthy();
    expect(screen.getByText(/used to train their models is governed by your account settings/i)).toBeTruthy();

    // Local-only path for nothing-leaves.
    expect(screen.getByText(/use a local model/i)).toBeTruthy();
    expect(screen.getByText(/nothing is sent over the network at all/i)).toBeTruthy();

    // Email encrypted locally.
    expect(screen.getByText(/encrypted on your machine/i)).toBeTruthy();

    // Keepance servers: honest about the license check plus opt-in analytics + bug reports.
    expect(screen.getByText(/only automatic contact with Keepance.s servers is a periodic license check/i)).toBeTruthy();
    expect(screen.getByText(/Neither analytics nor bug reports are on by default/i)).toBeTruthy();

    // Firm Assured-mode relay path is disclosed honestly.
    expect(screen.getByText(/For firm Assured mode/i)).toBeTruthy();

    // Desktop build (not demo): the affirmation shows, and the demo-relay caveat does not.
    expect(screen.getByText(/using the Keepance desktop app/i)).toBeTruthy();
    expect(screen.queryByText(/never be used with confidential or client/i)).toBeNull();

    // Printable region + print control exist.
    expect(document.getElementById('keepance-data-map-printable')).toBeTruthy();
    expect(screen.getByTestId('data-map-print')).toBeTruthy();
  });
});
