/* eslint-disable lantern-i18n/no-hardcoded-string -- Frozen CRM screen copy lives in compatibility descriptors until its product copy changes. */
import { useMemo, useState } from 'react';
import { Card, SurfaceToolbar } from '@/ui/kp';
import { useFlagRegistryVersion } from '@/platform/flags/router';
import { getDirectoryActions, getDirectoryRails, getDirectoryTools, getDirectoryViews, type DirectoryContext } from './directoryRegistry';
import type { CrmClientsActions, CrmPerson, HouseholdDirectoryEntry } from './adapters';

export function DirectorySurface({ people, households = [], actions, onCreateHousehold, error }: { people: readonly CrmPerson[]; households?: readonly HouseholdDirectoryEntry[]; actions?: CrmClientsActions; onCreateHousehold?: (name: string) => Promise<void> | void; error?: string | null; }) {
  useFlagRegistryVersion();
  const [query, setQuery] = useState('');
  const [person, setPerson] = useState<CrmPerson | null>(null);
  const [view, setView] = useState<string | null>('directory');
  const [tab, setTab] = useState('households');
  const [externalOnly, setExternalOnly] = useState(false);
  const [needsVerification, setNeedsVerification] = useState(false);
  const context = useMemo<DirectoryContext>(() => ({ query: { value: query, setValue: setQuery }, selection: { person, setPerson }, sort: { value: view, setValue: setView }, filters: { tab, setTab, externalOnly, setExternalOnly, needsVerification, setNeedsVerification }, records: { people, households }, repository: { openHousehold: (id) => { actions?.onOpenHousehold?.(id); }, reviewRecipient: (id) => { actions?.onReviewRecipient?.(id); }, createHousehold: (name) => onCreateHousehold?.(name) } }), [actions, externalOnly, households, needsVerification, onCreateHousehold, people, person, query, tab, view]);
  return <section data-testid="crm-directory-surface"><header><p style={{ marginBottom: 2 }}>Clients / Directory</p><h1 style={{ marginTop: 0 }}>People and external parties</h1></header><SurfaceToolbar data-testid="crm-directory-toolbar">{getDirectoryTools().filter((descriptor) => descriptor.isEnabled?.() ?? true).map((descriptor) => <span key={descriptor.id}>{descriptor.mount(context)}</span>)}{getDirectoryActions().map((descriptor) => <span key={descriptor.id}>{descriptor.mount(context)}</span>)}</SurfaceToolbar>{error ? <Card variant="raised" role="alert">Could not load the saved CRM records: {error}</Card> : null}{getDirectoryViews().map((descriptor) => <span key={descriptor.id}>{descriptor.mount(context)}</span>)}{getDirectoryRails().map((descriptor) => <span key={descriptor.id}>{descriptor.mount(context)}</span>)}</section>;
}
