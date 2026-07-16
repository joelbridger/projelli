import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BookmarkPlus } from 'lucide-react';
import { useFirmTagStore, type FirmTag } from '@/features/crm-tags';
import { useTaskRecordStore, type TaskPriority } from '@/features/crm-tasks';
import { useFlag } from '@/platform/flags';
import { Button, Card } from '@/ui/kp';
import type { TaskTemplateContext } from '@/features/crm-tasks/taskExtensionRegistry';
import {
  type SaveTaskTemplateInput,
  type TaskTemplate,
  TaskTemplateError,
} from './contract';
import { useTaskTemplateStore } from './taskTemplateStore';

type EditorDraft = Required<Pick<SaveTaskTemplateInput, 'name' | 'title'>> & {
  body: string;
  priority: TaskPriority;
  category: string;
  due: string;
  dueTime: string;
  relationPrompt: string;
  tagIds: string[];
};

const blankDraft = (): EditorDraft => ({
  name: '', title: '', body: '', priority: 'normal', category: '', due: '', dueTime: '', relationPrompt: '', tagIds: [],
});

function draftFor(template: TaskTemplate): EditorDraft {
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

function editorInput(draft: EditorDraft): SaveTaskTemplateInput {
  return {
    ...draft,
    category: draft.category || null,
    due: draft.due || null,
    dueTime: draft.dueTime || null,
    relationPrompt: draft.relationPrompt || null,
  };
}

/** The dark branch owns only the flag read; enabled children own every load. */
export function TaskTemplateLibrary(props: TaskTemplateContext) {
  const enabled = useFlag('task-templates');
  if (!enabled) return null;
  return <EnabledTaskTemplateLibrary {...props} />;
}

function EnabledTaskTemplateLibrary({ addRequest, onAddRequestConsumed, onApplied }: TaskTemplateContext) {
  const { t } = useTranslation();
  const templates = useTaskTemplateStore();
  const taskStore = useTaskRecordStore();
  const tagStore = useFirmTagStore();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<readonly TaskTemplate[]>([]);
  const [tags, setTags] = useState<readonly FirmTag[]>([]);
  const [editing, setEditing] = useState<TaskTemplate | null>(null);
  const [pendingApplication, setPendingApplication] = useState<TaskTemplate | null>(null);
  const [pendingRetirement, setPendingRetirement] = useState<TaskTemplate | null>(null);
  const [draft, setDraft] = useState<EditorDraft>(blankDraft);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const loadSources = useRef({ templates, tagStore, t });

  const activeTags = useMemo(() => tags.filter((tag) => tag.status === 'active'), [tags]);
  const tagById = useMemo(() => new Map(tags.map((tag) => [tag.id, tag])), [tags]);

  useEffect(() => {
    loadSources.current = { templates, tagStore, t };
  }, [tagStore, t, templates]);

  useEffect(() => {
    if (!open) return undefined;
    let current = true;
    const sources = loadSources.current;
    void Promise.all([sources.templates.list(), sources.tagStore.list()])
      .then(([nextTemplates, catalog]) => {
        if (!current) return;
        setItems(nextTemplates);
        setTags(catalog.tags);
        setMessage(null);
      })
      .catch((cause: unknown) => {
        if (current) {
          setMessage(cause instanceof Error ? cause.message : sources.t('task-templates.errors.load'));
        }
      });
    return () => {
      current = false;
    };
  }, [open, templates.recordSnapshot]);

  const openNew = () => {
    setEditing(null);
    setDraft(blankDraft());
    setMessage(null);
  };

  const validateActiveTags = async (tagIds: readonly string[]) => {
    const catalog = await tagStore.list();
    const retired = tagIds.find((id) => catalog.tags.find((tag) => tag.id === id)?.status !== 'active');
    if (retired) throw new TaskTemplateError('invalid_template', t('task-templates.errors.retired-tag'));
  };

  const save = async () => {
    setSaving(true);
    try {
      await validateActiveTags(draft.tagIds);
      const saved = editing
        ? await templates.update(editing.id, editorInput(draft))
        : await templates.create(editorInput(draft));
      setItems((current) => {
        const without = current.filter((item) => item.id !== saved.id);
        return [...without, saved].sort((left, right) => left.name.localeCompare(right.name));
      });
      setEditing(saved);
      setMessage(t('task-templates.messages.saved'));
    } catch (cause: unknown) {
      setMessage(cause instanceof Error ? cause.message : t('task-templates.errors.save'));
    } finally {
      setSaving(false);
    }
  };

  const apply = async (template: TaskTemplate) => {
    setSaving(true);
    try {
      const prepared = await templates.apply(template.id);
      await validateActiveTags(prepared.taskInput.tagIds);
      const householdRef = addRequest?.kind === 'task'
        ? { kind: 'household' as const, id: addRequest.householdId, matterId: addRequest.householdId, label: addRequest.householdLabel }
        : undefined;
      const created = await taskStore.create({
        ...prepared.taskInput,
        ...(householdRef ? { householdRef } : {}),
      });
      onApplied?.(created.id);
      if (addRequest?.kind === 'task') onAddRequestConsumed?.();
      setOpen(false);
      setMessage(null);
    } catch (cause: unknown) {
      setMessage(cause instanceof Error ? cause.message : t('task-templates.errors.apply'));
    } finally {
      setSaving(false);
    }
  };

  const startApplication = (template: TaskTemplate) => {
    if (template.relationPrompt) {
      setPendingApplication(template);
      return;
    }
    void apply(template).catch((cause: unknown) => {
      setMessage(cause instanceof Error ? cause.message : t('task-templates.errors.apply'));
    });
  };

  const retire = async (template: TaskTemplate) => {
    setSaving(true);
    try {
      const saved = await templates.retire(template.id);
      setItems((current) => current.map((item) => item.id === saved.id ? saved : item));
      if (editing?.id === saved.id) openNew();
    } catch (cause: unknown) {
      setMessage(cause instanceof Error ? cause.message : t('task-templates.errors.save'));
    } finally {
      setSaving(false);
    }
  };

  const closeLibrary = () => {
    setOpen(false);
    setPendingApplication(null);
    setPendingRetirement(null);
  };

  return (
    <>
      <Button data-testid="crm-task-template-library-open" iconLeft={BookmarkPlus} variant="secondary" onClick={() => { setOpen(true); openNew(); setPendingApplication(null); setPendingRetirement(null); }}>
        {t('task-templates.open')}
      </Button>
      {open ? (
        <section data-testid="crm-task-template-library" aria-label={t('task-templates.title')} style={{ position: 'fixed', inset: '10% 12%', overflow: 'auto', zIndex: 10 }}>
          <Card variant="raised" style={{ display: 'grid', gap: 16, padding: 20 }}>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between' }}>
              <div><h2 style={{ margin: 0 }}>{t('task-templates.title')}</h2><p style={{ margin: '4px 0 0' }}>{t('task-templates.description')}</p></div>
              <Button variant="secondary" onClick={closeLibrary}>{t('task-templates.close')}</Button>
            </div>
            {message ? <p role="status">{message}</p> : null}
            {pendingApplication?.relationPrompt ? (
              <section data-testid="crm-task-template-relation-prompt" style={{ border: '1px solid var(--kp-border)', borderRadius: 8, padding: 12 }}>
                <strong>{t('task-templates.relation-prompt.title')}</strong>
                <p>{pendingApplication.relationPrompt}</p>
                <div style={{ display: 'flex', gap: 8 }}>
                  <Button variant="secondary" onClick={() => { setPendingApplication(null); }}>{t('task-templates.relation-prompt.cancel')}</Button>
                  <Button onClick={() => {
                    const template = pendingApplication;
                    setPendingApplication(null);
                    void apply(template).catch((cause: unknown) => {
                      setMessage(cause instanceof Error ? cause.message : t('task-templates.errors.apply'));
                    });
                  }}>{t('task-templates.relation-prompt.continue')}</Button>
                </div>
              </section>
            ) : null}
            {pendingRetirement ? (
              <section data-testid="crm-task-template-retire-confirmation" style={{ border: '1px solid var(--kp-border)', borderRadius: 8, padding: 12 }}>
                <strong>{t('task-templates.retire-confirmation.title', { name: pendingRetirement.name })}</strong>
                <p>{t('task-templates.retire-confirmation.description')}</p>
                <div style={{ display: 'flex', gap: 8 }}>
                  <Button variant="secondary" onClick={() => { setPendingRetirement(null); }}>{t('task-templates.retire-confirmation.cancel')}</Button>
                  <Button onClick={() => {
                    const template = pendingRetirement;
                    setPendingRetirement(null);
                    void retire(template).catch((cause: unknown) => {
                      setMessage(cause instanceof Error ? cause.message : t('task-templates.errors.save'));
                    });
                  }}>{t('task-templates.retire-confirmation.confirm')}</Button>
                </div>
              </section>
            ) : null}
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 1fr) minmax(300px, 1.5fr)', gap: 16 }}>
              <div style={{ display: 'grid', gap: 8 }}>
                <Button data-testid="crm-task-template-new" variant="secondary" onClick={openNew}>{t('task-templates.new')}</Button>
                {items.length ? items.map((template) => (
                  <div key={template.id} data-testid={`crm-task-template-${template.id}`} style={{ border: '1px solid var(--kp-border)', borderRadius: 8, padding: 10, display: 'grid', gap: 6 }}>
                    <strong>{template.name}</strong>
                    <span>{template.title}</span>
                    {template.retired ? <small>{t('task-templates.retired')}</small> : null}
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {!template.retired ? <Button size="sm" onClick={() => { startApplication(template); }} disabled={saving}>{t('task-templates.apply')}</Button> : null}
                      {!template.retired ? <Button size="sm" variant="secondary" onClick={() => { setEditing(template); setDraft(draftFor(template)); setMessage(null); }}>{t('task-templates.edit')}</Button> : null}
                      {!template.retired ? <Button size="sm" variant="secondary" onClick={() => { setPendingRetirement(template); }} disabled={saving}>{t('task-templates.retire')}</Button> : null}
                    </div>
                  </div>
                )) : <p>{t('task-templates.empty')}</p>}
              </div>
              <div style={{ display: 'grid', gap: 8 }}>
                <h3 style={{ margin: 0 }}>{editing ? t('task-templates.edit-title') : t('task-templates.new-title')}</h3>
                <label>{t('task-templates.fields.name')}<input data-testid="crm-task-template-name" value={draft.name} onChange={(event) => { setDraft({ ...draft, name: event.target.value }); }} /></label>
                <label>{t('task-templates.fields.title')}<input data-testid="crm-task-template-title" value={draft.title} onChange={(event) => { setDraft({ ...draft, title: event.target.value }); }} /></label>
                <label>{t('task-templates.fields.body')}<textarea value={draft.body} onChange={(event) => { setDraft({ ...draft, body: event.target.value }); }} /></label>
                <label>{t('task-templates.fields.priority')}<select value={draft.priority} onChange={(event) => { setDraft({ ...draft, priority: event.target.value as TaskPriority }); }}><option value="high">{t('task-templates.priority.high')}</option><option value="normal">{t('task-templates.priority.normal')}</option><option value="low">{t('task-templates.priority.low')}</option></select></label>
                <label>{t('task-templates.fields.category')}<input value={draft.category} onChange={(event) => { setDraft({ ...draft, category: event.target.value }); }} /></label>
                <label>{t('task-templates.fields.due')}<input type="date" data-testid="crm-task-template-due" value={draft.due} onChange={(event) => { setDraft({ ...draft, due: event.target.value }); }} /></label>
                <label>{t('task-templates.fields.due-time')}<input type="time" data-testid="crm-task-template-due-time" value={draft.dueTime} onChange={(event) => { setDraft({ ...draft, dueTime: event.target.value }); }} /></label>
                <label>{t('task-templates.fields.relation-prompt')}<input value={draft.relationPrompt} onChange={(event) => { setDraft({ ...draft, relationPrompt: event.target.value }); }} /></label>
                <fieldset><legend>{t('task-templates.fields.tags')}</legend>{activeTags.map((tag) => <label key={tag.id} style={{ display: 'block' }}><input type="checkbox" checked={draft.tagIds.includes(tag.id)} onChange={() => { setDraft({ ...draft, tagIds: draft.tagIds.includes(tag.id) ? draft.tagIds.filter((id) => id !== tag.id) : [...draft.tagIds, tag.id] }); }} /> {tag.name}</label>)}{draft.tagIds.filter((id) => !activeTags.some((tag) => tag.id === id)).map((id) => <div key={id} style={{ display: 'flex', gap: 6, alignItems: 'center' }}><small>{tagById.get(id)?.name ?? id} — {t('task-templates.retired')}</small><Button size="sm" variant="secondary" onClick={() => { setDraft({ ...draft, tagIds: draft.tagIds.filter((tagId) => tagId !== id) }); }}>{t('task-templates.remove-tag', { name: tagById.get(id)?.name ?? id })}</Button></div>)}</fieldset>
                <Button data-testid="crm-task-template-save" disabled={saving} onClick={() => {
                  void save().catch((cause: unknown) => {
                    setMessage(cause instanceof Error ? cause.message : t('task-templates.errors.save'));
                  });
                }}>{t('task-templates.save')}</Button>
              </div>
            </div>
          </Card>
        </section>
      ) : null}
    </>
  );
}
