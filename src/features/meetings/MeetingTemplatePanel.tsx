/**
 * MeetingTemplatePanel — the advisor-only firm template library.
 *
 * The firm library is usable without opening a meeting. Transcript fill is an
 * optional, separately typed action that can exist only with F11's complete
 * pair-bound meeting target.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import {
  meetingEntryHostIdentity,
  type MeetingEntryHostIdentity,
  type MeetingEntryHostIdentityInput,
} from './meetingEntryHostIdentity';

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
  /** Omit this in the standalone firm-library destination. */
  fill?: MeetingTemplateFillBinding;
}

/**
 * The sole transcript-fill shape exposed by F10. The F11 pair and sealed
 * target are both required; no matter id, folder, or meetingDir overload
 * exists. The actual meeting directory is read only from F11's verified
 * identity.
 */
export interface MeetingTemplateFillBinding
  extends MeetingEntryHostIdentityInput {
  readonly transcript: TranscriptFile;
  readonly clientName: string;
  readonly getProvider: () => Promise<MeetingTemplateFillProvider>;
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

function sameFillIdentity(
  left: MeetingEntryHostIdentity,
  right: MeetingEntryHostIdentity | null
): boolean {
  return !!right &&
    right.clientBoundary.householdRef === left.clientBoundary.householdRef &&
    right.matterId === left.matterId &&
    right.meetingDir === left.meetingDir &&
    right.target === left.target;
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
  fill,
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
  const fillRef = useRef(fill);
  const mountedRef = useRef(true);
  fillRef.current = fill;

  const showUnexpectedError = useCallback(() => {
    setError(t('meetings.templates.action-error'));
  }, [t]);

  const resolveFillIdentity = useCallback(
    () => {
      const currentFill = fillRef.current;
      return mountedRef.current && currentFill
        ? meetingEntryHostIdentity({
            activeClientBoundary: currentFill.activeClientBoundary,
            target: currentFill.target,
          })
        : null;
    },
    []
  );
  const fillIdentity = resolveFillIdentity();
  const fillIdentityKey = fillIdentity
    ? `${fillIdentity.clientBoundary.householdRef}\u0000${fillIdentity.matterId}\u0000${fillIdentity.meetingDir}`
    : null;

  const audienceLabel = (audience: MeetingTemplateAudience): string =>
    audience === 'internal'
      ? t('meetings.templates.audience-internal')
      : t('meetings.templates.audience-client-facing');

  const loadTemplates = useCallback(async () => {
    setError(null);
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
    } catch {
      setTemplates([]);
      setError(t('meetings.templates.load-error'));
    } finally {
      setLoading(false);
    }
  }, [firmId, storage, t]);

  useEffect(() => {
    setDraft(null);
  }, [fillIdentityKey, fillIdentity?.target]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

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
      setNotice(
        t(
          existing
            ? 'meetings.templates.updated'
            : 'meetings.templates.created'
        )
      );
      resetEditor();
      await loadTemplates();
    } catch {
      setError(t('meetings.templates.save-error'));
    } finally {
      setBusy(false);
    }
  };

  const fillTemplate = async () => {
    const template = templates.find((item) => item.id === selectedId);
    const identity = resolveFillIdentity();
    if (!template || !identity || !fill) {
      setDraft(null);
      setError(t('meetings.templates.fill-unavailable'));
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const provider = await fill.getProvider();
      const note = await fillMeetingTemplateFromTranscript({
        template,
        transcript: fill.transcript,
        provider,
      });
      const currentIdentity = resolveFillIdentity();
      if (!sameFillIdentity(identity, currentIdentity)) {
        setDraft(null);
        setError(t('meetings.templates.fill-unavailable'));
        return;
      }
      setDraft({ template, note });
    } catch {
      setDraft(null);
      setError(t('meetings.templates.fill-error'));
    } finally {
      setBusy(false);
    }
  };

  const saveReviewedNote = async () => {
    const identity = resolveFillIdentity();
    if (!draft || !identity || !fill) {
      setDraft(null);
      setError(t('meetings.templates.fill-unavailable'));
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const saved = await loadSavedNotes(workspace, identity.meetingDir);
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
          `${fill.clientName} meeting recap`
        );
        saved.clientFacing[draft.template.id] = {
          templateVersion: draft.note.templateVersion,
          title: rendered.title,
          sections: [...rendered.sections],
        };
      }
      if (!sameFillIdentity(identity, resolveFillIdentity())) {
        setDraft(null);
        setError(t('meetings.templates.fill-unavailable'));
        return;
      }
      await workspace.writeFile(
        `${identity.meetingDir}/${SAVED_NOTES_PATH}`,
        JSON.stringify(saved, null, 2)
      );
      setNotice(
        t(
          draft.note.audience === 'internal'
            ? 'meetings.templates.internal-saved'
            : 'meetings.templates.client-saved'
        )
      );
      setDraft(null);
    } catch {
      setError(t('meetings.templates.note-save-error'));
    } finally {
      setBusy(false);
    }
  };

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
        {canManageTemplates && firmId && !loading && !showEditor && (
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
            {t('meetings.templates.new')}
          </Button>
        )}
      </div>

      {loading && (
        <div
          data-testid="meeting-template-loading"
          role="status"
          style={{ fontSize: 'var(--kp-font-xs)', color: 'var(--color-muted-foreground)' }}
        >
          {t('meetings.templates.loading')}
        </div>
      )}

      {!loading && !firmId && (
        <div
          data-testid="meeting-template-unavailable"
          role="status"
          style={{ fontSize: 'var(--kp-font-xs)', color: 'var(--color-muted-foreground)' }}
        >
          {t('meetings.templates.firm-unavailable')}
        </div>
      )}

      {!loading && firmId && error && templates.length === 0 && !showEditor && (
        <div data-testid="meeting-template-load-error" role="alert">
          <div style={{ color: 'var(--destructive)', fontSize: 'var(--kp-font-xs)' }}>
            {error}
          </div>
          <Button
            data-testid="meeting-template-retry"
            size="sm"
            variant="secondary"
            onClick={() => {
              void loadTemplates().catch(showUnexpectedError);
            }}
          >
            {t('meetings.templates.retry')}
          </Button>
        </div>
      )}

      {firmId && showEditor && (
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
            {t('meetings.templates.name-label')}
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
            {t('meetings.templates.audience-label')}
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
                aria-label={t('meetings.templates.section-label-aria', {
                  index: index + 1,
                })}
                data-testid={`meeting-template-block-label-${block.id}`}
                placeholder={t('meetings.templates.section-title-placeholder')}
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
                aria-label={t('meetings.templates.section-instruction-aria', {
                  index: index + 1,
                })}
                data-testid={`meeting-template-block-instruction-${block.id}`}
                placeholder={t('meetings.templates.section-instruction-placeholder')}
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
                {t('meetings.templates.required')}
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
              {t('meetings.templates.add-section')}
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
              {t(
                form.id
                  ? 'meetings.templates.save-changes'
                  : 'meetings.templates.create'
              )}
            </Button>
            <Button
              data-testid="meeting-template-cancel"
              size="sm"
              variant="ghost"
              onClick={resetEditor}
            >
              {t('meetings.templates.cancel')}
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
          {fill && fillIdentity && (
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
          )}
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
                {t('meetings.templates.edit')}
              </Button>
            )}
        </div>
      )}
      {!showEditor && !loading && firmId && !error && templates.length === 0 && (
        <div
          data-testid="meeting-template-empty"
          style={{
            fontSize: 'var(--kp-font-xs)',
            color: 'var(--color-muted-foreground)',
          }}
        >
          {canManageTemplates
            ? t('meetings.templates.empty-manager')
            : t('meetings.templates.empty-viewer')}
        </div>
      )}

      {fill && !fillIdentity && !loading && templates.length > 0 && (
        <div
          data-testid="meeting-template-fill-unavailable"
          role="status"
          style={{ fontSize: 'var(--kp-font-xs)', color: 'var(--color-muted-foreground)' }}
        >
          {t('meetings.templates.fill-unavailable')}
        </div>
      )}

      {fillIdentity && draft && (
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
              {t('meetings.templates.discard')}
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
      {error && (templates.length > 0 || showEditor) && (
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
