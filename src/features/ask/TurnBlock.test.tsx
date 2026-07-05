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
 * spinner while fresh, a warning line once `answerStalled` flips true (shown
 * whether the stall happens before the first token OR mid-answer, once some
 * text has already streamed in — the watchdog re-arms per chunk, so both are
 * real stall shapes), and no warning while genuinely progressing.
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

  it('never shows the spinner once a real answer is streaming in, but is not stalled', () => {
    const inProgressTurn: AskTurn = { ...streamingTurn, answer: 'The Chen household is doing a 1031 exchange.' };
    render(<TurnBlock {...baseProps} turn={inProgressTurn} answerStalled={false} />);
    expect(screen.queryByText('Answering…')).toBeNull();
    expect(screen.queryByTestId('ask-answer-stalled-warning')).toBeNull();
  });

  /**
   * P2 (codex review) — the watchdog in useAsk re-arms on every streamed
   * chunk, so a stream that emits SOME text and then goes silent also flips
   * `answerStalled` — not only the pre-first-token case above. Without
   * surfacing the warning here too, the user would stare at frozen partial
   * text with no feedback until the 45s hard timeout kills the turn.
   */
  it('shows the stalled warning + status link over PARTIAL text once the stream goes silent mid-answer', () => {
    const onOpenAiStatus = vi.fn();
    const partialTurn: AskTurn = { ...streamingTurn, answer: 'The Chen household is doing a' };
    render(<TurnBlock {...baseProps} turn={partialTurn} answerStalled onOpenAiStatus={onOpenAiStatus} />);
    // The partial text itself must still render — the warning augments it,
    // it never replaces or hides the tokens already streamed in.
    expect(screen.getByText(/The Chen household is doing a/)).toBeTruthy();
    expect(screen.queryByText('Answering…')).toBeNull();
    const warning = screen.getByTestId('ask-answer-stalled-warning');
    expect(warning.textContent).toContain('taking longer than expected');
    fireEvent.click(screen.getByText('View AI status'));
    expect(onOpenAiStatus).toHaveBeenCalledTimes(1);
  });
});
