/**
 * AIChatViewer — AI cost/usage meter visibility (showAiCostMeters).
 *
 * UX tidy-up (audit Wave B): the per-message cost chip and the
 * "Context: N of 200K" token meter are hidden by default so the AI assistant
 * doesn't read like a developer console (advisors are per-seat priced). The
 * manual Compress action, however, must stay reachable for everyone — hiding
 * the meters must NOT take the Compress button with it.
 *
 * These tests assert the gating at the AIChatViewer render site:
 *   showAiCostMeters = false -> cost chip + context token text hidden,
 *                               Compress still shown.
 *   showAiCostMeters = true  -> cost chip + context token text shown,
 *                               Compress still shown.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

// Stub the three providers so nothing hits the network/keychain on mount and
// the cost-preview metadata lookup is harmless.
vi.mock('@/platform/providers/ClaudeProvider', () => ({
  ClaudeProvider: class {
    setTools() {}
    sendMessage = vi.fn();
    sendMessageStreaming = undefined;
    getMetadata() { return { model: 'stub' }; }
  },
}));
vi.mock('@/platform/providers/OpenAIProvider', () => ({
  OpenAIProvider: class {
    setTools() {}
    sendMessage = vi.fn();
    sendMessageStreaming = undefined;
    getMetadata() { return { model: 'stub' }; }
  },
}));
vi.mock('@/platform/providers/GeminiProvider', () => ({
  GeminiProvider: class {
    setTools() {}
    sendMessage = vi.fn();
    sendMessageStreaming = undefined;
    getMetadata() { return { model: 'stub' }; }
  },
}));

// Keep the confidentiality-choice gate out of the way — not what we're testing.
vi.mock('@/platform/privacy/localOnlyGuard', async (orig) => {
  const real = await orig<typeof import('@/platform/privacy/localOnlyGuard')>();
  return { ...real, assertCloudGenerationAllowed: vi.fn() };
});

import { TooltipProvider } from '@/ui/tooltip';
import { AIChatViewer } from '@/features/ask/AIChatViewer';
import type { AIChatFile } from '@/platform/types/ai';
import { useAIChatStore } from '@/platform/state/aiChatStore';
import { useSettingsStore } from '@/platform/settings/settingsStore';

const apiKeys = [{ provider: 'anthropic', key: 'stub-key', isValid: true }];

// A chat whose history is long enough — relative to the small context limit set
// in beforeEach — to push utilization past the 50% Compress threshold, so the
// Compress button is in play in BOTH the hidden and shown cases.
const longChat: AIChatFile = {
  id: 'cost-meters-test',
  title: 'Cost Meters Test',
  created: new Date().toISOString(),
  updated: new Date().toISOString(),
  provider: 'anthropic',
  model: 'stub',
  messages: [
    // ~60k chars -> ~15k tokens (4 chars/token heuristic), comfortably above
    // 50% of the 10k context limit set below, so the Compress button shows.
    { role: 'user', content: 'x'.repeat(60_000), timestamp: new Date().toISOString() },
  ],
};

function renderViewer() {
  return render(
    <TooltipProvider>
      <AIChatViewer chatData={longChat} apiKeys={apiKeys} />
    </TooltipProvider>,
  );
}

describe('AIChatViewer — cost/usage meter visibility (showAiCostMeters)', () => {
  beforeEach(() => {
    useAIChatStore.setState({ sessions: {}, dailyCosts: {}, askWorkspaceMode: {} });
    useSettingsStore.getState().resetAll();
    // Smallest valid context window (schema min is 10k) so the ~15k-token
    // history is well over 50% utilization and the Compress button renders in
    // both cases.
    useSettingsStore.getState().setSetting('chatContextTokenLimit', 10_000);
  });

  afterEach(() => {
    cleanup();
    useSettingsStore.getState().resetAll();
    useAIChatStore.setState({ sessions: {}, dailyCosts: {}, askWorkspaceMode: {} });
  });

  it('hides the cost chip and context token meter by default, but keeps Compress reachable', () => {
    useSettingsStore.getState().setSetting('showAiCostMeters', false);
    renderViewer();

    // The developer-console meters are gone by default.
    expect(screen.queryByTestId('chat-cost-chip')).not.toBeInTheDocument();
    expect(screen.queryByTestId('context-meter-usage')).not.toBeInTheDocument();
    // ...but the manual Compress action stays available.
    expect(screen.getByTestId('context-meter-compress-btn')).toBeInTheDocument();
  });

  it('shows the cost chip and context token meter when opted in, Compress still reachable', () => {
    useSettingsStore.getState().setSetting('showAiCostMeters', true);
    renderViewer();

    // Opting in restores both meters.
    expect(screen.getByTestId('chat-cost-chip')).toBeInTheDocument();
    expect(screen.getByTestId('context-meter-usage')).toBeInTheDocument();
    // Compress is still there too.
    expect(screen.getByTestId('context-meter-compress-btn')).toBeInTheDocument();
  });
});
