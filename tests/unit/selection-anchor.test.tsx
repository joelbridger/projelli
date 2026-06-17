/**
 * M5 — inline chat anchor behaviour.
 *
 * Rather than trying to drive a full CodeMirror editor through jsdom
 * (which hands us non-trivial layout coords), we exercise the
 * `InlineChatAnchor` component directly with simulated coords and
 * confirm:
 *   - it renders when coords are provided
 *   - it vanishes when coords are null (selection cleared)
 *   - it vanishes when a session is active (overlay takes over)
 *   - the external-open-signal counter pops the inline input
 *   - submitting invokes the callback and clears the input
 *   - Escape dismisses the input
 *
 * Separately, we verify that `useInlineAiEdit`'s keyboard-shortcut
 * handler (Ctrl+Shift+E) bumps the `externalOpenSignal` counter when a
 * selection exists. We do this with a handcrafted `EditorAdapter`
 * that returns a non-empty selection — no CodeMirror instantiation
 * needed.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, renderHook, act } from '@testing-library/react';
import { InlineChatAnchor } from '@/features/documents/editor/InlineChatAnchor';
import { useInlineAiEdit, type EditorAdapter } from '@/features/documents/editor/useInlineAiEdit';

describe('InlineChatAnchor', () => {
  it('renders the Ask AI button when coords are provided and no session', () => {
    render(
      <InlineChatAnchor
        coords={{ x: 100, y: 200 }}
        sessionActive={false}
        onSubmit={() => {}}
      />
    );
    expect(screen.getByTestId('inline-chat-anchor')).toBeInTheDocument();
  });

  it('disappears when coords are null (selection cleared)', () => {
    const { rerender } = render(
      <InlineChatAnchor
        coords={{ x: 100, y: 200 }}
        sessionActive={false}
        onSubmit={() => {}}
      />
    );
    expect(screen.getByTestId('inline-chat-anchor')).toBeInTheDocument();
    rerender(
      <InlineChatAnchor coords={null} sessionActive={false} onSubmit={() => {}} />
    );
    expect(screen.queryByTestId('inline-chat-anchor')).not.toBeInTheDocument();
  });

  it('disappears when an edit session is active', () => {
    render(
      <InlineChatAnchor
        coords={{ x: 100, y: 200 }}
        sessionActive={true}
        onSubmit={() => {}}
      />
    );
    expect(screen.queryByTestId('inline-chat-anchor')).not.toBeInTheDocument();
  });

  it('expands into the inline input when the button is clicked', () => {
    render(
      <InlineChatAnchor
        coords={{ x: 100, y: 200 }}
        sessionActive={false}
        onSubmit={() => {}}
      />
    );
    fireEvent.click(screen.getByTestId('inline-chat-anchor'));
    expect(screen.getByTestId('inline-chat-input')).toBeInTheDocument();
    expect(screen.getByTestId('inline-chat-submit')).toBeInTheDocument();
  });

  it('pops open when externalOpenSignal ticks forward', () => {
    const { rerender } = render(
      <InlineChatAnchor
        coords={{ x: 100, y: 200 }}
        sessionActive={false}
        onSubmit={() => {}}
        externalOpenSignal={0}
      />
    );
    expect(screen.queryByTestId('inline-chat-input')).not.toBeInTheDocument();
    rerender(
      <InlineChatAnchor
        coords={{ x: 100, y: 200 }}
        sessionActive={false}
        onSubmit={() => {}}
        externalOpenSignal={1}
      />
    );
    expect(screen.getByTestId('inline-chat-input')).toBeInTheDocument();
  });

  it('calls onSubmit with the trimmed instruction and collapses', () => {
    const onSubmit = vi.fn();
    render(
      <InlineChatAnchor
        coords={{ x: 100, y: 200 }}
        sessionActive={false}
        onSubmit={onSubmit}
      />
    );
    fireEvent.click(screen.getByTestId('inline-chat-anchor'));
    const input = screen.getByTestId('inline-chat-input') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: '  tighten this to 3 sentences  ' } });
    fireEvent.click(screen.getByTestId('inline-chat-submit'));
    expect(onSubmit).toHaveBeenCalledWith('tighten this to 3 sentences');
    // After submit, the input should collapse back to the anchor.
    expect(screen.queryByTestId('inline-chat-input')).not.toBeInTheDocument();
  });

  it('submits on Enter (without Shift)', () => {
    const onSubmit = vi.fn();
    render(
      <InlineChatAnchor
        coords={{ x: 100, y: 200 }}
        sessionActive={false}
        onSubmit={onSubmit}
      />
    );
    fireEvent.click(screen.getByTestId('inline-chat-anchor'));
    const input = screen.getByTestId('inline-chat-input') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'make it shorter' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledWith('make it shorter');
  });

  it('ignores Enter when the textarea is empty', () => {
    const onSubmit = vi.fn();
    render(
      <InlineChatAnchor
        coords={{ x: 100, y: 200 }}
        sessionActive={false}
        onSubmit={onSubmit}
      />
    );
    fireEvent.click(screen.getByTestId('inline-chat-anchor'));
    const input = screen.getByTestId('inline-chat-input') as HTMLTextAreaElement;
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('dismisses on Escape without firing onSubmit', () => {
    const onSubmit = vi.fn();
    render(
      <InlineChatAnchor
        coords={{ x: 100, y: 200 }}
        sessionActive={false}
        onSubmit={onSubmit}
      />
    );
    fireEvent.click(screen.getByTestId('inline-chat-anchor'));
    const input = screen.getByTestId('inline-chat-input') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'abc' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.queryByTestId('inline-chat-input')).not.toBeInTheDocument();
  });
});

describe('useInlineAiEdit — selection + keyboard shortcut', () => {
  function makeAdapter(overrides: Partial<EditorAdapter> = {}): EditorAdapter {
    return {
      getSelectedText: () => 'some selected text',
      getSelectionRange: () => ({ from: 0, to: 18 }),
      replaceRange: () => {},
      coordsAtPos: () => ({ x: 120, y: 240 }),
      getDocText: () => 'some selected text and more',
      getDomNode: () => null,
      ...overrides,
    };
  }

  it('computes anchor coords when a selection exists', () => {
    const adapter = makeAdapter();
    const { result } = renderHook(() =>
      useInlineAiEdit({
        adapter,
        getProvider: () => null,
        docVersion: 1,
      })
    );
    expect(result.current.state.anchorCoords).toEqual({ x: 120, y: 240 });
  });

  it('returns null coords when selection is empty', () => {
    const adapter = makeAdapter({
      getSelectedText: () => '',
      getSelectionRange: () => ({ from: 5, to: 5 }),
    });
    const { result } = renderHook(() =>
      useInlineAiEdit({
        adapter,
        getProvider: () => null,
        docVersion: 1,
      })
    );
    expect(result.current.state.anchorCoords).toBeNull();
  });

  it('bumps externalOpenSignal when Ctrl+Shift+E fires with a selection', () => {
    const adapter = makeAdapter();
    const { result } = renderHook(() =>
      useInlineAiEdit({
        adapter,
        getProvider: () => null,
        docVersion: 1,
      })
    );
    const initial = result.current.state.externalOpenSignal;
    act(() => {
      const ev = new KeyboardEvent('keydown', {
        key: 'E',
        ctrlKey: true,
        shiftKey: true,
      });
      window.dispatchEvent(ev);
    });
    expect(result.current.state.externalOpenSignal).toBe(initial + 1);
  });

  it('does NOT bump externalOpenSignal when there is no selection', () => {
    const adapter = makeAdapter({
      getSelectedText: () => '',
      getSelectionRange: () => null,
    });
    const { result } = renderHook(() =>
      useInlineAiEdit({
        adapter,
        getProvider: () => null,
        docVersion: 1,
      })
    );
    const initial = result.current.state.externalOpenSignal;
    act(() => {
      const ev = new KeyboardEvent('keydown', {
        key: 'E',
        ctrlKey: true,
        shiftKey: true,
      });
      window.dispatchEvent(ev);
    });
    expect(result.current.state.externalOpenSignal).toBe(initial);
  });
});
