/* eslint-disable lantern-i18n/no-hardcoded-string -- Frozen CRM screen copy lives in compatibility descriptors until its product copy changes. */
import { useMemo, useState } from 'react';
import { Card, SurfaceToolbar } from '@/ui/kp';
import { defaultDirectoryComposition, getDirectoryActions, getDirectoryRails, getDirectoryTools, resolveDirectoryView, type DirectoryComposition, type DirectoryContext } from './directoryRegistry';
import type { CrmClientsActions, CrmPerson, HouseholdDirectoryEntry } from './adapters';

export function DirectorySurface({ people, households = [], actions, onCreateHousehold, error, composition = defaultDirectoryComposition }: { people: readonly CrmPerson[]; households?: readonly HouseholdDirectoryEntry[]; actions?: CrmClientsActions; onCreateHousehold?: (name: string) => Promise<void> | void; error?: string | null; composition?: DirectoryComposition; }) {
  const [query, setQuery] = useState('');
  const [person, setPerson] = useState<CrmPerson | null>(null);
  const [view, setView] = useState<string | null>('directory');
  const [tab, setTab] = useState('households');
  const [externalOnly, setExternalOnly] = useState(false);
  const [needsVerification, setNeedsVerification] = useState(false);
  const context = useMemo<DirectoryContext>(() => ({ query: { value: query, setValue: setQuery }, selection: { person, setPerson }, view: { value: view, setValue: setView }, sort: { value: view, setValue: setView }, filters: { tab, setTab, externalOnly, setExternalOnly, needsVerification, setNeedsVerification }, records: { people, households }, repository: { openHousehold: (id) => { actions?.onOpenHousehold?.(id); }, reviewRecipient: (id) => { actions?.onReviewRecipient?.(id); }, createHousehold: (name) => onCreateHousehold?.(name) }, composition }), [actions, composition, externalOnly, households, needsVerification, onCreateHousehold, people, person, query, tab, view]);
  const activeView = resolveDirectoryView(context);
  return <section data-testid="crm-directory-surface"><header><p style={{ marginBottom: 2 }}>Clients / Directory</p><h1 style={{ marginTop: 0 }}>People and external parties</h1></header><SurfaceToolbar data-testid="crm-directory-toolbar">{getDirectoryTools().map((descriptor) => <span key={descriptor.id}>{descriptor.mount(context)}</span>)}{getDirectoryActions().map((descriptor) => <span key={descriptor.id}>{descriptor.mount(context)}</span>)}</SurfaceToolbar>{error ? <Card variant="raised" role="alert">Could not load the saved CRM records: {error}</Card> : null}{composition.views.map((descriptor) => <span key={descriptor.id}>{descriptor.id === activeView.id ? descriptor.mount(context) : null}</span>)}{getDirectoryRails().map((descriptor) => <span key={descriptor.id}>{descriptor.mount(context)}</span>)}</section>;
}
