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

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { readTauriFile } from '@/platform/fs/tauriFsPlugin';
import {
  AlertTriangle,
  Check,
  Columns,
  Download,
  FileText,
  FileType,
  History,
  List,
  Loader2,
  Mail,
  MoreVertical,
  PanelRightClose,
  PanelRightOpen,
  Pencil,
  Rows,
  Send,
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
import { createAuditPairId, mustLogAuditPhase } from '@/platform/audit/durableAudit';
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
import {
  expectedScopeFromDecision,
  readSelectionOperationDecision,
} from '@/platform/client-context';
import { crmIsConnected } from '@/platform/utils/wealthbox-commands';
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
import {
  registerDocxSaver,
  updateDocxSaveState,
} from '@/platform/fs/docxSaveRegistry';
import { openDocxSession, type DocxSession } from '@/platform/fs/docxSaveSession';
import { useEditorStore } from '@/platform/state/editorStore';

const SAVE_DEBOUNCE_MS = 1200;

// QA-81 (P0 silent data loss): a brand-new .docx being ACTIVELY TYPED lost all
// in-progress text on a crash/power-loss, while the toolbar showed "Saved". A
// keystroke lives in the run's contentEditable DOM until the run BLURS (which
// commits it and schedules a save); until then no save is scheduled at all, so
// the steady-state autosave wrote a doc MISSING whatever was being typed. Only
// the navigate-away / close / quit / unmount flush ever folded the live text
// in. This periodic cadence closes that gap: every ~2s while a run is focused,
// its live DOM text is folded into a clone of the session doc and written to
// disk — WITHOUT touching the live editing model or re-rendering (so the caret
// is never disturbed). A later blur authors the proper (tracked-change) commit
// and supersedes this plain-text shadow on disk. So "Saved" now truthfully
// means the live keystroke is on disk, not just the last blurred edit.
const LIVE_TYPING_AUTOSAVE_MS = 2000;

// QA-81 (P1): the instant the user types into a focused run we mark the doc
// unsaved (so the toolbar never lies "Saved" while un-persisted text is only in
// the DOM) AND kick a prompt disk write — but THROTTLED to at most one write per
// this interval so fast typing doesn't thrash the disk with a full .docx save
// per keystroke. Shorter than the periodic tick above so a crash loses at most
// a fraction of a second of typing, not a full autosave cycle.
const LIVE_TYPING_SAVE_THROTTLE_MS = 500;

// QA-34 (P0 silent data loss): when a save write fails (e.g. antivirus/backup
// briefly holds an exclusive OS lock on the file) the doc stays dirty and we
// RETRY automatically with exponential backoff — most such locks clear within
// seconds, so the save lands on its own and the indicator returns to a truthful
// "Saved" with nothing lost. If the failure PERSISTS across several attempts we
// escalate to a visible, non-timeout-dismissable warning with a "Save a copy
// elsewhere" escape hatch, keeping the user's typing safe in memory throughout.
const RETRY_BASE_MS = 750; // first retry delay; doubles each attempt
const RETRY_MAX_MS = 15000; // cap the backoff so it keeps trying promptly
const ESCALATE_AFTER_FAILURES = 3; // consecutive failed attempts before we warn the user

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
   * to "Lantern AI" regardless of this.
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
  /**
   * Smoke P0 #5: queues the document's plain text as a proposed Wealthbox
   * note for the CURRENT matter — mirrors MatterNotesEditor's "Send to
   * Wealthbox" enqueue. Omitted (no current matter, e.g. an unassigned
   * note) hides the action entirely; when present it is still gated on the
   * Wealthbox connection (disabled with an explanation until connected).
   * Returns whether a proposal was actually queued (false for a blank or
   * table-only document with no extractable title) so the toolbar's
   * confirmation never claims success for a no-op enqueue (codex-review).
   */
  onSendToWealthbox?: ((plainText: string) => boolean) | undefined;
  /**
   * QA finding (P3): the "Review now" action next to the send confirmation —
   * jumps to this document's client's Client Map, where the review card
   * lives. DocxEditor doesn't own a matterId itself (the parent resolves it
   * from the file path), so this mirrors onSendToWealthbox's shape: present
   * only when a current matter exists.
   */
  onReviewWealthboxQueue?: (() => void) | undefined;
  /**
   * E3 (Tier B trust guard): when set, this note is not yet cleared to leave
   * the app (an unreviewed/errored/notice-quarantined meeting note), so both
   * outbound toolbar actions — "Draft follow-up" and "Send to Wealthbox" —
   * render disabled with this string as the honest explanation. The parent
   * (MainPanel) computes it from the meeting's review + notice state. Absent
   * for ordinary documents and for cleared notes.
   */
  outboundBlockedReason?: string | undefined;
  /** Rename the active file from the clean document header. */
  onRenameFile?: ((newName: string) => Promise<void> | void) | undefined;
  /** Existing MainPanel actions folded into the same document menu. */
  onDownload?: (() => void) | undefined;
  versionHistoryLabel?: string | undefined;
  onToggleHistory?: (() => void) | undefined;
  onSplitHorizontal?: (() => void) | undefined;
  onSplitVertical?: (() => void) | undefined;
  onToggleOutline?: (() => void) | undefined;
}

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; doc: DocumentJson }
  | { status: 'error'; message: string }
  | { status: 'unsupported' };

/**
 * Fold a run's LIVE contentEditable text into a fresh clone of `doc` as a plain-
 * text replacement, returning the clone — or `null` when there is nothing to do
 * (the target isn't a plain run any more, or its text already matches). It never
 * mutates `doc`, never touches the live view / `currentDocRef` / track-changes
 * authoring, and closes over no component state, so it's safe to call from a
 * racing outgoing-session merge OR the steady-state periodic autosave without
 * disturbing the caret or whatever else is editing concurrently.
 *
 * The blockIndex/inlineIndex are best-effort: if a concurrent structural change
 * (a tracked-change commit) moved the run, the kind guards below simply no-op
 * rather than corrupting the wrong content — the authoritative blur commit
 * handles correctness.
 */
function foldLiveRunTextIntoDoc(
  doc: DocumentJson,
  blockIndex: number,
  inlineIndex: number,
  text: string,
): DocumentJson | null {
  const block = doc.body[blockIndex];
  if (!block || block.kind !== 'paragraph') return null;
  const inline = block.inlines[inlineIndex];
  if (!inline || inline.kind !== 'run' || inline.text === text) return null;
  const next: DocumentJson = structuredCloneSafe(doc);
  const nextBlock = next.body[blockIndex] as DocxParagraph;
  const nextInline = nextBlock.inlines[inlineIndex] as DocxRun & { kind: 'run' };
  nextInline.text = text;
  return next;
}

function placeCaretAtEnd(element: HTMLElement): void {
  element.focus();
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(element);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

function findNearestEditableRun(container: HTMLElement, clientX = 0, clientY = 0): HTMLElement | null {
  const runs = Array.from(
    container.querySelectorAll<HTMLElement>('[data-testid="docx-run"][contenteditable="true"]'),
  );
  if (runs.length === 0) return null;
  let best = runs[0] ?? null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const run of runs) {
    const rect = run.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const dx = clientX - centerX;
    const dy = clientY - centerY;
    const distance = dx * dx + dy * dy;
    if (distance < bestDistance) {
      best = run;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * Cleanup batch 4 (task #24) — Codex review catches, 4 rounds: a filePath
 * change (unlike a true unmount) can leave a run FOCUSED and un-blurred (a
 * keyboard shortcut or programmatic navigation doesn't necessarily blur it
 * first, unlike clicking elsewhere). Folding that edit in through the full
 * `handleRunEdit` pipeline is unsafe here: that pipeline reads/writes
 * `currentDocRef.current` and updates the live view via
 * `applyResolvedDocument`, both of which a RACING new-path session load can
 * reassign to the NEW document before the fold-in's queued op actually runs —
 * so the fold-in could merge into (and save) the wrong document, or briefly
 * flash the new view back to old content.
 *
 * This does a MINIMAL, self-contained plain-text merge (via
 * `foldLiveRunTextIntoDoc`) directly against the CAPTURED outgoing session's
 * own `doc` — it never touches `currentDocRef`, the live view, or track-changes
 * authoring, so it cannot be affected by (or affect) whatever the new
 * document's load is doing concurrently.
 *
 * Trade-off, accepted deliberately: this loses track-changes attribution for
 * this one last in-flight keystroke in this one narrow edge case (a plain
 * replacement, same as `handleRunEdit`'s own non-reviewing-mode behavior) —
 * a small, non-data-lossy simplification against the alternative of threading
 * an override through the full rich pipeline, which still couldn't safely
 * reuse `currentDocRef`/`applyResolvedDocument` without reintroducing the
 * exact race this exists to close.
 */
function commitOutgoingRunEditIfAny(
  active: { blockIndex: number; inlineIndex: number; element: HTMLElement } | null,
  outgoingSession: DocxSession | null,
): void {
  if (!active || !outgoingSession) return;
  const text = active.element.textContent ?? '';
  const next = foldLiveRunTextIntoDoc(outgoingSession.doc, active.blockIndex, active.inlineIndex, text);
  if (next) outgoingSession.scheduleSave(next, SAVE_DEBOUNCE_MS);
}

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
  onSendToWealthbox,
  onReviewWealthboxQueue,
  outboundBlockedReason,
  onRenameFile,
  onDownload,
  versionHistoryLabel,
  onToggleHistory,
  onSplitHorizontal,
  onSplitVertical,
  onToggleOutline,
}: DocxEditorProps) {
  const { t } = useTranslation();
  const pendingDocxFocusPath = useEditorStore((s) => s.pendingDocxFocusPath);
  const setPendingDocxFocusPath = useEditorStore((s) => s.setPendingDocxFocusPath);
  // E3: a meeting note that hasn't cleared review can't leave the app.
  const outboundBlocked = Boolean(outboundBlockedReason);

  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  // "Reviewing" gates whether tracked changes are shown inline (Word's "All
  // Markup") vs a clean "final" view that renders insertions as normal text and
  // hides deletions. The Review pane only shows while reviewing.
  const [reviewing, setReviewing] = useState(true);
  const [showReviewPane, setShowReviewPane] = useState(true);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState(() => {
    const dot = fileName.lastIndexOf('.');
    return dot > 0 ? fileName.slice(0, dot) : fileName;
  });
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<number | undefined>(undefined);
  const [isDirty, setIsDirty] = useState(false);
  // QA-34: set true once a save has FAILED enough times to be treated as a
  // sustained problem (a locked file, a full/read-only disk). Drives the visible
  // non-dismissable "can't save" warning + the "Save a copy elsewhere" hatch.
  // Cleared automatically the moment any save finally succeeds.
  const [escalated, setEscalated] = useState(false);
  // Set while the user's manual "Save a copy elsewhere" rescue write is running.
  const [savingCopy, setSavingCopy] = useState(false);
  // The comment whose card is highlighted (clicked anchor <-> card linking).
  const [activeCommentId, setActiveCommentId] = useState<string | null>(null);
  const openRenameAfterActionsMenuRef = useRef(false);

  // ---- Smoke P0 #5: Send to Wealthbox -------------------------------------
  // Checked only when the action can appear at all (a current matter is
  // present), mirroring the one-shot connection check every other Wealthbox
  // entry point (CrmWriteReviewCard, WealthboxConnect) already does.
  const [wealthboxConnected, setWealthboxConnected] = useState(false);
  const [wealthboxQueued, setWealthboxQueued] = useState(false);
  useEffect(() => {
    if (!onSendToWealthbox) return;
    let cancelled = false;
    crmIsConnected('wealthbox')
      .then((connected) => { if (!cancelled) setWealthboxConnected(connected); })
      .catch(() => { if (!cancelled) setWealthboxConnected(false); });
    return () => { cancelled = true; };
  }, [onSendToWealthbox]);

  useEffect(() => {
    if (isRenaming) return;
    const dot = fileName.lastIndexOf('.');
    setRenameDraft(dot > 0 ? fileName.slice(0, dot) : fileName);
  }, [fileName, isRenaming]);

  useEffect(() => {
    if (!isRenaming) return;
    const input = renameInputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, [isRenaming]);

  const submitRename = useCallback(async (draftOverride?: string) => {
    if (!onRenameFile) {
      setIsRenaming(false);
      return;
    }
    const trimmed = (draftOverride ?? renameDraft).trim();
    if (!trimmed) {
      setIsRenaming(false);
      return;
    }
    const dot = fileName.lastIndexOf('.');
    const ext = dot > 0 ? fileName.slice(dot) : '';
    const nextName =
      ext && !trimmed.toLowerCase().endsWith(ext.toLowerCase())
        ? `${trimmed}${ext}`
        : trimmed;
    if (nextName !== fileName) {
      await onRenameFile(nextName);
    }
    setIsRenaming(false);
  }, [fileName, onRenameFile, renameDraft]);

  const startRenaming = useCallback(() => {
    openRenameAfterActionsMenuRef.current = true;
  }, []);

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
  // QA-34 retry machinery. `retryTimerRef` is the pending backoff timer;
  // `retryDelayRef` the current backoff; `consecutiveFailuresRef` counts failures
  // since the last success (drives escalation). All reset on any successful save.
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryDelayRef = useRef<number>(RETRY_BASE_MS);
  const consecutiveFailuresRef = useRef(0);
  // Mirrors of dirty/error for closures (registry flush, retry) that must read
  // the LATEST value without being re-created on every change.
  const saveErrorRef = useRef<string | null>(null);
  // Stable indirection so `scheduleRetry` can call the latest `persist` without a
  // declaration cycle (persist -> scheduleRetry -> persist).
  const persistRef = useRef<((doc: DocumentJson) => Promise<void>) | null>(null);
  // Latest `attemptSave`, so the registry's flush closure (registered ONCE per
  // path) always calls the current save without re-registering on every render.
  const attemptSaveRef = useRef<((doc: DocumentJson) => Promise<boolean>) | null>(null);
  const pageRef = useRef<HTMLDivElement | null>(null);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  // False once this editor has unmounted — guards the retry loop so a save that
  // was in flight at unmount can't schedule a NEW retry against a torn-down
  // component (which would setState after unmount and could rewrite a file the
  // user has navigated away from).
  const mountedRef = useRef(true);
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
  const onFirstEditRef = useRef(onFirstEdit);
  // Cleanup batch 4 (task #24, QA-34 residual race): the SOLO (non-coedit)
  // path's persistent save/retry session for this filePath, once loaded. Its
  // doc + dirty/retry state can outlive THIS component instance — see
  // docxSaveSession.ts. `unsubscribeSessionRef` detaches this view's state
  // mirror (isDirty/isSaving/saveError/escalated/lastSavedAt) from the
  // session; it does NOT dispose the session itself.
  const sessionRef = useRef<DocxSession | null>(null);
  const unsubscribeSessionRef = useRef<(() => void) | null>(null);
  // Codex review catch (post-merge, P2): the EXACT live-flush-hook function
  // THIS view installed on the session, so its own (possibly delayed)
  // teardown can prove it's still the current one before touching the
  // session — see DocxSession.clearLiveFlushHookIfCurrent's doc comment.
  const liveFlushHookRef = useRef<(() => Promise<void>) | null>(null);
  useEffect(() => {
    onDocumentChangeRef.current = onDocumentChange;
  }, [onDocumentChange]);
  useEffect(() => {
    onAfterSaveRef.current = onAfterSave;
  }, [onAfterSave]);
  useEffect(() => {
    onFirstEditRef.current = onFirstEdit;
  }, [onFirstEdit]);
  useEffect(() => {
    isDirtyRef.current = isDirty;
  }, [isDirty]);
  useEffect(() => {
    saveErrorRef.current = saveError;
  }, [saveError]);

  // QA-34: mirror the live save state into the shared registry so the app's
  // save-integrity guards (tab dirty-dot, close-tab confirm, workspace-switch
  // guard, quit/flush-all) can SEE a .docx's unsaved/failing state — the editor
  // store never does, because .docx content never flows through it.
  useEffect(() => {
    if (!filePath) return;
    updateDocxSaveState(filePath, {
      dirty: isDirty,
      saving: isSaving,
      error: saveError !== null,
    });
  }, [filePath, isDirty, isSaving, saveError]);

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

  // QA-81 (P1): a throttle timer for the prompt live save kicked on input (see
  // `onActiveRunInput`). Held in a ref so it survives re-renders and can be
  // cleared on unmount.
  const liveSaveThrottleRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // QA-81 (P1): called by `PlainRun` on EVERY keystroke into a focused run.
  // Marks the doc unsaved IMMEDIATELY (so the toolbar/registry never read a
  // false "Saved" while the new characters live only in the DOM), and kicks a
  // THROTTLED disk write so the crash-loss window is a fraction of a second, not
  // a full autosave cycle. Solo path only — co-edit routes through the CRDT and
  // has no DocxSession here. The 2s periodic autosave still runs as a backstop.
  const onActiveRunInput = useCallback(
    (blockIndex: number, inlineIndex: number, element: HTMLElement) => {
      activeRunRef.current = { blockIndex, inlineIndex, element };
      if (coedit) return;
      const session = sessionRef.current;
      if (!session || session.isDisposed) return;
      // Instant honesty — flip to unsaved synchronously.
      session.markDirty();
      // Throttle the actual write: if one is already scheduled, this keystroke
      // rides it (trailing save captures the latest DOM text when it fires).
      if (liveSaveThrottleRef.current) return;
      liveSaveThrottleRef.current = setTimeout(() => {
        liveSaveThrottleRef.current = null;
        const active = activeRunRef.current;
        const liveSession = sessionRef.current;
        if (!active || !liveSession || liveSession.isDisposed) return;
        const next = foldLiveRunTextIntoDoc(
          liveSession.doc,
          active.blockIndex,
          active.inlineIndex,
          active.element.textContent ?? '',
        );
        if (next) {
          liveSession.persistLive(next).catch((err: unknown) => {
            console.error('[DocxEditor] live-typing autosave (input) failed:', err);
          });
        }
      }, LIVE_TYPING_SAVE_THROTTLE_MS);
    },
    [coedit],
  );

  // CLUSTER-C1: fold whatever the user is CURRENTLY typing (focused, not yet
  // blurred) into the document model, exactly as if they had clicked away.
  // Called before unmount and before export so an in-progress keystroke can
  // never be silently dropped just because the user closed the tab or hit
  // Export instead of clicking elsewhere first. Stable identity (empty deps)
  // via the `handleRunEditRef` indirection, so it's safe to reference from
  // effects registered before `handleRunEdit` itself exists.
  const commitActiveRunEdit = useCallback(
    (): Promise<void> => {
      const active = activeRunRef.current;
      if (!active) return Promise.resolve();
      activeRunRef.current = null;
      const text = active.element.textContent ?? '';
      const result = handleRunEditRef.current(active.blockIndex, active.inlineIndex, text);
      return result instanceof Promise ? result : Promise.resolve();
    },
    [],
  );

  const canEdit = Boolean(filePath) && isDocxEngineAvailable();

  const handlePageClick = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (!canEdit) return;
      const target = event.target as HTMLElement | null;
      if (
        target?.closest(
          '[contenteditable="true"], [contenteditable="false"], button, a, input, textarea, select, [data-testid="docx-raw-block"], [data-testid="docx-raw-inline"], img, table',
        )
      ) {
        return;
      }
      const run = findNearestEditableRun(event.currentTarget, event.clientX, event.clientY);
      if (run) placeCaretAtEnd(run);
    },
    [canEdit],
  );

  // ---- Load the DOM from disk via the engine -----------------------------
  useEffect(() => {
    let cancelled = false;
    if (!canEdit || !filePath) {
      // No engine (browser/test) or no path: read-only fallback.
      setLoad({ status: 'unsupported' });
      return;
    }
    setLoad({ status: 'loading' });

    if (coedit) {
      // CO-EDIT: unchanged from before this cleanup — the CRDT (kept alive by
      // the parent independently of this component) is the source of truth,
      // so a remount here can never lose an edit; it just recomputes the
      // current doc from `coedit.session`. This path does not use
      // docxSaveSession (see the module doc comment for why it doesn't need to).
      writeCoordinator.resetPath(filePath);
      docxOpen(filePath)
        .then((doc) => {
          if (cancelled) return;
          // Capture original comments (CRDT always returns comments: {}).
          originalCommentsRef.current = doc.comments;
          // Use the CRDT's live doc for the initial render, with comments re-attached.
          const liveDoc: DocumentJson = {
            ...coedit.session.getDocumentJson(),
            comments: doc.comments,
          };
          currentDocRef.current = liveDoc;
          setLoad({ status: 'ready', doc: liveDoc });
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
    }

    // SOLO: resume an existing session for this path (a prior view may have
    // unmounted while it was still dirty/failing — see docxSaveSession.ts)
    // instead of unconditionally re-reading disk, so a still-retrying save
    // and its not-yet-persisted doc are never silently dropped by a tab
    // switch away and back.
    openDocxSession(filePath, {
      onFirstEdit: () => onFirstEditRef.current?.(),
      onAfterSave: (info) => onAfterSaveRef.current?.(info),
    })
      .then((session) => {
        // Deliberately NOT disposing here when `cancelled` — see
        // openDocxSession's doc comment (React 18 StrictMode dev
        // setup→cleanup→setup would otherwise race a still-loading session
        // out from under the second, real mount that's about to adopt it).
        // A genuinely abandoned CLEAN session just sits unused until reused
        // or the tab is explicitly closed; it holds no unsaved content.
        if (cancelled) return;
        sessionRef.current = session;
        currentDocRef.current = session.doc;
        setLoad({ status: 'ready', doc: session.doc });
        const snap = session.getSnapshot();
        setIsDirty(snap.isDirty);
        setIsSaving(snap.isSaving);
        setSaveError(snap.saveError);
        setEscalated(snap.escalated);
        setLastSavedAt(snap.lastSavedAt);
        const liveFlushHook = async () => {
          await commitActiveRunEdit();
          await docOpQueueRef.current;
        };
        liveFlushHookRef.current = liveFlushHook;
        session.setLiveFlushHook(liveFlushHook);
        unsubscribeSessionRef.current = session.subscribe(() => {
          const s = session.getSnapshot();
          setIsDirty(s.isDirty);
          setIsSaving(s.isSaving);
          setSaveError(s.saveError);
          setEscalated(s.escalated);
          setLastSavedAt(s.lastSavedAt);
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setLoad({ status: 'error', message });
      });
    return () => {
      cancelled = true;
    };
  }, [canEdit, filePath, coedit, commitActiveRunEdit]);

  useEffect(() => {
    if (load.status !== 'ready') return;
    if (!filePath || pendingDocxFocusPath !== filePath) return;
    const id = requestAnimationFrame(() => {
      const page = pageRef.current;
      const run = page ? findNearestEditableRun(page) : null;
      if (run) placeCaretAtEnd(run);
      setPendingDocxFocusPath(null);
    });
    return () => {
      cancelAnimationFrame(id);
    };
  }, [load.status, filePath, pendingDocxFocusPath, setPendingDocxFocusPath]);

  // ---- QA-81: steady-state periodic autosave of LIVE (un-blurred) typing ---
  // A focused keystroke lives only in the run's contentEditable DOM until the
  // run blurs (the blur is what commits it + schedules a save). Until then the
  // steady-state autosave has nothing scheduled, so a crash/power-loss while
  // actively typing a brand-new .docx silently loses everything typed since
  // focus — even though the toolbar reads "Saved". This interval closes that
  // gap for the SOLO path: every ~2s, if a run is focused with un-persisted
  // text, fold that live DOM text into a clone of the session doc and write it
  // to disk. It deliberately does NOT clear `activeRunRef`, touch
  // `currentDocRef`, re-render the live view, or author a tracked change — so
  // the caret is never disturbed and continued typing stays tracked. The
  // eventual blur authors the proper (tracked-change) commit and supersedes
  // this plain-text shadow on disk. COEDIT is excluded because it has no
  // DocxSession at all — its document is sourced from the CRDT, so this
  // persistLive/session machinery simply doesn't apply. (Co-edit run text is
  // likewise only folded into the CRDT on blur, so it has its OWN un-blurred-
  // typing gap; closing that is a separate, CRDT-native change — deliberately
  // out of scope here to avoid touching the E2EE co-edit path.)
  useEffect(() => {
    if (coedit || !filePath) return;
    const id = setInterval(() => {
      const active = activeRunRef.current;
      const session = sessionRef.current;
      if (!active || !session || session.isDisposed) return;
      const text = active.element.textContent ?? '';
      const next = foldLiveRunTextIntoDoc(
        session.doc,
        active.blockIndex,
        active.inlineIndex,
        text,
      );
      // `null` → nothing new to persist (text unchanged, or the run moved under
      // a concurrent structural edit). `persistLive` routes through the same
      // write-coordinator/rev serialization as every other save of this path,
      // keeps the session dirty until the write lands (so an overlapping older
      // write can't publish a false "Saved"), and skips the version snapshot.
      // It surfaces any failure as the session's own save-error/retry state
      // rather than throwing — the `.catch` is a defensive backstop for that
      // already-handled promise.
      if (next) {
        session.persistLive(next).catch((err: unknown) => {
          console.error('[DocxEditor] live-typing autosave failed:', err);
        });
      }
    }, LIVE_TYPING_AUTOSAVE_MS);
    return () => {
      clearInterval(id);
      // Also drop any pending input-throttled save timer (its work, if any, is
      // handled by the unmount/path-change teardown's own commit + flush).
      if (liveSaveThrottleRef.current) {
        clearTimeout(liveSaveThrottleRef.current);
        liveSaveThrottleRef.current = null;
      }
    };
  }, [coedit, filePath]);

  // ---- Cleanup the debounce on unmount (or filePath/coedit change) -------
  // Codex review catch (P2): deps include `filePath`/`coedit` (not just the
  // stable `commitActiveRunEdit`) so this ALSO runs when a PARENT reuses this
  // same component instance for a DIFFERENT path without remounting it (e.g.
  // MeetingEntry swapping which meeting's notes.docx it shows — no
  // `key={meetingDir}` upstream). Without that, the OLD path's session would
  // keep this view's subscription + live flush hook attached, so its later
  // state changes (or a registry flush) would run against the wrong,
  // now-stale live view. Running the FULL commit+drain+persist+dispose
  // sequence below in both cases (not just true unmount) is deliberate: the
  // component's rendered DOM still reflects the OLD path at the moment this
  // cleanup runs (state — not the `filePath` prop — drives what's shown, and
  // state only changes once the new path's async load resolves), so reading
  // the live DOM for an in-progress edit here is exactly as safe as at a true
  // unmount.
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

      if (coedit) {
        // COEDIT: unchanged — the CRDT (kept alive by the parent
        // independently of this component) is the source of truth, so a
        // remount/path-change here can never lose an edit; the rich
        // fold-in pipeline is safe to use as-is (no outgoing-session race
        // to worry about — see docxSaveSession.ts's module doc comment).
        commitActiveRunEdit()
          .then(() => docOpQueueRef.current)
          .then(flushScheduledSave)
          .catch((err: unknown) => {
            console.error('[DocxEditor] commitActiveRunEdit on unmount failed:', err);
          });
        return;
      }

      // SOLO (cleanup batch 4 / QA-34 keep-alive + Codex review catches, 4
      // rounds): capture EVERYTHING this cleanup needs SYNCHRONOUSLY, right
      // here at the top — before any `await` below, and before React runs
      // this same effect's new setup (which only happens AFTER every
      // changed effect's cleanup has run). This cleanup's own async
      // continuation can still be in flight when a filePath change's NEW
      // load effect finishes and reassigns `sessionRef.current`/
      // `unsubscribeSessionRef.current` to the NEW session — a fresh
      // `docxOpen` can resolve in a single microtask, so there's no
      // ordering guarantee against anything read here after an await.
      // Re-reading those refs later would silently operate on the WRONG
      // session: detaching/disposing the NEW one (which the new view just
      // started watching) instead of the OLD one actually being torn down
      // here, or persisting through the old session's write path.
      const outgoingSession = sessionRef.current;
      const outgoingUnsubscribe = unsubscribeSessionRef.current;
      // Codex review catch (post-merge, P2): captured for the SAME reason —
      // if this view unmounts while it still has a queued op pending (e.g. a
      // blur's tracked-changes op still awaiting the engine) and the SAME
      // path is reopened before this teardown resumes, a NEWER view can
      // reuse `outgoingSession` and install its OWN live flush hook before
      // this delayed code below ever runs. See
      // DocxSession.clearLiveFlushHookIfCurrent's doc comment for the full
      // story and why this must be checked, not just nulled unconditionally.
      const outgoingLiveFlushHook = liveFlushHookRef.current;
      // A FOCUSED, un-blurred run CAN survive into a filePath change — not
      // every transition is a mouse click elsewhere (which blurs it
      // synchronously first); a keyboard shortcut or a programmatic
      // navigation might not. Capture (and clear) it synchronously too,
      // mirroring what `commitActiveRunEdit` itself does, so nothing else
      // tries to process it again.
      const activeRunAtCleanup = activeRunRef.current;
      activeRunRef.current = null;
      // Fold it in via a MINIMAL, self-contained merge directly against the
      // captured session's own doc — see commitOutgoingRunEditIfAny's doc
      // comment for why the full handleRunEdit/applyResolvedDocument
      // pipeline (which reads/writes the SHARED `currentDocRef` and the
      // live view) is unsafe to reuse here: by the time any of that
      // resolves, `currentDocRef.current` may already belong to the NEWLY-
      // loaded document.
      commitOutgoingRunEditIfAny(activeRunAtCleanup, outgoingSession);

      // CLUSTER-C1: separately, wait for the ENTIRE op queue to drain before
      // flushing whatever that produced — if a run blurred JUST before this
      // cleanup (via the plain `onRunEdit` callback, unrelated to
      // `activeRunAtCleanup` above), it already enqueued a tracked-changes
      // op via `handleRunEdit` that hasn't run yet. Read synchronously HERE
      // (not after an await) captures exactly what's already enqueued as of
      // this instant — nothing more, since nothing else can run between two
      // of this cleanup's own synchronous statements.
      //
      // Residual (documented, not fixed): that already-queued op still
      // reads `currentDocRef.current`/saves via `sessionRef.current` when it
      // actually runs (whichever a racing new-path load has set them to by
      // then) — it captured no override when `onRunEdit` created it, and
      // retroactively targeting it would require knowing at ENQUEUE time
      // that a path change might follow. This compound trigger (a blur's op
      // still in flight AND a filePath change racing it AND the new
      // session/doc loading faster) is narrow enough, and partially
      // mitigated by `handleRunEdit`'s own drift guard (which refuses to
      // apply an edit whose target run no longer matches), to accept as a
      // known limitation.
      const queuedOpsAtCleanup = docOpQueueRef.current;
      queuedOpsAtCleanup
        .then(() => {
          // SOLO (cleanup batch 4 / QA-34 keep-alive): detach this view from
          // the CAPTURED outgoing session and hand it its own truly-latest
          // doc, then let the session itself decide whether it's safe to
          // dispose. If a save is still dirty/failing, `disposeIfClean`
          // refuses — the session's own retry timers (plain setTimeout, not
          // tied to this component) keep running in the background, and a
          // later remount of this same path resumes the SAME session instead
          // of reloading stale disk content over the unsaved edit. This is
          // the fix for the residual race: a tab switch away from a failing
          // save no longer kills its retry loop or drops the not-yet-
          // persisted document.
          const session = outgoingSession;
          // A session already force-disposed (the user explicitly discarded
          // it — e.g. via closeDocxTabSafely — while this view was still
          // mounted) must be left alone: acting on it here would resurrect a
          // save attempt for content the user already asked to abandon.
          if (!session || session.isDisposed) return;
          // Only touch the shared refs if they STILL point at the session
          // we're tearing down — a filePath change's new load effect may
          // have already moved them on to a newer session (see the capture
          // comment above), in which case those belong to the NEW view now
          // and must not be disturbed.
          if (sessionRef.current === session) {
            sessionRef.current = null;
          }
          // Call the CAPTURED outgoing unsubscribe, not whatever
          // `unsubscribeSessionRef.current` holds now — a filePath change's
          // new load effect may have already overwritten it with the NEW
          // session's unsubscribe function, and calling that here would
          // detach the new view's live subscription instead of the old one's.
          outgoingUnsubscribe?.();
          if (unsubscribeSessionRef.current === outgoingUnsubscribe) {
            unsubscribeSessionRef.current = null;
          }
          // Codex review catch (post-merge, P2): if a NEWER view has already
          // reused this session and installed its OWN live flush hook (this
          // teardown was delayed behind a queued op — see the capture
          // comment above), `clearLiveFlushHookIfCurrent` returns `false`
          // instead of stripping it. In that case stop here entirely — do
          // NOT persist/dispose either: the new view now owns this session's
          // whole lifecycle, and forcing a save or (worse) disposing it out
          // from under an actively-attached view would be just as wrong as
          // stripping its hook.
          if (!session.clearLiveFlushHookIfCurrent(outgoingLiveFlushHook)) return;
          // QA-81 (P2): if a shadow save already mirrored the focused run's live
          // text into `session.doc`, `commitOutgoingRunEditIfAny` above saw no
          // diff and did nothing — so without this the session looks "clean" and
          // gets disposed WITHOUT recording the finished edit in version history.
          // This promotes that un-snapshotted live content to a committed
          // checkpoint (dirty + snapshot-worthy) so the persistNow below saves +
          // snapshots it. No-op when there's no such debt.
          session.ensureLeavingSnapshot();
          // Read the doc off the CAPTURED session itself (kept current by
          // every scheduleSave call against it, including
          // commitOutgoingRunEditIfAny's above), not `currentDocRef.current`
          // — that ref may already reflect a newer path's document.
          const doc = session.doc;
          // Only force a save when there's actually something unsaved — a
          // clean doc has nothing to flush (mirrors the coedit branch's
          // `flushScheduledSave`, which is also a no-op with no pending timer).
          const settled = session.isDirty ? session.persistNow(doc) : Promise.resolve();
          return settled.then(() => {
            session.disposeIfClean();
          });
        })
        .catch((err: unknown) => {
          console.error('[DocxEditor] op queue drain on unmount failed:', err);
        });
    };
  }, [commitActiveRunEdit, coedit, filePath]);

  // ---- Persist (debounced) ----------------------------------------------
  const clearRetryTimer = useCallback(() => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, []);

  // QA-34: schedule the next automatic retry with exponential backoff. Retries
  // the LATEST document (the user may have kept typing while the file was locked),
  // so when the lock clears everything typed since is persisted, not a stale copy.
  const scheduleRetry = useCallback(() => {
    clearRetryTimer();
    // Don't keep retrying against an unmounted editor (closed tab / switched
    // workspace) — the registry's final flush already gave it a last save chance.
    if (!mountedRef.current) return;
    const delay = retryDelayRef.current;
    retryDelayRef.current = Math.min(delay * 2, RETRY_MAX_MS);
    retryTimerRef.current = setTimeout(() => {
      retryTimerRef.current = null;
      if (!mountedRef.current) return;
      const doc = currentDocRef.current;
      if (doc) void persistRef.current?.(doc);
    }, delay);
  }, [clearRetryTimer]);

  // ONE save attempt of `doc`. Updates the truthful save state (Saved / error)
  // but does NOT schedule retries — the caller decides. Returns whether the
  // document is now safely on disk. Never throws.
  const attemptSave = useCallback(
    async (doc: DocumentJson): Promise<boolean> => {
      if (!filePath) return false;
      setIsSaving(true);
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
        // Success — the write landed. Reset all failure/escalation bookkeeping so
        // the indicator returns to a truthful "Saved" and any warning clears.
        setLastSavedAt(Date.now());
        setIsDirty(false);
        setSaveError(null);
        setEscalated(false);
        consecutiveFailuresRef.current = 0;
        retryDelayRef.current = RETRY_BASE_MS;
        clearRetryTimer();
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
        return true;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // The write FAILED: keep the doc dirty (it is NOT on disk) and surface the
        // error truthfully. Never let a failed write read as "Saved".
        setSaveError(message);
        setIsDirty(true);
        console.error('[DocxEditor] save failed:', err);
        return false;
      } finally {
        setIsSaving(false);
      }
    },
    [filePath, onFirstEdit, clearRetryTimer],
  );

  // The debounced/normal save path: attempt once, and on failure keep the doc
  // safe by retrying with backoff and — after sustained failure — escalating to a
  // visible warning the user can act on. A fresh edit or retry supersedes any
  // pending retry (clearRetryTimer at the top).
  const persist = useCallback(
    async (doc: DocumentJson) => {
      if (!filePath) return;
      clearRetryTimer();
      const ok = await attemptSave(doc);
      if (!ok) {
        consecutiveFailuresRef.current += 1;
        if (consecutiveFailuresRef.current >= ESCALATE_AFTER_FAILURES) {
          setEscalated(true);
        }
        scheduleRetry();
      }
    },
    [filePath, attemptSave, clearRetryTimer, scheduleRetry],
  );
  useEffect(() => {
    persistRef.current = persist;
  }, [persist]);
  useEffect(() => {
    attemptSaveRef.current = attemptSave;
  }, [attemptSave]);
  // Track mounted state so the retry loop stops after teardown (see
  // scheduleRetry). MUST set true in SETUP, not only false in cleanup: React 18
  // StrictMode runs setup→cleanup→setup in dev, so a cleanup-only effect would
  // flip mountedRef to false on the first dev remount and never restore it —
  // silently disabling all .docx save retries in dev/QA. Setting it true here on
  // (re)mount keeps retries alive.
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const scheduleSave = useCallback(
    (doc: DocumentJson) => {
      if (coedit) {
        setIsDirty(true);
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        // Capture a flush for the LATEST doc so an unmount before the debounce
        // fires can still persist it (data-loss guard).
        flushPendingSaveRef.current = () => { void persist(doc); };
        saveTimerRef.current = setTimeout(() => {
          flushPendingSaveRef.current = null;
          void persist(doc);
        }, SAVE_DEBOUNCE_MS);
        return;
      }
      // SOLO: the session owns the debounce/retry loop so it survives a tab
      // switch away (see docxSaveSession.ts). This view's isDirty/etc mirror
      // the session's state via the subscription set up in the load effect.
      sessionRef.current?.scheduleSave(doc, SAVE_DEBOUNCE_MS);
    },
    [coedit, persist],
  );

  // QA-34: clear any pending retry timer on unmount so a backoff callback never
  // fires against a torn-down editor. Only meaningful for the coedit path —
  // the solo path's retry timer lives on the session, not this component.
  useEffect(() => clearRetryTimer, [clearRetryTimer]);

  // QA-34: register this editor with the shared save registry so the close/quit/
  // switch guards can see its unsaved/failing state and force a final save. The
  // registered flush attempts ONE immediate save of the latest doc and reports
  // whether it is now safely on disk (true = safe to close/switch/quit).
  //
  // COEDIT ONLY: the solo path's registration is owned by its DocxSession
  // (created once per path, outliving any single mounted view) instead — see
  // docxSaveSession.ts — so registering it here too would fight over which
  // flush callback the registry uses, and would unregister on every unmount
  // even while the session is still dirty/retrying in the background.
  useEffect(() => {
    if (!filePath || !coedit) return;
    // Register ONCE per path (deps: [filePath, coedit] only). The flush calls
    // the LATEST attemptSave through a ref, so a parent re-render that
    // changes attemptSave's identity does NOT re-register — which would
    // otherwise churn (and risk clearing) this path's live save state in the
    // registry.
    return registerDocxSaver(filePath, async () => {
      // Fold any focused, un-blurred keystrokes into the model and drain queued
      // ops FIRST (mirrors the export flush) — otherwise the newest typed text is
      // still only in the contentEditable DOM and we'd decide "clean" / save a doc
      // missing those characters. Must run while the editor is still mounted,
      // which it is: closeDocxTabSafely awaits this flush BEFORE removing the tab.
      await commitActiveRunEdit();
      await docOpQueueRef.current;
      const doc = currentDocRef.current;
      if (!doc) return true;
      // "Clean" for flush purposes means: not dirty, no error, AND no debounced
      // save still pending. The last clause matters — a save can complete and
      // clear `isDirty` while a NEWER edit's debounce is still queued
      // (`flushPendingSaveRef` set); without it, a close/switch/quit in that
      // window would skip persisting the newer edit and silently drop it.
      if (
        !isDirtyRef.current &&
        saveErrorRef.current === null &&
        flushPendingSaveRef.current === null
      ) {
        return true;
      }
      return (await attemptSaveRef.current?.(doc)) ?? false;
    });
  }, [filePath, coedit, commitActiveRunEdit]);

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
    // Persist synchronously so the on-disk bytes are current for the engine.
    if (coedit) {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      await persist(doc);
    } else {
      await sessionRef.current?.persistNow(doc);
    }
    return true;
  }, [filePath, persist, commitActiveRunEdit, coedit]);

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

  // QA-34 escape hatch: when the original file can't be saved (a stubborn lock,
  // a read-only location), let the user rescue their work to a DIFFERENT path
  // they choose. Writes the LATEST in-memory document to the picked location.
  // The original stays dirty and keeps retrying — this is a safety copy, not a
  // "save as" that abandons the original.
  const handleSaveCopyElsewhere = useCallback(async () => {
    if (savingCopy) return;
    setSavingCopy(true);
    setExportNotice(null);
    try {
      // Fold any focused, un-blurred keystrokes into the model and drain queued
      // ops BEFORE reading the doc (mirrors flushSaveBeforeExport). The rescue
      // copy is the one that must never omit the user's newest text, so read
      // currentDocRef only AFTER the commit + drain land.
      await commitActiveRunEdit();
      await docOpQueueRef.current;
      const doc = currentDocRef.current;
      if (!doc) return;
      const dest = await pickSavePath(`${exportStem} (rescued copy).docx`, 'docx');
      if (!dest) return; // user cancelled
      await docxSave(dest, doc);
      setExportNotice({
        kind: 'success',
        message: t('media.docx-editor.save-copy-success', { path: dest }),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setExportNotice({
        kind: 'error',
        message: t('media.docx-editor.save-copy-failed', { message }),
      });
      console.error('[DocxEditor] save-a-copy failed:', err);
    } finally {
      setSavingCopy(false);
    }
  }, [savingCopy, pickSavePath, exportStem, t, commitActiveRunEdit]);

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

  const auditFileExport = useCallback(
    async (
      phase: 'intent' | 'outcome',
      auditPairId: string,
      format: 'docx' | 'pdf',
      destinationPath: string | null,
      outputs: Record<string, unknown> = {},
    ) => {
      await mustLogAuditPhase(
        onAuditLog,
        {
          action: 'file_export',
          description: `Exported file as ${format.toUpperCase()}: ${fileName}`,
          model: undefined,
          inputs: {
            sourcePath: filePath,
            sourceName: fileName,
            format,
            destinationPath,
          },
          outputs,
          userDecision: 'approved',
          metadata: { auditEventType: 'file_export', format },
        },
        phase,
        auditPairId,
      );
    },
    [fileName, filePath, onAuditLog],
  );

  const handleExportWord = useCallback(() => {
    void runExport(async (srcPath) => {
      const dest = await pickSavePath(`${exportStem}.docx`, 'docx');
      if (!dest) return null;
      const auditPairId = createAuditPairId('file_export');
      await auditFileExport('intent', auditPairId, 'docx', dest);
      await docxExportCopy(srcPath, dest);
      await auditFileExport('outcome', auditPairId, 'docx', dest, { success: true });
      return t('media.docx-editor.export-saved-word');
    });
  }, [runExport, pickSavePath, exportStem, auditFileExport, t]);

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
      const auditPairId = createAuditPairId('file_export');
      await auditFileExport('intent', auditPairId, 'pdf', null);
      // Convert the saved .docx to PDF (LibreOffice) -> temp path, then let the
      // user choose where to save the PDF (read bytes, write via saveFile).
      const pdfPath = await docxConvertToPdf(srcPath);
      const bytes = await readTauriFile(pdfPath);
      const { saveFile } = await import('@/platform/utils/saveFile');
      const saved = await saveFile(bytes, {
        suggestedName: `${exportStem}.pdf`,
        types: [{ description: 'PDF', accept: { 'application/pdf': ['.pdf'] } }],
      });
      // In Tauri, `saved` is the path (undefined => cancelled).
      if (saved === undefined) return null;
      await auditFileExport('outcome', auditPairId, 'pdf', saved, {
        success: true,
        byteSize: bytes.byteLength,
      });
      return t('media.docx-editor.export-saved-pdf');
    });
  }, [runExport, exportStem, auditFileExport, t]);

  const handleExportCleanCopy = useCallback(
    (acceptAllChanges: boolean) => {
      void runExport(async (srcPath) => {
        const dest = await pickSavePath(
          `${exportStem}${acceptAllChanges ? '-final' : '-clean'}.docx`,
          'docx',
        );
        if (!dest) return null;
        const auditPairId = createAuditPairId('file_export');
        await auditFileExport('intent', auditPairId, 'docx', dest, {
          cleanCopy: true,
          acceptAllChanges,
        });
        await docxExportCleanCopy(srcPath, dest, acceptAllChanges);
        await auditFileExport('outcome', auditPairId, 'docx', dest, {
          success: true,
          cleanCopy: true,
          acceptAllChanges,
        });
        return acceptAllChanges
          ? t('media.docx-editor.export-saved-clean-final')
          : t('media.docx-editor.export-saved-clean');
      });
    },
    [runExport, pickSavePath, exportStem, auditFileExport, t],
  );

  const runDraftFollowUp = useCallback(() => {
    if (!onDraftFollowUp || outboundBlocked) return;
    void (async () => {
      await commitActiveRunEdit();
      await docOpQueueRef.current;
      const doc = currentDocRef.current;
      if (!doc) return;
      const text = extractIndexedParagraphs(doc)
        .map(p => p.text)
        .join('\n');
      onDraftFollowUp(text);
    })().catch((err: unknown) => {
      console.error('[DocxEditor] draft follow-up failed:', err);
    });
  }, [commitActiveRunEdit, onDraftFollowUp, outboundBlocked]);

  const runSendToWealthbox = useCallback(() => {
    if (!onSendToWealthbox || !wealthboxConnected || outboundBlocked) return;
    void (async () => {
      await commitActiveRunEdit();
      await docOpQueueRef.current;
      const doc = currentDocRef.current;
      if (!doc) return;
      const text = extractIndexedParagraphs(doc)
        .map(p => p.text)
        .join('\n');
      if (onSendToWealthbox(text)) {
        setWealthboxQueued(true);
        setTimeout(() => { setWealthboxQueued(false); }, 2500);
      }
    })().catch((err: unknown) => {
      console.error('[DocxEditor] send to Wealthbox failed:', err);
    });
  }, [commitActiveRunEdit, onSendToWealthbox, outboundBlocked, wealthboxConnected]);

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
      const selection = readSelectionOperationDecision({
        operationClass: 'matter-scoped',
        allowAllMatters: true,
        requireFollowerAgreement: true,
      });
      if (selection.kind === 'refused') throw new Error(selection.message);
      const expectedSelection = expectedScopeFromDecision(selection);
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
          scope: selection.kind === 'matter'
            ? { kind: 'matter', matterId: selection.matter.id }
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
        const currentSelection = readSelectionOperationDecision({
          operationClass: 'matter-scoped',
          allowAllMatters: true,
          requireFollowerAgreement: true,
          expectedScope: expectedSelection,
        });
        if (currentSelection.kind === 'refused') throw new Error(currentSelection.message);
        const doc = currentDocRef.current;
        if (!doc) throw new Error('Document is no longer open.');
        const outcome = await docxAuthorRevisions(doc, edits, { author: REDLINE_AUTHOR });
        // WS-A / A5: attribute the resulting version snapshot to the AI. Set
        // on both — only one is ever consulted at save time (coedit reads the
        // ref; solo reads the session), so it's harmless to set both.
        pendingSaveAuthorRef.current = 'ai';
        sessionRef.current?.setPendingAuthor('ai');
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
      {/* Clean document header: identity, actions menu, save state, review controls. */}
      <div
        data-testid="docx-editor-topbar"
        className="flex min-h-[44px] items-center gap-3 border-b bg-background px-3 py-2"
      >
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <FileType className="h-4 w-4 shrink-0 text-blue-600" />
          {isRenaming ? (
            <input
              ref={renameInputRef}
              type="text"
              value={renameDraft}
              onChange={(e) => { setRenameDraft(e.target.value); }}
              onBlur={(e) => { void submitRename(e.currentTarget.value); }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  void submitRename(e.currentTarget.value);
                } else if (e.key === 'Escape') {
                  setIsRenaming(false);
                  const dot = fileName.lastIndexOf('.');
                  setRenameDraft(dot > 0 ? fileName.slice(0, dot) : fileName);
                }
              }}
              className="min-w-0 max-w-[360px] rounded border bg-background px-1.5 py-0.5 text-sm font-medium"
              size={Math.max(renameDraft.length + 1, 8)}
            />
          ) : (
            <h2 className="min-w-0 truncate text-sm font-medium text-foreground/85">
              {fileName}
            </h2>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                data-testid="docx-export"
                variant="ghost"
                size="sm"
                className="h-7 w-7 shrink-0 p-0"
                title={t('media.docx-editor.document-actions')}
                aria-label={t('media.docx-editor.document-actions')}
              >
                <span data-testid="docx-document-actions-menu" className="flex h-full w-full items-center justify-center">
                  <MoreVertical className="h-4 w-4" />
                </span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="w-64"
              onCloseAutoFocus={(event) => {
                if (!openRenameAfterActionsMenuRef.current) return;
                openRenameAfterActionsMenuRef.current = false;
                event.preventDefault();
                setIsRenaming(true);
              }}
            >
              {onRenameFile && (
                <DropdownMenuItem
                  data-testid="docx-rename-file"
                  onSelect={startRenaming}
                >
                  <Pencil className="mr-2 h-4 w-4" />
                  {t('media.docx-editor.rename-file')}
                </DropdownMenuItem>
              )}
              {onRenameFile && (
                <DropdownMenuSeparator />
              )}
              {onDownload && (
                <DropdownMenuItem data-testid="toolbar-download" onSelect={onDownload}>
                  <Download className="mr-2 h-4 w-4" />
                  {t('media.docx-editor.download')}
                </DropdownMenuItem>
              )}
              {onToggleHistory && (
                <DropdownMenuItem data-testid="toolbar-history" onSelect={onToggleHistory}>
                  <History className="mr-2 h-4 w-4" />
                  {versionHistoryLabel ?? t('media.docx-editor.history')}
                </DropdownMenuItem>
              )}
              {onSplitHorizontal && (
                <DropdownMenuItem data-testid="toolbar-overflow-split-h" onSelect={onSplitHorizontal}>
                  <Columns className="mr-2 h-4 w-4" />
                  {t('media.docx-editor.split-horizontally')}
                </DropdownMenuItem>
              )}
              {onSplitVertical && (
                <DropdownMenuItem data-testid="toolbar-overflow-split-v" onSelect={onSplitVertical}>
                  <Rows className="mr-2 h-4 w-4" />
                  {t('media.docx-editor.split-vertically')}
                </DropdownMenuItem>
              )}
              {onToggleOutline && (
                <DropdownMenuItem data-testid="toolbar-overflow-outline" onSelect={onToggleOutline}>
                  <List className="mr-2 h-4 w-4" />
                  {t('media.docx-editor.toggle-outline')}
                </DropdownMenuItem>
              )}
              {(onDownload || onToggleHistory || onSplitHorizontal || onSplitVertical || onToggleOutline) && (
                <DropdownMenuSeparator />
              )}
              {onDraftFollowUp && (
                <DropdownMenuItem
                  data-testid="docx-draft-follow-up"
                  disabled={outboundBlocked}
                  title={outboundBlockedReason ?? t('media.docx-editor.draft-follow-up-title')}
                  onSelect={runDraftFollowUp}
                >
                  <Mail className="mr-2 h-4 w-4" />
                  {t('media.docx-editor.draft-follow-up')}
                </DropdownMenuItem>
              )}
              {onSendToWealthbox && (
                <DropdownMenuItem
                  data-testid="docx-send-to-wealthbox"
                  disabled={!wealthboxConnected || outboundBlocked}
                  title={
                    outboundBlockedReason ??
                    (wealthboxConnected
                      ? t('matter.notes.send-to-wealthbox')
                      : t('media.docx-editor.send-to-wealthbox-disconnected'))
                  }
                  onSelect={runSendToWealthbox}
                >
                  <Send className="mr-2 h-4 w-4" />
                  {t('matter.notes.send-to-wealthbox')}
                </DropdownMenuItem>
              )}
              {(onDraftFollowUp || onSendToWealthbox) && (
                <DropdownMenuSeparator />
              )}
              <DropdownMenuLabel>
                {t('media.docx-editor.export-as')}
              </DropdownMenuLabel>
              <DropdownMenuItem
                data-testid="docx-export-word"
                onSelect={handleExportWord}
                disabled={exportBusy || !canEdit}
              >
                {exportBusy ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <FileType className="mr-2 h-4 w-4 text-blue-600" />
                )}
                {t('media.docx-editor.export-word')}
              </DropdownMenuItem>
              <DropdownMenuItem
                data-testid="docx-export-pdf"
                onSelect={handleExportPdf}
                disabled={exportBusy || !canEdit}
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
                disabled={exportBusy || !canEdit}
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
                disabled={exportBusy || !canEdit}
              >
                <ShieldCheck className="mr-2 h-4 w-4 text-emerald-700" />
                <span className="flex flex-col">
                  <span>{t('media.docx-editor.export-clean-final')}</span>
                  <span className="text-[10px] text-muted-foreground">
                    {t('media.docx-editor.export-clean-final-hint')}
                  </span>
                </span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                data-testid="docx-revise-with-ai"
                disabled={redlineBusy}
                title={
                  redlineReady
                    ? t('media.docx-editor.revise-with-ai')
                    : t('media.docx-editor.redline-need-key')
                }
                onSelect={() => {
                  setRedlineOpen((v) => !v);
                  setRedlineError(null);
                }}
              >
                {redlineBusy ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Wand2 className="mr-2 h-4 w-4" />
                )}
                {t('media.docx-editor.revise-with-ai')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {/* T11: ephemeral presence indicator, shown only in co-edit mode. */}
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

          {wealthboxQueued && (
            <span className="flex items-center gap-1.5 text-xs text-emerald-700">
              <span data-testid="docx-send-to-wealthbox-confirmation">
                {t('matter.notes.sent-to-wealthbox')}
              </span>
              {onReviewWealthboxQueue && (
                <button
                  type="button"
                  data-testid="docx-send-to-wealthbox-review-now"
                  onClick={onReviewWealthboxQueue}
                  className="font-medium underline underline-offset-2 hover:text-emerald-800"
                >
                  {t('matter.notes.review-now')}
                </button>
              )}
            </span>
          )}

          {outboundBlocked && (onDraftFollowUp || onSendToWealthbox) && (
            <span
              data-testid="docx-outbound-blocked"
              className="text-xs text-[var(--color-muted-foreground)]"
            >
              {outboundBlockedReason}
            </span>
          )}

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
      {/* QA-34 (P0): sustained save failure. A prominent, NON-timeout-dismissable
          warning — it stays until a save actually succeeds. The user's typing is
          held safely in memory and auto-retried in the background; the escape
          hatch writes a rescue copy to a location they pick. */}
      {escalated && (
        <div
          data-testid="docx-save-escalation"
          role="alert"
          className="flex items-start gap-2 border-b border-red-200 bg-red-50 px-3 py-2 text-xs text-red-900"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
          <div className="mx-auto flex max-w-[816px] flex-1 flex-col gap-1.5">
            <p className="font-medium">{t('media.docx-editor.save-blocked-title')}</p>
            <p>{t('media.docx-editor.save-blocked-body')}</p>
            <div className="mt-0.5 flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-6 border-red-300 bg-white px-2 text-[11px] text-red-800 hover:bg-red-100 hover:text-red-900"
                data-testid="docx-save-retry-now"
                onClick={() => {
                  const doc = currentDocRef.current;
                  if (doc) void persist(doc);
                }}
              >
                {t('media.docx-editor.save-retry-now')}
              </Button>
              <Button
                type="button"
                size="sm"
                className="h-6 px-2 text-[11px]"
                data-testid="docx-save-copy-elsewhere"
                disabled={savingCopy}
                onClick={() => void handleSaveCopyElsewhere()}
              >
                {savingCopy
                  ? t('media.docx-editor.save-copy-saving')
                  : t('media.docx-editor.save-copy-elsewhere')}
              </Button>
            </div>
          </div>
        </div>
      )}

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
            ref={pageRef}
            data-testid="docx-page"
            className="mx-auto max-w-[816px] rounded-sm bg-white px-[96px] py-[72px] shadow-sm ring-1 ring-black/5"
            onClick={handlePageClick}
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
              onActiveRunInput={onActiveRunInput}
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
