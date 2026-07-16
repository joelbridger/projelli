import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useFlag } from '@/platform/flags';
import {
  useTaskRecordStore,
  type TaskHouseholdRef,
  type TaskPriority,
  type TaskRecordStore,
} from '@/features/crm-tasks';
import {
  useFirmTagStore,
  type FirmTagCatalog,
  type FirmTagStore,
} from '@/features/crm-tags';
import { Button } from '@/ui/kp';
import { createTask } from './contract';
import type { TaskTemplateContext } from '../../taskExtensionRegistry';

type TaskCreateTemplateProps = {
  context: TaskTemplateContext;
  createTaskStore?: () => TaskRecordStore;
  createTagStore?: () => FirmTagStore;
};

function relatedRecordFor(
  request: TaskTemplateContext['addRequest']
): TaskHouseholdRef | undefined {
  if (!request || request.kind !== 'task') return undefined;
  return {
    kind: 'household',
    id: request.householdId,
    label: request.householdLabel,
  };
}

function CanonicalTaskCreateTemplate({ context }: Pick<TaskCreateTemplateProps, 'context'>) {
  return (
    <EnabledTaskCreateTemplate
      context={context}
      taskStore={useTaskRecordStore()}
      tagStore={useFirmTagStore()}
    />
  );
}

function EnabledTaskCreateTemplate({
  context,
  taskStore,
  tagStore,
}: {
  context: TaskTemplateContext;
  taskStore: TaskRecordStore;
  tagStore: FirmTagStore;
}) {
  const { t } = useTranslation();
  const relatedRecord = relatedRecordFor(context.addRequest);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [due, setDue] = useState('');
  const [dueTime, setDueTime] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('normal');
  const [category, setCategory] = useState('');
  const [tagIds, setTagIds] = useState<readonly string[]>([]);
  const [catalog, setCatalog] = useState<FirmTagCatalog>(tagStore.catalog);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    void tagStore
      .list()
      .then((next) => {
        if (current) setCatalog(next);
      })
      .catch(() => {
        if (current) setError(t('task-create-v1.tag-load-failed'));
      });
    return () => {
      current = false;
    };
  }, [t, tagStore]);

  const toggleTag = (id: string) => {
    setTagIds((current) =>
      current.includes(id)
        ? current.filter((candidate) => candidate !== id)
        : [...current, id]
    );
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const created = await createTask(taskStore, tagStore, {
        title,
        ...(description ? { description } : {}),
        ...(due ? { due } : {}),
        ...(dueTime ? { dueTime } : {}),
        priority,
        ...(category ? { category } : {}),
        ...(relatedRecord ? { relatedRecord } : {}),
        tagIds,
      });
      setCreatedId(created.id);
      setOpen(false);
      setTitle('');
      setDescription('');
      setDue('');
      setDueTime('');
      setPriority('normal');
      setCategory('');
      setTagIds([]);
    } catch {
      setError(t('task-create-v1.save-failed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div data-testid="task-create-v1-mount">
      <Button
        data-testid="task-create-v1-open"
        iconLeft={Plus}
        onClick={() => {
          setOpen(true);
          setCreatedId(null);
          setError(null);
        }}
      >
        {t('task-create-v1.open')}
      </Button>
      {createdId ? (
        <p data-testid="task-create-v1-saved">
          {t('task-create-v1.saved', { id: createdId })}
        </p>
      ) : null}
      {open ? (
        <aside
          aria-label={t('task-create-v1.composer-label')}
          data-testid="task-create-v1-composer"
          style={{ display: 'grid', gap: 12, minWidth: 300 }}
        >
          <h2 style={{ margin: 0 }}>{t('task-create-v1.heading')}</h2>
          {relatedRecord ? (
            <p data-testid="task-create-v1-related-record">
              {t('task-create-v1.related-record', { name: relatedRecord.label ?? relatedRecord.id })}
            </p>
          ) : null}
          <label>
            {t('task-create-v1.title')}
            <input
              autoFocus
              data-testid="task-create-v1-title"
              value={title}
              onChange={(event) => {
                setTitle(event.target.value);
              }}
            />
          </label>
          <label>
            {t('task-create-v1.description')}
            <textarea
              data-testid="task-create-v1-description"
              value={description}
              onChange={(event) => {
                setDescription(event.target.value);
              }}
            />
          </label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <label>
              {t('task-create-v1.due-date')}
              <input
                type="date"
                data-testid="task-create-v1-due"
                value={due}
                onChange={(event) => {
                  setDue(event.target.value);
                }}
              />
            </label>
            <label>
              {t('task-create-v1.due-time')}
              <input
                type="time"
                data-testid="task-create-v1-due-time"
                value={dueTime}
                onChange={(event) => {
                  setDueTime(event.target.value);
                }}
              />
            </label>
          </div>
          <label>
            {t('task-create-v1.priority')}
            <select
              data-testid="task-create-v1-priority"
              value={priority}
              onChange={(event) => {
                setPriority(event.target.value as TaskPriority);
              }}
            >
              <option value="high">{t('task-create-v1.priority-high')}</option>
              <option value="normal">{t('task-create-v1.priority-normal')}</option>
              <option value="low">{t('task-create-v1.priority-low')}</option>
            </select>
          </label>
          <label>
            {t('task-create-v1.category')}
            <input
              data-testid="task-create-v1-category"
              value={category}
              onChange={(event) => {
                setCategory(event.target.value);
              }}
            />
          </label>
          <fieldset>
            <legend>{t('task-create-v1.tags')}</legend>
            {catalog.tags.map((tag) => (
              <label key={tag.id} style={{ display: 'block' }}>
                <input
                  type="checkbox"
                  data-testid={`task-create-v1-tag-${tag.id}`}
                  checked={tagIds.includes(tag.id)}
                  disabled={tag.status !== 'active'}
                  onChange={() => {
                    toggleTag(tag.id);
                  }}
                />{' '}
                {tag.name}
                {tag.status === 'retired'
                  ? ` (${t('task-create-v1.retired')})`
                  : ''}
              </label>
            ))}
          </fieldset>
          {error ? <p role="alert">{error}</p> : null}
          <div style={{ display: 'flex', gap: 8 }}>
            <Button
              data-testid="task-create-v1-save"
              disabled={saving}
              onClick={() => {
                void save().catch(() => {
                  setError(t('task-create-v1.save-failed'));
                });
              }}
            >
              {t('task-create-v1.save')}
            </Button>
            <Button
              variant="secondary"
              disabled={saving}
              onClick={() => {
                setOpen(false);
              }}
            >
              {t('task-create-v1.cancel')}
            </Button>
          </div>
        </aside>
      ) : null}
    </div>
  );
}

/**
 * Outer flag guard. The enabled child is the first place task or tag stores
 * are constructed, read, subscribed, or used by an effect.
 */
export function TaskCreateTemplateMount({
  context,
  createTaskStore,
  createTagStore,
}: TaskCreateTemplateProps) {
  const enabled = useFlag('task-create-v1');
  if (!enabled) return null;
  return createTaskStore && createTagStore ? (
    <EnabledTaskCreateTemplate
      context={context}
      taskStore={createTaskStore()}
      tagStore={createTagStore()}
    />
  ) : (
    <CanonicalTaskCreateTemplate context={context} />
  );
}
