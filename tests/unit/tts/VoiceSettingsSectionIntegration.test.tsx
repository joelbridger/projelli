/**
 * Task 14 — Wire VoiceOutputSettingsSection into VoiceSettingsSection
 *
 * Verifies that VoiceSettingsSection renders the TTS output subsection
 * when ttsEnabled=true is passed, and hides it when ttsEnabled=false.
 *
 * Covers:
 *   - tts-output-status present when ttsEnabled=true
 *   - tts-output-status absent when ttsEnabled=false
 *   - voice-status (existing voice input banner) still renders alongside TTS
 *   - Both subsections coexist without errors
 */

import { describe, it, expect } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { VoiceSettingsSection } from '@/components/settings/VoiceSettingsSection';

describe('VoiceSettingsSection with TTS output section wired', () => {
  it('renders existing voice-status banner', async () => {
    await act(async () => {
      render(
        <VoiceSettingsSection
          onProbeSidecar={() => Promise.resolve(true)}
          onProbeMic={() => Promise.resolve('granted')}
          ttsEnabled={false}
          onProbeTts={() => Promise.resolve(true)}
        />,
      );
    });
    expect(screen.getByTestId('voice-status')).toBeInTheDocument();
  });

  it('does not render tts-output-status when ttsEnabled=false', async () => {
    await act(async () => {
      render(
        <VoiceSettingsSection
          onProbeSidecar={() => Promise.resolve(true)}
          onProbeMic={() => Promise.resolve('granted')}
          ttsEnabled={false}
          onProbeTts={() => Promise.resolve(true)}
        />,
      );
    });
    expect(screen.queryByTestId('tts-output-status')).toBeNull();
  });

  it('renders tts-output-status when ttsEnabled=true', async () => {
    await act(async () => {
      render(
        <VoiceSettingsSection
          onProbeSidecar={() => Promise.resolve(true)}
          onProbeMic={() => Promise.resolve('granted')}
          ttsEnabled={true}
          onProbeTts={() => Promise.resolve(true)}
        />,
      );
    });
    expect(screen.getByTestId('tts-output-status')).toBeInTheDocument();
  });

  it('shows ready status when TTS sidecar available', async () => {
    await act(async () => {
      render(
        <VoiceSettingsSection
          onProbeSidecar={() => Promise.resolve(true)}
          onProbeMic={() => Promise.resolve('granted')}
          ttsEnabled={true}
          onProbeTts={() => Promise.resolve(true)}
        />,
      );
    });
    const el = screen.getByTestId('tts-output-status');
    expect(el.getAttribute('data-status')).toBe('ready');
  });

  it('shows unavailable status when TTS sidecar missing', async () => {
    await act(async () => {
      render(
        <VoiceSettingsSection
          onProbeSidecar={() => Promise.resolve(true)}
          onProbeMic={() => Promise.resolve('granted')}
          ttsEnabled={true}
          onProbeTts={() => Promise.resolve(false)}
        />,
      );
    });
    const el = screen.getByTestId('tts-output-status');
    expect(el.getAttribute('data-status')).toBe('unavailable');
  });

  it('both voice-status and tts-output-status coexist when both enabled', async () => {
    await act(async () => {
      render(
        <VoiceSettingsSection
          onProbeSidecar={() => Promise.resolve(true)}
          onProbeMic={() => Promise.resolve('granted')}
          ttsEnabled={true}
          onProbeTts={() => Promise.resolve(true)}
        />,
      );
    });
    expect(screen.getByTestId('voice-status')).toBeInTheDocument();
    expect(screen.getByTestId('tts-output-status')).toBeInTheDocument();
  });
});
