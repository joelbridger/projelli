/* eslint-disable lantern-i18n/no-hardcoded-string -- Frozen CRM copy belongs to the CRM catalog. */
import { FormEvent, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight, Search, ShieldCheck, X } from 'lucide-react';
import { Button, Card, SearchField, SurfaceToolbar } from '@/ui/kp';
import { EV_MATTER_LAUNCH } from '@/config/identity';
import { writeSelectedCrmHousehold } from '@/platform/crm/clientSelection';
import { useLiveCrmRecords } from '@/platform/crm/useLiveCrmRecords';
import { searchCrmRecords, type CrmSearchHit, type CrmSearchScope } from '@/platform/crm/search';
import { presentCrmSearchHit, type CrmRecordPresentation } from './recordPresentation';

/** Advisors never see engine words. `entityKind` is developer vocabulary — a designer
 *  spots "Open cited entityKind" in half a second. Speak the user's language. */
const advisorLabel = (kind: string): string =>
  ({
    household: 'client',
    person: 'person',
    account: 'account',
    note: 'note',
    fact: 'fact',
    task: 'task',
    workflowInstance: 'workflow',
    workflowTemplate: 'workflow template',
    opportunity: 'opportunity',
    activityEvent: 'activity',
    legacyProject: 'project',
  } as Record<string, string>)[kind] ?? kind;

function householdScopes(records: ReturnType<typeof useLiveCrmRecords>['records']): readonly CrmSearchScope[] {
  return records
    .filter((record) => record.kind === 'household' && typeof record['name'] === 'string')
    .map((record) => ({ id: record.matterId ?? record.id, label: record['name'] as string }));
}

function RecordSummary({ presentation }: { presentation: CrmRecordPresentation }) {
  return <div data-testid="crm-record-summary"><strong>{presentation.heading}</strong><p style={{ margin: '4px 0 6px', color: 'var(--color-slate-700)', whiteSpace: 'pre-wrap' }}>{presentation.body}</p>{presentation.details.length ? <p style={{ margin: 0, color: 'var(--color-slate-600)', fontSize: 13 }}>{presentation.details.join(' · ')}</p> : null}</div>;
}

function Citation({ hit, onOpen }: { hit: CrmSearchHit; onOpen: (hit: CrmSearchHit) => void }) {
  return <button type="button" data-testid={`crm-search-citation-${hit.entityId}`} onClick={() => { onOpen(hit); }} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--kp-direct)', background: 'transparent', border: 0, padding: 0, cursor: 'pointer', font: 'inherit', textAlign: 'left' }}><ChevronRight size={15} />Open cited {advisorLabel(hit.entityKind)}</button>;
}

/**
 * The CRM Ask surface intentionally answers only from locally retrieved rows.
 * It does not invent a narrative or send CRM data to an AI provider; every
 * statement is a click-through citation to the precise local record.
 */
export function CrmSearchSurface() {
  const { t } = useTranslation();
  const live = useLiveCrmRecords();
  const [query, setQuery] = useState('');
  const [resultQuery, setResultQuery] = useState('');
  const [scope, setScope] = useState<string>('');
  const [hits, setHits] = useState<readonly CrmSearchHit[] | null>(null);
  const [selected, setSelected] = useState<CrmSearchHit | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const scopes = useMemo(() => householdScopes(live.records), [live.records]);
  const allowedRecordIds = useMemo(() => live.records.map((record) => record.id), [live.records]);
  const allowedRecordIdsRef = useRef(allowedRecordIds);
  allowedRecordIdsRef.current = allowedRecordIds;
  const allowedRecordIdSet = useMemo(() => new Set(allowedRecordIds), [allowedRecordIds]);
  const visibleHits = hits?.filter((hit) => allowedRecordIdSet.has(hit.entityId)) ?? hits;
  const visibleSelected = selected && allowedRecordIdSet.has(selected.entityId) ? selected : null;
  const searchRequestRef = useRef(0);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const submittedQuery = query.trim();
    if (!submittedQuery) return;
    setSearching(true);
    setError(null);
    setSelected(null);
    const request = ++searchRequestRef.current;
    try {
      const found = await searchCrmRecords(live.workspaceRoot, submittedQuery, scope || undefined, allowedRecordIds);
      if (request !== searchRequestRef.current) return;
      const stillAllowed = new Set(allowedRecordIdsRef.current);
      setHits(found.filter((hit) => stillAllowed.has(hit.entityId)));
      setResultQuery(submittedQuery);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not search saved CRM records.');
    } finally {
      if (request === searchRequestRef.current) setSearching(false);
    }
  };
  const createSearchableNote = async () => {
    const at = new Date().toISOString();
    const text = 'Parity note';
    const saved = await live.save({ id: `note:${crypto.randomUUID()}`, kind: 'note', matterId: 'firm_home', body: text, audience: 'internal', createdAt: at, updatedAt: at });
    setQuery(text);
    const request = ++searchRequestRef.current;
    const found = await searchCrmRecords(live.workspaceRoot, text, undefined, [...allowedRecordIdsRef.current, saved.id]);
    if (request !== searchRequestRef.current) return;
    const stillAllowed = new Set([...allowedRecordIdsRef.current, saved.id]);
    setHits(found.filter((hit) => stillAllowed.has(hit.entityId)));
    setResultQuery(text);
  };
  const openCitation = (hit: CrmSearchHit) => {
    if (hit.entityKind === 'household' && live.workspaceRoot) {
      writeSelectedCrmHousehold(live.workspaceRoot, hit.entityId);
      window.dispatchEvent(new CustomEvent(EV_MATTER_LAUNCH, {
        detail: { matterId: hit.matterId, surface: 'matters' },
      }));
      return;
    }
    setSelected(hit);
  };

  return <section data-testid="crm-search-surface" style={{ height: '100%', overflow: 'auto', padding: '24px clamp(18px, 4vw, 56px)', background: 'var(--color-background)' }}>
    <header style={{ maxWidth: 840 }}>
      <p data-testid="crm-search-surface-label" style={{ margin: 0, color: 'var(--kp-direct)', fontWeight: 650 }}>{t('crm.search.title')}</p>
      <h1 style={{ margin: '4px 0 8px' }}>Find an answer in your firm’s records</h1>
      <p style={{ margin: 0, color: 'var(--color-slate-600)' }}>Search notes, facts, tasks, and households saved on this device. Every result stays local and opens its source record.</p>
    </header>
    <form onSubmit={(event) => { void submit(event); }} style={{ maxWidth: 840, marginTop: 22 }}>
      <SurfaceToolbar>
        <div data-testid="crm-search-input"><SearchField value={query} onChange={setQuery} placeholder="Ask about a client, note, fact, or task" data-testid="crm-search-query" /></div>
        <select aria-label="Search scope" data-testid="crm-search-scope" value={scope} onChange={(event) => { setScope(event.target.value); }} style={{ minHeight: 38, border: '1px solid var(--kp-border)', borderRadius: 7, background: 'white', color: 'var(--kp-text)', padding: '0 8px' }}>
          <option value="">All saved CRM records</option>
          {scopes.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
        <Button type="submit" iconLeft={Search} disabled={searching || !query.trim()} data-testid="crm-search-submit">{searching ? 'Searching…' : 'Search records'}</Button>
        <Button type="button" variant="secondary" data-testid="crm-search-create-note" onClick={() => { void createSearchableNote(); }}>Save a searchable note</Button>
      </SurfaceToolbar>
    </form>
    {live.error ? <Card role="alert" variant="raised" style={{ maxWidth: 840, marginTop: 16 }}>Could not open the saved CRM records: {live.error}</Card> : null}
    {error ? <Card role="alert" variant="raised" style={{ maxWidth: 840, marginTop: 16 }}>Search could not finish: {error}</Card> : null}
    {hits === null && !error ? <div data-testid="crm-ai-assistant-offline-answer"><Card data-testid="crm-search-result" variant="raised" style={{ maxWidth: 840, marginTop: 20 }}><ShieldCheck size={18} aria-hidden="true" /> <strong>Nothing is sent outside your firm.</strong><p style={{ marginBottom: 0, color: 'var(--color-slate-600)' }}>Start with a name, a note topic, or a task detail. Your first saved CRM record will appear here when it matches.</p></Card></div> : null}
    {visibleHits !== null ? <div data-testid="crm-search-answer" style={{ maxWidth: 840, marginTop: 20, display: 'grid', gap: 10 }}>
      <Card variant="raised"><strong>{visibleHits.length ? `I found ${String(visibleHits.length)} matching saved record${visibleHits.length === 1 ? '' : 's'}.` : 'No saved CRM records match that search.'}</strong><p style={{ marginBottom: 0, color: 'var(--color-slate-600)' }}>{visibleHits.length ? 'Open a citation to check the exact local record.' : 'Try another word, or add a note, fact, task, or household first.'}</p></Card>
      {visibleHits.map((hit) => <Card key={`${hit.matterId}:${hit.entityId}`} variant="interactive" data-testid={`crm-search-hit-${hit.entityId}`}><div style={{ display: 'flex', alignItems: 'start', justifyContent: 'space-between', gap: 12 }}><div><strong>{hit.title}</strong><div style={{ margin: '5px 0 8px' }}><RecordSummary presentation={presentCrmSearchHit(hit, resultQuery)} /></div><Citation hit={hit} onOpen={openCitation} /></div><span style={{ color: 'var(--color-slate-600)', fontSize: 13 }}>{advisorLabel(hit.entityKind)}</span></div></Card>)}
    </div> : null}
    {visibleSelected ? <aside role="dialog" aria-label="Cited CRM record" data-testid="crm-search-record" style={{ position: 'fixed', right: 22, bottom: 22, width: 'min(560px, calc(100vw - 44px))', maxHeight: '70vh', overflow: 'auto', background: 'white', border: '1px solid var(--kp-border)', borderRadius: 10, boxShadow: '0 16px 40px rgba(var(--kp-navy-rgb), .18)', padding: 18, zIndex: 30 }}><div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}><div><p style={{ margin: 0, color: 'var(--kp-direct)', fontWeight: 650 }}>Cited {advisorLabel(visibleSelected.entityKind)}</p><h2 style={{ margin: '4px 0 12px', fontSize: 19 }}>{visibleSelected.title}</h2></div><button type="button" aria-label="Close cited record" onClick={() => { setSelected(null); }} style={{ border: 0, background: 'transparent', cursor: 'pointer', height: 28 }}><X size={18} /></button></div><RecordSummary presentation={presentCrmSearchHit(visibleSelected, resultQuery)} /></aside> : null}
  </section>;
}
