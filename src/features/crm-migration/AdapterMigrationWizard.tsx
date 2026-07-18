/* eslint-disable lantern-i18n/no-hardcoded-string -- Frozen CRM screen copy needs its translation catalog in a separate product change. */
import { useState } from 'react';
import { Activity, Download, FileArchive, Flag, Workflow } from 'lucide-react';
import { Button } from '@/ui/kp';
import { FreshnessBanner, Screen, mutedStyle, panelStyle } from '@/features/crm-home/shared/ui';
import type { CrmHomeRoute } from '@/features/crm-home/routes';
import type { AttachmentAccountingRecord, CrmFreshnessState, CrmHomeAdapter, ExportJobStatus, MigrationFidelityReport, MigrationNoteGap, MigrationWorkflowChecklist } from '@/features/crm-home/types';

export function AdapterMigrationWizard({
  route,
  freshness,
  migration,
  onNavigate,
  actions,
}: {
  route: CrmHomeRoute;
  freshness: CrmFreshnessState;
  migration: CrmHomeAdapter['migration'];
  onNavigate: (route: CrmHomeRoute) => void;
  actions: CrmHomeAdapter['actions'];
}) {
  const [parallel, setParallel] = useState(false);
  const [baseUrl, setBaseUrl] = useState('http://127.0.0.1:8788/v1');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    setRunning(true);
    setError(null);
    try {
      await actions.runMigrationImport?.(baseUrl);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setRunning(false);
    }
  };
  const exportKind =
    route === 'archive-export'
      ? 'archive'
      : route === 'rollback-export'
        ? 'rollback'
        : null;
  if (exportKind)
    return (
      <ExportReadiness
        job={
          migration.exports.find((job) => job.kind === exportKind) ?? {
            kind: exportKind,
            status: 'failed',
            failureReason: 'No export job was supplied by the CRM data engine.',
          }
        }
        onCreate={() => actions.createExport?.(exportKind)}
        onRetry={() => actions.retryExport?.(exportKind)}
      />
    );
  if (route === 'workflow-recreation')
    return (
      <WorkflowFallbackChecklist
        records={migration.workflowChecklists}
        onRecord={(record) => actions.recordWorkflowChecklist?.(record)}
        error={error}
        onError={(reason) => {
          setError(
            reason === null
              ? null
              : reason instanceof Error
                ? reason.message
                : typeof reason === 'string'
                  ? reason
                  : 'The workflow decision could not be saved.'
          );
        }}
      />
    );
  if (route === 'attachment-accounting')
    return (
      <AttachmentFallbackChecklist
        records={migration.attachmentAccounting}
        onRecord={(record) => actions.recordAttachmentAccounting?.(record)}
      />
    );
  if (route === 'fidelity')
    return (
      <FidelityReport
        onNavigate={onNavigate}
        {...(migration.noteGaps ? { noteGaps: migration.noteGaps } : {})}
        {...(migration.report ? { report: migration.report } : {})}
      />
    );
  return (
    <Screen
      title="Wealthbox migration"
      description="Bring your firm’s records over safely"
      Icon={Activity}
      action={
        <Button
          data-testid="crm-migration-fidelity"
          disabled={!migration.report}
          onClick={() => {
            onNavigate('fidelity');
          }}
        >
          Review import report
        </Button>
      }
    >
      <FreshnessBanner freshness={freshness} />
      <section style={panelStyle}>
        <strong>
          {migration.report
            ? 'Import finished'
            : 'Connect the test source and import'}
        </strong>
        <p style={mutedStyle}>
          {migration.report
            ? migration.report.message
            : 'This test source only contains made-up Northcrest firm data.'}
        </p>
        <label style={{ display: 'block', marginBottom: 10 }}>
          Test source address{' '}
          <input
            data-testid="crm-migration-base-url"
            value={baseUrl}
            onChange={(event) => {
              setBaseUrl(event.target.value);
            }}
            style={{ display: 'block', width: 'min(620px, 100%)' }}
          />
        </label>
        <Button
          data-testid="crm-migration-run-import"
          disabled={running}
          onClick={() => {
            void run();
          }}
        >
          {running
            ? 'Importing…'
            : migration.report
              ? 'Run import again'
              : 'Run import'}
        </Button>
        {error && (
          <p data-testid="crm-migration-error" role="alert">
            {error}
          </p>
        )}
      </section>
      <section style={panelStyle}>
        <strong>Use both systems while you check the import</strong>
        <p style={mutedStyle}>
          Lantern brings over only what it can read safely. When it cannot tell
          where an active workflow is, it asks your firm to decide instead of
          guessing.
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button
            variant="secondary"
            data-testid="crm-migration-archive"
            disabled={!migration.report}
            iconLeft={FileArchive}
            onClick={() => {
              onNavigate('archive-export');
            }}
          >
            Save a backup
          </Button>
          <Button
            variant="secondary"
            data-testid="crm-migration-rollback"
            disabled={!migration.report}
            iconLeft={Download}
            onClick={() => {
              onNavigate('rollback-export');
            }}
          >
            Prepare a return file
          </Button>
          <Button
            data-testid="crm-migration-start-parallel"
            disabled={parallel || !migration.report}
            onClick={() => {
              setParallel(true);
            }}
          >
            {parallel ? 'Both systems are in use' : 'Start using both systems'}
          </Button>
        </div>
      </section>
      <section style={panelStyle}>
        <strong>What your firm needs to decide</strong>
        <p style={mutedStyle}>
          If something cannot be brought over, the report gives you a clear next
          step. Nothing is hidden behind technical error names.
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button
            variant="secondary"
            data-testid="crm-migration-workflow-fallback"
            disabled={!migration.report}
            onClick={() => {
              onNavigate('workflow-recreation');
            }}
          >
            Rebuild active workflows
          </Button>
          <Button
            variant="secondary"
            data-testid="crm-migration-attachment-fallback"
            disabled={!migration.report}
            onClick={() => {
              onNavigate('attachment-accounting');
            }}
          >
            Account for attachments
          </Button>
        </div>
      </section>
    </Screen>
  );
}

function FidelityReport({
  onNavigate,
  report,
  noteGaps = [],
}: {
  onNavigate: (route: CrmHomeRoute) => void;
  report?: MigrationFidelityReport;
  noteGaps?: readonly MigrationNoteGap[];
}) {
  const [showNotes, setShowNotes] = useState(false);
  if (!report)
    return (
      <Screen
        title="Import report"
        description="No import has run yet"
        Icon={Flag}
      >
        <p>Run the import first.</p>
      </Screen>
    );
  const skippedNotes =
    report.matrix.find((row) => row.sourceType === 'note')?.skipped ?? 0;
  const workflowNeedsAttention = report.workflows.pending;
  const attachmentNeedsAttention = report.attachments.unaccounted;
  const decisionCount =
    skippedNotes + workflowNeedsAttention + attachmentNeedsAttention;
  const labelFor = (sourceType: string) =>
    ({
      contact: 'Clients',
      note: 'Notes',
      task: 'Tasks',
      event: 'Events',
      opportunity: 'Opportunities',
      project: 'Projects',
      workflow_template: 'Workflow templates',
      workflow: 'Active workflows',
      custom_field: 'Custom fields',
      attachment: 'Attachments',
    })[sourceType] ?? sourceType.replaceAll('_', ' ');
  return (
    <Screen
      title="Import report"
      description={new Date(report.generatedAt).toLocaleString()}
      Icon={Flag}
    >
      <section
        data-testid="crm-migration-decision-dashboard"
        style={panelStyle}
      >
        <strong>
          {decisionCount > 0
            ? `Not ready to switch yet: ${String(decisionCount)} item${decisionCount === 1 ? '' : 's'} need your firm’s decision.`
            : 'Your import has no open migration decisions.'}
        </strong>
        <p style={mutedStyle}>
          Nothing is hidden. Resolve each item below before you switch systems.
        </p>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: 10,
          }}
        >
          <section
            style={{ ...panelStyle, background: 'var(--color-background)' }}
          >
            <strong>
              {String(skippedNotes)} note{skippedNotes === 1 ? '' : 's'} we
              could not bring over
            </strong>
            <p style={mutedStyle}>
              These notes were not safely linked to a client. Check them in
              Wealthbox, then add any important note to the right household.
            </p>
            <Button
              variant="secondary"
              data-testid="crm-migration-open-note-gaps"
              onClick={() => {
                setShowNotes((open) => !open);
              }}
            >
              {showNotes ? 'Close note list' : 'Review these notes'}
            </Button>
          </section>
          <section
            style={{ ...panelStyle, background: 'var(--color-background)' }}
          >
            <strong>
              {String(workflowNeedsAttention)} active workflow
              {workflowNeedsAttention === 1 ? '' : 's'} to rebuild
            </strong>
            <p style={mutedStyle}>
              Choose the current step for each household, then rebuild its
              remaining work in Lantern.
            </p>
            <Button
              variant="secondary"
              data-testid="crm-migration-workflow-fallback"
              onClick={() => {
                onNavigate('workflow-recreation');
              }}
            >
              Rebuild these workflows
            </Button>
          </section>
          <section
            style={{ ...panelStyle, background: 'var(--color-background)' }}
          >
            <strong>
              {String(attachmentNeedsAttention)} attachment
              {attachmentNeedsAttention === 1 ? '' : 's'} to account for
            </strong>
            <p style={mutedStyle}>
              Mark each attachment as exported, or explain what is missing and
              who owns the follow-up.
            </p>
            <Button
              variant="secondary"
              data-testid="crm-migration-attachment-fallback"
              onClick={() => {
                onNavigate('attachment-accounting');
              }}
            >
              Account for attachments
            </Button>
          </section>
        </div>
        {showNotes && (
          <section
            data-testid="crm-migration-note-gap-list"
            style={{
              borderTop: '1px solid var(--kp-border)',
              marginTop: 12,
              paddingTop: 12,
            }}
          >
            <strong>Notes to check</strong>
            {noteGaps.length === 0 ? (
              <p style={mutedStyle}>
                {skippedNotes === 0
                  ? 'No notes need review.'
                  : 'This import recorded the count but not note titles. Open the saved migration archive to find them.'}
              </p>
            ) : (
              noteGaps.map((note) => (
                <p key={note.id}>
                  <strong>{note.label}</strong>
                  <span style={mutedStyle}> · {note.reason}</span>
                </p>
              ))
            )}
          </section>
        )}
      </section>
      <section style={panelStyle}>
        <strong>What came over</strong>
        <p style={mutedStyle}>{report.message}</p>
        <div data-testid="crm-fidelity-matrix">
          {report.matrix.map((row) => (
            <section
              key={row.sourceType}
              data-testid={`crm-fidelity-row-${row.sourceType}`}
              style={{
                borderTop: '1px solid var(--kp-border)',
                padding: '8px 0',
              }}
            >
              <strong>{labelFor(row.sourceType)}</strong>
              <span>
                {' '}
                · {row.fetched} found · {row.imported} imported · {row.skipped}{' '}
                not imported
              </span>
              {row.plainReason ? (
                <p role="alert" style={mutedStyle}>
                  {row.plainReason}
                </p>
              ) : null}
            </section>
          ))}
        </div>
      </section>
    </Screen>
  );
}

function WorkflowFallbackChecklist({
  records,
  onRecord,
  error,
  onError,
}: {
  records: readonly MigrationWorkflowChecklist[];
  onRecord: (record: MigrationWorkflowChecklist) => void | Promise<void>;
  error: string | null;
  onError: (reason: unknown) => void;
}) {
  const [drafts, setDrafts] = useState(records);
  const [saved, setSaved] = useState<ReadonlySet<string>>(() => new Set());
  const update = (id: string, change: Partial<MigrationWorkflowChecklist>) => {
    setDrafts((current) =>
      current.map((record) =>
        record.id === id ? { ...record, ...change } : record
      )
    );
  };
  const complete = (record: MigrationWorkflowChecklist) =>
    record.evidenceReviewed &&
    record.selectedCurrentStep &&
    (record.decision === 'recreate' ||
      (record.decision === 'gap' && record.gapReason));
  const recordChecklist = async (record: MigrationWorkflowChecklist) => {
    onError(null);
    try {
      await onRecord(record);
      setSaved((current) => new Set(current).add(record.id));
    } catch (reason) {
      onError(reason);
    }
  };
  return (
    <Screen
      title="Rebuild active workflows"
      description="Finish this before switching systems"
      Icon={Workflow}
    >
      <p style={mutedStyle}>
        We could not safely read where these workflows are today. Review the
        evidence below, choose the current step, then rebuild the remaining work
        or explain why it cannot be rebuilt.
      </p>
      {error && (
        <p data-testid="crm-migration-error" role="alert">
          {error}
        </p>
      )}
      {drafts.map((record) => (
        <section
          key={record.id}
          data-testid={`crm-workflow-checklist-${record.id}`}
          style={panelStyle}
        >
          <strong>
            {record.clientLabel} · {record.sourceTemplateLabel}
          </strong>
          <p style={mutedStyle}>
            What we found:{' '}
            {record.activityEvidence.join(' · ') ||
              'No readable history is available'}
          </p>
          <label>
            <input
              data-testid={`crm-workflow-evidence-${record.id}`}
              type="checkbox"
              checked={Boolean(record.evidenceReviewed)}
              onChange={(event) => {
                update(record.id, { evidenceReviewed: event.target.checked });
              }}
            />{' '}
            I reviewed what was available
          </label>
          <label style={{ display: 'block', marginTop: 8 }}>
            Current step{' '}
            <select
              data-testid={`crm-workflow-step-${record.id}`}
              value={record.selectedCurrentStep ?? ''}
              onChange={(event) => {
                update(record.id, { selectedCurrentStep: event.target.value });
              }}
            >
              <option value="">Choose the current step</option>
              {record.availableSteps.map((step) => (
                <option key={step}>{step}</option>
              ))}
            </select>
          </label>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <Button
              size="sm"
              variant={record.decision === 'recreate' ? 'primary' : 'secondary'}
              onClick={() => {
                update(record.id, { decision: 'recreate' });
              }}
            >
              Rebuild this workflow
            </Button>
            <Button
              size="sm"
              variant={record.decision === 'gap' ? 'primary' : 'secondary'}
              onClick={() => {
                update(record.id, { decision: 'gap' });
              }}
            >
              Explain why it cannot be rebuilt
            </Button>
          </div>
          {record.decision === 'recreate' ? (
            <label style={{ display: 'block', marginTop: 8 }}>
              New workflow name{' '}
              <input
                data-testid={`crm-workflow-instance-${record.id}`}
                value={record.resultingInstanceLabel ?? ''}
                onChange={(event) => {
                  update(record.id, {
                    resultingInstanceLabel: event.target.value,
                  });
                }}
              />
            </label>
          ) : record.decision === 'gap' ? (
            <label style={{ display: 'block', marginTop: 8 }}>
              Why it cannot be rebuilt{' '}
              <input
                data-testid={`crm-workflow-gap-${record.id}`}
                value={record.gapReason ?? ''}
                onChange={(event) => {
                  update(record.id, { gapReason: event.target.value });
                }}
              />
            </label>
          ) : null}
          <Button
            data-testid={`crm-workflow-record-${record.id}`}
            style={{ marginTop: 10 }}
            disabled={!complete(record)}
            onClick={() => {
              void recordChecklist(record);
            }}
          >
            Save this decision
          </Button>
          {saved.has(record.id) && (
            <p data-testid={`crm-workflow-recorded-${record.id}`} role="status">
              Decision saved
            </p>
          )}
        </section>
      ))}
    </Screen>
  );
}

function AttachmentFallbackChecklist({
  records,
  onRecord,
}: {
  records: readonly AttachmentAccountingRecord[];
  onRecord: (record: AttachmentAccountingRecord) => void | Promise<void>;
}) {
  const [drafts, setDrafts] = useState(records);
  const [saved, setSaved] = useState<ReadonlySet<string>>(() => new Set());
  const update = (id: string, change: Partial<AttachmentAccountingRecord>) => {
    setDrafts((current) =>
      current.map((record) =>
        record.id === id ? { ...record, ...change } : record
      )
    );
  };
  const complete = (record: AttachmentAccountingRecord) =>
    (record.status === 'exported' &&
      record.exportSource &&
      record.exportedBy) ||
    (record.status === 'gap' && record.gapReason && record.gapOwner);
  const recordAttachment = async (record: AttachmentAccountingRecord) => {
    await onRecord(record);
    setSaved((current) => new Set(current).add(record.id));
  };
  return (
    <Screen
      title="Attachment accounting"
      description="Required through cutover"
      Icon={FileArchive}
    >
      <p style={mutedStyle}>
        Every affected client needs exactly one complete record. An absence is
        never silently treated as no attachment.
      </p>
      {drafts.map((record) => (
        <section
          key={record.id}
          data-testid={`crm-attachment-record-${record.id}`}
          style={panelStyle}
        >
          <strong>{record.clientLabel}</strong>
          <label style={{ display: 'block', marginTop: 8 }}>
            Status{' '}
            <select
              data-testid={`crm-attachment-status-${record.id}`}
              value={record.status}
              onChange={(event) => {
                update(record.id, {
                  status: event.target
                    .value as AttachmentAccountingRecord['status'],
                });
              }}
            >
              <option value="pending">Choose a status</option>
              <option value="exported">Exported</option>
              <option value="gap">Attachment gap</option>
            </select>
          </label>
          {record.status === 'exported' ? (
            <>
              <label style={{ display: 'block', marginTop: 8 }}>
                Export source{' '}
                <input
                  data-testid={`crm-attachment-source-${record.id}`}
                  value={record.exportSource ?? ''}
                  onChange={(event) => {
                    update(record.id, { exportSource: event.target.value });
                  }}
                />
              </label>
              <label style={{ display: 'block', marginTop: 8 }}>
                Operator{' '}
                <input
                  data-testid={`crm-attachment-operator-${record.id}`}
                  value={record.exportedBy ?? ''}
                  onChange={(event) => {
                    update(record.id, { exportedBy: event.target.value });
                  }}
                />
              </label>
            </>
          ) : record.status === 'gap' ? (
            <>
              <label style={{ display: 'block', marginTop: 8 }}>
                Gap reason{' '}
                <input
                  data-testid={`crm-attachment-reason-${record.id}`}
                  value={record.gapReason ?? ''}
                  onChange={(event) => {
                    update(record.id, { gapReason: event.target.value });
                  }}
                />
              </label>
              <label style={{ display: 'block', marginTop: 8 }}>
                Gap owner{' '}
                <input
                  data-testid={`crm-attachment-owner-${record.id}`}
                  value={record.gapOwner ?? ''}
                  onChange={(event) => {
                    update(record.id, { gapOwner: event.target.value });
                  }}
                />
              </label>
            </>
          ) : null}
          <Button
            data-testid={`crm-attachment-record-save-${record.id}`}
            style={{ marginTop: 10 }}
            disabled={!complete(record)}
            onClick={() => {
              void recordAttachment(record);
            }}
          >
            Record this client’s attachment status
          </Button>
          {saved.has(record.id) && (
            <p
              data-testid={`crm-attachment-recorded-${record.id}`}
              role="status"
            >
              Attachment status recorded
            </p>
          )}
        </section>
      ))}
    </Screen>
  );
}

function ExportReadiness({
  job,
  onCreate,
  onRetry,
}: {
  job: ExportJobStatus;
  onCreate: () => void;
  onRetry: () => void;
}) {
  const kind = job.kind;
  return (
    <Screen
      title={`${kind === 'archive' ? 'Archive' : 'Rollback'} export`}
      description="Prepare an export without changing a connector account"
      Icon={kind === 'archive' ? FileArchive : Download}
    >
      <section style={panelStyle}>
        <strong>
          {job.status === 'ready'
            ? 'Ready to prepare'
            : job.status === 'preparing'
              ? 'Preparing export'
              : job.status === 'exported'
                ? 'Exported'
                : 'Failed — retry available'}
        </strong>
        <ul>
          {kind === 'archive' ? (
            <>
              <li>Manifest present</li>
              <li>Raw-capture checksums verified</li>
              <li>Fidelity counts matched</li>
              <li>Storage destination selected</li>
            </>
          ) : (
            <>
              <li>Full check complete</li>
              <li>Current report saved</li>
              <li>Eligible Lantern changes counted</li>
              <li>Destination format checked</li>
              <li>Known unsupported items listed</li>
            </>
          )}
        </ul>
        {job.status === 'exported' ? (
          <>
            <p data-testid="crm-exported-status">
              Exported {job.exportedAt ?? 'at the recorded export time'} ·{' '}
              {kind === 'archive'
                ? `Manifest ID: ${job.manifestId ?? 'missing from engine data'}`
                : `Reconciliation report: ${job.reconciliationReportId ?? 'missing from engine data'}`}
            </p>
            {job.filePath ? (
              <p data-testid="crm-export-file" style={mutedStyle}>
                Saved file: {job.filePath}
                {typeof job.byteLength === 'number'
                  ? ` · ${String(job.byteLength)} bytes`
                  : ''}
                {job.sha256 ? ` · checksum ${job.sha256}` : ''}
              </p>
            ) : (
              <p role="alert">
                The export status is saved, but no file location was recorded.
              </p>
            )}
          </>
        ) : job.status === 'failed' ? (
          <>
            <p role="alert">
              {job.failureReason ??
                'The export failed. Nothing changed in the connector account.'}
            </p>
            <Button data-testid="crm-export-retry" onClick={onRetry}>
              Retry {kind} export
            </Button>
          </>
        ) : job.status === 'preparing' ? (
          <p data-testid="crm-export-preparing" role="status">
            Preparing the export. This page will update when the CRM data engine
            records its result.
          </p>
        ) : (
          <Button data-testid="crm-export-create" onClick={onCreate}>
            Create {kind} export
          </Button>
        )}
      </section>
    </Screen>
  );
}
