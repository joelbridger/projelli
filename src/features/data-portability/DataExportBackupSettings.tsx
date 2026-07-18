import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Download } from 'lucide-react';
import { Badge, Button, Callout } from '@/ui/kp';
import { useWorkspaceStore } from '@/platform/fs/workspaceStore';
import {
  createVerifiedMigrationArchive,
  type VerifiedMigrationArchive,
} from './migrationArchive';

const panel = {
  border: '1px solid var(--kp-border)',
  borderRadius: 'var(--radius-lg)',
  background: 'var(--kp-surface)',
  padding: 'var(--kp-space-md)',
} as const;

const muted = {
  color: 'var(--kp-text-faint)',
  fontSize: 'var(--kp-font-sm)',
} as const;

function formatBytes(bytes: number): string {
  return new Intl.NumberFormat(undefined).format(bytes);
}

export function DataExportBackupSettings() {
  const { t } = useTranslation();
  const workspaceRoot = useWorkspaceStore((state) => state.rootPath);
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<VerifiedMigrationArchive | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canExport = Boolean(workspaceRoot) && !busy;

  const createArchive = async () => {
    if (!workspaceRoot || busy) return;
    setBusy(true);
    setReceipt(null);
    setError(null);
    try {
      setReceipt(await createVerifiedMigrationArchive(workspaceRoot));
    } catch {
      setError(t('data-portability.needs-review-error'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      data-testid="data-portability-settings"
      style={{ display: 'grid', gap: 'var(--kp-space-md)', maxWidth: 880 }}
    >
      <header>
        <h2 style={{ margin: 0 }}>{t('data-portability.title')}</h2>
        <p style={muted}>{t('data-portability.description')}</p>
      </header>

      <Callout variant="warning" icon={AlertTriangle}>
        <div style={{ display: 'grid', gap: 6 }}>
          <Badge data-testid="firm-backup-unavailable" variant="warning">
            {t('data-portability.backup-unavailable')}
          </Badge>
          <strong>{t('data-portability.not-a-backup-title')}</strong>
          <span>{t('data-portability.not-a-backup-description')}</span>
          <strong>{t('data-portability.excludes-title')}</strong>
          <ul
            data-testid="migration-archive-excludes"
            style={{ margin: 0, paddingInlineStart: 22 }}
          >
            <li>{t('data-portability.excludes-documents')}</li>
            <li>{t('data-portability.excludes-email')}</li>
            <li>{t('data-portability.excludes-records')}</li>
          </ul>
          <span>{t('data-portability.decrypted-warning')}</span>
        </div>
      </Callout>

      <div style={panel}>
        <h3 style={{ marginTop: 0 }}>{t('data-portability.includes-title')}</h3>
        <ul data-testid="migration-archive-includes">
          <li>{t('data-portability.includes-records')}</li>
          <li>{t('data-portability.includes-manifest')}</li>
          <li>{t('data-portability.includes-fidelity')}</li>
        </ul>

        {!workspaceRoot ? (
          <p data-testid="migration-archive-workspace-required" role="status">
            {t('data-portability.workspace-required')}
          </p>
        ) : null}

        <Button
          data-testid="migration-archive-create"
          disabled={!canExport}
          iconLeft={Download}
          onClick={() => {
            void createArchive();
          }}
        >
          {busy ? t('data-portability.creating') : t('data-portability.create')}
        </Button>
      </div>

      {error ? (
        <Callout variant="error" icon={AlertTriangle}>
          <div style={{ display: 'grid', gap: 4 }}>
            <strong>{t('data-portability.needs-review-title')}</strong>
            <span data-testid="migration-archive-error">{error}</span>
          </div>
        </Callout>
      ) : null}

      {receipt ? (
        <div data-testid="migration-archive-result" style={panel}>
          <h3 style={{ marginTop: 0 }}>{t('data-portability.saved-title')}</h3>
          <dl
            style={{
              display: 'grid',
              gridTemplateColumns: 'max-content minmax(0, 1fr)',
              gap: '8px 12px',
              marginBottom: 0,
            }}
          >
            <dt>{t('data-portability.file')}</dt>
            <dd
              data-testid="migration-archive-file"
              style={{ margin: 0, overflowWrap: 'anywhere' }}
            >
              {receipt.filePath}
            </dd>
            <dt>{t('data-portability.size')}</dt>
            <dd data-testid="migration-archive-size" style={{ margin: 0 }}>
              {t('data-portability.bytes', {
                count: receipt.byteLength,
                formattedCount: formatBytes(receipt.byteLength),
              })}
            </dd>
            <dt>{t('data-portability.record-count')}</dt>
            <dd
              data-testid="migration-archive-record-count"
              style={{ margin: 0 }}
            >
              {receipt.manifest.recordCount}
            </dd>
          </dl>
          <details style={{ marginTop: 'var(--kp-space-md)' }}>
            <summary>{t('data-portability.technical-details')}</summary>
            <dl
              style={{
                display: 'grid',
                gridTemplateColumns: 'max-content minmax(0, 1fr)',
                gap: '8px 12px',
                marginBottom: 0,
              }}
            >
              <dt>{t('data-portability.checksum')}</dt>
              <dd
                data-testid="migration-archive-checksum"
                style={{ margin: 0, overflowWrap: 'anywhere' }}
              >
                {receipt.sha256}
              </dd>
              <dt>{t('data-portability.manifest')}</dt>
              <dd
                data-testid="migration-archive-manifest"
                style={{ margin: 0 }}
              >
                {receipt.manifestId}
              </dd>
              <dt>{t('data-portability.reconciliation-report')}</dt>
              <dd data-testid="migration-archive-report" style={{ margin: 0 }}>
                {receipt.reconciliationReportId}
              </dd>
              <dt>{t('data-portability.source-types')}</dt>
              <dd
                data-testid="migration-archive-source-types"
                style={{ margin: 0 }}
              >
                {Object.entries(receipt.manifest.recordCounts)
                  .map(
                    ([sourceType, count]) => `${sourceType} (${String(count)})`
                  )
                  .join(', ')}
              </dd>
            </dl>
          </details>
        </div>
      ) : null}
    </section>
  );
}
