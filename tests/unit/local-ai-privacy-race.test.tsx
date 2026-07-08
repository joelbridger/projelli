/**
 * Privacy initial-load race (Codex BLOCKER 2) — the egress badge + send button
 * must not assume "cloud" while the embedded local-model status probe is still
 * resolving.
 *
 * For a chat with NO saved provider, on a machine where the embedded model IS
 * ready, there is a brief window after mount before the async Tauri status probe
 * resolves. The old code returned 'anthropic' in that window, so the badge
 * claimed "data leaves" and a send could route to the cloud. These tests pin the
 * (F1 fix round 1, item 4: this asserts the chat COMPOSER's action-time egress
 * indicator, whose handle is now `egress-indicator-chat` — distinct from the
 * always-visible top-bar pill's `egress-indicator`.)
 *
 * fix end-to-end through AIChatViewer:
 *   - status UNKNOWN (probe pending) -> badge shows a neutral "Checking local AI"
 *     (data-data-leaves=false) and the send button is DISABLED;
 *   - status READY -> badge says on-device (local) and send is enabled;
 *   - status ABSENT -> only THEN do we fall back to the cloud default.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import type { LocalLlmStatusSnapshot } from '@/platform/hooks/useLocalLlmModelStatus';

// Controllable local-model status — each test sets the snapshot it wants the
// chat to see, so we can drive the exact unknown/ready/absent states.
const localStatus = vi.hoisted(() => ({
  current: null as LocalLlmStatusSnapshot | null,
}));

vi.mock('@/platform/hooks/useLocalLlmModelStatus', () => ({
  useLocalLlmModelStatus: () => localStatus.current,
}));

// Avoid the cost-chip's async fetch in this render-only test.
vi.mock('@/features/ask/ChatCostChip', () => ({ ChatCostChip: () => null }));

import { AIChatViewer } from '@/features/ask/AIChatViewer';
import type { AIChatFile } from '@/platform/types/ai';
import { useAIChatStore } from '@/platform/state/aiChatStore';
import { useSettingsStore } from '@/platform/settings/settingsStore';
import { CONFIDENTIALITY_MODE_SETTING_KEY } from '@/platform/privacy/egress';

function makeSnap(overrides: Partial<LocalLlmStatusSnapshot>): LocalLlmStatusSnapshot {
  return {
    state: 'idle',
    bytesDone: 0,
    bytesTotal: null,
    message: null,
    stalled: false,
    probed: true,
    start: vi.fn(),
    retry: vi.fn(),
    ...overrides,
  };
}

// A chat with NO saved provider — the only state where the local-model probe
// decides the destination (a saved provider always wins, never unknown).
function unsetChat(): AIChatFile {
  return {
    id: 'privacy-race-test',
    title: 'Unset Chat',
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
    messages: [],
    // provider intentionally omitted (undefined)
    model: '',
  };
}

function resetStores() {
  useAIChatStore.setState({ sessions: {}, dailyCosts: {}, askWorkspaceMode: {} });
  useSettingsStore.setState({ values: {} });
}

beforeEach(resetStores);
afterEach(resetStores);

describe('Privacy initial-load race: local-model status UNKNOWN (probe pending)', () => {
  it('shows a neutral "Checking AI destination" badge and DISABLES send', () => {
    // The race window: not ready AND the probe has not resolved -> unknown.
    localStatus.current = makeSnap({ state: 'idle', probed: false });
    render(<AIChatViewer chatData={unsetChat()} apiKeys={[]} />);

    const badge = screen.getByTestId('egress-indicator-chat');
    expect(badge.getAttribute('data-destination')).toBe('pending');
    expect(badge.getAttribute('data-data-leaves')).toBe('false');
    expect(screen.getByTestId('egress-indicator-chat-label').textContent).toMatch(/Checking AI destination/i);

    // Even with text typed, send stays disabled until the status resolves —
    // there is no honest destination to send to yet.
    act(() => fireEvent.change(screen.getByTestId('chat-input'), { target: { value: 'hello' } }));
    expect((screen.getByTestId('chat-send-button') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('Privacy initial-load race: local-model READY', () => {
  it('resolves an unset chat to the on-device model — badge local, send enabled', () => {
    localStatus.current = makeSnap({ state: 'ready', probed: true });
    render(<AIChatViewer chatData={unsetChat()} apiKeys={[]} />);

    const badge = screen.getByTestId('egress-indicator-chat');
    expect(badge.getAttribute('data-destination')).toBe('local');
    expect(badge.getAttribute('data-data-leaves')).toBe('false');

    act(() => fireEvent.change(screen.getByTestId('chat-input'), { target: { value: 'hello' } }));
    expect((screen.getByTestId('chat-send-button') as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('Privacy initial-load race: local-model ABSENT (probe resolved)', () => {
  it('shows "No AI connected" (NOT a fabricated cloud provider) when local is absent AND no key is set', () => {
    // NEW-003 regression guard: previously the badge claimed "Sent to your
    // Anthropic account / data leaves" with zero keys configured, contradicting
    // the model picker's "No AI provider configured". With no key and no local
    // model the honest destination is 'none' — nothing leaves, send disabled.
    useSettingsStore.getState().setSetting(CONFIDENTIALITY_MODE_SETTING_KEY, 'direct');
    localStatus.current = makeSnap({ state: 'absent', probed: true });
    render(<AIChatViewer chatData={unsetChat()} apiKeys={[]} />);

    const badge = screen.getByTestId('egress-indicator-chat');
    expect(badge.getAttribute('data-destination')).toBe('none');
    expect(badge.getAttribute('data-data-leaves')).toBe('false');

    act(() => fireEvent.change(screen.getByTestId('chat-input'), { target: { value: 'hello' } }));
    expect((screen.getByTestId('chat-send-button') as HTMLButtonElement).disabled).toBe(true);
  });

  it('falls back to the cloud provider the user actually has a VALID key for once local is absent', () => {
    // Direct mode + a real key => the honest "data leaves" cloud destination.
    useSettingsStore.getState().setSetting(CONFIDENTIALITY_MODE_SETTING_KEY, 'direct');
    localStatus.current = makeSnap({ state: 'absent', probed: true });
    render(
      <AIChatViewer
        chatData={unsetChat()}
        apiKeys={[{ provider: 'anthropic', key: 'sk-ant-test', isValid: true }]}
      />,
    );

    const badge = screen.getByTestId('egress-indicator-chat');
    expect(badge.getAttribute('data-destination')).toBe('provider-direct');
    expect(badge.getAttribute('data-data-leaves')).toBe('true');
  });
});
