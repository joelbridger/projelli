/* eslint-disable lantern-i18n/no-hardcoded-string -- Frozen CRM screen copy lives in compatibility descriptors until its product copy changes. */
import { useCallback, useMemo, useState } from 'react';
import { Card, SurfaceToolbar } from '@/ui/kp';
import { useFlagRegistryVersion } from '@/platform/flags/router';
import { createDirectoryContextWithFeatureStatePorts, defaultDirectoryComposition, getDirectoryActions, getDirectoryRails, resolveDirectoryView, type DirectoryComposition, type DirectoryContext, type DirectoryFeatureState, type DirectoryFeatureStateValue } from './directoryRegistry';
import type { CrmClientsActions, CrmPerson, HouseholdDirectoryEntry } from './adapters';
import type { ContactDirectoryProjection } from '@/features/crm-contacts';
import type { DirectoryRepository } from './directoryRegistry';

export function DirectorySurface({ people, households = [], contacts, directoryRepository, actions, onCreateHousehold, error, composition = defaultDirectoryComposition }: { people: readonly CrmPerson[]; households?: readonly HouseholdDirectoryEntry[]; contacts?: readonly ContactDirectoryProjection[]; directoryRepository?: DirectoryRepository; actions?: CrmClientsActions; onCreateHousehold?: (name: string) => Promise<void> | void; error?: string | null; composition?: DirectoryComposition; }) {
  const flagRegistryVersion = useFlagRegistryVersion();
  const [query, setQuery] = useState('');
  const [person, setPerson] = useState<CrmPerson | null>(null);
  const [view, setView] = useState<string | null>('directory');
  const [tab, setTab] = useState('households');
  const [externalOnly, setExternalOnly] = useState(false);
  const [needsVerification, setNeedsVerification] = useState(false);
  const [featureStateValues, setFeatureStateValues] = useState<ReadonlyMap<string, DirectoryFeatureStateValue>>(new Map());
  const featureStatePort = useCallback(<Value extends DirectoryFeatureStateValue>(namespace: string): DirectoryFeatureState<Value> => ({
    get: () => featureStateValues.get(namespace) as Value | undefined,
    set: (value) => {
      setFeatureStateValues((previous) => previous.get(namespace) === value
        ? previous
        : new Map(previous).set(namespace, value));
    },
  }), [featureStateValues]);
  const context = useMemo<DirectoryContext>(() => createDirectoryContextWithFeatureStatePorts({ query: { value: query, setValue: setQuery }, selection: { person, setPerson }, view: { value: view, setValue: setView }, sort: { value: view, setValue: setView }, filters: { tab, setTab, externalOnly, setExternalOnly, needsVerification, setNeedsVerification }, records: { people, households }, ...(contacts ? { contacts } : {}), repository: { openContact: directoryRepository?.openContact ?? (async () => {}), resolveContact: directoryRepository?.resolveContact ?? (async () => null), openHousehold: (id) => { actions?.onOpenHousehold?.(id); }, reviewRecipient: (id) => { actions?.onReviewRecipient?.(id); }, createHousehold: (name) => onCreateHousehold?.(name) }, composition }, featureStatePort, flagRegistryVersion), [actions, composition, contacts, directoryRepository, externalOnly, featureStatePort, flagRegistryVersion, households, needsVerification, onCreateHousehold, people, person, query, tab, view]);
  const activeView = resolveDirectoryView(context);
  return <section data-testid="crm-directory-surface"><header><p style={{ marginBottom: 2 }}>Clients / Directory</p><h1 style={{ marginTop: 0 }}>People and external parties</h1></header><SurfaceToolbar data-testid="crm-directory-toolbar">{composition.tools.filter((descriptor) => descriptor.isEnabled?.() ?? true).map((descriptor) => <span key={descriptor.id}>{descriptor.mount(context)}</span>)}{getDirectoryActions().map((descriptor) => <span key={descriptor.id}>{descriptor.mount(context)}</span>)}</SurfaceToolbar>{error ? <Card variant="raised" role="alert">Could not load the saved CRM records: {error}</Card> : null}{activeView.mount(context)}{getDirectoryRails().map((descriptor) => <span key={descriptor.id}>{descriptor.mount(context)}</span>)}</section>;
}
