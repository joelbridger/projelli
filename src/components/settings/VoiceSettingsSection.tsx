/**
 * Voice Settings Section (M6, v1.5 — Flag 4).
 *
 * Shown at the top of the Voice settings category. Surfaces the current
 * state of the bundled Parakeet/whisper.cpp sidecar and mic permission.
 * The schema-driven rows below (enable toggle, model select, hotkey
 * displays) are rendered by the usual SettingsModal row loop.
 */

import { useEffect, useState } from 'react';
import { Trans } from 'react-i18next';
import { CheckCircle2, AlertCircle, Mic, MicOff } from 'lucide-react';
import { isVoiceSidecarAvailable } from '@/modules/voice/voiceStatus';
import { VoiceOutputSettingsSection } from '@/components/tts/VoiceOutputSettingsSection';

type SidecarStatus = 'checking' | 'ready' | 'missing';
type MicStatus = 'unknown' | 'granted' | 'denied' | 'prompt';

export interface VoiceSettingsSectionProps {
  /** Test hook — replaces the real sidecar probe. */
  onProbeSidecar?: () => Promise<boolean>;
  /** Test hook — replaces the mic-permission query. */
  onProbeMic?: () => Promise<MicStatus>;
  /**
   * Current value of the ttsEnabled setting. When true, the
   * VoiceOutputSettingsSection (TTS availability banner) is shown.
   * Defaults to false so the banner stays hidden until TTS is enabled.
   */
  ttsEnabled?: boolean;
  /** Test hook — replaces TTSService.isAvailable() probe in VoiceOutputSettingsSection. */
  onProbeTts?: () => Promise<boolean>;
}

async function defaultProbeMic(): Promise<MicStatus> {
  if (typeof navigator === 'undefined') return 'unknown';
  // `navigator.permissions.query({ name: 'microphone' })` is implemented on
  // Chromium but not yet on Firefox. Fall back to 'unknown' so we don't
  // misreport.
  try {
    const perms = (
      navigator as unknown as {
        permissions?: { query?: (d: { name: string }) => Promise<{ state: MicStatus }> };
      }
    ).permissions;
    if (!perms?.query) return 'unknown';
    const result = await perms.query({ name: 'microphone' });
    return result.state as MicStatus;
  } catch {
    return 'unknown';
  }
}

export function VoiceSettingsSection({
  onProbeSidecar,
  onProbeMic,
  ttsEnabled = false,
  onProbeTts,
}: VoiceSettingsSectionProps = {}): React.ReactElement {
  const [sidecar, setSidecar] = useState<SidecarStatus>('checking');
  const [mic, setMic] = useState<MicStatus>('unknown');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const sideOk = onProbeSidecar ? await onProbeSidecar() : await isVoiceSidecarAvailable();
      if (cancelled) return;
      setSidecar(sideOk ? 'ready' : 'missing');
      const micStatus = onProbeMic ? await onProbeMic() : await defaultProbeMic();
      if (cancelled) return;
      setMic(micStatus);
    })();
    return () => {
      cancelled = true;
    };
  }, [onProbeSidecar, onProbeMic]);

  let label: string;
  let testidStatus: 'ready' | 'missing' | 'denied' | 'checking';
  if (sidecar === 'checking') {
    label = 'Checking voice availability...';
    testidStatus = 'checking';
  } else if (sidecar === 'missing') {
    label = 'Sidecar missing (voice features disabled in this build)';
    testidStatus = 'missing';
  } else if (mic === 'denied') {
    label = 'Mic permission denied (allow microphone access to use voice)';
    testidStatus = 'denied';
  } else {
    label = 'Voice ready';
    testidStatus = 'ready';
  }

  const Icon = sidecar === 'ready' && mic !== 'denied' ? CheckCircle2
    : sidecar === 'missing' ? AlertCircle
    : mic === 'denied' ? MicOff
    : Mic;

  return (
    <>
      <div className="mb-6">
        <p className="text-xs text-muted-foreground mb-3">
          <Trans
            i18nKey="settings.voice.description"
            components={{ c: <code className="px-1 mx-0.5 rounded bg-muted font-mono text-[11px]" /> }}
          />
        </p>
        <div
          data-testid="voice-status"
          data-status={testidStatus}
          className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/20 px-3 py-2"
        >
          <Icon
            className={`h-4 w-4 shrink-0 ${
              testidStatus === 'ready'
                ? 'text-emerald-500'
                : testidStatus === 'checking'
                  ? 'text-muted-foreground'
                  : 'text-amber-500'
            }`}
          />
          <span className="text-sm">{label}</span>
        </div>
      </div>

      <VoiceOutputSettingsSection
        ttsEnabled={ttsEnabled}
        {...(onProbeTts !== undefined ? { onProbe: onProbeTts } : {})}
      />
    </>
  );
}

export default VoiceSettingsSection;
