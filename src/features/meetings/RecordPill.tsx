/**
 * RecordPill — the whole recording UI (UX brainstorm rule). Idle renders
 * nothing; a "Record meeting" affordance lives on the client's Meetings tab
 * header instead. While recording, floats over every surface as a small
 * pill: elapsed time, the egress indicator ("Local. Nothing has left this
 * machine."), and Stop. Mounted once, globally, in App.tsx (not scoped to
 * any one tab) so it stays visible while the advisor switches surfaces
 * mid-meeting.
 */
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Circle, Square } from 'lucide-react';
import { useMeetingStore } from './meetingStore';
import { useConfidentialityMode } from '@/platform/hooks/useConfidentialityMode';
import { useActiveEgressProvider } from '@/platform/hooks/useActiveEgressProvider';
import { EgressIndicator } from '@/platform/privacy/ui/EgressIndicator';

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m)}:${String(s).padStart(2, '0')}`;
}

export function RecordPill() {
  const { t } = useTranslation();
  const recording = useMeetingStore((s) => s.status.recording);
  const elapsedMs = useMeetingStore((s) => s.status.elapsedMs);
  const tick = useMeetingStore((s) => s.tick);
  const stopRecording = useMeetingStore((s) => s.stopRecording);
  const confidentialityMode = useConfidentialityMode();
  const egressProvider = useActiveEgressProvider(confidentialityMode);

  useEffect(() => {
    if (!recording) return;
    const id = setInterval(() => { tick(); }, 1000);
    return () => { clearInterval(id); };
  }, [recording, tick]);

  if (!recording) return null;

  return (
    <div
      data-testid="record-pill"
      role="status"
      style={{
        position: 'fixed',
        bottom: 20,
        right: 20,
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '10px 16px',
        borderRadius: 999,
        background: 'var(--kp-surface)',
        border: '1px solid var(--kp-divider)',
        boxShadow: 'var(--kp-shadow-lg, 0 8px 24px rgba(0,0,0,0.12))',
      }}
    >
      <Circle data-testid="record-pill-dot" className="animate-pulse" style={{ width: 10, height: 10, color: 'var(--kp-danger, #d33)', fill: 'currentColor' }} />
      <span style={{ fontSize: 'var(--kp-font-sm)', fontWeight: 'var(--kp-weight-semibold)', color: 'var(--kp-navy)', fontVariantNumeric: 'tabular-nums' }}>
        {formatElapsed(elapsedMs)}
      </span>
      <EgressIndicator provider={egressProvider} mode={confidentialityMode} variant="compact" />
      <button
        type="button"
        data-testid="record-pill-stop"
        onClick={() => { void stopRecording(); }}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          border: 'none',
          background: 'var(--kp-navy)',
          color: 'white',
          borderRadius: 999,
          padding: '5px 12px',
          fontSize: 'var(--kp-font-xs)',
          fontWeight: 'var(--kp-weight-semibold)',
          cursor: 'pointer',
          fontFamily: 'inherit',
        }}
      >
        <Square style={{ width: 10, height: 10 }} />
        {t('meetings.pill.stop')}
      </button>
    </div>
  );
}

export default RecordPill;
