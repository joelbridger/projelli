/**
 * Press-to-talk hook + UI indicator (M6, v1.5 — Flag 4).
 *
 * Registers two global keyboard shortcuts:
 *
 *   - Ctrl+Shift+Space (Cmd+Shift+Space on Mac) — hold to record, release
 *     to transcribe and insert into the focused editable element.
 *   - Ctrl+Shift+N (Cmd+Shift+N on Mac) — hold to record, release to save
 *     the transcription to `<workspace>/Inbox/note-<timestamp>.md`.
 *
 * The hook is self-contained: render `<PressToTalkIndicator />` anywhere
 * in the tree and the mic indicator pulses while recording. Everything
 * else (actual capture, transcription, text insertion) happens inside the
 * hook's internal state.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { Mic } from 'lucide-react';
import { VoiceCapture } from '@/features/dictation/voice/VoiceCapture';
import { transcribeAudio } from '@/utils/tauri-commands';
import { isMac } from '@/utils/shortcuts';

/** Mode distinguishes insert-at-cursor from save-to-inbox. */
type RecordMode = 'insert' | 'note';

export interface PressToTalkHandlers {
  /** Called when the user holds Ctrl+Shift+N (voice-to-note). Receives the
   *  transcribed text. Should save the file and toast. */
  onSaveNote?: (text: string) => Promise<void> | void;
  /** Called after every successful insertion. Purely informational. */
  onInsert?: (text: string) => void;
  /** Test hook — swap the VoiceCapture factory. */
  captureFactory?: () => { start: () => Promise<void>; stop: () => Promise<Uint8Array> };
  /** Test hook — swap the transcribe call. */
  transcriber?: (wav: Uint8Array) => Promise<string>;
  /** When false, the hotkeys are ignored. Default true. */
  enabled?: boolean;
  /** Selected voice model (small/tiny/base). Defaults to 'small'. */
  model?: string;
}

/**
 * Insert `text` at the current cursor position of the currently focused
 * editable element. Handles `<input>`, `<textarea>`, and
 * `[contenteditable]`. Exposed for testability.
 */
export function insertAtCursor(text: string, root: Document | ShadowRoot = document): boolean {
  const active = root.activeElement as HTMLElement | null;
  if (!active) return false;

  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
    const start = active.selectionStart ?? active.value.length;
    const end = active.selectionEnd ?? active.value.length;
    const before = active.value.slice(0, start);
    const after = active.value.slice(end);
    active.value = before + text + after;
    const newPos = start + text.length;
    active.setSelectionRange(newPos, newPos);
    // Fire input event so React onChange listeners pick it up.
    active.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }

  if ((active as HTMLElement).isContentEditable) {
    const selection = (root as Document).getSelection?.();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      range.deleteContents();
      range.insertNode(document.createTextNode(text));
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
      active.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    }
  }

  return false;
}

interface HotkeyState {
  recordingMode: RecordMode | null;
  lastError: string | null;
}

/**
 * Hook that wires press-to-talk behaviour. Returns the current recording
 * state so the indicator (and other UI) can render.
 */
export function usePressToTalk(handlers: PressToTalkHandlers = {}): HotkeyState {
  const [state, setState] = useState<HotkeyState>({ recordingMode: null, lastError: null });
  const captureRef = useRef<{ start: () => Promise<void>; stop: () => Promise<Uint8Array> } | null>(null);
  const modeRef = useRef<RecordMode | null>(null);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const startRecording = useCallback(
    async (mode: RecordMode) => {
      if (modeRef.current !== null) return; // already recording
      try {
        const capture = handlersRef.current.captureFactory
          ? handlersRef.current.captureFactory()
          : (new VoiceCapture() as unknown as { start: () => Promise<void>; stop: () => Promise<Uint8Array> });
        await capture.start();
        captureRef.current = capture;
        modeRef.current = mode;
        setState({ recordingMode: mode, lastError: null });
      } catch (e) {
        setState({
          recordingMode: null,
          lastError: e instanceof Error ? e.message : 'Failed to start recording',
        });
        modeRef.current = null;
      }
    },
    [],
  );

  const stopRecording = useCallback(async () => {
    const mode = modeRef.current;
    const capture = captureRef.current;
    if (!mode || !capture) return;
    modeRef.current = null;
    captureRef.current = null;
    setState({ recordingMode: null, lastError: null });
    try {
      const wav = await capture.stop();
      const transcriber =
        handlersRef.current.transcriber ??
        (async (bytes: Uint8Array) => {
          const result = await transcribeAudio(bytes, handlersRef.current.model ?? 'small');
          return result.text;
        });
      const text = (await transcriber(wav)).trim();
      if (!text) return;
      if (mode === 'note') {
        await handlersRef.current.onSaveNote?.(text);
      } else {
        const ok = insertAtCursor(text);
        if (ok) handlersRef.current.onInsert?.(text);
      }
    } catch (e) {
      setState({
        recordingMode: null,
        lastError: e instanceof Error ? e.message : 'Transcription failed',
      });
    }
  }, []);

  useEffect(() => {
    if (handlers.enabled === false) return;
    const mac = isMac();

    const isInsertCombo = (e: KeyboardEvent) =>
      e.shiftKey && (mac ? e.metaKey : e.ctrlKey) && (e.code === 'Space' || e.key === ' ');
    const isNoteCombo = (e: KeyboardEvent) =>
      e.shiftKey && (mac ? e.metaKey : e.ctrlKey) && (e.code === 'KeyN' || e.key.toLowerCase() === 'n');

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (isInsertCombo(e)) {
        e.preventDefault();
        void startRecording('insert');
      } else if (isNoteCombo(e)) {
        e.preventDefault();
        void startRecording('note');
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (isInsertCombo(e) || isNoteCombo(e)) {
        e.preventDefault();
        void stopRecording();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [handlers.enabled, startRecording, stopRecording]);

  return state;
}

export interface PressToTalkIndicatorProps {
  state: HotkeyState;
}

/** Pulsing mic indicator rendered while press-to-talk is active. */
export function PressToTalkIndicator({ state }: PressToTalkIndicatorProps): React.ReactElement | null {
  if (state.recordingMode === null) return null;
  const label =
    state.recordingMode === 'note' ? 'Recording voice note...' : 'Recording voice input...';
  return (
    <div
      data-testid="press-to-talk-indicator"
      data-mode={state.recordingMode}
      className="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-full bg-red-500/90 text-white px-3 py-1.5 text-xs shadow-lg backdrop-blur-sm"
      role="status"
      aria-live="polite"
    >
      <Mic className="h-3.5 w-3.5 animate-pulse" />
      <span>{label}</span>
    </div>
  );
}

export default PressToTalkIndicator;
