import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  askClientIdentityAdapter,
  askScopeBuilder,
  askScopeIsCurrent,
  buildAskCitation,
  buildAskRetrievalPlan,
  establishAskSharedClientContext,
  readAskSharedClientSnapshot,
  resolveAskCitationOpenPath,
  resolveAskScope,
  sealAskOpenPath,
  useAskSharedClientSnapshot,
  type AskClientSnapshot,
  type AskSourceDescriptor,
} from '@/features/ask';
import type { ContactRef } from '@/features/crm-contacts';
import {
  issueSharedClientSelection,
  replaceCanonicalHouseholdDirectory,
  requestClearClientSelection,
  requestSharedClientSelection,
} from '@/platform/client-context';
import { useMatterStore } from '@/platform/matter/matterStore';
import type { Matter } from '@/platform/types/matter';

const householdA = { provider: 'wealthbox' as const, householdId: 'household-a', displayName: 'Alpha household' };
const householdB = { provider: 'wealthbox' as const, householdId: 'household-b', displayName: 'Beta household' };

function matter(id: string, householdId: string): Matter {
  return {
    id,
    name: id,
    client: householdId,
    folderPaths: [],
    crmHouseholdKeys: [householdId],
    createdAt: '2026-07-17T00:00:00.000Z',
  };
}

function select(client: typeof householdA | typeof householdB): void {
  act(() => {
    replaceCanonicalHouseholdDirectory('wealthbox', [client]);
    void requestSharedClientSelection(issueSharedClientSelection(client));
  });
}

function clearSelection(): void {
  act(() => {
    requestClearClientSelection();
  });
}

function setMatters(matters: Matter[]): void {
  act(() => {
    useMatterStore.setState({ matters });
  });
}

function snapshot(): AskClientSnapshot<ContactRef> {
  const value = readAskSharedClientSnapshot();
  if (!value) throw new Error('expected a sealed live Ask snapshot');
  return value;
}

function sourceUnder(
  client: AskClientSnapshot<ContactRef>
): AskSourceDescriptor<ContactRef> {
  return {
    sourceId: 'alpha-source',
    kind: 'document',
    workspaceId: 'ask-owner-fixture',
    client,
    label: 'Alpha plan',
    availability: 'available',
    citationOpenPath: sealAskOpenPath({ kind: 'document', token: 'alpha-token' }),
  };
}

let release: (() => void) | null = null;

beforeEach(() => {
  clearSelection();
  setMatters([]);
  release = establishAskSharedClientContext();
});

afterEach(() => {
  release?.();
  release = null;
  clearSelection();
  setMatters([]);
});

describe('Ask owner snapshot authority', () => {
  it('live-resolves the real ContactRef, clears A state before B, and invalidates remaps', () => {
    setMatters([matter('matter-a', householdA.householdId), matter('matter-b', householdB.householdId)]);
    select(householdA);
    const snapA = snapshot();
    expect(snapA.contactRef).toMatchObject({ kind: 'household', id: 'household-a', matterId: 'matter-a' });
    expect(Object.isFrozen(snapA)).toBe(true);
    expect(Object.isFrozen(snapA.contactRef)).toBe(true);

    const sourceA = sourceUnder(snapA);
    const scopeA = resolveAskScope(
      askScopeBuilder.currentClient('ask-owner-fixture', snapA),
      snapA,
      askClientIdentityAdapter
    );
    const citationA = buildAskCitation('claim-a', scopeA, sourceA);
    expect(resolveAskCitationOpenPath(scopeA, citationA)).toEqual({ kind: 'document', token: 'alpha-token' });

    select(householdB);
    expect(askScopeIsCurrent(scopeA)).toBe(false);
    expect(() => resolveAskCitationOpenPath(scopeA, citationA)).toThrow('stale or outside the current client');

    clearSelection();
    expect(askScopeIsCurrent(scopeA)).toBe(false);
    expect(readAskSharedClientSnapshot()).toBeNull();

    select(householdA);
    const remappedA = matter('matter-a-remapped', householdA.householdId);
    setMatters([remappedA, matter('matter-b', householdB.householdId)]);
    expect(readAskSharedClientSnapshot()?.matterId).toBe('matter-a-remapped');
    expect(askScopeIsCurrent(scopeA)).toBe(false);
  });

  it('reactively clears a stale rendered snapshot and never accepts a late A opener', async () => {
    setMatters([matter('matter-a', householdA.householdId), matter('matter-b', householdB.householdId)]);
    select(householdA);
    const hook = renderHook(() => useAskSharedClientSnapshot());
    const snapA = hook.result.current;
    if (!snapA) throw new Error('expected A snapshot');
    const sourceA = sourceUnder(snapA);
    const scopeA = resolveAskScope(
      askScopeBuilder.currentClient('ask-owner-fixture', snapA), snapA, askClientIdentityAdapter
    );
    const citationA = buildAskCitation('claim-a', scopeA, sourceA);

    const lateOpen = (async () => {
      await Promise.resolve();
      return resolveAskCitationOpenPath(scopeA, citationA);
    })();
    select(householdB);
    expect(hook.result.current?.contactRef.id).toBe('household-b');
    await expect(lateOpen).rejects.toThrow('stale or outside the current client');

    clearSelection();
    expect(hook.result.current).toBeNull();
    hook.unmount();
  });

  it('rejects cast-forged input and makes nested mutation a frozen dead end', () => {
    setMatters([matter('matter-a', householdA.householdId)]);
    select(householdA);
    const genuine = snapshot();
    const forged = {
      contactRef: { kind: 'household', id: 'household-a', matterId: 'matter-a' },
      matterId: 'matter-a',
      revision: genuine.revision,
    } as unknown as AskClientSnapshot<ContactRef>;
    expect(() =>
      resolveAskScope(
        askScopeBuilder.currentClient('ask-owner-fixture', forged),
        genuine,
        askClientIdentityAdapter
      )
    ).toThrow('minted by the shared-client owner');
    expect(() => {
      (genuine.contactRef as { matterId: string }).matterId = 'attacker-matter';
    }).toThrow();

    const scopeA = resolveAskScope(
      askScopeBuilder.currentClient('ask-owner-fixture', genuine), genuine, askClientIdentityAdapter
    );
    select(householdB);
    expect(askScopeIsCurrent(scopeA)).toBe(false);
  });

  it('fails closed for missing and ambiguous household-to-matter links', () => {
    select(householdA);
    expect(readAskSharedClientSnapshot()).toBeNull();
    setMatters([matter('matter-a', householdA.householdId), matter('matter-a-duplicate', householdA.householdId)]);
    expect(readAskSharedClientSnapshot()).toBeNull();
  });

  it('refuses retained A retrieval work after the household remaps', () => {
    setMatters([matter('matter-a', householdA.householdId)]);
    select(householdA);
    const snapA = snapshot();
    const sourceA = sourceUnder(snapA);
    const scopeA = resolveAskScope(
      askScopeBuilder.currentClient('ask-owner-fixture', snapA), snapA, askClientIdentityAdapter
    );
    setMatters([matter('matter-a-remapped', householdA.householdId)]);
    expect(() => buildAskRetrievalPlan(scopeA, ['document'], [sourceA])).toThrow('stale or unavailable');
  });
});
