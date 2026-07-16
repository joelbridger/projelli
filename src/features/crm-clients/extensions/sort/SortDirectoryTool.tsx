import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useFlag } from '@/platform/flags/router';
import {
  createDirectoryPreferenceStore,
  type DirectoryFeatureContext,
} from '@/features/crm-clients';
import {
  DEFAULT_SORT,
  isDirectorySortChoice,
  SORT_PREFERENCE_NAMESPACE,
  type DirectorySortChoice,
} from './sortState';

function SortDirectoryToolEnabled({
  context,
}: {
  context: DirectoryFeatureContext<DirectorySortChoice>;
}) {
  const { t } = useTranslation();
  const preferences = useMemo(
    () => createDirectoryPreferenceStore(SORT_PREFERENCE_NAMESPACE, isDirectorySortChoice),
    []
  );
  const selected = context.featureState.get();

  useEffect(() => {
    if (selected === undefined) {
      context.featureState.set(preferences.load() ?? DEFAULT_SORT);
    }
  }, [context.featureState, preferences, selected]);

  return (
    <label data-testid="crm-directory-sort">
      <span className="sr-only">{t('crmListSort.label')}</span>
      <select
        aria-label={t('crmListSort.label')}
        data-testid="crm-directory-sort-select"
        onChange={(event) => {
          const next = event.target.value;
          if (!isDirectorySortChoice(next)) return;
          preferences.save(next);
          context.featureState.set(next);
        }}
        value={selected ?? DEFAULT_SORT}
      >
        <option value="recent">{t('crmListSort.recent')}</option>
        <option value="created">{t('crmListSort.created')}</option>
        <option value="name-ascending">{t('crmListSort.nameAscending')}</option>
      </select>
    </label>
  );
}

/**
 * The outer mount stays inert while dark. Preference access and feature-state
 * work live only in the enabled child so the unintegrated contribution adds no
 * loading or DOM work while its flag is off.
 */
export function SortDirectoryTool({
  context,
}: {
  context: DirectoryFeatureContext<DirectorySortChoice>;
}) {
  const enabled = useFlag('crm-list-sort');
  if (!enabled) return null;
  return <SortDirectoryToolEnabled context={context} />;
}
