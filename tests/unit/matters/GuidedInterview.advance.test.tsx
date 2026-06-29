import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { GuidedInterview } from '@/features/matters/GuidedInterview';
import { useClientMapStore } from '@/platform/clientMap/clientMapStore';
import { emptyClientMap } from '@/platform/clientMap/types';

beforeEach(() => {
  const m = emptyClientMap('m1');
  m.completeness = { level: 'thin', know: [], assuming: [], ask: [
    { text: 'Q1 trial date?', sectionKey: 'followups' },
    { text: 'Q2 adjuster?', sectionKey: 'household' },
    { text: 'Q3 issue?', sectionKey: 'money' },
  ] };
  useClientMapStore.setState({ maps: { m1: m }, clientQuestions: {} } as never);
});

describe('GuidedInterview advance does not skip', () => {
  it('answering Q1 then shows Q2 (not Q3)', () => {
    render(<GuidedInterview matterId="m1" onClose={vi.fn()} />);
    expect(screen.getByText('Q1 trial date?')).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('clientmap-interview-answer'), { target: { value: 'March 3' } });
    fireEvent.click(screen.getByTestId('clientmap-interview-submit'));
    // Q1 resolved + pruned; Q2 should now be shown, NOT skipped to Q3.
    expect(screen.getByText('Q2 adjuster?')).toBeInTheDocument();
    expect(screen.queryByText('Q1 trial date?')).not.toBeInTheDocument();
  });

  it('flagging the last question reaches all caught up', () => {
    render(<GuidedInterview matterId="m1" onClose={vi.fn()} />);
    // answer Q1, Q2, then flag Q3
    fireEvent.change(screen.getByTestId('clientmap-interview-answer'), { target: { value: 'a' } });
    fireEvent.click(screen.getByTestId('clientmap-interview-submit'));
    fireEvent.change(screen.getByTestId('clientmap-interview-answer'), { target: { value: 'b' } });
    fireEvent.click(screen.getByTestId('clientmap-interview-submit'));
    fireEvent.click(screen.getByTestId('clientmap-interview-flag'));
    expect(screen.getByText('No open questions right now.')).toBeInTheDocument();
  });
});
