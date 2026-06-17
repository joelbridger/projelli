/**
 * M6 (v1.5) — usePressToTalk + PressToTalkIndicator.
 *
 * Covers:
 *   - Ctrl+Shift+Space keydown starts recording; keyup stops + transcribes.
 *   - The mic indicator renders only while recording.
 *   - Transcribed text is inserted into the focused textarea.
 *   - Ctrl+Shift+N routes through `onSaveNote` instead.
 *   - `insertAtCursor` handles input / textarea / contenteditable.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, act, screen, fireEvent } from '@testing-library/react';
import { useRef } from 'react';
import {
  PressToTalkIndicator,
  usePressToTalk,
  insertAtCursor,
} from '@/features/dictation/voice/PressToTalk';

function Harness(props: {
  captureFactory: () => { start: () => Promise<void>; stop: () => Promise<Uint8Array> };
  transcriber: (wav: Uint8Array) => Promise<string>;
  onSaveNote?: (text: string) => Promise<void> | void;
  onInsert?: (text: string) => void;
}) {
  const state = usePressToTalk({
    captureFactory: props.captureFactory,
    transcriber: props.transcriber,
    ...(props.onSaveNote ? { onSaveNote: props.onSaveNote } : {}),
    ...(props.onInsert ? { onInsert: props.onInsert } : {}),
    model: 'small',
  });
  const ref = useRef<HTMLTextAreaElement>(null);
  return (
    <>
      <textarea ref={ref} data-testid="target-textarea" defaultValue="" />
      <PressToTalkIndicator state={state} />
    </>
  );
}

describe('usePressToTalk (M6)', () => {
  it('shows the indicator on keydown and hides on keyup', async () => {
    const startMock = vi.fn().mockResolvedValue(undefined);
    const stopMock = vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]));
    const transcribe = vi.fn().mockResolvedValue('hello world');

    render(
      <Harness
        captureFactory={() => ({ start: startMock, stop: stopMock })}
        transcriber={transcribe}
      />,
    );

    const target = screen.getByTestId('target-textarea') as HTMLTextAreaElement;
    target.focus();

    // keydown starts recording
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: ' ', code: 'Space', ctrlKey: true, shiftKey: true }),
      );
      await Promise.resolve();
    });
    expect(startMock).toHaveBeenCalled();
    expect(screen.getByTestId('press-to-talk-indicator')).toBeInTheDocument();
    expect(screen.getByTestId('press-to-talk-indicator').getAttribute('data-mode')).toBe('insert');

    // keyup stops + transcribes + inserts
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent('keyup', { key: ' ', code: 'Space', ctrlKey: true, shiftKey: true }),
      );
      // Wait for the async stopRecording to complete.
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(stopMock).toHaveBeenCalled();
    expect(transcribe).toHaveBeenCalled();
    expect(screen.queryByTestId('press-to-talk-indicator')).toBeNull();
    expect(target.value).toBe('hello world');
  });

  it('routes Ctrl+Shift+N to onSaveNote', async () => {
    const startMock = vi.fn().mockResolvedValue(undefined);
    const stopMock = vi.fn().mockResolvedValue(new Uint8Array([1]));
    const transcribe = vi.fn().mockResolvedValue('remember this');
    const onSaveNote = vi.fn().mockResolvedValue(undefined);
    render(
      <Harness
        captureFactory={() => ({ start: startMock, stop: stopMock })}
        transcriber={transcribe}
        onSaveNote={onSaveNote}
      />,
    );
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'n', code: 'KeyN', ctrlKey: true, shiftKey: true }),
      );
      await Promise.resolve();
    });
    expect(screen.getByTestId('press-to-talk-indicator').getAttribute('data-mode')).toBe('note');
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent('keyup', { key: 'n', code: 'KeyN', ctrlKey: true, shiftKey: true }),
      );
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(onSaveNote).toHaveBeenCalledWith('remember this');
  });

  it('ignores non-matching keys', async () => {
    const startMock = vi.fn().mockResolvedValue(undefined);
    const stopMock = vi.fn();
    render(
      <Harness
        captureFactory={() => ({ start: startMock, stop: stopMock })}
        transcriber={vi.fn()}
      />,
    );
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true }));
    });
    expect(startMock).not.toHaveBeenCalled();
  });
});

describe('insertAtCursor', () => {
  it('inserts into a textarea at the cursor position', () => {
    const { container } = render(<textarea defaultValue="before-after" />);
    const ta = container.querySelector('textarea')!;
    ta.focus();
    ta.setSelectionRange(7, 7); // between `before-` and `after`
    const ok = insertAtCursor('MID ', document);
    expect(ok).toBe(true);
    expect(ta.value).toBe('before-MID after');
  });

  it('inserts into an input element', () => {
    const { container } = render(<input defaultValue="start" />);
    const inp = container.querySelector('input')!;
    inp.focus();
    inp.setSelectionRange(5, 5);
    insertAtCursor(' END', document);
    expect(inp.value).toBe('start END');
  });

  it('returns false if no focused editable element', () => {
    render(<div>no editable</div>);
    const ok = insertAtCursor('x', document);
    expect(ok).toBe(false);
  });
});
