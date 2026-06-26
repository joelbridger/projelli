/**
 * Q15 — Run-on-all-3-providers button (RTL).
 *
 * Verifies:
 *   - Button is gated by Pro tier
 *   - Button fires a parallel call per configured provider
 *   - ComparisonView renders with one column per provider
 *   - "Keep this one" promotes the chosen output via the onKeep callback
 *   - A failing provider shows as an error column without blocking the others
 *   - Total cost is the sum across all non-failed providers
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RunOnAllButton } from '@/features/ask/chat/RunOnAllButton';
import type { Provider, ProviderResponse } from '@/platform/providers/Provider';
import { useSettingsStore } from '@/platform/settings/settingsStore';
import { CONFIDENTIALITY_MODE_SETTING_KEY } from '@/platform/privacy/egress';

// The personal-install choice gate (Task 1.3) is added to RunOnAllButton.runAll.
// Stub assertCloudGenerationAllowed as a no-op here — these tests focus on the
// multi-provider parallel dispatch logic (Q15), not the confidentiality gate.
vi.mock('@/platform/privacy/localOnlyGuard', async (orig) => {
  const real = await orig<typeof import('@/platform/privacy/localOnlyGuard')>();
  return {
    ...real,
    assertCloudGenerationAllowed: vi.fn(),
    ConfidentialityChoiceRequiredError: real.ConfidentialityChoiceRequiredError,
  };
});

function makeProvider(
  id: string,
  response: Partial<ProviderResponse> | Error
): Provider {
  return {
    getMetadata: () => ({ providerId: id, model: `${id}-model` }),
    sendMessage: vi.fn(async () => {
      if (response instanceof Error) throw response;
      return {
        content: response.content ?? `hello from ${id}`,
        usage: {
          inputTokens: 10,
          outputTokens: 10,
          totalTokens: response.usage?.totalTokens ?? 20,
        },
        cost: response.cost ?? 0.001,
        latency: 5,
        model: `${id}-model`,
      } as ProviderResponse;
    }) as Provider['sendMessage'],
    structuredOutput: vi.fn(async () => ({})) as unknown as Provider['structuredOutput'],
  };
}

describe('RunOnAllButton (Q15)', () => {
  afterEach(() => {
    // Reset confidentiality mode so the Local-only test never leaks into others.
    useSettingsStore.setState({ values: {} });
  });

  it('Local-only: button disabled and no provider is ever sent to (cloud fan-out off)', () => {
    useSettingsStore.getState().setSetting(CONFIDENTIALITY_MODE_SETTING_KEY, 'local-only');
    const claude = makeProvider('claude', {});
    const openai = makeProvider('openai', {});
    render(
      <RunOnAllButton
        tier="professional"
        providers={[
          { id: 'claude', label: 'Claude', provider: claude },
          { id: 'openai', label: 'OpenAI', provider: openai },
        ]}
        prompt="hello"
      />
    );
    const btn = screen.getByTestId('run-on-all-button');
    expect(btn).toBeDisabled();
    // Even a forced click cannot start a cloud send.
    fireEvent.click(btn);
    expect(claude.sendMessage).not.toHaveBeenCalled();
    expect(openai.sendMessage).not.toHaveBeenCalled();
  });

  it('disables the button for free tier', () => {
    render(
      <RunOnAllButton
        tier="free"
        providers={[
          { id: 'claude', label: 'Claude', provider: makeProvider('claude', {}) },
          { id: 'openai', label: 'OpenAI', provider: makeProvider('openai', {}) },
        ]}
        prompt="hello"
      />
    );
    expect(screen.getByTestId('run-on-all-button')).toBeDisabled();
  });

  it('disables when fewer than 2 distinct providers are configured', () => {
    render(
      <RunOnAllButton
        tier="professional"
        providers={[
          { id: 'claude', label: 'Claude', provider: makeProvider('claude', {}) },
        ]}
        prompt="hello"
      />
    );
    expect(screen.getByTestId('run-on-all-button')).toBeDisabled();
  });

  it('fires sendMessage on every configured provider in parallel', async () => {
    const claude = makeProvider('claude', { content: 'claude response' });
    const openai = makeProvider('openai', { content: 'openai response' });
    const gemini = makeProvider('gemini', { content: 'gemini response' });

    render(
      <RunOnAllButton
        tier="professional"
        providers={[
          { id: 'claude', label: 'Claude', provider: claude },
          { id: 'openai', label: 'OpenAI', provider: openai },
          { id: 'gemini', label: 'Gemini', provider: gemini },
        ]}
        prompt="hello everyone"
      />
    );

    fireEvent.click(screen.getByTestId('run-on-all-button'));

    await waitFor(() => {
      expect(claude.sendMessage).toHaveBeenCalledTimes(1);
      expect(openai.sendMessage).toHaveBeenCalledTimes(1);
      expect(gemini.sendMessage).toHaveBeenCalledTimes(1);
    });
    expect(claude.sendMessage).toHaveBeenCalledWith('hello everyone');

    // ComparisonView renders one column per provider.
    await waitFor(() => {
      expect(screen.getByTestId('run-on-all-panel')).toBeInTheDocument();
      expect(screen.getByTestId('comparison-keep-claude')).toBeInTheDocument();
      expect(screen.getByTestId('comparison-keep-openai')).toBeInTheDocument();
      expect(screen.getByTestId('comparison-keep-gemini')).toBeInTheDocument();
    });
  });

  it('"Keep this one" invokes onKeep with the chosen content', async () => {
    const onKeep = vi.fn();
    const claude = makeProvider('claude', { content: 'pick me' });
    const openai = makeProvider('openai', { content: 'no pick me' });

    render(
      <RunOnAllButton
        tier="professional"
        providers={[
          { id: 'claude', label: 'Claude', provider: claude },
          { id: 'openai', label: 'OpenAI', provider: openai },
        ]}
        prompt="q"
        onKeep={onKeep}
      />
    );

    fireEvent.click(screen.getByTestId('run-on-all-button'));
    await waitFor(() =>
      expect(screen.getByTestId('comparison-keep-claude')).toBeInTheDocument()
    );
    fireEvent.click(screen.getByTestId('comparison-keep-claude'));
    expect(onKeep).toHaveBeenCalledWith('claude', 'pick me');
  });

  it('renders a failing provider as an error column without blocking others', async () => {
    const claude = makeProvider('claude', new Error('429 rate limit'));
    const openai = makeProvider('openai', { content: 'ok' });

    render(
      <RunOnAllButton
        tier="professional"
        providers={[
          { id: 'claude', label: 'Claude', provider: claude },
          { id: 'openai', label: 'OpenAI', provider: openai },
        ]}
        prompt="q"
      />
    );

    fireEvent.click(screen.getByTestId('run-on-all-button'));

    await waitFor(() => {
      expect(screen.getByTestId('comparison-keep-claude')).toBeDisabled();
      expect(screen.getByTestId('comparison-keep-openai')).toBeEnabled();
    });
    // The error text reaches the user (prefixed with 'Error:')
    expect(screen.getByText(/429 rate limit/)).toBeInTheDocument();
  });

  it('shows the total cost under the comparison view', async () => {
    const claude = makeProvider('claude', { cost: 0.0025 });
    const openai = makeProvider('openai', { cost: 0.0015 });

    render(
      <RunOnAllButton
        tier="professional"
        providers={[
          { id: 'claude', label: 'Claude', provider: claude },
          { id: 'openai', label: 'OpenAI', provider: openai },
        ]}
        prompt="q"
      />
    );

    fireEvent.click(screen.getByTestId('run-on-all-button'));
    await waitFor(() =>
      expect(screen.getByTestId('run-on-all-total-cost')).toHaveTextContent(
        /\$0\.0040/
      )
    );
  });
});
