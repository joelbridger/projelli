/* eslint-disable lantern-i18n/no-hardcoded-string, react-refresh/only-export-components -- Compatibility descriptors preserve frozen directory copy and mounts. */
import { useMemo, useState } from 'react';
import { Plus, ShieldCheck } from 'lucide-react';
import { Badge, Button, Card, SearchField, SegmentedToggle, SlidePanel } from '@/ui/kp';
import { BookDirectoryView } from './BookDirectoryView';
import type {
  DirectoryActionDescriptor,
  DirectoryContext,
  DirectoryRailDescriptor,
  DirectoryToolDescriptor,
  DirectoryViewDescriptor,
} from './directoryRegistry';
import { projectDirectoryResults } from './directoryRegistry';

declare module './directoryRegistry' {
  interface DirectoryToolIdMap {
    'view-switch': true;
    'tab-switch': true;
    search: true;
    'external-filter': true;
    'verification-filter': true;
  }
  interface DirectoryActionIdMap { 'create-household': true; }
  interface DirectoryRailIdMap { 'person-details': true; }
  interface DirectoryViewIdMap { directory: true; book: true; }
}

function CreateHouseholdAction({ context }: { context: DirectoryContext }) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  return <>
    <Button size="sm" iconLeft={Plus} data-testid="crm-directory-add" onClick={() => { setCreating(true); }}>New household</Button>
    {creating ? <form data-testid="crm-create-household" onSubmit={(event) => { event.preventDefault(); const trimmed = name.trim(); if (!trimmed) return; void Promise.resolve(context.legacyRepository.createHousehold(trimmed)).then(() => { setName(''); setCreating(false); }).catch(() => { setCreating(true); }); }} style={{ display: 'flex', gap: 8, marginTop: 12 }}><input data-testid="crm-household-name" aria-label="Household name" value={name} onChange={(event) => { setName(event.target.value); }} placeholder="Household name" autoFocus /><Button data-testid="crm-household-save" type="submit">Create household</Button><Button variant="secondary" type="button" onClick={() => { setCreating(false); }}>Cancel</Button></form> : null}
  </>;
}

function DirectoryResults({ context }: { context: DirectoryContext }) {
  const households = useMemo(() => projectDirectoryResults('household', context.records.households.filter((household) => household.name.toLowerCase().includes(context.query.value.toLowerCase())), context), [context]);
  const people = useMemo(() => projectDirectoryResults('person', context.records.people.filter((person) => (!context.filters.externalOnly || person.external) && (!context.filters.needsVerification || !person.verifiedAt) && person.name.toLowerCase().includes(context.query.value.toLowerCase())), context), [context]);
  if (context.filters.tab === 'households') return <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>{households.length ? households.map((household) => <Card key={household.id} variant="interactive" role="button" tabIndex={0} data-testid={`crm-directory-household-${household.id}`} onClick={() => { context.legacyRepository.openHousehold(household.id); }} onKeyDown={(event) => { if (event.key === 'Enter') context.legacyRepository.openHousehold(household.id); }}><div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><strong>{household.name}</strong><Badge variant="featured">{household.serviceTier}</Badge></div><div style={{ color: 'var(--color-slate-600)', marginTop: 4 }}>{household.lifecycle} · Owned by {household.primaryAdvisor} · {household.peopleCount} people</div></Card>) : <Card variant="raised">No households match this search.</Card>}</div>;
  return <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>{people.map((person) => <Card key={person.id} variant="interactive" role="button" tabIndex={0} data-testid={`crm-directory-person-${person.id}`} onClick={() => { context.selection.setPerson(person); }} onKeyDown={(event) => { if (event.key === 'Enter') context.selection.setPerson(person); }}><div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><strong>{person.name}</strong><div style={{ display: 'flex', gap: 6 }}>{person.external ? <Badge variant="warning">External</Badge> : <Badge variant="neutral">Household member</Badge>}{person.verifiedAt ? <Badge variant="success" icon={ShieldCheck}>Email verified</Badge> : <Badge variant="warning">Needs verification</Badge>}</div></div><div style={{ color: 'var(--color-slate-600)', marginTop: 4 }}>{person.personType === 'organization' ? 'Organization' : person.personType === 'trust' ? 'Trust' : (person.householdRole ?? 'Person')} · {person.roles.join(', ') || 'No firm roles'} · serves {person.relatedHouseholds} household{person.relatedHouseholds === 1 ? '' : 's'}</div></Card>)}</div>;
}

export const legacyDirectoryTools: readonly DirectoryToolDescriptor[] = [
  { id: 'view-switch', order: 10, mount: (context) => <SegmentedToggle ariaLabel="Client Map view" value={context.sort.value ?? 'directory'} onChange={(value) => { context.sort.setValue(value); }} options={[{ value: 'directory', label: 'Clients', testId: 'crm-directory-view-directory' }, { value: 'book', label: 'Whole book', testId: 'crm-directory-view-book' }]} data-testid="crm-directory-view" /> },
  // PARITY: renders unconditionally to match pre-refactor DirectorySurface; hiding/repurposing it in book view is a tracked design finding, not a refactor-lane change.
  { id: 'tab-switch', order: 20, mount: (context) => <SegmentedToggle ariaLabel="Directory view" value={context.filters.tab} onChange={(value) => { context.filters.setTab(value); }} options={[{ value: 'households', label: 'Households' }, { value: 'people', label: 'People' }]} data-testid="crm-directory-tab" /> },
  { id: 'search', order: 30, mount: (context) => context.sort.value !== 'book' ? <SearchField value={context.query.value} onChange={(value) => { context.query.setValue(value); }} placeholder={context.filters.tab === 'households' ? 'Find a household' : 'Find a person'} data-testid="crm-directory-search" /> : null },
  { id: 'external-filter', order: 40, mount: (context) => context.sort.value !== 'book' ? <Button size="sm" variant={context.filters.externalOnly ? 'primary' : 'secondary'} onClick={() => { context.filters.setExternalOnly(!context.filters.externalOnly); }} data-testid="crm-directory-external">External</Button> : null },
  { id: 'verification-filter', order: 50, mount: (context) => context.sort.value !== 'book' ? <Button size="sm" variant={context.filters.needsVerification ? 'primary' : 'secondary'} onClick={() => { context.filters.setNeedsVerification(!context.filters.needsVerification); }} data-testid="crm-directory-needs-verification">Needs verification</Button> : null },
];
export const legacyDirectoryActions: readonly DirectoryActionDescriptor[] = [{ id: 'create-household', order: 60, mount: (context) => context.sort.value !== 'book' ? <CreateHouseholdAction context={context} /> : null }];
export const legacyDirectoryRails: readonly DirectoryRailDescriptor[] = [{ id: 'person-details', order: 10, mount: (context) => context.sort.value !== 'book' ? <SlidePanel open={context.selection.person !== null} onClose={() => { context.selection.setPerson(null); }} title={context.selection.person?.name} data-testid="crm-directory-person-panel">{context.selection.person ? <div><p><strong>Person roles:</strong> {context.selection.person.roles.join(', ') || 'None'}</p><p><strong>Household relationship:</strong> {context.selection.person.householdRole ?? 'Not a household member'}</p><p><strong>Channel:</strong> {context.selection.person.channel ?? 'No recipient channel'}</p><p><strong>Verification:</strong> {context.selection.person.verifiedAt ? `${context.selection.person.verifiedAt}${context.selection.person.verifiedBy ? ` by ${context.selection.person.verifiedBy}` : ''}` : 'Needs verification'}</p><Button size="sm" data-testid={`crm-review-recipient-${context.selection.person.id}`} onClick={() => { context.legacyRepository.reviewRecipient(context.selection.person?.id ?? ''); }}>Review recipient</Button></div> : null}</SlidePanel> : null }];
export const legacyDirectoryViews: readonly DirectoryViewDescriptor[] = [
  { id: 'directory', order: 10, fallback: true, isActive: (context) => context.view.value !== 'book', mount: (context) => context.view.value !== 'book' ? <DirectoryResults context={context} /> : null },
  { id: 'book', order: 20, isActive: (context) => context.view.value === 'book', mount: (context) => context.view.value === 'book' ? <BookDirectoryView onOpenClient={(id) => { context.legacyRepository.openHousehold(id); }} /> : null },
];
