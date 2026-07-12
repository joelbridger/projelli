/**
 * Firm meeting-note templates are deliberately split into two lanes.
 *
 * An internal note may contain supervision observations and working analysis.
 * A client-facing note is a separate, capability-backed value. There is no
 * conversion from the internal lane to the client-facing lane.
 */

export const MEETING_TEMPLATE_SCHEMA_VERSION = 1 as const;

export type MeetingTemplateAudience = 'internal' | 'client-facing';

export interface MeetingTemplateBlock {
  id: string;
  label: string;
  instruction: string;
  required: boolean;
}

interface FirmOwnedMeetingTemplateBase {
  /** Kept broad so persisted, untrusted values are validated at this boundary. */
  schemaVersion: number;
  id: string;
  firmId: string;
  name: string;
  blocks: readonly MeetingTemplateBlock[];
  version: number;
  createdAt: string;
  updatedAt: string;
}

export type InternalFirmOwnedMeetingTemplate = FirmOwnedMeetingTemplateBase & {
  audience: 'internal';
};

export type ClientFacingFirmOwnedMeetingTemplate = FirmOwnedMeetingTemplateBase & {
  audience: 'client-facing';
};

/**
 * The persisted template itself carries its lane. Keeping this as a
 * discriminated union makes a caller prove the lane before it can create a
 * note in that lane.
 */
export type FirmOwnedMeetingTemplate =
  | InternalFirmOwnedMeetingTemplate
  | ClientFacingFirmOwnedMeetingTemplate;

export interface CreateMeetingTemplateInput {
  id: string;
  firmId: string;
  name: string;
  audience: MeetingTemplateAudience;
  blocks: readonly MeetingTemplateBlock[];
  now?: string;
}

export interface MeetingTemplateSection {
  blockId: string;
  label: string;
  body: string;
  citations: readonly number[];
}

export interface InternalMeetingNote {
  readonly audience: 'internal';
  readonly templateId: string;
  readonly templateVersion: number;
  readonly sections: readonly MeetingTemplateSection[];
}

const CLIENT_FACING_NOTE_CAPABILITY = Symbol('client-facing-meeting-note');
const clientFacingNotes = new WeakSet();

/**
 * This symbol is intentionally private. Consumers cannot construct this type
 * with an object literal, and the renderer also checks the private WeakSet at
 * runtime. That protects against both accidental widening and an `as` cast.
 */
export interface ClientFacingMeetingNote {
  readonly audience: 'client-facing';
  readonly templateId: string;
  readonly templateVersion: number;
  readonly sections: readonly MeetingTemplateSection[];
  readonly [CLIENT_FACING_NOTE_CAPABILITY]: true;
}

export interface RenderedClientFacingMeetingNote {
  title: string;
  sections: readonly {
    heading: string;
    body: string;
    citations: readonly number[];
  }[];
}

export function createFirmOwnedMeetingTemplate(
  input: CreateMeetingTemplateInput,
): FirmOwnedMeetingTemplate {
  const now = input.now ?? new Date().toISOString();
  const base = {
    schemaVersion: MEETING_TEMPLATE_SCHEMA_VERSION,
    id: input.id,
    firmId: input.firmId,
    name: input.name,
    blocks: input.blocks.map((block) => ({ ...block })),
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
  const template: FirmOwnedMeetingTemplate = input.audience === 'internal'
    ? { ...base, audience: 'internal' }
    : { ...base, audience: 'client-facing' };
  assertValidFirmOwnedMeetingTemplate(template);
  return template;
}

export function isInternalFirmOwnedMeetingTemplate(
  template: FirmOwnedMeetingTemplate,
): template is InternalFirmOwnedMeetingTemplate {
  return template.audience === 'internal';
}

export function isClientFacingFirmOwnedMeetingTemplate(
  template: FirmOwnedMeetingTemplate,
): template is ClientFacingFirmOwnedMeetingTemplate {
  return template.audience === 'client-facing';
}

export function assertValidFirmOwnedMeetingTemplate(
  template: FirmOwnedMeetingTemplate,
): void {
  if (template.schemaVersion !== MEETING_TEMPLATE_SCHEMA_VERSION) {
    throw new Error('Unsupported meeting-template schema version.');
  }
  for (const [name, value] of Object.entries({
    id: template.id,
    firmId: template.firmId,
    name: template.name,
    createdAt: template.createdAt,
    updatedAt: template.updatedAt,
  })) {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new Error(`Meeting template ${name} must be a non-empty string.`);
    }
  }
  if (!Number.isSafeInteger(template.version) || template.version < 1) {
    throw new Error('Meeting template version must be a positive integer.');
  }
  if (template.blocks.length === 0) {
    throw new Error('A meeting template needs at least one layout block.');
  }

  const ids = new Set<string>();
  for (const block of template.blocks) {
    if (!block.id.trim() || !block.label.trim() || !block.instruction.trim()) {
      throw new Error('Each meeting-template block needs an id, label, and instruction.');
    }
    if (ids.has(block.id)) {
      throw new Error(`Meeting-template block id "${block.id}" is duplicated.`);
    }
    ids.add(block.id);
  }
}

export function createInternalMeetingNote(
  template: InternalFirmOwnedMeetingTemplate,
  sections: readonly MeetingTemplateSection[],
): InternalMeetingNote {
  return Object.freeze({
    audience: 'internal',
    templateId: template.id,
    templateVersion: template.version,
    sections: freezeSections(sections),
  });
}

export function createClientFacingMeetingNote(
  template: ClientFacingFirmOwnedMeetingTemplate,
  sections: readonly MeetingTemplateSection[],
): ClientFacingMeetingNote {
  const clientFacingCapability = true as const;
  const note: ClientFacingMeetingNote = Object.freeze({
    audience: 'client-facing',
    templateId: template.id,
    templateVersion: template.version,
    sections: freezeSections(sections),
    [CLIENT_FACING_NOTE_CAPABILITY]: clientFacingCapability,
  });
  clientFacingNotes.add(note);
  return note;
}

/**
 * The only public client-render entry point. It accepts no internal-note
 * union, conversion callback, or raw transcript. An internal value cannot
 * satisfy this type, and a forged value fails the private capability check.
 */
export function renderClientFacingMeetingNote(
  note: ClientFacingMeetingNote,
  title: string,
): RenderedClientFacingMeetingNote {
  if (!clientFacingNotes.has(note)) {
    throw new Error('Refused to render a meeting note without client-facing capability.');
  }
  return {
    title,
    sections: note.sections.map((section) => ({
      heading: section.label,
      body: section.body,
      citations: [...section.citations],
    })),
  };
}

function freezeSections(sections: readonly MeetingTemplateSection[]): readonly MeetingTemplateSection[] {
  return Object.freeze(sections.map((section) => Object.freeze({
    blockId: section.blockId,
    label: section.label,
    body: section.body,
    citations: Object.freeze([...section.citations]),
  })));
}
