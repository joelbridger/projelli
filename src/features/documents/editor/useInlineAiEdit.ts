// useInlineAiEdit — M5 orchestration hook.
//
// Consumed by Markdown / PlainText editors. Owns:
//   - current selection tracking (range + viewport coords for the
//     floating anchor)
//   - the active edit session (original + proposed + streaming flag)
//   - hunk resolution state
//   - keyboard shortcut handling (Ctrl+Shift+E / Cmd+Shift+E)
//   - calling the provider with sendMessageStreaming
//   - applying accepted hunks to the editor doc
//   - recording version history with AI attribution
//
// The hook is editor-agnostic but takes a small adapter so both
// CodeMirror editors can plug in without the hook needing to import
// CodeMirror types directly.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { EditorView } from '@codemirror/view';
import {
  splitIntoHunks,
  computeLineDiff,
  applyHunks,
  stripAccidentalMarkdownFence,
} from '@/features/documents/editor-core/aiEdit/streamingDiff';
import { buildEditSystemPrompt } from '@/features/documents/editor-core/aiEdit/editPrompt';
import type { DiffHunk, HunkResolution } from '@/features/documents/editor-core/aiEdit/types';
import type { Provider } from '@/platform/providers/Provider';
import { getVersionService } from '@/features/documents/versioning/VersionService';

/** Subset of editor surface the hook needs. */
export interface EditorAdapter {
  /** Returns the currently-selected text (may be empty when nothing selected). */
  getSelectedText: () => string;
  /** Returns the currently-selected range in document offsets. */
  getSelectionRange: () => { from: number; to: number } | null;
  /** Replace a range with new text. Keeps the editor's undo history intact. */
  replaceRange: (from: number, to: number, insert: string) => void;
  /** Viewport coords of a given doc offset (used for anchor positioning). */
  coordsAtPos: (pos: number) => { x: number; y: number } | null;
  /** Current document text. */
  getDocText: () => string;
  /** Optional — DOM element for keyboard shortcut scoping. */
  getDomNode: () => HTMLElement | null;
  /** Path of the active file, for version history attribution. */
  filePath?: string | undefined;
}

export interface UseInlineAiEditArgs {
  adapter: EditorAdapter;
  /** Provider + model that will handle the edit. */
  getProvider: () => Provider | null;
  /** Hint about the editor's underlying format. */
  formatHint?: 'markdown' | 'plain' | 'rich';
  /**
   * External doc-change "tick" — increments whenever the editor content
   * updates. Used to recompute selection coords.
   */
  docVersion: number;
}

export interface InlineEditUiState {
  /** Viewport coords for the floating Ask AI button (bottom-right of selection). */
  anchorCoords: { x: number; y: number } | null;
  /** Monotonic counter — bumps whenever the keyboard shortcut requests open. */
  externalOpenSignal: number;
  /** True when an edit session is active (streaming or awaiting review). */
  sessionActive: boolean;
  /** Original selection text for the active session. */
  sessionOriginal: string;
  /** Current proposed replacement (partial during stream). */
  sessionProposed: string;
  /** True while provider tokens are still arriving. */
  sessionStreaming: boolean;
  /** Per-hunk resolution state. */
  resolutions: Record<number, HunkResolution>;
}

export interface InlineEditHandlers {
  /** Called from the anchor when the user submits their instruction. */
  submitInstruction: (instruction: string) => Promise<void>;
  /** Accept a specific hunk: apply its change to the doc and record history. */
  acceptHunk: (hunk: DiffHunk) => void;
  /** Reject a specific hunk: leave the original in place. */
  rejectHunk: (hunk: DiffHunk) => void;
  /** Accept every remaining pending hunk at once. */
  acceptAll: () => void;
  /** Reject every remaining pending hunk at once. */
  rejectAll: () => void;
  /** Cancel an in-flight stream (or close the overlay entirely). */
  cancelSession: () => void;
}

export function useInlineAiEdit(args: UseInlineAiEditArgs): {
  state: InlineEditUiState;
  handlers: InlineEditHandlers;
} {
  const { adapter, getProvider, formatHint, docVersion } = args;

  const [anchorCoords, setAnchorCoords] = useState<{ x: number; y: number } | null>(null);
  const [externalOpenSignal, setExternalOpenSignal] = useState(0);

  // Session state
  const [sessionOriginal, setSessionOriginal] = useState('');
  const [sessionProposed, setSessionProposed] = useState('');
  const [sessionStreaming, setSessionStreaming] = useState(false);
  const [sessionActive, setSessionActive] = useState(false);
  const [resolutions, setResolutions] = useState<Record<number, HunkResolution>>({});

  // Session metadata needed for history attribution and apply.
  // `appliedEnd` tracks the end offset in the live doc after the most
  // recent hunk application, which may differ from `selectionTo` once
  // previous hunks have shifted trailing content.
  const sessionMetaRef = useRef<{
    prompt: string;
    model: string;
    selectionFrom: number;
    selectionTo: number;
    appliedEnd?: number;
  } | null>(null);

  // Abort controller for in-flight streams.
  const abortRef = useRef<AbortController | null>(null);

  // Track selection coordinates — refresh whenever doc changes or
  // selection moves.
  const refreshAnchor = useCallback(() => {
    const range = adapter.getSelectionRange();
    if (!range || range.from === range.to) {
      setAnchorCoords(null);
      return;
    }
    const coords = adapter.coordsAtPos(range.to);
    if (!coords) {
      setAnchorCoords(null);
      return;
    }
    // Bail referentially when the anchor hasn't moved. `coords` is a fresh
    // object every call and this callback's identity changes per render
    // (the adapter is an inline literal), so the anchor effect re-runs on
    // every render — returning an equal-but-new object here re-rendered
    // forever once a PERSISTENT non-empty selection existed. The F-504
    // citation landing selection was the first such selection to hit it.
    setAnchorCoords((prev) =>
      prev && prev.x === coords.x && prev.y === coords.y ? prev : coords,
    );
  }, [adapter]);

  // Whenever doc changes, refresh. (Selection changes are driven by
  // the editor's own event stream and surface via docVersion bumps
  // OR the manual `refresh` call from a keydown handler.)
  useEffect(() => {
    refreshAnchor();
  }, [docVersion, refreshAnchor]);

  // Keyboard shortcut — Ctrl+Shift+E or Cmd+Shift+E.
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform);
      const modOk = isMac ? e.metaKey : e.ctrlKey;
      if (modOk && e.shiftKey && (e.key === 'E' || e.key === 'e')) {
        const selected = adapter.getSelectedText();
        if (!selected) return;
        e.preventDefault();
        refreshAnchor();
        setExternalOpenSignal((n) => n + 1);
      }
    };
    const node = adapter.getDomNode();
    const target: EventTarget = node ?? window;
    target.addEventListener('keydown', handleKey as EventListener);
    return () => target.removeEventListener('keydown', handleKey as EventListener);
  }, [adapter, refreshAnchor]);

  const submitInstruction = useCallback(
    async (instruction: string) => {
      const selected = adapter.getSelectedText();
      const range = adapter.getSelectionRange();
      if (!selected || !range) return;

      const provider = getProvider();
      if (!provider || !provider.sendMessageStreaming) {
        // No usable provider — surface a minimal fallback and bail.
        // We could show a toast here; for now just abort gracefully.
        return;
      }

      const meta = provider.getMetadata();
      const modelId = `${meta.providerId ?? meta.name ?? 'unknown'}/${meta.model}`;

      const systemPrompt = buildEditSystemPrompt({
        selection: selected,
        instruction,
        ...(formatHint !== undefined ? { formatHint } : {}),
      });

      // Start session
      sessionMetaRef.current = {
        prompt: instruction,
        model: modelId,
        selectionFrom: range.from,
        selectionTo: range.to,
      };
      setSessionOriginal(selected);
      setSessionProposed('');
      setSessionStreaming(true);
      setSessionActive(true);
      setResolutions({});

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        await provider.sendMessageStreaming(instruction, {
          systemPrompt,
          signal: controller.signal,
          onChunk: (chunk) => {
            setSessionProposed((prev) => prev + chunk);
          },
        });
      } catch {
        // Silent: the UI still shows whatever streamed up to the abort
        // point. The overlay will offer accept/reject on the partial.
      } finally {
        setSessionStreaming(false);
        abortRef.current = null;
        // Post-stream — strip accidental Markdown fence if the model
        // wrapped the whole reply.
        setSessionProposed((prev) => stripAccidentalMarkdownFence(prev, true));
      }
    },
    [adapter, formatHint, getProvider]
  );

  const recordAiAttribution = useCallback(
    (hunk: DiffHunk, appliedDocContent: string, rangeStart: number, rangeEnd: number) => {
      const meta = sessionMetaRef.current;
      if (!meta) return;
      const filePath = adapter.filePath;
      if (!filePath) return;
      const service = getVersionService();
      void service.saveVersion(filePath, appliedDocContent, 'AI edit', {
        author: 'ai',
        aiMetadata: {
          prompt: meta.prompt,
          model: meta.model,
          hunkIndex: hunk.index,
          hunkRange: { start: rangeStart, end: rangeEnd },
        },
      });
    },
    [adapter]
  );

  const closeSessionIfResolved = useCallback((newResolutions: Record<number, HunkResolution>, hunks: DiffHunk[]) => {
    const allResolved = hunks.every((h) => {
      const r = newResolutions[h.index];
      return r === 'accepted' || r === 'rejected';
    });
    if (allResolved) {
      setSessionActive(false);
      setSessionOriginal('');
      setSessionProposed('');
      setResolutions({});
      sessionMetaRef.current = null;
    }
  }, []);

  /**
   * Apply a single hunk's change to the editor's current doc, without
   * touching the rest of the selection's content.
   *
   * We operate on the full doc (not the snapshot) so that if other
   * hunks have already been accepted, the offsets are still valid.
   * We do this by reconstructing the current selection region from
   * the doc + meta.selectionFrom.
   */
  const applyHunkToDoc = useCallback(
    (hunk: DiffHunk, newResolutions: Record<number, HunkResolution>) => {
      const meta = sessionMetaRef.current;
      if (!meta) return;

      const diffLines = computeLineDiff(sessionOriginal, sessionProposed);
      const hunks = splitIntoHunks(diffLines);

      // Build the "selection region" as it would look with the new
      // acceptance set applied. Start from the original, apply
      // accepted hunks.
      const accepted = new Set<number>();
      for (const h of hunks) {
        if (newResolutions[h.index] === 'accepted') accepted.add(h.index);
      }
      const newSelectionText = applyHunks(sessionOriginal, hunks, accepted);

      // Replace the selection region in the live doc.
      const currentDoc = adapter.getDocText();
      // We assume no one else has modified the doc outside the
      // selection region while the session was live. Recompute the
      // end offset based on the current selection length in the doc
      // — which, after prior hunk applications, may have shifted.
      // To handle that robustly: we track `meta.selectionFrom` as the
      // stable anchor, and recompute `meta.selectionTo` as
      // `selectionFrom + <length of previously-applied selection>`.
      // For the very first apply, we use the original
      // `meta.selectionTo`. For subsequent applies, we use
      // `selectionFrom + currentSelectionLengthInDoc`.
      //
      // Simpler alternative: always splice from meta.selectionFrom to
      // meta.selectionFrom + lengthOfLastAppliedSelection. Track the
      // last-applied length on sessionMetaRef.
      const prevEnd = meta.appliedEnd ?? meta.selectionTo;
      const regionFrom = meta.selectionFrom;
      const regionTo = prevEnd;

      // Guardrail — make sure we don't walk off the end.
      const safeTo = Math.min(regionTo, currentDoc.length);

      adapter.replaceRange(regionFrom, safeTo, newSelectionText);

      // Update the applied end for the next call.
      meta.appliedEnd = regionFrom + newSelectionText.length;

      // Record AI attribution for this specific hunk.
      if (newResolutions[hunk.index] === 'accepted') {
        const newDoc = adapter.getDocText();
        recordAiAttribution(
          hunk,
          newDoc,
          regionFrom,
          regionFrom + newSelectionText.length
        );
      }
    },
    [adapter, sessionOriginal, sessionProposed, recordAiAttribution]
  );

  const acceptHunk = useCallback(
    (hunk: DiffHunk) => {
      setResolutions((prev) => {
        const next = { ...prev, [hunk.index]: 'accepted' as HunkResolution };
        applyHunkToDoc(hunk, next);
        const diffLines = computeLineDiff(sessionOriginal, sessionProposed);
        const hunks = splitIntoHunks(diffLines);
        closeSessionIfResolved(next, hunks);
        return next;
      });
    },
    [applyHunkToDoc, sessionOriginal, sessionProposed, closeSessionIfResolved]
  );

  const rejectHunk = useCallback(
    (hunk: DiffHunk) => {
      setResolutions((prev) => {
        const next = { ...prev, [hunk.index]: 'rejected' as HunkResolution };
        // Even rejects need to be reflected — applyHunkToDoc rebuilds
        // the region with the new acceptance set (which for a reject
        // means keeping the original for this hunk).
        applyHunkToDoc(hunk, next);
        const diffLines = computeLineDiff(sessionOriginal, sessionProposed);
        const hunks = splitIntoHunks(diffLines);
        closeSessionIfResolved(next, hunks);
        return next;
      });
    },
    [applyHunkToDoc, sessionOriginal, sessionProposed, closeSessionIfResolved]
  );

  const acceptAll = useCallback(() => {
    const diffLines = computeLineDiff(sessionOriginal, sessionProposed);
    const hunks = splitIntoHunks(diffLines);
    setResolutions((prev) => {
      const next = { ...prev };
      for (const h of hunks) {
        if ((next[h.index] ?? 'pending') === 'pending') {
          next[h.index] = 'accepted';
        }
      }
      // One combined apply pass — faster than N separate replaceRange
      // dispatches for large selections.
      const meta = sessionMetaRef.current;
      if (meta) {
        const accepted = new Set<number>(
          hunks.filter((h) => next[h.index] === 'accepted').map((h) => h.index)
        );
        const newSelectionText = applyHunks(sessionOriginal, hunks, accepted);
        const prevEnd = meta.appliedEnd ?? meta.selectionTo;
        const regionFrom = meta.selectionFrom;
        const safeTo = Math.min(prevEnd, adapter.getDocText().length);
        adapter.replaceRange(regionFrom, safeTo, newSelectionText);
        meta.appliedEnd = regionFrom + newSelectionText.length;
        // Record attribution for each newly-accepted hunk.
        const newDoc = adapter.getDocText();
        for (const h of hunks) {
          if ((prev[h.index] ?? 'pending') === 'pending' && next[h.index] === 'accepted') {
            recordAiAttribution(h, newDoc, regionFrom, regionFrom + newSelectionText.length);
          }
        }
      }
      closeSessionIfResolved(next, hunks);
      return next;
    });
  }, [adapter, sessionOriginal, sessionProposed, closeSessionIfResolved, recordAiAttribution]);

  const rejectAll = useCallback(() => {
    const diffLines = computeLineDiff(sessionOriginal, sessionProposed);
    const hunks = splitIntoHunks(diffLines);
    setResolutions((prev) => {
      const next = { ...prev };
      for (const h of hunks) {
        if ((next[h.index] ?? 'pending') === 'pending') {
          next[h.index] = 'rejected';
        }
      }
      // Restore original text verbatim.
      const meta = sessionMetaRef.current;
      if (meta) {
        const prevEnd = meta.appliedEnd ?? meta.selectionTo;
        const regionFrom = meta.selectionFrom;
        const safeTo = Math.min(prevEnd, adapter.getDocText().length);
        adapter.replaceRange(regionFrom, safeTo, sessionOriginal);
        meta.appliedEnd = regionFrom + sessionOriginal.length;
      }
      closeSessionIfResolved(next, hunks);
      return next;
    });
  }, [adapter, sessionOriginal, sessionProposed, closeSessionIfResolved]);

  const cancelSession = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    const meta = sessionMetaRef.current;
    if (meta) {
      // Restore original text if we've already applied something.
      const prevEnd = meta.appliedEnd;
      if (prevEnd !== undefined) {
        const regionFrom = meta.selectionFrom;
        const safeTo = Math.min(prevEnd, adapter.getDocText().length);
        adapter.replaceRange(regionFrom, safeTo, sessionOriginal);
      }
    }
    setSessionActive(false);
    setSessionStreaming(false);
    setSessionOriginal('');
    setSessionProposed('');
    setResolutions({});
    sessionMetaRef.current = null;
  }, [adapter, sessionOriginal]);

  return {
    state: {
      anchorCoords,
      externalOpenSignal,
      sessionActive,
      sessionOriginal,
      sessionProposed,
      sessionStreaming,
      resolutions,
    },
    handlers: {
      submitInstruction,
      acceptHunk,
      rejectHunk,
      acceptAll,
      rejectAll,
      cancelSession,
    },
  };
}

/** Build an adapter from a CodeMirror `EditorView`. Shared by Markdown + Plain. */
export function codeMirrorAdapter(
  view: EditorView | null,
  opts: { filePath?: string | undefined }
): EditorAdapter {
  return {
    getSelectedText: () => {
      if (!view) return '';
      const { from, to } = view.state.selection.main;
      return view.state.doc.sliceString(from, to);
    },
    getSelectionRange: () => {
      if (!view) return null;
      const { from, to } = view.state.selection.main;
      return { from, to };
    },
    replaceRange: (from, to, insert) => {
      if (!view) return;
      view.dispatch({ changes: { from, to, insert } });
    },
    coordsAtPos: (pos) => {
      if (!view) return null;
      try {
        const c = view.coordsAtPos(pos);
        if (!c) return null;
        return { x: c.right, y: c.bottom };
      } catch {
        return null;
      }
    },
    getDocText: () => {
      if (!view) return '';
      return view.state.doc.toString();
    },
    getDomNode: () => view?.dom ?? null,
    filePath: opts.filePath,
  };
}
