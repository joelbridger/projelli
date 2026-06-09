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
  FileType,
  Loader2,
  MessageSquare,
  PanelRightClose,
  PanelRightOpen,
  Sparkles,
  Wand2,
  X,
  XCircle,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { AutoSaveIndicator } from '@/components/editor/AutoSaveIndicator';
import { DocxViewer } from '@/components/media/DocxViewer';
import {
  docxAuthorRevisions,
  docxOpen,
  docxResolveAll,
  docxResolveRevision,
  docxSave,
  isDocxEngineAvailable,
} from '@/utils/docx-commands';
import { createProvider, type ChatProviderId } from '@/modules/models/providerFactory';
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
  parseParagraphFormat,
  parseRunFormat,
  runFormatToStyle,
  runsText,
  snippet,
} from '@/utils/docx-dom';
import type {
  DocumentJson,
  DocxBlock,
  DocxComment,
  DocxInline,
  DocxParagraph,
  DocxResolveAction,
  DocxRun,
  GroupedRevision,
} from '@/types/docx';
import type { AuditEntry } from '@/types/audit';

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
}

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; doc: DocumentJson }
  | { status: 'error'; message: string }
  | { status: 'unsupported' };

/** A human summary of the last AI redline, shown in the results panel. */
interface RedlineSummary {
  instruction: string;
  applied: number;
  skipped: number;
  items: { applied: boolean; reason: string; op: string; error?: string }[];
}

export function DocxEditor({
  filePath,
  fileName,
  src,
  className,
  onFirstEdit,
  onDocumentChange,
  apiKeys = [],
  aiProvider = 'anthropic',
  aiModel,
  authorName = 'You',
  onAuditLog,
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
  const [redlineOpen, setRedlineOpen] = useState(false);
  const [redlineInstruction, setRedlineInstruction] = useState('');
  const [redlineBusy, setRedlineBusy] = useState(false);
  const [redlineError, setRedlineError] = useState<string | null>(null);
  // A short summary of the last AI redline: the reasons + how many anchored.
  const [redlineSummary, setRedlineSummary] = useState<RedlineSummary | null>(
    null,
  );

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstEditFiredRef = useRef(false);
  const onDocumentChangeRef = useRef(onDocumentChange);
  useEffect(() => {
    onDocumentChangeRef.current = onDocumentChange;
  }, [onDocumentChange]);

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
        setLoad({ status: 'ready', doc });
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
  }, [canEdit, filePath]);

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
        await docxSave(filePath, doc);
        setLastSavedAt(Date.now());
        setIsDirty(false);
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

  const currentDoc = load.status === 'ready' ? load.doc : null;

  // ---- Accept / reject ---------------------------------------------------
  const handleResolveOne = useCallback(
    async (revisionId: string, action: DocxResolveAction) => {
      if (!currentDoc) return;
      try {
        const next = await docxResolveRevision(currentDoc, revisionId, action);
        applyResolvedDocument(next);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setSaveError(message);
        console.error('[DocxEditor] resolve revision failed:', err);
      }
    },
    [currentDoc, applyResolvedDocument],
  );

  const handleResolveAll = useCallback(
    async (action: DocxResolveAction) => {
      if (!currentDoc) return;
      try {
        const next = await docxResolveAll(currentDoc, action);
        applyResolvedDocument(next);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setSaveError(message);
        console.error('[DocxEditor] resolve all failed:', err);
      }
    },
    [currentDoc, applyResolvedDocument],
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
    [currentDoc, reviewing, authorName, applyResolvedDocument],
  );

  // ---- A4: AI redline ----------------------------------------------------
  // The valid key for the selected provider, if any (enables the button).
  const redlineKey = useMemo(
    () => apiKeys.find((k) => k.provider === aiProvider && k.isValid)?.key,
    [apiKeys, aiProvider],
  );

  /**
   * Run an AI redline from the user's instruction. Builds a prompt from the
   * current document, calls the user's chosen provider (BYOK, direct) for a
   * structured edit list, and applies it as tracked changes via the drift-safe
   * batch engine command. Surfaces a summary of what changed (the reasons).
   */
  const runRedline = useCallback(async () => {
    const instruction = redlineInstruction.trim();
    if (!instruction || !currentDoc || redlineBusy) return;
    if (!redlineKey) {
      setRedlineError(t('media.docx-editor.redline-need-key'));
      return;
    }
    setRedlineBusy(true);
    setRedlineError(null);
    setRedlineSummary(null);
    try {
      const provider = createProvider({
        provider: aiProvider,
        apiKey: redlineKey,
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
      const message = err instanceof Error ? err.message : String(err);
      setRedlineError(message);
      console.error('[DocxEditor] AI redline failed:', err);
    } finally {
      setRedlineBusy(false);
    }
  }, [
    redlineInstruction,
    currentDoc,
    redlineBusy,
    redlineKey,
    aiProvider,
    aiModel,
    fileName,
    applyResolvedDocument,
    onAuditLog,
    t,
  ]);

  const revisions = useMemo(
    () => (currentDoc ? groupRevisions(currentDoc) : []),
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
              redlineKey
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
          hasKey={Boolean(redlineKey)}
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
  onRun,
  onClose,
}: {
  instruction: string;
  onInstructionChange: (v: string) => void;
  busy: boolean;
  error: string | null;
  hasKey: boolean;
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
              onRun();
            }
          }}
          placeholder={t('media.docx-editor.redline-placeholder')}
          disabled={busy}
          className="min-h-[60px] resize-y bg-background text-sm"
        />
        {!hasKey && (
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
            disabled={busy || instruction.trim().length === 0 || !hasKey}
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
// Document body rendering
// ===========================================================================

function DocumentBody({
  doc,
  reviewing,
  editable,
  activeCommentId,
  onRunEdit,
  onCommentAnchorClick,
}: {
  doc: DocumentJson;
  reviewing: boolean;
  editable: boolean;
  activeCommentId: string | null;
  onRunEdit: (blockIndex: number, inlineIndex: number, text: string) => void;
  onCommentAnchorClick: (id: string) => void;
}) {
  return (
    <div data-testid="docx-document-body">
      {doc.body.map((block, blockIndex) => (
        <BlockView
          key={blockIndex}
          block={block}
          blockIndex={blockIndex}
          reviewing={reviewing}
          editable={editable}
          activeCommentId={activeCommentId}
          onRunEdit={onRunEdit}
          onCommentAnchorClick={onCommentAnchorClick}
        />
      ))}
    </div>
  );
}

function BlockView({
  block,
  blockIndex,
  reviewing,
  editable,
  activeCommentId,
  onRunEdit,
  onCommentAnchorClick,
}: {
  block: DocxBlock;
  blockIndex: number;
  reviewing: boolean;
  editable: boolean;
  activeCommentId: string | null;
  onRunEdit: (blockIndex: number, inlineIndex: number, text: string) => void;
  onCommentAnchorClick: (id: string) => void;
}) {
  const { t } = useTranslation();

  if (block.kind === 'raw') {
    // Preserve-by-default block (table, sectPr, content control). Read-only
    // placeholder — never parse the XML. Labeled so users know it's preserved.
    return (
      <div
        data-testid="docx-raw-block"
        className="my-3 select-none rounded border border-dashed border-muted-foreground/30 bg-muted/30 px-3 py-2 text-xs text-muted-foreground"
        contentEditable={false}
      >
        {t('media.docx-editor.preserved-block')}
      </div>
    );
  }

  const pfmt = parseParagraphFormat(block.propertiesXml);
  const align = pfmt.alignment;

  const inlineEls = block.inlines.map((inline, inlineIndex) => (
    <InlineView
      key={inlineIndex}
      inline={inline}
      blockIndex={blockIndex}
      inlineIndex={inlineIndex}
      reviewing={reviewing}
      editable={editable}
      activeCommentId={activeCommentId}
      onRunEdit={onRunEdit}
      onCommentAnchorClick={onCommentAnchorClick}
    />
  ));

  const commonStyle: React.CSSProperties = {
    textAlign: align,
    margin: '0 0 0.5em',
  };

  // Heading paragraphs get larger, heavier, navy-tinted type (Word default
  // headings are blue-ish; we lean to the app's navy accent).
  if (pfmt.headingLevel) {
    const level = pfmt.headingLevel;
    const sizes: Record<number, string> = {
      1: '20pt',
      2: '16pt',
      3: '13pt',
      4: '12pt',
      5: '11pt',
      6: '11pt',
    };
    return (
      <p
        data-testid="docx-paragraph"
        data-heading={level}
        style={{
          ...commonStyle,
          fontSize: sizes[level],
          fontWeight: 600,
          color: '#0A2540',
          marginTop: '0.8em',
        }}
      >
        {inlineEls.length > 0 ? inlineEls : <br />}
      </p>
    );
  }

  return (
    <p data-testid="docx-paragraph" style={commonStyle}>
      {inlineEls.length > 0 ? inlineEls : <br />}
    </p>
  );
}

function InlineView({
  inline,
  blockIndex,
  inlineIndex,
  reviewing,
  editable,
  activeCommentId,
  onRunEdit,
  onCommentAnchorClick,
}: {
  inline: DocxInline;
  blockIndex: number;
  inlineIndex: number;
  reviewing: boolean;
  editable: boolean;
  activeCommentId: string | null;
  onRunEdit: (blockIndex: number, inlineIndex: number, text: string) => void;
  onCommentAnchorClick: (id: string) => void;
}) {
  switch (inline.kind) {
    case 'run':
      return (
        <PlainRun
          run={inline}
          blockIndex={blockIndex}
          inlineIndex={inlineIndex}
          editable={editable}
          onRunEdit={onRunEdit}
        />
      );

    case 'insertion':
      return (
        <RevisionRun
          kind="insertion"
          runs={inline.runs}
          author={inline.meta.author}
          date={inline.meta.date}
          reviewing={reviewing}
        />
      );

    case 'deletion':
      return (
        <RevisionRun
          kind="deletion"
          runs={inline.runs}
          author={inline.meta.author}
          date={inline.meta.date}
          reviewing={reviewing}
        />
      );

    case 'commentReference':
      return (
        <CommentMarker
          id={inline.id}
          active={activeCommentId === inline.id}
          onClick={() => { onCommentAnchorClick(inline.id); }}
        />
      );

    case 'commentRangeStart':
      // Anchors are rendered as zero-width markers; the highlight comes from the
      // runs between start/end being wrapped. We keep them as data anchors so
      // future range-highlighting can find them; visually they're invisible.
      return (
        <span
          data-testid="docx-comment-range-start"
          data-comment-id={inline.id}
          className={cn(
            activeCommentId === inline.id && 'bg-amber-100',
          )}
        />
      );

    case 'commentRangeEnd':
      return (
        <span
          data-testid="docx-comment-range-end"
          data-comment-id={inline.id}
        />
      );

    case 'raw':
      // Preserve-by-default inline (hyperlink, field, drawing). Render its
      // flattened text if we can cheaply extract it, else a subtle marker.
      return <RawInline xml={inline.xml} />;

    default:
      return null;
  }
}

/** A normal, editable run. */
function PlainRun({
  run,
  blockIndex,
  inlineIndex,
  editable,
  onRunEdit,
}: {
  run: DocxRun;
  blockIndex: number;
  inlineIndex: number;
  editable: boolean;
  onRunEdit: (blockIndex: number, inlineIndex: number, text: string) => void;
}) {
  const fmt = useMemo(() => parseRunFormat(run.propertiesXml), [run.propertiesXml]);
  const { style, underline, strike } = runFormatToStyle(fmt);
  // Combine underline + strike into a single CSS decoration value (inline, so we
  // don't depend on specific Tailwind utility classes being present).
  const decorationLine = [underline && 'underline', strike && 'line-through']
    .filter(Boolean)
    .join(' ');

  const handleBlur = useCallback(
    (e: React.FocusEvent<HTMLSpanElement>) => {
      const text = e.currentTarget.textContent ?? '';
      onRunEdit(blockIndex, inlineIndex, text);
    },
    [blockIndex, inlineIndex, onRunEdit],
  );

  return (
    <span
      data-testid="docx-run"
      data-block={blockIndex}
      data-inline={inlineIndex}
      // `suppressContentEditableWarning` because we set initial text as a child
      // and let the browser own subsequent edits; we read it back on blur.
      contentEditable={editable}
      suppressContentEditableWarning
      spellCheck={editable}
      onBlur={editable ? handleBlur : undefined}
      style={{
        ...style,
        ...(decorationLine ? { textDecorationLine: decorationLine } : {}),
        whiteSpace: 'pre-wrap',
        outline: 'none',
      }}
    >
      {run.text}
    </span>
  );
}

/** A tracked insertion or deletion run, Word-styled, with author tooltip. */
function RevisionRun({
  kind,
  runs,
  author,
  date,
  reviewing,
}: {
  kind: 'insertion' | 'deletion';
  runs: DocxRun[];
  author: string;
  date: string;
  reviewing: boolean;
}) {
  const text = runsText(runs);
  const color = authorColor(author);

  // Clean "final" view: insertions become normal text, deletions vanish.
  if (!reviewing) {
    if (kind === 'deletion') return null;
    return (
      <span data-testid="docx-run" data-revision="insertion-final">
        {text}
      </span>
    );
  }

  const isIns = kind === 'insertion';
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          data-testid={isIns ? 'docx-insertion' : 'docx-deletion'}
          data-author={author}
          style={{
            color,
            textDecorationLine: isIns ? 'underline' : 'line-through',
            textDecorationColor: color,
            whiteSpace: 'pre-wrap',
            cursor: 'help',
          }}
        >
          {text}
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <span className="font-medium">
          {isIns ? 'Inserted' : 'Deleted'} by {author}
        </span>
        <span className="ml-1 text-muted-foreground">
          · {formatRevisionDate(date)}
        </span>
      </TooltipContent>
    </Tooltip>
  );
}

/** The little [n] marker Word shows where a comment reference sits. */
function CommentMarker({
  id,
  active,
  onClick,
}: {
  id: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-testid="docx-comment-marker"
      data-comment-id={id}
      onClick={onClick}
      title={`Comment ${id}`}
      className={cn(
        'mx-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-sm px-1 align-super text-[9px] font-semibold leading-none',
        active
          ? 'bg-amber-400 text-amber-950'
          : 'bg-amber-200 text-amber-900 hover:bg-amber-300',
      )}
    >
      <MessageSquare className="mr-0.5 h-2.5 w-2.5" />
      {id}
    </button>
  );
}

/**
 * Render a preserved (unmodeled) inline. We try a cheap text extraction from the
 * raw XML so hyperlinks/fields still read naturally; if there's no text, show a
 * subtle non-editable marker. Never parse structurally.
 */
function RawInline({ xml }: { xml: string }) {
  const text = useMemo(() => extractLooseText(xml), [xml]);
  if (text.trim().length > 0) {
    return (
      <span data-testid="docx-raw-inline" data-preserved="true">
        {text}
      </span>
    );
  }
  return (
    <span
      data-testid="docx-raw-inline"
      data-preserved="true"
      contentEditable={false}
      className="mx-0.5 inline-block select-none rounded bg-muted px-1 text-[10px] text-muted-foreground"
      title="Preserved content"
    >
      ⋯
    </span>
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

// ===========================================================================
// Small shared pieces
// ===========================================================================

function DocxEditorMessage({
  fileName,
  message,
}: {
  fileName: string;
  message: string;
}) {
  return (
    <div
      data-testid="docx-editor"
      data-mode="message"
      className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-muted-foreground"
    >
      <FileType className="h-12 w-12 opacity-50" />
      <p className="text-sm font-medium text-foreground">{fileName}</p>
      <p className="max-w-sm text-xs">{message}</p>
    </div>
  );
}

// ===========================================================================
// Pure helpers
// ===========================================================================

/** structuredClone with a JSON fallback for older runtimes / jsdom. */
function structuredCloneSafe<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value);
    } catch {
      /* fall through */
    }
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Pull human-readable text out of a small OOXML fragment by concatenating
 * `<w:t>...</w:t>` runs. Purely for display of preserved inlines (hyperlinks,
 * fields). Returns '' if none. Never throws; never used for structure.
 */
function extractLooseText(xml: string): string {
  let out = '';
  const re = /<(?:\w+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?t>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    out += decodeXmlEntities(m[1] ?? '');
  }
  return out;
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

export default DocxEditor;
