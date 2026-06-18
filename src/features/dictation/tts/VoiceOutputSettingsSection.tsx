/**
 * VoiceOutputSettingsSection — TTS status banner for Settings → Voice.
 *
 * Rendered above the schema-driven TTS rows (ttsEnabled toggle, ttsVoice
 * select, ttsSpeed, ttsAutoRead, ttsShortcut). Shows availability of the
 * Piper sidecar so users understand why TTS might not work on their machine.
 *
 * Visibility: only rendered when `ttsEnabled` is true (the parent passes
 * the current settings value so this component stays a pure presentational
 * section with a test hook for the async probe).
 *
 * Status machine:
 *   checking  → probe in flight (spinner + grey icon)
 *   ready     → Piper binary + bundled voice present (green checkmark)
 *   unavailable → binary or voice missing (amber warning)
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { TTSService } from '@/features/dictation/engine/TTSService';

type TtsStatus = 'checking' | 'ready' | 'unavailable';

export interface VoiceOutputSettingsSectionProps {
  /** Whether the user has TTS enabled (gate for rendering). */
  ttsEnabled: boolean;
  /**
   * Test hook — replaces the real TTSService.isAvailable() probe.
   * In production this is left undefined; the component calls the real service.
   */
  onProbe?: () => Promise<boolean>;
}

export function VoiceOutputSettingsSection({
  ttsEnabled,
  onProbe,
}: VoiceOutputSettingsSectionProps): React.ReactElement | null {
  const { t } = useTranslation();
  const [status, setStatus] = useState<TtsStatus>('checking');

  useEffect(() => {
    if (!ttsEnabled) return;

    let cancelled = false;
    void (async () => {
      const available = onProbe ? await onProbe() : await TTSService.isAvailable();
      if (cancelled) return;
      setStatus(available ? 'ready' : 'unavailable');
    })();
    return () => {
      cancelled = true;
    };
  }, [ttsEnabled, onProbe]);

  // Hidden entirely when TTS is disabled — avoids confusing the user with a
  // sidecar status they can't act on while the toggle is off.
  if (!ttsEnabled) return null;

  const statusConfig: Record<
    TtsStatus,
    { label: string; iconClass: string; Icon: React.ElementType }
  > = {
    checking: {
      label: 'Checking TTS availability…',
      iconClass: 'text-muted-foreground',
      Icon: Loader2,
    },
    ready: {
      label: 'TTS ready. Piper sidecar and bundled voice found.',
      iconClass: 'text-emerald-500',
      Icon: CheckCircle2,
    },
    unavailable: {
      label: 'TTS not available. Piper binary or bundled voice missing in this build.',
      iconClass: 'text-amber-500',
      Icon: AlertCircle,
    },
  };

  const { label, iconClass, Icon } = statusConfig[status];

  return (
    <div className="mb-6">
      <h3 className="text-base font-semibold mb-1">Voice output</h3>
      <p className="text-xs text-muted-foreground mb-3">
        {t('tts.output.description')}
      </p>
      <div
        data-testid="tts-output-status"
        data-status={status}
        className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/20 px-3 py-2"
      >
        <Icon
          className={`h-4 w-4 shrink-0 ${iconClass} ${status === 'checking' ? 'animate-spin' : ''}`}
        />
        <span className="text-sm">{label}</span>
      </div>
    </div>
  );
}

export default VoiceOutputSettingsSection;
