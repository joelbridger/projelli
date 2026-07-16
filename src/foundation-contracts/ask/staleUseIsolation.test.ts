import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  askAnswerActionRegistry,
  askCitationBelongsToScope,
  askScopeBuilder,
  askSharedClientIsBound,
  askSourceBelongsToScope,
  askSourceRegistry,
  bindAskSharedClient,
  buildAskCitation,
  buildAskRetrievalPlan,
  collectAskSourceCandidates,
  createAskConversationStore,
  listAskAnswerActions,
  listAskSourceAdapters,
  noLocalAnswer,
  registerAskAnswerAction,
  registerAskSource,
  resolveAskCitationOpenPath,
  resolveAskScope,
  type AskAnswerActionContext,
  type AskAnswerActionDescriptor,
  type AskClientSnapshot,
  type AskClientUseAccess,
  type AskConversationPort,
  type AskSavedSourceSelection,
  type AskSourceAdapter,
  type AskSourceDescriptor,
} from '@/features/ask';
import {
  fixtureClient,
  fixtureOwners,
  type FixtureClientRef,
  type FixtureMeetingRef,
} from './ownerFixture';

const clientB: AskClientSnapshot<FixtureClientRef> = {
  contactRef: {
    owner: 'fixture-client-owner',
    id: 'client-2',
    matterId: 'matter-2',
  },
  matterId: 'matter-2',
  revision: 'client-2:1',
};

const sourceA: AskSourceDescriptor<FixtureClientRef, FixtureMeetingRef> = {
  sourceId: 'stale-use-source-a',
  kind: 'document',
  workspaceId: 'fixture-workspace',
  client: fixtureClient,
  label: 'Client A plan',
  availability: 'available',
  citationOpenPath: { kind: 'document', token: 'client-a-plan' },
};

// One live shared-client binding is the single source of truth. Flipping this
// variable IS the client switch: there is no per-call access a caller could
// retain to keep reading client A after the owner moves to B or clears it.
let currentClient: AskClientSnapshot<FixtureClientRef> | null = fixtureClient;
const boundAccess: AskClientUseAccess<FixtureClientRef, FixtureMeetingRef> = {
  readCurrentClient: () => currentClient,
  owners: fixtureOwners,
};

describe('Ask public use-time client isolation', () => {
  beforeEach(() => {
    currentClient = fixtureClient;
    bindAskSharedClient(boundAccess);
  });

  it('saves under A, then every source, citation, action, and opener doorway refuses that state after B, none, or unbind', async () => {
    let records: AskConversationPort['records'] = [];
    const port = (): AskConversationPort => ({
      records,
      workspaceRoot: '/fixture-workspace',
      save: (record) => {
        records = [...records.filter((item) => item.id !== record.id), record];
        return Promise.resolve(record);
      },
      reloadRecords: () => Promise.resolve(records),
    });
    // The reactive persistence store is projected under its own reactive client
    // prop; the imperative doorways below read the single live binding.
    const optionsFor = (
      client: AskClientSnapshot<FixtureClientRef> | null
    ) => ({ currentClient: client, owners: fixtureOwners });
    const savedSelection: AskSavedSourceSelection<
      FixtureClientRef,
      FixtureMeetingRef
    > = {
      id: 'saved-under-client-a',
      scope: askScopeBuilder.chosenSources(
        'fixture-workspace',
        fixtureClient,
        [sourceA.sourceId]
      ),
      sources: [sourceA],
      createdAt: '2026-07-16T00:00:00.000Z',
      updatedAt: '2026-07-16T00:00:00.000Z',
    };

    await createAskConversationStore(
      port(),
      optionsFor(fixtureClient)
    ).saveSourceSelection(savedSelection);
    const savedUnderA = createAskConversationStore(
      port(),
      optionsFor(fixtureClient)
    ).sourceSelections[0];
    expect(savedUnderA).toBeDefined();
    if (!savedUnderA) throw new Error('Client A selection did not save.');

    // Resolve and build every actionable handle while A is the live client.
    const oldScope = resolveAskScope(
      savedUnderA.scope,
      fixtureClient,
      fixtureOwners
    );
    const oldSource = savedUnderA.sources[0];
    if (!oldSource) throw new Error('Client A source did not save.');
    const oldCitation = buildAskCitation('client-a-claim', oldScope, oldSource);

    const sourceAdapter: AskSourceAdapter<
      FixtureClientRef,
      FixtureMeetingRef
    > = {
      id: 'outside-stale-use-source',
      order: 9801,
      sourceKinds: ['document'],
      listCandidates: () => [oldSource],
    };
    registerAskSource(sourceAdapter);
    const registeredSource = askSourceRegistry.find(
      (adapter) => adapter.id === sourceAdapter.id
    ) as AskSourceAdapter<FixtureClientRef, FixtureMeetingRef> | undefined;
    expect(registeredSource).toBeDefined();

    interface Authority {
      readonly allowed: true;
    }
    interface Audit {
      readonly receiptId: string;
    }
    type ActionContext = AskAnswerActionContext<
      FixtureClientRef,
      FixtureMeetingRef,
      Authority,
      Audit
    >;
    const executed = vi.fn();
    const action: AskAnswerActionDescriptor<
      FixtureClientRef,
      FixtureMeetingRef,
      Authority,
      Audit
    > = {
      id: 'outside-stale-use-action',
      order: 9802,
      isAvailable: () => true,
      execute: executed,
    };
    registerAskAnswerAction(action);
    const context: ActionContext = {
      scope: oldScope,
      answer: noLocalAnswer(),
      citations: [oldCitation],
      authority: { allowed: true },
      audit: { receiptId: 'fixture-receipt' },
    };
    const heldAction = listAskAnswerActions(context).find(
      (candidate) => candidate.id === action.id
    );
    expect(heldAction).toBeDefined();
    expect(
      askAnswerActionRegistry.some((candidate) => candidate.id === action.id)
    ).toBe(true);

    // While A is live, every held handle admits the client-A state.
    expect(askSourceBelongsToScope(oldScope, oldSource)).toBe(true);
    expect(askCitationBelongsToScope(oldScope, oldCitation)).toBe(true);
    expect(resolveAskCitationOpenPath(oldScope, oldCitation)).toEqual(
      oldSource.citationOpenPath
    );
    expect(collectAskSourceCandidates(oldScope).length).toBeGreaterThan(0);

    // Switch the single live client to B, then clear it. The retained handles
    // above must refuse the client-A state at their use doorways — this is the
    // proof, not merely that a re-projected store came back empty.
    for (const nextClient of [clientB, null] as const) {
      currentClient = nextClient;

      expect(
        createAskConversationStore(port(), optionsFor(nextClient))
          .sourceSelections
      ).toEqual([]);
      expect(askSourceBelongsToScope(oldScope, oldSource)).toBe(false);
      expect(() => registeredSource?.listCandidates(oldScope)).toThrow(
        'stale or unavailable'
      );
      expect(() => listAskSourceAdapters(oldScope)).toThrow(
        'stale or unavailable'
      );
      expect(() => collectAskSourceCandidates(oldScope)).toThrow(
        'stale or unavailable'
      );
      expect(() =>
        buildAskRetrievalPlan(oldScope, ['document'], [oldSource])
      ).toThrow('stale or unavailable');
      expect(() =>
        buildAskCitation('stale-client-a-claim', oldScope, oldSource)
      ).toThrow('outside the resolved scope');
      expect(askCitationBelongsToScope(oldScope, oldCitation)).toBe(false);
      expect(() =>
        resolveAskCitationOpenPath(oldScope, oldCitation)
      ).toThrow('stale or outside the current client');
      expect(
        listAskAnswerActions(context).some(
          (candidate) => candidate.id === action.id
        )
      ).toBe(false);
      expect(heldAction?.isAvailable(context)).toBe(false);
      expect(() => heldAction?.execute(context)).toThrow(
        'stale answer action at use time'
      );
      expect(executed).not.toHaveBeenCalled();
    }

    // Unbinding the owner entirely also fails closed at every doorway.
    currentClient = fixtureClient;
    const unbind = bindAskSharedClient(boundAccess);
    unbind();
    expect(askSharedClientIsBound()).toBe(false);
    expect(askSourceBelongsToScope(oldScope, oldSource)).toBe(false);
    expect(() => listAskSourceAdapters(oldScope)).toThrow('is not bound');
    expect(() =>
      resolveAskCitationOpenPath(oldScope, oldCitation)
    ).toThrow('stale or outside the current client');
    expect(() => heldAction?.execute(context)).toThrow(
      'stale answer action at use time'
    );
    expect(executed).not.toHaveBeenCalled();
  });
});
