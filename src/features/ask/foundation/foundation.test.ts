import { describe, expect, it, vi } from 'vitest';
import type {
  AskAnswerActionDescriptor,
  AskModeDescriptor,
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
  validateAskAnswerActionRegistry,
  validateAskModeRegistry,
  validateAskSourceRegistry,
} from './registry';

const clientA = {
  contactRef: { kind: 'household', id: 'a', matterId: 'matter-a' },
  matterId: 'matter-a',
  revision: 'a:1',
} as const;
const clientB = {
  contactRef: { kind: 'household', id: 'b', matterId: 'matter-b' },
  matterId: 'matter-b',
  revision: 'b:1',
} as const;
const sourceA: AskSourceDescriptor = {
  sourceId: 'source-a',
  kind: 'document',
  workspaceId: 'workspace-a',
  matterId: 'matter-a',
  contactRef: clientA.contactRef,
  label: 'A plan',
  availability: 'available',
  citationOpenPath: { kind: 'document', token: 'document-a' },
};

describe('Ask local-first foundation', () => {
  it('clears the old client scope when shared context changes from A to B or none', () => {
    const staleScope = askScopeBuilder.currentClient('workspace-a', clientA);
    expect(() => resolveAskScope(staleScope, clientB)).toThrow(AskScopeError);
    expect(() => resolveAskScope(staleScope, null)).toThrow(AskScopeError);
    const resolved = resolveAskScope(staleScope, clientA);
    expect(askSourceBelongsToScope(resolved, sourceA)).toBe(true);
    expect(
      askSourceBelongsToScope(resolved, { ...sourceA, matterId: 'matter-b' })
    ).toBe(false);
  });

  it('fails closed for unrelated sources and citations while keeping no-local answers honest', () => {
    const scope = resolveAskScope(
      askScopeBuilder.chosenSources(
        'workspace-a',
        'matter-a',
        ['source-a'],
        clientA.contactRef
      )
    );
    const plan = buildAskRetrievalPlan(
      scope,
      ['document'],
      [sourceA, { ...sourceA, sourceId: 'source-b', matterId: 'matter-b' }]
    );
    expect(plan.references).toEqual([
      {
        sourceId: 'source-a',
        reason: 'Eligible document in resolved chosen-sources scope.',
      },
    ]);
    expect(() =>
      buildAskCitation('claim', scope, { ...sourceA, sourceId: 'source-b' })
    ).toThrow('outside the resolved scope');
    const citation = buildAskCitation('claim', scope, sourceA);
    expect(askCitationBelongsToScope(scope, citation)).toBe(true);
    expect(
      askCitationBelongsToScope(
        resolveAskScope(askScopeBuilder.wholeFirm('workspace-b')),
        citation
      )
    ).toBe(false);
    expect(noLocalAnswer()).toEqual({
      kind: 'no-local-answer',
      message: 'No local answer is available for this scope.',
      citations: [],
    });
  });

  it('accepts base composition plus a genuine third contributor in stable order', () => {
    const adapter = (id: string, order: number): AskSourceAdapter => ({
      id,
      order,
      sourceKinds: ['document'],
      listCandidates: () => [],
    });
    validateAskSourceRegistry([
      adapter('crm', 10),
      adapter('documents', 20),
      adapter('third-local-source', 30),
    ]);
    expect(() => {
      validateAskSourceRegistry([adapter('first', 20), adapter('second', 10)]);
    }).toThrow('descriptor order must be stable');
    expect(() => {
      validateAskSourceRegistry([adapter('same', 10), adapter('same', 20)]);
    }).toThrow('duplicate id: same');
  });

  it('rejects malformed modes and actions before they can reach a consumer', () => {
    const mode: AskModeDescriptor = {
      id: 'normal',
      order: 10,
      responseFormat: 'normal',
      buildScope: askScopeBuilder,
    };
    validateAskModeRegistry([
      mode,
      {
        ...mode,
        id: 'meeting-report',
        order: 20,
        responseFormat: 'meeting-report',
      },
    ]);
    expect(() => {
      validateAskModeRegistry([{ ...mode, responseFormat: 'dark' as never }]);
    }).toThrow('invalid mode');
    const action: AskAnswerActionDescriptor = {
      id: 'open',
      order: 10,
      isAvailable: () => true,
      execute: vi.fn(),
    };
    validateAskAnswerActionRegistry([
      action,
      { ...action, id: 'draft', order: 20 },
    ]);
    expect(() => {
      validateAskAnswerActionRegistry([
        { id: 'bad', order: 10 } as AskAnswerActionDescriptor,
      ]);
    }).toThrow('invalid action');
  });
});
