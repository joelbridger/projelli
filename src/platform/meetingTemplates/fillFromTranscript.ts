import { sanitizeForPrompt } from '@/platform/utils/prompt-security';
import type { TranscriptFile } from '@/platform/types/meeting';
import {
  createClientFacingMeetingNote,
  createInternalMeetingNote,
  type ClientFacingMeetingNote,
  type FirmOwnedMeetingTemplate,
  type InternalMeetingNote,
  type MeetingTemplateSection,
} from './model';

export interface MeetingTemplateFillProvider {
  send(prompt: string, options: { systemPrompt: string; signal?: AbortSignal }): Promise<{ content: string }>;
}

export interface FillMeetingTemplateFromTranscriptInput {
  template: FirmOwnedMeetingTemplate;
  transcript: TranscriptFile;
  provider: MeetingTemplateFillProvider;
  signal?: AbortSignal;
}

export type FilledMeetingTemplate = InternalMeetingNote | ClientFacingMeetingNote;

/**
 * Fills exactly one firm-owned layout from one transcript. The output lane is
 * chosen from the persisted template audience before any model text is parsed;
 * there is no internal-to-client transformation branch.
 */
export async function fillMeetingTemplateFromTranscript(
  input: FillMeetingTemplateFromTranscriptInput,
): Promise<FilledMeetingTemplate> {
  const response = await input.provider.send(buildMeetingTemplatePrompt(input.template, input.transcript), {
    systemPrompt: systemPromptFor(input.template.audience),
    ...(input.signal ? { signal: input.signal } : {}),
  });
  const sections = parseTemplateSections(response.content, input.template, input.transcript);

  if (input.template.audience === 'internal') {
    return createInternalMeetingNote(input.template, sections);
  }
  return createClientFacingMeetingNote(input.template, sections);
}

export function buildMeetingTemplatePrompt(
  template: FirmOwnedMeetingTemplate,
  transcript: TranscriptFile,
): string {
  const layout = template.blocks.map((block) => ({
    id: block.id,
    label: sanitizeForPrompt(block.label),
    instruction: sanitizeForPrompt(block.instruction),
    required: block.required,
  }));
  const transcriptLines = transcript.segments.map((segment) => ({
    timestampMs: segment.startMs,
    speaker: sanitizeForPrompt(segment.speaker),
    text: sanitizeForPrompt(segment.text),
  }));

  return JSON.stringify({
    task: 'Fill this meeting-note layout from the supplied transcript.',
    audience: template.audience,
    outputContract: {
      sections: [{ id: 'layout-block-id', body: 'grounded prose', citations: [12345] }],
      noAdditionalFields: true,
    },
    layout,
    transcript: transcriptLines,
  });
}

function systemPromptFor(audience: FirmOwnedMeetingTemplate['audience']): string {
  const laneInstruction = audience === 'internal'
    ? 'This is an internal advisor-only note. Keep it inside the internal layout.'
    : 'This is a client-facing note. Write only clear, client-appropriate content.';
  return [
    'You are filling a meeting-note template from a transcript.',
    laneInstruction,
    'Use only supported transcript facts. Return JSON only, matching outputContract exactly.',
    'Every citation must be a timestampMs value from the supplied transcript.',
  ].join(' ');
}

function parseTemplateSections(
  content: string,
  template: FirmOwnedMeetingTemplate,
  transcript: TranscriptFile,
): MeetingTemplateSection[] {
  const parsed = parseJsonObject(content);
  const rawSections = parsed.sections;
  if (!Array.isArray(rawSections)) throw new Error('Meeting-template output must include a sections array.');

  const blocks = new Map(template.blocks.map((block) => [block.id, block]));
  const transcriptTimestamps = new Set(transcript.segments.map((segment) => segment.startMs));
  const seen = new Set<string>();
  const sections: MeetingTemplateSection[] = [];

  for (const raw of rawSections) {
    if (!raw || typeof raw !== 'object') throw new Error('Meeting-template section must be an object.');
    const section = raw as { id?: unknown; body?: unknown; citations?: unknown };
    if (typeof section.id !== 'string' || typeof section.body !== 'string' || !Array.isArray(section.citations)) {
      throw new Error('Meeting-template section has an invalid shape.');
    }
    const block = blocks.get(section.id);
    if (!block || seen.has(section.id)) {
      throw new Error('Meeting-template output used an unknown or duplicate layout block.');
    }
    const citations = section.citations.map((citation) => {
      if (!Number.isSafeInteger(citation) || !transcriptTimestamps.has(citation)) {
        throw new Error('Meeting-template output used a citation outside the transcript.');
      }
      return citation;
    });
    seen.add(section.id);
    sections.push({ blockId: block.id, label: block.label, body: section.body.trim(), citations });
  }

  for (const block of template.blocks) {
    if (block.required && !seen.has(block.id)) {
      throw new Error(`Meeting-template output omitted required block "${block.id}".`);
    }
  }
  return sections;
}

function parseJsonObject(content: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(content.trim().replace(/^```json\s*|\s*```$/g, ''));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Meeting-template output must be a JSON object.');
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof Error && error.message.includes('Meeting-template output')) throw error;
    throw new Error('Meeting-template output was not valid JSON.');
  }
}
