import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useFirmTagStore, type FirmTagStore } from '@/features/crm-tags';
import { isEnabled } from '@/platform/flags';
import { useLiveCrmRecords } from '@/platform/crm/useLiveCrmRecords';
import type { WorkflowRuleContext } from '@/features/crm-workflows/workflowExtensionRegistry';
import type {
  WorkflowAuthoringStep,
  WorkflowAuthoringTemplate,
} from './contract';
import {
  createWorkflowAuthoringStore,
  type LiveWorkflowAuthoringPort,
} from './templateStore';

const panel = {
  borderTop: '1px solid var(--kp-border)',
  marginTop: 16,
  paddingTop: 16,
} as const;

type StoreFactory = (
  port: LiveWorkflowAuthoringPort,
  catalog: FirmTagStore['catalog']
) => ReturnType<typeof createWorkflowAuthoringStore>;

/** Registered outer gate: do not create a data hook or adapter while dark. */
export function WorkflowAuthoringRuleMount({
  context,
  createStore = createWorkflowAuthoringStore,
  createTagStore = useFirmTagStore,
}: {
  context: WorkflowRuleContext;
  createStore?: StoreFactory;
  createTagStore?: () => FirmTagStore;
}) {
  if (!isEnabled('workflow-authoring')) return null;
  return (
    <EnabledWorkflowAuthoring
      context={context}
      createStore={createStore}
      createTagStore={createTagStore}
    />
  );
}

function EnabledWorkflowAuthoring({
  context,
  createStore,
  createTagStore,
}: {
  context: WorkflowRuleContext;
  createStore: StoreFactory;
  createTagStore: () => FirmTagStore;
}) {
  const { t } = useTranslation();
  const port = useLiveCrmRecords();
  const tagStore = createTagStore();
  const store = createStore(port, tagStore.catalog);
  const refreshKey = `${port.workspaceRoot ?? ''}:${port.error ?? ''}:${port.records.map((record) => record.id).join('|')}:${tagStore.catalog.tags.map((tag) => `${tag.id}:${tag.status}:${tag.name}`).join('|')}`;
  const lastLoadedKey = useRef<string | null>(null);
  const [templates, setTemplates] = useState<
    readonly WorkflowAuthoringTemplate[]
  >([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [steps, setSteps] = useState<WorkflowAuthoringStep[]>([]);
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [householdId, setHouseholdId] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const selected =
    templates.find((template) => template.id === selectedId) ?? null;
  const select = (template: WorkflowAuthoringTemplate) => {
    setSelectedId(template.id);
    setTitle(template.title);
    setTagIds([...template.tagIds]);
    setSteps(
      template.steps.map((step) => ({ ...step, tagIds: [...step.tagIds] }))
    );
  };
  useEffect(() => {
    if (lastLoadedKey.current === refreshKey) return;
    lastLoadedKey.current = refreshKey;
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
          if (next) select(next);
        })
        .catch((error: unknown) => {
          if (mounted)
            setMessage(
              error instanceof Error
                ? error.message
                : t('workflow-authoring.error')
            );
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
  const save = async () => {
    try {
      setMessage(null);
      const next = selected
        ? await store.update({ id: selected.id, title, tagIds, steps })
        : await store.create({
            title,
            tagIds,
            steps: steps.map((step) => ({
              title: step.title,
              tagIds: step.tagIds,
            })),
          });
      await tagStore.list();
      setTemplates(await store.list());
      select(next);
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
      const next = await store.publish(selected.id);
      setTemplates(await store.list());
      select(next);
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
      await store.start(selected.id, householdId);
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
    setTitle('');
    setTagIds([]);
    setSteps([
      {
        id: `new-step-${String(Date.now())}`,
        title: '',
        position: 0,
        tagIds: [],
      },
    ]);
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
            {template.title}
          </button>
        ))}
      </div>
      <label style={{ display: 'block', marginTop: 12 }}>
        {t('workflow-authoring.template-title')}
        <input
          data-testid="workflow-authoring-title"
          value={title}
          onChange={(event) => {
            setTitle(event.target.value);
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
            <span data-tag-color={tag.color}>{tag.name}</span>
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
                {tag.name}
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
              id: `new-step-${String(Date.now())}`,
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
            <input
              data-testid="workflow-authoring-household"
              value={householdId}
              onChange={(event) => {
                setHouseholdId(event.target.value);
              }}
            />
          </label>
          <button
            type="button"
            data-testid="workflow-authoring-start"
            disabled={selected.status !== 'published'}
            onClick={() => {
              run(start);
            }}
          >
            {t('workflow-authoring.start')}
          </button>
        </>
      )}
      {message && <p data-testid="workflow-authoring-message">{message}</p>}
      <span hidden data-context-template={context.template.id} />
    </section>
  );
}
