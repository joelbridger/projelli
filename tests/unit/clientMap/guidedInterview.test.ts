// tests/unit/clientMap/guidedInterview.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { interviewQuestions, answerQuestion, flagForClient } from '@/platform/clientMap/guidedInterview';
import { useClientMapStore } from '@/platform/clientMap/clientMapStore';
import { emptyClientMap } from '@/platform/clientMap/types';

beforeEach(() => {
  const m = emptyClientMap('m1');
  m.completeness = { level: 'thin', know: [], assuming: [], ask: ['What is the trial date?', 'Who is the adjuster?'] };
  useClientMapStore.setState({ maps: { m1: m }, clientQuestions: {} } as never);
});

describe('guidedInterview', () => {
  it('lists the gap questions', () => {
    const map = useClientMapStore.getState().getMap('m1')!;
    expect(interviewQuestions(map)).toEqual(['What is the trial date?', 'Who is the adjuster?']);
  });
  it('answering creates a sovereign (user-origin) item', () => {
    answerQuestion('m1', 'upcoming', 'Trial is set for March 3');
    const item = useClientMapStore.getState().getMap('m1')!.sections.find((s) => s.key === 'upcoming')!.items[0];
    expect(item.text).toBe('Trial is set for March 3');
    expect(item.origin).toBe('user');
  });
  it('flagging adds a question to the client list', () => {
    flagForClient('m1', 'Who is the adjuster?');
    expect(useClientMapStore.getState().getClientQuestions('m1').map((q) => q.text)).toContain('Who is the adjuster?');
  });
});
