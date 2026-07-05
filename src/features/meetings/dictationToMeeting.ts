/**
 * Task 10b — dictation voice notes get the meeting-note treatment by REUSING
 * this wave's pipeline. A voice note's already-transcribed text becomes a
 * single-segment pseudo-transcript, runs through the same Task 10 template,
 * and files into a meeting folder WITHOUT audio (no re-transcription, no
 * capture engine involved).
 */
import type { TranscriptFile } from '@/platform/types/meeting';
import type { WorkspaceService } from '@/platform/fs/WorkspaceService';
import { meetingNoteFromTranscript, formatCitationsForDisplay } from './meetingNoteTemplate';
import { matterLabel } from '@/platform/rag/matterResolver';
import { useMatterStore } from '@/platform/matter/matterStore';
import type { Provider } from '@/platform/providers/Provider';
import { buildResolvedProviderForGlance } from '@/platform/matter/matterAtAGlance';

/** The one-segment pseudo-transcript a dictated note becomes — citations are
 *  all `[t:0]`, which is acceptable since there's only ever one source. */
export function buildPseudoTranscript(noteText: string, matterId: string, recordedAt: string): TranscriptFile {
  return {
    segments: [{ startMs: 0, endMs: 0, channel: 'mic', speaker: 'You', text: noteText }],
    meta: {
      startedAt: recordedAt,
      durationMs: 0,
      matterId,
      consent: { mode: 'one-party', confirmedBy: 'user', confirmedAt: recordedAt },
      dictation: true,
    },
  };
}

/** The meeting-folder write set for a dictated note — no audio.wav, since
 *  there was never a recording (Task 15's retention sweep must treat a
 *  folder with this set, and no `.capture/` dir, as valid). */
export function dictationMeetingWriteSet(): string[] {
  return ['transcript.json', 'notes.docx'];
}

export interface DictationMeetingFolder {
  meetingDir: string;
}

/**
 * Files a dictated voice note as a meeting note: writes transcript.json +
 * meeting.json (dictation: true) + notes.docx into a fresh dated folder
 * under `<matterFolder>/Meetings/`, then returns the folder. Never writes
 * audio.wav. Mirrors meetingStore's stopRecording write shape so the result
 * is indistinguishable from a real meeting on the Meetings tab (besides the
 * "Dictated" label the UI derives from `meeting.json.dictation`).
 */
export async function dictationToMeeting(
  ws: WorkspaceService,
  noteText: string,
  matterId: string,
  matterFolder: string,
  recordedAt: string,
  resolveProvider: () => Promise<{ provider: Provider }> = buildResolvedProviderForGlance,
): Promise<DictationMeetingFolder> {
  const transcript = buildPseudoTranscript(noteText, matterId, recordedAt);
  const folderName = `${recordedAt.slice(0, 10)}-dictated-${String(Date.parse(recordedAt) || 0)}`;
  const meetingDir = `${matterFolder}/Meetings/${folderName}`;

  await ws.writeFile(`${meetingDir}/transcript.json`, JSON.stringify(transcript, null, 2));

  const matter = useMatterStore.getState().matters.find((m) => m.id === matterId);
  const clientName = matter ? matterLabel(matter) : matterId;
  try {
    const { provider } = await resolveProvider();
    const markdown = await meetingNoteFromTranscript.run({ transcript, clientName, provider });
    const { markdownToDocxBytes, applyLetterheadIfConfigured } = await import('@/platform/utils/docx-io');
    // Same advisor-facing invariant as meetingStore's recording path: raw
    // [t:ms] tokens never reach notes.docx. 'omit' (not a timestamp) because
    // the pseudo-transcript is one segment at 0ms — "(at 0:00)" on every
    // bullet would be noise, not a citation.
    const bytes = await markdownToDocxBytes(formatCitationsForDisplay(markdown, 'omit'), 'notes.docx');
    const finalBytes = await applyLetterheadIfConfigured(bytes);
    await ws.writeFileBinary(`${meetingDir}/notes.docx`, finalBytes);
  } catch {
    // Queued — the meeting still files without notes if no provider is configured.
  }

  await ws.writeFile(
    `${meetingDir}/meeting.json`,
    JSON.stringify(
      {
        matterId,
        startedAt: recordedAt,
        consent: transcript.meta.consent,
        dictation: true,
      },
      null,
      2,
    ),
  );

  return { meetingDir };
}
