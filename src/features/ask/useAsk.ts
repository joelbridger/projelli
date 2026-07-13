/**
 * useAsk — the logic layer for Ask (state, refs, the seven effects, the
 * recent-sessions derivations, and the RAG → provider → citation-parse `handleAsk`
 * orchestrator). Extracted VERBATIM from Ask.tsx so the component is a
 * pure render over this hook's return. See Ask.tsx for the surface-level
 * documentation (scope toggle, citation-first design, chatId convention).
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { flushSync } from 'react-dom';
import {
  useActiveMatter,
  SAMPLE_MATTER_ID,
} from '@/platform/matter/matterStore';
import { useWorkspaceStore } from '@/platform/fs/workspaceStore';
import { matterLabel } from '@/platform/rag/matterResolver';
import {
  getDemoAnswerForWorkspace,
  getDemoQuestions,
  WEB_DEMO_ADVISOR_QUESTIONS,
} from '@/platform/matter/samples/sampleMatterDemo';
import { useProfessionStore } from '@/platform/profile/professionStore';
import { useSettingsStore } from '@/platform/settings/settingsStore';
import { MemoryService, isMemoryEnabled } from '@/platform/rag/MemoryService';
import {
  DEFAULT_WORKSPACE_TOP_K,
  buildWorkspaceContextBlock,
} from '@/platform/rag/workspaceCommand';
import type { RagHit, RetrievalScope } from '@/platform/utils/tauri-commands';
import {
  localLlmSidecarHealth,
  localLlmSidecarStart,
} from '@/platform/utils/tauri-commands';
import {
  useAIChatStore,
  useFileAccessConsent,
  getFileAccessConsent,
} from '@/platform/state/aiChatStore';
import type { ChatMessage, WorkspaceSource } from '@/platform/types/ai';
import type { AuditScope } from '@/platform/types/audit';
import { auditEventToEntry } from '@/platform/audit/AuditService';
import { sourceIdentitiesFromSources } from '@/platform/audit/sourceCapture';
import {
  createAuditPairId,
  mustLogAuditPhase,
  type AuditEntryInput,
  type AuditLogSink,
} from '@/platform/audit/durableAudit';
import {
  resolveEgress,
  isLocalProvider,
  type ConfidentialityMode,
  type EgressInfo,
} from '@/platform/privacy/egress';
import { sendPreparedMessageWithEgressAudit, sendPreparedStreamingWithEgressAudit } from '@/platform/privacy/promptPreparation';
import {
  fileToolsAllowed,
  resolveWorkspaceRetrieval,
  type ConsentScope,
} from '@/platform/ai/fileAccessConsent';
import { IS_DEMO } from '@/web-demo/demoModeFlag';
import { hasDemoByokKey } from '@/web-demo/demoAIProvider';
import {
  getConfidentialityMode,
  useConfidentialityMode,
} from '@/platform/hooks/useConfidentialityMode';
import {
  assertLocalOnlyAllowsSend,
  isConfidentialityChoiceRequiredError,
  isLocalOnlyMode,
} from '@/platform/privacy/localOnlyGuard';
import type {
  AnswerBlock,
  AnswerCitation,
  AskFailureStage,
  AskScope,
  AskTurn,
} from './askHelpers';
import {
  ASK_CANCELLED_BY_NAVIGATION_MESSAGE,
  NO_EVIDENCE_DECLINE,
  STILL_IMPORTING_DECLINE,
  buildAskSystemPrompt,
  buildSmartAskSystemPrompt,
  scopeHintForMatter,
} from './askPrompt';
import {
  useStillImporting,
  isImportStatusUnsettled,
} from './useStillImporting';
import { retrieveCrmAskHits } from '@/features/crm-ask/retrieval';
import {
  trimForLocalContext,
  LOCAL_CONTEXT_TOO_LONG_MESSAGE,
} from './localContextTrim';
import { LANTERN_LOCAL_CONTEXT_WINDOW } from '@/platform/providers/AppLocalProvider';
import { bindAnswerBlocks } from './answerBlockHelpers';
import {
  withAskTimeout,
  ASK_RETRIEVAL_TIMEOUT_MS,
  ASK_ANSWER_TIMEOUT_MS,
  ASK_ANSWER_STALL_ERROR_MESSAGE,
  AskTimeoutError,
  createAnswerStallWatchdog,
  computeAnswerFirstTokenBudgetMs,
  isAskTimeoutError,
  waitForLocalAiSidecarReady,
} from './askTimeout';
import { estimateTokens } from './compression';
import { DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS } from '@/platform/providers/requestControl';
import {
  hasCloudKey,
  buildResolvedAskProvider,
  resolveLocalOnlyAskProvider,
  resolveActiveAskProviderId,
  askConsentScope,
  defaultAskScope,
  normalizeVisibleAskScope,
  resolveEmailCitationLabels,
  friendlyErrorMessage,
  CLOUD_FILE_ACCESS_REQUIRED_MESSAGE,
  isAuthRejectionError,
  buildHistoryBlock,
  reconstructTurns,
  filterHitsByScope,
  bindAnswerCitations,
  selectHistoryTurns,
  deriveTurnGrounding,
  buildRecentAskSessions,
  dedupeRecognizedHits,
  recognizeHit,
} from './askHelpers';
import {
  markKeyInvalid,
  markKeyVerified,
  isVerifiableProvider,
} from '@/platform/providers/keyVerification';
import { useConfirmDialog } from '@/platform/hooks/useConfirmDialog';
import {
  isExternalExportConsentGiven,
  grantExternalExportConsent,
} from '@/platform/rag/exportConsent';
import { SK_ASK_RAIL_COLLAPSED, SK_ASK_FILES_ONLY } from '@/config/identity';
import { brandText } from '@/config/brandText';

/** localStorage key for the conversations-rail collapsed preference. */
const ASK_RAIL_COLLAPSED_KEY = SK_ASK_RAIL_COLLAPSED;

/**
 * localStorage key for the Files-only mode lock (Decision 6). OFF by default —
 * Ask is the smart, source-aware advisor agent out of the box. When ON, Ask
 * reverts to the strict files-only behaviour (only answers from the user's
 * files, cited, declines when nothing is found) — the one-tap answer to a
 * compliance team that wants the general/drafting capability turned off
 * entirely. Persisted so the choice survives reloads.
 */
const ASK_FILES_ONLY_KEY = SK_ASK_FILES_ONLY;

/** How many prior exchanges are placed in the prompt's history block. The SAME
 *  window bounds transitive grounding, so a turn outside it can't mark the answer
 *  file-derived (Codex final review P2). */
const HISTORY_WINDOW = 6;

/**
 * F2.5b — the chatId for an Ask conversation, bound to the WORKSPACE ROOT so its
 * session (turns) AND its per-conversation file-access consent are workspace-
 * specific. Without this, `ask-global` (and, if matter ids ever collided, a
 * matter chat) is shared across workspaces, so a grant + prior client facts
 * could carry from workspace A into workspace B — a cross-workspace confidentiality
 * leak (Codex rounds 8-9). Root-scoping every id makes opening/switching a
 * workspace yield a FRESH conversation that re-asks and carries no other
 * workspace's turns, while a grant for a given workspace still persists per
 * workspace. No workspace open → the un-suffixed id (nothing to scope).
 */
export function askChatId(
  matterId: string | null | undefined,
  rootPath: string | null | undefined
): string {
  const base = matterId ? `ask-${matterId}` : 'ask-global';
  return rootPath ? `${base}::${rootPath}` : base;
}

/** Join tool labels for prose: ["RightCapital"] -> "RightCapital";
 *  ["RightCapital","Jump"] -> "RightCapital and Jump". */
function formatToolList(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1] ?? ''}`;
}

export interface UseAskProps {
  onSaveToDocument?: (content: string) => Promise<void>;
  /** When non-null, prefills the composer with the given question and optionally auto-submits. */
  prefillRequest?: { question: string; autoSubmit?: boolean } | null;
  /** Called after a prefill has been consumed so the parent can clear it. */
  onPrefillConsumed?: () => void;
  /**
   * WS3 (Task 2): when provided, citation chip clicks open the file at the
   * cited paragraph in the editor — single-click navigation matching the Chat
   * surface. Signature mirrors AIChatViewer.onOpenFileAtPath.
   */
  onOpenFileAtPath?: (
    path: string,
    paragraphIndex?: number,
    snippet?: string,
    matterId?: string
  ) => void | Promise<void>;
  /** App-level audit sink. When omitted, Ask still works but does not log. */
  onAuditLog?: AuditLogSink;
  /** CRM Ask uses this to offer a separately approved fact or task proposal. */
  onAnswerCompleted?: (turn: AskTurn) => void;
}

export function useAsk({
  onSaveToDocument,
  prefillRequest,
  onPrefillConsumed,
  onOpenFileAtPath,
  onAuditLog,
  onAnswerCompleted,
}: UseAskProps) {
  const activeMatter = useActiveMatter();
  const hasActiveMatter = Boolean(activeMatter);
  const rootPath = useWorkspaceStore((s) => s.rootPath);
  const profession = useProfessionStore((s) => s.profession);
  // B-PRIV-1: subscribe to the confidentiality mode so the egress banner is
  // reactive. The Search/Ask banner must recompute the moment the user switches
  // mode in Settings — it can never keep claiming "nothing leaves" while the
  // next query goes to the cloud. Drives both the EgressIndicator `mode` prop
  // (passed from Ask) and the activeProvider re-resolution effect below.
  const confidentialityMode = useConfidentialityMode();
  // Connector-access: promise-based dialog used to ask, once, for firm consent
  // before exported RightCapital/Jump reports are sent to the AI. The dialog
  // itself is rendered by Ask.tsx from `exportConsentDialogProps`.
  const {
    confirm: confirmExportConsent,
    dialogProps: exportConsentDialogProps,
  } = useConfirmDialog();
  const isSampleMatterActive = activeMatter?.id === SAMPLE_MATTER_ID;
  // Profession-aware demo questions: a tax user on the sample matter sees tax
  // questions; a consultant sees consulting questions; legal is the default.
  // The WEB demo's advisor pack seeds the Webb household (not the desktop
  // Hendricks sample), so it gets Webb-specific questions — including one that's
  // deliberately outside the files, to show Ask declining instead of guessing.
  const demoQuestions =
    IS_DEMO && profession === 'advisor'
      ? WEB_DEMO_ADVISOR_QUESTIONS
      : getDemoQuestions(profession);

  // Derive chatId from the active matter, or — for the no-matter "all clients"
  // conversation — from the WORKSPACE ROOT (F2.5b, Codex round 8). A matter id is
  // already workspace-specific, but a bare `ask-global` is shared across every
  // workspace, so its session (and its per-conversation file-access consent)
  // would carry a grant + prior client facts from workspace A into workspace B.
  // Binding the global conversation to the current root makes the session AND the
  // consent workspace-scoped for free: opening a different workspace yields a
  // fresh `ask-global::<root>` conversation that re-asks and carries no other
  // workspace's turns. `matterLabel`-style ids stay stable per matter.
  const baseChatId = askChatId(activeMatter?.id ?? null, rootPath);
  // A manual conversation selection (New question / load from the rail), carrying
  // the workspace root it was made under. F2.5b (Codex round 12): `chatId` is
  // DERIVED SYNCHRONOUSLY below rather than set in a passive effect, so it can
  // never lag `rootPath` within a render — otherwise a workspace switch would
  // leave a one-render window where `chatId` still holds the OLD root while
  // `rootPath` is new, mis-tagging that session to the new workspace. The override
  // is honoured only while it belongs to the CURRENT root, so a workspace switch
  // drops it (falling back to the fresh, root-correct base) with no window.
  const [sessionOverride, setSessionOverride] = useState<{
    id: string;
    root: string | null;
  } | null>(null);
  const chatId =
    sessionOverride && sessionOverride.root === rootPath
      ? sessionOverride.id
      : baseChatId;

  // Scope toggle — default to 'this-matter' when a matter is active, else 'all-matters'.
  // Reset to appropriate default when the active matter changes.
  const defaultScope = (): AskScope =>
    defaultAskScope(hasActiveMatter);
  const [storedAskScope, setStoredAskScope] = useState<AskScope>(defaultScope);
  const askScope = normalizeVisibleAskScope(storedAskScope, hasActiveMatter);
  const setAskScope = useCallback((nextScope: AskScope) => {
    setStoredAskScope(normalizeVisibleAskScope(nextScope, hasActiveMatter));
  }, [hasActiveMatter]);

  // Reset the manual selection + scope when the active matter OR workspace root
  // changes (chatId itself is derived above, so it's already consistent).
  useEffect(() => {
    setSessionOverride(null);
    setStoredAskScope(defaultAskScope(hasActiveMatter));
  }, [activeMatter?.id, hasActiveMatter, rootPath]);

  // Store selectors
  const initSession = useAIChatStore((s) => s.initSession);
  const setSessionWorkspaceRoot = useAIChatStore(
    (s) => s.setSessionWorkspaceRoot
  );
  const addMessage = useAIChatStore((s) => s.addMessage);
  const renameSession = useAIChatStore((s) => s.renameSession);
  const sessions = useAIChatStore((s) => s.sessions);
  // F2.5 — per-conversation file-access consent for the PRIMARY Ask surface.
  // Reactive read drives the composer banner; the setter records grant/deny.
  // The scope MUST mirror the turn's retrieval scope (askConsentScope), so an
  // all-clients Ask demands its own grant and switching clients re-asks.
  const setFileAccessConsent = useAIChatStore((s) => s.setFileAccessConsent);
  const fileAccessConsent = useFileAccessConsent(chatId);
  const fileAccessConsentScope: ConsentScope = askConsentScope(
    activeMatter?.id ?? null,
    askScope
  );

  // Conversation state
  const [turns, setTurns] = useState<AskTurn[]>([]);
  const [streamingTurn, setStreamingTurn] = useState<AskTurn | null>(null);
  const [question, setQuestion] = useState('');
  const [selected, setSelected] = useState<number | null>(null);
  const [selectedTurnIdx, setSelectedTurnIdx] = useState<number | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [crmUnavailableNotice, setCrmUnavailableNotice] = useState<string | null>(null);
  const [status, setStatus] = useState<
    'idle' | 'retrieving' | 'answering' | 'done' | 'error'
  >('idle');
  // QA-7 — true once the answer stage has gone ASK_ANSWER_WARNING_MS with no
  // token/progress, so the "Answering…" spinner can say so instead of sitting
  // silent. Cleared the instant a token arrives, on completion, and on error.
  const [answerStalled, setAnswerStalled] = useState(false);
  // Fix 1b (demo readiness) — true only while THIS send is waiting for the
  // embedded llama-server sidecar to become healthy, before the no-token
  // watchdog is even armed (see the pre-flight block in handleAsk). Distinct
  // from `answerStalled`: that's "the model is generating but silent";
  // this is "the engine hasn't come up yet", an honest, expected state on
  // the first Local-only question after switching modes or launching the app.
  const [localAiStarting, setLocalAiStarting] = useState(false);
  // lp/localai-patience — true only while THIS Local-only send is prompt-
  // evaluating (the engine is UP and reading the retrieved documents) before
  // its first token. Distinct from both `answerStalled` ("generating but
  // silent") and `localAiStarting` ("engine not up yet"): a bigger question can
  // legitimately take a minute or two of CPU prompt-eval, which is honest,
  // expected work — so the spinner shows a calm "reading your documents"
  // message instead of "Answering…", and the alarming stall warning/error are
  // held off until the prompt-scaled first-token budget is genuinely exceeded.
  const [localEvaluating, setLocalEvaluating] = useState(false);
  const [savingIdx, setSavingIdx] = useState<number | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const composerInputRef = useRef<HTMLInputElement>(null);
  // QA-25 (P2) — mirror of `status` for the chatId-switch effect's cleanup
  // below. A cleanup closure only sees the values captured when its effect
  // last (re)ran (i.e. at the LAST chatId change), not whatever happened
  // afterward — a ref updated on every render gives the cleanup the LATEST
  // status at the moment the user actually switches away.
  const statusRef = useRef(status);
  useEffect(() => {
    statusRef.current = status;
  }, [status]);
  // The question text of the CURRENTLY in-flight ask, if any. Not derived
  // from the `question` composer state — `handleAsk` clears that optimistically
  // the instant it starts (so the composer looks ready for the next question),
  // so by the time a switch happens there's nothing left to read from it. Set
  // when a send starts, cleared when it reaches a terminal state (done/error)
  // or gets consumed by a cancellation.
  const pendingQuestionRef = useRef<string | null>(null);
  // Fix #8 / B-PRIV-1: the provider the egress banner names, TAGGED with the
  // confidentiality mode it was resolved UNDER. `null` means "destination not
  // yet known". We tag the mode so the displayed value (derived synchronously in
  // render below) can fall back to "checking" the instant the mode changes —
  // BEFORE the resolver effect runs — closing the one-frame window where a
  // provider resolved under the OLD mode would otherwise paint under the NEW mode
  // (e.g. a local provider painting "nothing leaves" while the mode is already
  // Direct). The EgressIndicator renders a neutral "checking" badge
  // (data-leaves=false) for null rather than guessing a destination.
  const [activeProvider, setActiveProvider] = useState<{
    provider: string;
    mode: ConfidentialityMode;
  } | null>(null);

  // Derived SYNCHRONOUSLY in render: the badge shows a concrete destination only
  // when we have a resolved provider AND it was resolved under the CURRENT mode.
  // Any mismatch (or unresolved) => null => the EgressIndicator's neutral
  // "checking" state. Because this is computed in render, it flips to "checking"
  // on the very render the mode changes, before any effect fires — so the banner
  // can never display a provider resolved under a different mode, even for a frame.
  const displayedProvider: string | null =
    activeProvider && activeProvider.mode === confidentialityMode
      ? activeProvider.provider
      : null;

  // Conversations rail: every "ask-*" session in this workspace, INCLUDING the
  // active one so the rail can highlight it. The rail is the primary switcher now
  // (it replaced the old top chip-strip + in-empty-state recent list), so we lift
  // the old 5-item cap and show the full local history. Grouping (this client vs
  // everything else) is done in the view from this flat, recency-sorted list.
  const railSessions = buildRecentAskSessions(sessions, rootPath, {
    limit: 100,
  });

  // Rail collapse — view-only state, persisted so the choice survives reloads.
  const [railCollapsed, setRailCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(ASK_RAIL_COLLAPSED_KEY) === '1';
    } catch {
      return false;
    }
  });
  const toggleRailCollapsed = useCallback(() => {
    setRailCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(ASK_RAIL_COLLAPSED_KEY, next ? '1' : '0');
      } catch {
        /* ignore storage failures (private mode / quota) */
      }
      return next;
    });
  }, []);

  // Files-only mode lock (Decision 6) — view+behaviour state, persisted. Default
  // OFF (smart). When ON, handleAsk uses the strict files-only prompt, keeps the
  // no-evidence decline, and skips block provenance (flat cited rendering).
  const [filesOnlyPreference, setFilesOnlyState] = useState<boolean>(() => {
    try {
      return localStorage.getItem(ASK_FILES_ONLY_KEY) === '1';
    } catch {
      return false;
    }
  });
  const filesOnly = filesOnlyPreference;
  const setFilesOnly = useCallback((next: boolean) => {
    setFilesOnlyState(next);
    try {
      localStorage.setItem(ASK_FILES_ONLY_KEY, next ? '1' : '0');
    } catch {
      /* ignore storage failures (private mode / quota) */
    }
  }, []);

  // QA-90 — whether a content import (email/CRM/OneDrive/file indexing) is
  // active right now. Read fresh inside handleAsk's retrieval-evidence gate so
  // a zero-hit answer during an active import says so, instead of reading as
  // "nothing exists" (see STILL_IMPORTING_DECLINE).
  //
  // QA-90 round 3 — `importStatus` is a tri-state (`unknown` covers the brief
  // window before the first status fetch resolves). The retrieval-evidence
  // gate treats `unknown` the same as `importing` via `isImportStatusUnsettled`
  // — a question asked the instant Ask opens must not read as a confident
  // "nothing found" just because we haven't heard back yet. `stillImporting`
  // (the banner-facing boolean) stays strictly "confirmed importing" so the
  // banner doesn't flash on every mount.
  const importStatus = useStillImporting();
  const stillImporting = importStatus === 'importing';
  // Round 2 (coordinator review): `handleAsk` is a long-running async closure
  // — retrieval alone can await a real search. Reading the closed-over
  // `importStatus` const at the gate would use whatever it was at the moment
  // THIS call of handleAsk was CREATED, not the CURRENT status by the time
  // retrieval finishes and the gate actually runs. A ref updated every render
  // (mirrors `statusRef` above) always reflects the latest known status.
  const importStatusRef = useRef(importStatus);
  useEffect(() => {
    importStatusRef.current = importStatus;
  }, [importStatus]);

  // On mount / chatId change: init session and reconstruct turns from persisted messages.
  // Fix #1: read getState() instead of the closed-over `sessions` selector so we always
  // see the post-initSession state, not a stale snapshot captured at render time.
  // A3: for the sample matter, always start with the empty chip state (never restore a
  // prior demo answer) so the "click a question" aha moment shows on every fresh visit.
  useEffect(() => {
    initSession(chatId, []);
    setSessionWorkspaceRoot(chatId, rootPath ?? null);
    const isSampleChat = activeMatter?.id === SAMPLE_MATTER_ID;
    const freshSession = useAIChatStore.getState().sessions[chatId];
    if (!isSampleChat && freshSession && freshSession.messages.length > 0) {
      const reconstructed = reconstructTurns(freshSession.messages);
      setTurns(reconstructed);
    } else {
      setTurns([]);
    }
    setSelected(null);
    setSelectedTurnIdx(null);
    setStreamingTurn(null);
    setErrorMsg(null);
    setCrmUnavailableNotice(null);
    setStatus('idle');
    setAnswerStalled(false);
    setLocalAiStarting(false);
    setLocalEvaluating(false);

    // QA-25 (P2) — this effect's cleanup runs right before `chatId` changes
    // again, i.e. the instant the user switches to a different client/
    // conversation. `chatId` here is the OUTGOING one (closed over from this
    // render); `statusRef`/`questionRef` give the LATEST status/question
    // (see their declaration above for why refs, not the closed-over state,
    // are needed). If a question was still retrieving/answering for THIS
    // chat, abort it (every downstream `abort.signal.aborted` check then
    // makes the original handleAsk call return without ever persisting a
    // stale success) and leave an honest, persisted record in THIS chat's
    // own history — never silent loss, and never a leak into whatever chat
    // becomes current next.
    return () => {
      if (
        statusRef.current !== 'retrieving' &&
        statusRef.current !== 'answering'
      )
        return;
      const askedQuestion = pendingQuestionRef.current;
      if (!askedQuestion) return;
      abortRef.current?.abort();
      pendingQuestionRef.current = null;
      const cancelledAt = new Date().toISOString();
      addMessage(chatId, {
        role: 'user',
        content: askedQuestion,
        timestamp: cancelledAt,
      });
      addMessage(chatId, {
        role: 'assistant',
        content: ASK_CANCELLED_BY_NAVIGATION_MESSAGE,
        timestamp: cancelledAt,
        askGroundedFromFiles: false,
      });
    };
  }, [chatId, rootPath]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-scroll to bottom when turns change or streaming turn updates
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns.length, streamingTurn]);

  // Fix #2: auto-select the first citation of the most-recently-added completed
  // turn. Running this in an effect (rather than inside the setTurns updater)
  // ensures both pieces of state are committed in the same React batch and
  // SourcePanel is never empty for a frame.
  useEffect(() => {
    if (turns.length === 0) return;
    const lastTurn = turns[turns.length - 1];
    if (lastTurn && lastTurn.citations.length > 0) {
      setSelectedTurnIdx(turns.length - 1);
      setSelected(1);
    }
  }, [turns.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fix #1: prefill + optional auto-submit from the matter hub or other callers.
  useEffect(() => {
    if (!prefillRequest) return;
    setQuestion(prefillRequest.question);
    composerInputRef.current?.focus();
    if (prefillRequest.autoSubmit) {
      void handleAsk(prefillRequest.question);
    }
    onPrefillConsumed?.();
  }, [prefillRequest]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fix #2: pressing '/' while not typing in an input focuses the composer.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== '/') return;
      const target = e.target as HTMLElement;
      const tag = target.tagName.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || target.isContentEditable)
        return;
      e.preventDefault();
      composerInputRef.current?.focus();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  // Fix #8: resolve the active provider NAME for the pre-send EgressIndicator.
  // It must name the SAME engine the send will actually use — the embedded
  // Lantern Local AI when it is ready (not a generic "Ollama"), and the local
  // engine in Local-only mode regardless of any cloud key. resolveActiveAskProviderId
  // mirrors buildResolvedAskProvider's destination decision so the two can't drift.
  //
  // B-PRIV-1: re-resolve whenever the confidentiality mode changes (not just on
  // mount). Without this the badge stayed pinned to the mount-time engine — e.g.
  // "lantern-local" — so flipping from Local-only to Cloud mid-session left the
  // banner falsely claiming "nothing leaves" while the query went to the cloud.
  //
  // HOLE #1 (Codex re-review) — resolution is async, so during the in-flight
  // window the OLD provider value combined with the NEW mode could still lie
  // (a stale local provider + Direct mode renders as "nothing leaves"). We close
  // that window by BLANKING to null up front: the banner shows a neutral
  // "checking AI destination" badge for the whole async window, never a
  // concrete-but-stale destination. The cancellation guard drops
  // a superseded in-flight resolution so the displayed engine can't race backwards.
  useEffect(() => {
    let cancelled = false;
    setActiveProvider(null);
    void resolveActiveAskProviderId()
      .then((resolved) => {
        if (!cancelled)
          setActiveProvider({ provider: resolved, mode: confidentialityMode });
      })
      .catch(() => {
        // The resolver almost never throws (it has internal fallbacks), but if it
        // does we must NOT strand the badge on "checking" forever. Fall back to a
        // CONSERVATIVE cloud identity: in Local-only mode resolveEgress still forces
        // "nothing leaves"; in cloud modes this over-warns ("data leaves"), which is
        // the safe direction for a privacy indicator — it can never UNDER-claim egress.
        if (!cancelled)
          setActiveProvider({
            provider: 'anthropic',
            mode: confidentialityMode,
          });
      });
    return () => {
      cancelled = true;
    };
  }, [confidentialityMode]);

  // Derived: currently selected citation
  const selectedCite = (() => {
    if (selectedTurnIdx === null || selected === null) return null;
    const turn = turns[selectedTurnIdx] ?? streamingTurn;
    if (!turn) return null;
    return turn.citations.find((c) => c.n === selected) ?? null;
  })();

  // Any turn has citations?
  const anyHasCitations =
    turns.some((t) => t.citations.length > 0) ||
    (streamingTurn !== null && streamingTurn.citations.length > 0);

  const handleCitationSelect = useCallback((turnIdx: number, n: number) => {
    setSelectedTurnIdx(turnIdx);
    setSelected(n);
  }, []);

  const handleNewAsk = useCallback(() => {
    abortRef.current?.abort();
    // Generate a new session id to start fresh (tagged with the current root).
    const newId = `${askChatId(activeMatter?.id ?? null, rootPath)}-${String(Date.now())}`;
    setSessionOverride({ id: newId, root: rootPath });
    setTurns([]);
    setStreamingTurn(null);
    setQuestion('');
    setSelected(null);
    setSelectedTurnIdx(null);
    setErrorMsg(null);
    setCrmUnavailableNotice(null);
    setStatus('idle');
    setAnswerStalled(false);
    setLocalAiStarting(false);
    setLocalEvaluating(false);
  }, [activeMatter, rootPath]);

  const handleLoadSession = useCallback(
    (sid: string) => {
      // Rail sessions are already filtered to the current workspace, so tag the
      // selection with the current root (dropped if the workspace later changes).
      setSessionOverride({ id: sid, root: rootPath });
    },
    [rootPath]
  );

  const handleRenameSession = useCallback((sid: string, title: string) => {
    renameSession(sid, title);
  }, [renameSession]);

  const buildAuditScope = useCallback(
    (retrievalScope: RetrievalScope): AuditScope => {
      if (retrievalScope.kind === 'matter') {
        return {
          kind: 'matter',
          matterId: retrievalScope.matterId,
          ...(activeMatter ? { matterName: matterLabel(activeMatter) } : {}),
        };
      }
      return { kind: 'allMatters' };
    },
    [activeMatter]
  );

  /**
   * Submit a question. An optional `overrideQuestion` bypasses the text input
   * so chips on the sample matter can auto-submit without typing into the box.
   */
  const handleAsk = useCallback(
    async (overrideQuestion?: string) => {
      const q = (overrideQuestion ?? question).trim();
      if (!q || status === 'retrieving' || status === 'answering') return;

      abortRef.current?.abort();
      const abort = new AbortController();
      abortRef.current = abort;
      // QA-25 (P2) — record the in-flight question so a client switch before
      // this resolves can leave an honest "cancelled" record (see the
      // chatId-switch effect's cleanup above) instead of silently losing it.
      pendingQuestionRef.current = q;

      // F2.5b (Codex round 11) — capture the workspace GENERATION at send start.
      // Re-checked just before dispatch so any workspace switch during the send's
      // awaits — including an A→B→A round-trip that leaves the root string equal —
      // is caught (the counter is monotonic), preventing a newly-active workspace's
      // retrieved content from being sent under this send's (old) workspace consent.
      const sendRootGeneration = useWorkspaceStore.getState().rootGeneration;

      setErrorMsg(null);
      setCrmUnavailableNotice(null);
      setStatus('retrieving');
      setAnswerStalled(false);
      setLocalAiStarting(false);
      setLocalEvaluating(false);

      // Add user message to stream placeholder
      const newStreamingTurn: AskTurn = {
        question: q,
        answer: '',
        citations: [],
        sources: [],
        isStreaming: true,
      };
      setStreamingTurn(newStreamingTurn);
      setQuestion('');

      let providerAudit: {
        providerId:
          | 'anthropic'
          | 'openai'
          | 'google'
          | 'ollama'
          | 'lantern-local';
        model: string;
      } | null = null;
      let egressForSend: EgressInfo | null = null;
      let egressDestinationForReceipt: EgressInfo['destination'] | undefined;
      let providerCallStarted = false;
      let failedStage: AskFailureStage = 'setup';
      // F2.5b (Codex P2) — hoisted so the FAILURE audit below can record whether
      // client file content was part of a send that may already have reached the
      // provider before it errored. Set once the consent gate resolves.
      let fileToolsEnabledForAudit = false;

      try {
        /* Demo branch: sample matter + no cloud key + matching question */
        const isSampleMatter = activeMatter?.id === SAMPLE_MATTER_ID;
        if (isSampleMatter && rootPath) {
          const cloudKey = await hasCloudKey();
          if (!cloudKey) {
            const demo = getDemoAnswerForWorkspace(q, rootPath, profession);
            if (demo) {
              if (abort.signal.aborted) return;
              // In smart mode, present the demo answer under the new "From your
              // files" provenance label (a single files block) so the sample
              // matter — the first thing a new advisor sees — shows the labelled
              // design. In Files-only mode it renders flat (the green attestation).
              const demoBlocks: AnswerBlock[] | undefined = filesOnly
                ? undefined
                : [
                    {
                      kind: 'files',
                      text: demo.answer,
                      citations: demo.citations,
                    },
                  ];
              // The cited demo answer IS file-derived (from the sample matter's
              // files), so mark it with its true scope (not the widest-scope
              // fail-closed fallback) so a later same-sample send keeps it in
              // history rather than over-redacting it (Codex final review P2).
              // `activeMatter` is narrowed non-null here (isSampleMatter guard above).
              const demoGroundingScope = askConsentScope(
                activeMatter.id,
                askScope
              );
              const completedTurn: AskTurn = {
                question: q,
                answer: demo.answer,
                citations: demo.citations,
                sources: [],
                ...(demoBlocks ? { blocks: demoBlocks } : {}),
                groundedFromFiles: true,
                groundingScope: demoGroundingScope,
                readSources: sourceIdentitiesFromSources(demo.citations),
                isDemoAnswer: true,
              };
              const now = new Date().toISOString();
              addMessage(chatId, { role: 'user', content: q, timestamp: now });
              addMessage(chatId, {
                role: 'assistant',
                content: demo.answer,
                timestamp: now,
                askCitations: demo.citations,
                askSources: [],
                askReadSources: sourceIdentitiesFromSources(demo.citations),
                askIsDemoAnswer: true,
                ...(demoBlocks
                  ? {
                      askBlocks: demoBlocks.map((b) => ({
                        kind: b.kind,
                        text: b.text,
                      })),
                    }
                  : {}),
                askGroundedFromFiles: true,
                askGroundingScope: demoGroundingScope,
              });
              setTurns((prev) => [...prev, completedTurn]);
              setStreamingTurn(null);
              setStatus('done');
              pendingQuestionRef.current = null;
              return;
            }
            // A4: sample matter + no cloud key + question not in demo set.
            // Do not fall through to RAG or the AI provider — neither will work.
            // Push a calm bridging message and stop.
            if (abort.signal.aborted) return;
            const bridgeAnswer =
              'That question is outside this sample. Connect an AI provider in Settings to ask your own files, or try one of the example questions below.';
            const bridgeTurn: AskTurn = {
              question: q,
              answer: bridgeAnswer,
              citations: [],
              sources: [],
              // Non-file reply — mark definitively so history redaction doesn't
              // fail-closed on it (Codex final review P2).
              groundedFromFiles: false,
            };
            const nowBridge = new Date().toISOString();
            addMessage(chatId, {
              role: 'user',
              content: q,
              timestamp: nowBridge,
            });
            addMessage(chatId, {
              role: 'assistant',
              content: bridgeAnswer,
              timestamp: nowBridge,
              askGroundedFromFiles: false,
            });
            setTurns((prev) => [...prev, bridgeTurn]);
            setStreamingTurn(null);
            setStatus('done');
            pendingQuestionRef.current = null;
            return;
          }
        }

        /* F2.5 — file-access consent scope for the PRIMARY Ask surface.
         * "Reading is sending" with a cloud model: Ask's retrieval is AMBIENT (it
         * runs on every question — there is no typed `@workspace` here), so for a
         * CLOUD provider client file content must NOT reach the vendor until the
         * advisor has allowed file access FOR THIS CONVERSATION. The grant is bound
         * to the turn's scope (askConsentScope mirrors retrievalScope below), so an
         * all-clients Ask needs its own grant and switching clients re-asks.
         *
         * We capture only the SCOPE here (it's frozen at send time, like
         * retrievalScope); the consent DECISION itself is re-read at the last
         * synchronous moment before the send (see the AUTHORITATIVE gate block after
         * flushSync), so a "Turn off" click during the retrieval/provider-resolution
         * awaits is honoured. Retrieval below still runs (a LOCAL vector search over
         * the on-machine index is not egress); the gate decides whether those hits
         * are INJECTED into the cloud prompt, against the REAL resolved provider. So
         * nothing leaves the machine without consent, and there is no estimate↔send
         * drift. Local engines never leak and the web demo runs on synthetic sample
         * data, so neither is gated there. */
        const turnConsentScope: ConsentScope = askConsentScope(
          activeMatter?.id ?? null,
          askScope
        );

        /* Step 1: RAG retrieval
         * The Tauri-level retrieval scope is matter vs all-matters (confidentiality
         * partition). Email/Documents are client-side type filters applied on top:
         * when a matter is active and scope is Email or Documents we still retrieve
         * within that matter's boundary first, then filter by source type. This
         * preserves the confidentiality partition at the database level.
         */
        const retrievalScope: RetrievalScope =
          activeMatter && askScope !== 'all-matters'
            ? { kind: 'matter', matterId: activeMatter.id }
            : { kind: 'allMatters' };

        let hits: RagHit[] = [];
        const memoryEnabled = isMemoryEnabled();
        if (memoryEnabled) {
          failedStage = 'retrieval';
          // WS3d-A — default-OFF reranker toggle, read per call.
          const enableReranker = useSettingsStore
            .getState()
            .getSetting<boolean>('enableReranker');
          const enableHybridSearch = useSettingsStore
            .getState()
            .getSetting<boolean>('enableHybridSearch');
          // fix/ask-list-hang — HARD timeout on the context-gather step. This
          // LOCAL vector search normally returns in well under a second, but on a
          // large workspace it could stall indefinitely (LanceDB kept perpetually
          // busy — see the `.lantern` self-indexing fix), leaving the "Answering…"
          // spinner spinning forever with no error and no way out. Bounding it makes
          // a stall REJECT with an AskTimeoutError, which the catch below turns into
          // the honest `failedStage === 'retrieval'` "couldn't search your files yet —
          // try again" message. We do NOT abort the shared controller on timeout: an
          // aborted signal means "the user moved on, drop silently", which would
          // swallow the very error we want to show.
          const rawHits = await withAskTimeout(
            MemoryService.retrieve(
              q,
              DEFAULT_WORKSPACE_TOP_K,
              retrievalScope,
              false,
              undefined,
              enableReranker,
              enableHybridSearch
            ),
            ASK_RETRIEVAL_TIMEOUT_MS,
            'retrieval'
          );
          failedStage = 'post-retrieval';
          // Apply client-side type filter for Email/Documents scopes.
          hits = filterHitsByScope(rawHits, askScope);
          // Connector-access: collapse the SAME recognized export that arrived via
          // two paths (e.g. a Jump note synced to Wealthbox AND saved as a
          // SharePoint PDF) so it is never used as evidence twice in one answer.
          hits = dedupeRecognizedHits(hits);
          const auditScope = buildAuditScope(retrievalScope);
          const topScore = hits.reduce<number | null>(
            (max, hit) => (max === null ? hit.score : Math.max(max, hit.score)),
            null
          );
          onAuditLog?.(
            auditEventToEntry({
              type: 'scope_active',
              timestamp: new Date().toISOString(),
              payload: { scope: auditScope },
            })
          );
          onAuditLog?.(
            auditEventToEntry({
              type: 'privilege_evaluated',
              timestamp: new Date().toISOString(),
              payload: { excluded: true },
            })
          );
          onAuditLog?.(
            auditEventToEntry({
              type: 'retrieval_executed',
              timestamp: new Date().toISOString(),
              payload: {
                query: q,
                scope: auditScope,
                hitCount: hits.length,
                topScore,
                sources: sourceIdentitiesFromSources(hits),
              },
            })
          );
        }

        // CRM rows join Ask through the same RagHit adapter as documents and
        // email. The backend applies the single-client SQLCipher FTS scope; the
        // adapter repeats that check fail-closed before anything can reach a
        // prompt or citation. CRM remains useful even while document indexing is
        // turned off, because its encrypted search projection is independent.
        failedStage = 'retrieval';
        const crmHits = await retrieveCrmAskHits(
          rootPath,
          q,
          retrievalScope.kind === 'matter' ? retrievalScope.matterId : null,
          setCrmUnavailableNotice,
        );
        hits = [...hits, ...crmHits];

        if (abort.signal.aborted) return;

        /* BUG-016: retrieval-evidence gate (FILES-ONLY mode).
         * When indexing IS on but retrieval found nothing in scope, decline
         * instead of calling the model — otherwise the model free-associates a
         * confident answer and (worse) a fabricated citation, presented under the
         * "Answered over your own files" banner. Declining here, before the model
         * runs, makes "no evidence" an honest "I couldn't find this" rather than a
         * hallucinated, fake-cited answer. (When indexing is OFF we leave the
         * existing behaviour: the UI already warns that documents aren't indexed.)
         *
         * Ask-smart change (Decision 3): in SMART mode we do NOT dead-end here.
         * The model is still called, but with `hasEvidence: false`, so it leads
         * with an honest nothing-found block and then offers clearly-labelled
         * general help. The structural safety net is unchanged — bindAnswerBlocks
         * binds citations ONLY inside files blocks against real retrieved chunks,
         * so an empty context can never produce a green, fake-cited claim.
         */
        const emitDecline = (answer: string): void => {
          const declineTurn: AskTurn = {
            question: q,
            answer,
            citations: [],
            sources: [],
            // A "couldn't find this" decline carries NO file content — mark it
            // definitively so a later same-client send doesn't drop it as unknown
            // (fail-closed) history (Codex final review P2).
            groundedFromFiles: false,
          };
          const nowDecline = new Date().toISOString();
          addMessage(chatId, {
            role: 'user',
            content: q,
            timestamp: nowDecline,
          });
          addMessage(chatId, {
            role: 'assistant',
            content: answer,
            timestamp: nowDecline,
            askGroundedFromFiles: false,
          });
          setTurns((prev) => [...prev, declineTurn]);
          setStreamingTurn(null);
          setStatus('done');
          pendingQuestionRef.current = null;
        };

        // QA-90: zero hits WHILE a content import is actively running (or we
        // simply don't know yet, round 3) is ambiguous — "nothing exists" vs.
        // "just not indexed yet" — so it gets its own, more reassuring decline,
        // in BOTH files-only and smart mode (a confident "nothing found, here's
        // general advice" would be actively misleading mid-import). Checked
        // before the files-only gate below so it takes priority whenever both
        // would otherwise apply. Reads `importStatusRef` (round 2 coordinator
        // review), NOT the closed-over `importStatus`, so a status that resolves
        // to idle WHILE retrieval above was still awaiting is seen fresh here —
        // otherwise a stale "unsettled" snapshot from send time would emit the
        // still-importing decline even though nothing is importing anymore.
        if (
          memoryEnabled &&
          hits.length === 0 &&
          isImportStatusUnsettled(importStatusRef.current)
        ) {
          emitDecline(STILL_IMPORTING_DECLINE);
          return;
        }

        // Ask-smart (Decision 3): only files-only mode dead-ends on no evidence;
        // smart mode proceeds and leads with an honest nothing-found block.
        if (filesOnly && memoryEnabled && hits.length === 0) {
          emitDecline(NO_EVIDENCE_DECLINE);
          return;
        }

        /* Connector-access: one-time firm consent before exported reports/notes
         * recognized from outside tools (RightCapital, Jump) are sent to the AI.
         * Storing and AI-processing another tool's exported output is the advisor's
         * (firm's) call, so we ask ONCE, record the decision in the audit log, and
         * make it revocable in Settings. Declining excludes those exports from THIS
         * answer (fail closed) rather than blocking the whole question. */
        const recognizedTools = [
          ...new Set(
            hits
              .map((h) => recognizeHit(h)?.toolLabel)
              .filter((t): t is string => !!t)
          ),
        ];
        if (recognizedTools.length > 0) {
          const alreadyConsented = isExternalExportConsentGiven();
          if (!alreadyConsented) {
            const toolsLabel = formatToolList(recognizedTools);
            const consented = await confirmExportConsent(
              brandText(`Lantern found a report you exported or saved from ${toolsLabel} among the files it would use to answer. Lantern reads exported files; it is not connected to ${toolsLabel}. Confirm your firm permits you to store this exported report in Lantern and use your chosen AI on it.`),
              {
                title: `Use exported reports from ${toolsLabel}?`,
                confirmLabel: 'Yes, my firm permits this',
                cancelLabel: 'Not now',
              }
            );
            // The user can switch questions while this dialog is open; bail if so.
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- abort.signal flips via an external AbortController across the await (ESLint can't see it; same async pattern baselined elsewhere in this file).
            if (abort.signal.aborted) return;
            onAuditLog?.(
              auditEventToEntry({
                type: 'external_export_consent',
                timestamp: new Date().toISOString(),
                payload: { given: consented, tools: recognizedTools },
              })
            );
            if (consented) {
              grantExternalExportConsent();
            } else {
              // Fail closed: drop the recognized exports from this answer.
              hits = hits.filter((h) => recognizeHit(h) === null);
              // QA-90: same still-importing gate as above, now that filtering
              // may have newly emptied the evidence.
              if (
                memoryEnabled &&
                hits.length === 0 &&
                isImportStatusUnsettled(importStatusRef.current)
              ) {
                emitDecline(STILL_IMPORTING_DECLINE);
                return;
              }
              // Only files-only mode dead-ends when that empties the evidence;
              // smart mode proceeds (leads with an honest nothing-found block).
              if (filesOnly && memoryEnabled && hits.length === 0) {
                emitDecline(NO_EVIDENCE_DECLINE);
                return;
              }
            }
          }
        }

        /* Step 2: call the AI provider */
        setStatus('answering');
        failedStage = 'provider-resolution';

        // NOTE: the system prompt (with any retrieved file content) is built BELOW,
        // AFTER the provider resolves — so the F2.5 consent gate can drop file
        // content against the REAL send destination, never an estimate (see the
        // "AUTHORITATIVE consent gate" block after flushSync).
        let answerText = '';
        let resolvedProvider = await buildResolvedAskProvider();
        // QA-25 (P2, Codex review) — the user can navigate away (switch client,
        // start a new question, load another thread) while this await is in
        // flight. Without this check, a navigation-triggered abort persists the
        // "cancelled" record (see the chatId-switch effect) and this call keeps
        // going anyway, potentially persisting a SECOND, "successful" answer
        // after it — worse on providers with no streaming signal, which never
        // see the abort at all downstream. Bail the same way every other
        // post-await checkpoint in this function does.
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- abort.signal flips via an external AbortController across the await (ESLint can't see it; same async pattern baselined elsewhere in this file).
        if (abort.signal.aborted) return;

        // FINAL SYNCHRONOUS LOCAL-ONLY SEND GUARD (Codex re-review #4 — the
        // important one). This is a real privacy enforcement, not a display fix:
        // buildResolvedAskProvider() checks the mode only at its START and then
        // awaits keychain reads. If the user switches to Local-only DURING those
        // awaits, it can still return a CLOUD provider — which would send the query
        // to the cloud while Local-only is on, breaking that mode's core guarantee
        // (nothing ever leaves the machine). We re-check the CURRENT mode after the
        // await: if Local-only is now on and the resolved provider is NOT local,
        // re-resolve to the on-device engine so the user still gets a private answer
        // instead of a failed query (local sends are always safe, whatever the mode
        // does next). resolveLocalOnlyAskProvider throws an honest "still setting
        // up" message rather than silently constructing an unreachable Ollama
        // provider (Fix 2) — that throw is caught by this function's outer catch,
        // same as any other resolution failure.
        if (
          isLocalOnlyMode() &&
          !isLocalProvider(resolvedProvider.providerId)
        ) {
          resolvedProvider = await resolveLocalOnlyAskProvider();
          // QA-25 (P2, Codex review) — same re-check as above: this branch adds
          // its OWN await, so a navigation-triggered abort during THIS one must
          // be caught here too, not just after the first resolution.
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- abort.signal flips via an external AbortController across the await (ESLint can't see it; same async pattern baselined elsewhere in this file).
          if (abort.signal.aborted) return;
        }
        // Airtight backstop: there is NO await between this assertion and the send
        // below (only synchronous setup + flushSync), so the mode cannot change in
        // between. If we somehow still hold a cloud provider in Local-only mode,
        // fail closed (throw) rather than leak — the catch surfaces the reason.
        assertLocalOnlyAllowsSend(resolvedProvider.providerId);

        const provider = resolvedProvider.provider;
        providerAudit = {
          providerId: resolvedProvider.providerId,
          model: resolvedProvider.model,
        };
        // HOLE #2 (Codex re-review) — pin the egress banner to the engine this send
        // ACTUALLY resolved to (buildResolvedAskProvider is the single source of
        // truth for where the request goes), and do it SYNCHRONOUSLY. A plain
        // setState here may be batched, so the banner is not guaranteed to repaint
        // before the network call on the next line. flushSync forces the React
        // commit now, so the banner DOM reflects the real destination BEFORE
        // sendMessage/sendMessageStreaming runs — even if the badge was still
        // "checking" (null) at click time, or the effective provider changed for a
        // reason the mode-keyed effect doesn't watch (e.g. a cloud key added
        // mid-session). The banner can never be sent-to-cloud-while-showing-local.
        flushSync(() => {
          setActiveProvider({
            provider: resolvedProvider.providerId,
            mode: getConfidentialityMode(),
          });
        });

        // F2.5b (Codex round 10/11) — cross-workspace in-flight RACE guard. If the
        // user switched workspaces while this send was awaiting (retrieval + provider
        // resolution), the retrieved `hits` may be the NEW workspace's content while
        // this send's consent + chatId belong to the OLD workspace — so B's client
        // files could reach the cloud under A's grant. Compare the monotonic
        // workspace GENERATION (not just the current root string, which an A→B→A
        // round-trip would leave equal): any switch since send start bails. Read
        // synchronously; there is NO await between here and the send below.
        if (useWorkspaceStore.getState().rootGeneration !== sendRootGeneration)
          return;

        // F2.5 — AUTHORITATIVE file-access consent gate, evaluated against the
        // provider this send ACTUALLY resolved to (the single source of truth for
        // where the request goes). If the real destination is a cloud provider and
        // file access wasn't granted for this conversation's scope, DROP any
        // retrieved file content so it never reaches the vendor — closing the
        // estimate↔send drift window from Step 1's skip decision. The web demo is
        // not gated (synthetic sample data through a shared relay). There is NO
        // await between here and the send below, so the destination can't change
        // under us. `groundingHits` (not `hits`) is what actually informs the
        // prompt and the citations, so a blocked turn can never cite content that
        // never left the machine.
        const providerIsCloud =
          !IS_DEMO && !isLocalProvider(resolvedProvider.providerId);
        // F2.5b (Codex round 6) — RE-READ consent HERE, at the last synchronous
        // moment before the prompt is built and sent. The snapshot taken at
        // handleAsk start is stale by now: retrieval + provider resolution awaited,
        // and the user may have clicked "Turn off" during that window. This block
        // (and the send below) has NO further await, so this is the freshest, final
        // consent decision — it governs the fresh workspace block AND the history.
        const currentConsent = getFileAccessConsent(chatId);
        const currentFileAccessGranted = fileToolsAllowed(
          currentConsent,
          turnConsentScope
        );
        // BUG-01 — an unanswered consent prompt used to silently erase the real
        // retrieval hits and send a context-free question to the cloud. That is
        // why the identical query worked locally but returned zero cloud
        // citations. An explicit "Not now" still permits a general, file-free
        // answer; an unanswered prompt (or a grant for the wrong scope) stops
        // before egress, keeps the question, and points to the visible consent
        // control. The existing scope-bound permission remains fail-closed.
        if (
          providerIsCloud &&
          !currentFileAccessGranted &&
          currentConsent.state !== 'denied'
        ) {
          throw new Error(CLOUD_FILE_ACCESS_REQUIRED_MESSAGE);
        }
        // May THIS send carry client file content to the destination? True for a
        // local engine (never leaks) or a cloud provider consented for the turn's
        // scope; false for a cloud provider without consent.
        const fileContentPermitted = resolveWorkspaceRetrieval({
          explicitWorkspace: false,
          askWorkspaceMode: true,
          isCloudProvider: providerIsCloud,
          fileAccessGranted: currentFileAccessGranted,
        }).shouldRetrieve;
        let groundingHits: RagHit[] = fileContentPermitted ? hits : [];

        // B4 (audit honesty): build the prompt scope from the SAME retrievalScope
        // the retrieval actually used — NOT from activeMatter. Otherwise, when a
        // matter is active but the user picked the "All matters" scope, the prompt
        // would tell the AI it's answering for the active client while retrieval ran
        // across everything — so the prompt and the audited scope would disagree.
        const matterHint = scopeHintForMatter(
          retrievalScope.kind === 'matter' && activeMatter
            ? matterLabel(activeMatter)
            : null
        );
        // F2.5b (Codex P1/round-3) — "reading is sending" also covers CONVERSATION
        // HISTORY. Prior file-grounded answers in `turns` carry retrieved client
        // facts in their text, so a later CLOUD send re-sends a given prior answer
        // ONLY when the CURRENT consent covers the scope THAT answer's file content
        // was grounded under (a single-client grant must not drag an all-clients — or
        // other-scope — prior answer, even one grounded on an earlier LOCAL turn,
        // into the cloud prompt). selectHistoryTurns is a pure, unit-tested seam.
        const historyTurnsForSend = selectHistoryTurns(
          turns,
          currentConsent,
          providerIsCloud,
          turnConsentScope
        );
        // Only the last N turns are ACTUALLY placed in the prompt (buildHistoryBlock
        // slices to `HISTORY_WINDOW`). Transitive grounding must scan the SAME slice
        // (Codex final review P2): an older file-grounded turn OUTSIDE the window
        // never reaches the model, so it must not mark this answer file-derived (a
        // misleading fileToolsEnabled=true audit + needless future redaction).
        let historyInPrompt = historyTurnsForSend.slice(-HISTORY_WINDOW);

        // Local-AI context trimming (step-4 adversarial review, finding 6; round-2
        // fix, P2) — every LOCAL engine runs with a small, model-reported context
        // window, unlike cloud providers, which tolerate an oversized prompt. This
        // covers BOTH local routes: the embedded on-device model (LANTERN_LOCAL_CONTEXT_WINDOW
        // fallback) and a user-run Ollama daemon (resolved when the embedded model
        // isn't ready — see resolveLocalProvider.ts), each reading ITS OWN
        // provider-reported window via getMetadata(), never a hard-coded number.
        // That reported window is the WORKING window the request actually gets
        // (round-2 F1: OllamaProvider reports its clamped num_ctx, not the
        // model's theoretical max — budgeting against 131k while sending into a
        // 16k window is exactly the silent truncation this exists to prevent).
        // If over budget, drop retrieved chunks lowest-relevance-first (whole
        // chunks only, so a surviving citation never points at truncated text),
        // then oldest history. Cloud providers never take this path — no
        // behavior change for them.
        if (isLocalProvider(resolvedProvider.providerId)) {
          const maxContextTokens =
            resolvedProvider.provider.getMetadata().capabilities
              ?.maxContextTokens ?? LANTERN_LOCAL_CONTEXT_WINDOW;
          const staticSystemPrompt = filesOnly
            ? buildAskSystemPrompt({
                scopeHint: matterHint,
                workspaceBlock: '',
                historyBlock: '',
              })
            : buildSmartAskSystemPrompt({
                scopeHint: matterHint,
                workspaceBlock: '',
                historyBlock: '',
                // Estimate with the LONGER no-evidence hint: smart-mode trimming
                // may drop every chunk (round-2 F2), flipping the real prompt to
                // the no-evidence variant — sizing against the longer of the two
                // keeps the estimate an upper bound in both outcomes.
                hasEvidence: false,
              });
          const trimResult = trimForLocalContext(
            {
              fixedText: `${staticSystemPrompt}\n\n${q}`,
              hits: groundingHits,
              historyTurns: historyInPrompt,
              // Smart mode may drop even the last chunk (answering honestly from
              // history / general knowledge via the no-evidence prompt below);
              // files-only must decline instead — see localContextTrim.ts.
              mode: filesOnly ? 'files-only' : 'smart',
              buildWorkspaceBlock: buildWorkspaceContextBlock,
              buildHistoryBlock: (turnsForBlock) =>
                buildHistoryBlock(turnsForBlock, HISTORY_WINDOW),
            },
            maxContextTokens
          );
          if (!trimResult.fits) {
            emitDecline(LOCAL_CONTEXT_TOO_LONG_MESSAGE);
            return;
          }
          groundingHits = trimResult.hits;
          historyInPrompt = trimResult.historyTurns;
        }

        const workspaceBlock =
          groundingHits.length > 0
            ? buildWorkspaceContextBlock(groundingHits)
            : '';
        const historyBlock = buildHistoryBlock(historyInPrompt, HISTORY_WINDOW);
        // F2.5b (Codex round-4) — grounding is TRANSITIVE: this answer draws on
        // client file content from fresh hits AND from any file-grounded history in
        // its prompt (e.g. "summarize what you just said" with no fresh hits). So the
        // turn's durable marker + EFFECTIVE grounding scope (the broadest of every
        // contributing source) reflect BOTH, and the egress audit's fileToolsEnabled
        // is true whenever ANY client file content rode along in this send.
        const grounding = deriveTurnGrounding({
          hadFreshHits: groundingHits.length > 0,
          turnScope: turnConsentScope,
          historyTurns: historyInPrompt,
        });
        const fileToolsEnabled = grounding.usedFileContent;
        fileToolsEnabledForAudit = fileToolsEnabled;
        const readSourcesForPrompt = sourceIdentitiesFromSources(groundingHits);
        // BUG-016: the answer prompt is hardened to refuse fabrication. The model
        // must answer ONLY from the retrieved context, decline with the exact
        // NO_EVIDENCE_DECLINE wording when the context doesn't contain the answer,
        // and never state a figure/date/name or cite a source that isn't present in
        // the context. The citation-binding step below structurally drops any
        // citation that doesn't resolve to a grounding chunk. Files-only mode keeps
        // the strict "answer only from context or decline" prompt; smart mode uses
        // the source-aware advisor prompt. `hasEvidence` reflects the CONSENT-GATED
        // grounding set, so a consent-blocked cloud turn correctly leads with an
        // honest nothing-found block instead of a green, fake-cited claim.
        const systemPrompt = filesOnly
          ? buildAskSystemPrompt({
              scopeHint: matterHint,
              workspaceBlock,
              historyBlock,
            })
          : buildSmartAskSystemPrompt({
              scopeHint: matterHint,
              workspaceBlock,
              historyBlock,
              hasEvidence: groundingHits.length > 0,
            });

        const resolveEgressForSend = (): EgressInfo | null => {
          if (!providerAudit) return null;
          const egress = resolveEgress({
            provider: providerAudit.providerId,
            mode: getConfidentialityMode(),
            isDemo: IS_DEMO,
            hasDemoByokKey: hasDemoByokKey(),
            assuredAvailable: false,
          });
          // Receipts (B5): remember the route actually used for this send so
          // the answer's receipt line reflects the real egress, not a guess.
          egressForSend = egress;
          egressDestinationForReceipt = egress.destination;
          return egress;
        };

        const buildEgressEntry = (): AuditEntryInput | null => {
          if (!providerAudit) return null;
          const egress = egressForSend ?? resolveEgressForSend();
          if (!egress) return null;
          return auditEventToEntry({
            type: 'egress',
            timestamp: new Date().toISOString(),
            payload: {
              provider: egress.provider,
              model: providerAudit.model,
              mode: getConfidentialityMode(),
              destination: egress.destination,
              dataLeaves: egress.dataLeaves,
              scope: buildAuditScope(retrievalScope),
              readSources: readSourcesForPrompt,
              // F2.5 — was client file content actually part of this send?
              fileToolsEnabled,
            },
          });
        };

        const emitSuccessfulEgress = async (auditPairId: string) => {
          const entry = buildEgressEntry();
          if (!entry || !providerAudit) return;
          const providerId = providerAudit.providerId;
          await mustLogAuditPhase(onAuditLog, entry, 'outcome', auditPairId);
          // A real response came back from a cloud provider's key, so it is
          // proven to work — prefer it for future chats (mirrors the "Check"
          // button in ApiKeyManager and the Wizard's on-save verification).
          if (isVerifiableProvider(providerId)) {
            markKeyVerified(providerId);
          }
        };

        const buildModelCallEntry = (
          contentLength: number,
          usage?: { inputTokens?: number; outputTokens?: number },
          cost?: number
        ): AuditEntryInput | null => {
          if (!providerAudit) return null;
          return {
            action: 'model_call',
            description: `Search question to ${providerAudit.model}`,
            model: providerAudit.model,
            inputs: { promptLength: q.length },
            outputs: { contentLength },
            userDecision: 'auto',
            metadata: { chatId, askScope },
            tokensIn: usage?.inputTokens ?? 0,
            tokensOut: usage?.outputTokens ?? 0,
            costUsd: cost ?? 0,
            provider: providerAudit.providerId,
          };
        };

        // Fix 1b (demo readiness) — see waitForLocalAiSidecarReady's doc comment
        // in askTimeout.ts: a Local-only send must not let the 45s no-token
        // watchdog below start counting while the sidecar is still legitimately
        // cold-starting (which can take up to two minutes).
        await waitForLocalAiSidecarReady({
          providerId: providerAudit.providerId,
          checkHealth: localLlmSidecarHealth,
          startSidecar: localLlmSidecarStart,
          onStarting: (starting) => {
            if (starting) {
              failedStage = 'provider-send';
              providerCallStarted = true;
            }
            setLocalAiStarting(starting);
          },
        });
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- abort.signal flips via an external AbortController across the await (ESLint can't see it; same async pattern baselined elsewhere in this file).
        if (abort.signal.aborted) return;

        // QA-7 — the "Answering…" spinner had no ceiling: a stalled provider call
        // (most often the embedded local model still mid-download/load) left it
        // spinning forever with zero feedback. `watchdog` re-arms on every
        // streamed chunk (a long-but-progressing answer is never killed), fires
        // `onWarning` after ASK_ANSWER_WARNING_MS of silence (surfaces "taking
        // longer than expected" in the spinner), and rejects `stallPromise` after
        // ASK_ANSWER_TIMEOUT_MS so the race below turns true silence into an
        // honest, retryable error instead of an infinite hang. We do NOT abort
        // the shared AbortController here — same reasoning as the retrieval
        // timeout: an aborted signal reads as "user moved on, drop silently",
        // which would swallow the very error this exists to surface.
        let rejectStall: ((err: Error) => void) | undefined;
        const stallPromise = new Promise<never>((_resolve, reject) => {
          rejectStall = reject;
        });
        // lp/localai-patience — the embedded local engine runs prompt-eval on the
        // CPU, so a big RAG prompt is silent for a minute or more before its FIRST
        // token (measured: a 4,574-token prompt took ~70.5s of eval on the Legion),
        // even though the engine is working normally the whole time. The flat 45s
        // no-first-token ceiling therefore fired a FALSE timeout on a real local
        // Ask. So for the LOCAL provider we scale the FIRST-token budget with the
        // prompt size (base 45s + promptTokens/40s, capped 4min); the between-token
        // gap keeps the tight 45s ceiling, and cloud is unchanged (its budget is
        // the same 45s). While that generous first-token window is running we show
        // a calm "reading your documents" state (localEvaluating), never the
        // alarming stall warning, until the budget is genuinely exceeded.
        const isLocalSend = isLocalProvider(resolvedProvider.providerId);
        const estimatedPromptTokens =
          estimateTokens(systemPrompt) + estimateTokens(q);
        const firstTokenBudgetMs = computeAnswerFirstTokenBudgetMs({
          isLocal: isLocalSend,
          estimatedPromptTokens,
        });
        // lp/localai-patience (round 2) — the UI watchdog above is not the only
        // clock: the LOCAL providers wrap their fetch in composeRequestSignal with
        // a 120s whole-request timeout (DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS), which
        // would abort the request FIRST on a big local prompt whose scaled budget
        // exceeds 120s — so the intended 159s/240s patience is never honoured. For
        // a local send, hand the provider a matching timeout so the two clocks
        // agree. We take the MAX of the default and the budget so a SMALL local
        // prompt (budget < 120s) keeps today's 120s request ceiling rather than
        // shrinking it — a small prompt with a long GENERATION must not be cut
        // short. Cloud sends pass `undefined` and keep the provider default.
        const providerRequestTimeoutMs: number | undefined = isLocalSend
          ? Math.max(DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS, firstTokenBudgetMs)
          : undefined;
        const watchdog = createAnswerStallWatchdog({
          onWarning: (phase) => {
            // A local send that has produced NO token yet is normal prompt-eval,
            // not a stall — reassure calmly instead of alarming. Every other case
            // (any cloud silence, or a local stall AFTER tokens began streaming)
            // is a genuine stall and keeps the existing warning.
            if (isLocalSend && phase === 'first-token') {
              setLocalEvaluating(true);
            } else {
              setAnswerStalled(true);
            }
          },
          onTimeout: () => {
            rejectStall?.(new AskTimeoutError('answer', ASK_ANSWER_TIMEOUT_MS));
          },
          firstTokenTimeoutMs: firstTokenBudgetMs,
        });
        try {
          const auditPairId = createAuditPairId('ask');
          // Preparation must be the first durable record for this request. If
          // the advisor cancels or this background-safe gate blocks, there is
          // no egress intent to record because nothing can leave the device.
          const preparedAuditLogger: AuditLogSink = (entry) => {
            if (entry.action !== 'prompt_preparation') return;
            onAuditLog?.(entry);
          };
          const saveDurableIntent = async () => {
            const egressIntent = buildEgressEntry();
            if (egressIntent) {
              await mustLogAuditPhase(onAuditLog, egressIntent, 'intent', auditPairId);
            }
            const modelCallIntent = buildModelCallEntry(0);
            if (modelCallIntent) {
              await mustLogAuditPhase(onAuditLog, modelCallIntent, 'intent', auditPairId);
            }
          };
          if (typeof provider.sendMessageStreaming === 'function') {
            failedStage = 'provider-send';
            providerCallStarted = true;
            resolveEgressForSend();
            const streamResp = await Promise.race([
              sendPreparedStreamingWithEgressAudit({
                provider,
                providerId: providerAudit.providerId,
                model: providerAudit.model,
                surface: 'ask',
                prompt: q,
                options: {
                  systemPrompt,
                    // lp/localai-patience (round 2) — align the provider's whole-
                    // request timeout with the UI first-token budget for local sends.
                    ...(providerRequestTimeoutMs !== undefined
                      ? { requestTimeoutMs: providerRequestTimeoutMs }
                      : {}),
                    onChunk: (chunk) => {
                      if (abort.signal.aborted) return;
                      watchdog.markProgress();
                      setAnswerStalled(false);
                      // lp/localai-patience — the first token means eval is done and
                      // generation has begun; drop the calm "reading your documents"
                      // state so the streamed answer replaces the spinner.
                      setLocalEvaluating(false);
                      answerText += chunk;
                      setStreamingTurn((prev) =>
                        prev ? { ...prev, answer: answerText } : prev
                      );
                    },
                  signal: abort.signal,
                },
                parts: [
                  { id: 'prompt', origin: 'typed_question', label: 'Your question', text: q },
                  { id: 'retrieval', origin: 'retrieval', label: 'Retrieved workspace material', text: workspaceBlock },
                  { id: 'chat-history', origin: 'chat_history', label: 'Earlier Ask answers', text: historyBlock },
                ],
                onAuditLog: preparedAuditLogger,
                beforeEgress: saveDurableIntent,
              }),
              stallPromise,
            ]);
            answerText = streamResp.content;
            await emitSuccessfulEgress(auditPairId);
            const modelCallOutcome = buildModelCallEntry(answerText.length, streamResp.usage, streamResp.cost);
            if (modelCallOutcome) {
              await mustLogAuditPhase(onAuditLog, modelCallOutcome, 'outcome', auditPairId);
            }
          } else {
            failedStage = 'provider-send';
            providerCallStarted = true;
            resolveEgressForSend();
            const resp = await Promise.race([
              sendPreparedMessageWithEgressAudit({
                provider,
                providerId: providerAudit.providerId,
                model: providerAudit.model,
                surface: 'ask',
                prompt: q,
                options: {
                  systemPrompt,
                  // lp/localai-patience (round 2) — same alignment for the non-
                  // streaming path (local sends only; cloud keeps its default).
                  ...(providerRequestTimeoutMs !== undefined
                    ? { requestTimeoutMs: providerRequestTimeoutMs }
                    : {}),
                },
                scope: buildAuditScope(retrievalScope),
                fileToolsEnabled,
                isDemo: IS_DEMO,
                hasDemoByokKey: hasDemoByokKey(),
                onAuditLog: preparedAuditLogger,
                beforeEgress: saveDurableIntent,
                parts: [
                  { id: 'prompt', origin: 'typed_question', label: 'Your question', text: q },
                  { id: 'retrieval', origin: 'retrieval', label: 'Retrieved workspace material', text: workspaceBlock },
                  { id: 'chat-history', origin: 'chat_history', label: 'Earlier Ask answers', text: historyBlock },
                ],
              }),
              stallPromise,
            ]);
            if (isVerifiableProvider(providerAudit.providerId)) {
              markKeyVerified(providerAudit.providerId);
            }
            answerText = resp.content;
            await emitSuccessfulEgress(auditPairId);
            const modelCallOutcome = buildModelCallEntry(answerText.length, resp.usage, resp.cost);
            if (modelCallOutcome) {
              await mustLogAuditPhase(onAuditLog, modelCallOutcome, 'outcome', auditPairId);
            }
          }
        } finally {
          watchdog.cancel();
          setAnswerStalled(false);
          setLocalEvaluating(false);
        }

        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (abort.signal.aborted) return;

        /* Step 3: parse and attach citations.
         * A citation is kept only when it points at a real retrieved chunk. Newer
         * rows can also be verified by id + matterId, but older indexed rows are
         * still grounded when the cited file + locator were actually retrieved.
         */
        const expectedMatterId: string | null =
          activeMatter && askScope !== 'all-matters' ? activeMatter.id : null;
        failedStage = 'post-processing';
        // Files-only mode: bind the whole answer flatly (the existing cited path).
        // Smart mode: parse the answer into provenance blocks and bind citations
        // ONLY inside files blocks — the same structural grounding net, applied
        // per-block, so a green chip can never sit over general/draft prose.
        let rewritten: string;
        let boundCitations: AnswerCitation[];
        let sources: WorkspaceSource[];
        let blocks: AnswerBlock[] | undefined;
        if (filesOnly) {
          // F2.5 — bind against `groundingHits` (the CONSENT-GATED set actually sent
          // to the model), never `hits`. A consent-blocked cloud turn has an empty
          // grounding set, so it can never produce a green citation over content
          // that never left the machine.
          const bound = bindAnswerCitations(
            answerText,
            groundingHits,
            expectedMatterId
          );
          rewritten = bound.answer;
          boundCitations = bound.citations;
          sources = bound.sources;
        } else {
          const bound = bindAnswerBlocks(
            answerText,
            groundingHits,
            expectedMatterId
          );
          rewritten = bound.answer;
          boundCitations = bound.citations;
          sources = bound.sources;
          blocks = bound.blocks;
        }
        // Cosmetic: name email citations by their subject line instead of the raw
        // `mail:<id>` message-id (display-only; path/verification untouched).
        const citations = await resolveEmailCitationLabels(boundCitations);
        // Keep block-level citation copies in sync with the relabelled email
        // subjects (block chips read their own citations array).
        if (blocks) {
          const byN = new Map(citations.map((c) => [c.n, c]));
          blocks = blocks.map((b) => ({
            ...b,
            citations: b.citations.map((c) => byN.get(c.n) ?? c),
          }));
        }

        const completedTurn: AskTurn = {
          question: q,
          answer: rewritten,
          citations,
          sources,
          ...(blocks ? { blocks } : {}),
          readSources: readSourcesForPrompt,
          providerId: providerAudit.providerId,
          ...(egressDestinationForReceipt ? { egressDestination: egressDestinationForReceipt } : {}),
          // F2.5b (Codex P1) — durable "this answer used client file content"
          // marker, from the consent-gated grounding set (not the rendered
          // citations), so a grounded-but-uncited answer is still redacted from
          // history on a later denied/wrong-scope cloud send.
          groundedFromFiles: fileToolsEnabled,
          // F2.5b (Codex round 3/4) — the EFFECTIVE scope the content was grounded
          // under (broadest of fresh retrieval + file-grounded history), so history
          // redaction can require the current consent to cover it.
          ...(grounding.scope ? { groundingScope: grounding.scope } : {}),
        };

        // Persist to store as two ChatMessage entries.
        // A1: persist askCitations + askSources on the assistant message so that
        // clickable {n} chips and the Verified source panel survive navigation/reload.
        // Ask-smart: also persist askBlocks (kind + text only) so the provenance
        // labels + per-answer tally survive reload; citations re-attach to blocks
        // from askCitations on reconstruct.
        //
        // PRIVACY (review P2): persist askSources ONLY when there are citations,
        // and TRIM them to the sources a citation actually references. Retrieval
        // runs before EVERY smart answer, so a general / draft / nothing-found
        // reply (zero citations) must NOT store the raw retrieved client chunks
        // that were never cited or shown — that contradicts "general answers have
        // nothing to cite" and bloats history. Reconstruct only needs the cited
        // sources to re-ground their citations on reload.
        const citedSources =
          citations.length > 0
            ? sources.filter((s) =>
                citations.some(
                  (c) =>
                    c.path === s.path &&
                    (s.paragraphIndex === c.paragraphIndex ||
                      s.pageNumber === c.paragraphIndex)
                )
              )
            : [];
        const now = new Date().toISOString();
        const userMsg: ChatMessage = {
          role: 'user',
          content: q,
          timestamp: now,
        };
        const assistantMsg: ChatMessage = {
          role: 'assistant',
          content: rewritten,
          timestamp: now,
          ...(citations.length > 0
            ? { askCitations: citations, askSources: citedSources }
            : {}),
          ...(blocks
            ? { askBlocks: blocks.map((b) => ({ kind: b.kind, text: b.text })) }
            : {}),
          askReadSources: readSourcesForPrompt,
          askProviderId: providerAudit.providerId,
          ...(egressDestinationForReceipt ? { askEgressDestination: egressDestinationForReceipt } : {}),
          // F2.5b (Codex P1) — persist the file-grounding marker so history redaction
          // still works after a reload (reconstructTurns restores it).
          // F2.5b (Codex round 5) — persist the grounding decision ALWAYS (true OR
          // false), so a reconstructed turn with an ABSENT marker is known to be
          // legacy (pre-fix) and can fail closed. A definite `false` is what proves
          // a general answer is safe to keep in a later narrowed cloud send.
          askGroundedFromFiles: fileToolsEnabled,
          // F2.5b (Codex round 3/4) — persist the EFFECTIVE grounding scope for
          // scope-aware history redaction after a reload.
          ...(grounding.scope ? { askGroundingScope: grounding.scope } : {}),
        };
        addMessage(chatId, userMsg);
        addMessage(chatId, assistantMsg);

        // Add completed turn to local state.
        // Fix #2: auto-selection is handled by the useEffect below keyed on turns.length,
        // so we do NOT call setSelectedTurnIdx / setSelected inside the updater — doing so
        // inside the functional updater can leave them out of sync for one frame.
        setTurns((prev) => [...prev, completedTurn]);
        onAnswerCompleted?.(completedTurn);
        setStreamingTurn(null);
        setStatus('done');
        pendingQuestionRef.current = null;
      } catch (err) {
        if (abort.signal.aborted) return;
        console.error('Ask failed', err);
        if (providerCallStarted && providerAudit) {
          const egress = resolveEgress({
            provider: providerAudit.providerId,
            mode: getConfidentialityMode(),
            isDemo: IS_DEMO,
            hasDemoByokKey: hasDemoByokKey(),
            assuredAvailable: false,
          });
          onAuditLog?.({
            action: 'user_action',
            description: `Search request failed before a response from ${providerAudit.providerId}`,
            model: providerAudit.model,
            inputs: {
              provider: egress.provider,
              model: providerAudit.model,
              mode: getConfidentialityMode(),
              destination: egress.destination,
              dataLeaves: egress.dataLeaves,
              scope:
                activeMatter && askScope !== 'all-matters'
                  ? {
                      kind: 'matter',
                      matterId: activeMatter.id,
                      matterName: matterLabel(activeMatter),
                    }
                  : { kind: 'allMatters' },
            },
            outputs: {
              success: false,
              reason: err instanceof Error ? err.message : String(err),
            },
            userDecision: 'auto',
            metadata: {
              auditEventType: 'egress_failed',
              provider: egress.provider,
              model: providerAudit.model,
              mode: getConfidentialityMode(),
              destination: egress.destination,
              dataLeaves: egress.dataLeaves,
              // F2.5b (Codex P2) — a failed send may already have reached the
              // provider WITH file content; record it so the audit isn't silent.
              fileToolsEnabled: fileToolsEnabledForAudit,
            },
          });
        }
        const raw = err instanceof Error ? err.message : '';
        // Fix 3 (connect-flow demo hardening): a genuine auth rejection from the
        // resolved cloud provider means the stored key is bad — record it so a
        // new chat never defaults back to it (mirrors the "Check" button in
        // ApiKeyManager). Uses the SAME classification friendlyErrorMessage uses
        // below, so the "your key was rejected" copy and this marker can never
        // disagree about what counts as an auth failure.
        if (
          providerCallStarted &&
          providerAudit &&
          isVerifiableProvider(providerAudit.providerId) &&
          isAuthRejectionError(raw, {
            mode: getConfidentialityMode(),
            reachedProvider: providerCallStarted,
          })
        ) {
          markKeyInvalid(providerAudit.providerId);
        }
        // Fix #4 / UX-29: plain-language copy that is mode- and stage-aware.
        // `providerCallStarted === false` means the failure was in the file-search
        // stage (not the AI/key), so the message must not blame a key.
        // QA-7: a stalled-answer timeout gets its own honest copy naming the most
        // likely cause (local model still downloading/loading) instead of the
        // generic "couldn't get an answer" fallback.
        setErrorMsg(
          isConfidentialityChoiceRequiredError(err)
            ? err.message
            : isAskTimeoutError(err) && err.stage === 'answer'
              ? ASK_ANSWER_STALL_ERROR_MESSAGE
              : friendlyErrorMessage(raw, {
                  mode: getConfidentialityMode(),
                  reachedProvider: providerCallStarted,
                  failedStage,
                })
        );
        setAnswerStalled(false);
        setLocalAiStarting(false);
        setLocalEvaluating(false);
        setStreamingTurn(null);
        setStatus('error');
        pendingQuestionRef.current = null;
        // BUG-002: restore the typed question so the user can retry without
        // re-typing. The input was cleared optimistically before the try block;
        // on error we put it back.
        setQuestion(q);
      }
    },
    [
      question,
      status,
      activeMatter,
      turns,
      chatId,
      addMessage,
      rootPath,
      askScope,
      profession,
      filesOnly,
      onAuditLog,
      buildAuditScope,
      confirmExportConsent,
      onAnswerCompleted,
    ]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        void handleAsk();
      }
    },
    [handleAsk]
  );

  const handleSaveToDocument = useCallback(
    async (idx: number, content: string) => {
      if (!onSaveToDocument) return;
      setSavingIdx(idx);
      try {
        await onSaveToDocument(content);
      } finally {
        setSavingIdx(null);
      }
    },
    [onSaveToDocument]
  );

  const isBusy = status === 'retrieving' || status === 'answering';

  return {
    activeMatter,
    isSampleMatterActive,
    demoQuestions,
    chatId,
    askScope,
    setAskScope,
    turns,
    streamingTurn,
    question,
    setQuestion,
    selected,
    selectedTurnIdx,
    errorMsg,
    crmUnavailableNotice,
    status,
    answerStalled,
    localAiStarting,
    localEvaluating,
    savingIdx,
    displayedProvider,
    confidentialityMode,
    bottomRef,
    composerInputRef,
    railSessions,
    railCollapsed,
    toggleRailCollapsed,
    filesOnly,
    setFilesOnly,
    stillImporting,
    selectedCite,
    anyHasCitations,
    handleCitationSelect,
    handleNewAsk,
    handleLoadSession,
    handleRenameSession,
    handleAsk,
    handleKeyDown,
    handleSaveToDocument,
    onOpenFileAtPath,
    isBusy,
    // Connector-access: props for the one-time export-consent dialog.
    exportConsentDialogProps,
    // F2.5 — per-conversation file-access consent for the composer banner.
    fileAccessConsent,
    fileAccessConsentScope,
    setFileAccessConsent,
  };
}
