import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AskAnswerActionContext,
  AskAnswerActionDescriptor,
  AskClientSnapshot,
  AskOwnerIdentityAdapter,
  AskSourceAdapter,
  AskSourceDescriptor,
} from './contracts';
import { createAskSharedClientOwner } from './owner';
import { mintAskClientSnapshot } from './clientSnapshotAuthority';
import {
  askScopeBuilder,
  askSourceBelongsToScope,
  resolveAskScope,
} from './scope';
import {
  askCitationBelongsToScope,
  buildAskCitation,
  buildAskRetrievalPlan,
  noLocalAnswer,
  resolveAskCitationOpenPath,
  sealAskOpenPath,
} from './retrieval';
import {
  collectAskSourceCandidates,
  listAskAnswerActions,
  listAskSourceAdapters,
  registerAskAnswerAction,
  registerAskSource,
} from './registry';

interface CRef {
  readonly owner: 'fixture-client-owner';
  readonly id: string;
  readonly matterId: string;
}
interface MRef {
  readonly owner: 'fixture-meeting-owner';
  readonly id: string;
  readonly matterId: string;
}
const owners: AskOwnerIdentityAdapter<CRef, MRef> = {
  isClientReference: (v): v is CRef =>
    !!v && typeof v === 'object' && 'owner' in v && v.owner === 'fixture-client-owner',
  clientMatterId: (r) => r.matterId,
  sameClient: (l, r) => l.id === r.id && l.matterId === r.matterId,
  isMeetingReference: (v): v is MRef =>
    !!v && typeof v === 'object' && 'owner' in v && v.owner === 'fixture-meeting-owner',
  meetingId: (r) => r.id,
  meetingMatterId: (r) => r.matterId,
  sameMeeting: (l, r) => l.id === r.id && l.matterId === r.matterId,
};
const clientA: AskClientSnapshot<CRef> = mintAskClientSnapshot({
  contactRef: { owner: 'fixture-client-owner', id: 'a', matterId: 'matter-a' },
  matterId: 'matter-a',
  revision: 'a:1',
});
const clientB: AskClientSnapshot<CRef> = mintAskClientSnapshot({
  contactRef: { owner: 'fixture-client-owner', id: 'b', matterId: 'matter-b' },
  matterId: 'matter-b',
  revision: 'b:1',
});

const RAW_TOKEN = 'client-a-document-secret';
const sourceA: AskSourceDescriptor<CRef, MRef> = {
  sourceId: 'iso-source-a',
  kind: 'document',
  workspaceId: 'workspace-a',
  client: clientA,
  label: 'A plan',
  availability: 'available',
  citationOpenPath: sealAskOpenPath({ kind: 'document', token: RAW_TOKEN }),
};

let current: AskClientSnapshot<CRef> | null = clientA;
const access = { readCurrentClient: () => current, owners };
let owner: ReturnType<typeof createAskSharedClientOwner<CRef, MRef>> | null =
  null;

beforeEach(() => {
  current = clientA;
  owner?.release();
  owner = createAskSharedClientOwner<CRef, MRef>();
  owner.bind(access);
});

describe('Ask use-time isolation when the real owner switches', () => {
  it('refuses a held source, citation, opener, and action after the owner switches A -> B -> none, without rebuilding', () => {
    const scope = resolveAskScope(
      askScopeBuilder.chosenSources('workspace-a', clientA, [sourceA.sourceId]),
      clientA,
      owners
    );
    const citation = buildAskCitation('claim-a', scope, sourceA);

    const adapter: AskSourceAdapter<CRef, MRef> = {
      id: 'iso-source-adapter',
      order: 7001,
      sourceKinds: ['document'],
      listCandidates: () => [sourceA],
    };
    registerAskSource(adapter);

    interface Authority {
      readonly allowed: true;
    }
    interface Audit {
      readonly receiptId: string;
    }
    type Ctx = AskAnswerActionContext<CRef, MRef, Authority, Audit>;
    const executed = vi.fn();
    const action: AskAnswerActionDescriptor<CRef, MRef, Authority, Audit> = {
      id: 'iso-action',
      order: 7002,
      isAvailable: () => true,
      execute: executed,
    };
    registerAskAnswerAction(action);
    const context: Ctx = {
      scope,
      answer: noLocalAnswer(),
      citations: [citation],
      authority: { allowed: true },
      audit: { receiptId: 'r' },
    };
    const heldAction = listAskAnswerActions(context).find(
      (c) => c.id === action.id
    );
    expect(heldAction).toBeDefined();

    // The source never exposes the raw opener token as a plain field.
    expect(JSON.stringify(sourceA.citationOpenPath)).not.toContain(RAW_TOKEN);
    expect(
      (sourceA.citationOpenPath as unknown as Record<string, unknown>)['token']
    ).toBeUndefined();

    // Under A, everything works and the opener unseals to the real token.
    expect(askSourceBelongsToScope(scope, sourceA)).toBe(true);
    expect(askCitationBelongsToScope(scope, citation)).toBe(true);
    expect(resolveAskCitationOpenPath(scope, citation)).toEqual({
      kind: 'document',
      token: RAW_TOKEN,
    });
    expect(collectAskSourceCandidates(scope).length).toBeGreaterThan(0);

    // Switch the real owner. The SAME held handles must refuse at use-time
    // WITHOUT being rebuilt.
    for (const next of [clientB, null] as const) {
      current = next;
      expect(askSourceBelongsToScope(scope, sourceA)).toBe(false);
      expect(askCitationBelongsToScope(scope, citation)).toBe(false);
      expect(() => resolveAskCitationOpenPath(scope, citation)).toThrow(
        'stale or outside the current client'
      );
      expect(() => listAskSourceAdapters(scope)).toThrow(
        'stale or unavailable'
      );
      expect(() =>
        buildAskRetrievalPlan(scope, ['document'], [sourceA])
      ).toThrow('stale or unavailable');
      expect(() => buildAskCitation('claim-b', scope, sourceA)).toThrow(
        'outside the resolved scope'
      );
      expect(
        listAskAnswerActions(context).some((c) => c.id === action.id)
      ).toBe(false);
      expect(heldAction?.isAvailable(context)).toBe(false);
      expect(() => heldAction?.execute(context)).toThrow(
        'stale answer action at use time'
      );
      expect(executed).not.toHaveBeenCalled();
    }

    // Releasing the owner (no shared-client owner at all) also fails closed.
    current = clientA;
    owner?.release();
    expect(askSourceBelongsToScope(scope, sourceA)).toBe(false);
    expect(() => resolveAskCitationOpenPath(scope, citation)).toThrow(
      'stale or outside the current client'
    );
    expect(() => heldAction?.execute(context)).toThrow(
      'stale answer action at use time'
    );
    expect(executed).not.toHaveBeenCalled();
  });

  it('establish-once: a second owner (e.g. reached through a boundary blind spot) cannot overwrite the binding to restore a stale client', () => {
    // The legitimate owner holds the binding at client B.
    current = clientB;
    // beforeEach already established the owner bound to `current`; confirm B.
    const scope = resolveAskScope(
      askScopeBuilder.chosenSources('workspace-a', clientA, [sourceA.sourceId]),
      clientA,
      owners
    );
    expect(askSourceBelongsToScope(scope, sourceA)).toBe(false); // B active, A refused

    // An attacker deep-imports createAskSharedClientOwner and tries to rebind to
    // a frozen client A to restore stale data. Establish-once refuses at runtime,
    // independent of any import-path guard.
    const attacker = createAskSharedClientOwner<CRef, MRef>();
    expect(() => {
      attacker.bind({ readCurrentClient: () => clientA, owners });
    }).toThrow('already established');
    // The attacker also cannot release the real owner's binding (not the holder).
    attacker.release();
    // A remains refused; the attacker could not restore it.
    expect(askSourceBelongsToScope(scope, sourceA)).toBe(false);
  });
});
