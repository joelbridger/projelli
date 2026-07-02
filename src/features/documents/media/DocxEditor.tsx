// DOCX Editor (WS-A / A3) — the Word-familiar document surface.
//
// This REPLACES the old lossy Mammoth/TipTap editor. It renders the JSON DOM
// produced by the in-house OOXML engine (`docx_open`) faithfully — paragraphs
// with common formatting, runs, tracked insertions (green/underline) and
// deletions (red/strikethrough) with author tooltips, and comment ranges — and
// drives accept/reject of tracked changes through the engine
// (`docx_resolve_revision` / `docx_resolve_all`). Edits and resolutions persist
// to the real `.docx` via `docx_save`, which preserves every unmodeled part of
// the package (styles, numbering, theme, headers/footers, media, tables).
//
// LAYOUT (locked design): a slim top bar (file name · Reviewing toggle · save
// status), a clean document surface (white page on light-gray canvas, generous
// margins, letterhead-friendly), and a right-side Review pane listing changes
// grouped by revision with per-change Accept/Reject + Accept all / Reject all,
// plus a comments display. LIGHT THEME ONLY; navy accent (var(--kp-navy)).
//
// ENGINE COUPLING: the engine reads/writes by FILE PATH, not the data-URL the
// rest of the tab pipeline carries. So this editor takes `filePath` and is the
// source of truth for the `.docx` on disk; it does not push data-URL content
// back up through `onContentChange`. In the browser / test environment (no
// native engine) it degrades to the read-only `DocxViewer` with a notice.
//
// A4 SEAM: `applyResolvedDocument` is the single choke point that swaps the
// in-memory DOM after any engine call and schedules a save. The future AI
// redliner reuses exactly this: call `docx_author_revision`, then feed the
// returned DOM through `applyResolvedDocument`. `onDocumentChange` is exposed so
// a parent (or A4) can observe the live DOM.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  Check,
  Download,
  FileText,
  FileType,
  Loader2,
  Mail,
  PanelRightClose,
  PanelRightOpen,
  ShieldCheck,
  Wand2,
  X,
} from 'lucide-react';

import { Button } from '@/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { AutoSaveIndicator } from '@/features/documents/editor/AutoSaveIndicator';
import { DocxViewer } from '@/features/documents/media/DocxViewer';
import { LibreOfficeHelpNotice } from '@/features/documents/media/LibreOfficeHelpNotice';
import { detectLibreOffice } from '@/platform/utils/tauri-commands';
import {
  docxAuthorRevisions,
  docxConvertToPdf,
  docxExportCleanCopy,
  docxExportCopy,
  docxOpen,
  docxResolveAll,
  docxResolveRevision,
  docxSave,
  isDocxEngineAvailable,
} from '@/platform/utils/docx-commands';
import { writeCoordinator } from '@/platform/fs/writeCoordinator';
import { extractIndexedParagraphs } from '@/features/documents/docx/redline';
import { createProvider, isLocalProviderId, type ChatProviderId } from '@/platform/providers/providerFactory';
import { useTrialGate } from '@/platform/hooks/useTrial';
import { getConfidentialityMode } from '@/platform/hooks/useConfidentialityMode';
import { assertCloudGenerationAllowed } from '@/platform/privacy/localOnlyGuard';
import { getActiveScope } from '@/platform/matter/matterStore';
import { IS_DEMO } from '@/web-demo/demoModeFlag';
import {
  REDLINE_AUTHOR,
  paragraphPlainRunText,
  requestRedlineEditsWithAudit,
} from '@/features/documents/docx/redline';
import { diffParagraphEdits } from '@/platform/utils/docx-text-diff';
import {
  anchoredCommentIds,
  commentList,
  countRevisions,
  groupRevisions,
} from '@/platform/utils/docx-dom';
import type {
  DocumentJson,
  DocxComment,
  DocxParagraph,
  DocxResolveAction,
  DocxRun,
  GroupedRevision,
} from '@/platform/types/docx';
import type { AuditEntry } from '@/platform/types/audit';
import type { CoeditSession } from '@/platform/firm/coedit/coeditSession';
import * as Y from 'yjs';
import { editRunText, addTrackedInsertion, addTrackedDeletion, resolveRevision } from '@/platform/firm/coedit/docCrdt';
import { structuredCloneSafe, type RedlineSummary } from './docxEditorHelpers';
import { DocumentBody, DocxEditorMessage } from './DocxDocumentView';
import { ReviewPane } from './DocxReviewPane';
import { ReviewingToggle, RedlineComposer, RedlineSummaryPanel } from './DocxRedlineControls';

const SAVE_DEBOUNCE_MS = 1200;

interface DocxEditorProps {
  /**
   * The real on-disk path of the `.docx` (the tab's path). The engine reads /
   * writes here directly. Required for editing; without it (or in browser mode)
   * the component shows the read-only fallback.
   */
  filePath?: string;
  /** Display name for the top bar + fallbacks. */
  fileName: string;
  /**
   * The tab's data-URL content. Only used to drive the read-only `DocxViewer`
   * fallback in non-Tauri / no-path environments — the engine path ignores it.
   */
  src?: string;
  className?: string;
  /**
   * Fired once before the first edit/resolve hits disk so the parent can write
   * a backup of the original bytes (mirrors the other binary editors). Optional.
   */
  onFirstEdit?: () => Promise<void> | void;
  /**
   * WS-A / A5: fired after each successful save to disk so the parent can take a
   * binary-safe version snapshot of the just-written `.docx`. The `author`
   * distinguishes a routine user save from an AI redline save. Optional.
   */
  onAfterSave?: (info: { filePath: string; author: 'user' | 'ai' }) => Promise<void> | void;
  /**
   * Observe the live DOM after any change (edit / accept / reject). A4 + tests
   * use this; production wiring may ignore it.
   */
  onDocumentChange?: (doc: DocumentJson) => void;

  // ---- A4: AI redline -----------------------------------------------------
  /**
   * The user's BYOK API keys (same shape the chat uses). When a valid key for
   * the selected provider is present, the "Revise with AI" button is enabled.
   * Omitted/empty => the button shows a tooltip telling the user to add a key.
   */
  apiKeys?: { provider: string; key: string; isValid: boolean }[];
  /** AI provider for redline (defaults to 'anthropic'). */
  aiProvider?: ChatProviderId;
  /** Model id for redline (defaults to the provider's free-tier default). */
  aiModel?: string;
  /**
   * Author name stamped on USER-authored tracked changes (the secondary
   * track-changes-on path). Defaults to "You". AI edits are always attributed
   * to "Advisor Prep Hero AI" regardless of this.
   */
  authorName?: string;
  /** Optional audit hook — fired when an AI redline is applied. */
  onAuditLog?: (entry: Omit<AuditEntry, 'id' | 'timestamp'>) => void;
  /**
   * When present, activates live co-editing via the given CoeditSession.
   * When absent (default), the solo path is used byte-for-byte.
   */
  coedit?: { session: CoeditSession };
  /** Wave 0: opens the "Draft follow-up" email modal with the document's plain text. */
  onDraftFollowUp?: ((plainText: string) => void) | undefined;
}

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; doc: DocumentJson }
  | { status: 'error'; message: string }
  | { status: 'unsupported' };

export function DocxEditor({
  filePath,
  fileName,
  src,
  className,
  onFirstEdit,
  onAfterSave,
  onDocumentChange,
  apiKeys = [],
  aiProvider = 'anthropic',
  aiModel,
  authorName = 'You',
  onAuditLog,
  coedit,
  onDraftFollowUp,
}: DocxEditorProps) {
  const { t } = useTranslation();

  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  // "Reviewing" gates whether tracked changes are shown inline (Word's "All
  // Markup") vs a clean "final" view that renders insertions as normal text and
  // hides deletions. The Review pane only shows while reviewing.
  const [reviewing, setReviewing] = useState(true);
  const [showReviewPane, setShowReviewPane] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<number | undefined>(undefined);
  const [isDirty, setIsDirty] = useState(false);
  // The comment whose card is highlighted (clicked anchor <-> card linking).
  const [activeCommentId, setActiveCommentId] = useState<string | null>(null);

  // ---- A4: AI redline state ----------------------------------------------
  // Entitlement gate: AI redline is an AI feature, so it is gated off for a
  // lapsed subscription or an expired trial. The DOCUMENT itself stays fully
  // open, editable, and exportable regardless (data-ownership guarantee) — only
  // the AI redline action is paused, with a calm "resubscribe" message.
  const { isLocked: aiGated } = useTrialGate();
  const [redlineOpen, setRedlineOpen] = useState(false);
  const [redlineInstruction, setRedlineInstruction] = useState('');
  const [redlineBusy, setRedlineBusy] = useState(false);
  const [redlineError, setRedlineError] = useState<string | null>(null);
  // A short summary of the last AI redline: the reasons + how many anchored.
  const [redlineSummary, setRedlineSummary] = useState<RedlineSummary | null>(
    null,
  );

  // ---- A6: Export state ---------------------------------------------------
  // A transient status line under the toolbar after an export (success or a
  // friendly error from the export itself). `busy` disables the menu.
  const [exportBusy, setExportBusy] = useState(false);
  const [exportNotice, setExportNotice] = useState<
    { kind: 'success' | 'error'; message: string } | null
  >(null);
  // VG-4a: PDF export depends on an installed LibreOffice. When the probe
  // says it's missing we show a dedicated explanation (what to install, why,
  // copyable link) instead of letting the conversion fail with a raw error.
  const [libreOfficeHelpOpen, setLibreOfficeHelpOpen] = useState(false);

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // BUG (data loss): flushes the latest pending (debounced) save. Set while a
  // save is scheduled; called on unmount so closing/switching the tab within the
  // debounce window can't silently drop the last edit. Cleared once the timer
  // fires normally so a later unmount never double-saves.
  const flushPendingSaveRef = useRef<(() => void) | null>(null);
  // Monotonic save sequence for the write coordinator (#1) — serializes .docx
  // saves per path so a slow earlier save can't overwrite a newer one.
  const docxSaveSeqRef = useRef(0);
  const firstEditFiredRef = useRef(false);
  // WS-A / A5: author of the next save (for the version snapshot). User edits
  // leave it 'user'; an AI redline flips it to 'ai' before scheduling its save.
  const pendingSaveAuthorRef = useRef<'user' | 'ai'>('user');
  // WS-A / A5: mirror of `isDirty` for the persist closure — we only take a
  // version snapshot when there were ACTUAL changes, so re-saving a clean doc
  // (e.g. the flush before an export) doesn't spam the history.
  const isDirtyRef = useRef(false);
  // Co-edit: capture original comments from docx_open to re-attach on every save
  // (the CRDT's getDocumentJson() always returns comments: {}).
  const originalCommentsRef = useRef<Record<string, DocxComment>>({});
  // Ref to the current grouped revisions. Used by handleResolveOne so it can
  // read the latest revisions without being listed as a dep (revisions is
  // computed below handleResolveOne in the component body).
  const revisionsRef = useRef<GroupedRevision[]>([]);
  // CLUSTER-C2 (data loss: concurrent ops overwrite each other with older
  // copies): the single always-current snapshot of the in-memory DOM, kept in
  // sync by `applyResolvedDocument` (the one choke point every mutation runs
  // through) rather than derived from React state. Async mutations (accept /
  // reject / redline / tracked-change diff-edit) read THIS at the moment they
  // actually run — never a `currentDoc` closure captured back when the async
  // call started — so a slower op can never clobber a faster op's already-
  // landed result with a stale base.
  const currentDocRef = useRef<DocumentJson | null>(null);
  // CLUSTER-C2: every document-mutating operation (accept/reject one or all,
  // the tracked-changes diff-edit, AI redline) is funneled through this strict
  // FIFO queue instead of running concurrently. An operation only starts
  // reading `currentDocRef.current` once every earlier-queued operation has
  // fully applied its result — so two operations started close together can
  // never race to `applyResolvedDocument` in the wrong order, and the second
  // one always builds on the first one's result rather than an older copy.
  const docOpQueueRef = useRef<Promise<void>>(Promise.resolve());
  // CLUSTER-C1 (data loss: an in-progress, un-blurred edit is lost if the tab
  // closes before the user clicks away): the run currently being typed into,
  // if any. Set on focus / cleared on blur by `PlainRun` via `onActiveRunChange`
  // so `commitActiveRunEdit` can read the LIVE (uncommitted) DOM text and fold
  // it into the document model on unmount/export, exactly as a blur would.
  const activeRunRef = useRef<{
    blockIndex: number;
    inlineIndex: number;
    element: HTMLElement;
  } | null>(null);
  // Always-latest `handleRunEdit`, so the stable-identity `commitActiveRunEdit`
  // below (declared before `handleRunEdit` exists) can still call the current
  // version. `handleRunEdit` may actually return a Promise at runtime (the
  // reviewing/tracked-changes branch does) even though its prop-facing type is
  // `void` — see the type here and `commitActiveRunEdit`'s Promise check.
  const handleRunEditRef = useRef<
    (blockIndex: number, inlineIndex: number, text: string) => void | Promise<void>
  >(() => undefined);
  const onDocumentChangeRef = useRef(onDocumentChange);
  const onAfterSaveRef = useRef(onAfterSave);
  useEffect(() => {
    onDocumentChangeRef.current = onDocumentChange;
  }, [onDocumentChange]);
  useEffect(() => {
    onAfterSaveRef.current = onAfterSave;
  }, [onAfterSave]);
  useEffect(() => {
    isDirtyRef.current = isDirty;
  }, [isDirty]);

  // CLUSTER-C2: enqueue a document-mutating operation onto the strict FIFO
  // queue. `op` should read `currentDocRef.current` itself (not a closed-over
  // doc) once it actually runs, so it always builds on the latest state.
  // Mirrors `writeCoordinator.enqueue`'s shape: the QUEUE CHAIN itself never
  // rejects (a rejected chain would wedge every op queued after this one), but
  // `op`'s own error still propagates to THIS call's returned promise so a
  // caller that wants to react to failure (e.g. runRedline's error banner)
  // still can — callers that don't care can just ignore the rejection.
  const enqueueDocOp = useCallback(<T,>(op: () => Promise<T> | T): Promise<T> => {
    const run = docOpQueueRef.current.then(() => op());
    docOpQueueRef.current = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }, []);

  // CLUSTER-C1: called by `PlainRun` on focus/blur to track which run (if any)
  // currently has live, possibly-uncommitted edits in its contentEditable DOM
  // node. `element: null` means the run just blurred (already committed via
  // its own onBlur -> onRunEdit, so there's nothing left to flush for it).
  const onActiveRunChange = useCallback(
    (blockIndex: number, inlineIndex: number, element: HTMLElement | null) => {
      if (element) {
        activeRunRef.current = { blockIndex, inlineIndex, element };
      } else if (
        activeRunRef.current?.blockIndex === blockIndex &&
        activeRunRef.current.inlineIndex === inlineIndex
      ) {
        activeRunRef.current = null;
      }
    },
    [],
  );

  // CLUSTER-C1: fold whatever the user is CURRENTLY typing (focused, not yet
  // blurred) into the document model, exactly as if they had clicked away.
  // Called before unmount and before export so an in-progress keystroke can
  // never be silently dropped just because the user closed the tab or hit
  // Export instead of clicking elsewhere first. Stable identity (empty deps)
  // via the `handleRunEditRef` indirection, so it's safe to reference from
  // effects registered before `handleRunEdit` itself exists.
  const commitActiveRunEdit = useCallback((): Promise<void> => {
    const active = activeRunRef.current;
    if (!active) return Promise.resolve();
    activeRunRef.current = null;
    const text = active.element.textContent ?? '';
    const result = handleRunEditRef.current(active.blockIndex, active.inlineIndex, text);
    return result instanceof Promise ? result : Promise.resolve();
  }, []);

  const canEdit = Boolean(filePath) && isDocxEngineAvailable();

  // ---- Load the DOM from disk via the engine -----------------------------
  useEffect(() => {
    let cancelled = false;
    if (!canEdit || !filePath) {
      // No engine (browser/test) or no path: read-only fallback.
      setLoad({ status: 'unsupported' });
      return;
    }
    setLoad({ status: 'loading' });
    // This editor's own save-revision counter (docxSaveSeqRef) restarts from 0
    // for every new session — clear the write coordinator's advisory
    // high-water mark too, so a lingering high rev from a PREVIOUS session
    // editing this same path can't make this session's first save read
    // `isLatest: false` (writeCoordinator.ts).
    writeCoordinator.resetPath(filePath);
    docxOpen(filePath)
      .then((doc) => {
        if (cancelled) return;
        if (coedit) {
          // Capture original comments (CRDT always returns comments: {}).
          originalCommentsRef.current = doc.comments;
          // Use the CRDT's live doc for the initial render, with comments re-attached.
          const liveDoc: DocumentJson = {
            ...coedit.session.getDocumentJson(),
            comments: doc.comments,
          };
          currentDocRef.current = liveDoc;
          setLoad({ status: 'ready', doc: liveDoc });
        } else {
          currentDocRef.current = doc;
          setLoad({ status: 'ready', doc });
        }
        setIsDirty(false);
        setSaveError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setLoad({ status: 'error', message });
      });
    return () => {
      cancelled = true;
    };
   
  }, [canEdit, filePath, coedit]);

  // ---- Cleanup the debounce on unmount -----------------------------------
  useEffect(() => {
    return () => {
      const flushScheduledSave = () => {
        if (saveTimerRef.current) {
          clearTimeout(saveTimerRef.current);
          saveTimerRef.current = null;
          // Flush the pending edit so closing/switching the tab within the
          // debounce window doesn't silently drop the last change (data loss).
          flushPendingSaveRef.current?.();
        }
      };
      // Flush whatever was ALREADY scheduled before this unmount.
      flushScheduledSave();
      // CLUSTER-C1: THEN fold an in-progress (focused, un-blurred) edit into
      // the document model, and — separately — wait for the ENTIRE op queue
      // to drain before flushing whatever that produced.
      //
      // Draining the queue (not just awaiting commitActiveRunEdit()) is the
      // part that closes the last race (coordinator review): if a run blurs
      // JUST before unmount, PlainRun has already cleared activeRunRef
      // (nothing left to "commit"), but its blur already enqueued a
      // tracked-changes op via handleRunEdit that hasn't run yet —
      // commitActiveRunEdit() alone would see no active run and resolve
      // immediately, so the flush below would fire BEFORE that already-
      // queued edit ever reaches applyResolvedDocument/scheduleSave, and the
      // save it eventually schedules would have nothing left watching for it.
      // Reading `docOpQueueRef.current` AFTER commitActiveRunEdit() settles
      // captures that op too — enqueueDocOp mutates the ref synchronously, so
      // by the time we read it here the queue reflects everything enqueued so
      // far, whether from this commit or an earlier blur.
      commitActiveRunEdit()
        .then(() => docOpQueueRef.current)
        .then(flushScheduledSave)
        .catch((err: unknown) => {
          console.error('[DocxEditor] commitActiveRunEdit on unmount failed:', err);
        });
    };
  }, [commitActiveRunEdit]);

  // ---- Persist (debounced) ----------------------------------------------
  const persist = useCallback(
    async (doc: DocumentJson) => {
      if (!filePath) return;
      setIsSaving(true);
      setSaveError(null);
      try {
        if (!firstEditFiredRef.current) {
          firstEditFiredRef.current = true;
          try {
            await onFirstEdit?.();
          } catch (err) {
            console.warn('[DocxEditor] onFirstEdit failed:', err);
          }
        }
        const wasDirty = isDirtyRef.current;
        // BUG-045/#1 (Codex save-path review): route the .docx save through the
        // per-path write coordinator so two debounced saves of the SAME file
        // can't land out of order (a slow earlier save overwriting a newer one).
        // .docx is the primary format, so this is the most important writer to
        // serialize. The rev only orders/labels; serialization is by enqueue
        // order (FIFO), so the newest save always wins on disk.
        const saveRev = (docxSaveSeqRef.current += 1);
        await writeCoordinator.enqueue(filePath, saveRev, () => docxSave(filePath, doc));
        setLastSavedAt(Date.now());
        setIsDirty(false);
        // WS-A / A5: take a binary-safe version snapshot of the just-written
        // `.docx` — but only when there were real changes, so re-saving a clean
        // doc (the flush before an export) doesn't add an empty version. Consume
        // the pending author flag (reset to 'user' after).
        const author = pendingSaveAuthorRef.current;
        pendingSaveAuthorRef.current = 'user';
        if (wasDirty) {
          try {
            await onAfterSaveRef.current?.({ filePath, author });
          } catch (verr) {
            console.warn('[DocxEditor] onAfterSave (version snapshot) failed:', verr);
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setSaveError(message);
        console.error('[DocxEditor] save failed:', err);
      } finally {
        setIsSaving(false);
      }
    },
    [filePath, onFirstEdit],
  );

  const scheduleSave = useCallback(
    (doc: DocumentJson) => {
      setIsDirty(true);
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      // Capture a flush for the LATEST doc so an unmount before the debounce
      // fires can still persist it (data-loss guard).
      flushPendingSaveRef.current = () => { void persist(doc); };
      saveTimerRef.current = setTimeout(() => {
        flushPendingSaveRef.current = null;
        void persist(doc);
      }, SAVE_DEBOUNCE_MS);
    },
    [persist],
  );

  /**
   * THE A4 SEAM + the resolve choke point. Swap the in-memory DOM, notify
   * observers, and schedule a save. Every mutation (edit, accept, reject,
   * future AI redline) funnels through here so state + persistence can't drift.
   */
  const applyResolvedDocument = useCallback(
    (doc: DocumentJson, save = true) => {
      // CLUSTER-C2: sync the ref FIRST, synchronously, before the React state
      // update — this is what lets a queued op (or the export flush) read the
      // truly-latest doc without waiting on a re-render.
      currentDocRef.current = doc;
      setLoad({ status: 'ready', doc });
      onDocumentChangeRef.current?.(doc);
      if (save) scheduleSave(doc);
    },
    [scheduleSave],
  );

  // ---- Co-edit: subscribe to remote changes ----------------------------------
  useEffect(() => {
    if (!coedit) return;
    const unsub = coedit.session.onChange(() => {
      const liveDoc: DocumentJson = {
        ...coedit.session.getDocumentJson(),
        comments: originalCommentsRef.current,
      };
      applyResolvedDocument(liveDoc, false);
    });
    return unsub;
  }, [coedit, applyResolvedDocument]);

  // ---- Co-edit: relay-based presence (real cross-machine count, §10) -------
  // Track how many OTHER editors are in this document. Count comes directly
  // from the relay's subscriber count broadcast — accurate across machines.
  // When `coedit` is absent the entire presence path is skipped (solo path).
  const [otherEditors, setOtherEditors] = useState<number>(0);

  useEffect(() => {
    if (!coedit) return;

    // Snapshot the current count immediately from the session.
    setOtherEditors(coedit.session.getOtherEditorCount());

    // Subscribe to future presence changes from the relay.
    const unsub = coedit.session.onPresenceChange((otherCount) => {
      setOtherEditors(otherCount);
    });

    return unsub;
   
  }, [coedit]);

  const currentDoc = load.status === 'ready' ? load.doc : null;

  // ---- A6: Export --------------------------------------------------------
  // Every export reads the on-disk `.docx` at `filePath`, so we first flush any
  // pending debounced save (and write the current DOM synchronously) to be sure
  // the file reflects what the user sees. Returns false if there's nothing to
  // export (no path / no doc).
  //
  // CLUSTER-C1: commits an in-progress (focused, un-blurred) edit before
  // reading the doc, so hitting Export without clicking away first doesn't
  // export a copy missing the last keystrokes. Reads `currentDocRef.current`
  // (not the `currentDoc` React-state snapshot) because that commit — and any
  // other queued mutation still in flight — may have landed after this
  // callback's closure was created; the ref is always the freshest doc.
  const flushSaveBeforeExport = useCallback(async (): Promise<boolean> => {
    if (!filePath) return false;
    await commitActiveRunEdit();
    // Wait for any in-flight accept/reject/redline to finish landing too, so
    // export never races an operation that's still queued.
    await docOpQueueRef.current;
    const doc = currentDocRef.current;
    if (!doc) return false;
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    // Persist synchronously so the on-disk bytes are current for the engine.
    await persist(doc);
    return true;
  }, [filePath, persist, commitActiveRunEdit]);

  /**
   * Show the OS save dialog for a chosen-location export and return the picked
   * path (or undefined if cancelled). Lives here (not in saveFile.ts) because
   * the Rust export commands write the file themselves — we only need the path.
   */
  const pickSavePath = useCallback(
    async (suggestedName: string, ext: string): Promise<string | undefined> => {
      const { save } = await import('@tauri-apps/plugin-dialog');
      const picked = await save({
        defaultPath: suggestedName,
        filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
      });
      return picked ?? undefined;
    },
    [],
  );

  // The export file name stem (drop a trailing .docx from the tab name).
  const exportStem = useMemo(
    () => fileName.replace(/\.docx$/i, ''),
    [fileName],
  );

  const runExport = useCallback(
    async (work: (srcPath: string) => Promise<string | null>) => {
      if (exportBusy) return;
      setExportBusy(true);
      setExportNotice(null);
      try {
        const ok = await flushSaveBeforeExport();
        if (!ok || !filePath) {
          setExportBusy(false);
          return;
        }
        const successMsg = await work(filePath);
        // `null` => the user cancelled the save dialog (no notice).
        if (successMsg !== null) {
          setExportNotice({ kind: 'success', message: successMsg });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setExportNotice({ kind: 'error', message });
        console.error('[DocxEditor] export failed:', err);
      } finally {
        setExportBusy(false);
      }
    },
    [exportBusy, flushSaveBeforeExport, filePath],
  );

  const handleExportWord = useCallback(() => {
    void runExport(async (srcPath) => {
      const dest = await pickSavePath(`${exportStem}.docx`, 'docx');
      if (!dest) return null;
      await docxExportCopy(srcPath, dest);
      return t('media.docx-editor.export-saved-word');
    });
  }, [runExport, pickSavePath, exportStem, t]);

  const handleExportPdf = useCallback(() => {
    void runExport(async (srcPath) => {
      // VG-4a — never fail silently: probe LibreOffice BEFORE converting.
      const soffice = await detectLibreOffice();
      if (!soffice) {
        setLibreOfficeHelpOpen(true);
        return null;
      }
      // A retry after installing LibreOffice clears any stale help notice.
      setLibreOfficeHelpOpen(false);
      // Convert the saved .docx to PDF (LibreOffice) -> temp path, then let the
      // user choose where to save the PDF (read bytes, write via saveFile).
      const pdfPath = await docxConvertToPdf(srcPath);
      const { readFile } = await import('@tauri-apps/plugin-fs');
      const bytes = await readFile(pdfPath);
      const { saveFile } = await import('@/platform/utils/saveFile');
      const saved = await saveFile(bytes, {
        suggestedName: `${exportStem}.pdf`,
        types: [{ description: 'PDF', accept: { 'application/pdf': ['.pdf'] } }],
      });
      // In Tauri, `saved` is the path (undefined => cancelled).
      if (saved === undefined) return null;
      return t('media.docx-editor.export-saved-pdf');
    });
  }, [runExport, exportStem, t]);

  const handleExportCleanCopy = useCallback(
    (acceptAllChanges: boolean) => {
      void runExport(async (srcPath) => {
        const dest = await pickSavePath(
          `${exportStem}${acceptAllChanges ? '-final' : '-clean'}.docx`,
          'docx',
        );
        if (!dest) return null;
        await docxExportCleanCopy(srcPath, dest, acceptAllChanges);
        return acceptAllChanges
          ? t('media.docx-editor.export-saved-clean-final')
          : t('media.docx-editor.export-saved-clean');
      });
    },
    [runExport, pickSavePath, exportStem, t],
  );

  // ---- Accept / reject ---------------------------------------------------
  const handleResolveOne = useCallback(
    async (revisionId: string, action: DocxResolveAction) => {
      // CO-EDIT PATH: resolve through the CRDT session, not the Rust command.
      // Yjs merges concurrent ops conflict-free by design, so this doesn't need
      // the solo path's op queue below.
      if (coedit) {
        // In co-edit mode rev.id is always '' (CONTRACT). Find the matching
        // CRDT run by author+date from the rendered doc's grouped revisions.
        const revisionFromDoc = revisionsRef.current.find(r => r.id === revisionId);
        if (revisionFromDoc) {
          const body = coedit.session.doc.getArray<Y.Map<unknown>>('body');
          for (const block of body.toArray()) {
            if (block.get('type') !== 'paragraph') continue;
            const blockId = block.get('id') as string;
            const runs = block.get('runs') as Y.Array<Y.Map<unknown>>;
            for (const run of runs.toArray()) {
              const kind = run.get('kind') as string;
              if (kind !== 'ins' && kind !== 'del') continue;
              const author = run.get('author') as string;
              const date = run.get('date') as string;
              if (author === revisionFromDoc.author && date === revisionFromDoc.date) {
                try {
                  resolveRevision(coedit.session.doc, blockId, run.get('id') as string, action, authorName);
                } catch (err) {
                  const message = err instanceof Error ? err.message : String(err);
                  setSaveError(message);
                  console.error('[DocxEditor] co-edit resolve revision failed:', err);
                }
                const coEditDoc: DocumentJson = {
                  ...coedit.session.getDocumentJson(),
                  comments: originalCommentsRef.current,
                };
                applyResolvedDocument(coEditDoc, true);
                return;
              }
            }
          }
        }
        return;
      }

      // CLUSTER-C2: queued so a slower-resolving accept/reject/redline/edit
      // that started earlier can't land AFTER this one and clobber it with an
      // older copy. Reads `currentDocRef.current` at the moment this op
      // actually runs (after every earlier-queued op has applied), not a
      // `currentDoc` closed over back when the user clicked.
      await enqueueDocOp(async () => {
        const doc = currentDocRef.current;
        if (!doc) return;
        try {
          const next = await docxResolveRevision(doc, revisionId, action);
          applyResolvedDocument(next);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          setSaveError(message);
          console.error('[DocxEditor] resolve revision failed:', err);
        }
      });
    },
    [coedit, authorName, applyResolvedDocument, enqueueDocOp],
  );

  const handleResolveAll = useCallback(
    async (action: DocxResolveAction) => {
      // CO-EDIT PATH: resolve all tracked runs through the CRDT session.
      if (coedit) {
        // Collect all tracked runs first (snapshot before mutating),
        // then resolve each one. Collecting up front avoids iterator invalidation.
        const body = coedit.session.doc.getArray<Y.Map<unknown>>('body');
        const toResolve: Array<{ blockId: string; runId: string }> = [];
        for (const block of body.toArray()) {
          if (block.get('type') !== 'paragraph') continue;
          const blockId = block.get('id') as string;
          const runs = block.get('runs') as Y.Array<Y.Map<unknown>>;
          for (const run of runs.toArray()) {
            const kind = run.get('kind') as string;
            if (kind === 'ins' || kind === 'del') {
              toResolve.push({ blockId, runId: run.get('id') as string });
            }
          }
        }
        for (const { blockId, runId } of toResolve) {
          try {
            resolveRevision(coedit.session.doc, blockId, runId, action, authorName);
          } catch {
            // Run may already be removed if accepting a deletion removed it.
          }
        }
        const coEditDoc: DocumentJson = {
          ...coedit.session.getDocumentJson(),
          comments: originalCommentsRef.current,
        };
        applyResolvedDocument(coEditDoc, true);
        return;
      }

      // CLUSTER-C2: see handleResolveOne above.
      await enqueueDocOp(async () => {
        const doc = currentDocRef.current;
        if (!doc) return;
        try {
          const next = await docxResolveAll(doc, action);
          applyResolvedDocument(next);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          setSaveError(message);
          console.error('[DocxEditor] resolve all failed:', err);
        }
      });
    },
    [coedit, authorName, applyResolvedDocument, enqueueDocOp],
  );

  /**
   * Editing of NORMAL run text.
   *
   * - When Reviewing (track-changes) is OFF: a direct plain-text replacement of
   *   the run (the simple "just edit the doc" path).
   * - When Reviewing is ON: A4 secondary — we DON'T overwrite. We diff the
   *   paragraph's old vs new plain-run text and author the difference as tracked
   *   insertion/deletion(s) attributed to the user (via the drift-safe batch
   *   engine command), exactly like Word's "Track Changes: On".
   *
   * Note `newText` is the new text of a single run; the paragraph's full new
   * plain-run text is the other runs' text with this run's text swapped in.
   */
  const handleRunEdit = useCallback(
    (blockIndex: number, inlineIndex: number, newText: string): void | Promise<void> => {
      if (!currentDoc) return;
      const block = currentDoc.body[blockIndex];
      if (!block || block.kind !== 'paragraph') return;
      const inline = block.inlines[inlineIndex];
      if (!inline || inline.kind !== 'run') return;
      if (inline.text === newText) return;
      // CLUSTER-C2 drift guard: the exact text this run held when the user
      // started this edit — re-checked once this op actually runs (see below).
      const originalRunText = inline.text;

      // CO-EDIT PATH: route text edits through the CRDT session. Yjs merges
      // concurrent ops conflict-free by design, so this doesn't need the op
      // queue below (solo-only).
      if (coedit) {
        const body = coedit.session.doc.getArray<Y.Map<unknown>>('body');
        const blockMap = body.toArray()[blockIndex];
        if (!blockMap) return;
        const blockId = blockMap.get('id') as string;
        const runs = blockMap.get('runs') as Y.Array<Y.Map<unknown>> | undefined;
        const runMap = runs?.toArray()[inlineIndex];
        if (!runMap) return;
        const runId = runMap.get('id') as string;

        if (reviewing) {
          // Track Changes ON in co-edit: author the diff as a tracked CRDT op.
          if (newText.length > inline.text.length) {
            // Insertion: new text is longer
            addTrackedInsertion(coedit.session.doc, blockId, newText, authorName);
          } else if (newText.length < inline.text.length) {
            // Deletion: new text is shorter
            addTrackedDeletion(coedit.session.doc, blockId, runId, authorName);
          } else {
            // Same length but different content: fall back to plain edit
            editRunText(coedit.session.doc, blockId, runId, inline.text, newText, authorName);
          }
        } else {
          editRunText(coedit.session.doc, blockId, runId, inline.text, newText, authorName);
        }

        const coEditDoc: DocumentJson = {
          ...coedit.session.getDocumentJson(),
          comments: originalCommentsRef.current,
        };
        applyResolvedDocument(coEditDoc, true);
        return;
      }

      // CLUSTER-C2: queued so a concurrent accept/reject/redline that started
      // earlier (and is still resolving) can't be overwritten by this edit, and
      // so this edit always builds on the latest doc rather than the snapshot
      // captured when the user started typing. Everything below reads
      // `currentDocRef.current` (fresh once dequeued), not `currentDoc`.
      return enqueueDocOp(async () => {
        const doc = currentDocRef.current;
        if (!doc) return;
        const freshBlock = doc.body[blockIndex];
        const freshInline =
          freshBlock?.kind === 'paragraph' ? freshBlock.inlines[inlineIndex] : undefined;
        if (!freshBlock || freshBlock.kind !== 'paragraph' || !freshInline || freshInline.kind !== 'run' || freshInline.text !== originalRunText) {
          // Drift guard: something else (a concurrent accept/reject/redline)
          // changed this exact run while this edit was queued. Applying our
          // stale diff/index against it now could silently corrupt the WRONG
          // content, so skip rather than guess — fail loud, not silent.
          console.warn('[DocxEditor] skipped a run edit: its target run changed underneath it (concurrent operation) — please retry the edit');
          setSaveError(t('media.docx-editor.concurrent-edit-conflict'));
          return;
        }

        if (!reviewing) {
          // Final view: plain replacement (no tracked change). Structural clone
          // so we never mutate the live object.
          const next: DocumentJson = structuredCloneSafe(doc);
          const nextBlock = next.body[blockIndex] as DocxParagraph;
          const nextInline = nextBlock.inlines[inlineIndex] as DocxRun & {
            kind: 'run';
          };
          nextInline.text = newText;
          applyResolvedDocument(next);
          return;
        }

        // Reviewing ON → author the diff as tracked change(s). Compute the
        // paragraph index (count paragraphs up to blockIndex) and the old/new
        // plain-run text of the paragraph, against the FRESH doc.
        let paragraphIndex = -1;
        for (let i = 0; i <= blockIndex; i++) {
          if (doc.body[i]?.kind === 'paragraph') paragraphIndex += 1;
        }
        const oldPlain = paragraphPlainRunText(freshBlock);
        // New plain text = old runs with this run's text swapped.
        let newPlain = '';
        freshBlock.inlines.forEach((inl, idx) => {
          if (inl.kind === 'run') {
            newPlain += idx === inlineIndex ? newText : inl.text;
          }
        });
        const edits = diffParagraphEdits(paragraphIndex, oldPlain, newPlain);
        if (edits.length === 0) return;

        try {
          const { document: nextDoc } = await docxAuthorRevisions(
            doc,
            edits,
            { author: authorName },
          );
          applyResolvedDocument(nextDoc);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          setSaveError(message);
          console.error('[DocxEditor] track-changes user edit failed:', err);
        }
      });
    },
    [currentDoc, reviewing, authorName, applyResolvedDocument, coedit, enqueueDocOp, t],
  );
  // CLUSTER-C1: keep the ref `commitActiveRunEdit` reads pointed at the
  // latest `handleRunEdit` closure (it changes identity often — see its own
  // dep list above).
  useEffect(() => {
    handleRunEditRef.current = handleRunEdit;
  }, [handleRunEdit]);

  // ---- A4: AI redline ----------------------------------------------------
  // WS-C honesty — a LOCAL provider (Ollama) needs no API key; redlining runs
  // on the user's own machine and nothing leaves the device. For cloud
  // providers we still require the BYOK key.
  const isLocalRedline = isLocalProviderId(aiProvider);
  // The valid key for the selected CLOUD provider, if any.
  const redlineKey = useMemo(
    () => apiKeys.find((k) => k.provider === aiProvider && k.isValid)?.key,
    [apiKeys, aiProvider],
  );
  // The redline action is ready when it's a local provider (keyless) or a cloud
  // provider with a valid key.
  const redlineReady = isLocalRedline || Boolean(redlineKey);

  /**
   * Run an AI redline from the user's instruction. Builds a prompt from the
   * current document, calls the user's chosen provider (BYOK, direct) for a
   * structured edit list, and applies it as tracked changes via the drift-safe
   * batch engine command. Surfaces a summary of what changed (the reasons).
   */
  const runRedline = useCallback(async () => {
    const instruction = redlineInstruction.trim();
    if (!instruction || !currentDoc || redlineBusy) return;
    // Entitlement gate: AI features are paused on a lapsed subscription or an
    // expired trial. Never a lockout — the document is still fully editable and
    // exportable; only this AI action is unavailable until they resubscribe.
    if (aiGated) {
      setRedlineError(t('media.docx-editor.redline-ai-paused'));
      return;
    }
    // Cloud providers require a key; a local (Ollama) provider does not.
    if (!isLocalRedline && !redlineKey) {
      setRedlineError(t('media.docx-editor.redline-need-key'));
      return;
    }
    setRedlineBusy(true);
    setRedlineError(null);
    setRedlineSummary(null);
    try {
      // Personal-install choice gate (Task 1.3 fix): redline is cloud generation;
      // block it until the user has made an explicit confidentiality choice.
      // Pass aiProvider so local (Ollama) redlines skip the gate automatically.
      // Firm installs are a no-op inside assertCloudGenerationAllowed (isFirm first).
      assertCloudGenerationAllowed(aiProvider);
      // WS-C honesty — createProvider builds the LOCAL provider for 'ollama'
      // (no key, on-machine) and the cloud provider otherwise. A local redline
      // can never be routed to a cloud provider here.
      const provider = createProvider({
        provider: aiProvider,
        ...(redlineKey ? { apiKey: redlineKey } : {}),
        ...(aiModel ? { model: aiModel } : {}),
      });
      const effectiveModel = provider.getMetadata().model;
      const activeScope = getActiveScope();
      const edits = await requestRedlineEditsWithAudit(
        provider,
        instruction,
        currentDoc,
        {
          providerId: aiProvider,
          model: effectiveModel,
          mode: getConfidentialityMode(),
          fileName,
          ...(filePath ? { filePath } : {}),
          scope: activeScope.kind === 'matter'
            ? { kind: 'matter', matterId: activeScope.matterId }
            : { kind: 'allMatters' },
          isDemo: IS_DEMO,
          ...(onAuditLog ? { onAuditLog } : {}),
        },
      );
      if (edits.length === 0) {
        setRedlineSummary({ instruction, applied: 0, skipped: 0, items: [] });
        setRedlineBusy(false);
        return;
      }

      // CLUSTER-C2: apply against the LATEST doc via the queue (not the
      // `currentDoc` snapshot the prompt above was built from), so a
      // concurrent accept/reject/edit that lands while the AI call was in
      // flight can't be overwritten by this redline landing after it with an
      // older base. `docxAuthorRevisions`'s anchors are content-addressed
      // (quoted text, not indices), so applying against a doc newer than the
      // one the AI saw is safe: an edit whose anchor no longer matches is
      // simply reported skipped, never silently misapplied elsewhere.
      const { results } = await enqueueDocOp(async () => {
        const doc = currentDocRef.current;
        if (!doc) throw new Error('Document is no longer open.');
        const outcome = await docxAuthorRevisions(doc, edits, { author: REDLINE_AUTHOR });
        // WS-A / A5: attribute the resulting version snapshot to the AI.
        pendingSaveAuthorRef.current = 'ai';
        applyResolvedDocument(outcome.document);
        return outcome;
      });

      // Build the human summary: pair each edit's reason with whether it landed.
      const items: RedlineSummary['items'] = results.map((r) => {
        const edit = edits[r.index];
        const item: RedlineSummary['items'][number] = {
          applied: r.applied,
          reason: edit?.reason ?? '',
          op: edit?.op ?? 'edit',
        };
        if (r.error) item.error = r.error;
        return item;
      });
      const applied = items.filter((i) => i.applied).length;
      const skipped = items.length - applied;

      setRedlineSummary({ instruction, applied, skipped, items });
      setRedlineInstruction('');
      setRedlineOpen(false);

      onAuditLog?.({
        action: 'model_call',
        description: `AI redline: ${instruction}`,
        model: effectiveModel,
        inputs: { instruction, editCount: edits.length, provider: aiProvider },
        outputs: { applied, skipped },
        userDecision: 'auto',
        metadata: { feature: 'docx_redline', file: fileName },
      });
    } catch (err) {
      // WS-C honesty — a LOCAL redline that fails is almost always Ollama not
      // running. Show a clear, friendly message instead of a raw fetch error,
      // and NEVER retry on a cloud provider (nothing left the machine).
      const message = isLocalRedline
        ? "Ollama isn't running, so this local redline couldn't run. Start Ollama and try again, or switch your confidentiality mode in Settings → AI. Nothing was sent anywhere."
        : err instanceof Error
          ? err.message
          : String(err);
      setRedlineError(message);
      console.error('[DocxEditor] AI redline failed:', err);
    } finally {
      setRedlineBusy(false);
    }
  }, [
    redlineInstruction,
    currentDoc,
    redlineBusy,
    isLocalRedline,
    redlineKey,
    aiProvider,
    aiModel,
    fileName,
    filePath,
    applyResolvedDocument,
    enqueueDocOp,
    onAuditLog,
    aiGated,
    t,
  ]);

  const revisions = useMemo(
    () => {
      const computed = currentDoc ? groupRevisions(currentDoc) : [];
      revisionsRef.current = computed;
      return computed;
    },
    [currentDoc],
  );
  const comments = useMemo(
    () => (currentDoc ? commentList(currentDoc) : []),
    [currentDoc],
  );
  const anchoredIds = useMemo(
    () => (currentDoc ? anchoredCommentIds(currentDoc) : new Set<string>()),
    [currentDoc],
  );
  const revisionCount = currentDoc ? countRevisions(currentDoc) : 0;

  // ---- Render: fallbacks -------------------------------------------------
  if (load.status === 'unsupported') {
    // Browser / test / no-path: read-only preview keeps the file viewable.
    if (src) {
      return (
        <div
          data-testid="docx-editor"
          data-mode="readonly-fallback"
          className={cn('flex h-full flex-col bg-background', className)}
        >
          <div
            data-testid="docx-editor-readonly-banner"
            className="flex items-start gap-2 border-b border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <p className="flex-1">{t('media.docx-editor.desktop-only')}</p>
          </div>
          <div className="min-h-0 flex-1">
            <DocxViewer src={src} fileName={fileName} className="h-full" />
          </div>
        </div>
      );
    }
    return (
      <DocxEditorMessage
        fileName={fileName}
        message={t('media.docx-editor.desktop-only')}
      />
    );
  }

  if (load.status === 'error') {
    return (
      <div
        data-testid="docx-editor-error"
        className={cn(
          'flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-muted-foreground',
          className,
        )}
      >
        <AlertTriangle className="h-10 w-10 text-destructive opacity-70" />
        <div>
          <p className="text-sm font-medium text-foreground">
            {t('media.docx-editor.could-not-open', { fileName })}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{load.message}</p>
        </div>
      </div>
    );
  }

  if (load.status === 'loading' || !currentDoc) {
    return (
      <div
        data-testid="docx-editor-loading"
        className={cn(
          'flex h-full flex-col items-center justify-center gap-2 text-muted-foreground',
          className,
        )}
      >
        <FileType className="h-10 w-10 animate-pulse opacity-50" />
        <p className="text-sm">{t('media.docx-editor.opening', { fileName })}</p>
      </div>
    );
  }

  // ---- Render: the editor ------------------------------------------------
  return (
    <div
      data-testid="docx-editor"
      data-mode="editor"
      data-reviewing={reviewing ? 'true' : 'false'}
      className={cn('flex h-full flex-col bg-background', className)}
    >
      {/* Slim top bar: file name · Reviewing toggle · save status */}
      <div
        data-testid="docx-editor-topbar"
        className="flex items-center gap-3 border-b bg-background px-3 py-1.5"
      >
        <span className="flex items-center gap-1.5 truncate text-sm font-medium text-foreground/80">
          <FileType className="h-4 w-4 shrink-0 text-blue-600" />
          <span className="truncate">{fileName}</span>
        </span>

        <div className="ml-auto flex items-center gap-2">
          {/* T11: ephemeral presence indicator — shown only in co-edit mode */}
          {coedit && otherEditors > 0 && (
            <span
              data-testid="docx-presence-pill"
              className="flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700"
              title={`${String(otherEditors)} other ${otherEditors === 1 ? 'person' : 'people'} editing`}
            >
              <span
                aria-hidden="true"
                className="h-1.5 w-1.5 rounded-full bg-emerald-500"
              />
              {otherEditors === 1
                ? '1 other editing'
                : `${String(otherEditors)} others editing`}
            </span>
          )}

          {onDraftFollowUp && (
            <Button
              data-testid="docx-draft-follow-up"
              variant="outline"
              size="sm"
              className="h-7 gap-1.5 border-[rgba(var(--kp-navy-rgb),0.30)] text-[var(--kp-navy)] hover:bg-[rgba(var(--kp-navy-rgb),0.05)]"
              onClick={() => {
                const text = extractIndexedParagraphs(currentDoc)
                  .map(p => p.text)
                  .join('\n');
                onDraftFollowUp(text);
              }}
              title={t('media.docx-editor.draft-follow-up-title')}
            >
              <Mail className="h-3.5 w-3.5" />
              {t('media.docx-editor.draft-follow-up')}
            </Button>
          )}

          {/* A6: discoverable Export — a clearly-labeled menu (not a bare icon)
              offering Word, PDF, and a privilege-safe clean copy. */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                data-testid="docx-export"
                variant="outline"
                size="sm"
                className="h-7 gap-1.5 border-[rgba(var(--kp-navy-rgb),0.30)] text-[var(--kp-navy)] hover:bg-[rgba(var(--kp-navy-rgb),0.05)]"
                disabled={exportBusy || !canEdit}
                title={t('media.docx-editor.export')}
              >
                {exportBusy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Download className="h-3.5 w-3.5" />
                )}
                {t('media.docx-editor.export')}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuLabel>
                {t('media.docx-editor.export-as')}
              </DropdownMenuLabel>
              <DropdownMenuItem
                data-testid="docx-export-word"
                onSelect={handleExportWord}
              >
                <FileType className="mr-2 h-4 w-4 text-blue-600" />
                {t('media.docx-editor.export-word')}
              </DropdownMenuItem>
              <DropdownMenuItem
                data-testid="docx-export-pdf"
                onSelect={handleExportPdf}
              >
                <FileText className="mr-2 h-4 w-4 text-red-600" />
                {t('media.docx-editor.export-pdf')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-[var(--kp-navy)]">
                {t('media.docx-editor.export-clean-section')}
              </DropdownMenuLabel>
              <DropdownMenuItem
                data-testid="docx-export-clean"
                onSelect={() => { handleExportCleanCopy(false); }}
              >
                <ShieldCheck className="mr-2 h-4 w-4 text-emerald-600" />
                <span className="flex flex-col">
                  <span>{t('media.docx-editor.export-clean')}</span>
                  <span className="text-[10px] text-muted-foreground">
                    {t('media.docx-editor.export-clean-hint')}
                  </span>
                </span>
              </DropdownMenuItem>
              <DropdownMenuItem
                data-testid="docx-export-clean-final"
                onSelect={() => { handleExportCleanCopy(true); }}
              >
                <ShieldCheck className="mr-2 h-4 w-4 text-emerald-700" />
                <span className="flex flex-col">
                  <span>{t('media.docx-editor.export-clean-final')}</span>
                  <span className="text-[10px] text-muted-foreground">
                    {t('media.docx-editor.export-clean-final-hint')}
                  </span>
                </span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* A4: AI redline entry point. */}
          <Button
            data-testid="docx-revise-with-ai"
            variant="outline"
            size="sm"
            className="h-7 gap-1.5 border-[rgba(var(--kp-navy-rgb),0.30)] text-[var(--kp-navy)] hover:bg-[rgba(var(--kp-navy-rgb),0.05)]"
            onClick={() => {
              setRedlineOpen((v) => !v);
              setRedlineError(null);
            }}
            disabled={redlineBusy}
            aria-expanded={redlineOpen}
            title={
              redlineReady
                ? t('media.docx-editor.revise-with-ai')
                : t('media.docx-editor.redline-need-key')
            }
          >
            {redlineBusy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Wand2 className="h-3.5 w-3.5" />
            )}
            {t('media.docx-editor.revise-with-ai')}
          </Button>

          <AutoSaveIndicator
            isDirty={isDirty}
            isSaving={isSaving}
            {...(lastSavedAt !== undefined ? { lastSavedAt } : {})}
            {...(saveError ? { error: saveError } : {})}
            onRetry={() => void persist(currentDoc)}
          />

          <ReviewingToggle reviewing={reviewing} onToggle={setReviewing} />

          <Button
            data-testid="docx-toggle-review-pane"
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={() => { setShowReviewPane((v) => !v); }}
            title={
              showReviewPane
                ? t('media.docx-editor.hide-review')
                : t('media.docx-editor.show-review')
            }
            aria-label={
              showReviewPane
                ? t('media.docx-editor.hide-review')
                : t('media.docx-editor.show-review')
            }
            aria-pressed={showReviewPane}
          >
            {showReviewPane ? (
              <PanelRightClose className="h-4 w-4" />
            ) : (
              <PanelRightOpen className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>

      {/* A4: AI redline composer — a slim panel under the toolbar. */}
      {redlineOpen && (
        <RedlineComposer
          instruction={redlineInstruction}
          onInstructionChange={setRedlineInstruction}
          busy={redlineBusy}
          error={redlineError}
          hasKey={redlineReady}
          aiPaused={aiGated}
          onRun={() => void runRedline()}
          onClose={() => { setRedlineOpen(false); }}
        />
      )}

      {/* A4: results summary of the last redline (why the AI changed things). */}
      {redlineSummary && (
        <RedlineSummaryPanel
          summary={redlineSummary}
          onDismiss={() => { setRedlineSummary(null); }}
        />
      )}

      {/* VG-4a: PDF export asked for but LibreOffice is not installed —
          explain in plain language with a copyable install link. */}
      {libreOfficeHelpOpen && (
        <LibreOfficeHelpNotice onDismiss={() => { setLibreOfficeHelpOpen(false); }} />
      )}

      {/* A6: export result (success or a friendly error from the export
          itself; a missing LibreOffice gets the panel above instead).
          Light theme; dismissible. */}
      {exportNotice && (
        <div
          data-testid="docx-export-notice"
          data-kind={exportNotice.kind}
          className={cn(
            'flex items-start gap-2 border-b px-3 py-2 text-xs',
            exportNotice.kind === 'success'
              ? 'bg-emerald-50/70 text-emerald-900'
              : 'bg-amber-50 text-amber-900',
          )}
        >
          {exportNotice.kind === 'success' ? (
            <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
          ) : (
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
          )}
          <p className="mx-auto max-w-[816px] flex-1">{exportNotice.message}</p>
          <button
            type="button"
            onClick={() => { setExportNotice(null); }}
            className="rounded p-0.5 text-muted-foreground hover:text-foreground"
            aria-label={t('media.docx-editor.export-dismiss')}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Body: document surface + optional review pane */}
      <div className="flex min-h-0 flex-1">
        {/* Document canvas */}
        <div
          data-testid="docx-canvas"
          className="min-w-0 flex-1 overflow-auto bg-[#f3f4f6] px-6 py-8"
        >
          <div
            data-testid="docx-page"
            className="mx-auto max-w-[816px] rounded-sm bg-white px-[96px] py-[72px] shadow-sm ring-1 ring-black/5"
            style={{
              // Word-like default body type. Page is 8.5in @ 96dpi = 816px,
              // 1in margins = 96px. Keeps letterhead spacing familiar.
              fontFamily: '"Calibri", "Segoe UI", system-ui, sans-serif',
              fontSize: '11pt',
              lineHeight: 1.5,
              color: '#1a1a1a',
            }}
          >
            <DocumentBody
              doc={currentDoc}
              reviewing={reviewing}
              editable={canEdit}
              activeCommentId={activeCommentId}
              onRunEdit={(blockIndex, inlineIndex, text) => { void handleRunEdit(blockIndex, inlineIndex, text); }}
              onActiveRunChange={onActiveRunChange}
              onCommentAnchorClick={setActiveCommentId}
            />
          </div>
        </div>

        {/* Review pane */}
        {showReviewPane && (
          <ReviewPane
            reviewing={reviewing}
            revisions={revisions}
            revisionCount={revisionCount}
            comments={comments}
            anchoredIds={anchoredIds}
            activeCommentId={activeCommentId}
            onResolveOne={(id, action) => { void handleResolveOne(id, action); }}
            onResolveAll={(action) => { void handleResolveAll(action); }}
            onSelectComment={setActiveCommentId}
            onClose={() => { setShowReviewPane(false); }}
          />
        )}
      </div>
    </div>
  );
}

export default DocxEditor;
