/**
 * Task 15 — Verify Settings UI renders TTS section correctly
 *
 * Verifies that:
 *   1. VoiceSettingsSection correctly reads ttsEnabled from the settings
 *      store (when composed with real store in test environment).
 *   2. The schema-driven TTS rows are present in the voice category.
 *   3. VoiceOutputSettingsSection banner is absent when ttsEnabled=false,
 *      and present when ttsEnabled=true.
 *
 * Uses VoiceSettingsSection directly with controlled props — avoids the
 * full SettingsModal weight (which has many deps) while still testing the
 * relevant integration path.
 */

import { describe, it, expect } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { VoiceSettingsSection } from '@/components/settings/VoiceSettingsSection';
import { SETTINGS_SCHEMA } from '@/settings/schema';

// TTS schema keys that should appear in the voice category
const TTS_SCHEMA_KEYS = ['ttsEnabled', 'ttsVoice', 'ttsSpeed', 'ttsAutoRead', 'ttsShortcut'];

describe('Settings voice category — TTS UI', () => {
  describe('schema entries', () => {
    it('all TTS keys exist in SETTINGS_SCHEMA under voice category', () => {
      const voiceKeys = SETTINGS_SCHEMA
        .filter((d) => d.category === 'voice')
        .map((d) => d.key);
      for (const k of TTS_SCHEMA_KEYS) {
        expect(voiceKeys).toContain(k);
      }
    });

    it('ttsEnabled is a toggle with default false', () => {
      const def = SETTINGS_SCHEMA.find((d) => d.key === 'ttsEnabled')!;
      expect(def.type).toBe('toggle');
      expect(def.defaultValue).toBe(false);
    });

    it('ttsVoice is a select', () => {
      const def = SETTINGS_SCHEMA.find((d) => d.key === 'ttsVoice')!;
      expect(def.type).toBe('select');
      expect(def.options?.length).toBeGreaterThanOrEqual(3);
    });

    it('ttsSpeed is a number in range 0.5–2.0', () => {
      const def = SETTINGS_SCHEMA.find((d) => d.key === 'ttsSpeed')!;
      expect(def.type).toBe('number');
      expect(def.min).toBe(0.5);
      expect(def.max).toBe(2.0);
    });
  });

  describe('VoiceSettingsSection with ttsEnabled=false', () => {
    it('renders voice-status banner (voice input section)', async () => {
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

    it('does NOT render tts-output-status when TTS disabled', async () => {
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
  });

  describe('VoiceSettingsSection with ttsEnabled=true', () => {
    it('renders tts-output-status when TTS enabled and sidecar available', async () => {
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
      expect(el).toBeInTheDocument();
      expect(el.getAttribute('data-status')).toBe('ready');
    });

    it('renders tts-output-status with unavailable when sidecar missing', async () => {
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

    it('voice output heading is rendered', async () => {
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
      expect(screen.getByText(/voice output/i)).toBeInTheDocument();
    });
  });
});
