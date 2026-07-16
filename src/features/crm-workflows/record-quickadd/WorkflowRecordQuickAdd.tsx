import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card } from '@/ui/kp';
import { isEnabled } from '@/platform/flags';
import {
  openWorkflowTemplateLibrary,
  useWorkflowTemplateStore,
  WorkflowTemplateError,
  type WorkflowRecordStartContext,
  type WorkflowTemplateRecord,
} from '@/features/crm-workflows';

/** The outer gate stays inert before the canonical workflow store is created. */
export function WorkflowRecordQuickAdd(context: WorkflowRecordStartContext) {
  if (!isEnabled('workflow-record-quickadd')) return null;
  return <EnabledWorkflowRecordQuickAdd context={context} />;
}

function errorMessage(cause: unknown, fallback: string): string {
  if (cause instanceof WorkflowTemplateError) return cause.message;
  return cause instanceof Error ? cause.message : fallback;
}

function EnabledWorkflowRecordQuickAdd({
  context,
}: {
  context: WorkflowRecordStartContext;
}) {
  const { t } = useTranslation();
  const store = useWorkflowTemplateStore();
  const storeRef = useRef(store);
  const startingRef = useRef(false);
  const consumedRef = useRef(false);
  const templateListKeyRef = useRef<string | null>(null);
  const [templates, setTemplates] = useState<readonly WorkflowTemplateRecord[]>(
    []
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  storeRef.current = store;

  useEffect(() => {
    startingRef.current = false;
    consumedRef.current = false;
    templateListKeyRef.current = null;
    setTemplates([]);
    setSelectedId(null);
    setLoading(true);
    setMessage(null);
  }, [context.request]);

  useEffect(() => {
    let current = true;
    void store
      .list()
      .then((items) => {
        if (!current) return;
        const nextKey = JSON.stringify(items);
        if (templateListKeyRef.current === nextKey) return;
        templateListKeyRef.current = nextKey;
        setTemplates(items);
        setSelectedId((currentId) => {
          const currentTemplate = items.find(
            (template) => template.id === currentId
          );
          return currentTemplate?.status === 'published'
            ? currentId
            : (items.find((template) => template.status === 'published')?.id ??
                null);
        });
      })
      .catch((cause: unknown) => {
        if (current) setMessage(errorMessage(cause, t('workflow-record-quickadd.errors.load')));
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [context.request, store, t]);

  const consume = () => {
    if (consumedRef.current) return;
    consumedRef.current = true;
    context.onRequestConsumed();
  };

  const start = async () => {
    if (!selectedId || startingRef.current || consumedRef.current) return;
    startingRef.current = true;
    setStarting(true);
    setMessage(null);
    try {
      await storeRef.current.start(selectedId, context.household);
      consume();
    } catch (cause: unknown) {
      startingRef.current = false;
      setMessage(errorMessage(cause, t('workflow-record-quickadd.errors.start')));
    } finally {
      setStarting(false);
    }
  };

  const published = templates.filter(
    (template) => template.status === 'published'
  );

  return (
    <section
      data-testid="workflow-record-quickadd"
      aria-label={t('workflow-record-quickadd.title')}
      style={{ position: 'fixed', inset: '10% 12%', overflow: 'auto', zIndex: 10 }}
    >
      <Card variant="raised" style={{ display: 'grid', gap: 16, padding: 20 }}>
        <div style={{ alignItems: 'start', display: 'flex', gap: 8, justifyContent: 'space-between' }}>
          <div>
            <h2 style={{ margin: 0 }}>{t('workflow-record-quickadd.title')}</h2>
            <p style={{ margin: '4px 0 0' }}>
              {t('workflow-record-quickadd.bound-household', {
                household: context.household.label,
              })}
            </p>
          </div>
          <Button
            variant="secondary"
            data-testid="workflow-record-quickadd-cancel"
            onClick={consume}
          >
            {t('workflow-record-quickadd.cancel')}
          </Button>
        </div>

        {loading ? <p role="status">{t('workflow-record-quickadd.loading')}</p> : null}
        {message ? <p role="alert">{message}</p> : null}

        {!loading && published.length === 0 ? (
          <section data-testid="workflow-record-quickadd-empty">
            <strong>{t('workflow-record-quickadd.empty.title')}</strong>
            <p>{t('workflow-record-quickadd.empty.description')}</p>
            <Button
              variant="secondary"
              data-testid="workflow-record-quickadd-open-library"
              onClick={() => openWorkflowTemplateLibrary(context)}
            >
              {t('workflow-record-quickadd.empty.action')}
            </Button>
          </section>
        ) : null}

        {templates.length > 0 ? (
          <fieldset style={{ border: '1px solid var(--kp-border)', borderRadius: 8, padding: 12 }}>
            <legend>{t('workflow-record-quickadd.choose')}</legend>
            {templates.map((template) => {
              const available = template.status === 'published';
              return (
                <label
                  key={template.id}
                  data-testid={`workflow-record-quickadd-template-${template.id}`}
                  style={{ alignItems: 'center', display: 'flex', gap: 8, padding: '8px 0' }}
                >
                  <input
                    type="radio"
                    name="workflow-record-quickadd-template"
                    value={template.id}
                    checked={selectedId === template.id}
                    disabled={!available}
                    onChange={() => {
                      setSelectedId(template.id);
                      setMessage(null);
                    }}
                  />
                  <span>{template.name}</span>
                  <small>
                    {available
                      ? t('workflow-record-quickadd.published')
                      : t('workflow-record-quickadd.draft')}
                  </small>
                </label>
              );
            })}
          </fieldset>
        ) : null}

        {published.length > 0 ? (
          <Button
            data-testid="workflow-record-quickadd-start"
            disabled={!selectedId || starting || consumedRef.current}
            onClick={() => {
              void start().catch((cause: unknown) => {
                setMessage(errorMessage(cause, t('workflow-record-quickadd.errors.start')));
              });
            }}
          >
            {starting
              ? t('workflow-record-quickadd.starting')
              : t('workflow-record-quickadd.start')}
          </Button>
        ) : null}
      </Card>
    </section>
  );
}
