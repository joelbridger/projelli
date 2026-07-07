/**
 * RecordPill — the whole recording UI (UX brainstorm rule). Idle renders
 * nothing; a "Record a meeting" affordance lives on the client's Meetings
 * tab instead. While recording, floats over every surface as a small pill:
 * a "Recording" label over the elapsed time, the local-capture reassurance
 * ("Local — nothing has left this machine"), and Stop. After Stop it stays
 * up in a "writing your meeting notes" state until transcription + notes
 * finish, so stopping never feels like the work vanished. Mounted once,
 * globally, in App.tsx (not scoped to any one tab) so it stays visible
 * while the advisor switches surfaces mid-meeting.
 *
 * The reassurance is deliberately NOT the AI EgressIndicator: mid-recording
 * the advisor's question is "where is my AUDIO going?", and the honest
 * answer is always "written straight to this computer's disk" — the AI
 * provider chip ("No AI connected" / provider names) answers a different
 * question and reads as a warning at exactly the wrong moment
 * (2026-07-04 UX review, finding B1).
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Circle, Copy, Loader2, Square, X } from 'lucide-react';
import { useMeetingStore, recordChatNoticeForActiveMeeting } from './meetingStore';
import { copyText } from './noticeClipboard';
import { noticeCardPillView } from './noticeCard/noticeCardPill';

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m)}:${String(s).padStart(2, '0')}`;
}

const pillFrame: React.CSSProperties = {
  position: 'fixed',
  bottom: 20,
  right: 20,
  zIndex: 1300, // --kp-z-toast: floats over surfaces, under tooltips

  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '10px 12px 10px 16px',
  borderRadius: 999,
  background: 'var(--color-card)',
  border: '1px solid var(--kp-divider)',
  boxShadow: 'var(--kp-shadow-3)',
};

export function RecordPill() {
  const { t } = useTranslation();
  const recording = useMeetingStore((s) => s.status.recording);
  const processing = useMeetingStore((s) => s.processingCount > 0);
  const elapsedMs = useMeetingStore((s) => s.status.elapsedMs);
  const tick = useMeetingStore((s) => s.tick);
  const stopRecording = useMeetingStore((s) => s.stopRecording);
  const noticeCardStatus = useMeetingStore((s) => s.noticeCardStatus);
  const lastWriteFailure = useMeetingStore((s) => s.lastWriteFailure);
  const dismissWriteFailure = useMeetingStore((s) => s.dismissWriteFailure);
  const [chatCopied, setChatCopied] = useState(false);
  const noticeCardPill = noticeCardPillView(noticeCardStatus);

  const handleCopyChatNotice = () => {
    void (async () => {
      const text = t('meetings.notice.chat-notice');
      try {
        await copyText(text); // throws if the copy wasn't confirmed
      } catch {
        // Don't log a chat-notice ledger entry for a copy that didn't happen
        // (codex-review R5).
        return;
      }
      await recordChatNoticeForActiveMeeting(text);
      setChatCopied(true);
      window.setTimeout(() => { setChatCopied(false); }, 1500);
    })();
  };

  useEffect(() => {
    if (!recording) return;
    const id = setInterval(() => {
      void tick();
    }, 1000);
    return () => {
      clearInterval(id);
    };
  }, [recording, tick]);

  if (!recording && !processing && !lastWriteFailure) return null;

  // QA-35: a chunk write failed mid-recording and the app auto-stopped —
  // this is the LASTING honest-failure state (unlike the transition through
  // `recording -> false`, which alone would make the pill just vanish the
  // instant the auto-stop completes, with no sign anything went wrong).
  // Checked before the `processing` branch below: a real, actionable failure
  // is more useful to the advisor than the generic "writing your notes"
  // spinner for some other in-flight meeting.
  if (!recording && lastWriteFailure) {
    return (
      <div data-testid="record-pill-write-error" role="alert" style={pillFrame}>
        <Circle
          style={{ width: 10, height: 10, color: 'var(--kp-danger)', fill: 'currentColor', flex: 'none' }}
        />
        <span
          style={{
            fontSize: 'var(--kp-font-xs)',
            fontWeight: 'var(--kp-weight-medium)',
            color: 'var(--kp-navy)',
          }}
        >
          {lastWriteFailure.message}
        </span>
        <button
          type="button"
          data-testid="record-pill-write-error-dismiss"
          aria-label={t('meetings.pill.write-error-dismiss')}
          onClick={dismissWriteFailure}
          style={{
            display: 'flex',
            alignItems: 'center',
            border: 'none',
            background: 'transparent',
            color: 'var(--kp-navy)',
            cursor: 'pointer',
            padding: 4,
          }}
        >
          <X style={{ width: 14, height: 14 }} />
        </button>
      </div>
    );
  }

  if (!recording) {
    // Post-stop: transcription + notes are being written locally.
    return (
      <div data-testid="record-pill-processing" role="status" style={pillFrame}>
        <Loader2
          className="animate-spin"
          style={{ width: 16, height: 16, color: 'var(--kp-accent)' }}
        />
        <span
          style={{
            fontSize: 'var(--kp-font-xs)',
            fontWeight: 'var(--kp-weight-medium)',
            color: 'var(--kp-navy)',
          }}
        >
          {t('meetings.pill.processing')}
        </span>
      </div>
    );
  }

  return (
    <div data-testid="record-pill" role="status" style={pillFrame}>
      <Circle
        data-testid="record-pill-dot"
        className="animate-pulse"
        style={{ width: 10, height: 10, color: 'var(--kp-danger)', fill: 'currentColor', flex: 'none' }}
      />
      <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.3 }}>
        <span
          style={{
            fontSize: 'var(--kp-font-2xs)',
            fontWeight: 'var(--kp-weight-bold)',
            color: 'var(--kp-navy)',
          }}
        >
          {t('meetings.pill.recording-label')}
        </span>
        <span
          style={{
            fontSize: 'var(--kp-font-md)',
            fontWeight: 'var(--kp-weight-bold)',
            color: 'var(--kp-navy)',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {formatElapsed(elapsedMs)}
        </span>
        <span
          data-testid="record-pill-local"
          title={t('meetings.pill.local-tooltip')}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            fontSize: 'var(--kp-font-2xs)',
            color: 'var(--kp-success)',
            cursor: 'default',
          }}
        >
          <Check style={{ width: 11, height: 11 }} />
          {t('meetings.pill.local')}
        </span>
        {noticeCardPill && (
          <span
            data-testid="record-pill-notice-card"
            style={{
              fontSize: 'var(--kp-font-2xs)',
              color:
                noticeCardPill.tone === 'ok'
                  ? 'var(--kp-success)'
                  : noticeCardPill.tone === 'warn'
                    ? 'var(--kp-danger)'
                    : 'var(--color-muted-foreground)',
            }}
          >
            {noticeCardPill.kind === 'joining' && t('meetings.notice-card.pill-joining')}
            {noticeCardPill.kind === 'lobby' && t('meetings.notice-card.pill-lobby')}
            {noticeCardPill.kind === 'present' && t('meetings.notice-card.pill-present')}
            {noticeCardPill.kind === 'failed' && t('meetings.notice-card.pill-failed')}
            {noticeCardPill.kind === 'window-open-failed' && t('meetings.notice-card.pill-window-open-failed')}
          </span>
        )}
      </span>
      <button
        type="button"
        data-testid="record-pill-copy-chat"
        title={t('meetings.notice.pill-copy-chat')}
        aria-label={t('meetings.notice.pill-copy-chat')}
        onClick={handleCopyChatNotice}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          border: '1px solid var(--kp-divider)',
          background: 'transparent',
          color: 'var(--kp-navy)',
          borderRadius: 999,
          padding: '6px 10px',
          fontSize: 'var(--kp-font-2xs)',
          fontWeight: 'var(--kp-weight-medium)',
          cursor: 'pointer',
          fontFamily: 'inherit',
        }}
      >
        {chatCopied ? <Check style={{ width: 11, height: 11 }} /> : <Copy style={{ width: 11, height: 11 }} />}
        {chatCopied ? t('meetings.notice.copied') : t('meetings.notice.pill-copy-chat')}
      </button>
      <button
        type="button"
        data-testid="record-pill-stop"
        onClick={() => {
          void stopRecording();
        }}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          border: 'none',
          background: 'var(--kp-danger)',
          color: 'white',
          borderRadius: 999,
          padding: '7px 13px',
          fontSize: 'var(--kp-font-xs)',
          fontWeight: 'var(--kp-weight-semibold)',
          cursor: 'pointer',
          fontFamily: 'inherit',
        }}
      >
        <Square style={{ width: 10, height: 10, fill: 'currentColor' }} />
        {t('meetings.pill.stop')}
      </button>
    </div>
  );
}

export default RecordPill;
