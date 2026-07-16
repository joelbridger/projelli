import { useCallback, useEffect, useMemo, useState } from 'react';
import { ShieldAlert, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SurfaceHeader } from '@/ui/SurfaceHeader';
import { Button, Card, SearchField } from '@/ui/kp';
import { useFlag } from '@/platform/flags';
import { useLiveCrmRecords } from '@/platform/crm/useLiveCrmRecords';
import { useFirmStore } from '@/platform/firm/firmStore';
import {
  listTrashedCrmRecords,
  restoreTrashedCrmRecord,
  type TrashedCrmRecord,
} from './trashClient';

function recordName(record: TrashedCrmRecord): string {
  const candidate =
    record.record['name'] ?? record.record['title'] ?? record.recordId;
  return typeof candidate === 'string' && candidate.trim()
    ? candidate
    : record.recordId;
}

function remainingRatio(expiresAt: string): number {
  const milliseconds = new Date(expiresAt).getTime() - Date.now();
  return Math.max(0, Math.min(1, milliseconds / (30 * 24 * 60 * 60 * 1000)));
}

function rowIdentity(record: TrashedCrmRecord): string {
  return `${encodeURIComponent(record.matterId)}--${encodeURIComponent(record.recordId)}`;
}

export function TrashRecoverySurface() {
  const enabled = useFlag('crm-trash-recovery');

  if (!enabled) return null;

  return <EnabledTrashRecoverySurface />;
}

function EnabledTrashRecoverySurface() {
  const { t } = useTranslation();
  const live = useLiveCrmRecords();
  const signedInUserId = useFirmStore((state) => state.session?.userId);
  const [records, setRecords] = useState<readonly TrashedCrmRecord[]>([]);
  const [search, setSearch] = useState('');
  const [type, setType] = useState('all');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setError(null);
      setRecords(await listTrashedCrmRecords(live.workspaceRoot));
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : t('crm.trash.load-error')
      );
    }
  }, [live.workspaceRoot, t]);

  useEffect(() => {
    reload().catch((reason: unknown) => {
      setError(
        reason instanceof Error ? reason.message : t('crm.trash.load-error')
      );
    });
  }, [reload, t]);

  const types = useMemo(
    () => [...new Set(records.map((record) => record.recordType))].sort(),
    [records]
  );
  const visibleRecords = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return records.filter(
      (record) =>
        (type === 'all' || record.recordType === type) &&
        (!query ||
          recordName(record).toLocaleLowerCase().includes(query) ||
          record.recordType.toLocaleLowerCase().includes(query))
    );
  }, [records, search, type]);

  const restore = async (record: TrashedCrmRecord) => {
    setBusyId(rowIdentity(record));
    try {
      setError(null);
      await restoreTrashedCrmRecord({
        workspaceRoot: live.workspaceRoot,
        recordId: record.recordId,
        matterId: record.matterId,
        actorId: signedInUserId ?? 'local-user',
      });
      await Promise.all([reload(), live.reload()]);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : t('crm.trash.restore-error')
      );
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div
      data-testid="crm-trash-recovery"
      style={{ padding: 'var(--kp-space-xl)', overflow: 'auto', width: '100%' }}
    >
      <SurfaceHeader
        Icon={Trash2}
        title={t('crm.trash.title')}
        description={t('crm.trash.description')}
      />
      <Card
        variant="raised"
        data-testid="crm-trash-card"
        style={{ marginTop: 'var(--kp-space-md)' }}
      >
        <div
          role="status"
          data-testid="crm-trash-admin-guard"
          style={{
            display: 'flex',
            gap: 8,
            alignItems: 'center',
            color: 'var(--kp-text-muted)',
            marginBottom: 14,
          }}
        >
          <ShieldAlert size={18} aria-hidden="true" />
          {t('crm.trash.admin-guard')}
        </div>
        <div
          style={{
            display: 'flex',
            gap: 8,
            flexWrap: 'wrap',
            marginBottom: 14,
          }}
        >
          <SearchField
            data-testid="crm-trash-search"
            aria-label={t('crm.trash.search-label')}
            value={search}
            onChange={setSearch}
            onClear={() => {
              setSearch('');
            }}
            placeholder={t('crm.trash.search-placeholder')}
            style={{ flex: '1 1 220px' }}
          />
          <select
            data-testid="crm-trash-type-filter"
            aria-label={t('crm.trash.type-filter')}
            className="kp-chip kp-chip--sm is-active"
            value={type}
            onChange={(event) => {
              setType(event.target.value);
            }}
          >
            <option value="all">
              {t('crm.trash.all-types')} · {records.length}
            </option>
            {types.map((recordType) => (
              <option key={recordType} value={recordType}>
                {recordType}
              </option>
            ))}
          </select>
        </div>
        {error && (
          <p role="alert" style={{ color: 'var(--kp-danger)' }}>
            {error}
          </p>
        )}
        <div style={{ overflowX: 'auto' }}>
          <table
            data-testid="crm-trash-table"
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              textAlign: 'left',
            }}
          >
            <thead>
              <tr style={{ background: 'var(--kp-accent-softer)' }}>
                {[
                  'record',
                  'type',
                  'deleted',
                  'time-remaining',
                  'deleted-by',
                  'recover',
                ].map((key) => (
                  <th
                    key={key}
                    scope="col"
                    style={{
                      borderBottom: '1px solid var(--color-border)',
                      padding: '8px 6px',
                      fontSize: 'var(--kp-font-sm)',
                    }}
                  >
                    {t(`crm.trash.${key}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleRecords.map((record) => {
                const identity = rowIdentity(record);
                const milliseconds =
                  new Date(record.expiresAt).getTime() - Date.now();
                const ratio = remainingRatio(record.expiresAt);
                return (
                  <tr
                    key={identity}
                    data-testid={`crm-trash-row-${identity}`}
                  >
                    <td
                      style={{
                        borderBottom: '1px solid var(--color-border)',
                        padding: '10px 6px',
                      }}
                    >
                      {recordName(record)}
                    </td>
                    <td
                      style={{
                        borderBottom: '1px solid var(--color-border)',
                        padding: '10px 6px',
                      }}
                    >
                      {record.recordType}
                    </td>
                    <td
                      style={{
                        borderBottom: '1px solid var(--color-border)',
                        padding: '10px 6px',
                      }}
                    >
                      {new Date(record.deletedAt).toLocaleDateString()}
                    </td>
                    <td
                      style={{
                        borderBottom: '1px solid var(--color-border)',
                        padding: '10px 6px',
                        minWidth: 150,
                      }}
                    >
                      <span>
                        {milliseconds <= 0
                          ? t('crm.trash.expired')
                          : t('crm.trash.days-remaining', {
                              count: Math.ceil(
                                milliseconds / (24 * 60 * 60 * 1000)
                              ),
                            })}
                      </span>
                      <span
                        data-testid={`crm-trash-meter-${identity}`}
                        aria-label={t('crm.trash.recovery-meter')}
                        style={{
                          display: 'block',
                          height: 6,
                          marginTop: 5,
                          borderRadius: 999,
                          background: 'var(--color-border)',
                        }}
                      >
                        <span
                          style={{
                            display: 'block',
                            height: '100%',
                            width: `${String(ratio * 100)}%`,
                            borderRadius: 999,
                            background: 'var(--kp-assured)',
                          }}
                        />
                      </span>
                    </td>
                    <td
                      style={{
                        borderBottom: '1px solid var(--color-border)',
                        padding: '10px 6px',
                      }}
                    >
                      {record.deletedBy}
                    </td>
                    <td
                      style={{
                        borderBottom: '1px solid var(--color-border)',
                        padding: '10px 6px',
                      }}
                    >
                      <Button
                        size="sm"
                        data-testid={`crm-trash-recover-${identity}`}
                        disabled={busyId === identity}
                        onClick={() => {
                          restore(record).catch((reason: unknown) => {
                            setError(
                              reason instanceof Error
                                ? reason.message
                                : t('crm.trash.restore-error')
                            );
                          });
                        }}
                      >
                        {t('crm.trash.recover')}
                      </Button>
                    </td>
                  </tr>
                );
              })}
              {visibleRecords.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    data-testid="crm-trash-empty"
                    style={{ padding: 14, color: 'var(--kp-text-faint)' }}
                  >
                    {t('crm.trash.empty')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
