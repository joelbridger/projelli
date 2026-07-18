import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/ui/kp';
import type { DirectoryContext } from '@/features/crm-clients';
import { useBulkSelection } from '@/features/crm-clients/extensions/bulk-select';
import { useFlag } from '@/platform/flags/router';
import { createHouseholdCsv } from './csv';
import { bulkExportPreferences, readBulkExportPreference } from './preferences';

function BulkExportDirectoryActionEnabled({
  context,
}: {
  context: DirectoryContext;
}) {
  const { t } = useTranslation();
  const selection = useBulkSelection();
  const [includeHeader, setIncludeHeader] = useState(
    () => readBulkExportPreference().includeHeader,
  );
  const [csv, setCsv] = useState<string | null>(null);
  const selectedHouseholds = useMemo(() => {
    const authorizedById = new Map(
      context.records.households.map((household) => [household.id, household]),
    );
    return selection.selectedHouseholdIds.flatMap((id) => {
      const household = authorizedById.get(id);
      return household ? [household] : [];
    });
  }, [context.records.households, selection.selectedHouseholdIds]);

  const updateIncludeHeader = (next: boolean) => {
    bulkExportPreferences.save({ includeHeader: next });
    setIncludeHeader(next);
    setCsv(null);
  };
  const exportCsv = () => {
    if (selectedHouseholds.length === 0) return;
    setCsv(createHouseholdCsv(selectedHouseholds, { includeHeader }));
  };
  const downloadHref = csv === null
    ? undefined
    : `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`;

  return (
    <div data-testid="crm-directory-bulk-export" style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      <Button
        data-testid="crm-directory-bulk-export-generate"
        disabled={selectedHouseholds.length === 0}
        onClick={exportCsv}
        size="sm"
      >
        {t('bulkExport.action')}
      </Button>
      <label>
        <input
          checked={includeHeader}
          data-testid="crm-directory-bulk-export-include-header"
          onChange={(event) => {
            updateIncludeHeader(event.target.checked);
          }}
          type="checkbox"
        />
        {t('bulkExport.includeHeader')}
      </label>
      {selectedHouseholds.length === 0 ? (
        <span aria-live="polite" data-testid="crm-directory-bulk-export-empty" role="status">
          {t('bulkExport.empty')}
        </span>
      ) : null}
      {csv !== null ? (
        <>
          <a data-testid="crm-directory-bulk-export-download" download="selected-households.csv" href={downloadHref}>
            {t('bulkExport.download')}
          </a>
          <pre aria-label={t('bulkExport.output')} data-testid="crm-directory-bulk-export-output">{csv}</pre>
        </>
      ) : null}
    </div>
  );
}

/**
 * The dark outer action reads only its flag. Selection, directory records, and
 * saved preferences all stay in the enabled child so flag-off is fully inert.
 */
export function BulkExportDirectoryAction({
  context,
}: {
  context: DirectoryContext;
}) {
  const enabled = useFlag('crm-bulk-export');
  if (!enabled) return null;
  return <BulkExportDirectoryActionEnabled context={context} />;
}
