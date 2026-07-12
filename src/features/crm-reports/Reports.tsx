/* eslint-disable lantern-i18n/no-hardcoded-string -- Frozen CRM copy awaits its catalog. */
import { useMemo, useState } from 'react';
import { BarChart3, Plus, RefreshCw, Save } from 'lucide-react';
import { SurfaceHeader } from '@/ui/SurfaceHeader';
import { Button } from '@/ui/kp';
import { useLiveCrmRecords } from '@/platform/crm/useLiveCrmRecords';
import type { FilterClause, ReportKind } from '@/platform/crm/types';
import {
  computeReport,
  proposeReportFromQuestion,
  REPORTABLE_FIELDS,
  REPORT_TITLES,
  type ComputedReport,
  type ReportQuery,
} from './reportEngine';

const panel = {
  border: '1px solid var(--kp-border)',
  borderRadius: 'var(--radius-lg)',
  background: 'var(--kp-surface)',
  padding: 'var(--kp-space-md)',
} as const;
const muted = { color: 'var(--kp-text-faint)', fontSize: 'var(--kp-font-sm)' } as const;
const canned = ['no_contact_6mo', 'attention_vs_fee', 'birthdays', 'age_65', 'rmd_due', 'review_due'] as const satisfies readonly ReportKind[];

const fieldLabels: Record<(typeof REPORTABLE_FIELDS)[number], string> = {
  name: 'Household name',
  status: 'Status',
  serviceTier: 'Service tier',
  primaryAdvisor: 'Primary advisor',
  nextReviewDue: 'Next review due',
  lastContactAt: 'Last contact',
  activityCount: 'Recorded activity count',
};

function groupedRows(rows: readonly import('./reportEngine').ReportRow[]) {
  return rows.reduce<Map<string, import('./reportEngine').ReportRow[]>>((groups, row) => {
    const key = row.group ?? '';
    groups.set(key, [...(groups.get(key) ?? []), row]);
    return groups;
  }, new Map());
}
export function Reports() {
  const live = useLiveCrmRecords();
  const [kind, setKind] = useState<ReportKind>('no_contact_6mo');
  const [query, setQuery] = useState<ReportQuery>({
    entity: 'household',
    filters: [],
    fields: ['serviceTier', 'primaryAdvisor', 'nextReviewDue', 'lastContactAt'],
    sort: [{ field: 'name', dir: 'asc' }],
  });
  const [result, setResult] = useState<ComputedReport | null>(null);
  const [question, setQuestion] = useState('');
  const [proposal, setProposal] = useState<ReturnType<typeof proposeReportFromQuestion> | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [visibility, setVisibility] = useState<'personal' | 'firm'>('personal');
  const [openedRow, setOpenedRow] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const savedReports = useMemo(
    () => live.records.filter((record) => record.kind === 'savedReport'),
    [live.records],
  );
  const run = async (nextKind = kind, nextQuery = query) => {
    setKind(nextKind);
    setQuery(nextQuery);
    setOpenedRow(null);
    const computed = computeReport(live.records, nextKind, nextQuery);
    setResult(computed);
    await live.save({
      id: `report-run:${crypto.randomUUID()}`,
      kind: 'reportRun',
      matterId: live.sharedMatterId ?? 'firm_home',
      reportKind: nextKind,
      query: nextQuery,
      calculatedAt: computed.calculatedAt,
      sourcesConsidered: computed.sourcesConsidered,
      resultCount: computed.rows.length,
      createdAt: computed.calculatedAt,
      updatedAt: computed.calculatedAt,
    });
  };
  const startCustom = () => {
    setKind('custom');
    setResult(null);
  };
  const addFilter = () => setQuery((current) => ({
    ...current,
    filters: [...current.filters, { field: 'serviceTier', op: 'contains', value: '' }],
  }));
  const updateFilter = (index: number, patch: Partial<FilterClause>) => setQuery((current) => ({
    ...current,
    filters: current.filters.map((filter, position) => position === index ? { ...filter, ...patch } : filter),
  }));
  const toggleField = (field: (typeof REPORTABLE_FIELDS)[number]) => setQuery((current) => {
    const fields = current.fields ?? [];
    return {
      ...current,
      fields: fields.includes(field) ? fields.filter((item) => item !== field) : [...fields, field],
    };
  });
  const save = async () => {
    const name = saveName.trim();
    if (!name) return;
    setSaveError(null);
    try {
      await live.save({
        id: `saved-report:${crypto.randomUUID()}`,
        kind: 'savedReport',
        matterId: live.sharedMatterId ?? 'firm_home',
        name,
        visibility,
        layout: 'table',
        reportKind: kind,
        query,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      setSaveOpen(false);
      setSaveName('');
    } catch (reason) {
      setSaveError(reason instanceof Error ? reason.message : 'The report recipe could not be saved.');
    }
  };
  const groups = result ? groupedRows(result.rows) : new Map<string, import('./reportEngine').ReportRow[]>();

  return <div data-testid="crm-screen-reports" style={{ padding: 'var(--kp-space-xl)', overflow: 'auto', width: '100%', display: 'flex', flexDirection: 'column', gap: 'var(--kp-space-md)' }}>
    <SurfaceHeader
      Icon={BarChart3}
      title="Reports"
      description="Answers from the records your firm has saved"
      actions={<div style={{ display: 'flex', gap: 8 }}><Button data-testid="crm-report-builder" variant="secondary" iconLeft={Plus} onClick={startCustom}>New report</Button><Button data-testid="crm-report-run" iconLeft={RefreshCw} onClick={() => { void run(); }}>Run report</Button></div>}
    />

    <section style={panel}>
      <strong>Ask for a report</strong>
      <p style={muted}>Ask suggests a report recipe from your question. It does not run or save anything until you review it.</p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input data-testid="crm-report-ai-prompt" aria-label="Ask for a report" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Who needs attention this month?" style={{ flex: '1 1 280px' }} />
        <Button variant="secondary" data-testid="crm-report-ai-run" disabled={!question.trim()} onClick={() => setProposal(proposeReportFromQuestion(question))}>Propose report</Button>
      </div>
      {proposal && <div data-testid="crm-report-ask-proposal" style={{ marginTop: 10, borderTop: '1px solid var(--kp-border)', paddingTop: 10 }}>
        <strong>Proposed: {REPORT_TITLES[proposal.kind]}</strong>
        <p style={muted}>{proposal.explanation}</p>
        <Button data-testid="crm-report-ai-use-proposal" onClick={() => { setKind(proposal.kind); setQuery(proposal.query); setResult(null); }}>Use this proposal</Button>
      </div>}
    </section>

    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {canned.map((item) => <Button key={item} size="sm" variant={kind === item ? 'primary' : 'secondary'} data-testid={item === 'no_contact_6mo' ? 'crm-report-no-contact-in-6-months' : item === 'attention_vs_fee' ? 'crm-report-attention-vs-fee' : `crm-report-${item}`} aria-pressed={kind === item} onClick={() => { setKind(item); setResult(null); }}><span data-testid={item === 'age_65' ? 'crm-report-age-65' : item === 'rmd_due' ? 'crm-report-rmd-due' : item === 'review_due' ? 'crm-report-review-due' : undefined}>{REPORT_TITLES[item]}</span></Button>)}
      <Button size="sm" variant={kind === 'custom' ? 'primary' : 'secondary'} data-testid="crm-report-custom" aria-pressed={kind === 'custom'} onClick={startCustom}>Custom report</Button>
    </div>

    {kind === 'custom' && <section style={panel}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <div><strong>Build a custom household report</strong><p style={muted}>Choose the saved fields, filters, order, and group. These are limited to CRM fields, never code or database commands.</p></div>
        <Button size="sm" variant="secondary" data-testid="crm-report-add-filter" onClick={addFilter}>Add filter</Button>
      </div>
      <fieldset style={{ border: 0, padding: 0, margin: '10px 0 0' }}><legend style={muted}>Columns</legend><div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 4 }}>{REPORTABLE_FIELDS.filter((field) => field !== 'name').map((field) => <label key={field}><input data-testid={`crm-report-field-${field}`} type="checkbox" checked={(query.fields ?? []).includes(field)} onChange={() => toggleField(field)} /> {fieldLabels[field]}</label>)}</div></fieldset>
      <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
        <label>Sort by <select data-testid="crm-report-sort-field" value={query.sort?.[0]?.field ?? 'name'} onChange={(event) => setQuery((current) => ({ ...current, sort: [{ field: event.target.value, dir: current.sort?.[0]?.dir ?? 'asc' }] }))}>{REPORTABLE_FIELDS.map((field) => <option key={field} value={field}>{fieldLabels[field]}</option>)}</select></label>
        <label>Order <select data-testid="crm-report-sort-direction" value={query.sort?.[0]?.dir ?? 'asc'} onChange={(event) => setQuery((current) => ({ ...current, sort: [{ field: current.sort?.[0]?.field ?? 'name', dir: event.target.value as 'asc' | 'desc' }] }))}><option value="asc">A to Z</option><option value="desc">Z to A</option></select></label>
        <label>Group <select data-testid="crm-report-group-by" value={query.groupBy ?? ''} onChange={(event) => setQuery((current) => { const { groupBy: _groupBy, ...withoutGroup } = current; return event.target.value ? { ...current, groupBy: event.target.value } : withoutGroup; })}><option value="">No group</option>{REPORTABLE_FIELDS.filter((field) => field !== 'name').map((field) => <option key={field} value={field}>{fieldLabels[field]}</option>)}</select></label>
      </div>
      {query.filters.map((filter, index) => <div key={`${filter.field}-${index}`} data-testid={`crm-report-filter-${index}`} style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
        <select data-testid={`crm-report-filter-field-${index}`} value={filter.field} onChange={(event) => updateFilter(index, { field: event.target.value })}>{REPORTABLE_FIELDS.map((field) => <option key={field} value={field}>{fieldLabels[field]}</option>)}</select>
        <select data-testid={`crm-report-filter-op-${index}`} value={filter.op} onChange={(event) => updateFilter(index, { op: event.target.value as FilterClause['op'] })}>{['contains', 'eq', 'neq', 'before', 'after', 'is_empty', 'is_not_empty'].map((operator) => <option key={operator} value={operator}>{operator.replaceAll('_', ' ')}</option>)}</select>
        {!['is_empty', 'is_not_empty'].includes(filter.op) && <input data-testid={`crm-report-filter-value-${index}`} value={String(filter.value ?? '')} onChange={(event) => updateFilter(index, { value: event.target.value })} placeholder="Value" />}
        <Button size="sm" variant="secondary" data-testid={`crm-report-filter-remove-${index}`} onClick={() => setQuery((current) => ({ ...current, filters: current.filters.filter((_, position) => position !== index) }))}>Remove</Button>
      </div>)}
    </section>}

    {savedReports.length > 0 && <section style={panel}>
      <strong>Saved reports</strong>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>{savedReports.map((view) => <Button key={view.id} size="sm" variant="secondary" data-testid={`crm-report-saved-${view.id}`} onClick={() => {
        const savedKind = typeof view['reportKind'] === 'string' ? view['reportKind'] as ReportKind : 'custom';
        const savedQuery: ReportQuery = view['query'] && typeof view['query'] === 'object' ? view['query'] as ReportQuery : { entity: 'household', filters: [] };
        void run(savedKind, savedQuery);
      }}>{typeof view['name'] === 'string' ? view['name'] : 'Saved report'} · {view['visibility'] === 'firm' ? 'Shared with firm' : 'Personal'}</Button>)}</div>
    </section>}

    <section data-testid="crm-report-results" style={panel}>
      {!result ? <><strong>Ready when you are</strong><p style={muted}>Run a report to calculate from the current encrypted CRM records. Results are never stored as truth.</p></> : <>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
          <div><strong>{result.title}</strong><p data-testid="crm-report-provenance" style={muted}>Computed just now from {result.sourcesConsidered} decrypted record{result.sourcesConsidered === 1 ? '' : 's'} · {live.freshness.kind === 'offline' ? 'using local data while offline' : 'current local index'}</p></div>
          <Button data-testid="crm-report-save" iconLeft={Save} onClick={() => setSaveOpen(true)}>Save this view</Button>
        </div>
        {result.rows.length === 0 ? <p data-testid="crm-report-empty" style={muted}>No matching records yet.</p> : <div data-testid="crm-report-row-list">{[...groups.entries()].map(([group, rows]) => <div key={group}>{group && <h2 style={{ fontSize: 'var(--kp-font-md)', margin: '14px 0 0' }}>{query.groupBy ? `${fieldLabels[query.groupBy as keyof typeof fieldLabels] ?? query.groupBy}: ${group}` : group}</h2>}{rows.map((row) => <section key={row.householdId} data-testid={`crm-report-row-${row.householdId}`} style={{ borderTop: '1px solid var(--kp-border)', padding: '10px 0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}><div><strong>{row.householdName}</strong><span style={muted}> · {Object.entries(row.values).map(([label, value]) => `${label}: ${value}`).join(' · ')}</span></div><Button size="sm" variant="secondary" data-testid={`crm-report-open-${row.householdId}`} onClick={() => setOpenedRow(openedRow === row.householdId ? null : row.householdId)}>{openedRow === row.householdId ? 'Hide source details' : 'Open source details'}</Button></div>
          {openedRow === row.householdId && <p data-testid={`crm-report-details-${row.householdId}`} style={muted}>This result is linked to {row.sourceIds.length} saved record{row.sourceIds.length === 1 ? '' : 's'}: {row.sourceIds.join(', ')}.</p>}
        </section>)}</div>)}</div>}
        {result.exclusions.length > 0 && <aside data-testid="crm-report-exclusions" role="status" style={{ marginTop: 10, ...panel, background: 'var(--color-slate-50)' }}><strong>What this report could not compare</strong>{result.exclusions.map((message) => <p key={message} style={muted}>{message}</p>)}</aside>}
      </>}
      {saveOpen && <div data-testid="crm-report-save-dialog" style={{ marginTop: 12, ...panel, background: 'var(--color-slate-50)' }}><strong>Save this report recipe</strong><p style={muted}>Only the filters, chosen columns, and order are saved. Results are calculated again next time.</p><input data-testid="crm-report-save-name" value={saveName} onChange={(event) => setSaveName(event.target.value)} placeholder="Report name" /><select data-testid="crm-report-save-visibility" value={visibility} onChange={(event) => setVisibility(event.target.value as 'personal' | 'firm')}><option value="personal">Personal</option><option value="firm">Share with firm</option></select><Button data-testid="crm-report-save-confirm" disabled={!saveName.trim()} onClick={() => { void save(); }}>Save report</Button>{saveError && <p role="alert" style={{ color: 'var(--kp-danger)' }}>{saveError}</p>}</div>}
    </section>
  </div>;
}
