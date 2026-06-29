// tests/unit/matters/GuidedInterview.test.tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { GuidedInterview } from '@/features/matters/GuidedInterview';
import { useClientMapStore } from '@/platform/clientMap/clientMapStore';
import { emptyClientMap } from '@/platform/clientMap/types';

beforeEach(() => {
  const m = emptyClientMap('m1');
  m.completeness = { level: 'thin', know: [], assuming: [], ask: [{ text: 'What is the trial date?', sectionKey: 'followups' }] };
  useClientMapStore.setState({ maps: { m1: m }, clientQuestions: {} } as never);
});

describe('GuidedInterview', () => {
  it('answering a question fills the map as a user-origin item', () => {
    render(<GuidedInterview matterId="m1" onClose={vi.fn()} />);
    fireEvent.change(screen.getByTestId('clientmap-interview-answer'), { target: { value: 'March 3' } });
    fireEvent.click(screen.getByTestId('clientmap-interview-submit'));
    const items = useClientMapStore.getState().getMap('m1')!.sections.flatMap((s) => s.items);
    expect(items.some((i) => i.text === 'March 3' && i.origin === 'user')).toBe(true);
  });

  it('flagging adds it to the client questions list', () => {
    render(<GuidedInterview matterId="m1" onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId('clientmap-interview-flag'));
    expect(useClientMapStore.getState().getClientQuestions('m1')).toHaveLength(1);
  });
});
