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
// plus a comments display. LIGHT THEME ONLY; navy accent (#0A2540).
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
  CheckCheck,
  Download,
  FileText,
  FileType,
  Loader2,
  PanelRightClose,
  PanelRightOpen,
  ShieldCheck,
  Sparkles,
  Wand2,
  X,
  XCircle,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { AutoSaveIndicator } from '@/components/editor/AutoSaveIndicator';
import { DocxViewer } from '@/components/media/DocxViewer';
import { LibreOfficeHelpNotice } from '@/components/media/LibreOfficeHelpNotice';
import { detectLibreOffice } from '@/utils/tauri-commands';
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
} from '@/utils/docx-commands';
import { createProvider, isLocalProviderId, type ChatProviderId } from '@/modules/models/providerFactory';
import { useTrialGate } from '@/hooks/useTrial';
import {
  REDLINE_AUTHOR,
  paragraphPlainRunText,
  requestRedlineEdits,
} from '@/modules/docx/redline';
import { diffParagraphEdits } from '@/utils/docx-text-diff';
import {
  anchoredCommentIds,
  authorColor,
  commentList,
  countRevisions,
  formatRevisionDate,
  groupRevisions,
  snippet,
} from '@/utils/docx-dom';
import type {
  DocumentJson,
  DocxComment,
  DocxParagraph,
  DocxResolveAction,
  DocxRun,
  GroupedRevision,
} from '@/types/docx';
import type { AuditEntry } from '@/types/audit';
import type { CoeditSession } from '@/modules/coedit/coeditSession';
import * as Y from 'yjs';
import { editRunText, addTrackedInsertion, addTrackedDeletion, resolveRevision } from '@/modules/coedit/docCrdt';
import { structuredCloneSafe, type RedlineSummary } from './docxEditorHelpers';
import { DocumentBody, DocxEditorMessage } from './DocxDocumentView';

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
   * to "Keepance AI" regardless of this.
   */
  authorName?: string;
  /** Optional audit hook — fired when an AI redline is applied. */
  onAuditLog?: (entry: Omit<AuditEntry, 'id' | 'timestamp'>) => void;
  /**
   * When present, activates live co-editing via the given CoeditSession.
   * When absent (default), the solo path is used byte-for-byte.
   */
  coedit?: { session: CoeditSession };
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
          setLoad({ status: 'ready', doc: liveDoc });
        } else {
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
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

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
        await docxSave(filePath, doc);
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
      saveTimerRef.current = setTimeout(() => {
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
  const flushSaveBeforeExport = useCallback(async (): Promise<boolean> => {
    if (!filePath || !currentDoc) return false;
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    // Persist synchronously so the on-disk bytes are current for the engine.
    await persist(currentDoc);
    return true;
  }, [filePath, currentDoc, persist]);

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
      const { saveFile } = await import('@/utils/saveFile');
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
      if (!currentDoc) return;

      // CO-EDIT PATH: resolve through the CRDT session, not the Rust command.
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

      try {
        const next = await docxResolveRevision(currentDoc, revisionId, action);
        applyResolvedDocument(next);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setSaveError(message);
        console.error('[DocxEditor] resolve revision failed:', err);
      }
    },
    [currentDoc, coedit, authorName, applyResolvedDocument],
  );

  const handleResolveAll = useCallback(
    async (action: DocxResolveAction) => {
      if (!currentDoc) return;

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

      try {
        const next = await docxResolveAll(currentDoc, action);
        applyResolvedDocument(next);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setSaveError(message);
        console.error('[DocxEditor] resolve all failed:', err);
      }
    },
    [currentDoc, coedit, authorName, applyResolvedDocument],
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
    (blockIndex: number, inlineIndex: number, newText: string) => {
      if (!currentDoc) return;
      const block = currentDoc.body[blockIndex];
      if (!block || block.kind !== 'paragraph') return;
      const inline = block.inlines[inlineIndex];
      if (!inline || inline.kind !== 'run') return;
      if (inline.text === newText) return;

      // CO-EDIT PATH: route text edits through the CRDT session.
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

      if (!reviewing) {
        // Final view: plain replacement (no tracked change). Structural clone so
        // we never mutate the live object.
        const next: DocumentJson = structuredCloneSafe(currentDoc);
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
      // plain-run text of the paragraph.
      let paragraphIndex = -1;
      for (let i = 0; i <= blockIndex; i++) {
        if (currentDoc.body[i]?.kind === 'paragraph') paragraphIndex += 1;
      }
      const oldPlain = paragraphPlainRunText(block);
      // New plain text = old runs with this run's text swapped.
      let newPlain = '';
      block.inlines.forEach((inl, idx) => {
        if (inl.kind === 'run') {
          newPlain += idx === inlineIndex ? newText : inl.text;
        }
      });
      const edits = diffParagraphEdits(paragraphIndex, oldPlain, newPlain);
      if (edits.length === 0) return;

      void (async () => {
        try {
          const { document: nextDoc } = await docxAuthorRevisions(
            currentDoc,
            edits,
            { author: authorName },
          );
          applyResolvedDocument(nextDoc);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          setSaveError(message);
          console.error('[DocxEditor] track-changes user edit failed:', err);
        }
      })();
    },
    [currentDoc, reviewing, authorName, applyResolvedDocument, coedit],
  );

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
      // WS-C honesty — createProvider builds the LOCAL provider for 'ollama'
      // (no key, on-machine) and the cloud provider otherwise. A local redline
      // can never be routed to a cloud provider here.
      const provider = createProvider({
        provider: aiProvider,
        ...(redlineKey ? { apiKey: redlineKey } : {}),
        ...(aiModel ? { model: aiModel } : {}),
      });
      const edits = await requestRedlineEdits(provider, instruction, currentDoc);
      if (edits.length === 0) {
        setRedlineSummary({ instruction, applied: 0, skipped: 0, items: [] });
        setRedlineBusy(false);
        return;
      }
      const { document: nextDoc, results } = await docxAuthorRevisions(
        currentDoc,
        edits,
        { author: REDLINE_AUTHOR },
      );

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

      // WS-A / A5: attribute the resulting version snapshot to the AI.
      pendingSaveAuthorRef.current = 'ai';
      applyResolvedDocument(nextDoc);
      setRedlineSummary({ instruction, applied, skipped, items });
      setRedlineInstruction('');
      setRedlineOpen(false);

      onAuditLog?.({
        action: 'model_call',
        description: `AI redline: ${instruction}`,
        model: aiModel ?? aiProvider,
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
    applyResolvedDocument,
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

          {/* A6: discoverable Export — a clearly-labeled menu (not a bare icon)
              offering Word, PDF, and a privilege-safe clean copy. */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                data-testid="docx-export"
                variant="outline"
                size="sm"
                className="h-7 gap-1.5 border-[#0A2540]/30 text-[#0A2540] hover:bg-[#0A2540]/5"
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
              <DropdownMenuLabel className="text-[#0A2540]">
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
            className="h-7 gap-1.5 border-[#0A2540]/30 text-[#0A2540] hover:bg-[#0A2540]/5"
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
              onRunEdit={handleRunEdit}
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

// ===========================================================================
// Reviewing toggle (Word's "All Markup" vs "No Markup")
// ===========================================================================

function ReviewingToggle({
  reviewing,
  onToggle,
}: {
  reviewing: boolean;
  onToggle: (v: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      data-testid="docx-reviewing-toggle"
      role="switch"
      aria-checked={reviewing}
      onClick={() => { onToggle(!reviewing); }}
      title={t('media.docx-editor.reviewing-hint')}
      className={cn(
        'flex items-center gap-2 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors',
        reviewing
          ? 'border-[#0A2540]/30 bg-[#0A2540]/5 text-[#0A2540]'
          : 'border-border bg-background text-muted-foreground hover:text-foreground',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'relative h-3.5 w-6 rounded-full transition-colors',
          reviewing ? 'bg-[#0A2540]' : 'bg-muted-foreground/30',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 h-2.5 w-2.5 rounded-full bg-white transition-all',
            reviewing ? 'left-[12px]' : 'left-0.5',
          )}
        />
      </span>
      {t('media.docx-editor.reviewing')}
    </button>
  );
}

// ===========================================================================
// A4: AI redline composer + results summary
// ===========================================================================

/**
 * The instruction composer. A textarea + "Suggest changes" button. Cmd/Ctrl+Enter
 * submits. Shows a key-required hint when no provider key is configured, and any
 * provider error inline.
 */
function RedlineComposer({
  instruction,
  onInstructionChange,
  busy,
  error,
  hasKey,
  aiPaused,
  onRun,
  onClose,
}: {
  instruction: string;
  onInstructionChange: (v: string) => void;
  busy: boolean;
  error: string | null;
  hasKey: boolean;
  /** True when AI features are paused (lapsed subscription / expired trial). */
  aiPaused: boolean;
  onRun: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      data-testid="docx-redline-composer"
      className="border-b bg-[#0A2540]/[0.03] px-3 py-2.5"
    >
      <div className="mx-auto flex max-w-[816px] flex-col gap-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-[#0A2540]">
          <Sparkles className="h-3.5 w-3.5" />
          {t('media.docx-editor.revise-with-ai')}
          <button
            type="button"
            onClick={onClose}
            className="ml-auto rounded p-0.5 text-muted-foreground hover:text-foreground"
            aria-label={t('media.docx-editor.redline-close')}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <Textarea
          data-testid="docx-redline-input"
          value={instruction}
          onChange={(e) => { onInstructionChange(e.target.value); }}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault();
              if (!aiPaused) onRun();
            }
          }}
          placeholder={t('media.docx-editor.redline-placeholder')}
          disabled={busy || aiPaused}
          className="min-h-[60px] resize-y bg-background text-sm"
        />
        {aiPaused && (
          <p
            data-testid="docx-redline-ai-paused"
            className="rounded bg-amber-50 px-2 py-1 text-[11px] text-amber-800"
          >
            {t('media.docx-editor.redline-ai-paused')}
          </p>
        )}
        {!aiPaused && !hasKey && (
          <p
            data-testid="docx-redline-need-key"
            className="rounded bg-amber-50 px-2 py-1 text-[11px] text-amber-800"
          >
            {t('media.docx-editor.redline-need-key')}
          </p>
        )}
        {error && (
          <p
            data-testid="docx-redline-error"
            className="rounded bg-red-50 px-2 py-1 text-[11px] text-red-700"
          >
            {error}
          </p>
        )}
        <div className="flex items-center justify-end gap-2">
          <span className="mr-auto text-[10px] text-muted-foreground">
            {t('media.docx-editor.redline-egress-note')}
          </span>
          <Button
            data-testid="docx-redline-submit"
            size="sm"
            className="h-7 gap-1.5 bg-[#0A2540] text-xs hover:bg-[#0A2540]/90"
            onClick={onRun}
            disabled={busy || instruction.trim().length === 0 || !hasKey || aiPaused}
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Wand2 className="h-3.5 w-3.5" />
            )}
            {busy
              ? t('media.docx-editor.redline-working')
              : t('media.docx-editor.redline-submit')}
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * A compact summary of the last redline: a headline (N changes proposed) and a
 * list of the AI's reasons, marking any edit whose anchor couldn't be located.
 */
function RedlineSummaryPanel({
  summary,
  onDismiss,
}: {
  summary: RedlineSummary;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  const total = summary.applied + summary.skipped;
  return (
    <div
      data-testid="docx-redline-summary"
      className="border-b bg-emerald-50/60 px-3 py-2"
    >
      <div className="mx-auto max-w-[816px]">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-900">
          <Sparkles className="h-3.5 w-3.5" />
          {total === 0
            ? t('media.docx-editor.redline-no-changes')
            : t('media.docx-editor.redline-summary-headline', {
                applied: summary.applied,
              })}
          {summary.skipped > 0 && (
            <span className="font-normal text-amber-700">
              {t('media.docx-editor.redline-skipped', { skipped: summary.skipped })}
            </span>
          )}
          <button
            type="button"
            onClick={onDismiss}
            className="ml-auto rounded p-0.5 text-muted-foreground hover:text-foreground"
            aria-label={t('media.docx-editor.redline-dismiss')}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        {summary.items.length > 0 && (
          <ul
            data-testid="docx-redline-reasons"
            className="mt-1.5 space-y-1 text-[11px]"
          >
            {summary.items.map((item, i) => (
              <li
                key={i}
                data-applied={item.applied ? 'true' : 'false'}
                className="flex items-start gap-1.5"
              >
                {item.applied ? (
                  <Check className="mt-0.5 h-3 w-3 shrink-0 text-emerald-600" />
                ) : (
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-600" />
                )}
                <span
                  className={cn(
                    'flex-1',
                    item.applied ? 'text-foreground/80' : 'text-amber-800',
                  )}
                >
                  {item.reason || t(`media.docx-editor.redline-op-${item.op}`)}
                  {!item.applied && item.error && (
                    <span className="ml-1 text-amber-600">({item.error})</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ===========================================================================
// Review pane
// ===========================================================================

function ReviewPane({
  reviewing,
  revisions,
  revisionCount,
  comments,
  anchoredIds,
  activeCommentId,
  onResolveOne,
  onResolveAll,
  onSelectComment,
  onClose,
}: {
  reviewing: boolean;
  revisions: GroupedRevision[];
  revisionCount: number;
  comments: DocxComment[];
  anchoredIds: Set<string>;
  activeCommentId: string | null;
  onResolveOne: (id: string, action: DocxResolveAction) => void;
  onResolveAll: (action: DocxResolveAction) => void;
  onSelectComment: (id: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <aside
      data-testid="docx-review-pane"
      className="flex w-80 shrink-0 flex-col border-l bg-muted/20"
    >
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t('media.docx-editor.review')}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0"
          onClick={onClose}
          title={t('media.docx-editor.hide-review')}
          aria-label={t('media.docx-editor.hide-review')}
        >
          <PanelRightClose className="h-4 w-4" />
        </Button>
      </div>

      {/* Bulk actions */}
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <Button
          data-testid="docx-accept-all"
          variant="outline"
          size="sm"
          className="h-7 flex-1 gap-1 text-xs"
          disabled={revisionCount === 0}
          onClick={() => { onResolveAll('accept'); }}
        >
          <CheckCheck className="h-3.5 w-3.5 text-emerald-600" />
          {t('media.docx-editor.accept-all')}
        </Button>
        <Button
          data-testid="docx-reject-all"
          variant="outline"
          size="sm"
          className="h-7 flex-1 gap-1 text-xs"
          disabled={revisionCount === 0}
          onClick={() => { onResolveAll('reject'); }}
        >
          <XCircle className="h-3.5 w-3.5 text-red-600" />
          {t('media.docx-editor.reject-all')}
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {/* Changes */}
        <div className="px-3 py-2">
          <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t('media.docx-editor.changes')} ({revisionCount})
          </h3>
          {!reviewing && revisionCount > 0 && (
            <p
              data-testid="docx-review-final-note"
              className="mb-2 rounded bg-amber-50 px-2 py-1 text-[11px] text-amber-800"
            >
              {t('media.docx-editor.final-view-note')}
            </p>
          )}
          {revisionCount === 0 ? (
            <p
              data-testid="docx-no-changes"
              className="py-2 text-xs text-muted-foreground"
            >
              {t('media.docx-editor.no-changes')}
            </p>
          ) : (
            <ul data-testid="docx-revision-list" className="space-y-1.5">
              {revisions.map((rev) => (
                <RevisionRow
                  key={rev.id}
                  revision={rev}
                  onAccept={() => { onResolveOne(rev.id, 'accept'); }}
                  onReject={() => { onResolveOne(rev.id, 'reject'); }}
                />
              ))}
            </ul>
          )}
        </div>

        {/* Comments */}
        {comments.length > 0 && (
          <div className="border-t px-3 py-2">
            <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t('media.docx-editor.comments')} ({comments.length})
            </h3>
            <ul data-testid="docx-comment-list" className="space-y-1.5">
              {comments.map((c) => (
                <CommentCard
                  key={c.id}
                  comment={c}
                  anchored={anchoredIds.has(c.id)}
                  active={activeCommentId === c.id}
                  onClick={() => { onSelectComment(c.id); }}
                />
              ))}
            </ul>
          </div>
        )}
      </div>
    </aside>
  );
}

function RevisionRow({
  revision,
  onAccept,
  onReject,
}: {
  revision: GroupedRevision;
  onAccept: () => void;
  onReject: () => void;
}) {
  const { t } = useTranslation();
  const color = authorColor(revision.author);
  const isIns = revision.kind === 'insertion';
  return (
    <li
      data-testid="docx-revision-row"
      data-revision-id={revision.id}
      data-revision-kind={revision.kind}
      className="rounded-md border bg-background p-2 text-xs shadow-sm"
    >
      <div className="mb-1 flex items-center gap-1.5">
        <span
          aria-hidden="true"
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: color }}
        />
        <span className="font-medium" style={{ color }}>
          {revision.author}
        </span>
        <span
          className={cn(
            'ml-auto rounded px-1 py-0.5 text-[10px] font-medium uppercase',
            isIns
              ? 'bg-emerald-50 text-emerald-700'
              : 'bg-red-50 text-red-700',
          )}
        >
          {isIns
            ? t('media.docx-editor.insertion')
            : t('media.docx-editor.deletion')}
        </span>
      </div>
      <p
        className={cn(
          'mb-1.5 break-words text-foreground/80',
          isIns ? 'italic' : 'line-through',
        )}
        title={revision.text}
      >
        {snippet(revision.text) || (
          <span className="not-italic text-muted-foreground no-underline">
            {t('media.docx-editor.empty-change')}
          </span>
        )}
      </p>
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground">
          {formatRevisionDate(revision.date)}
        </span>
        <div className="flex gap-1">
          <Button
            data-testid="docx-accept-one"
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700"
            onClick={onAccept}
            title={t('media.docx-editor.accept')}
            aria-label={t('media.docx-editor.accept')}
          >
            <Check className="h-3.5 w-3.5" />
          </Button>
          <Button
            data-testid="docx-reject-one"
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 text-red-600 hover:bg-red-50 hover:text-red-700"
            onClick={onReject}
            title={t('media.docx-editor.reject')}
            aria-label={t('media.docx-editor.reject')}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </li>
  );
}

function CommentCard({
  comment,
  anchored,
  active,
  onClick,
}: {
  comment: DocxComment;
  anchored: boolean;
  active: boolean;
  onClick: () => void;
}) {
  const { t } = useTranslation();
  const color = authorColor(comment.author);
  return (
    <li
      data-testid="docx-comment-card"
      data-comment-id={comment.id}
      data-active={active ? 'true' : 'false'}
    >
      <button
        type="button"
        onClick={onClick}
        className={cn(
          'w-full rounded-md border bg-background p-2 text-left text-xs shadow-sm transition-colors',
          active ? 'ring-2 ring-amber-300' : 'hover:bg-muted/40',
        )}
      >
        <div className="mb-1 flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[8px] font-semibold text-white"
            style={{ backgroundColor: color }}
          >
            {(comment.initials || comment.author || '?')
              .slice(0, 2)
              .toUpperCase()}
          </span>
          <span className="font-medium" style={{ color }}>
            {comment.author}
          </span>
          {!anchored && (
            <span
              className="ml-auto text-[9px] text-muted-foreground"
              title={t('media.docx-editor.orphan-comment')}
            >
              {t('media.docx-editor.orphan-comment')}
            </span>
          )}
        </div>
        <p className="mb-1 whitespace-pre-wrap break-words text-foreground/80">
          {comment.text}
        </p>
        <span className="text-[10px] text-muted-foreground">
          {formatRevisionDate(comment.date)}
        </span>
      </button>
    </li>
  );
}

export default DocxEditor;
