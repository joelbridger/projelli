import { useMemo, useState } from 'react';
import { ClipboardCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SurfaceHeader } from '@/ui/SurfaceHeader';
import { Card, SearchField } from '@/ui/kp';
import { useFlag } from '@/platform/flags';
import { useLiveCrmRecords } from '@/platform/crm/useLiveCrmRecords';
import {
  filterFormActivity,
  selectFormActivity,
  type FormActivityStatus,
} from './selectors';

const statusValues: readonly FormActivityStatus[] = [
  'unmatched',
  'matched',
  'created',
  'rejected',
];

function formatTimestamp(value: string, locale: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(locale, {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(date);
}

export function FormActivitySurface() {
  const { t, i18n } = useTranslation();
  const enabled = useFlag('form-activity');
  const live = useLiveCrmRecords();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<FormActivityStatus | 'all'>('all');
  const [audience, setAudience] = useState<
    'internal' | 'client-facing' | 'all'
  >('all');
  const entries = useMemo(
    () => selectFormActivity(live.records),
    [live.records]
  );
  const visibleEntries = useMemo(
    () => filterFormActivity(entries, query, status, audience),
    [audience, entries, query, status]
  );

  if (!enabled) return null;

  return (
    <div
      data-testid="form-activity-surface"
      style={{ padding: 'var(--kp-space-xl)', overflow: 'auto', width: '100%' }}
    >
      <SurfaceHeader
        Icon={ClipboardCheck}
        title={t('form-activity.title')}
        description={t('form-activity.description')}
      />
      <Card
        variant="raised"
        data-testid="form-activity-card"
        style={{ marginTop: 'var(--kp-space-md)' }}
      >
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 8,
            marginBottom: 14,
          }}
        >
          <SearchField
            data-testid="form-activity-search"
            aria-label={t('form-activity.search-label')}
            value={query}
            onChange={setQuery}
            onClear={() => {
              setQuery('');
            }}
            placeholder={t('form-activity.search-placeholder')}
            style={{ flex: '1 1 240px' }}
          />
          <select
            data-testid="form-activity-status-filter"
            aria-label={t('form-activity.status-filter')}
            className="kp-chip kp-chip--sm is-active"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as FormActivityStatus | 'all');
            }}
          >
            <option value="all">{t('form-activity.all-statuses')}</option>
            {statusValues.map((value) => (
              <option key={value} value={value}>
                {t(`form-activity.status.${value}`)}
              </option>
            ))}
          </select>
          <select
            data-testid="form-activity-audience-filter"
            aria-label={t('form-activity.source-filter')}
            className="kp-chip kp-chip--sm"
            value={audience}
            onChange={(event) => {
              setAudience(
                event.target.value as 'internal' | 'client-facing' | 'all'
              );
            }}
          >
            <option value="all">{t('form-activity.all-sources')}</option>
            <option value="client-facing">
              {t('form-activity.source.client-facing')}
            </option>
            <option value="internal">
              {t('form-activity.source.internal')}
            </option>
          </select>
        </div>
        {live.error && (
          <p
            role="alert"
            data-testid="form-activity-error"
            style={{ color: 'var(--kp-danger)' }}
          >
            {t('form-activity.load-error')}
          </p>
        )}
        <div style={{ overflowX: 'auto' }}>
          <table
            data-testid="form-activity-table"
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              textAlign: 'left',
            }}
          >
            <thead>
              <tr style={{ background: 'var(--kp-accent-softer)' }}>
                {[
                  'form',
                  'submitter',
                  'contact',
                  'submitted',
                  'status-label',
                ].map((column) => (
                  <th
                    key={column}
                    scope="col"
                    style={{
                      borderBottom: '1px solid var(--color-border)',
                      padding: '8px 6px',
                      fontSize: 'var(--kp-font-sm)',
                    }}
                  >
                    {t(`form-activity.${column}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleEntries.map((entry) => (
                <tr
                  key={entry.id}
                  data-testid={`form-activity-row-${entry.id}`}
                >
                  <td style={cellStyle}>
                    <strong>{entry.formName}</strong>
                    <div style={mutedStyle}>
                      {t(`form-activity.source.${entry.audience}`)}
                    </div>
                  </td>
                  <td style={cellStyle}>
                    {entry.submitterLabel ?? t('form-activity.no-submitter')}
                  </td>
                  <td style={cellStyle}>
                    {entry.contact ? (
                      <a
                        href={`#contact-${encodeURIComponent(entry.contact.id)}`}
                      >
                        {entry.contact.label}
                      </a>
                    ) : (
                      t('form-activity.no-contact')
                    )}
                  </td>
                  <td style={cellStyle}>
                    {formatTimestamp(entry.submittedAt, i18n.language)}
                  </td>
                  <td style={cellStyle}>
                    <span className="kp-chip kp-chip--sm">
                      {t(`form-activity.status.${entry.status}`)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!live.error && visibleEntries.length === 0 && (
          <p
            data-testid="form-activity-empty"
            role="status"
            style={{ color: 'var(--kp-text-muted)' }}
          >
            {entries.length === 0
              ? t('form-activity.empty')
              : t('form-activity.no-results')}
          </p>
        )}
      </Card>
    </div>
  );
}

const cellStyle = {
  borderBottom: '1px solid var(--color-border)',
  padding: '10px 6px',
  verticalAlign: 'top',
};

const mutedStyle = {
  color: 'var(--kp-text-muted)',
  fontSize: 'var(--kp-font-sm)',
  marginTop: 3,
};
