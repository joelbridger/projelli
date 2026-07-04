// Wave 4 Track A UI: run diarization on a recorded meeting, auto-suggest names
// from stored voiceprints, let the advisor label/relabel, and write the names
// back into transcript.json. DEPENDS-WAVE-3: mounted by MeetingEntry.tsx once
// Wave 3's transcript viewer exists on this branch (TODO(wave-3-merge) in
// LANTERN-PLUS.md) — the component itself is self-contained and testable now.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Users } from 'lucide-react';
import { Button, Callout } from '@/ui/kp';
import { AuditService } from '@/platform/audit/AuditService';
import {
  diarizeMeeting, applySpeakerNames, voiceprintMatch, voiceprintEnroll, voiceprintConfirm,
  type DiarizedSpeakerWire, type VoiceprintMatch,
} from '@/platform/utils/tauri-commands';

const audit = new AuditService('meetings');

interface SpeakerRow {
  speaker: DiarizedSpeakerWire;
  suggestion: VoiceprintMatch | null;
  name: string;
}

export function SpeakerNamesPanel({ meetingDir, matterId, workspaceRoot, onApplied }: {
  meetingDir: string; matterId: string; workspaceRoot: string; onApplied?: () => void;
}) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<SpeakerRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy(true); setError(null);
    try {
      const result = await diarizeMeeting(workspaceRoot, meetingDir);
      const next: SpeakerRow[] = [];
      for (const speaker of result.speakers) {
        const suggestion = await voiceprintMatch(workspaceRoot, matterId, speaker.centroid);
        next.push({ speaker, suggestion, name: suggestion?.name ?? '' });
      }
      setRows(next);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    if (!rows) return;
    setBusy(true); setError(null);
    try {
      const renames: Record<string, string> = {};
      for (const r of rows) {
        const name = r.name.trim();
        if (!name) continue;
        renames[r.speaker.label] = name;
        if (r.suggestion && r.suggestion.name === name) {
          await voiceprintConfirm(workspaceRoot, matterId, r.suggestion.id, r.speaker.centroid);
        } else {
          await voiceprintEnroll(workspaceRoot, matterId, name, r.speaker.centroid);
        }
        // Audit each enrollment/confirmation (biometric data handling is logged).
        void audit.logDurable('voiceprint_enrolled', `Voice profile saved for ${name}`, {
          metadata: { matterId, meetingDir },
        });
      }
      if (Object.keys(renames).length > 0) await applySpeakerNames(workspaceRoot, meetingDir, renames);
      setDone(true);
      onApplied?.();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-testid="speaker-names-panel" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <span className="kp-eyebrow" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <Users size={13} aria-hidden /> {t('meetings.speakers.title')}
      </span>
      {rows === null ? (
        // secondary + hugging width: a helper utility, never the loudest
        // element on the meeting page (UX review S10)
        <Button data-testid="diarize-run" variant="secondary" disabled={busy} onClick={() => { void run(); }} style={{ alignSelf: 'flex-start' }}>
          {busy ? t('meetings.speakers.running') : t('meetings.speakers.run')}
        </Button>
      ) : (
        <>
          {rows.map((r, i) => (
            <div key={r.speaker.label} data-testid={`speaker-row-${r.speaker.label}`}
              style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 13, fontWeight: 600, minWidth: 84 }}>{r.speaker.label}</span>
              <span style={{ fontSize: 11.5, color: 'var(--kp-text-muted, #6b7280)' }}>
                {t('meetings.speakers.stats', { turns: r.speaker.turnCount, minutes: Math.max(1, Math.round(r.speaker.totalMs / 60000)) })}
              </span>
              <input data-testid={`speaker-name-${r.speaker.label}`} type="text" value={r.name}
                placeholder={t('meetings.speakers.name-placeholder')}
                onChange={(e) => { setRows((prev) => prev?.map((p, j) => (j === i ? { ...p, name: e.target.value } : p)) ?? null); }}
                style={{ flex: 1, fontSize: 13, padding: '6px 10px', border: '1px solid var(--kp-divider-strong, #d1d5db)', borderRadius: 6 }} />
              {r.suggestion && (
                <span style={{ fontSize: 11.5, color: 'var(--kp-accent, #1e3a5f)' }}>
                  {t('meetings.speakers.suggested', { name: r.suggestion.name, pct: Math.round(r.suggestion.confidence * 100) })}
                </span>
              )}
            </div>
          ))}
          <Button data-testid="speakers-apply" disabled={busy} onClick={() => { void apply(); }} style={{ alignSelf: 'flex-start' }}>
            {t('meetings.speakers.apply')}
          </Button>
        </>
      )}
      {done && <Callout>{t('meetings.speakers.applied')}</Callout>}
      {error && <Callout variant="warning">{error}</Callout>}
      <p style={{ fontSize: 11.5, color: 'var(--kp-text-muted, #6b7280)', margin: 0 }}>{t('meetings.speakers.privacy-note')}</p>
    </div>
  );
}
