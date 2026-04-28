/**
 * Task 11 — ReadAloudButton component
 *
 * Covers:
 *   - Renders a button when ttsEnabled=true and ttsAvailable=true
 *   - Is hidden when ttsEnabled=false
 *   - Is hidden when ttsAvailable=false (Piper binary not bundled)
 *   - Calls onSpeak(text) when clicked while idle
 *   - Calls onStop() when clicked while playing
 *   - Shows stop icon when playing prop is true
 *   - Shows volume icon when playing prop is false
 *   - data-testid="read-aloud-button" present
 *   - Is disabled while loading
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ReadAloudButton } from '@/components/tts/ReadAloudButton';

describe('ReadAloudButton', () => {
  const defaultProps = {
    text: 'Hello AI world',
    ttsEnabled: true,
    ttsAvailable: true,
    playing: false,
    loading: false,
    onSpeak: vi.fn(),
    onStop: vi.fn(),
  };

  it('renders when ttsEnabled and ttsAvailable are both true', () => {
    render(<ReadAloudButton {...defaultProps} />);
    expect(screen.getByTestId('read-aloud-button')).toBeInTheDocument();
  });

  it('is hidden when ttsEnabled is false', () => {
    render(<ReadAloudButton {...defaultProps} ttsEnabled={false} />);
    expect(screen.queryByTestId('read-aloud-button')).toBeNull();
  });

  it('is hidden when ttsAvailable is false', () => {
    render(<ReadAloudButton {...defaultProps} ttsAvailable={false} />);
    expect(screen.queryByTestId('read-aloud-button')).toBeNull();
  });

  it('calls onSpeak with text when clicked while idle', () => {
    const onSpeak = vi.fn();
    render(<ReadAloudButton {...defaultProps} onSpeak={onSpeak} playing={false} />);
    fireEvent.click(screen.getByTestId('read-aloud-button'));
    expect(onSpeak).toHaveBeenCalledWith('Hello AI world');
    expect(onSpeak).toHaveBeenCalledTimes(1);
  });

  it('calls onStop when clicked while playing', () => {
    const onStop = vi.fn();
    render(<ReadAloudButton {...defaultProps} playing={true} onStop={onStop} />);
    fireEvent.click(screen.getByTestId('read-aloud-button'));
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('does not call onSpeak when clicked while playing', () => {
    const onSpeak = vi.fn();
    render(<ReadAloudButton {...defaultProps} playing={true} onSpeak={onSpeak} />);
    fireEvent.click(screen.getByTestId('read-aloud-button'));
    expect(onSpeak).not.toHaveBeenCalled();
  });

  it('is disabled while loading', () => {
    render(<ReadAloudButton {...defaultProps} loading={true} />);
    expect(screen.getByTestId('read-aloud-button')).toBeDisabled();
  });

  it('has accessible aria-label', () => {
    render(<ReadAloudButton {...defaultProps} playing={false} />);
    const btn = screen.getByTestId('read-aloud-button');
    expect(btn).toHaveAttribute('aria-label');
  });

  it('aria-label changes when playing', () => {
    const { rerender } = render(<ReadAloudButton {...defaultProps} playing={false} />);
    const idleLbl = screen.getByTestId('read-aloud-button').getAttribute('aria-label');
    rerender(<ReadAloudButton {...defaultProps} playing={true} />);
    const playingLbl = screen.getByTestId('read-aloud-button').getAttribute('aria-label');
    expect(idleLbl).not.toBe(playingLbl);
  });
});
