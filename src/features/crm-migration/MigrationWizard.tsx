/* eslint-disable lantern-i18n/no-hardcoded-string -- frozen CRM copy */
import { useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { crmMigrationImport } from '@/platform/utils/wealthbox-commands';
import { ClipboardList, Download, FileArchive, Save } from 'lucide-react';
import { Button } from '@/ui/kp';
import { SurfaceHeader } from '@/ui/SurfaceHeader';
import {
  LIVE_CRM_RECORDS_CHANGED,
  useLiveCrmRecords,
} from '@/platform/crm/useLiveCrmRecords';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';
import { createTemplate, startWorkflow } from '@/features/crm-home/workflowLive';
import { useCrmHomeSurfaceContext } from '@/features/crm-home/surfaceContext';
import { AdapterMigrationWizard } from './AdapterMigrationWizard';
import { SelfServiceImportWizard } from './SelfServiceImportWizard';

const panel = {
  border: '1px solid var(--kp-border)', borderRadius: 'var(--radius-lg)',
  background: 'var(--kp-surface)', padding: 'var(--kp-space-md)',
} as const;

type MatrixRow = { sourceType: string; fetched: number; imported: number; skipped: number; rejected: number; plainReason?: string | null };
type MigrationReport = LiveCrmRecord & { kind: 'migration_report'; sourceProvider?: string; externalIdField?: string; matrix?: MatrixRow[]; attachments?: { viaApi?: string; affected?: number; exported?: number; gaps?: number; unaccounted?: number }; message?: string };
type Checklist = LiveCrmRecord & { kind: 'migration_workflow_checklist'; clientLabel?: string; sourceTemplateLabel?: string; availableSteps?: string[]; decision?: string };
type AttachmentRecord = LiveCrmRecord & { kind: 'migration_attachment_accounting'; clientLabel?: string; status?: string; gapReason?: string; gapOwnerUserId?: string };
type ExportRecord = LiveCrmRecord & { kind: 'migration_export'; exportKind?: string; status?: string; filePath?: string; byteLength?: number };

function asRecords<T extends LiveCrmRecord>(records: readonly LiveCrmRecord[], kind: string) {
  return records.filter((record): record is T => record.kind === kind);
}

function displayText(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function importedHouseholdMatterId(record: LiveCrmRecord): string {
  const matterId = record.matterId?.trim();
  return matterId && matterId !== 'firm' && matterId !== 'firm_home'
    ? matterId
    : record.id;
}

/** A real, restart-safe view over the Rust importer.  The screen only renders
 * records from the encrypted CRM store; it never fabricates an import result. */
function LiveMigrationWizard() {
  const live = useLiveCrmRecords();
  const [baseUrl, setBaseUrl] = useState('http://127.0.0.1:8788/v1');
  const [sourceIdMap, setSourceIdMap] = useState('external_id');
  const [source, setSource] = useState('Wealthbox');
  const [view, setView] = useState<'start' | 'fidelity' | 'notes' | 'workflows' | 'attachments' | 'archive' | 'rollback'>('start');
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [latestExport, setLatestExport] = useState<ExportRecord | null>(null);
  const [showSelfServiceImport, setShowSelfServiceImport] = useState(false);

  const reports = asRecords<MigrationReport>(live.records, 'migration_report');
  const report = reports.find((item) => item.sourceProvider === source.toLowerCase()) ?? reports.at(-1);
  const selfServiceReport = reports.find((item) => item.sourceProvider === 'self-service');
  const checklists = asRecords<Checklist>(live.records, 'migration_workflow_checklist');
  const attachments = asRecords<AttachmentRecord>(live.records, 'migration_attachment_accounting');
  const exports = asRecords<ExportRecord>(live.records, 'migration_export');
  const noteGaps = live.records.filter((record) => record.kind === 'migration_note_gap');
  const households = live.records.filter((record) => record.kind === 'household').map((record) => ({
    id: record.id,
    matterId: importedHouseholdMatterId(record),
    label: displayText(record['name'], displayText(record['label'], 'Imported household')),
  }));
  const selectedExport = exports.find((record) => record.exportKind === (view === 'rollback' ? 'rollback' : 'archive')) ?? latestExport;

  const importSource = async (nextSource: string) => {
    setBusy(true); setStatus(null);
    try {
      const result = await crmMigrationImport<{ imported: number; unchanged: number }>({ baseUrl: baseUrl.trim(), source: nextSource.toLowerCase(), sourceIdField: sourceIdMap.trim() });
      await live.reload();
      // The importer writes through Rust, outside this surface hook's normal
      // save path. Tell the always-mounted Home shell to reload too, so the
      // imported client and recreated-workflow records appear immediately.
      window.dispatchEvent(new Event(LIVE_CRM_RECORDS_CHANGED));
      setSource(nextSource); setView('fidelity');
      setStatus(`Import finished. ${String(result.imported)} records were checked; ${String(result.unchanged)} were already here, so the re-run changed nothing.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally { setBusy(false); }
  };

  const saveWorkflow = async (item: Checklist) => {
    const select = document.querySelector<HTMLSelectElement>(`[data-testid="crm-workflow-step-${item.id}"]`);
    const name = document.querySelector<HTMLInputElement>(`[data-testid="crm-workflow-instance-${item.id}"]`)?.value.trim();
    const chosen = select?.value;
    const sourceSteps = Array.isArray(item.availableSteps) ? item.availableSteps : [];
    if (sourceSteps.length < 2) {
      await live.save({ ...item, decision: 'gap', gapReason: 'The source did not provide readable workflow steps, so Lantern did not invent a replacement.', recordedAt: new Date().toISOString() });
      setStatus('Checklist recorded as a trace gap. No workflow was recreated because the source did not provide readable steps.');
      await live.reload();
      return;
    }
    if (!name || !chosen) { setStatus('Choose a source step and name the resulting workflow first.'); return; }
    const household = households.find((candidate) => candidate.id === item['householdId']) ?? households[0];
    if (!household) { setStatus('The imported workflow needs a client before it can be recreated.'); return; }
    const template = createTemplate(name, [chosen]);
    const instance = startWorkflow(template, household);
    await live.save(template); await live.save(instance);
    await live.save({ ...item, decision: 'recreated', resultingWorkflowInstanceId: instance.id, recordedAt: new Date().toISOString() });
    setStatus('Checklist recorded. The resulting workflow is now open in Lantern.');
    await live.reload();
  };

  const saveAttachment = async (item: AttachmentRecord) => {
    const statusElement = document.querySelector<HTMLSelectElement>(`[data-testid="crm-attachment-status-${item.id}"]`);
    const reason = document.querySelector<HTMLInputElement>(`[data-testid="crm-attachment-reason-${item.id}"]`)?.value.trim();
    const owner = document.querySelector<HTMLInputElement>(`[data-testid="crm-attachment-owner-${item.id}"]`)?.value.trim();
    if (!statusElement?.value || (statusElement.value === 'gap' && !reason)) { setStatus('Explain an attachment gap before saving it.'); return; }
    await live.save({ ...item, status: statusElement.value, gapReason: reason || undefined, gapOwnerUserId: owner || undefined, recordedAt: new Date().toISOString() });
    setStatus('Attachment status recorded.'); await live.reload();
  };

  const createExport = async () => {
    const kind = view === 'rollback' ? 'rollback' : 'archive';
    setBusy(true); setStatus(null);
    try {
      const exported = await invoke<ExportRecord>('crm_migration_export', { kind });
      setLatestExport(exported);
      await live.reload();
      setStatus(`Exported ${kind} file.`);
      if (!exported.filePath) setStatus('The export did not return a real file path.');
    } catch (error) { setStatus(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };

  const fidelityRows = useMemo(() => report?.matrix ?? [], [report]);
  if (showSelfServiceImport) return <div data-testid="crm-migration-surface" style={{ padding: 'var(--kp-space-xl)', overflow: 'auto', width: '100%', display: 'grid', gap: 'var(--kp-space-md)', alignContent: 'start' }}>
    <SurfaceHeader Icon={ClipboardList} title="Migration" description="Bring records over carefully, with a saved review trail" />
    <SelfServiceImportWizard live={live} onClose={() => { setShowSelfServiceImport(false); }} />
  </div>;
  return <div data-testid="crm-migration-surface" style={{ padding: 'var(--kp-space-xl)', overflow: 'auto', width: '100%', display: 'grid', gap: 'var(--kp-space-md)', alignContent: 'start' }}>
    <SurfaceHeader Icon={ClipboardList} title="Migration" description="Bring records over carefully, with a saved review trail" />
    <section style={panel} data-testid="crm-self-service-import-start">
      <h2 style={{ marginTop: 0 }}>Import a contact file</h2>
      <p>Have a spreadsheet, vCard, or Outlook contacts export? Match its columns, preview the contacts, and save only when you are ready.</p>
      <Button data-testid="crm-self-service-import-open" iconLeft={ClipboardList} onClick={() => { setShowSelfServiceImport(true); }}>Import CSV, Excel, vCard, or Outlook</Button>
      {selfServiceReport && <p data-testid="crm-self-service-saved-report" style={{ marginBottom: 0 }}>Last saved contact import: {selfServiceReport.message ?? 'A contact import was completed.'}</p>}
    </section>
    <section style={panel}>
      <h2 style={{ marginTop: 0 }}>Connect a source</h2>
      <p>Choose a prepared sample source, then import it into this encrypted workspace. Redtail and Salesforce samples use the same protected landing path; they are not live connections.</p>
      <label>Source API address<input data-testid="crm-migration-base-url" value={baseUrl} onChange={(event) => { setBaseUrl(event.target.value); }} /></label>
      <label style={{ display: 'block', marginTop: 8 }}>Outside ID field<input data-testid="crm-migration-source-id-map" value={sourceIdMap} onChange={(event) => { setSourceIdMap(event.target.value); }} /></label>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
        <Button data-testid="crm-migration-run-import" iconLeft={Save} disabled={busy} onClick={() => void importSource('Wealthbox')}>Import Wealthbox sample</Button>
        <Button data-testid="crm-redtail-import" variant="secondary" disabled={busy} onClick={() => void importSource('Redtail')}>Import Redtail sample</Button>
        <Button data-testid="crm-salesforce-import" variant="secondary" disabled={busy} onClick={() => void importSource('Salesforce')}>Import Salesforce sample</Button>
        <Button data-testid="crm-migration-fidelity" variant="secondary" onClick={() => { setView('fidelity'); }}>Review fidelity</Button>
      </div>
      <small>Stable outside ID: {report?.externalIdField ?? (sourceIdMap || 'external_id')} · current sample: {source}</small>
    </section>

    {view === 'fidelity' && <section style={panel} data-testid="crm-migration-fidelity-report">
      <h2 style={{ marginTop: 0 }}>Fidelity report</h2>
      <p>{report?.message ?? 'Run an import to create the report.'}</p>
      <p><strong>{report?.attachments?.viaApi ?? 'Attachments: 0% via API'}</strong> · attachments need an operator decision before cutover.</p>
      <p>{attachments.some((item) => item.status === 'pending') ? 'Not ready to switch yet. Finish the open workflow and attachment checks.' : 'Review the saved checklist decisions before switching.'}</p>
      <div style={{ overflowX: 'auto' }}><table><thead><tr><th>Record type</th><th>Found</th><th>Imported</th><th>Skipped</th><th>What to do</th></tr></thead><tbody>{fidelityRows.map((row) => <tr key={row.sourceType} data-testid={`crm-fidelity-row-${row.sourceType}`}><td>{row.sourceType.replaceAll('_', ' ')}</td><td>{row.fetched}</td><td>{row.imported}</td><td>{row.skipped}</td><td>{row.plainReason ?? 'Nothing to fix'}</td></tr>)}</tbody></table></div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
        <Button data-testid="crm-migration-open-note-gaps" variant="secondary" onClick={() => { setView('notes'); }}>Review note gaps</Button>
        <Button data-testid="crm-migration-workflow-fallback" variant="secondary" onClick={() => { setView('workflows'); }}>Recreate open workflows</Button>
        <Button data-testid="crm-migration-attachment-fallback" variant="secondary" onClick={() => { setView('attachments'); }}>Account for attachments</Button>
      </div>
    </section>}

    {view === 'notes' && <section style={panel}><h2 style={{ marginTop: 0 }}>Notes to check</h2>{noteGaps.length ? noteGaps.map((item) => <p key={item.id}>{displayText(item['label'], 'Unlinked note')}: {displayText(item['reason'], 'No client link')}</p>) : <p>There are no unlinked notes in this sample.</p>}</section>}
    {view === 'workflows' && <section style={panel}><h2 style={{ marginTop: 0 }}>Open work to recreate</h2>{checklists.length ? checklists.map((item) => { const hasSteps = Array.isArray(item.availableSteps) && item.availableSteps.length > 1; return <div key={item.id} style={{ borderTop: '1px solid var(--kp-border)', paddingTop: 12, marginTop: 12 }}><p><strong>{item.sourceTemplateLabel ?? 'Imported workflow'}</strong> for {item.clientLabel ?? 'an imported client'}</p><Button data-testid={`crm-workflow-evidence-${item.id}`} variant="secondary" onClick={() => { setStatus('Evidence: imported workflow or project trace.'); }}>Show source evidence</Button>{hasSteps ? <><label style={{ display: 'block', marginTop: 8 }}>Source step<select data-testid={`crm-workflow-step-${item.id}`} defaultValue=""><option value="">Choose a proven source step</option>{item.availableSteps?.map((step) => <option key={step} value={step}>{step}</option>)}</select></label><label style={{ display: 'block', marginTop: 8 }}>New Lantern workflow name<input data-testid={`crm-workflow-instance-${item.id}`} /></label></> : <p data-testid={`crm-workflow-no-steps-${item.id}`}>No readable source steps were available. Record this as a trace gap; Lantern will not invent a workflow.</p>}<Button data-testid={`crm-workflow-record-${item.id}`} style={{ marginTop: 8 }} onClick={() => void saveWorkflow(item)}>{hasSteps ? 'Create resulting instance' : 'Record trace gap'}</Button></div>; }) : <p>No open workflow traces need recreation.</p>}</section>}
    {view === 'attachments' && <section style={panel}><h2 style={{ marginTop: 0 }}>Attachment accounting</h2><p>Attachments are not available from this source API. Record what was exported separately or why it remains a gap.</p>{attachments.map((item) => <div key={item.id} style={{ borderTop: '1px solid var(--kp-border)', paddingTop: 12, marginTop: 12 }}><strong>{displayText(item.clientLabel, displayText(item['householdId'], 'Imported client'))}</strong><label style={{ display: 'block', marginTop: 8 }}>Status<select data-testid={`crm-attachment-status-${item.id}`} defaultValue={item.status ?? 'pending'}><option value="pending">Still checking</option><option value="exported">Exported separately</option><option value="gap">Gap to resolve</option></select></label><label style={{ display: 'block', marginTop: 8 }}>Reason or export location<input data-testid={`crm-attachment-reason-${item.id}`} defaultValue={item.gapReason ?? ''} /></label><label style={{ display: 'block', marginTop: 8 }}>Owner<input data-testid={`crm-attachment-owner-${item.id}`} defaultValue={item.gapOwnerUserId ?? ''} /></label><Button data-testid={`crm-attachment-record-save-${item.id}`} style={{ marginTop: 8 }} onClick={() => void saveAttachment(item)}>Save attachment decision</Button></div>)}</section>}

    <section style={panel}><h2 style={{ marginTop: 0 }}>Keep a portable copy</h2><p>Create a real file from the saved import report. Archive is a readable snapshot; rollback is a source-shaped CSV to review before use.</p><div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><Button data-testid="crm-migration-archive" variant="secondary" iconLeft={FileArchive} onClick={() => { setView('archive'); }}>Create archive</Button><Button data-testid="crm-migration-rollback" variant="secondary" onClick={() => { setView('rollback'); }}>Create rollback file</Button><Button data-testid="crm-export-create" iconLeft={Download} disabled={busy} onClick={() => void createExport()}>Save export file</Button></div>{selectedExport?.filePath && <p data-testid="crm-export-file">Saved file: {selectedExport.filePath} · {String(selectedExport.byteLength ?? 0)} bytes</p>}</section>
    {status && <p role="status" data-testid="crm-migration-status">{status}</p>}
  </div>;
}

export function MigrationWizard() {
  const { adapter, adapterProvided, navigate, route } = useCrmHomeSurfaceContext();
  if (adapterProvided) {
    return <AdapterMigrationWizard route={route} freshness={adapter.freshness} migration={adapter.migration} onNavigate={(next) => { navigate(next); }} actions={adapter.actions} />;
  }
  return <LiveMigrationWizard />;
}
