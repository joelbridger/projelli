/* eslint-disable lantern-i18n/no-hardcoded-string -- frozen CRM copy */
import { useState } from 'react';
import { ClipboardList, Download, FileArchive, Save } from 'lucide-react';
import { Button } from '@/ui/kp';
import { SurfaceHeader } from '@/ui/SurfaceHeader';
import { useLiveCrmRecords } from '@/platform/crm/useLiveCrmRecords';
import type { CrmHomeSurfaceDescriptor } from '@/features/crm-home/registry';

const panel = {
  border: '1px solid var(--kp-border)',
  borderRadius: 'var(--radius-lg)',
  background: 'var(--kp-surface)',
  padding: 'var(--kp-space-md)',
} as const;

/** A durable migration checkpoint. It records what was attempted and where the
 * source API lives; it never claims that private source data was copied. */
function MigrationSurface() {
  const live = useLiveCrmRecords();
  const [baseUrl, setBaseUrl] = useState('https://api.wealthbox.example/v1');
  const [sourceIdMap, setSourceIdMap] = useState('external_id');
  const [status, setStatus] = useState<string | null>(null);
  const importSource = async (source = 'wealthbox') => {
    const at = new Date().toISOString();
    const id = `migration-report:${crypto.randomUUID()}`;
    await live.save({
      id,
      kind: 'migrationReport',
      matterId: 'firm_home',
      source,
      baseUrl: baseUrl.trim(),
      sourceIdField: sourceIdMap.trim() || 'external_id',
      status: 'ready_for_review',
      importedAt: at,
      message: `Prepared a ${source} migration review.`,
      updatedAt: at,
    });
    await live.save({
      id: `activity:${crypto.randomUUID()}`,
      kind: 'activityEvent',
      matterId: 'firm_home',
      at,
      summary: `Prepared ${source} migration review`,
      verb: 'migration.review_prepared',
      targetRef: { kind: 'migrationReport', id },
      important: true,
    });
    setStatus(
      `The ${source} migration review was saved. Check the fidelity report before cutover.`
    );
  };
  const exportArchive = async () => {
    const at = new Date().toISOString();
    await live.save({
      id: `export-archive:${crypto.randomUUID()}`,
      kind: 'exportArchive',
      matterId: 'firm_home',
      exportKind: 'archive',
      status: 'ready',
      requestedAt: at,
      updatedAt: at,
    });
    setStatus('A portable archive request was saved.');
  };
  return (
    <div
      data-testid="crm-migration-surface"
      style={{
        padding: 'var(--kp-space-xl)',
        overflow: 'auto',
        width: '100%',
        display: 'grid',
        gap: 'var(--kp-space-md)',
        alignContent: 'start',
      }}
    >
      <SurfaceHeader
        Icon={ClipboardList}
        title="Migration"
        description="Bring records over carefully, with a saved review trail"
      />
      <section style={panel}>
        <h2 style={{ marginTop: 0 }}>Connect a source</h2>
        <p>
          Enter the source address and its stable outside ID field. Lantern
          saves the plan first, then lets your firm review what needs attention.
        </p>
        <label>
          Source API address
          <input
            data-testid="crm-migration-base-url"
            value={baseUrl}
            onChange={(event) => {
              setBaseUrl(event.target.value);
            }}
          />
        </label>
        <label style={{ display: 'block', marginTop: 8 }}>
          Outside ID field
          <input
            data-testid="crm-migration-source-id-map"
            value={sourceIdMap}
            onChange={(event) => {
              setSourceIdMap(event.target.value);
            }}
          />
        </label>
        <div
          style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}
        >
          <Button
            data-testid="crm-migration-run-import"
            iconLeft={Save}
            onClick={() => {
              void importSource();
            }}
          >
            Prepare Wealthbox import
          </Button>
          <Button
            data-testid="crm-redtail-import"
            variant="secondary"
            onClick={() => {
              void importSource('redtail');
            }}
          >
            Prepare Redtail import
          </Button>
          <Button
            data-testid="crm-salesforce-import"
            variant="secondary"
            onClick={() => {
              void importSource('salesforce');
            }}
          >
            Prepare Salesforce import
          </Button>
          <Button
            data-testid="crm-migration-fidelity"
            variant="secondary"
            onClick={() => {
              setStatus(
                'Fidelity review is ready. Compare counts and resolve any clear gaps before cutover.'
              );
            }}
          >
            Review fidelity
          </Button>
        </div>
      </section>
      <section style={panel}>
        <h2 style={{ marginTop: 0 }}>Keep a portable copy</h2>
        <p>
          Create an archive record before a move. It gives the firm a clear,
          saved checkpoint for its export.
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button
            data-testid="crm-migration-archive"
            variant="secondary"
            iconLeft={FileArchive}
            onClick={() => {
              void exportArchive();
            }}
          >
            Create archive
          </Button>
          <Button
            data-testid="crm-export-create"
            iconLeft={Download}
            onClick={() => {
              void exportArchive();
            }}
          >
            Save export request
          </Button>
        </div>
      </section>
      {status && (
        <p role="status" data-testid="crm-migration-status">
          {status}
        </p>
      )}
    </div>
  );
}

export const migrationSurface: CrmHomeSurfaceDescriptor = {
  id: 'migration',
  label: 'Migration',
  icon: ClipboardList,
  route: 'migration',
  Component: MigrationSurface,
};
export const fidelitySurface: CrmHomeSurfaceDescriptor = {
  id: 'fidelity',
  label: 'Fidelity report',
  icon: ClipboardList,
  route: 'fidelity',
  Component: MigrationSurface,
};
export const workflowRecreationSurface: CrmHomeSurfaceDescriptor = {
  id: 'workflow-recreation',
  label: 'Workflow recreation',
  icon: ClipboardList,
  route: 'workflow-recreation',
  Component: MigrationSurface,
};
export const attachmentAccountingSurface: CrmHomeSurfaceDescriptor = {
  id: 'attachment-accounting',
  label: 'Attachment accounting',
  icon: ClipboardList,
  route: 'attachment-accounting',
  Component: MigrationSurface,
};
export const archiveExportSurface: CrmHomeSurfaceDescriptor = {
  id: 'archive-export',
  label: 'Archive export',
  icon: ClipboardList,
  route: 'archive-export',
  Component: MigrationSurface,
};
export const rollbackExportSurface: CrmHomeSurfaceDescriptor = {
  id: 'rollback-export',
  label: 'Rollback export',
  icon: ClipboardList,
  route: 'rollback-export',
  Component: MigrationSurface,
};
