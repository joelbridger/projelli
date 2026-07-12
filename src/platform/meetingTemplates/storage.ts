import {
  assertValidFirmOwnedMeetingTemplate,
  type FirmOwnedMeetingTemplate,
} from './model';

const STORAGE_PATH = '.lantern/meeting-templates.json';

interface StoredMeetingTemplates {
  schemaVersion: 1;
  templates: FirmOwnedMeetingTemplate[];
}

export interface MeetingTemplateStorageBackend {
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  /** WorkspaceService wraps a missing-file error, so callers that can cheaply
   * check first may provide this and keep real read failures visible. */
  exists?(path: string): Promise<boolean>;
}

export function makeMeetingTemplateStorage(backend: MeetingTemplateStorageBackend) {
  async function listForFirm(firmId: string): Promise<FirmOwnedMeetingTemplate[]> {
    if (!firmId.trim()) throw new Error('A firm id is required to load meeting templates.');
    const stored = await load();
    return stored.templates
      .filter((template) => template.firmId === firmId)
      .map(cloneTemplate);
  }

  /**
   * A template keeps its owner and lane forever. Moving a layout between
   * internal and client-facing is a new-template operation, never an update.
   */
  async function save(template: FirmOwnedMeetingTemplate): Promise<FirmOwnedMeetingTemplate> {
    assertValidFirmOwnedMeetingTemplate(template);
    const stored = await load();
    const existingIndex = stored.templates.findIndex((item) => item.id === template.id);
    const copy = cloneTemplate(template);

    if (existingIndex >= 0) {
      const existing = stored.templates[existingIndex];
      if (!existing) throw new Error('Meeting template storage changed while saving.');
      if (existing.firmId !== copy.firmId) {
        throw new Error('A meeting template cannot move between firms.');
      }
      if (existing.audience !== copy.audience) {
        throw new Error('A meeting template cannot move between internal and client-facing lanes.');
      }
      if (copy.version <= existing.version) {
        throw new Error('A meeting template update must increase its version.');
      }
      stored.templates[existingIndex] = copy;
    } else {
      stored.templates.push(copy);
    }

    await persist(stored);
    return cloneTemplate(copy);
  }

  async function remove(firmId: string, templateId: string): Promise<void> {
    const stored = await load();
    const index = stored.templates.findIndex(
      (template) => template.id === templateId && template.firmId === firmId,
    );
    if (index < 0) return;
    stored.templates.splice(index, 1);
    await persist(stored);
  }

  async function load(): Promise<StoredMeetingTemplates> {
    try {
      if (backend.exists && !(await backend.exists(STORAGE_PATH))) {
        return { schemaVersion: 1, templates: [] };
      }
      const raw = await backend.readFile(STORAGE_PATH);
      const parsed: unknown = JSON.parse(raw);
      if (!isStoredMeetingTemplates(parsed)) {
        throw new Error('Meeting-template storage has an invalid shape.');
      }
      for (const template of parsed.templates) assertValidFirmOwnedMeetingTemplate(template);
      return { schemaVersion: 1, templates: parsed.templates.map(cloneTemplate) };
    } catch (error) {
      if (isMissingStorageError(error)) return { schemaVersion: 1, templates: [] };
      throw error;
    }
  }

  async function persist(stored: StoredMeetingTemplates): Promise<void> {
    await backend.writeFile(STORAGE_PATH, JSON.stringify(stored, null, 2));
  }

  return { listForFirm, save, remove };
}

function isStoredMeetingTemplates(value: unknown): value is StoredMeetingTemplates {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as { schemaVersion?: unknown; templates?: unknown };
  return candidate.schemaVersion === 1 && Array.isArray(candidate.templates);
}

function isMissingStorageError(error: unknown): boolean {
  return error instanceof Error && /not found|enoent|does not exist/i.test(error.message);
}

function cloneTemplate(template: FirmOwnedMeetingTemplate): FirmOwnedMeetingTemplate {
  return {
    ...template,
    blocks: template.blocks.map((block) => ({ ...block })),
  };
}
