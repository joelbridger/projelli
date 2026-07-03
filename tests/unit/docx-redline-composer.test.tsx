// E4 / BUG-009 — the AI-redline composer's key gate.
//
// Regression guard for the bug where "Revise with AI" was dead for any BYOK
// user whose provider wasn't Anthropic: MainPanel never passed an aiProvider to
// DocxEditor, so it defaulted to 'anthropic', and the redline key lookup
// (provider === aiProvider && isValid) found nothing even with a valid OpenAI
// key. The fix passes the resolved active provider (useActiveEgressProvider) so
// hasKey reflects the user's real, configured provider.
//
// This locks the composer's visible contract: when a key IS available the
// "Suggest changes" button is enabled and the "add a key" warning is gone; when
// it is NOT, the button is disabled and the warning shows.

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import '@/i18n';
import { RedlineComposer } from '@/features/documents/media/DocxRedlineControls';

function renderComposer(overrides: Partial<React.ComponentProps<typeof RedlineComposer>> = {}) {
  const props: React.ComponentProps<typeof RedlineComposer> = {
    instruction: 'tighten the indemnity clause',
    onInstructionChange: vi.fn(),
    busy: false,
    error: null,
    needsConfidentialityChoice: false,
    onEnableCloudAi: vi.fn(),
    hasKey: true,
    aiPaused: false,
    onRun: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  render(<RedlineComposer {...props} />);
  return props;
}

describe('RedlineComposer key gate (E4 / BUG-009)', () => {
  it('enables "Suggest changes" and hides the add-a-key warning when a key is present', () => {
    renderComposer({ hasKey: true });
    const submit = screen.getByTestId('docx-redline-submit') as HTMLButtonElement;
    expect(submit.disabled).toBe(false);
    expect(screen.queryByTestId('docx-redline-need-key')).toBeNull();
  });

  it('disables the button and shows the add-a-key warning when no key is configured', () => {
    renderComposer({ hasKey: false });
    const submit = screen.getByTestId('docx-redline-submit') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    expect(screen.getByTestId('docx-redline-need-key')).toBeTruthy();
  });

  it('keeps the button disabled when the instruction is empty even with a key', () => {
    renderComposer({ hasKey: true, instruction: '   ' });
    const submit = screen.getByTestId('docx-redline-submit') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
  });

  it('shows the AI-paused notice (not the key warning) and disables the button when AI is paused', () => {
    renderComposer({ hasKey: true, aiPaused: true });
    const submit = screen.getByTestId('docx-redline-submit') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    expect(screen.getByTestId('docx-redline-ai-paused')).toBeTruthy();
    // When paused we surface the pause reason, not the (irrelevant) key hint.
    expect(screen.queryByTestId('docx-redline-need-key')).toBeNull();
  });

  it('shows the inline consent prompt (not a plain error sentence) for the confidentiality-choice gate', () => {
    renderComposer({
      hasKey: true,
      error: 'Before sending to a cloud AI, go to Settings → Privacy and choose how you want AI requests handled.',
      needsConfidentialityChoice: true,
    });
    expect(screen.getByTestId('docx-redline-needs-consent')).toBeTruthy();
    expect(screen.queryByTestId('docx-redline-error')).toBeNull();
  });

  it('shows the plain error sentence for a non-consent error', () => {
    renderComposer({ hasKey: true, error: 'Something else went wrong.', needsConfidentialityChoice: false });
    expect(screen.getByTestId('docx-redline-error')).toBeTruthy();
    expect(screen.queryByTestId('docx-redline-needs-consent')).toBeNull();
  });
});
