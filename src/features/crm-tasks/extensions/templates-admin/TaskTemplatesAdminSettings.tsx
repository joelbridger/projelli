import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  type FirmTag,
  type FirmTagStore,
  useFirmTagStore,
} from '@/features/crm-tags';
import {
  type SaveTaskTemplateInput,
  type TaskTemplate,
  TaskTemplateError,
  useTaskTemplateStore,
} from '@/features/crm-tasks/extensions/templates';
import { isEnabled } from '@/platform/flags';
import { Badge, Button } from '@/ui/kp';

const card = {
  border: '1px solid var(--kp-border)',
  borderRadius: 'var(--radius-lg)',
  background: 'var(--kp-surface)',
  padding: 'var(--kp-space-md)',
} as const;

const muted = {
  color: 'var(--kp-text-faint)',
  fontSize: 'var(--kp-font-sm)',
} as const;

function blankDraft(): SaveTaskTemplateInput {
  return {
    name: '',
    title: '',
    body: '',
    priority: 'normal',
    category: '',
    due: '',
    dueTime: '',
    relationPrompt: '',
    tagIds: [],
  };
}

function draftFor(template: TaskTemplate): SaveTaskTemplateInput {
  return {
    name: template.name,
    title: template.title,
    body: template.body,
    priority: template.priority,
    category: template.category ?? '',
    due: template.due ?? '',
    dueTime: template.dueTime ?? '',
    relationPrompt: template.relationPrompt ?? '',
    tagIds: [...template.tagIds],
  };
}

function messageFor(error: unknown, fallback: string): string {
  return error instanceof TaskTemplateError ? error.message : fallback;
}

/** Enabled-only child. It owns all template and tag reads after the flag guard. */
function EnabledTaskTemplatesAdminSettings({
  templateStore,
  tagStore,
}: {
  templateStore: ReturnType<typeof useTaskTemplateStore>;
  tagStore: FirmTagStore;
}) {
  const { t } = useTranslation();
  const [templates, setTemplates] = useState<readonly TaskTemplate[]>([]);
  const [tags, setTags] = useState<readonly FirmTag[]>([]);
  const [draft, setDraft] = useState<SaveTaskTemplateInput>(blankDraft);
  const [editing, setEditing] = useState<TaskTemplate | null>(null);
  const [retiring, setRetiring] = useState<TaskTemplate | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const loadSources = useRef({ templateStore, tagStore, t });

  useEffect(() => {
    loadSources.current = { templateStore, tagStore, t };
  }, [tagStore, t, templateStore]);

  useEffect(() => {
    let current = true;
    const sources = loadSources.current;
    setLoading(true);
    void Promise.all([sources.templateStore.list(), sources.tagStore.list()])
      .then(([nextTemplates, catalog]) => {
        if (!current) return;
        setTemplates(nextTemplates);
        setTags(catalog.tags);
      })
      .catch((error: unknown) => {
        if (current) {
          setNotice(messageFor(error, sources.t('task-templates-admin.errors.load')));
        }
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [templateStore.recordSnapshot]);

  const tagById = useMemo(
    () => new Map(tags.map((tag) => [tag.id, tag])),
    [tags],
  );
  const activeTags = useMemo(
    () => tags.filter((tag) => tag.status === 'active'),
    [tags],
  );
  const selectedTagIds = draft.tagIds ?? [];

  const startNew = () => {
    setEditing(null);
    setDraft(blankDraft());
    setNotice(null);
  };

  const validateTags = async (tagIds: readonly string[]) => {
    const catalog = await tagStore.list();
    const retired = tagIds.find(
      (id) => catalog.tags.find((tag) => tag.id === id)?.status !== 'active',
    );
    if (retired) {
      throw new TaskTemplateError(
        'invalid_template',
        t('task-templates-admin.errors.retired-tag'),
      );
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      await validateTags(selectedTagIds);
      const saved = editing
        ? await templateStore.update(editing.id, draft)
        : await templateStore.create(draft);
      setTemplates((current) =>
        [...current.filter((template) => template.id !== saved.id), saved].sort(
          (left, right) => left.name.localeCompare(right.name),
        ),
      );
      setEditing(saved);
      setDraft(draftFor(saved));
      setNotice(t('task-templates-admin.messages.saved'));
    } catch (error: unknown) {
      setNotice(messageFor(error, t('task-templates-admin.errors.save')));
    } finally {
      setSaving(false);
    }
  };

  const retire = async (template: TaskTemplate) => {
    setSaving(true);
    try {
      const saved = await templateStore.retire(template.id);
      setTemplates((current) =>
        current.map((candidate) => candidate.id === saved.id ? saved : candidate),
      );
      if (editing?.id === saved.id) startNew();
      setRetiring(null);
      setNotice(t('task-templates-admin.messages.retired'));
    } catch (error: unknown) {
      setNotice(messageFor(error, t('task-templates-admin.errors.save')));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section
      data-testid="task-templates-admin-settings"
      style={{ display: 'grid', gap: 'var(--kp-space-md)', maxWidth: 960 }}
    >
      <header>
        <span style={muted}>{t('task-templates-admin.settings-label')}</span>
        <h1 style={{ margin: '4px 0' }}>{t('task-templates-admin.heading')}</h1>
        <p style={muted}>{t('task-templates-admin.description')}</p>
      </header>
      {notice ? <p role="status">{notice}</p> : null}
      {retiring ? (
        <section data-testid="task-templates-admin-retire-confirmation" style={card}>
          <h2 style={{ marginTop: 0 }}>
            {t('task-templates-admin.retire-confirmation.title', { name: retiring.name })}
          </h2>
          <p>{t('task-templates-admin.retire-confirmation.description')}</p>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="secondary" onClick={() => { setRetiring(null); }}>
              {t('task-templates-admin.retire-confirmation.cancel')}
            </Button>
            <Button
              data-testid="task-templates-admin-confirm-retire"
              disabled={saving}
              variant="danger"
              onClick={() => {
                void retire(retiring).catch((error: unknown) => {
                  setNotice(messageFor(error, t('task-templates-admin.errors.save')));
                });
              }}
            >
              {t('task-templates-admin.retire-confirmation.confirm')}
            </Button>
          </div>
        </section>
      ) : null}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(240px, 1fr) minmax(320px, 1.4fr)', gap: 16 }}>
        <section aria-label={t('task-templates-admin.library-title')} style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
            <h2 style={{ margin: 0 }}>{t('task-templates-admin.library-title')}</h2>
            <Button data-testid="task-templates-admin-new" size="sm" variant="secondary" onClick={startNew}>
              {t('task-templates-admin.new')}
            </Button>
          </div>
          {loading ? <p style={muted}>{t('task-templates-admin.loading')}</p> : null}
          {!loading && templates.length === 0 ? <p style={muted}>{t('task-templates-admin.empty')}</p> : null}
          <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
            {templates.map((template) => (
              <article
                data-testid={`task-templates-admin-row-${template.id}`}
                key={template.id}
                style={{ borderTop: '1px solid var(--kp-border)', paddingTop: 10 }}
              >
                <strong>{template.name}</strong>
                <p style={{ ...muted, margin: '4px 0' }}>{template.title}</p>
                {template.retired ? <Badge variant="neutral">{t('task-templates-admin.retired')}</Badge> : null}
                {!template.retired ? (
                  <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                    <Button
                      data-testid={`task-templates-admin-edit-${template.id}`}
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        setEditing(template);
                        setDraft(draftFor(template));
                        setNotice(null);
                      }}
                    >
                      {t('task-templates-admin.edit')}
                    </Button>
                    <Button
                      data-testid={`task-templates-admin-retire-${template.id}`}
                      size="sm"
                      variant="secondary"
                      onClick={() => { setRetiring(template); }}
                    >
                      {t('task-templates-admin.retire')}
                    </Button>
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        </section>
        <form
          data-testid="task-templates-admin-editor"
          style={{ ...card, display: 'grid', gap: 10 }}
          onSubmit={(event) => {
            event.preventDefault();
            void save().catch((error: unknown) => {
              setNotice(messageFor(error, t('task-templates-admin.errors.save')));
            });
          }}
        >
          <div>
            <h2 style={{ margin: 0 }}>
              {editing ? t('task-templates-admin.edit-title') : t('task-templates-admin.new-title')}
            </h2>
            <p style={{ ...muted, marginBottom: 0 }}>{t('task-templates-admin.editor-copy')}</p>
          </div>
          <label>
            {t('task-templates-admin.fields.name')}
            <input data-testid="task-templates-admin-name" required value={draft.name} onChange={(event) => { setDraft({ ...draft, name: event.target.value }); }} />
          </label>
          <label>
            {t('task-templates-admin.fields.title')}
            <input data-testid="task-templates-admin-title" required value={draft.title} onChange={(event) => { setDraft({ ...draft, title: event.target.value }); }} />
          </label>
          <label>
            {t('task-templates-admin.fields.body')}
            <textarea value={draft.body ?? ''} onChange={(event) => { setDraft({ ...draft, body: event.target.value }); }} />
          </label>
          <label>
            {t('task-templates-admin.fields.priority')}
            <select value={draft.priority ?? 'normal'} onChange={(event) => { setDraft({ ...draft, priority: event.target.value as NonNullable<SaveTaskTemplateInput['priority']> }); }}>
              <option value="high">{t('task-templates-admin.priority.high')}</option>
              <option value="normal">{t('task-templates-admin.priority.normal')}</option>
              <option value="low">{t('task-templates-admin.priority.low')}</option>
            </select>
          </label>
          <label>
            {t('task-templates-admin.fields.category')}
            <input value={draft.category ?? ''} onChange={(event) => { setDraft({ ...draft, category: event.target.value || null }); }} />
          </label>
          <label>
            {t('task-templates-admin.fields.due')}
            <input type="date" value={draft.due ?? ''} onChange={(event) => { setDraft({ ...draft, due: event.target.value || null }); }} />
          </label>
          <label>
            {t('task-templates-admin.fields.due-time')}
            <input type="time" value={draft.dueTime ?? ''} onChange={(event) => { setDraft({ ...draft, dueTime: event.target.value || null }); }} />
          </label>
          <label>
            {t('task-templates-admin.fields.relation-prompt')}
            <input value={draft.relationPrompt ?? ''} onChange={(event) => { setDraft({ ...draft, relationPrompt: event.target.value || null }); }} />
          </label>
          <fieldset>
            <legend>{t('task-templates-admin.fields.tags')}</legend>
            {activeTags.map((tag) => (
              <label key={tag.id} style={{ display: 'block' }}>
                <input
                  checked={selectedTagIds.includes(tag.id)}
                  type="checkbox"
                  onChange={() => {
                    setDraft({
                      ...draft,
                      tagIds: selectedTagIds.includes(tag.id)
                        ? selectedTagIds.filter((id) => id !== tag.id)
                        : [...selectedTagIds, tag.id],
                    });
                  }}
                /> {tag.name}
              </label>
            ))}
            {selectedTagIds.filter((id) => !activeTags.some((tag) => tag.id === id)).map((id) => (
              <label key={id} style={{ ...muted, display: 'block' }}>
                <input
                  checked
                  data-testid={`task-templates-admin-retired-tag-${id}`}
                  type="checkbox"
                  onChange={() => {
                    setDraft({
                      ...draft,
                      tagIds: selectedTagIds.filter((tagId) => tagId !== id),
                    });
                  }}
                />{' '}
                {tagById.get(id)?.name ?? id} ({t('task-templates-admin.retired-tag')})
              </label>
            ))}
          </fieldset>
          <Button data-testid="task-templates-admin-save" disabled={saving} type="submit">
            {t('task-templates-admin.save')}
          </Button>
        </form>
      </div>
    </section>
  );
}

function CanonicalTaskTemplatesAdminSettings() {
  return (
    <EnabledTaskTemplatesAdminSettings
      tagStore={useFirmTagStore()}
      templateStore={useTaskTemplateStore()}
    />
  );
}

/** Flag-off must return before creating stores, reading data, or mounting effects. */
export function TaskTemplatesAdminSettingsMount() {
  if (!isEnabled('task-templates-admin')) return null;
  return <CanonicalTaskTemplatesAdminSettings />;
}
