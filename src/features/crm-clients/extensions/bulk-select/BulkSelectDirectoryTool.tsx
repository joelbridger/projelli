import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/ui/kp';
import { useFlag } from '@/platform/flags/router';
import type { DirectoryContext } from '../../directoryRegistry';
import { useBulkSelection } from './selectionStore';

function visibleHouseholds(context: DirectoryContext) {
  if (context.sort.value === 'book' || context.filters.tab !== 'households')
    return [];
  const query = context.query.value.trim().toLowerCase();
  return context.records.households.filter(
    (household) => !query || household.name.toLowerCase().includes(query)
  );
}

function BulkSelectDirectoryToolEnabled({
  context,
}: {
  context: DirectoryContext;
}) {
  const { t } = useTranslation();
  const selection = useBulkSelection();
  const visible = useMemo(() => visibleHouseholds(context), [context]);
  const visibleIds = useMemo(() => visible.map(({ id }) => id), [visible]);
  const availableIds = useMemo(
    () => context.records.households.map(({ id }) => id),
    [context.records.households]
  );
  const availableKey = availableIds.join('\u0000');

  useEffect(() => {
    selection.reconcileSelection(availableIds);
  }, [availableIds, availableKey, selection]);

  const selected = new Set(selection.selectedHouseholdIds);

  return (
    <div
      aria-label={t('bulkSelect.label')}
      data-testid="crm-directory-bulk-select"
      style={{
        alignItems: 'center',
        display: 'flex',
        flexWrap: 'wrap',
        gap: 8,
      }}
    >
      <label>
        <span className="sr-only">{t('bulkSelect.selectOne')}</span>
        <select
          aria-label={t('bulkSelect.selectOne')}
          data-testid="crm-directory-bulk-select-one"
          onChange={(event) => {
            selection.toggleHousehold(event.target.value);
          }}
          value=""
        >
          <option value="">{t('bulkSelect.selectOne')}</option>
          {visible.map((household) => (
            <option key={household.id} value={household.id}>
              {selected.has(household.id)
                ? t('bulkSelect.selectedOption', { name: household.name })
                : household.name}
            </option>
          ))}
        </select>
      </label>
      <Button
        data-testid="crm-directory-bulk-select-visible"
        disabled={visibleIds.length === 0}
        onClick={() => {
          selection.selectVisibleHouseholds(visibleIds);
        }}
        size="sm"
        variant="secondary"
      >
        {t('bulkSelect.selectVisible')}
      </Button>
      <Button
        data-testid="crm-directory-bulk-select-all"
        disabled={availableIds.length === 0}
        onClick={() => {
          selection.selectAllHouseholds(availableIds);
        }}
        size="sm"
        variant="secondary"
      >
        {t('bulkSelect.selectAll')}
      </Button>
      <span aria-live="polite" data-testid="crm-directory-bulk-selected-count">
        {t('bulkSelect.count', { count: selection.selectedCount })}
      </span>
      <Button
        data-testid="crm-directory-bulk-clear"
        disabled={selection.selectedCount === 0}
        onClick={() => {
          selection.clearSelection();
        }}
        size="sm"
        variant="secondary"
      >
        {t('bulkSelect.clear')}
      </Button>
    </div>
  );
}

/**
 * The outer registry mount is intentionally inert while the flag is dark.
 * Do not move directory reads, selection subscriptions, effects, or repository
 * calls above this guard: disabled CRM remains the unchanged directory.
 */
export function BulkSelectDirectoryTool({
  context,
}: {
  context: DirectoryContext;
}) {
  const enabled = useFlag('crm-bulk-select');
  if (!enabled) return null;
  return <BulkSelectDirectoryToolEnabled context={context} />;
}
