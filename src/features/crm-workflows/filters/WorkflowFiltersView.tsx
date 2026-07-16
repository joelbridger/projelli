import { useTranslation } from 'react-i18next';
import type { WorkflowAuthoringLibraryContext } from '../authoring/workflowAuthoringExtensionPoints';
import {
  EMPTY_WORKFLOW_FILTERS,
  type WorkflowFilterState,
  type WorkflowStatusFilter,
} from './contract';

function isWorkflowStatusFilter(value: string): value is WorkflowStatusFilter {
  return value === 'all' || value === 'draft' || value === 'published';
}

export function WorkflowFilterControl({
  context,
}: {
  context: WorkflowAuthoringLibraryContext<WorkflowFilterState>;
}) {
  const { t } = useTranslation();
  const filters = context.state.get() ?? EMPTY_WORKFLOW_FILTERS;
  const setFilters = (next: WorkflowFilterState) => {
    context.state.set(next);
  };

  return (
    <section
      aria-label={t('workflow-filters.title')}
      data-testid="workflow-filters-control"
      style={{
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
        display: 'grid',
        gap: 12,
        marginBottom: 12,
        padding: 12,
      }}
    >
      <strong>{t('workflow-filters.title')}</strong>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        <label style={{ display: 'grid', gap: 4 }}>
          <span>{t('workflow-filters.status.label')}</span>
          <select
            data-testid="workflow-filters-status"
            value={filters.status}
            onChange={(event) => {
              const status = event.currentTarget.value;
              if (!isWorkflowStatusFilter(status)) return;
              setFilters({
                ...filters,
                status,
              });
            }}
          >
            <option value="all">{t('workflow-filters.status.all')}</option>
            <option value="draft">{t('workflow-filters.status.draft')}</option>
            <option value="published">
              {t('workflow-filters.status.published')}
            </option>
          </select>
        </label>
        <label style={{ display: 'grid', flex: '1 1 240px', gap: 4 }}>
          <span>{t('workflow-filters.search.label')}</span>
          <input
            data-testid="workflow-filters-search"
            placeholder={t('workflow-filters.search.placeholder')}
            type="search"
            value={filters.query}
            onChange={(event) => {
              setFilters({ ...filters, query: event.target.value });
            }}
          />
        </label>
      </div>
      <p
        aria-live="polite"
        data-testid="workflow-filters-result-count"
        style={{ margin: 0 }}
      >
        {t('workflow-filters.results', {
          count: context.visibleTemplates.length,
          total: context.canonicalTemplates.length,
        })}
      </p>
      {context.visibleTemplates.length === 0 ? (
        <p
          data-testid="workflow-filters-empty"
          role="status"
          style={{ margin: 0 }}
        >
          {context.canonicalTemplates.length === 0
            ? t('workflow-filters.empty.library')
            : t('workflow-filters.empty.matches')}
        </p>
      ) : null}
    </section>
  );
}

export function WorkflowTemplateDetail({
  context,
}: {
  context: WorkflowAuthoringLibraryContext<WorkflowFilterState>;
}) {
  const { t } = useTranslation();
  const selected = context.visibleTemplates.find(
    (template) => template.id === context.selectedTemplateId
  );
  if (!selected) return null;
  const orderedSteps = selected.steps
    .slice()
    .sort((left, right) => left.position - right.position);

  return (
    <section
      aria-label={t('workflow-filters.details.title')}
      data-testid="workflow-filters-details"
      style={{
        background: 'var(--kp-bg-soft)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
        marginTop: 12,
        padding: 12,
      }}
    >
      <h4 style={{ margin: 0 }}>{selected.name}</h4>
      <p data-testid="workflow-filters-detail-status">
        {t('workflow-filters.details.status', {
          status: t(`workflow-filters.status.${selected.status}`),
        })}
      </p>
      {orderedSteps.length === 0 ? (
        <p data-testid="workflow-filters-detail-empty">
          {t('workflow-filters.details.empty')}
        </p>
      ) : (
        <ol data-testid="workflow-filters-detail-steps">
          {orderedSteps.map((step, index) => (
            <li
              data-testid={`workflow-filters-detail-step-${step.id}`}
              key={step.id}
            >
              <strong>
                {t('workflow-filters.details.step', {
                  number: index + 1,
                  title: step.title,
                })}
              </strong>
              <div>
                {t('workflow-filters.details.stable-id', { id: step.id })}
              </div>
              {step.tagIds.length > 0 ? (
                <div>
                  {t('workflow-filters.details.tag-ids', {
                    ids: step.tagIds.join(', '),
                  })}
                </div>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
