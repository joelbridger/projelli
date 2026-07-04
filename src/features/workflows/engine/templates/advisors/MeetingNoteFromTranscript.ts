/**
 * Meeting-note template: turns a meeting transcript into notes.docx with
 * fixed sections and enforced [t:<startMs>] timestamp citations.
 *
 * Unlike the interview+generate templates in this pack, this template's
 * prompt is built from a live transcript object, not free-text interview
 * answers — so it is not registered in ADVISOR_TEMPLATES/index.ts (the
 * standard WorkflowEngine only interpolates a static promptTemplate against
 * interview inputs). meetingStore.ts (Task 12) calls buildPrompt/run
 * directly as part of the automatic stopRecording pipeline.
 */
import { sanitizeForPrompt } from '@/platform/utils/prompt-security';
import type { Provider } from '@/platform/providers/Provider';
import type { TranscriptFile } from '@/platform/types/meeting';

export const MEETING_NOTE_TEMPLATE_ID = 'meeting-note-from-transcript';

const SECTIONS = ['What changed', 'Decisions', 'Action items', 'Facts worth keeping'] as const;

export interface MeetingNotePromptInput {
  transcript: TranscriptFile;
  clientName: string;
}

function buildPrompt(input: MeetingNotePromptInput): string {
  const lines = input.transcript.segments
    .map((s) => `[t:${s.startMs}] ${s.speaker}: ${sanitizeForPrompt(s.text)}`)
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
  const valid = new Set(transcript.segments.map((s) => `[t:${s.startMs}]`));
  return raw
    .split('\n')
    .filter((line) => {
      const m = line.match(/\[t:\d+\]/g);
      if (!line.trim().startsWith('-')) return true; // headings pass through
      return m !== null && m.every((tok) => valid.has(tok));
    })
    .join('\n');
}

export interface MeetingNoteRunInput extends MeetingNotePromptInput {
  provider: Provider;
}

/**
 * Runs the template against a live Provider and returns the cleaned
 * markdown body (sections + citation-enforced bullets). Caller (meetingStore)
 * writes the result to notes.docx via WorkflowEngine's markdownToDocxBytes
 * path — this module has no filesystem dependency.
 */
async function run(input: MeetingNoteRunInput): Promise<string> {
  const prompt = buildPrompt(input);
  const response = await input.provider.sendMessage(prompt, {
    systemPrompt:
      'You are a financial advisory practice management assistant drafting a meeting note from a transcript. ' +
      'You never invent facts not present in the transcript, and every bullet ends with its [t:<ms>] citation token.',
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
