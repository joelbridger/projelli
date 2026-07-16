import { useEffect, useRef, useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  useFirmTagStore,
  type FirmTag,
  type FirmTagCatalog,
} from '@/features/crm-tags';
import { useFlag } from '@/platform/flags';
import { Button, Chip } from '@/ui/kp';
import type { TaskActionDescriptor } from '@/features/crm-tasks';
import { useCapacityTriagePreference } from './preferences';
import { buildCapacityTriage } from './triage';
import type { CapacityTriagePreference } from './contract';

function toggleTag(
  selected: readonly string[],
  tagId: string
): readonly string[] {
  return selected.includes(tagId)
    ? selected.filter((id) => id !== tagId)
    : [...selected, tagId];
}

function selectedAssignee(value: string): CapacityTriagePreference['assignee'] {
  if (value === 'all' || value === 'unassigned') return value;
  const userId = value.startsWith('user:') ? value.slice('user:'.length) : '';
  return userId ? `user:${userId}` : 'all';
}

function isWorkflowWorkItem(
  item:
    | Parameters<TaskActionDescriptor['mount']>[0]['tasks'][number]
    | Parameters<TaskActionDescriptor['mount']>[0]['workflowWorkItems'][number]
): item is Parameters<
  TaskActionDescriptor['mount']
>[0]['workflowWorkItems'][number] {
  return 'instanceId' in item;
}

function CapacityTriageEnabled({
  tasks,
  workflowWorkItems,
}: Parameters<TaskActionDescriptor['mount']>[0]) {
  const { t } = useTranslation();
  const store = useFirmTagStore();
  const savedPreference = useCapacityTriagePreference();
  const preference = savedPreference.preference;
  const [open, setOpen] = useState(false);
  const [catalogLoaded, setCatalogLoaded] = useState(false);
  const [catalogUnavailable, setCatalogUnavailable] = useState(false);
  const [preferenceUnavailable, setPreferenceUnavailable] = useState(false);
  const initialStore = useRef(store);

  useEffect(() => {
    let current = true;
    void initialStore.current
      .list()
      .then(() => {
        if (current) setCatalogLoaded(true);
      })
      .catch(() => {
        if (current) setCatalogUnavailable(true);
      });
    return () => {
      current = false;
    };
  }, []);

  const updatePreference = (next: CapacityTriagePreference) => {
    setPreferenceUnavailable(false);
    void savedPreference.save(next).catch(() => {
      setPreferenceUnavailable(true);
    });
  };
  const catalog: FirmTagCatalog = store.catalog;
  const unavailable = catalogUnavailable || store.errorCode !== null;
  const assignees = [
    ...new Set(
      [...tasks, ...workflowWorkItems]
        .map((item) => item.assigneeUserId)
        .filter((id): id is string => id !== null)
    ),
  ].sort();
  const result = buildCapacityTriage({ tasks, workflowWorkItems, preference });

  return (
    <div data-testid="crm-task-capacity-triage">
      <Button
        aria-controls="crm-task-capacity-triage-panel"
        aria-expanded={open}
        data-testid="crm-task-capacity-triage-toggle"
        iconLeft={SlidersHorizontal}
        onClick={() => {
          setOpen((visible) => !visible);
        }}
        size="sm"
        variant="secondary"
      >
        {t('capacityTriage.open')}
      </Button>
      {open ? (
        <section
          aria-label={t('capacityTriage.heading')}
          data-testid="crm-task-capacity-triage-panel"
          id="crm-task-capacity-triage-panel"
          style={{
            background: 'var(--kp-surface)',
            border: '1px solid var(--kp-border)',
            borderRadius: 10,
            boxShadow: 'var(--kp-shadow-2)',
            marginTop: 8,
            maxWidth: 540,
            padding: 16,
          }}
        >
          <h2 style={{ fontSize: 16, margin: '0 0 8px' }}>
            {t('capacityTriage.heading')}
          </h2>
          <p data-testid="crm-task-capacity-triage-summary">
            {t('capacityTriage.summary', {
              open: result.openCount,
              shown: result.shownCount,
              unassigned: result.unassignedCount,
              unscheduled: result.unscheduledCount,
            })}
          </p>
          {preferenceUnavailable || savedPreference.error ? (
            <p role="alert">{t('capacityTriage.preferenceUnavailable')}</p>
          ) : null}
          <label>
            {t('capacityTriage.assignee')}
            <select
              data-testid="crm-task-capacity-triage-assignee"
              onChange={(event) => {
                updatePreference({
                  ...preference,
                  assignee: selectedAssignee(event.target.value),
                });
              }}
              value={preference.assignee}
            >
              <option value="all">{t('capacityTriage.allAssignees')}</option>
              <option value="unassigned">
                {t('capacityTriage.unassigned')}
              </option>
              {assignees.map((id) => (
                <option key={id} value={`user:${id}`}>
                  {id}
                </option>
              ))}
            </select>
          </label>{' '}
          <label>
            {t('capacityTriage.duePressure')}
            <select
              data-testid="crm-task-capacity-triage-due-pressure"
              onChange={(event) => {
                updatePreference({
                  ...preference,
                  duePressure: event.target
                    .value as CapacityTriagePreference['duePressure'],
                });
              }}
              value={preference.duePressure}
            >
              <option value="all">{t('capacityTriage.allDuePressure')}</option>
              <option value="due_now">{t('capacityTriage.dueNow')}</option>
              <option value="scheduled">{t('capacityTriage.scheduled')}</option>
              <option value="unscheduled">
                {t('capacityTriage.unscheduled')}
              </option>
            </select>
          </label>{' '}
          <label>
            {t('capacityTriage.priority')}
            <select
              data-testid="crm-task-capacity-triage-priority"
              onChange={(event) => {
                updatePreference({
                  ...preference,
                  priority: event.target
                    .value as CapacityTriagePreference['priority'],
                });
              }}
              value={preference.priority}
            >
              <option value="all">{t('capacityTriage.allPriorities')}</option>
              <option value="high">{t('capacityTriage.high')}</option>
              <option value="normal">{t('capacityTriage.normal')}</option>
              <option value="low">{t('capacityTriage.low')}</option>
            </select>
          </label>
          <fieldset style={{ border: 0, margin: '12px 0 0', padding: 0 }}>
            <legend>{t('capacityTriage.tags')}</legend>
            {unavailable ? (
              <p role="alert">{t('capacityTriage.catalogUnavailable')}</p>
            ) : !catalogLoaded ? (
              <p role="status">{t('capacityTriage.loading')}</p>
            ) : catalog.tags.length === 0 ? (
              <p>{t('capacityTriage.noTags')}</p>
            ) : (
              <div aria-label={t('capacityTriage.tagList')}>
                {catalog.tags.map((tag: FirmTag) => (
                  <Chip
                    active={preference.tagIds.includes(tag.id)}
                    data-testid={`crm-task-capacity-triage-tag-${tag.id}`}
                    key={tag.id}
                    onClick={() => {
                      updatePreference({
                        ...preference,
                        tagIds: toggleTag(preference.tagIds, tag.id),
                      });
                    }}
                  >
                    {tag.name}
                    {tag.status === 'retired'
                      ? ` (${t('capacityTriage.retired')})`
                      : ''}
                  </Chip>
                ))}
              </div>
            )}
          </fieldset>
          {result.ranked.length === 0 ? (
            <p data-testid="crm-task-capacity-triage-empty">
              {t('capacityTriage.noMatchingWork')}
            </p>
          ) : (
            <ol data-testid="crm-task-capacity-triage-ranked">
              {result.ranked.map((item) => (
                <li
                  key={`${isWorkflowWorkItem(item) ? 'workflow_step' : 'task'}:${item.id}`}
                >
                  {item.title} ·{' '}
                  {t(
                    `capacityTriage.kind.${isWorkflowWorkItem(item) ? 'workflow_step' : 'task'}`
                  )}
                </li>
              ))}
            </ol>
          )}
        </section>
      ) : null}
    </div>
  );
}

/** Flag-first wrapper: no task, workflow, tag, or preference work while dark. */
export function CapacityTriageAction(
  context: Parameters<TaskActionDescriptor['mount']>[0]
) {
  const enabled = useFlag('task-capacity-triage');
  if (!enabled) return null;
  return <CapacityTriageEnabled {...context} />;
}
