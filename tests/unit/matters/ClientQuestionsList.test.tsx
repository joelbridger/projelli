// tests/unit/matters/ClientQuestionsList.test.tsx
//
// BUG-108 — the "Questions for the client" list must offer a copy action and a
// per-row remove (the store already exposes removeClientQuestion). Uses the real
// store.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ClientQuestionsList } from '@/features/matters/ClientQuestionsList';
import { useClientMapStore } from '@/platform/clientMap/clientMapStore';

beforeEach(() => {
  useClientMapStore.setState({ maps: {}, clientQuestions: {} });
});

describe('ClientQuestionsList (BUG-108)', () => {
  it('removes a flagged question when its remove control is clicked', () => {
    useClientMapStore.getState().addClientQuestion('m1', 'What is the deductible?');
    useClientMapStore.getState().addClientQuestion('m1', 'Who is the adjuster?');

    render(<ClientQuestionsList matterId="m1" />);
    expect(screen.getAllByTestId('clientmap-question-remove')).toHaveLength(2);

    fireEvent.click(screen.getAllByTestId('clientmap-question-remove')[0]!);

    const remaining = useClientMapStore.getState().getClientQuestions('m1').map((q) => q.text);
    expect(remaining).toEqual(['Who is the adjuster?']);
  });

  it('copies all questions to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    useClientMapStore.getState().addClientQuestion('m1', 'What is the deductible?');
    useClientMapStore.getState().addClientQuestion('m1', 'Who is the adjuster?');

    render(<ClientQuestionsList matterId="m1" />);
    fireEvent.click(screen.getByTestId('clientmap-questions-copy'));

    await waitFor(() => { expect(writeText).toHaveBeenCalledTimes(1); });
    expect(writeText.mock.calls[0]![0]).toContain('What is the deductible?');
    expect(writeText.mock.calls[0]![0]).toContain('Who is the adjuster?');
  });

  it('shows no controls when the list is empty', () => {
    render(<ClientQuestionsList matterId="m1" />);
    expect(screen.queryByTestId('clientmap-questions-copy')).not.toBeInTheDocument();
    expect(screen.queryByTestId('clientmap-question-remove')).not.toBeInTheDocument();
  });
});
