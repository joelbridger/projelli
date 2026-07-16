import { describe, expect, it, vi } from 'vitest';
import {
  askAnswerActionRegistry,
  askCitationBelongsToScope,
  askScopeBuilder,
  askSourceBelongsToScope,
  askSourceRegistry,
  buildAskCitation,
  buildAskRetrievalPlan,
  collectAskSourceCandidates,
  createAskConversationStore,
  listAskAnswerActions,
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

describe('Ask public use-time client isolation', () => {
  it('saves under A, then every source, citation, and action doorway refuses that state after B or none', async () => {
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
    const optionsFor = (
      currentClient: AskClientSnapshot<FixtureClientRef> | null
    ) => ({ currentClient, owners: fixtureOwners });
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

    let currentClient: AskClientSnapshot<FixtureClientRef> | null =
      fixtureClient;
    const clientAccess: AskClientUseAccess<
      FixtureClientRef,
      FixtureMeetingRef
    > = {
      readCurrentClient: () => currentClient,
      owners: fixtureOwners,
    };
    const oldScope = resolveAskScope(
      savedUnderA.scope,
      fixtureClient,
      fixtureOwners
    );
    const oldSource = savedUnderA.sources[0];
    if (!oldSource) throw new Error('Client A source did not save.');
    const oldCitation = buildAskCitation(
      'client-a-claim',
      oldScope,
      oldSource,
      clientAccess
    );

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
      clientAccess,
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
    expect(askSourceBelongsToScope(oldScope, oldSource, clientAccess)).toBe(
      true
    );
    expect(
      askCitationBelongsToScope(oldScope, oldCitation, clientAccess)
    ).toBe(true);
    expect(
      resolveAskCitationOpenPath(oldScope, oldCitation, clientAccess)
    ).toEqual(oldSource.citationOpenPath);

    for (const nextClient of [clientB, null] as const) {
      currentClient = nextClient;

      // Clearing the newly projected store is useful, but is not the proof:
      // the already-held A values below must also fail at their use doorways.
      expect(
        createAskConversationStore(port(), optionsFor(nextClient))
          .sourceSelections
      ).toEqual([]);
      expect(askSourceBelongsToScope(oldScope, oldSource, clientAccess)).toBe(
        false
      );
      expect(() =>
        registeredSource?.listCandidates(oldScope, clientAccess)
      ).toThrow('stale or unavailable');
      expect(() => collectAskSourceCandidates(oldScope, clientAccess)).toThrow(
        'stale or unavailable'
      );
      expect(() =>
        buildAskRetrievalPlan(
          oldScope,
          ['document'],
          [oldSource],
          clientAccess
        )
      ).toThrow('stale or unavailable');
      expect(() =>
        buildAskCitation(
          'stale-client-a-claim',
          oldScope,
          oldSource,
          clientAccess
        )
      ).toThrow('outside the resolved scope');
      expect(
        askCitationBelongsToScope(oldScope, oldCitation, clientAccess)
      ).toBe(false);
      expect(() =>
        resolveAskCitationOpenPath(oldScope, oldCitation, clientAccess)
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
  });
});
