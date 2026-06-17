/**
 * Task 13 — VoiceOutputSettingsSection component
 *
 * The TTS-specific status banner rendered at the top of the
 * Settings → Voice → "Voice output" subsection.
 *
 * Covers:
 *   - Renders nothing when ttsEnabled=false (component not visible)
 *   - Renders a status banner when ttsEnabled=true
 *   - data-testid="tts-output-status" present
 *   - Shows "checking" state during async probe
 *   - Shows "ready" state when sidecar is available
 *   - Shows "unavailable" state when sidecar is missing
 *   - Test hook onProbe replaces the real sidecar call
 *   - Heading "Voice output" is present in the rendered markup
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { VoiceOutputSettingsSection } from '@/features/dictation/tts/VoiceOutputSettingsSection';

describe('VoiceOutputSettingsSection', () => {
  it('renders the section heading', async () => {
    await act(async () => {
      render(
        <VoiceOutputSettingsSection
          ttsEnabled={true}
          onProbe={() => Promise.resolve(true)}
        />,
      );
    });
    expect(screen.getByText(/voice output/i)).toBeInTheDocument();
  });

  it('shows status banner with data-testid when ttsEnabled=true', async () => {
    await act(async () => {
      render(
        <VoiceOutputSettingsSection
          ttsEnabled={true}
          onProbe={() => Promise.resolve(true)}
        />,
      );
    });
    expect(screen.getByTestId('tts-output-status')).toBeInTheDocument();
  });

  it('does not render when ttsEnabled=false', () => {
    render(
      <VoiceOutputSettingsSection
        ttsEnabled={false}
        onProbe={() => Promise.resolve(true)}
      />,
    );
    expect(screen.queryByTestId('tts-output-status')).toBeNull();
  });

  it('shows "ready" status when sidecar is available', async () => {
    await act(async () => {
      render(
        <VoiceOutputSettingsSection
          ttsEnabled={true}
          onProbe={() => Promise.resolve(true)}
        />,
      );
    });
    const el = screen.getByTestId('tts-output-status');
    expect(el.getAttribute('data-status')).toBe('ready');
  });

  it('shows "unavailable" status when sidecar is missing', async () => {
    await act(async () => {
      render(
        <VoiceOutputSettingsSection
          ttsEnabled={true}
          onProbe={() => Promise.resolve(false)}
        />,
      );
    });
    const el = screen.getByTestId('tts-output-status');
    expect(el.getAttribute('data-status')).toBe('unavailable');
  });

  it('shows "checking" status before probe resolves', () => {
    let resolve!: (v: boolean) => void;
    const probe = () => new Promise<boolean>((r) => { resolve = r; });
    render(
      <VoiceOutputSettingsSection
        ttsEnabled={true}
        onProbe={probe}
      />,
    );
    const el = screen.getByTestId('tts-output-status');
    expect(el.getAttribute('data-status')).toBe('checking');
    // Resolve to clean up
    resolve(true);
  });

  it('calls onProbe on mount when ttsEnabled=true', async () => {
    const onProbe = vi.fn().mockResolvedValue(true);
    await act(async () => {
      render(
        <VoiceOutputSettingsSection
          ttsEnabled={true}
          onProbe={onProbe}
        />,
      );
    });
    expect(onProbe).toHaveBeenCalledTimes(1);
  });

  it('does not call onProbe when ttsEnabled=false', () => {
    const onProbe = vi.fn().mockResolvedValue(true);
    render(
      <VoiceOutputSettingsSection
        ttsEnabled={false}
        onProbe={onProbe}
      />,
    );
    expect(onProbe).not.toHaveBeenCalled();
  });

  it('status text describes ready state', async () => {
    await act(async () => {
      render(
        <VoiceOutputSettingsSection
          ttsEnabled={true}
          onProbe={() => Promise.resolve(true)}
        />,
      );
    });
    const el = screen.getByTestId('tts-output-status');
    expect(el.textContent).toMatch(/ready/i);
  });

  it('status text describes unavailable state', async () => {
    await act(async () => {
      render(
        <VoiceOutputSettingsSection
          ttsEnabled={true}
          onProbe={() => Promise.resolve(false)}
        />,
      );
    });
    const el = screen.getByTestId('tts-output-status');
    expect(el.textContent).toMatch(/not available|unavailable|missing/i);
  });
});
