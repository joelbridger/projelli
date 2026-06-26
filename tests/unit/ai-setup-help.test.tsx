/**
 * AiSetupHelpLink / AiSetupHelpDialog — the "I need help setting this up"
 * support ticket shown beneath the AI-provider key input.
 *
 * Verifies the behavior that matters, through the public interface:
 *   - The link renders and opens the dialog
 *   - Submit is gated on a non-empty message
 *   - A submit POSTs the message + onboarding context to the dedicated
 *     `ai-setup-help` endpoint (NOT the bug-report endpoint)
 *   - Success and failure states render; the message is preserved on failure
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import {
  AiSetupHelpLink,
  AiSetupHelpDialog,
} from '@/features/onboarding/AiSetupHelpLink';
import { redactSecrets } from '@/platform/utils/redactSecrets';

vi.mock('@/platform/utils/openExternal', () => ({
  openExternal: vi.fn(async () => {}),
}));

const mockFetch = vi.fn();
vi.mock('@/platform/providers/fetchUtils', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/platform/providers/fetchUtils')>();
  return { ...actual, getCorsSafeFetch: vi.fn(async () => mockFetch) };
});

describe('AiSetupHelpLink / AiSetupHelpDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({ ok: true, status: 200 });
  });

  it('renders the help link and opens the dialog when clicked', () => {
    render(
      <AiSetupHelpLink
        provider="anthropic"
        providerName="Claude"
        context="settings · api-key-wizard"
      />,
    );
    const link = screen.getByTestId('ai-setup-help-link');
    expect(link).toBeInTheDocument();
    fireEvent.click(link);
    expect(screen.getByTestId('ai-setup-help-message')).toBeInTheDocument();
  });

  it('keeps submit disabled until a message is typed', () => {
    render(
      <AiSetupHelpDialog
        open
        onOpenChange={vi.fn()}
        provider="anthropic"
        providerName="Claude"
        context="ctx"
      />,
    );
    const submit = screen.getByTestId('ai-setup-help-submit');
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByTestId('ai-setup-help-message'), {
      target: { value: 'help me' },
    });
    expect(submit).not.toBeDisabled();
  });

  it('POSTs the trimmed message + provider + context to the ai-setup-help endpoint', async () => {
    render(
      <AiSetupHelpDialog
        open
        onOpenChange={vi.fn()}
        provider="openai"
        providerName="ChatGPT"
        context="onboarding · ai-key-step"
      />,
    );
    fireEvent.change(screen.getByTestId('ai-setup-help-message'), {
      target: { value: '  my key keeps getting rejected  ' },
    });
    fireEvent.change(screen.getByTestId('ai-setup-help-email'), {
      target: { value: '  me@example.com  ' },
    });
    fireEvent.click(screen.getByTestId('ai-setup-help-submit'));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
    const call = mockFetch.mock.calls[0] as [string, RequestInit];
    const [url, opts] = call;
    expect(url).toBe('https://keepance.com/api/forms/keepance/ai-setup-help');
    expect(opts.method).toBe('POST');
    const body = JSON.parse(opts.body as string) as Record<string, unknown>;
    expect(body['message']).toBe('my key keeps getting rejected');
    expect(body['email']).toBe('me@example.com');
    expect(body['provider']).toBe('openai');
    expect(body['context']).toBe('onboarding · ai-key-step');
    expect(body).toHaveProperty('version');
    expect(body).toHaveProperty('os');
    expect(body).toHaveProperty('user_agent');
  });

  it('omits the email field when none is given', async () => {
    render(
      <AiSetupHelpDialog
        open
        onOpenChange={vi.fn()}
        provider="anthropic"
        providerName="Claude"
        context="ctx"
      />,
    );
    fireEvent.change(screen.getByTestId('ai-setup-help-message'), {
      target: { value: 'stuck on step 2' },
    });
    fireEvent.click(screen.getByTestId('ai-setup-help-submit'));
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
    const call = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(call[1].body as string) as Record<string, unknown>;
    expect(body).not.toHaveProperty('email');
  });

  it('shows a success state after a successful send', async () => {
    render(
      <AiSetupHelpDialog
        open
        onOpenChange={vi.fn()}
        provider="google"
        providerName="Gemini"
        context="ctx"
      />,
    );
    fireEvent.change(screen.getByTestId('ai-setup-help-message'), {
      target: { value: 'cannot connect' },
    });
    fireEvent.click(screen.getByTestId('ai-setup-help-submit'));
    await screen.findByTestId('ai-setup-help-success');
  });

  it('shows an error state and preserves the message when the send fails', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500 });
    render(
      <AiSetupHelpDialog
        open
        onOpenChange={vi.fn()}
        provider="anthropic"
        providerName="Claude"
        context="ctx"
      />,
    );
    fireEvent.change(screen.getByTestId('ai-setup-help-message'), {
      target: { value: 'it broke' },
    });
    fireEvent.click(screen.getByTestId('ai-setup-help-submit'));
    await screen.findByTestId('ai-setup-help-error');
    const textarea = screen.getByTestId(
      'ai-setup-help-message',
    ) as HTMLTextAreaElement;
    expect(textarea.value).toBe('it broke');
  });

  it('does not send a blank message', () => {
    render(
      <AiSetupHelpDialog
        open
        onOpenChange={vi.fn()}
        provider="anthropic"
        providerName="Claude"
        context="ctx"
      />,
    );
    fireEvent.change(screen.getByTestId('ai-setup-help-message'), {
      target: { value: '   ' },
    });
    fireEvent.click(screen.getByTestId('ai-setup-help-submit'));
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('shows the "do not paste your key" helper text', () => {
    render(
      <AiSetupHelpDialog
        open
        onOpenChange={vi.fn()}
        provider="anthropic"
        providerName="Claude"
        context="ctx"
      />,
    );
    expect(
      screen.getByTestId('ai-setup-help-dont-paste'),
    ).toBeInTheDocument();
  });

  it('redacts a pasted API key from the message before sending', async () => {
    render(
      <AiSetupHelpDialog
        open
        onOpenChange={vi.fn()}
        provider="anthropic"
        providerName="Claude"
        context="ctx"
      />,
    );
    const key = 'sk-ant-api03-' + 'A1b2C3d4'.repeat(12);
    fireEvent.change(screen.getByTestId('ai-setup-help-message'), {
      target: { value: `my key is ${key} and it fails` },
    });
    fireEvent.click(screen.getByTestId('ai-setup-help-submit'));
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
    const call = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(call[1].body as string) as Record<string, unknown>;
    const sent = body['message'] as string;
    expect(sent).not.toContain(key);
    expect(sent).toContain('[redacted possible API key]');
  });

  it('caps an over-long message at the payload limit', async () => {
    render(
      <AiSetupHelpDialog
        open
        onOpenChange={vi.fn()}
        provider="anthropic"
        providerName="Claude"
        context="ctx"
      />,
    );
    // fireEvent.change bypasses the input maxLength, so this exercises the
    // in-code cap (the real defense if a paste slips past the attribute).
    fireEvent.change(screen.getByTestId('ai-setup-help-message'), {
      target: { value: 'x'.repeat(5000) },
    });
    fireEvent.click(screen.getByTestId('ai-setup-help-submit'));
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
    const call = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(call[1].body as string) as Record<string, unknown>;
    expect((body['message'] as string).length).toBeLessThanOrEqual(2000);
  });

  it('blocks submit and flags an invalid email', () => {
    render(
      <AiSetupHelpDialog
        open
        onOpenChange={vi.fn()}
        provider="anthropic"
        providerName="Claude"
        context="ctx"
      />,
    );
    fireEvent.change(screen.getByTestId('ai-setup-help-message'), {
      target: { value: 'help please' },
    });
    fireEvent.change(screen.getByTestId('ai-setup-help-email'), {
      target: { value: 'not-an-email' },
    });
    fireEvent.click(screen.getByTestId('ai-setup-help-submit'));
    expect(mockFetch).not.toHaveBeenCalled();
    expect(
      screen.getByTestId('ai-setup-help-email-error'),
    ).toBeInTheDocument();
  });
});

describe('redactSecrets', () => {
  it('redacts Anthropic, OpenAI and Google keys', () => {
    const anthropic = 'sk-ant-api03-' + 'Zz9'.repeat(20);
    const openai = 'sk-' + 'aB3d'.repeat(12);
    const google = 'AIza' + 'Cd5f'.repeat(10);
    for (const key of [anthropic, openai, google]) {
      const out = redactSecrets(`before ${key} after`);
      expect(out).not.toContain(key);
      expect(out).toContain('[redacted possible API key]');
    }
  });

  it('leaves ordinary prose untouched', () => {
    const text = "I can't connect and my key keeps failing on step 2.";
    expect(redactSecrets(text)).toBe(text);
  });
});
