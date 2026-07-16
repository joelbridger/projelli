import { describe, expect, it, vi } from 'vitest';
import type {
  AskAnswerActionContext,
  AskAnswerActionDescriptor,
  AskMeetingArtifactSource,
  AskModeDescriptor,
  AskOwnerIdentityAdapter,
  ResolvedAskScope,
  AskSourceAdapter,
  AskSourceDescriptor,
} from './contracts';
import {
  askScopeBuilder,
  AskScopeError,
  askSourceBelongsToScope,
  resolveAskScope,
} from './scope';
import {
  askCitationBelongsToScope,
  buildAskCitation,
  buildAskRetrievalPlan,
  noLocalAnswer,
} from './retrieval';
import {
  collectAskSourceCandidates,
  listAskAnswerActions,
  listAskModes,
  listAskSourceAdapters,
  registerAskAnswerAction,
  registerAskMode,
  registerAskSource,
} from './registry';

interface FixtureClientRef {
  readonly owner: 'fixture-client-owner';
  readonly kind: 'household';
  readonly id: string;
  readonly matterId: string;
}

interface FixtureMeetingRef {
  readonly owner: 'fixture-meeting-owner';
  readonly id: string;
  readonly matterId: string;
}

const owners: AskOwnerIdentityAdapter<FixtureClientRef, FixtureMeetingRef> = {
  isClientReference: (value): value is FixtureClientRef =>
    !!value &&
    typeof value === 'object' &&
    'owner' in value &&
    value.owner === 'fixture-client-owner',
  clientMatterId: (reference) => reference.matterId,
  sameClient: (left, right) =>
    left.id === right.id && left.matterId === right.matterId,
  isMeetingReference: (value): value is FixtureMeetingRef =>
    !!value &&
    typeof value === 'object' &&
    'owner' in value &&
    value.owner === 'fixture-meeting-owner',
  meetingId: (reference) => reference.id,
  meetingMatterId: (reference) => reference.matterId,
  sameMeeting: (left, right) =>
    left.id === right.id && left.matterId === right.matterId,
};

const clientA = {
  contactRef: {
    owner: 'fixture-client-owner',
    kind: 'household',
    id: 'a',
    matterId: 'matter-a',
  },
  matterId: 'matter-a',
  revision: 'a:1',
} as const;
const clientB = {
  contactRef: {
    owner: 'fixture-client-owner',
    kind: 'household',
    id: 'b',
    matterId: 'matter-b',
  },
  matterId: 'matter-b',
  revision: 'b:1',
} as const;
const accessA = { readCurrentClient: () => clientA, owners } as const;
const accessB = { readCurrentClient: () => clientB, owners } as const;
const meetingA = {
  owner: 'fixture-meeting-owner',
  id: 'meeting-a',
  matterId: 'matter-a',
} as const;
const meetingA2 = {
  owner: 'fixture-meeting-owner',
  id: 'meeting-a-2',
  matterId: 'matter-a',
} as const;
const meetingB = {
  owner: 'fixture-meeting-owner',
  id: 'meeting-b',
  matterId: 'matter-b',
} as const;

const sourceA: AskSourceDescriptor<FixtureClientRef, FixtureMeetingRef> = {
  sourceId: 'source-a',
  kind: 'document',
  workspaceId: 'workspace-a',
  client: clientA,
  label: 'A plan',
  availability: 'available',
  citationOpenPath: { kind: 'document', token: 'document-a' },
};

function meetingArtifact(
  meeting: FixtureMeetingRef,
  overrides: Partial<
    AskMeetingArtifactSource<FixtureClientRef, FixtureMeetingRef>
  > = {}
): AskMeetingArtifactSource<FixtureClientRef, FixtureMeetingRef> {
  return {
    sourceId: `artifact-${meeting.id}`,
    kind: 'meeting-artifact',
    workspaceId: 'workspace-a',
    client: clientA,
    label: 'Approved meeting artifact',
    availability: 'available',
    citationOpenPath: { kind: 'meeting', token: meeting.id },
    meeting,
    occurredOn: '2026-07-10',
    meetingType: 'review',
    ...overrides,
  };
}

describe('Ask client and meeting foundation behavior', () => {
  it('fails closed for every saved client scope, source, and citation after A changes to B or none', () => {
    const chosenScope = askScopeBuilder.chosenSources('workspace-a', clientA, [
      'source-a',
    ]);
    const scopes = [
      askScopeBuilder.currentClient('workspace-a', clientA),
      chosenScope,
      askScopeBuilder.singleMeeting('workspace-a', clientA, meetingA),
      askScopeBuilder.selectedMeetings('workspace-a', clientA, [meetingA]),
      askScopeBuilder.meetingRange(
        'workspace-a',
        clientA,
        '2026-07-01',
        '2026-07-31',
        ['review']
      ),
    ];

    for (const staleScope of scopes) {
      expect(() => resolveAskScope(staleScope, clientB, owners)).toThrow(
        AskScopeError
      );
      expect(() => resolveAskScope(staleScope, null, owners)).toThrow(
        AskScopeError
      );
    }

    const chosen = resolveAskScope(chosenScope, clientA, owners);
    const citation = buildAskCitation('claim', chosen, sourceA, accessA);
    expect(askCitationBelongsToScope(chosen, citation, accessA)).toBe(true);
    expect(() => resolveAskScope(citation.scope, clientB, owners)).toThrow(
      'stale or unavailable'
    );
    expect(() => resolveAskScope(citation.scope, null, owners)).toThrow(
      'stale or unavailable'
    );
  });

  it('accepts artifacts by their real meeting reference and rejects unproved range facts', () => {
    const artifact = meetingArtifact(meetingA, { sourceId: 'artifact-a' });
    const single = resolveAskScope(
      askScopeBuilder.singleMeeting('workspace-a', clientA, meetingA),
      clientA,
      owners
    );
    expect(askSourceBelongsToScope(single, artifact, accessA)).toBe(true);

    const selected = resolveAskScope(
      askScopeBuilder.selectedMeetings('workspace-a', clientA, [
        meetingA,
        meetingA2,
      ]),
      clientA,
      owners
    );
    expect(askSourceBelongsToScope(selected, artifact, accessA)).toBe(true);
    expect(
      askSourceBelongsToScope(selected, meetingArtifact(meetingB), accessA)
    ).toBe(false);
    expect(() =>
      resolveAskScope(
        askScopeBuilder.selectedMeetings('workspace-a', clientA, [
          meetingA,
          meetingB,
        ]),
        clientA,
        owners
      )
    ).toThrow('one client boundary');

    const range = resolveAskScope(
      askScopeBuilder.meetingRange(
        'workspace-a',
        clientA,
        '2026-07-01',
        '2026-07-31',
        ['review']
      ),
      clientA,
      owners
    );
    expect(askSourceBelongsToScope(range, artifact, accessA)).toBe(true);
    expect(
      askSourceBelongsToScope(
        range,
        meetingArtifact(meetingA, { occurredOn: '' }),
        accessA
      )
    ).toBe(false);
    expect(
      askSourceBelongsToScope(
        range,
        meetingArtifact(meetingA, { meetingType: '' }),
        accessA
      )
    ).toBe(false);
    expect(
      askSourceBelongsToScope(
        range,
        meetingArtifact(meetingA, { occurredOn: '2026-08-01' }),
        accessA
      )
    ).toBe(false);
    expect(
      askSourceBelongsToScope(
        range,
        meetingArtifact(meetingA, { meetingType: 'prospect' }),
        accessA
      )
    ).toBe(false);
  });

  it('keeps unrelated sources out and reports no local answer honestly', () => {
    const scope = resolveAskScope(
      askScopeBuilder.chosenSources('workspace-a', clientA, ['source-a']),
      clientA,
      owners
    );
    const plan = buildAskRetrievalPlan(
      scope,
      ['document'],
      [sourceA, { ...sourceA, sourceId: 'source-b', client: clientB }],
      accessA
    );
    expect(plan.references).toEqual([
      {
        sourceId: 'source-a',
        reason: 'Eligible document in resolved chosen-sources scope.',
      },
    ]);
    expect(() =>
      buildAskCitation(
        'claim',
        scope,
        { ...sourceA, sourceId: 'source-b' },
        accessA
      )
    ).toThrow('outside the resolved scope');
    expect(noLocalAnswer()).toEqual({
      kind: 'no-local-answer',
      message: 'No local answer is available for this scope.',
      citations: [],
    });
  });
});

describe('Ask appendable registries stay open-world', () => {
  const scopeA = resolveAskScope(
    askScopeBuilder.currentClient('workspace-a', clientA),
    clientA,
    owners
  );
  const scopeB = resolveAskScope(
    askScopeBuilder.currentClient('workspace-a', clientB),
    clientB,
    owners
  );

  it('uses the public source append path, excludes dark/foreign contributors, and keeps stable order', () => {
    const darkLoad = vi.fn(() => [sourceA]);
    const adapter = (
      id: string,
      order: number,
      candidates: readonly AskSourceDescriptor<
        FixtureClientRef,
        FixtureMeetingRef
      >[],
      isEnabled?: () => boolean
    ): AskSourceAdapter<FixtureClientRef, FixtureMeetingRef> => ({
      id,
      order,
      sourceKinds: ['document'],
      ...(isEnabled ? { isEnabled } : {}),
      listCandidates: () => candidates,
    });
    registerAskSource(
      adapter('foundation-test-source-base-a', 9101, [sourceA])
    );
    registerAskSource(
      adapter('foundation-test-source-base-b', 9102, [
        { ...sourceA, sourceId: 'foreign', client: clientB },
      ])
    );
    registerAskSource(
      adapter('foundation-test-source-third', 9103, [
        { ...sourceA, sourceId: 'source-third' },
      ])
    );
    registerAskSource({
      ...adapter('foundation-test-source-dark', 9104, []),
      isEnabled: () => false,
      listCandidates: darkLoad,
    });

    const candidates = collectAskSourceCandidates(scopeA, accessA);
    const ownOrder = listAskSourceAdapters(scopeA, accessA)
      .filter((descriptor) =>
        descriptor.id.startsWith('foundation-test-source-')
      )
      .map((descriptor) => descriptor.id);
    expect(ownOrder).toEqual([
      'foundation-test-source-base-a',
      'foundation-test-source-base-b',
      'foundation-test-source-third',
    ]);
    expect(
      candidates.some((source) => source.sourceId === 'source-third')
    ).toBe(true);
    expect(candidates.some((source) => source.sourceId === 'foreign')).toBe(
      false
    );
    expect(darkLoad).not.toHaveBeenCalled();
    expect(() => {
      registerAskSource(
        adapter('foundation-test-source-third', 9199, [sourceA])
      );
    }).toThrow('duplicate id');
    expect(() => {
      registerAskSource({
        ...adapter('foundation-test-source-malformed', 9199, [sourceA]),
        sourceKinds: ['dark' as never],
      });
    }).toThrow('invalid adapter');
  });

  it('uses the public mode append path with a real third contributor and client/dark exclusion', () => {
    const mode = (
      id: string,
      order: number,
      isEnabled?: AskModeDescriptor<
        FixtureClientRef,
        FixtureMeetingRef
      >['isEnabled']
    ): AskModeDescriptor<FixtureClientRef, FixtureMeetingRef> => ({
      id,
      order,
      responseFormat: 'normal',
      buildScope: askScopeBuilder,
      ...(isEnabled ? { isEnabled } : {}),
    });
    registerAskMode(mode('foundation-test-mode-base-a', 9201));
    registerAskMode(mode('foundation-test-mode-base-b', 9202));
    registerAskMode(
      mode(
        'foundation-test-mode-third',
        9203,
        (scope) =>
          scope.kind !== 'whole-firm' && scope.client.matterId === 'matter-a'
      )
    );
    registerAskMode(mode('foundation-test-mode-dark', 9204, () => false));

    expect(
      listAskModes(scopeA, accessA).some(
        (descriptor) => descriptor.id === 'foundation-test-mode-third'
      )
    ).toBe(true);
    expect(
      listAskModes(scopeB, accessB).some(
        (descriptor) => descriptor.id === 'foundation-test-mode-third'
      )
    ).toBe(false);
    expect(
      listAskModes(scopeA, accessA)
        .filter((descriptor) =>
          descriptor.id.startsWith('foundation-test-mode-')
        )
        .map((descriptor) => descriptor.id)
    ).toEqual([
      'foundation-test-mode-base-a',
      'foundation-test-mode-base-b',
      'foundation-test-mode-third',
    ]);
    expect(
      listAskModes(scopeA, accessA).some(
        (descriptor) => descriptor.id === 'foundation-test-mode-dark'
      )
    ).toBe(false);
    expect(() => {
      registerAskMode(mode('foundation-test-mode-third', 9299));
    }).toThrow('duplicate id');
    expect(() => {
      registerAskMode({
        ...mode('foundation-test-mode-malformed', 9299),
        responseFormat: 'dark' as never,
      });
    }).toThrow('invalid mode');
  });

  it('uses the public action append path without inventing authority/audit shapes', () => {
    interface FixtureAuthority {
      readonly allowedMatterId: string;
    }
    interface FixtureAudit {
      readonly record: ReturnType<typeof vi.fn>;
    }
    type Context = AskAnswerActionContext<
      FixtureClientRef,
      FixtureMeetingRef,
      FixtureAuthority,
      FixtureAudit
    >;
    const action = (
      id: string,
      order: number,
      isEnabled?: (context: Context) => boolean
    ): AskAnswerActionDescriptor<
      FixtureClientRef,
      FixtureMeetingRef,
      FixtureAuthority,
      FixtureAudit
    > => ({
      id,
      order,
      ...(isEnabled ? { isEnabled } : {}),
      isAvailable: (context) =>
        context.scope.kind !== 'whole-firm' &&
        context.authority.allowedMatterId === context.scope.client.matterId,
      execute: vi.fn(),
    });
    registerAskAnswerAction(action('foundation-test-action-base-a', 9301));
    registerAskAnswerAction(action('foundation-test-action-base-b', 9302));
    registerAskAnswerAction(action('foundation-test-action-third', 9303));
    registerAskAnswerAction(
      action('foundation-test-action-dark', 9304, () => false)
    );

    const context = (
      scope: ResolvedAskScope<FixtureClientRef, FixtureMeetingRef>
    ): Context => ({
      scope,
      clientAccess: scope === scopeB ? accessB : accessA,
      answer: noLocalAnswer(),
      citations: [],
      authority: { allowedMatterId: 'matter-a' },
      audit: { record: vi.fn() },
    });
    expect(
      listAskAnswerActions(context(scopeA)).some(
        (descriptor) => descriptor.id === 'foundation-test-action-third'
      )
    ).toBe(true);
    expect(listAskAnswerActions(context(scopeB))).toEqual([]);
    expect(
      listAskAnswerActions(context(scopeA)).some(
        (descriptor) => descriptor.id === 'foundation-test-action-dark'
      )
    ).toBe(false);
    expect(
      listAskAnswerActions(context(scopeA))
        .filter((descriptor) =>
          descriptor.id.startsWith('foundation-test-action-')
        )
        .map((descriptor) => descriptor.id)
    ).toEqual([
      'foundation-test-action-base-a',
      'foundation-test-action-base-b',
      'foundation-test-action-third',
    ]);
    expect(() => {
      registerAskAnswerAction(action('foundation-test-action-third', 9399));
    }).toThrow('duplicate id');
    expect(() => {
      registerAskAnswerAction({
        id: 'foundation-test-action-malformed',
        order: 9399,
      } as AskAnswerActionDescriptor<
        FixtureClientRef,
        FixtureMeetingRef,
        FixtureAuthority,
        FixtureAudit
      >);
    }).toThrow('invalid action');
  });
});
