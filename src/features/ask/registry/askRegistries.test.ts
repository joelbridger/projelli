import { describe, expect, it, vi } from 'vitest';
import type {
  AskAnswerActionDescriptor,
  AskModeDescriptor,
  AskSourceDescriptor,
} from './types';
import {
  askAnswerActionRegistry,
  askModeRegistry,
  askSourceRegistry,
  getAskAnswerActions,
  getAskMode,
  getAskSource,
  openAskSource,
  registerAskAnswerAction,
  registerAskMode,
  registerAskSource,
  validateAskAnswerActionDescriptors,
  validateAskModeDescriptors,
  validateAskSourceDescriptors,
} from './askRegistries';

declare module '@/platform/types/ask' {
  interface AskModeIdMap {
    'test-dummy-mode': true;
  }
  interface AskSourceIdMap {
    'test-dummy-source': true;
  }
  interface AskAnswerActionIdMap {
    'test-dummy-action': true;
  }
}

describe('Ask registries', () => {
  it('keeps the compatibility mode, sources, and answer action reachable', () => {
    expect(getAskMode('normal')).toBe(askModeRegistry[0]);
    expect(askSourceRegistry).not.toHaveLength(0);
    expect(getAskSource({ path: 'crm:household-1' })?.id).toBe('crm');
    expect(
      getAskSource({ path: 'mail:message-1', sourceType: 'mail' })?.id
    ).toBe('mail');
    expect(getAskSource({ path: 'clients/foster.docx' })?.id).toBe('document');
    expect(getAskAnswerActions()).toEqual(askAnswerActionRegistry);
  });

  it('lets independently supplied descriptors extend each registry without a central switch', async () => {
    const mode: AskModeDescriptor = {
      id: 'test-dummy-mode',
      order: 99,
      buildRetrievalPlan: () => ({
        scope: { kind: 'allMatters' },
        filterHits: (hits) => hits,
      }),
      promptFormat: () => ({ kind: 'smart' }),
    };
    const sourceOpen = vi.fn();
    const source: AskSourceDescriptor = {
      id: 'test-dummy-source',
      // Specific sources run before the document fallback (order 30).
      order: 25,
      matches: (candidate) => candidate.path === 'dummy:',
      canOpen: () => true,
      open: sourceOpen,
    };
    const actionExecute = vi.fn();
    const action: AskAnswerActionDescriptor = {
      id: 'test-dummy-action',
      order: 99,
      reviewable: true,
      kind: 'answer-completed',
      execute: actionExecute,
    };
    registerAskMode(mode);
    registerAskSource(source);
    registerAskAnswerAction(action);

    expect(
      getAskMode('test-dummy-mode').buildRetrievalPlan({
        activeMatterId: null,
        askScope: 'all-matters',
      }).scope
    ).toEqual({ kind: 'allMatters' });
    expect(openAskSource({ path: 'dummy:' }, {})).toBe(true);
    await getAskAnswerActions()
      .find((candidate) => candidate.id === 'test-dummy-action')
      ?.execute({
      turn: { question: 'q', answer: 'a', citations: [], sources: [] },
      });
    expect(sourceOpen).toHaveBeenCalledOnce();
    expect(actionExecute).toHaveBeenCalledOnce();
  });

  it('routes CRM, mail, and documents through their registered openers', () => {
    const openCrm = vi.fn();
    const openEmail = vi.fn();
    const openDocument = vi.fn();
    const context = { openCrm, openEmail, openDocument };
    const crm = {
      path: 'crm:note:1',
      sourceType: 'crm',
      matterId: 'matter-1',
      excerpt: 'Private note',
    };
    const mail = { path: 'message-1', sourceType: 'mail' };
    const document = {
      path: 'clients/foster/plan.pdf',
      sourceType: 'pdf',
      matterId: 'matter-1',
      pageNumber: 7,
    };

    expect(openAskSource(crm, context)).toBe(true);
    expect(openAskSource(mail, context)).toBe(true);
    expect(openAskSource(document, context)).toBe(true);
    expect(openCrm).toHaveBeenCalledWith(crm);
    expect(openEmail).toHaveBeenCalledWith(mail);
    expect(openDocument).toHaveBeenCalledWith(document);
  });

  it('keeps a document closed when its client-safe opener is unavailable', () => {
    expect(
      openAskSource(
        { path: 'clients/foster/plan.pdf', matterId: 'matter-1' },
        {},
      ),
    ).toBe(false);
  });

  it('fails duplicate ids and invalid metadata deterministically', () => {
    const mode = askModeRegistry[0];
    if (!mode) throw new Error('Expected normal Ask compatibility mode');
    expect(() => {
      validateAskModeDescriptors([mode, mode]);
    }).toThrow('[askModeRegistry] duplicate id: normal');
    expect(() => {
      validateAskSourceDescriptors([
        { id: 'document', order: 1 } as AskSourceDescriptor,
      ]);
    }).toThrow('[askSourceRegistry] invalid source metadata: document');
    expect(() => {
      validateAskAnswerActionDescriptors([
        {
          id: 'answer-completed',
          order: 1,
          reviewable: true,
          kind: 'navigation',
        } as AskAnswerActionDescriptor,
      ]);
    }).toThrow(
      '[askAnswerActionRegistry] invalid action metadata: answer-completed'
    );
  });
});
