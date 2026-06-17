/**
 * Task 12 — AudioControlBar component
 *
 * Inline control bar that appears below an AI message while it is being read.
 * Covers:
 *   - Renders nothing when visible=false
 *   - Renders when visible=true
 *   - data-testid="audio-control-bar" present
 *   - Pause button present and calls onPause when playing
 *   - Resume/play button present and calls onResume when paused
 *   - Stop button present and calls onStop
 *   - Displays elapsed time and duration
 *   - Scrub input (range) changes call onSeek with numeric value
 *   - Pause button shows when playing=true; resume button shows when playing=false
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AudioControlBar } from '@/features/dictation/tts/AudioControlBar';

describe('AudioControlBar', () => {
  const defaultProps = {
    visible: true,
    playing: true,
    currentTime: 3.0,
    duration: 10.0,
    onPause: vi.fn(),
    onResume: vi.fn(),
    onStop: vi.fn(),
    onSeek: vi.fn(),
  };

  it('renders nothing when visible=false', () => {
    render(<AudioControlBar {...defaultProps} visible={false} />);
    expect(screen.queryByTestId('audio-control-bar')).toBeNull();
  });

  it('renders the control bar when visible=true', () => {
    render(<AudioControlBar {...defaultProps} />);
    expect(screen.getByTestId('audio-control-bar')).toBeInTheDocument();
  });

  it('shows stop button and calls onStop on click', () => {
    const onStop = vi.fn();
    render(<AudioControlBar {...defaultProps} onStop={onStop} />);
    fireEvent.click(screen.getByTestId('audio-control-stop'));
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('shows pause button when playing=true and calls onPause', () => {
    const onPause = vi.fn();
    render(<AudioControlBar {...defaultProps} playing={true} onPause={onPause} />);
    const pauseBtn = screen.getByTestId('audio-control-pause');
    expect(pauseBtn).toBeInTheDocument();
    fireEvent.click(pauseBtn);
    expect(onPause).toHaveBeenCalledTimes(1);
  });

  it('shows resume button when playing=false and calls onResume', () => {
    const onResume = vi.fn();
    render(<AudioControlBar {...defaultProps} playing={false} onResume={onResume} />);
    const resumeBtn = screen.getByTestId('audio-control-resume');
    expect(resumeBtn).toBeInTheDocument();
    fireEvent.click(resumeBtn);
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it('pause button is not visible when playing=false', () => {
    render(<AudioControlBar {...defaultProps} playing={false} />);
    expect(screen.queryByTestId('audio-control-pause')).toBeNull();
  });

  it('resume button is not visible when playing=true', () => {
    render(<AudioControlBar {...defaultProps} playing={true} />);
    expect(screen.queryByTestId('audio-control-resume')).toBeNull();
  });

  it('displays formatted elapsed and total time', () => {
    render(
      <AudioControlBar {...defaultProps} currentTime={3.0} duration={10.0} />,
    );
    const bar = screen.getByTestId('audio-control-bar');
    // Should show some time representation (0:03 and 0:10 format)
    expect(bar.textContent).toContain('0:03');
    expect(bar.textContent).toContain('0:10');
  });

  it('scrub range input calls onSeek with numeric value', () => {
    const onSeek = vi.fn();
    render(<AudioControlBar {...defaultProps} onSeek={onSeek} duration={10.0} />);
    const range = screen.getByTestId('audio-control-scrub');
    fireEvent.change(range, { target: { value: '5' } });
    expect(onSeek).toHaveBeenCalledWith(5);
  });

  it('scrub range max equals duration', () => {
    render(<AudioControlBar {...defaultProps} duration={15.5} />);
    const range = screen.getByTestId('audio-control-scrub');
    expect(Number(range.getAttribute('max'))).toBe(15.5);
  });

  it('scrub range value reflects currentTime', () => {
    render(<AudioControlBar {...defaultProps} currentTime={4.2} />);
    const range = screen.getByTestId('audio-control-scrub') as HTMLInputElement;
    expect(Number(range.value)).toBeCloseTo(4.2);
  });
});
