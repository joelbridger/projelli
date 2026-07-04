import '@/i18n';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TurnBlock } from './TurnBlock';
import type { AskTurn } from './askHelpers';

const streamingTurn: AskTurn = {
  question: 'Which client is doing a 1031 exchange?',
  answer: '',
  citations: [],
  sources: [],
  isStreaming: true,
};

const baseProps = {
  turn: streamingTurn,
  turnIdx: 0,
  selectedTurnIdx: null,
  selected: null,
  onCitationSelect: () => {},
  isSaving: false,
  isPersisted: false,
  isStreaming: true,
};

/**
 * QA-7 — the "Answering…" spinner used to give no feedback at all, however
 * long it sat with no token. These specs pin the visible state machine: quiet
 * spinner while fresh, a warning line once `answerStalled` flips true, and no
 * trace of either once a real answer is streaming in.
 */
describe('TurnBlock — QA-7 stalled-answer feedback', () => {
  it('shows only the plain spinner when not stalled', () => {
    render(<TurnBlock {...baseProps} answerStalled={false} />);
    expect(screen.getByText('Answering…')).toBeTruthy();
    expect(screen.queryByTestId('ask-answer-stalled-warning')).toBeNull();
  });

  it('shows the stalled warning once answerStalled is true, alongside the spinner', () => {
    render(<TurnBlock {...baseProps} answerStalled />);
    expect(screen.getByText('Answering…')).toBeTruthy();
    const warning = screen.getByTestId('ask-answer-stalled-warning');
    expect(warning.textContent).toContain('taking longer than expected');
    expect(warning.textContent).toContain('local model may still be downloading or loading');
  });

  it('the "View AI status" link calls onOpenAiStatus when provided', () => {
    const onOpenAiStatus = vi.fn();
    render(<TurnBlock {...baseProps} answerStalled onOpenAiStatus={onOpenAiStatus} />);
    fireEvent.click(screen.getByText('View AI status'));
    expect(onOpenAiStatus).toHaveBeenCalledTimes(1);
  });

  it('omits the link when onOpenAiStatus is not provided, but still shows the warning', () => {
    render(<TurnBlock {...baseProps} answerStalled />);
    expect(screen.getByTestId('ask-answer-stalled-warning')).toBeTruthy();
    expect(screen.queryByText('View AI status')).toBeNull();
  });

  it('never shows the spinner or the warning once a real answer is streaming in', () => {
    const inProgressTurn: AskTurn = { ...streamingTurn, answer: 'The Chen household is doing a 1031 exchange.' };
    render(<TurnBlock {...baseProps} turn={inProgressTurn} answerStalled />);
    expect(screen.queryByText('Answering…')).toBeNull();
    expect(screen.queryByTestId('ask-answer-stalled-warning')).toBeNull();
  });
});
