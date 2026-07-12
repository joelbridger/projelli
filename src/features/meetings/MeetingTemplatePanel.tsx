/**
 * MeetingTemplatePanel — the advisor-only meeting-template workflow.
 *
 * Templates are firm-owned layouts stored in the workspace. A filled internal
 * note never enters the client-facing renderer or a client-facing save path.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FilePlus2, Pencil, Plus, Sparkles } from 'lucide-react';
import { Button, Badge } from '@/ui/kp';
import type { TranscriptFile } from '@/platform/types/meeting';
import {
  createFirmOwnedMeetingTemplate,
  fillMeetingTemplateFromTranscript,
  makeMeetingTemplateStorage,
  renderClientFacingMeetingNote,
  type FilledMeetingTemplate,
  type FirmOwnedMeetingTemplate,
  type MeetingTemplateAudience,
  type MeetingTemplateBlock,
  type MeetingTemplateFillProvider,
  type MeetingTemplateStorageBackend,
} from '@/platform/meetingTemplates';

const SAVED_NOTES_PATH = 'template-notes.json';

type DraftBlock = MeetingTemplateBlock;

interface SavedTemplateNotes {
  schemaVersion: 1;
  internal: Record<string, { templateVersion: number; sections: unknown[] }>;
  clientFacing: Record<
    string,
    { templateVersion: number; title: string; sections: unknown[] }
  >;
}

export interface MeetingTemplatePanelProps {
  workspace: MeetingTemplateStorageBackend;
  firmId: string | null;
  canManageTemplates: boolean;
  meetingDir: string;
  transcript: TranscriptFile;
  clientName: string;
  getProvider: () => Promise<MeetingTemplateFillProvider>;
}

function makeBlock(index: number): DraftBlock {
  return {
    id: `section-${String(index + 1)}`,
    label: '',
    instruction: '',
    required: true,
  };
}

function emptyNotes(): SavedTemplateNotes {
  return { schemaVersion: 1, internal: {}, clientFacing: {} };
}

/** Read saved template results without treating a bad/missing note file as a
 * template or as client-visible data. */
async function loadSavedNotes(
  workspace: MeetingTemplateStorageBackend,
  meetingDir: string
): Promise<SavedTemplateNotes> {
  const path = `${meetingDir}/${SAVED_NOTES_PATH}`;
  if (workspace.exists && !(await workspace.exists(path))) return emptyNotes();
  try {
    const parsed: unknown = JSON.parse(await workspace.readFile(path));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      return emptyNotes();
    const value = parsed as Partial<SavedTemplateNotes>;
    if (value.schemaVersion !== 1 || !value.internal || !value.clientFacing)
      return emptyNotes();
    return value as SavedTemplateNotes;
  } catch {
    return emptyNotes();
  }
}

export function MeetingTemplatePanel({
  workspace,
  firmId,
  canManageTemplates,
  meetingDir,
  transcript,
  clientName,
  getProvider,
}: MeetingTemplatePanelProps) {
  const { t } = useTranslation();
  const storage = useMemo(
    () => makeMeetingTemplateStorage(workspace),
    [workspace]
  );
  const [templates, setTemplates] = useState<FirmOwnedMeetingTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<{
    id: string | null;
    name: string;
    audience: MeetingTemplateAudience;
    blocks: DraftBlock[];
  }>({
    id: null,
    name: '',
    audience: 'internal',
    blocks: [makeBlock(0)],
  });
  const [showEditor, setShowEditor] = useState(false);
  const [selectedId, setSelectedId] = useState<string>('');
  const [draft, setDraft] = useState<{
    template: FirmOwnedMeetingTemplate;
    note: FilledMeetingTemplate;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const selectedTemplate = templates.find((template) => template.id === selectedId);

  const showUnexpectedError = useCallback((cause: unknown) => {
    setError(cause instanceof Error ? cause.message : 'Could not complete that meeting-template action.');
  }, []);

  const audienceLabel = (audience: MeetingTemplateAudience): string =>
    audience === 'internal'
      ? t('meetings.templates.audience-internal')
      : t('meetings.templates.audience-client-facing');

  const loadTemplates = useCallback(async () => {
    if (!firmId) {
      setTemplates([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const loaded = await storage.listForFirm(firmId);
      setTemplates(loaded);
      setSelectedId((current) => current || loaded[0]?.id || '');
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not load meeting templates.'
      );
    } finally {
      setLoading(false);
    }
  }, [firmId, storage]);

  useEffect(() => {
    void loadTemplates().catch(showUnexpectedError);
  }, [loadTemplates, showUnexpectedError]);

  const resetEditor = () => {
    setForm({
      id: null,
      name: '',
      audience: 'internal',
      blocks: [makeBlock(0)],
    });
    setShowEditor(false);
  };

  const editTemplate = (template: FirmOwnedMeetingTemplate) => {
    setForm({
      id: template.id,
      name: template.name,
      audience: template.audience,
      blocks: template.blocks.map((block) => ({ ...block })),
    });
    setShowEditor(true);
    setError(null);
  };

  const saveTemplate = async () => {
    if (!firmId) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const name = form.name.trim();
      const blocks = form.blocks.map((block) => ({
        ...block,
        id: block.id.trim(),
        label: block.label.trim(),
        instruction: block.instruction.trim(),
      }));
      const existing = form.id
        ? templates.find((template) => template.id === form.id)
        : undefined;
      const next = existing
        ? {
            ...existing,
            name,
            blocks,
            version: existing.version + 1,
            updatedAt: new Date().toISOString(),
          }
        : createFirmOwnedMeetingTemplate({
            id: crypto.randomUUID(),
            firmId,
            name,
            audience: form.audience,
            blocks,
          });
      await storage.save(next);
      setNotice(existing ? 'Template updated.' : 'Template created.');
      resetEditor();
      await loadTemplates();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Could not save this template.'
      );
    } finally {
      setBusy(false);
    }
  };

  const fillTemplate = async () => {
    const template = templates.find((item) => item.id === selectedId);
    if (!template) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const provider = await getProvider();
      const note = await fillMeetingTemplateFromTranscript({
        template,
        transcript,
        provider,
      });
      setDraft({ template, note });
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not fill this template from the transcript.'
      );
    } finally {
      setBusy(false);
    }
  };

  const saveReviewedNote = async () => {
    if (!draft) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const saved = await loadSavedNotes(workspace, meetingDir);
      if (draft.note.audience === 'internal') {
        // This is deliberately a separate branch from the client renderer.
        saved.internal[draft.template.id] = {
          templateVersion: draft.note.templateVersion,
          sections: [...draft.note.sections],
        };
      } else {
        // The only client-facing save starts with the capability-protected
        // value returned by the client-facing template engine.
        const rendered = renderClientFacingMeetingNote(
          draft.note,
          `${clientName} meeting recap`
        );
        saved.clientFacing[draft.template.id] = {
          templateVersion: draft.note.templateVersion,
          title: rendered.title,
          sections: [...rendered.sections],
        };
      }
      await workspace.writeFile(
        `${meetingDir}/${SAVED_NOTES_PATH}`,
        JSON.stringify(saved, null, 2)
      );
      setNotice(
        draft.note.audience === 'internal'
          ? 'Internal note saved.'
          : 'Client-facing note saved for review.'
      );
      setDraft(null);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Could not save this note.'
      );
    } finally {
      setBusy(false);
    }
  };

  if (!firmId) return null;

  return (
    <section
      data-testid="meeting-template-panel"
      style={{
        display: 'grid',
        gap: 12,
        borderTop: '1px solid var(--kp-divider)',
        paddingTop: 16,
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <div>
          <div
            style={{
              color: 'var(--kp-navy)',
              fontSize: 'var(--kp-font-sm)',
              fontWeight: 'var(--kp-weight-semibold)',
            }}
          >
            {t('meetings.templates.title')}
          </div>
          <div
            style={{
              color: 'var(--color-muted-foreground)',
              fontSize: 'var(--kp-font-xs)',
              marginTop: 2,
            }}
          >
            {t('meetings.templates.description')}
          </div>
        </div>
        {canManageTemplates && !showEditor && (
          <Button
            data-testid="meeting-template-create"
            size="sm"
            variant="secondary"
            iconLeft={Plus}
            onClick={() => {
              setShowEditor(true);
              setError(null);
            }}
          >
            New template
          </Button>
        )}
      </div>

      {showEditor && (
        <div
          data-testid="meeting-template-editor"
          style={{
            display: 'grid',
            gap: 10,
            border: '1px solid var(--kp-divider)',
            borderRadius: 'var(--radius-md)',
            padding: 12,
          }}
        >
          <label
            style={{ display: 'grid', gap: 4, fontSize: 'var(--kp-font-xs)' }}
          >
            Template name
            <input
              data-testid="meeting-template-name"
              value={form.name}
              onChange={(event) => {
                setForm((current) => ({ ...current, name: event.target.value }));
              }}
            />
          </label>
          <label
            style={{ display: 'grid', gap: 4, fontSize: 'var(--kp-font-xs)' }}
          >
            Audience
            <select
              data-testid="meeting-template-audience"
              disabled={Boolean(form.id)}
              value={form.audience}
              onChange={(event) => {
                setForm((current) => ({
                  ...current,
                  audience: event.target.value as MeetingTemplateAudience,
                }));
              }}
            >
              <option value="internal">{audienceLabel('internal')}</option>
              <option value="client-facing">{audienceLabel('client-facing')}</option>
            </select>
          </label>
          {form.blocks.map((block, index) => (
            <div
              key={block.id}
              data-testid={`meeting-template-block-${block.id}`}
              style={{ display: 'grid', gap: 4, paddingTop: 6 }}
            >
              <input
                aria-label={`Section ${String(index + 1)} label`}
                data-testid={`meeting-template-block-label-${block.id}`}
                placeholder="Section title"
                value={block.label}
                onChange={(event) => {
                  setForm((current) => ({
                    ...current,
                    blocks: current.blocks.map((item, i) =>
                      i === index
                        ? { ...item, label: event.target.value }
                        : item
                    ),
                  }));
                }}
              />
              <input
                aria-label={`Section ${String(index + 1)} instruction`}
                data-testid={`meeting-template-block-instruction-${block.id}`}
                placeholder="What should this section cover?"
                value={block.instruction}
                onChange={(event) => {
                  setForm((current) => ({
                    ...current,
                    blocks: current.blocks.map((item, i) =>
                      i === index
                        ? { ...item, instruction: event.target.value }
                        : item
                    ),
                  }));
                }}
              />
              <label style={{ fontSize: 'var(--kp-font-xs)' }}>
                <input
                  type="checkbox"
                  checked={block.required}
                  onChange={(event) => {
                    setForm((current) => ({
                      ...current,
                      blocks: current.blocks.map((item, i) =>
                        i === index
                          ? { ...item, required: event.target.checked }
                          : item
                      ),
                    }));
                  }}
                />{' '}
                Required
              </label>
            </div>
          ))}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button
              data-testid="meeting-template-add-block"
              size="sm"
              variant="ghost"
              onClick={() => {
                setForm((current) => ({
                  ...current,
                  blocks: [...current.blocks, makeBlock(current.blocks.length)],
                }));
              }}
            >
              Add section
            </Button>
            <Button
              data-testid="meeting-template-save"
              size="sm"
              loading={busy}
              iconLeft={FilePlus2}
              onClick={() => {
                void saveTemplate().catch(showUnexpectedError);
              }}
            >
              {form.id ? 'Save changes' : 'Create template'}
            </Button>
            <Button
              data-testid="meeting-template-cancel"
              size="sm"
              variant="ghost"
              onClick={resetEditor}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {!showEditor && !loading && templates.length > 0 && (
        <div
          style={{
            display: 'flex',
            gap: 8,
            flexWrap: 'wrap',
            alignItems: 'center',
          }}
        >
          <select
            data-testid="meeting-template-select"
            value={selectedId}
            onChange={(event) => {
              setSelectedId(event.target.value);
            }}
          >
            {templates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.name} ({audienceLabel(template.audience)})
              </option>
            ))}
          </select>
          <Button
            data-testid="meeting-template-fill"
            size="sm"
            loading={busy}
            iconLeft={Sparkles}
            onClick={() => {
              void fillTemplate().catch(showUnexpectedError);
            }}
          >
            {t('meetings.templates.fill')}
          </Button>
          {canManageTemplates && selectedTemplate && (
              <Button
                data-testid="meeting-template-edit"
                size="sm"
                variant="ghost"
                iconLeft={Pencil}
                onClick={() => {
                  editTemplate(selectedTemplate);
                }}
              >
                Edit
              </Button>
            )}
        </div>
      )}
      {!showEditor && !loading && templates.length === 0 && (
        <div
          data-testid="meeting-template-empty"
          style={{
            fontSize: 'var(--kp-font-xs)',
            color: 'var(--color-muted-foreground)',
          }}
        >
          {canManageTemplates
            ? 'Create the first firm meeting template.'
            : 'Your firm has not added a meeting template yet.'}
        </div>
      )}

      {draft && (
        <div
          data-testid="meeting-template-review"
          style={{
            display: 'grid',
            gap: 10,
            border: '1px solid var(--kp-divider)',
            borderRadius: 'var(--radius-md)',
            padding: 12,
            background: 'var(--color-card)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <strong>{t('meetings.templates.review-title')}</strong>
            <Badge
              size="sm"
              variant={
                draft.note.audience === 'internal' ? 'warning' : 'neutral'
              }
            >
              {audienceLabel(draft.note.audience)}
            </Badge>
          </div>
          {draft.note.audience === 'internal' && (
            <div
              data-testid="meeting-template-internal-only"
              style={{
                fontSize: 'var(--kp-font-xs)',
                color: 'var(--color-muted-foreground)',
              }}
            >
              {t('meetings.templates.internal-note')}
            </div>
          )}
          {draft.note.sections.map((section) => (
            <article
              key={section.blockId}
              data-testid={`meeting-template-review-section-${section.blockId}`}
            >
              <strong>{section.label}</strong>
              <div style={{ whiteSpace: 'pre-wrap', marginTop: 3 }}>
                {section.body}
              </div>
            </article>
          ))}
          <div style={{ display: 'flex', gap: 8 }}>
            <Button
              data-testid="meeting-template-save-reviewed"
              size="sm"
              loading={busy}
              onClick={() => {
                void saveReviewedNote().catch(showUnexpectedError);
              }}
            >
              {t('meetings.templates.save-reviewed-note')}
            </Button>
            <Button
              data-testid="meeting-template-discard-reviewed"
              size="sm"
              variant="ghost"
              onClick={() => {
                setDraft(null);
              }}
            >
              Discard
            </Button>
          </div>
        </div>
      )}
      {notice && (
        <div
          data-testid="meeting-template-notice"
          role="status"
          style={{ fontSize: 'var(--kp-font-xs)' }}
        >
          {notice}
        </div>
      )}
      {error && (
        <div
          data-testid="meeting-template-error"
          role="alert"
          style={{ color: 'var(--destructive)', fontSize: 'var(--kp-font-xs)' }}
        >
          {error}
        </div>
      )}
    </section>
  );
}
