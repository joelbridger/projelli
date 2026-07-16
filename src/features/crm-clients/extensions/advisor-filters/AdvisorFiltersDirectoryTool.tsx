import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  projectDirectoryResults,
  type DirectoryFeatureContext,
} from '@/features/crm-clients';
import { useFlag } from '@/platform/flags/router';
import {
  EMPTY_ADVISOR_FILTERS,
  hasAdvisorFilters,
  readAdvisorFilters,
  type AdvisorFilterPreference,
  advisorFilterPreferences,
} from './filterState';

type FilterKey = keyof AdvisorFilterPreference;

function uniqueValues(values: readonly string[]): readonly string[] {
  return [...new Set(values.filter(Boolean))].sort((left, right) =>
    left.localeCompare(right),
  );
}

function AdvisorFiltersDirectoryToolEnabled({
  context,
}: {
  context: DirectoryFeatureContext<AdvisorFilterPreference>;
}) {
  const { t } = useTranslation();
  const savedFilters = useRef<AdvisorFilterPreference>();
  const [filters, setFilters] = useState<AdvisorFilterPreference>(() => {
    const saved = readAdvisorFilters();
    savedFilters.current = saved;
    return saved;
  });
  const initializedStatePort = useRef(false);
  const [isOpen, setIsOpen] = useState(false);
  const active = hasAdvisorFilters(filters);
  const options = useMemo(() => ({
    primaryAdvisor: uniqueValues(context.records.households.map(({ primaryAdvisor }) => primaryAdvisor)),
    serviceTier: uniqueValues(context.records.households.map(({ serviceTier }) => serviceTier)),
    lifecycle: uniqueValues(context.records.households.map(({ lifecycle }) => lifecycle)),
  }), [context.records.households]);
  const matchingHouseholds = projectDirectoryResults(
    'household',
    context.records.households,
    context,
  );

  useEffect(() => {
    if (initializedStatePort.current) return;
    initializedStatePort.current = true;
    context.featureState.set(savedFilters.current ?? EMPTY_ADVISOR_FILTERS);
  }, [context.featureState]);

  const save = (next: AdvisorFilterPreference) => {
    advisorFilterPreferences.save(next);
    setFilters(next);
    context.featureState.set(next);
  };
  const setFilter = (key: FilterKey, value: string) => {
    save({ ...filters, [key]: value || null });
  };
  const removeFilter = (key: FilterKey) => {
    save({ ...filters, [key]: null });
  };

  const fields: readonly {
    key: FilterKey;
    label: string;
    allLabel: string;
    values: readonly string[];
  }[] = [
    {
      key: 'primaryAdvisor',
      label: t('advisorFilters.primaryAdvisor'),
      allLabel: t('advisorFilters.allPrimaryAdvisors'),
      values: options.primaryAdvisor,
    },
    {
      key: 'serviceTier',
      label: t('advisorFilters.serviceTier'),
      allLabel: t('advisorFilters.allServiceTiers'),
      values: options.serviceTier,
    },
    {
      key: 'lifecycle',
      label: t('advisorFilters.lifecycle'),
      allLabel: t('advisorFilters.allLifecycles'),
      values: options.lifecycle,
    },
  ];

  return (
    <div data-testid="crm-directory-advisor-filters">
      <button
        aria-expanded={isOpen}
        aria-controls="crm-directory-advisor-filter-panel"
        data-testid="crm-directory-advisor-filters-toggle"
        onClick={() => {
          setIsOpen((open) => !open);
        }}
        type="button"
      >
        {t('advisorFilters.open')}
      </button>
      {active ? (
        <div aria-label={t('advisorFilters.applied')} data-testid="crm-directory-advisor-filter-chips">
          {fields.flatMap((field) => {
            const value = filters[field.key];
            return value === null ? [] : [
              <span key={field.key}>
                {t('advisorFilters.chip', { field: field.label, value })}
                <button
                  aria-label={t('advisorFilters.removeLabel', { label: field.label })}
                  onClick={() => {
                    removeFilter(field.key);
                  }}
                  type="button"
                >
                  {t('advisorFilters.remove')}
                </button>
              </span>,
            ];
          })}
          <button
            data-testid="crm-directory-advisor-filters-reset"
            onClick={() => {
              save(EMPTY_ADVISOR_FILTERS);
            }}
            type="button"
          >
            {t('advisorFilters.reset')}
          </button>
        </div>
      ) : null}
      {isOpen ? (
        <fieldset id="crm-directory-advisor-filter-panel">
          <legend>{t('advisorFilters.heading')}</legend>
          {fields.map((field) => (
            <label key={field.key}>
              {field.label}
              <select
                aria-label={field.label}
                data-testid={`crm-directory-advisor-filter-${field.key}`}
                onChange={(event) => {
                  setFilter(field.key, event.target.value);
                }}
                value={filters[field.key] ?? ''}
              >
                <option value="">{field.allLabel}</option>
                {field.values.map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
          ))}
        </fieldset>
      ) : null}
      {active && matchingHouseholds.length === 0 ? (
        <p aria-live="polite" data-testid="crm-directory-advisor-filters-empty" role="status">
          {t('advisorFilters.empty')}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Nothing below this guard reads directory data or saved preferences while the
 * flag is off. Keeping the work in the enabled child also leaves no toolbar
 * wrapper for a dark feature.
 */
export function AdvisorFiltersDirectoryTool({
  context,
}: {
  context: DirectoryFeatureContext<AdvisorFilterPreference>;
}) {
  const enabled = useFlag('crm-advisor-filters');
  if (!enabled) return null;
  return <AdvisorFiltersDirectoryToolEnabled context={context} />;
}
