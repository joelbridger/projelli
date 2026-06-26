/**
 * B-PRIV-1 regression — the inline Search/Ask egress banner must NEVER go stale
 * when the confidentiality mode is switched mid-session.
 *
 * The reported bug (Windows-bench, 2026-06-26): start a search in "On this
 * computer only" (local-only) mode — the banner correctly reads "On your
 * machine. Nothing leaves … No prompt or file is sent over the network." Switch
 * to Cloud (direct) mode in Settings, then run another query in the SAME search
 * session: the inline banner KEPT saying "nothing leaves / local" even though
 * the query now goes to the cloud provider. For a product whose flagship is an
 * always-honest egress indicator, a banner literally saying "No prompt or file
 * is sent over the network" while it IS sent to OpenAI is a correctness defect.
 *
 * Root cause: useAsk resolved `activeProvider` once on mount (empty effect deps),
 * so a mid-session confidentiality-mode flip never re-resolved the provider the
 * banner names. resolveEgress treats any local provider as "nothing leaves", so
 * the stale `keepance-local` value kept the banner green long after the send had
 * become a cloud send.
 *
 * Fix: the banner recomputes from the CURRENT confidentiality mode / effective
 * provider whenever the mode changes (and after each send). This test drives the
 * REAL EgressIndicator + the REAL egress logic + the REAL (reactive) settings
 * store, flips the mode, and asserts the banner follows.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { Ask } from '@/features/ask/Ask';
import { useSettingsStore } from '@/platform/settings/settingsStore';
import { CONFIDENTIALITY_MODE_SETTING_KEY } from '@/platform/privacy/egress';
import type { ConfidentialityMode } from '@/platform/privacy/egress';

function setMode(mode: ConfidentialityMode) {
  act(() => {
    useSettingsStore.getState().setSetting(CONFIDENTIALITY_MODE_SETTING_KEY, mode);
  });
}

// ---- standard Ask store mocks (mirrors reimagined-ask.test.tsx) -------------
vi.mock('@/platform/matter/matterStore', () => ({
  useActiveMatter: () => null,
  SAMPLE_MATTER_ID: 'matter_sample_garcia_v_meridian',
}));
vi.mock('@/platform/fs/workspaceStore', () => ({
  useWorkspaceStore: (selector: (s: { rootPath: string | null }) => unknown) =>
    selector({ rootPath: null }),
}));
vi.mock('@/platform/matter/samples/sampleMatterDemo', () => ({
  getDemoAnswerForWorkspace: () => null,
  getDemoQuestions: () => [
    'A', 'B', 'C', 'D',
  ] as [string, string, string, string],
  DEMO_QUESTIONS: ['A', 'B', 'C', 'D'],
}));
vi.mock('@/platform/profile/professionStore', () => ({
  useProfessionStore: (selector: (s: { profession: string }) => unknown) =>
    selector({ profession: 'advisor' }),
  getProfession: () => 'advisor',
}));
vi.mock('@/platform/rag/matterResolver', () => ({
  matterLabel: (m: unknown) => String(m),
}));
vi.mock('@/platform/rag/MemoryService', () => ({
  MemoryService: { retrieve: vi.fn().mockResolvedValue([]) },
  isMemoryEnabled: () => false,
}));
vi.mock('@/platform/rag/workspaceCommand', () => ({
  DEFAULT_WORKSPACE_TOP_K: 5,
  buildWorkspaceContextBlock: () => '',
}));
vi.mock('@/platform/state/aiChatStore', () => {
  const mockSessions: Record<string, unknown> = {};
  const state = {
    initSession: vi.fn(),
    setSessionWorkspaceRoot: vi.fn(),
    addMessage: vi.fn(),
    updateLastMessage: vi.fn(),
    sessions: mockSessions,
  };
  const hook = (selector: (s: unknown) => unknown) => selector(state);
  hook.getState = () => state;
  return { useAIChatStore: hook };
});

// The pre-send badge resolution is exercised in its own unit test
// (local-only-egress-guard.test.ts). Here we only need it to name the engine the
// CURRENT confidentiality mode would use, so we can assert the banner reacts to a
// mid-session mode flip. It reads the REAL (reactive) settings store at call time
// so it can never disagree with the mode the banner is showing.
vi.mock('@/features/ask/askHelpers', async (orig) => {
  const actual = await orig<typeof import('@/features/ask/askHelpers')>();
  const settings = await import('@/platform/settings/settingsStore');
  const egress = await import('@/platform/privacy/egress');
  return {
    ...actual,
    resolveActiveAskProviderId: vi.fn(async () => {
      const mode = settings.useSettingsStore
        .getState()
        .getSetting(egress.CONFIDENTIALITY_MODE_SETTING_KEY);
      return mode === 'local-only' ? 'keepance-local' : 'openai';
    }),
  };
});

describe('B-PRIV-1: Search egress banner follows the confidentiality mode mid-session', () => {
  beforeEach(() => {
    useSettingsStore.setState({ values: {} });
    try {
      localStorage.clear();
    } catch {
      /* jsdom always has localStorage */
    }
  });

  it('flips from "nothing leaves" (local-only) to a cloud destination when the mode switches', async () => {
    setMode('local-only');
    render(<Ask />);

    // Starts honest: local-only => nothing leaves the machine.
    await waitFor(() => {
      expect(screen.getByTestId('egress-indicator').getAttribute('data-destination')).toBe('local');
    });
    const localEl = screen.getByTestId('egress-indicator');
    expect(localEl.getAttribute('data-data-leaves')).toBe('false');
    expect(screen.getByTestId('egress-indicator-note').textContent).toMatch(
      /no prompt or file is sent over the network/i,
    );

    // User switches to Cloud (direct) mode in Settings — same search session.
    setMode('direct');

    // The banner MUST recompute: it can never keep claiming "nothing leaves"
    // while the next query goes to the cloud provider.
    await waitFor(() => {
      expect(screen.getByTestId('egress-indicator').getAttribute('data-destination')).toBe(
        'provider-direct',
      );
    });
    const cloudEl = screen.getByTestId('egress-indicator');
    expect(cloudEl.getAttribute('data-data-leaves')).toBe('true');
    const cloudNote = screen.getByTestId('egress-indicator-note').textContent ?? '';
    expect(cloudNote).not.toMatch(/no prompt or file is sent over the network/i);
    expect(cloudNote).toMatch(/receives the prompt/i);
  });

  it('flips back to "nothing leaves" when the user returns to local-only mode', async () => {
    setMode('direct');
    render(<Ask />);

    await waitFor(() => {
      expect(screen.getByTestId('egress-indicator').getAttribute('data-destination')).toBe(
        'provider-direct',
      );
    });

    setMode('local-only');

    await waitFor(() => {
      expect(screen.getByTestId('egress-indicator').getAttribute('data-destination')).toBe('local');
    });
    expect(screen.getByTestId('egress-indicator').getAttribute('data-data-leaves')).toBe('false');
  });
});
