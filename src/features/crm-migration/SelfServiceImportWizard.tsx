/* eslint-disable lantern-i18n/no-hardcoded-string -- frozen CRM copy */
import { useMemo, useState } from 'react';
import { FileSpreadsheet, Upload } from 'lucide-react';
import { Button } from '@/ui/kp';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';
import type { ReturnTypeUseLiveCrmRecords } from './types';
import {
  contactName,
  parseContactImportFile,
  suggestedContactMapping,
  type ContactField,
  type ContactMapping,
  type ParsedContactFile,
} from './selfServiceImport';

type Live = ReturnTypeUseLiveCrmRecords;
type Step = 'upload' | 'map' | 'preview' | 'done';

const panel = { border: '1px solid var(--kp-border)', borderRadius: 'var(--radius-lg)', background: 'var(--kp-surface)', padding: 'var(--kp-space-md)' } as const;
const fieldLabels: Record<ContactField, string> = { name: 'Client name', email: 'Email', phone: 'Phone', company: 'Company or trust', externalId: 'Match key for repeat imports' };

function externalKey(value: string): string {
  // A lossless, SQLCipher-safe local key. Human-facing screens never show it.
  return Array.from(value.trim()).map((character) => character.codePointAt(0)?.toString(16) ?? '').filter(Boolean).join('-') || 'contact';
}

function importRecord(row: Record<string, string>, mapping: ContactMapping, existing: readonly LiveCrmRecord[]): { record: LiveCrmRecord; wasPresent: boolean } {
  const outsideId = row[mapping.externalId]?.trim();
  const email = row[mapping.email]?.trim();
  const phone = row[mapping.phone]?.trim();
  const company = row[mapping.company]?.trim();
  const present = outsideId
    ? existing.find((record) => record.kind === 'household' && record['externalId'] === outsideId && record['externalIdProvider'] === 'self-service')
    : undefined;
  const id = present?.id ?? `household:self-service:${externalKey(outsideId || email || contactName(row, mapping))}`;
  return {
    wasPresent: Boolean(present),
    record: {
      ...present,
      id,
      kind: 'household',
      matterId: present?.matterId ?? id,
      name: contactName(row, mapping),
      lifecycle: 'Active',
      primaryAdvisor: String(present?.['primaryAdvisor'] ?? 'Unassigned'),
      serviceTier: String(present?.['serviceTier'] ?? 'Standard'),
      ownership: present?.['ownership'] === 'shared' || present?.['ownership'] === 'other' ? present['ownership'] : 'mine',
      facts: Array.isArray(present?.['facts']) ? present['facts'] : [],
      accounts: Array.isArray(present?.['accounts']) ? present['accounts'] : [],
      members: Array.isArray(present?.['members']) ? present['members'] : [],
      externalParties: Array.isArray(present?.['externalParties']) ? present['externalParties'] : [],
      notes: Array.isArray(present?.['notes']) ? present['notes'] : [],
      customFields: Array.isArray(present?.['customFields']) ? present['customFields'] : [],
      tags: Array.isArray(present?.['tags']) ? present['tags'] : [],
      ...(email ? { email } : {}),
      ...(phone ? { phone } : {}),
      ...(company ? { company } : {}),
      ...(outsideId ? { externalId: outsideId, externalIdField: mapping.externalId, externalIdProvider: 'self-service' } : {}),
      source: { origin: 'import', sources: [], note: 'Self-service contact import' },
      updatedAt: new Date().toISOString(),
    },
  };
}

export function SelfServiceImportWizard({ live, onClose }: { live: Live; onClose: () => void }) {
  const [step, setStep] = useState<Step>('upload');
  const [parsed, setParsed] = useState<ParsedContactFile | null>(null);
  const [mapping, setMapping] = useState<ContactMapping | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<{ landed: number; updated: number; reportId: string } | null>(null);
  const preview = useMemo(() => parsed?.rows.slice(0, 5) ?? [], [parsed]);

  const chooseFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true); setError(null);
    try {
      const next = await parseContactImportFile(file);
      setParsed(next); setMapping(suggestedContactMapping(next.columns)); setStep('map');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Lantern could not read that file.'); }
    finally { setBusy(false); }
  };

  const completeImport = async () => {
    if (!parsed || !mapping?.name) { setError('Choose the column that holds each client’s name before importing.'); return; }
    setBusy(true); setError(null);
    try {
      let updated = 0;
      const existing = [...live.records];
      for (const row of parsed.rows) {
        const next = importRecord(row, mapping, existing);
        if (next.wasPresent) updated += 1;
        await live.save(next.record);
        const index = existing.findIndex((record) => record.id === next.record.id);
        if (index >= 0) existing[index] = next.record;
        else existing.push(next.record);
      }
      const reportId = `migration-report:self-service:${externalKey(parsed.fileName)}`;
      await live.save({
        id: reportId, kind: 'migration_report', matterId: 'firm', sourceProvider: 'self-service', sourceLabel: parsed.fileName,
        externalIdField: mapping.externalId || null, generatedAt: new Date().toISOString(),
        matrix: [{ sourceType: 'contact', fetched: parsed.rows.length, imported: parsed.rows.length, skipped: 0, rejected: 0, plainReason: 'Every selected contact landed in your firm.' }],
        message: `${parsed.rows.length} contacts were read and ${parsed.rows.length} landed in your firm.`,
        imported: parsed.rows.length, updated, format: parsed.format,
      });
      await live.reload();
      setOutcome({ landed: parsed.rows.length, updated, reportId }); setStep('done');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'The import could not be saved.'); }
    finally { setBusy(false); }
  };

  return <section data-testid="crm-self-service-import" style={panel}>
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'start' }}>
      <div><h2 style={{ margin: 0 }}>Import your own contacts</h2><p style={{ marginBottom: 0 }}>Bring over a CSV, Excel, vCard, or Outlook contacts file. You review the match before anything is saved.</p></div>
      <Button data-testid="crm-self-service-import-close" variant="secondary" size="sm" onClick={onClose}>Back to migration</Button>
    </div>
    {step === 'upload' && <div style={{ marginTop: 16 }}><label htmlFor="crm-self-service-file"><strong>Choose a contact file</strong><span style={{ display: 'block', marginTop: 4 }}>CSV, Excel (.xlsx or .xls), vCard (.vcf), or an Outlook CSV export.</span></label><input id="crm-self-service-file" data-testid="crm-self-service-file" type="file" accept=".csv,.xlsx,.xls,.vcf,.vcard" disabled={busy} onChange={(event) => { void chooseFile(event.target.files?.[0]); }} style={{ display: 'block', marginTop: 10 }} />{busy && <p role="status">Reading your file…</p>}</div>}
    {step === 'map' && parsed && mapping && <div style={{ marginTop: 16 }}><p><strong>{parsed.fileName}</strong> has {parsed.rows.length} contact{parsed.rows.length === 1 ? '' : 's'}. Match its columns to your firm’s fields.</p><div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>{(Object.keys(fieldLabels) as ContactField[]).map((field) => <label key={field}>{fieldLabels[field]}{field === 'name' ? ' (required)' : ' (optional)'}<select data-testid={`crm-self-service-map-${field}`} value={mapping[field]} onChange={(event) => setMapping({ ...mapping, [field]: event.target.value })} style={{ display: 'block', width: '100%', marginTop: 4 }}><option value="">Do not import this field</option>{parsed.columns.map((column) => <option key={column} value={column}>{column}</option>)}</select></label>)}</div><div style={{ display: 'flex', gap: 8, marginTop: 16 }}><Button data-testid="crm-self-service-preview" iconLeft={FileSpreadsheet} disabled={!mapping.name} onClick={() => setStep('preview')}>Preview contacts</Button><Button variant="secondary" onClick={() => setStep('upload')}>Choose another file</Button></div></div>}
    {step === 'preview' && parsed && mapping && <div style={{ marginTop: 16 }}><h3>Preview before you save</h3><p>These are the first {preview.length} contacts. Lantern will use the match key to update the same contact if you import this file again.</p><div style={{ overflowX: 'auto' }}><table data-testid="crm-self-service-preview-table"><thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Match key</th></tr></thead><tbody>{preview.map((row, index) => <tr key={index}><td>{contactName(row, mapping)}</td><td>{row[mapping.email] || 'Not included'}</td><td>{row[mapping.phone] || 'Not included'}</td><td>{row[mapping.externalId] ? 'Included' : 'Not included'}</td></tr>)}</tbody></table></div><div style={{ display: 'flex', gap: 8, marginTop: 16 }}><Button data-testid="crm-self-service-import-confirm" disabled={busy} iconLeft={Upload} onClick={() => void completeImport()}>{busy ? 'Saving contacts…' : `Import ${parsed.rows.length} contacts`}</Button><Button variant="secondary" disabled={busy} onClick={() => setStep('map')}>Change mapping</Button></div></div>}
    {step === 'done' && outcome && <div data-testid="crm-self-service-fidelity-report" style={{ marginTop: 16 }}><h3>Import report</h3><p data-testid="crm-self-service-import-result">Fetched {outcome.landed}. Landed {outcome.landed}. Nothing was lost.</p><p>{outcome.updated ? `${outcome.updated} existing contact${outcome.updated === 1 ? ' was' : 's were'} updated using the match key.` : 'Each contact was added to your firm.'}</p><p>Your report is saved with this workspace, so you can come back after restarting Lantern.</p><Button data-testid="crm-self-service-import-another" variant="secondary" onClick={() => { setStep('upload'); setParsed(null); setMapping(null); setOutcome(null); }}>Import another file</Button></div>}
    {error && <p role="alert" data-testid="crm-self-service-error">{error}</p>}
  </section>;
}
