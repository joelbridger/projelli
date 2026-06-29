// tests/unit/clientMap/guidedInterview.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { interviewQuestions, answerQuestion, flagForClient } from '@/platform/clientMap/guidedInterview';
import { useClientMapStore } from '@/platform/clientMap/clientMapStore';
import { emptyClientMap } from '@/platform/clientMap/types';
import type { GapQuestion } from '@/platform/clientMap/types';

beforeEach(() => {
  const m = emptyClientMap('m1');
  m.completeness = {
    level: 'thin',
    know: [],
    assuming: [],
    ask: [
      { text: 'What is the trial date?', sectionKey: 'followups' },
      { text: 'Who is the adjuster?', sectionKey: 'household' },
    ],
  };
  useClientMapStore.setState({ maps: { m1: m }, clientQuestions: {} } as never);
});

describe('guidedInterview', () => {
  it('lists the gap questions with their target section', () => {
    const map = useClientMapStore.getState().getMap('m1')!;
    expect(interviewQuestions(map)).toEqual([
      { text: 'What is the trial date?', sectionKey: 'followups' },
      { text: 'Who is the adjuster?', sectionKey: 'household' },
    ]);
  });

  it('appends empty custom sections as gap questions tagged with their own section key', () => {
    const map = useClientMapStore.getState().getMap('m1')!;
    map.sections.push({ id: 'cs1', kind: 'custom', key: 'cs1', title: 'Billing', prompt: 'Track fee arrangement', scope: 'matter', items: [] });
    useClientMapStore.setState({ maps: { m1: map } } as never);
    const qs = interviewQuestions(useClientMapStore.getState().getMap('m1')!);
    expect(qs).toContainEqual({ text: 'Track fee arrangement', sectionKey: 'cs1' });
  });

  it('answering creates a sovereign (user-origin) item in the named section', () => {
    answerQuestion('m1', 'followups', 'Trial is set for March 3');
    const item = useClientMapStore.getState().getMap('m1')!.sections.find((s) => s.key === 'followups')!.items[0]!;
    expect(item.text).toBe('Trial is set for March 3');
    expect(item.origin).toBe('user');
  });

  it('routes an answer to the gap question target section (not always money)', () => {
    const map = useClientMapStore.getState().getMap('m1')!;
    const peopleGap: GapQuestion = interviewQuestions(map).find((q) => q.sectionKey === 'household')!;
    answerQuestion('m1', peopleGap.sectionKey, 'The adjuster is Pat Lee');
    const people = useClientMapStore.getState().getMap('m1')!.sections.find((s) => s.key === 'household')!;
    const standing = useClientMapStore.getState().getMap('m1')!.sections.find((s) => s.key === 'money')!;
    expect(people.items.map((i) => i.text)).toContain('The adjuster is Pat Lee');
    expect(standing.items.map((i) => i.text)).not.toContain('The adjuster is Pat Lee');
  });

  it('routes a custom-section gap answer into that custom section', () => {
    const map = useClientMapStore.getState().getMap('m1')!;
    map.sections.push({ id: 'cs1', kind: 'custom', key: 'cs1', title: 'Billing', prompt: 'Track fee arrangement', scope: 'matter', items: [] });
    useClientMapStore.setState({ maps: { m1: map } } as never);
    const gap = interviewQuestions(useClientMapStore.getState().getMap('m1')!).find((q) => q.sectionKey === 'cs1')!;
    answerQuestion('m1', gap.sectionKey, 'Flat fee of $5,000');
    const custom = useClientMapStore.getState().getMap('m1')!.sections.find((s) => s.key === 'cs1')!;
    expect(custom.items.map((i) => i.text)).toContain('Flat fee of $5,000');
  });

  it('flagging adds a question to the client list', () => {
    flagForClient('m1', 'Who is the adjuster?');
    expect(useClientMapStore.getState().getClientQuestions('m1').map((q) => q.text)).toContain('Who is the adjuster?');
  });
});
