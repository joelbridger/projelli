/**
 * Meeting-note template: turns a meeting transcript into notes.docx with
 * fixed sections and enforced [t:<startMs>] timestamp citations.
 *
 * Lives in the meetings feature (not templates/advisors/, where the plan
 * originally placed it as a "sibling" of MeetingPrepAndSuitabilityNotes.ts)
 * because it isn't a registered WorkflowTemplate: its prompt is built from a
 * live transcript object, not free-text interview answers, so it doesn't fit
 * the standard interview+generate WorkflowEngine flow (which only
 * interpolates a static promptTemplate against interview inputs). Keeping it
 * out of templates/advisors/ also keeps that pack's on-disk template count
 * (surfaced on the marketing homepage) accurate. meetingStore.ts calls
 * buildPrompt/run directly as part of the automatic stopRecording pipeline.
 */
import { sanitizeForPrompt } from '@/platform/utils/prompt-security';
import type { ProviderResponse, SendOptions } from '@/platform/providers/Provider';
import type { TranscriptFile } from '@/platform/types/meeting';

export const MEETING_NOTE_TEMPLATE_ID = 'meeting-note-from-transcript';

const SECTIONS = ['What changed', 'Decisions', 'Action items', 'Facts worth keeping'] as const;

export interface MeetingNotePromptInput {
  transcript: TranscriptFile;
  clientName: string;
}

function buildPrompt(input: MeetingNotePromptInput): string {
  const lines = input.transcript.segments
    .map((s) => `[t:${String(s.startMs)}] ${s.speaker}: ${sanitizeForPrompt(s.text)}`)
    .join('\n');
  return [
    `You are drafting a meeting note for the client "${sanitizeForPrompt(input.clientName)}".`,
    `Sections, in order: ${SECTIONS.join(' · ')}.`,
    `Every bullet MUST end with the [t:<ms>] token of the segment it came from.`,
    `Only state things supported by a transcript line. Transcript:`,
    lines,
  ].join('\n\n');
}

function enforceCitations(raw: string, transcript: TranscriptFile): string {
  const valid = new Set(transcript.segments.map((s) => `[t:${String(s.startMs)}]`));
  return raw
    .split('\n')
    .filter((line) => {
      const m = line.match(/\[t:\d+\]/g);
      if (!line.trim().startsWith('-')) return true; // headings pass through
      return m !== null && m.every((tok) => valid.has(tok));
    })
    .join('\n');
}

/**
 * Advisor-facing rendering of the citation tokens: `[t:135000]` -> `(at 2:15)`.
 * `run()`'s return keeps the raw tokens (the machine contract for a future
 * citation-chip notes pane); EVERY caller writing notes.docx for the advisor
 * to READ applies this first — raw ms tokens must never reach the page.
 *
 * `style: 'omit'` drops the marker entirely instead — for dictated notes,
 * whose pseudo-transcript is a single segment at 0ms, so "(at 0:00)" on
 * every bullet would be meaningless noise rather than a citation.
 */
export function formatCitationsForDisplay(
  markdown: string,
  style: 'timestamp' | 'omit' = 'timestamp'
): string {
  if (style === 'omit') return markdown.replace(/\s*\[t:\d+\]/g, '');
  return markdown.replace(/\s*\[t:(\d+)\]/g, (_m, ms: string) => {
    const total = Math.floor(Number(ms) / 1000);
    const min = Math.floor(total / 60);
    const sec = String(total % 60).padStart(2, '0');
    return ` (at ${String(min)}:${sec})`;
  });
}

export interface MeetingNoteRunInput extends MeetingNotePromptInput {
  send: (prompt: string, options: SendOptions) => Promise<ProviderResponse>;
  /** QA-31 — forwarded to sendMessage so meetingStore's notes-timeout
   *  watchdog (withMeetingNotesTimeout) can actually cancel a stalled call
   *  instead of just orphaning it. */
  signal?: AbortSignal;
}

/**
 * Runs the template against a live Provider and returns the cleaned
 * markdown body (sections + citation-enforced bullets). Caller (meetingStore)
 * writes the result to notes.docx via WorkflowEngine's markdownToDocxBytes
 * path — this module has no filesystem dependency.
 */
async function run(input: MeetingNoteRunInput): Promise<string> {
  const prompt = buildPrompt(input);
  const response = await input.send(prompt, {
    systemPrompt:
      'You are a financial advisory practice management assistant drafting a meeting note from a transcript. ' +
      'You never invent facts not present in the transcript, and every bullet ends with its [t:<ms>] citation token.',
    ...(input.signal ? { signal: input.signal } : {}),
  });
  return enforceCitations(response.content, input.transcript);
}

export const meetingNoteFromTranscript = {
  id: MEETING_NOTE_TEMPLATE_ID,
  sections: SECTIONS,
  buildPrompt,
  enforceCitations,
  run,
};

export default meetingNoteFromTranscript;
