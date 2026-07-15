import { describe, expect, it, vi } from 'vitest';
import type { AskAnswerActionDescriptor } from '../registry/types';
import {
  AskSendPipeline,
  askSendContextProviderRegistry,
  type AskSendContextProvider,
} from './AskSendPipeline';

declare module '@/platform/types/ask' {
  interface AskAnswerActionIdMap {
    'test-pipeline-completed': true;
    'test-pipeline-reviewable': true;
  }
}

describe('AskSendPipeline', () => {
  it('captures identical matter and all-matters boundaries for every send stage', () => {
    const pipeline = new AskSendPipeline();
    expect(
      pipeline.buildContext({
        activeMatterId: 'matter-1',
        activeMatterName: 'Foster household',
      }),
    ).toEqual({
      consentScope: { kind: 'matter', matterId: 'matter-1' },
      retrievalScope: { kind: 'matter', matterId: 'matter-1' },
      turnScope: {
        kind: 'matter',
        matterId: 'matter-1',
        matterName: 'Foster household',
      },
      auditScope: {
        kind: 'matter',
        matterId: 'matter-1',
        matterName: 'Foster household',
      },
    });
    expect(
      pipeline.buildContext({ activeMatterId: null, activeMatterName: null }),
    ).toEqual({
      consentScope: { kind: 'allMatters' },
      retrievalScope: { kind: 'allMatters' },
      turnScope: { kind: 'allMatters' },
      auditScope: { kind: 'allMatters' },
    });
  });

  it('runs registered context providers in order without adding a send branch', () => {
    const extraProvider: AskSendContextProvider = {
      id: 'test-override',
      order: 20,
      provide: () => ({ auditScope: { kind: 'allMatters' } }),
    };
    const pipeline = new AskSendPipeline([
      ...askSendContextProviderRegistry,
      extraProvider,
    ]);
    expect(
      pipeline.buildContext({
        activeMatterId: 'matter-1',
        activeMatterName: 'Foster household',
      }).auditScope,
    ).toEqual({ kind: 'allMatters' });
  });

  it('flows answer completion through the action registry without auto-running review actions', async () => {
    const completed = vi.fn();
    const reviewable = vi.fn();
    const actions: AskAnswerActionDescriptor[] = [
      {
        id: 'test-pipeline-completed',
        order: 10,
        reviewable: true,
        kind: 'answer-completed',
        execute: completed,
      },
      {
        id: 'test-pipeline-reviewable',
        order: 20,
        reviewable: true,
        kind: 'create-task',
        execute: reviewable,
      },
    ];
    const pipeline = new AskSendPipeline(
      askSendContextProviderRegistry,
      () => actions,
    );
    const turn = { question: 'Q', answer: 'A', citations: [], sources: [] };
    await pipeline.completeAnswer({ turn });
    expect(completed).toHaveBeenCalledWith({ turn });
    expect(reviewable).not.toHaveBeenCalled();
  });
});
