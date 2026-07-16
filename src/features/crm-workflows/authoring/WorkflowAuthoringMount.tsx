import { useContext, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CrmHomeSurfaceContext } from '@/features/crm-home';
import { useFirmTagStore, type FirmTagStore } from '@/features/crm-tags';
import {
  useWorkflowTemplateStore,
  type WorkflowTemplateRecord,
  type WorkflowTemplateStep,
  type WorkflowTemplateStore,
} from '@/features/crm-workflows';
import { isEnabled } from '@/platform/flags';
import { validateWorkflowTemplateTags } from './tagValidation';

const panel = {
  borderTop: '1px solid var(--kp-border)',
  marginTop: 16,
  paddingTop: 16,
} as const;

type StoreFactory = () => WorkflowTemplateStore;

/** Registered outer gate: do not create a data hook or adapter while dark. */
export function WorkflowAuthoringRuleMount({
  templateId,
  createStore = useWorkflowTemplateStore,
  createTagStore = useFirmTagStore,
}: {
  templateId: string;
  createStore?: StoreFactory;
  createTagStore?: () => FirmTagStore;
}) {
  if (!isEnabled('workflow-authoring')) return null;
  return (
    <EnabledWorkflowAuthoring
      templateId={templateId}
      createStore={createStore}
      createTagStore={createTagStore}
    />
  );
}

function EnabledWorkflowAuthoring({
  templateId,
  createStore,
  createTagStore,
}: {
  templateId: string;
  createStore: StoreFactory;
  createTagStore: () => FirmTagStore;
}) {
  const { t } = useTranslation();
  const store = createStore();
  const tagStore = createTagStore();
  const crmHome = useContext(CrmHomeSurfaceContext);
  const workflowSnapshotKey = crmHome?.workflowData?.templates
    .map(
      (template) =>
        `${template.id}:${template.updatedAt ?? ''}:${template.status ?? ''}:${template.name}:${template.steps
          .map(
            (step) =>
              `${step.id}:${step.title}:${step.tagIds.join(',')}`
          )
          .join(';')}`
    )
    .join('|') ?? '';
  const refreshKey = `${templateId}:${workflowSnapshotKey}:${tagStore.catalog.tags
    .map((tag) => `${tag.id}:${tag.status}:${tag.name}`)
    .join('|')}`;
  const lastLoadedKey = useRef<string | null>(null);
  const lastWorkflowSnapshot = useRef(crmHome?.workflowData);
  const [templates, setTemplates] = useState<
    readonly WorkflowTemplateRecord[]
  >([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [steps, setSteps] = useState<WorkflowTemplateStep[]>([]);
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [householdId, setHouseholdId] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const selected =
    templates.find((template) => template.id === selectedId) ?? null;
  const select = (template: WorkflowTemplateRecord) => {
    setSelectedId(template.id);
    setName(template.name);
    setTagIds([...template.tagIds]);
    setSteps(
      template.steps.map((step) => ({ ...step, tagIds: [...step.tagIds] }))
    );
  };

  useEffect(() => {
    if (
      lastLoadedKey.current === refreshKey &&
      lastWorkflowSnapshot.current === crmHome?.workflowData
    ) {
      return;
    }
    lastLoadedKey.current = refreshKey;
    lastWorkflowSnapshot.current = crmHome?.workflowData;
    let mounted = true;
    queueMicrotask(() => {
      void store
        .list()
        .then((nextTemplates) => {
          if (!mounted) return;
          setTemplates(nextTemplates);
          const next =
            nextTemplates.find((template) => template.id === selectedId) ??
            nextTemplates[0] ??
            null;
          if (next) {
            select(next);
          } else {
            setSelectedId(null);
            setName('');
            setTagIds([]);
            setSteps([]);
          }
        })
        .catch((error: unknown) => {
          if (mounted) {
            setMessage(
              error instanceof Error
                ? error.message
                : t('workflow-authoring.error')
            );
          }
        });
    });
    return () => {
      mounted = false;
    };
  });

  const toggle = (
    id: string,
    current: readonly string[],
    set: (ids: string[]) => void
  ) => {
    set(
      current.includes(id)
        ? current.filter((candidate) => candidate !== id)
        : [...current, id]
    );
  };
  const reloadTemplates = async (next: WorkflowTemplateRecord) => {
    await tagStore.list();
    setTemplates(await store.list());
    select(next);
  };
  const save = async () => {
    try {
      setMessage(null);
      validateWorkflowTemplateTags(
        { tagIds, steps },
        tagStore.catalog,
        selected ?? undefined
      );
      const next = selected
        ? await store.update(selected.id, { name, tagIds, steps })
        : await store.create({
            name,
            tagIds,
            steps: steps.map((step) => ({
              title: step.title,
              tagIds: step.tagIds,
            })),
          });
      await reloadTemplates(next);
      setMessage(t('workflow-authoring.saved'));
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : t('workflow-authoring.error')
      );
    }
  };
  const publish = async () => {
    if (!selected) return;
    try {
      validateWorkflowTemplateTags(
        selected,
        tagStore.catalog,
        selected
      );
      const next = await store.publish(selected.id);
      await reloadTemplates(next);
      setMessage(t('workflow-authoring.published'));
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : t('workflow-authoring.error')
      );
    }
  };
  const start = async () => {
    if (!selected) return;
    try {
      const household = crmHome?.workflowHouseholds?.find(
        (candidate) => candidate.id === householdId
      );
      if (!household) {
        setMessage(t('workflow-authoring.choose-household'));
        return;
      }
      await store.start(selected.id, household);
      setMessage(t('workflow-authoring.started'));
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : t('workflow-authoring.error')
      );
    }
  };
  const run = (operation: () => Promise<void>) => {
    void operation().catch((error: unknown) => {
      setMessage(
        error instanceof Error ? error.message : t('workflow-authoring.error')
      );
    });
  };
  const newTemplate = () => {
    setSelectedId(null);
    setName('');
    setTagIds([]);
    setSteps([
      {
        id: `draft-step:${crypto.randomUUID()}`,
        title: '',
        position: 0,
        tagIds: [],
      },
    ]);
  };
  const moveStep = (index: number, offset: -1 | 1) => {
    setSteps((current) => {
      const destination = index + offset;
      if (destination < 0 || destination >= current.length) return current;
      const reordered = [...current];
      const [step] = reordered.splice(index, 1);
      if (!step) return current;
      reordered.splice(destination, 0, step);
      return reordered.map((candidate, position) => ({
        ...candidate,
        position,
      }));
    });
  };

  return (
    <section data-testid="workflow-authoring-library" style={panel}>
      <h3 style={{ marginTop: 0 }}>{t('workflow-authoring.title')}</h3>
      <p>{t('workflow-authoring.description')}</p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          type="button"
          data-testid="workflow-authoring-new"
          onClick={newTemplate}
        >
          {t('workflow-authoring.new')}
        </button>
        {templates.map((template) => (
          <button
            key={template.id}
            type="button"
            data-testid={`workflow-authoring-template-${template.id}`}
            onClick={() => {
              select(template);
            }}
          >
            {template.name}
          </button>
        ))}
      </div>
      <label style={{ display: 'block', marginTop: 12 }}>
        {t('workflow-authoring.template-title')}
        <input
          data-testid="workflow-authoring-title"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
          }}
        />
      </label>
      <fieldset style={{ border: 0, padding: 0, margin: '12px 0' }}>
        <legend>{t('workflow-authoring.template-tags')}</legend>
        {tagStore.catalog.tags.map((tag) => (
          <label
            key={tag.id}
            style={{ display: 'inline-flex', gap: 4, marginRight: 10 }}
          >
            <input
              type="checkbox"
              disabled={tag.status === 'retired' && !tagIds.includes(tag.id)}
              checked={tagIds.includes(tag.id)}
              onChange={() => {
                toggle(tag.id, tagIds, setTagIds);
              }}
            />
            <span data-tag-color={tag.color}>
              {tag.name} · {tag.color}
            </span>
          </label>
        ))}
      </fieldset>
      <div>
        {steps.map((step, index) => (
          <fieldset
            key={step.id}
            data-testid={`workflow-authoring-step-${step.id}`}
            style={{ border: '1px solid var(--kp-border)', margin: '8px 0' }}
          >
            <legend>
              {t('workflow-authoring.step', { number: index + 1 })}
            </legend>
            <input
              aria-label={t('workflow-authoring.step-title', {
                number: index + 1,
              })}
              value={step.title}
              onChange={(event) => {
                setSteps((current) =>
                  current.map((candidate) =>
                    candidate.id === step.id
                      ? { ...candidate, title: event.target.value }
                      : candidate
                  )
                );
              }}
            />
            <button
              type="button"
              disabled={index === 0}
              onClick={() => {
                moveStep(index, -1);
              }}
            >
              {t('workflow-authoring.move-up')}
            </button>
            <button
              type="button"
              disabled={index === steps.length - 1}
              onClick={() => {
                moveStep(index, 1);
              }}
            >
              {t('workflow-authoring.move-down')}
            </button>
            {tagStore.catalog.tags.map((tag) => (
              <label
                key={tag.id}
                style={{ display: 'inline-flex', gap: 4, marginLeft: 8 }}
              >
                <input
                  type="checkbox"
                  disabled={
                    tag.status === 'retired' && !step.tagIds.includes(tag.id)
                  }
                  checked={step.tagIds.includes(tag.id)}
                  onChange={() => {
                    toggle(tag.id, step.tagIds, (next) => {
                      setSteps((current) =>
                        current.map((candidate) =>
                          candidate.id === step.id
                            ? { ...candidate, tagIds: next }
                            : candidate
                        )
                      );
                    });
                  }}
                />
                {tag.name} · {tag.color}
              </label>
            ))}
          </fieldset>
        ))}
      </div>
      <button
        type="button"
        data-testid="workflow-authoring-add-step"
        onClick={() => {
          setSteps((current) => [
            ...current,
            {
              id: `draft-step:${crypto.randomUUID()}`,
              title: '',
              position: current.length,
              tagIds: [],
            },
          ]);
        }}
      >
        {t('workflow-authoring.add-step')}
      </button>
      <button
        type="button"
        data-testid="workflow-authoring-save"
        onClick={() => {
          run(save);
        }}
      >
        {t('workflow-authoring.save')}
      </button>
      {selected && (
        <>
          <button
            type="button"
            data-testid="workflow-authoring-publish"
            disabled={selected.status === 'published'}
            onClick={() => {
              run(publish);
            }}
          >
            {t('workflow-authoring.publish')}
          </button>
          <label>
            {t('workflow-authoring.household')}
            <select
              data-testid="workflow-authoring-household"
              value={householdId}
              onChange={(event) => {
                setHouseholdId(event.target.value);
              }}
            >
              <option value="">
                {t('workflow-authoring.choose-household')}
              </option>
              {(crmHome?.workflowHouseholds ?? []).map((household) => (
                <option key={household.id} value={household.id}>
                  {household.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            data-testid="workflow-authoring-start"
            disabled={selected.status !== 'published' || !householdId}
            onClick={() => {
              run(start);
            }}
          >
            {t('workflow-authoring.start')}
          </button>
        </>
      )}
      {message && <p data-testid="workflow-authoring-message">{message}</p>}
    </section>
  );
}
