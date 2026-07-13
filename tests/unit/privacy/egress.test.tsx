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

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { BRAND } from '@/config/brand';
import { LOCAL_AI_NAME } from '@/config/brandText';

import {
  resolveEgress,
  isLocalProvider,
  providerDisplayName,
  NO_AI_PROVIDER,
  CONFIDENTIALITY_MODE_SETTING_KEY,
  DEFAULT_CONFIDENTIALITY_MODE,
} from '@/platform/privacy/egress';
import { EgressIndicator } from '@/platform/privacy/ui/EgressIndicator';
import { effectiveChatProvider } from '@/features/ask/chat/providerModelResolution';
import { DataMapDialog } from '@/platform/privacy/ui/DataMapDialog';
import { useSettingsStore } from '@/platform/settings/settingsStore';
import type { ConfidentialityMode } from '@/platform/privacy/egress';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

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
    expect(info.label).toMatch(/on your machine/i);
    expect(info.note).toMatch(/no AI prompt or file is sent to a cloud AI/i);
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
      // The note is honest that the provider sees the prompt + that the app isn't in between.
      expect(info.note).toMatch(/receives the prompt/i);
      expect(info.note).toContain(`${BRAND.name} is not in between`);
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
    expect(info.note).toContain(`shared ${BRAND.name} relay`);
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

  // Embedded branded Local AI engine (llama.cpp) — local-model initiative.
  it('branded Local AI => nothing leaves the machine, named correctly', () => {
    const info = resolveEgress({ provider: 'lantern-local', mode: 'direct' });
    expect(info.destination).toBe('local');
    expect(info.severity).toBe('safe');
    expect(info.dataLeaves).toBe(false);
    expect(info.provider).toBe('lantern-local');
    // The honest note names the actual local engine, not Ollama.
    expect(info.note).toContain(LOCAL_AI_NAME);
    expect(info.note).not.toMatch(/Ollama/);
  });

  it('Ollama-backed local note never surfaces "Ollama" in the always-visible trust badge', () => {
    const info = resolveEgress({ provider: 'ollama', mode: 'direct' });
    // The trust badge is always on screen for a non-technical advisor: it must
    // read as a private on-device model, never name the developer tool "Ollama"
    // (UX-05 — that jargon belongs only in the advanced bring-your-own-runtime panel).
    expect(info.note).not.toMatch(/Ollama/);
    expect(info.note).toMatch(/private model on your own computer/i);
    // The internal provider id is unchanged — only the rendered copy adapts.
    expect(info.provider).toBe('ollama');
  });

  it('both local providers are recognised as local; cloud is not', () => {
    expect(isLocalProvider('lantern-local')).toBe(true);
    expect(isLocalProvider('ollama')).toBe(true);
    expect(isLocalProvider('anthropic')).toBe(false);
    expect(providerDisplayName('lantern-local')).toBe(LOCAL_AI_NAME);
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
    expect(screen.getByTestId('egress-indicator-label').textContent).toMatch(/on your machine/i);
  });

  it('names the embedded branded Local AI engine in the note (not Ollama)', () => {
    // Regression: the local note used a static i18n string that hard-coded
    // "(Ollama)"; for a lantern-local chat it must name the actual engine.
    setMode('direct');
    render(<EgressIndicator provider="lantern-local" />);
    const el = screen.getByTestId('egress-indicator');
    expect(el.getAttribute('data-destination')).toBe('local');
    expect(el.getAttribute('data-data-leaves')).toBe('false');
    const note = screen.getByTestId('egress-indicator-note').textContent || '';
    expect(note).toContain(LOCAL_AI_NAME);
    expect(note).not.toMatch(/Ollama/);
  });

  it('shows a neutral "No AI connected" badge (no guessed provider) when nothing is configured', () => {
    // UX-01: the always-visible trust badge must be honest — when there is no
    // configured provider it says "No AI connected", never a guessed provider.
    setMode('direct');
    render(<EgressIndicator provider={NO_AI_PROVIDER} />);
    const el = screen.getByTestId('egress-indicator');
    expect(el.getAttribute('data-destination')).toBe('none');
    expect(el.getAttribute('data-data-leaves')).toBe('false');
    expect(el.getAttribute('role')).toBe('status');
    expect(screen.getByTestId('egress-indicator-label').textContent).toMatch(/no ai connected/i);
  });

  it('BLOCKER regression: an unset-provider chat with the local model ready shows data-destination=local (never "data leaves")', () => {
    // The exact bad state Codex flagged: a chat with no saved provider while the
    // embedded model is ready. effectiveChatProvider must resolve it to
    // 'lantern-local' (not the old 'anthropic' fallback), so the badge the user
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
    // Pending copy is NEUTRAL (no "nothing leaves" claim) — Search can be clicked
    // while pending, so the badge must not promise locality before it's resolved.
    expect(screen.getByTestId('egress-indicator-label').textContent).toMatch(/Checking AI destination/i);
    expect(screen.getByTestId('egress-indicator-note').textContent).not.toMatch(/nothing leaves/i);
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
    expect(screen.getByTestId('egress-indicator-label').textContent).toMatch(/on your machine/i);
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

  it('lets the status pill open AI options when clicked', () => {
    setMode('direct');
    const onClick = vi.fn();
    render(<EgressIndicator provider="anthropic" variant="status" onClick={onClick} />);

    const el = screen.getByTestId('egress-indicator');
    expect(el.textContent).toMatch(/Using cloud AI/i);
    fireEvent.click(el);

    expect(onClick).toHaveBeenCalledOnce();
  });

  it('the clickable status pill is a real button with an AI-options aria-label (keyboard reachable)', () => {
    setMode('direct');
    render(<EgressIndicator provider="anthropic" variant="status" onClick={() => {}} />);
    const el = screen.getByTestId('egress-indicator');
    expect(el.tagName).toBe('BUTTON');
    expect(el.getAttribute('aria-label')).toMatch(/open AI options/i);
  });

  it('local-pending renders "Local AI setting up", never "Using local AI" (item 3)', () => {
    setMode('local-only');
    render(<EgressIndicator provider="local-pending" variant="status" />);
    const el = screen.getByTestId('egress-indicator');
    expect(el.getAttribute('data-destination')).toBe('local-pending');
    expect(el.getAttribute('data-data-leaves')).toBe('false');
    expect(el.textContent).toMatch(/setting up/i);
    expect(el.textContent).not.toMatch(/Using local AI/i);
  });

  it('assured mode + a live managed route renders the assured-proxy destination (item 2)', () => {
    setMode('assured');
    render(<EgressIndicator provider="openai" mode="assured" assuredAvailable variant="full" />);
    const el = screen.getByTestId('egress-indicator');
    expect(el.getAttribute('data-destination')).toBe('assured-proxy');
    expect(el.getAttribute('data-severity')).toBe('assured');
  });

  it('assured mode with NO managed route falls back to the honest BYOK-direct story', () => {
    setMode('assured');
    render(<EgressIndicator provider="openai" mode="assured" assuredAvailable={false} variant="full" />);
    expect(screen.getByTestId('egress-indicator').getAttribute('data-destination')).toBe('provider-direct');
  });

  it('a testId override gives the composer indicator DISTINCT handles (item 4)', () => {
    setMode('direct');
    render(
      <EgressIndicator provider="anthropic" variant="full" testId="egress-indicator-composer" />,
    );
    expect(screen.getByTestId('egress-indicator-composer')).toBeTruthy();
    expect(screen.getByTestId('egress-indicator-composer-label')).toBeTruthy();
    // The default top-bar handle must NOT be emitted by the overridden instance.
    expect(screen.queryByTestId('egress-indicator')).toBeNull();
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
    expect(screen.getByText(new RegExp(`no ${escapeRegExp(BRAND.name)} cloud holding copies`, 'i'))).toBeTruthy();

    // Keys in the OS keychain.
    expect(screen.getByText(/operating system keychain/i)).toBeTruthy();

    // Cloud prompt goes direct to the provider, with the honest asterisk.
    expect(screen.getByText(/directly from your machine to that provider/i)).toBeTruthy();
    expect(screen.getByText(/honest asterisk/i)).toBeTruthy();
    expect(screen.getByText(/used to train their models is governed by your account settings/i)).toBeTruthy();

    // Local-only path: local AI is used and outside connectors pause.
    expect(screen.getByText(/use a local model/i)).toBeTruthy();
    expect(
      screen.getByText(
        /outside connectors such as Wealthbox and email pause so nothing leaves this computer/i,
      ),
    ).toBeTruthy();

    // Email encrypted locally.
    expect(screen.getByText(/encrypted on your machine/i)).toBeTruthy();

    // App servers: honest about the license check plus opt-in analytics + bug reports.
    expect(screen.getByText(new RegExp(`only automatic contact with ${escapeRegExp(BRAND.possessive)} servers is a periodic license check`, 'i'))).toBeTruthy();
    expect(screen.getByText(/Neither analytics nor bug reports are on by default/i)).toBeTruthy();

    // Firm Assured-mode relay path is disclosed honestly.
    expect(screen.getByText(/For firm Assured mode/i)).toBeTruthy();

    // Desktop build (not demo): the affirmation shows, and the demo-relay caveat does not.
    expect(screen.getByText(new RegExp(`using the ${escapeRegExp(BRAND.name)} desktop app`, 'i'))).toBeTruthy();
    expect(screen.queryByText(/never be used with confidential or client/i)).toBeNull();

    // Printable region + print control exist.
    expect(document.getElementById('lantern-data-map-printable')).toBeTruthy();
    expect(screen.getByTestId('data-map-print')).toBeTruthy();
  });
});
