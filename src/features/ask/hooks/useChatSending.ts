// useChatSending — the send + compress orchestration for AIChatViewer.
//
// Extracted VERBATIM from AIChatViewer.tsx so the viewer is a thinner render +
// wiring shell. Three callbacks move together as a unit because they are
// coupled: handleSendMessage defers to handleManualCompress (the over-limit
// "compress then resend" path), and handleManualCompress builds its summariser
// via buildFastProvider. buildFastProvider is internal to this hook; the other
// two are returned. The compression-modal STATE stays in the component (it is
// read + set by the render); only its setters are passed in here.
//
// Every dependency is destructured from `deps` at the top so the function
// bodies — and their useCallback dependency arrays — are copied byte-for-byte
// from the previous revision. Do not "fix" exhaustive-deps here.

import { useCallback, useRef } from 'react';
import type { useTranslation } from 'react-i18next';
import { AttachmentService } from '@/features/ask/attachments/AttachmentService';
import type { WorkspaceService } from '@/platform/fs/WorkspaceService';
import { estimateImageTokens } from '@/features/ask/attachments/imageTokens';
import { estimatePdfTokens } from '@/features/ask/attachments/pdfTokens';
import type { PdfExtractionResult } from '@/lib/pdf-extract';
import type { ChatAttachment, AIChatFile, ChatMessage, WorkspaceSource, TurnScope } from '@/platform/types/ai';
import type { AuditEntry, AuditScope, CitationVerdict } from '@/platform/types/audit';
import { auditEventToEntry } from '@/platform/audit/AuditService';
import { resolveEgress } from '@/platform/privacy/egress';
import { getConfidentialityMode } from '@/platform/hooks/useConfidentialityMode';
import type { Provider, AttachmentBytes } from '@/platform/providers/Provider';
import { ClaudeProvider } from '@/platform/providers/ClaudeProvider';
import { OpenAIProvider } from '@/platform/providers/OpenAIProvider';
import { GeminiProvider } from '@/platform/providers/GeminiProvider';
import { OllamaProvider } from '@/platform/providers/OllamaProvider';
import { KeepanceLocalProvider } from '@/platform/providers/KeepanceLocalProvider';
import { isLocalProviderId } from '@/platform/providers/providerFactory';
import {
  effectiveChatProvider,
  resolveAvailableProviders,
  type LocalModelAvailability,
} from '@/features/ask/chat/providerModelResolution';
import { assertLocalOnlyAllowsSend, assertCloudGenerationAllowed, isLocalOnlyMode, LocalOnlyEgressError } from '@/platform/privacy/localOnlyGuard';
import { resolveAssuredRoute } from '@/platform/firm/resolveAssuredRoute';
import { IS_DEMO } from '@/web-demo/demoModeFlag';
import { createDemoProvider } from '@/web-demo/demoAIProvider';
import { isTauriProductionBuild, parseApiError, ApiResponseParseError } from '@/platform/providers/fetchUtils';
import { FILE_ACCESS_TOOLS } from '@/platform/tools/fileAccessTools';
import type { useActiveMatter } from '@/platform/matter/matterStore';
import { getActiveScope, useMatterStore } from '@/platform/matter/matterStore';
import { matterLabel } from '@/platform/rag/matterResolver';
import { pathInMatterScope } from '@/platform/matter/matterScopeGuard';
import { useEditorStore, tabHasUnsavedEdits, isFileOpenInEditor, hasOpenDescendant } from '@/platform/state/editorStore';
import { useSettingsStore } from '@/platform/settings/settingsStore';
import { isBinaryFile } from '@/platform/utils/file-utils';
import { moveToTrash } from '@/platform/history/trashFile';
import {
  classifyWriteOp,
  needsPreApproval,
  coerceApprovalMode,
  type AiWriteOp,
} from '@/platform/ai/aiWriteApproval';
import { useAiApprovalStore } from '@/platform/ai/aiApprovalStore';
import { useAiBatchReviewStore } from '@/platform/ai/aiBatchReviewStore';
import type { BatchChangeInput } from '@/platform/ai/aiBatchReview';
import type { RetrievalScope } from '@/platform/utils/tauri-commands';
import type { ExtractedContext } from '@/platform/utils/ai-file-context';
import { filterByScope } from '@/platform/utils/client-boundary';
import {
  compressMessages,
  getMessagesForSend,
  clearExpandedFlags,
  estimateMessagesTokens,
  estimateTokens,
} from '@/features/ask/compression';
import { MemoryService, isMemoryEnabled } from '@/platform/rag/MemoryService';
import {
  DEFAULT_WORKSPACE_TOP_K,
  buildWorkspaceContextBlock,
  normalizeNumericCitations,
  parseWorkspaceCommand,
  verifyCitations,
} from '@/platform/rag/workspaceCommand';
import { buildFactsMemoryBlock } from '@/platform/rag/FactsService';
import { snapshotFactsForInjection } from '@/platform/rag/factsSingleton';
import type { ChatSession, ChatCostEntry } from '@/platform/state/aiChatStore';
// buildOpenFilesPromptBlock + refusalKeyForReason stay exported from AIChatViewer
// (external importers: useTestModeWorkspace, refusal-key.test). The deferred,
// hoisted-function usage below makes this back-import cycle-safe.
import { buildOpenFilesPromptBlock, refusalKeyForReason } from '../AIChatViewer';
import type { APIKey } from '../AIChatViewer';
import { sendDiagnosticEvent } from '@/platform/utils/diagnostics';
import { getEntityLabel } from '@/platform/hooks/useEntityLabel';

export interface UseChatSendingDeps {
  // Props forwarded from AIChatViewer.
  chatData: AIChatFile;
  /** Whether the embedded Keepance Local AI model is ready — so a chat with no
   *  saved provider resolves to 'keepance-local' (on-device) instead of a cloud
   *  fallback. Keeps the send path in agreement with the egress badge. */
  localAvailability: LocalModelAvailability;
  onSave: ((updatedChat: AIChatFile) => void) | undefined;
  apiKeys: APIKey[];
  workspaceServiceRef: React.MutableRefObject<WorkspaceService | null> | undefined;
  rootPath: string | undefined;
  onFileTreeChange: (() => void) | undefined;
  onAuditLog: ((entry: Omit<AuditEntry, 'id' | 'timestamp'>) => void) | undefined;
  // Hook + store values.
  t: ReturnType<typeof useTranslation>['t'];
  assuredAvailableForChat: boolean;
  sessions: Record<string, ChatSession>;
  addMessage: (chatId: string, message: ChatMessage) => void;
  updateLastMessage: (chatId: string, content: string) => void;
  updateMessages: (chatId: string, messages: ChatMessage[]) => void;
  setLoading: (chatId: string, isLoading: boolean) => void;
  clearDraftInput: (chatId: string) => void;
  recordCost: (chatId: string, entry: ChatCostEntry) => void;
  chatId: string;
  askWorkspaceMode: boolean;
  scopedFolder: string | null;
  activeMatter: ReturnType<typeof useActiveMatter>;
  includePrivileged: boolean;
  messages: ChatMessage[];
  isLoading: boolean;
  aiRules: string;
  openFiles: ExtractedContext[];
  scopedOpenFiles: ExtractedContext[];
  inputValue: string;
  pendingAttachments: ChatAttachment[];
  previewUrls: Record<string, string>;
  chatContextTokenLimit: number;
  keepRecentTurns: number;
  // State setters (stable; intentionally absent from the dep arrays).
  setInputValue: React.Dispatch<React.SetStateAction<string>>;
  setMissingSourceWarning: React.Dispatch<React.SetStateAction<string | null>>;
  setPendingAttachments: React.Dispatch<React.SetStateAction<ChatAttachment[]>>;
  setPreviewUrls: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setPdfExtractions: React.Dispatch<React.SetStateAction<Record<string, PdfExtractionResult>>>;
  setCompressedTokensBefore: React.Dispatch<React.SetStateAction<number>>;
  setPendingCompressAndSend: React.Dispatch<React.SetStateAction<(() => Promise<void>) | null>>;
  setCompressionModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  // Refs.
  abortControllerRef: React.MutableRefObject<AbortController | null>;
}

export function useChatSending(deps: UseChatSendingDeps) {
  const {
    chatData,
    localAvailability,
    onSave,
    apiKeys,
    workspaceServiceRef,
    rootPath,
    onFileTreeChange,
    onAuditLog,
    t,
    assuredAvailableForChat,
    sessions,
    addMessage,
    updateLastMessage,
    updateMessages,
    setLoading,
    clearDraftInput,
    recordCost,
    chatId,
    askWorkspaceMode,
    scopedFolder,
    activeMatter,
    includePrivileged,
    messages,
    isLoading,
    aiRules,
    openFiles,
    scopedOpenFiles,
    inputValue,
    pendingAttachments,
    previewUrls,
    chatContextTokenLimit,
    keepRecentTurns,
    setInputValue,
    setMissingSourceWarning,
    setPendingAttachments,
    setPreviewUrls,
    setPdfExtractions,
    setCompressedTokensBefore,
    setPendingCompressAndSend,
    setCompressionModalOpen,
    abortControllerRef,
  } = deps;
  const bypassNextContextLimitRef = useRef(false);

  const buildFastProvider = useCallback((): import('@/platform/providers/Provider').Provider | null => {
    // The provider this chat actually targets (never a hidden cloud fallback
    // when the embedded local model is ready — see effectiveChatProvider).
    // Key-aware so a no-key chat resolves to 'none' (not a fabricated cloud one).
    const chatProvider = effectiveChatProvider(
      chatData.provider,
      localAvailability,
      resolveAvailableProviders(apiKeys),
    );
    // Privacy: if the local-model status probe is still resolving we don't know
    // the destination — refuse to build a "fast" compression provider rather
    // than guess a cloud one (the send button is disabled in this window too).
    // 'none' means no provider is configured at all — nothing to build.
    if (chatProvider === null || chatProvider === 'none') return null;
    // BUG-021 (privacy): chat compression sends prior messages to a "fast"
    // provider before the main send guard runs. In Local-only mode, force the
    // local model so compression can't leak to the cloud.
    if (isLocalOnlyMode()) {
      // Use the chat's ACTUAL local engine for compression so a Keepance Local
      // AI chat isn't silently rerouted to the user's Ollama daemon (which may
      // not even be running). Both stay fully on-device.
      return chatProvider === 'keepance-local'
        ? new KeepanceLocalProvider({})
        : new OllamaProvider({});
    }
    // Personal-install choice gate (Task 1.3 fix): compression is cloud generation;
    // block it until the user has made an explicit confidentiality choice.
    // assertCloudGenerationAllowed throws synchronously — buildFastProvider is
    // called inside try/catch in handleManualCompress, so the error surfaces
    // as the inline error message without crashing the send path.
    assertCloudGenerationAllowed(chatProvider);
    const apiKey = apiKeys.find(k => k.provider === chatProvider && k.isValid);
    if (!apiKey) return null;
    switch (chatProvider) {
      case 'anthropic':
        return new ClaudeProvider({ apiKey: apiKey.key, model: 'claude-3-5-haiku-latest' });
      case 'openai':
        return new OpenAIProvider({ apiKey: apiKey.key, model: 'gpt-4o-mini' });
      case 'google':
        return new GeminiProvider({ apiKey: apiKey.key, model: 'gemini-1.5-flash' });
      default:
        // Ollama and unknown providers cannot compress.
        return null;
    }
  }, [chatData.provider, localAvailability, apiKeys]);

  const handleManualCompress = useCallback(async () => {
    const currentMessages = sessions[chatId]?.messages ?? chatData.messages;
    try {
      // buildFastProvider() can throw ConfidentialityChoiceRequiredError (Task 1.3).
      // Building inside the try surfaces it as a clean inline message instead of an
      // uncaught rejection.
      const fastProvider = buildFastProvider();
      if (!fastProvider) {
        // Surface error to user: Ollama-only or no API key.
        addMessage(chatId, {
          role: 'assistant',
          content: 'Compression requires a fast cloud model. Configure Claude, OpenAI, or Gemini to enable compression.',
          timestamp: new Date().toISOString(),
          isError: true,
        });
        return;
      }
      const tokensBefore = estimateMessagesTokens(currentMessages);
      const result = await compressMessages(currentMessages, {
        keepRecentTurns,
        batchTokenTarget: 10_000,
        fastProvider,
      });
      const tokensAfter = result.resultingTokens;
      if (onSave) {
        onSave({ ...chatData, messages: result.messages, updated: new Date().toISOString() });
      }
      // Log context_compressed audit event.
      if (onAuditLog) {
        onAuditLog({
          action: 'context_compressed',
          description: `Compressed ${result.originalCount} messages: ${tokensBefore} -> ${tokensAfter} tokens`,
          model: chatData.model,
          inputs: { messagesBefore: currentMessages.length, tokensBefore },
          outputs: { messagesAfter: result.messages.filter(m => !m.compressedIntoId).length, tokensAfter },
          userDecision: 'approved',
          metadata: {},
        });
      }
    } catch (err) {
      addMessage(chatId, {
        role: 'assistant',
        content: `Compression failed: ${err instanceof Error ? err.message : String(err)}`,
        timestamp: new Date().toISOString(),
        isError: true,
      });
    }
    setCompressionModalOpen(false);
  }, [sessions, chatId, chatData, buildFastProvider, keepRecentTurns, onSave, onAuditLog, addMessage]);

  const handleSendMessage = useCallback(async () => {
    if ((!inputValue.trim() && pendingAttachments.length === 0) || isLoading) return;
    // The provider this send ACTUALLY targets — must match the egress badge.
    // A chat with no saved provider resolves to the embedded local model when
    // it is ready, never to a hidden cloud fallback (see effectiveChatProvider).
    const effectiveProvider = effectiveChatProvider(
      chatData.provider,
      localAvailability,
      resolveAvailableProviders(apiKeys),
    );
    // Privacy: while the local-model status probe is unresolved we don't know
    // where this would go — block the send (the composer is disabled in this
    // window too) rather than guess a cloud default and leak. Silent, like the
    // empty-input / already-loading guards above.
    if (effectiveProvider === null) return;
    // No provider configured at all (no valid key, no on-device model). Surface
    // a clear, honest message instead of a confusing "No valid none API key"
    // error — and matching the egress badge that now reads "No AI connected".
    if (effectiveProvider === 'none') {
      addMessage(chatId, {
        role: 'assistant',
        content: 'No AI provider is connected. Add an API key in Settings, or set up local AI, to start chatting.',
        timestamp: new Date().toISOString(),
        isError: true,
      });
      return;
    }
    const bypassContextLimit = bypassNextContextLimitRef.current;
    bypassNextContextLimitRef.current = false;

    // WS6 diagnostics — structural, gated, fire-and-forget. No content captured.
    void sendDiagnosticEvent({ event: 'feature_used', feature: 'ask' }).catch(() => undefined);

    // Audit (3.0 provenance) — emit one `citation_verified` event per citation
    // checked against the local store. Passed into `verifyCitations` so the
    // verification loop stays in one place; a misquote / cross-matter / fabricated
    // cite is recorded the moment it is caught.
    const emitCitationVerified = (citationId: string, verdict: CitationVerdict) => {
      onAuditLog?.(auditEventToEntry({
        type: 'citation_verified',
        timestamp: new Date().toISOString(),
        payload: { citationId, verdict },
      }));
    };

    const rawContent = inputValue.trim();
    const parsed = parseWorkspaceCommand(rawContent);
    // M2 — retrieval triggers when the user explicitly tagged
    // `@workspace`, or when the Ask-my-workspace mode is on for this
    // chat. We call MemoryService (not raw ragRetrieve) so the Settings
    // toggle is respected with a clean `[]` short-circuit when off.
    const shouldRetrieve = parsed.hasCommand || askWorkspaceMode;
    let retrievedSources: WorkspaceSource[] = [];
    let workspaceHint: string | undefined;
    // Option B: the raw retrieval error, kept separate from the user-facing
    // hint so the refusal below can route on the `model-not-ready` marker
    // without ever rendering the raw error string.
    let retrievalFailure: unknown;
    // WS-B/C — resolve the retrieval scope from the active matter. Captured at
    // send time so a later rename/delete of the matter doesn't rewrite history.
    // A null active matter is the explicit cross-matter ("all matters") scope.
    const retrievalScope: RetrievalScope = activeMatter
      ? { kind: 'matter', matterId: activeMatter.id }
      : { kind: 'allMatters' };
    const turnScope: TurnScope = activeMatter
      ? { kind: 'matter', matterId: activeMatter.id, matterName: matterLabel(activeMatter) }
      : { kind: 'allMatters' };
    if (shouldRetrieve) {
      if (!isMemoryEnabled()) {
        workspaceHint =
          "Memory is off; this message wasn't workspace-aware.";
      } else {
        // If the user typed only `@workspace`, reuse the last user
        // turn(s) as the retrieval query so the retriever has
        // something to embed. Fall back to the raw message when no
        // prior user turn exists.
        let retrievalQuery = parsed.query;
        if (retrievalQuery.length === 0) {
          const priorUserTurns = messages
            .filter((m) => m.role === 'user')
            .slice(-2)
            .map((m) => m.content)
            .join('\n');
          retrievalQuery = priorUserTurns || rawContent;
        }
        try {
          // WS-B/C — scope retrieval to the ACTIVE matter. The backend
          // prefilters by matter so other clients' chunks can never be
          // returned. We never silently pass AllMatters when a matter is
          // active; the scope object above is the single source of truth.
          // WS-PRIV — privileged content is excluded UNLESS the user has
          // explicitly turned on "Include privileged sources" (captured at send
          // time). The default (false) keeps privileged work out of retrieval.
          // WS3d-A — read the (default-OFF) reranker toggle per call. When off,
          // retrieval is byte-for-byte the vector-only path; when on, the
          // backend re-orders within the same already-scoped candidate set.
          const enableReranker =
            useSettingsStore.getState().getSetting<boolean>('enableReranker');
          const enableHybridSearch =
            useSettingsStore.getState().getSetting<boolean>('enableHybridSearch');
          const hits = await MemoryService.retrieve(
            retrievalQuery,
            DEFAULT_WORKSPACE_TOP_K,
            retrievalScope,
            includePrivileged,
            undefined,
            enableReranker,
            enableHybridSearch,
          );
          // D1 — filter workspace retrieval results to the active folder scope
          // so @workspace searches don't surface documents from other client
          // folders when the chat is scoped to a specific folder.
          const filteredHits = scopedFolder && rootPath
            ? hits.filter((h) => {
                const scopedPaths = filterByScope([h.path], rootPath, scopedFolder);
                return scopedPaths.length > 0;
              })
            : hits;
          retrievedSources = filteredHits.map((h) => ({
            path: h.path,
            chunkText: h.chunkText,
            score: h.score,
            paragraphIndex: h.paragraphIndex,
            // A3: include sourceType + pageNumber so citation clicks can open
            // PDF viewer at the correct page.
            ...(h.sourceType !== undefined ? { sourceType: h.sourceType } : {}),
            ...(h.pageNumber !== undefined ? { pageNumber: h.pageNumber } : {}),
            // VG-2: OCR provenance + confidence so citations disclose scans.
            ...(h.extraction !== undefined ? { extraction: h.extraction } : {}),
            ...(h.extractionConfidence !== undefined
              ? { extractionConfidence: h.extractionConfidence }
              : {}),
            // VG-3c: page:line locator so transcript citations read
            // "Tr. 45:12-46:3".
            ...(h.locator !== undefined ? { locator: h.locator } : {}),
            // WS-B/C: carry the citation key, matter, and resolvable source id
            // so citations can be verified + resolved (file vs email).
            ...(h.id !== undefined ? { id: h.id } : {}),
            ...(h.matterId !== undefined ? { matterId: h.matterId } : {}),
            ...(h.sourceId !== undefined ? { sourceId: h.sourceId } : {}),
          }));
        } catch (err) {
          console.error('Workspace retrieval failed:', err);
          retrievalFailure = err;
          workspaceHint =
            "Workspace retrieval failed; this message wasn't workspace-aware.";
        }

        // F-116 — "Avianca trap" guard (throw path): if retrieval FAILED while
        // the user had "Ask my workspace" ON, do NOT proceed to call the model
        // and produce a confident-looking answer with no grounding. Instead,
        // post a refusal assistant message and return WITHOUT calling the model.
        //
        // Rationale: the user explicitly opted into workspace-grounded answers.
        // Silently answering from general knowledge — with a thin yellow warning
        // — produces exactly the Avianca-style fabrication risk the feature is
        // meant to prevent. The safe choice is to refuse until grounding works.
        //
        // This applies whether the failure is "browser RAG unavailable" or a
        // genuine retrieval error. The user can turn off "Ask my workspace" to
        // get a general (ungrounded) answer if they choose.
        if (workspaceHint && workspaceHint.includes('retrieval failed')) {
          // Extract a clean reason from the hint for the locale string.
          const reason = workspaceHint;
          // Option B: route on the RAW error (the hint is a constant string) —
          // a model-not-ready failure gets the honest "still downloading"
          // refusal with no reason interpolation; everything else keeps the
          // generic refusal with the clean hint as the reason.
          const refusalKey = refusalKeyForReason(retrievalFailure);
          const refuseText =
            refusalKey === 'ai.chat.model-not-ready-refuse'
              ? t(refusalKey)
              : t(refusalKey, { reason });

          const userMsg: ChatMessage = {
            role: 'user',
            content: rawContent,
            timestamp: new Date().toISOString(),
            workspaceHint,
          };
          addMessage(chatId, userMsg);
          setInputValue('');
          clearDraftInput(chatId);

          const assistantRefusal: ChatMessage = {
            role: 'assistant',
            content: refuseText,
            timestamp: new Date().toISOString(),
            // No sources, no scope — this is a refusal, not an answer.
          };
          addMessage(chatId, assistantRefusal);
          return; // Stop — do NOT call the AI provider.
        }

      }

      // Audit (3.0 provenance) — record the scope this AI action ran under, the
      // privilege decision (default: privileged sources excluded), and the
      // retrieval result. These make the audit log a complete "defense file":
      // exactly what was searched, which client matter it was confined to, and
      // whether privileged material was held back. Only emitted when retrieval
      // actually ran (memory on); a memory-off turn logs neither.
      //
      // NOTE: audit events are intentionally emitted BEFORE the empty-results
      // guard below so that a refused turn (zero hits) is still fully auditable.
      // The workspace WAS searched; recording that is important for defensibility.
      if (isMemoryEnabled()) {
        const auditScope: AuditScope = activeMatter
          ? { kind: 'matter', matterId: activeMatter.id, matterName: matterLabel(activeMatter) }
          : { kind: 'allMatters' };
        const topScore = retrievedSources.reduce<number | null>(
          (max, s) => (max === null ? s.score : Math.max(max, s.score)),
          null,
        );
        onAuditLog?.(auditEventToEntry({
          type: 'scope_active',
          timestamp: new Date().toISOString(),
          payload: { scope: auditScope },
        }));
        onAuditLog?.(auditEventToEntry({
          type: 'privilege_evaluated',
          timestamp: new Date().toISOString(),
          // `includePrivileged` is the user's explicit opt-in; the default
          // (false) means privileged sources were EXCLUDED from this search.
          payload: { excluded: !includePrivileged },
        }));
        onAuditLog?.(auditEventToEntry({
          type: 'retrieval_executed',
          timestamp: new Date().toISOString(),
          payload: {
            query: parsed.query || rawContent,
            scope: auditScope,
            hitCount: retrievedSources.length,
            topScore,
          },
        }));
      }

      // F-116 — "Avianca trap" guard (empty-results path): retrieval
      // SUCCEEDED but returned ZERO usable sources. When "Ask my workspace"
      // is on (matter-scoped intent), the user explicitly requested
      // workspace-grounded answers. Proceeding to the model with an empty
      // context block would produce an ungrounded but confident-looking
      // answer — the same Avianca risk the throw guard above prevents.
      //
      // BUG-065: fire whenever workspace grounding was EXPLICITLY requested —
      // the "Ask my workspace" toggle OR a manually-typed `@workspace` tag
      // (`shouldRetrieve` = either). Previously only the toggle refused, so a
      // manual `@workspace` with zero hits could still answer ungrounded.
      // Normal chat (no tag, no toggle) never reaches this block.
      //
      // Audit events above have already been emitted so the refused turn is
      // fully auditable (the workspace WAS searched; recording it matters).
      if (retrievedSources.length === 0) {
        const emptyHint = "Workspace search returned no results for this query.";
        const refuseText = t('ai.chat.workspace-empty-refuse');

        const userMsg: ChatMessage = {
          role: 'user',
          content: rawContent,
          timestamp: new Date().toISOString(),
          workspaceHint: emptyHint,
        };
        addMessage(chatId, userMsg);
        setInputValue('');
        clearDraftInput(chatId);

        const assistantRefusal: ChatMessage = {
          role: 'assistant',
          content: refuseText,
          timestamp: new Date().toISOString(),
        };
        addMessage(chatId, assistantRefusal);
        return; // Stop — do NOT call the AI provider.
      }
    }

    // Stream A1 — capture and clear pending attachments before async work.
    const messageAttachments = pendingAttachments.length > 0
      ? [...pendingAttachments]
      : undefined;

    // Clear pending attachments, preview URLs, and PDF extraction cache.
    setPendingAttachments([]);
    for (const url of Object.values(previewUrls)) {
      URL.revokeObjectURL(url);
    }
    setPreviewUrls({});
    setPdfExtractions({});

    const userMessage: ChatMessage = {
      role: 'user',
      content: rawContent,
      timestamp: new Date().toISOString(),
      ...(messageAttachments ? { attachments: messageAttachments } : {}),
      ...(retrievedSources.length > 0 ? { sources: retrievedSources } : {}),
      ...(workspaceHint ? { workspaceHint } : {}),
      // WS-B/C — stamp the scope the turn was retrieved under (only when
      // retrieval actually ran, so non-workspace chat turns stay unchanged).
      ...(shouldRetrieve ? { scope: turnScope } : {}),
    };

    // Stream A4 — check if context would exceed the configured limit before sending.
    const msgsForSend = getMessagesForSend([...messages, userMessage]);
    const sendTokenEstimate = estimateMessagesTokens(msgsForSend) + estimateTokens(rawContent);
    if (!bypassContextLimit && sendTokenEstimate > chatContextTokenLimit) {
      // Context is over limit — show confirmation modal instead of sending.
      setCompressedTokensBefore(sendTokenEstimate);
      setPendingCompressAndSend(() => async () => {
        // First compress, then re-invoke handleSendMessage after updating messages.
        await handleManualCompress();
      });
      setCompressionModalOpen(true);
      return;
    }

    // Add user message to store (persists immediately)
    addMessage(chatId, userMessage);
    const updatedMessages = [...messages, userMessage];
    setInputValue('');
    clearDraftInput(chatId); // Clear saved draft after sending
    setMissingSourceWarning(null);
    setLoading(chatId, true);

    // Call AI provider with streaming. The IIFE is voided because
    // handleSendMessage itself is async — this fire-and-forget inner
    // IIFE intentionally runs off the main call stack (streaming updates
    // continue after the caller's useCallback returns). All errors are
    // caught inside; the outer .catch surfaces any unexpected escape.
    void (async () => {
      let providerSendCompletedOrCancelledAfterEgress = false;
      try {
        // Determine provider from chat data, fallback to anthropic
        const chatProvider = effectiveProvider;
        const chatModel = chatData.model;
        let effectiveChatModel = chatModel ?? chatProvider;

        // WS-C honesty — a LOCAL provider (Ollama) needs no API key; inference
        // runs on the user's own machine. The key lookup + "no key" error only
        // applies to cloud providers. We MUST NOT fall through from a local
        // selection to a cloud provider on any path below.
        const isLocal = isLocalProviderId(chatProvider);

        // Find valid API key for the chat's provider (cloud only).
        const apiKey = isLocal
          ? undefined
          : apiKeys.find(k => k.provider === chatProvider && k.isValid);

        if (!isLocal && !apiKey) {
          const providerNames: Record<string, string> = { anthropic: 'Anthropic', openai: 'OpenAI', google: 'Google' };
          throw new Error(`No valid ${providerNames[chatProvider] ?? chatProvider} API key found. Please add your API key in the settings.`);
        }

        const buildEgressAuditPayload = () => {
          const egress = resolveEgress({
            provider: chatProvider,
            mode: getConfidentialityMode(),
            isDemo: IS_DEMO,
            assuredAvailable: assuredAvailableForChat,
          });
          const rawScope = getActiveScope();
          const foundMatterName = rawScope.kind === 'matter'
            ? useMatterStore.getState().matters.find(m => m.id === rawScope.matterId)?.name
            : undefined;
          const auditScope: AuditScope = rawScope.kind === 'matter'
            ? { kind: 'matter', matterId: rawScope.matterId, ...(foundMatterName !== undefined && { matterName: foundMatterName }) }
            : { kind: 'allMatters' };
          return { egress, auditScope };
        };

        const emitSuccessfulEgressAudit = () => {
          const { egress, auditScope } = buildEgressAuditPayload();
          onAuditLog?.(auditEventToEntry({
            type: 'egress',
            timestamp: new Date().toISOString(),
            payload: {
              provider: egress.provider,
              // BUG-028: record the model so the confidentiality report names it
              // (the report fell back to "unknown" when the model was absent).
              model: effectiveChatModel,
              mode: getConfidentialityMode(),
              destination: egress.destination,
              dataLeaves: egress.dataLeaves,
              scope: auditScope,
            },
          }));
        };

        const emitCancelledEgressAudit = () => {
          const { egress, auditScope } = buildEgressAuditPayload();
          onAuditLog?.({
            action: 'egress',
            description: `AI request cancelled after sending to ${chatProvider}`,
            model: effectiveChatModel,
            inputs: {
              provider: egress.provider,
              model: effectiveChatModel,
              mode: getConfidentialityMode(),
              destination: egress.destination,
              dataLeaves: egress.dataLeaves,
              scope: auditScope,
            },
            outputs: { success: false, status: 'cancelled' },
            userDecision: 'auto',
            metadata: {
              auditEventType: 'egress',
              provider: egress.provider,
              model: effectiveChatModel,
              mode: getConfidentialityMode(),
              destination: egress.destination,
              dataLeaves: egress.dataLeaves,
              scope: auditScope,
              status: 'cancelled',
            },
          });
        };

        const emitSuccessfulAttachmentAudits = () => {
          for (const att of messageAttachments ?? []) {
            onAuditLog?.({
              action: 'user_action',
              description: `Attachment sent to provider: ${att.fileName}`,
              model: chatModel ?? chatProvider,
              inputs: { hash: att.id, path: att.pathInWorkspace, provider: chatProvider },
              outputs: {},
              userDecision: 'auto',
              metadata: { auditEventType: 'attachment_sent_to_provider' },
            });
          }
        };

        // Stream A1 — estimate image token overhead for cost meter.
        const imageTokenOverhead = (messageAttachments ?? []).reduce(
          (sum, att) => sum + estimateImageTokens(chatProvider, att),
          0
        );

        // Stream A2 — estimate PDF token overhead for cost meter.
        const pdfTokenOverhead = (messageAttachments ?? []).reduce((sum, att) => {
          if (att.type !== 'pdf') return sum;
          const mode = att.metadata.extractionMode ?? 'text-extract';
          // Use cached extraction result if available (for text-extract length).
          // After send the cache is cleared, so we pass the length from metadata
          // if it was stamped, otherwise let estimatePdfTokens fall back to pages.
          const extractedLen = undefined; // extraction cache cleared before this runs
          return sum + estimatePdfTokens(chatProvider, att, mode, extractedLen);
        }, 0);

        // Build a provider-agnostic tool executor up front. Any provider
        // that supports tool calling (Claude, OpenAI, Gemini) registers
        // the same closure below via its setTools method.
        const hasWorkspaceForTools = !!(workspaceServiceRef?.current && rootPath);
        const useStreamingForThisSend = !isTauriProductionBuild() && !hasWorkspaceForTools;
        console.log('[AIChat DIAGNOSTIC] Workspace check:', {
          hasWorkspaceService: !!workspaceServiceRef?.current,
          rootPath,
          hasRootPath: !!rootPath,
          willRegisterTools: hasWorkspaceForTools,
        });

        // BUG-036 — matter-scope guard for the AI's file tools. In a
        // matter-scoped chat the file tools must respect the SAME boundary as
        // retrieval: the model may only touch files that belong to the active
        // matter. In all-matters scope they stay workspace-wide (matching
        // all-matters retrieval). Without this, a chat scoped to Matter B could
        // read/search/write Matter A's files via the tools — a cross-matter
        // confidentiality leak the database-level RAG scoping does NOT cover.
        // Path -> matter uses the same resolveMatterId() the indexer uses
        // (longest mapped folder wins; files outside every matter -> 'unassigned').
        // Codex review #1: derive the tool scope from the SAME scope captured at
        // send start (`retrievalScope` / `activeMatter` above), NOT a fresh
        // getActiveScope() — so the file tools and retrieval always agree, even
        // if the user switches the active matter while the response is still
        // streaming. (Both come from `activeMatter`, a stable value for this send.)
        const toolMatters = useMatterStore.getState().matters;
        const toolActiveMatterId = retrievalScope.kind === 'matter' ? retrievalScope.matterId : null;
        const activeMatterName = activeMatter ? matterLabel(activeMatter) : null;
        const activeMatterFolders = activeMatter?.folderPaths ?? [];
        const pathInActiveMatter = (absPath: string): boolean =>
          pathInMatterScope(absPath, toolActiveMatterId, toolMatters);
        const assertInActiveMatter = (absPath: string, relativePath: string): void => {
          if (pathInActiveMatter(absPath)) return;
          // Distinguish a '..' traversal (rejected in any scope) from a genuine
          // cross-matter access (only blocked when a specific matter is active).
          if (relativePath.split(/[\\/]/).some((seg) => seg === '..')) {
            throw new Error(`Access denied: path "${relativePath}" must not contain "..".`);
          }
          throw new Error(
            `Access denied: "${relativePath}" is outside the active ${getEntityLabel().one} (${activeMatterName ?? 'none'}). ` +
              `Switch the chat scope to "All ${getEntityLabel().other}" to work across ${getEntityLabel().other}.`,
          );
        };
        // BUG-047: refuse to write/move/delete a file the user has OPEN with
        // UNSAVED edits — otherwise the AI's write clobbers their unsaved work
        // (or the next autosave clobbers the AI's write). Fail closed with a
        // clear message so the model asks the user to save/close it first.
        const assertNotOpenWithUnsavedEdits = (absPath: string, relativePath: string): void => {
          const tabs = useEditorStore.getState().openTabs;
          if (!isFileOpenInEditor(absPath, tabs)) return;
          if (tabHasUnsavedEdits(absPath, tabs)) {
            throw new Error(
              `Cannot modify "${relativePath}": it's open in the editor with UNSAVED changes. ` +
                `To avoid overwriting the user's work, ask them to save or close it first, then try again.`,
            );
          }
          // BUG-047 #7: even a CLEAN open file is refused — the editor would show
          // stale content after the write, and the user could then clobber it.
          throw new Error(
            `Cannot modify "${relativePath}": it's open in the editor. Ask the user to close it first ` +
              `(or use the in-editor AI to edit an open document) so the editor doesn't show stale content.`,
          );
        };
        // BUG-063 sibling: moving/deleting a FOLDER whose child file is open
        // would leave that child tab on a now-invalid path, and the autosave
        // could re-write its stale content back — resurrecting a deleted file or
        // duplicating after a move. Refuse if any descendant is open.
        const assertNoOpenDescendant = (absPath: string, relativePath: string): void => {
          if (hasOpenDescendant(absPath, useEditorStore.getState().openTabs)) {
            throw new Error(
              `Cannot modify "${relativePath}": a file inside it is open in the editor. Ask the user to ` +
                `close open files under this folder first, so the editor doesn't show (and can't re-save) stale content.`,
            );
          }
        };

        // BUG-060: per-action approval. Before the AI overwrites/deletes/moves
        // (or, in "always" mode, before any change), pause and show the user a
        // before/after. The mode is read fresh per call so a mid-chat change in
        // Settings applies immediately. Returns whether to proceed + how to log
        // the decision in the audit trail.
        const readTextForPreview = async (
          absPath: string,
          relativePath: string,
        ): Promise<string | undefined> => {
          if (isBinaryFile(relativePath)) return undefined;
          const svc = workspaceServiceRef?.current;
          if (!svc) return undefined;
          try {
            return await svc.readFile(absPath);
          } catch {
            return undefined; // unreadable → the modal shows a summary instead
          }
        };
        // Read the approval mode fresh per op so a mid-chat Settings change
        // applies immediately. Fails CLOSED: a missing/corrupt value falls back
        // to the safe default ('risky'), never to "no approval" (Codex review).
        const getApprovalMode = () =>
          coerceApprovalMode(useSettingsStore.getState().getSetting('aiFileApprovalMode'));

        const gateWrite = async (
          mode: ReturnType<typeof getApprovalMode>,
          op: AiWriteOp,
          preview: { beforeText?: string | undefined; afterText?: string | undefined; binary: boolean },
        ): Promise<{ approved: boolean; userDecision: 'auto' | 'approved' | 'rejected' }> => {
          if (!needsPreApproval(mode, op)) return { approved: true, userDecision: 'auto' };
          const decision = await useAiApprovalStore.getState().request({
            op,
            beforeText: preview.beforeText,
            afterText: preview.afterText,
            binary: preview.binary,
          });
          return decision === 'approve'
            ? { approved: true, userDecision: 'approved' }
            : { approved: false, userDecision: 'rejected' };
        };

        // BUG-060 batch mode: snapshot a file's bytes BEFORE an overwrite/delete
        // so the change can be reversed at end-of-turn review. Capped so a
        // pathologically large file can't be held in memory (undo is then
        // disabled for that one, honestly surfaced in the panel).
        const MAX_SNAPSHOT_BYTES = 25 * 1024 * 1024;
        const snapshotBytes = async (absPath: string): Promise<ArrayBuffer | undefined> => {
          const svc = workspaceServiceRef?.current;
          if (!svc) return undefined;
          try {
            // Check the size FIRST so a pathologically large file is skipped
            // without reading it all into memory (this box is memory-tight).
            const stat = await svc.stat(absPath);
            if (stat.size > MAX_SNAPSHOT_BYTES) return undefined;
            const buf = await svc.readFileBinary(absPath);
            return buf.byteLength > MAX_SNAPSHOT_BYTES ? undefined : buf; // backstop
          } catch {
            return undefined; // unreadable → not undoable, shown as such
          }
        };
        const recordBatch = (input: BatchChangeInput) => {
          useAiBatchReviewStore.getState().record(input);
        };

        const toolExecutor = async (toolName: string, params: Record<string, unknown>) => {
          if (!workspaceServiceRef?.current || !rootPath) {
            throw new Error('Workspace not initialized');
          }

          switch (toolName) {
            case 'read_file': {
              const relativePath = params['path'] as string;
              const filePath = `${rootPath}/${relativePath}`.replace(/\/+/g, '/');
              if (!filePath.startsWith(rootPath)) throw new Error('Access denied: path outside workspace');
              assertInActiveMatter(filePath, relativePath); // BUG-036
              try {
                const content = await workspaceServiceRef.current.readFile(filePath);
                return { content, path: relativePath };
              } catch (error) {
                throw new Error(`Failed to read file "${relativePath}": ${error instanceof Error ? error.message : 'Unknown error'}`);
              }
            }
            case 'list_files': {
              const relativePath = (params['path'] as string) || '.';
              const dirPath = relativePath === '.' || relativePath === '' ? rootPath : `${rootPath}/${relativePath}`.replace(/\/+/g, '/');
              if (!dirPath.startsWith(rootPath)) throw new Error('Access denied: path outside workspace');
              try {
                const entries = await workspaceServiceRef.current.list(dirPath);
                // Codex review #5: a directory entry is visible if it is INSIDE
                // the active matter OR is an ANCESTOR of one of the matter's
                // folders (so the model can navigate DOWN into a nested matter,
                // e.g. list "/ws" and see "Clients" on the way to
                // "/ws/Clients/Acme"). Sibling/other-matter entries stay hidden.
                const visibleInScope = (absChild: string, isDir: boolean): boolean => {
                  if (pathInActiveMatter(absChild)) return true;
                  if (!toolActiveMatterId || !isDir) return false;
                  const prefix = absChild.endsWith('/') ? absChild : `${absChild}/`;
                  return activeMatterFolders.some((f) => f === absChild || f.startsWith(prefix));
                };
                return {
                  // BUG-036: in a matter-scoped chat, only reveal entries that
                  // belong to the active matter (folders/files of other matters
                  // are hidden so the model can't enumerate them).
                  entries: entries
                    .filter((e) =>
                      visibleInScope(`${dirPath}/${e.name}`.replace(/\/+/g, '/'), e.type !== 'file'),
                    )
                    .map((e) => ({
                      name: e.name, type: e.type,
                      path: relativePath === '.' || relativePath === '' ? e.name : `${relativePath}/${e.name}`,
                      extension: e.extension
                    })),
                  path: relativePath
                };
              } catch (error) {
                throw new Error(`Failed to list directory "${relativePath}": ${error instanceof Error ? error.message : 'Unknown error'}`);
              }
            }
            case 'search_files': {
              const query = params['query'] as string;
              try {
                const fileTree = await workspaceServiceRef.current.getFileTree();
                const searchResults: Array<{ name: string; path: string; type: string }> = [];
                const searchNode = (nodes: any[], parentPath = '') => {
                  for (const node of nodes) {
                    const nodePath = parentPath ? `${parentPath}/${node.name}` : node.name;
                    const pattern = query.replace(/\*/g, '.*').replace(/\?/g, '.');
                    const regex = new RegExp(pattern, 'i');
                    if (regex.test(node.name)) searchResults.push({ name: node.name, path: nodePath, type: node.type });
                    if (node.children) searchNode(node.children, nodePath);
                  }
                };
                searchNode(fileTree);
                // BUG-036: drop results outside the active matter so the model
                // can't discover another matter's files by name search.
                const scopedResults = searchResults.filter((r) =>
                  pathInActiveMatter(`${rootPath}/${r.path}`.replace(/\/+/g, '/')),
                );
                return { results: scopedResults, query };
              } catch (error) {
                throw new Error(`Failed to search files: ${error instanceof Error ? error.message : 'Unknown error'}`);
              }
            }
            case 'write_file': {
              const relativePath = params['path'] as string;
              const content = params['content'] as string;
              const filePath = `${rootPath}/${relativePath}`.replace(/\/+/g, '/');
              if (!filePath.startsWith(rootPath)) throw new Error('Access denied: path outside workspace');
              assertInActiveMatter(filePath, relativePath); // BUG-036
              assertNotOpenWithUnsavedEdits(filePath, relativePath); // BUG-047
              const exists = await workspaceServiceRef.current.exists(filePath);
              const action = exists ? 'file_update' : 'file_create';
              const actionLabel = exists ? 'updated' : 'created';
              const binary = isBinaryFile(relativePath);
              // write_file only carries plain text. Writing it into a binary file
              // (.docx/.pdf/image/...) would CORRUPT it while reporting success, so
              // refuse and tell the model to use a text file instead.
              if (binary) {
                onAuditLog?.({ action, description: `AI refused to write binary file as text: ${relativePath}`, model: chatModel ?? chatProvider, inputs: { path: relativePath, contentLength: content.length }, outputs: { success: false, refused: true, reason: 'binary-as-text' }, userDecision: 'auto', metadata: { tool: 'write_file' } });
                return { path: relativePath, skipped: true, message: `Cannot write "${relativePath}": it's a binary file type (e.g. .docx, .pdf, image), and this tool only writes plain text — doing so would corrupt it. Write a text file (.md or .txt) instead.` };
              }
              const approvalMode = getApprovalMode();
              // Read the existing text once (reused for the gate preview AND the
              // batch before/after diff). Undefined for binary or a new file.
              const beforeText = exists ? await readTextForPreview(filePath, relativePath) : undefined;
              // BUG-060 batch: snapshot the bytes before overwriting so it's reversible.
              const beforeBytes = approvalMode === 'batch' && exists ? await snapshotBytes(filePath) : undefined;
              // BUG-060: gate before writing (overwrite is "risky"; a new file is not).
              const gate = await gateWrite(
                approvalMode,
                classifyWriteOp({ tool: 'write_file', path: relativePath, destExists: exists }),
                { beforeText, afterText: content, binary },
              );
              if (!gate.approved) {
                onAuditLog?.({ action, description: `AI ${actionLabel} declined by user: ${relativePath}`, model: chatModel ?? chatProvider, inputs: { path: relativePath, contentLength: content.length }, outputs: { success: false, declined: true }, userDecision: 'rejected', metadata: { tool: 'write_file' } });
                return { path: relativePath, skipped: true, message: 'The user declined this change. The file was NOT modified. Do not retry unless the user explicitly asks again.' };
              }
              try {
                await workspaceServiceRef.current.writeFile(filePath, content);
                // BUG-060 batch: record the applied change for end-of-turn review,
                // BEFORE refresh/audit so a thrown callback can't drop it.
                if (approvalMode === 'batch') {
                  recordBatch(
                    exists
                      ? { kind: 'overwrite_file', path: relativePath, fullPath: filePath, binary, beforeBytes, beforeText, afterText: content, undoable: beforeBytes !== undefined }
                      : { kind: 'create_file', path: relativePath, fullPath: filePath, binary, afterText: content, undoable: true },
                  );
                }
                onFileTreeChange?.();
                onAuditLog?.({ action, description: `AI ${actionLabel} file: ${relativePath}`, model: chatModel ?? chatProvider, inputs: { path: relativePath, contentLength: content.length }, outputs: { success: true }, userDecision: gate.userDecision, metadata: { tool: 'write_file' } });
                return { path: relativePath, message: 'File written successfully' };
              } catch (error) {
                throw new Error(`Failed to write file "${relativePath}": ${error instanceof Error ? error.message : 'Unknown error'}`);
              }
            }
            case 'create_folder': {
              const relativePath = params['path'] as string;
              const folderPath = `${rootPath}/${relativePath}`.replace(/\/+/g, '/');
              if (!folderPath.startsWith(rootPath)) throw new Error('Access denied: path outside workspace');
              assertInActiveMatter(folderPath, relativePath); // BUG-036
              // Honesty (BUG-063 sibling): if the path is already taken, don't gate
              // it or log a false "created". Distinguish an existing FOLDER (a real
              // no-op) from an existing FILE (a genuine conflict).
              if (await workspaceServiceRef.current.exists(folderPath)) {
                const existingStat = await workspaceServiceRef.current.stat(folderPath);
                if (existingStat.type === 'folder') {
                  return { path: relativePath, message: 'Folder already exists; nothing was created.' };
                }
                return { path: relativePath, skipped: true, message: `Cannot create folder "${relativePath}": a file with that name already exists there.` };
              }
              const folderMode = getApprovalMode();
              // BUG-060: creating a folder isn't "risky", so only "always" gates it.
              const folderGate = await gateWrite(
                folderMode,
                classifyWriteOp({ tool: 'create_folder', path: relativePath, destExists: false }),
                { binary: false },
              );
              if (!folderGate.approved) {
                onAuditLog?.({ action: 'file_create', description: `AI create folder declined by user: ${relativePath}`, model: chatModel ?? chatProvider, inputs: { path: relativePath }, outputs: { success: false, declined: true }, userDecision: 'rejected', metadata: { tool: 'create_folder', type: 'folder' } });
                return { path: relativePath, skipped: true, message: 'The user declined creating this folder.' };
              }
              try {
                await workspaceServiceRef.current.mkdir(folderPath);
                // BUG-060 batch: record before refresh/audit so a thrown callback can't drop it.
                if (folderMode === 'batch') {
                  recordBatch({ kind: 'create_folder', path: relativePath, fullPath: folderPath, undoable: true });
                }
                onFileTreeChange?.();
                onAuditLog?.({ action: 'file_create', description: `AI created folder: ${relativePath}`, model: chatModel ?? chatProvider, inputs: { path: relativePath }, outputs: { success: true }, userDecision: folderGate.userDecision, metadata: { tool: 'create_folder', type: 'folder' } });
                return { path: relativePath, message: 'Folder created successfully' };
              } catch (error) {
                throw new Error(`Failed to create folder "${relativePath}": ${error instanceof Error ? error.message : 'Unknown error'}`);
              }
            }
            case 'move_file': {
              const fromPath = params['from'] as string;
              const toPath = params['to'] as string;
              const fullFromPath = `${rootPath}/${fromPath}`.replace(/\/+/g, '/');
              const fullToPath = `${rootPath}/${toPath}`.replace(/\/+/g, '/');
              if (!fullFromPath.startsWith(rootPath) || !fullToPath.startsWith(rootPath)) throw new Error('Access denied: path outside workspace');
              assertInActiveMatter(fullFromPath, fromPath); // BUG-036
              assertInActiveMatter(fullToPath, toPath); // BUG-036 (can't move a matter's file out, or into it from elsewhere)
              assertNotOpenWithUnsavedEdits(fullFromPath, fromPath); // BUG-047 (don't move out from under unsaved edits)
              assertNotOpenWithUnsavedEdits(fullToPath, toPath); // BUG-047 (don't overwrite an open dirty destination)
              assertNoOpenDescendant(fullFromPath, fromPath); // BUG-063 sibling (moving a folder w/ open child)
              assertNoOpenDescendant(fullToPath, toPath); // and the destination (a folder move can merge/overwrite into it)
              // BUG-060: a move onto an EXISTING destination is "risky" (it
              // overwrites); a plain move/rename to an empty path is not.
              const destExists = await workspaceServiceRef.current.exists(fullToPath);
              const moveMode = getApprovalMode();
              // BUG-060 batch: if the move overwrites an existing destination,
              // snapshot it so the undo can also restore what was replaced.
              const destBeforeBytes = moveMode === 'batch' && destExists ? await snapshotBytes(fullToPath) : undefined;
              const moveGate = await gateWrite(
                moveMode,
                classifyWriteOp({ tool: 'move_file', from: fromPath, to: toPath, destExists }),
                { binary: true }, // moves have no text diff to show
              );
              if (!moveGate.approved) {
                onAuditLog?.({ action: 'file_move', description: `AI move declined by user: ${fromPath} → ${toPath}`, model: chatModel ?? chatProvider, inputs: { from: fromPath, to: toPath }, outputs: { success: false, declined: true }, userDecision: 'rejected', metadata: { tool: 'move_file' } });
                return { from: fromPath, to: toPath, skipped: true, message: 'The user declined this move. Nothing was moved.' };
              }
              try {
                await workspaceServiceRef.current.move(fullFromPath, fullToPath);
                // BUG-060 batch: record the applied move (reversible: move back,
                // and restore the overwritten destination if there was one),
                // BEFORE refresh/audit so a thrown callback can't drop it.
                if (moveMode === 'batch') {
                  recordBatch({ kind: 'move_file', from: fromPath, to: toPath, fullFrom: fullFromPath, fullTo: fullToPath, destExisted: destExists, destBeforeBytes, undoable: !destExists || destBeforeBytes !== undefined });
                }
                onFileTreeChange?.();
                // Honesty (BUG-063 sibling): if the move replaced an existing
                // file at the destination, say so plainly in the audit + result.
                onAuditLog?.({ action: 'file_move', description: destExists ? `AI moved file (REPLACED existing destination): ${fromPath} → ${toPath}` : `AI moved file: ${fromPath} → ${toPath}`, model: chatModel ?? chatProvider, inputs: { from: fromPath, to: toPath }, outputs: { success: true, overwroteDestination: destExists }, userDecision: moveGate.userDecision, metadata: { tool: 'move_file' } });
                return { from: fromPath, to: toPath, overwroteDestination: destExists, message: destExists ? 'File moved successfully (an existing file at the destination was replaced)' : 'File moved successfully' };
              } catch (error) {
                throw new Error(`Failed to move file from "${fromPath}" to "${toPath}": ${error instanceof Error ? error.message : 'Unknown error'}`);
              }
            }
            case 'delete_file': {
              const relativePath = params['path'] as string;
              const filePath = `${rootPath}/${relativePath}`.replace(/\/+/g, '/');
              if (!filePath.startsWith(rootPath)) throw new Error('Access denied: path outside workspace');
              assertInActiveMatter(filePath, relativePath); // BUG-036
              assertNotOpenWithUnsavedEdits(filePath, relativePath); // BUG-047
              assertNoOpenDescendant(filePath, relativePath); // BUG-063 sibling (folder w/ open child)
              // BUG-060: deleting always removes something that exists → "risky".
              const delBinary = isBinaryFile(relativePath);
              const deleteMode = getApprovalMode();
              const delBeforeText = delBinary ? undefined : await readTextForPreview(filePath, relativePath);
              const deleteGate = await gateWrite(
                deleteMode,
                classifyWriteOp({ tool: 'delete_file', path: relativePath, destExists: true }),
                { beforeText: delBeforeText, binary: delBinary },
              );
              if (!deleteGate.approved) {
                onAuditLog?.({ action: 'file_delete', description: `AI delete declined by user: ${relativePath}`, model: chatModel ?? chatProvider, inputs: { path: relativePath }, outputs: { success: false, declined: true }, userDecision: 'rejected', metadata: { tool: 'delete_file' } });
                return { path: relativePath, skipped: true, message: 'The user declined deleting this file. Nothing was deleted.' };
              }
              try {
                // Move the file to .trash (recoverable) instead of hard-deleting,
                // so the "moved to Trash" message + audit entry are HONEST and the
                // user can restore it from the Trash panel — matching the UI delete.
                const now = Date.now();
                const trashItem = await moveToTrash(workspaceServiceRef.current, rootPath, filePath, {
                  now,
                  id: `trash_${String(now)}_${Math.random().toString(36).slice(2, 9)}`,
                });
                // BUG-060 batch: record the applied delete (reversible: move it back
                // from Trash), BEFORE refresh/audit so a thrown callback can't drop it.
                if (deleteMode === 'batch') {
                  recordBatch({ kind: 'delete_file', path: relativePath, fullPath: filePath, binary: delBinary, trashPath: trashItem.trashPath, beforeText: delBeforeText, undoable: true });
                }
                onFileTreeChange?.();
                // Refresh an already-open Trash panel so it shows the just-trashed
                // file immediately (BUG-063 follow-up), matching the message below.
                if (typeof window !== 'undefined') {
                  window.dispatchEvent(new CustomEvent('keepance:trash-changed'));
                }
                onAuditLog?.({ action: 'file_delete', description: `AI deleted file: ${relativePath}`, model: chatModel ?? chatProvider, inputs: { path: relativePath }, outputs: { success: true, movedToTrash: true, trashPath: trashItem.trashPath }, userDecision: deleteGate.userDecision, metadata: { tool: 'delete_file' } });
                return { path: relativePath, message: 'File moved to Trash (recoverable from the Trash panel)' };
              } catch (error) {
                throw new Error(`Failed to delete file "${relativePath}": ${error instanceof Error ? error.message : 'Unknown error'}`);
              }
            }
            default:
              throw new Error(`Unknown tool: ${toolName}`);
          }
        };

        // Create the appropriate provider
        let provider: Provider;
        const rulesOpt = aiRules ? { aiRules } : {};
        // Firm "Assured" path: when confidentiality mode is 'assured' AND the
        // firm has a managed key for this provider, route the cloud call through
        // the zero-retention proxy. Undefined => BYOK-direct (unchanged).
        const assuredRoute = resolveAssuredRoute(chatProvider, chatModel || '', useStreamingForThisSend);
        const assuredOpt = assuredRoute ? { assured: assuredRoute } : {};

        if (IS_DEMO) {
          // Demo build: route every chat through the demo provider, which
          // either uses a BYOK key (direct to Anthropic) or the shared
          // proxy at /api/demo-chat. Tools are not wired here because the
          // demo's seeded workspace is read-mostly and the proxy is text-only.
          provider = createDemoProvider({ ...(chatModel ? { model: chatModel } : {}) });
        } else {
          // Local-only ENFORCEMENT (privacy): the egress indicator says
          // "nothing leaves" in Local-only mode, but this send routes by the
          // chat's STORED provider — so a chat created with a cloud provider and
          // then opened in Local-only mode would still send to the cloud. Block
          // it fail-closed before any provider is built or network is touched,
          // so the indicator can never lie. (Redline/inline-edit already resolve
          // through useActiveEgressProvider → 'ollama' in Local-only.)
          assertLocalOnlyAllowsSend(chatProvider);
          // Personal-install choice gate (Task 1.3): a personal install must never
          // reach a cloud provider for generation before the user has made an
          // explicit confidentiality choice via Settings → Privacy. Retrieval above
          // is unaffected — only generation is gated. Local (Ollama) chats skip via
          // the provider check; local-only mode is already caught above; firm installs
          // are a no-op (the gate checks isFirm first and passes through).
          assertCloudGenerationAllowed(chatProvider);
          // WS-C honesty — this switch is the single chat send path. A LOCAL
          // selection ('ollama') is handled by its OWN case and constructs the
          // local provider; it can NEVER fall through to a cloud branch. The
          // exhaustiveness guard at the end throws on an unknown id rather than
          // defaulting to Claude, so a confidential/local chat can never be
          // silently routed to the cloud.
          switch (chatProvider) {
            case 'ollama': {
              // Local model on 127.0.0.1:11434. No API key, $0, nothing leaves
              // the machine. Ollama does not support file-access tool calling,
              // so we don't register tools (the non-tool streaming path handles
              // it; the egress indicator stays "nothing leaves").
              provider = new OllamaProvider({
                ...(chatModel ? { model: chatModel } : {}),
                ...rulesOpt,
              });
              break;
            }
            case 'keepance-local': {
              // Embedded llama.cpp engine ("Keepance Local AI"). No API key, $0,
              // fully on-device. Like Ollama it doesn't support file-access tool
              // calling, so no tools are registered; the non-tool streaming path
              // handles it and the egress indicator stays "nothing leaves".
              provider = new KeepanceLocalProvider({
                ...(chatModel ? { model: chatModel } : {}),
                ...rulesOpt,
              });
              break;
            }
            case 'openai': {
              const openai = new OpenAIProvider({
                apiKey: apiKey!.key,
                ...(chatModel ? { model: chatModel } : {}),
                ...rulesOpt,
                ...assuredOpt,
              });
              if (hasWorkspaceForTools) {
                openai.setTools(FILE_ACCESS_TOOLS, toolExecutor);
                console.log('[AIChat DIAGNOSTIC] Tools registered on OpenAI provider:', FILE_ACCESS_TOOLS.length, 'tools');
              } else {
                console.warn('[AIChat DIAGNOSTIC] Tools NOT registered on OpenAI — workspace service or rootPath missing');
              }
              provider = openai;
              break;
            }
            case 'google': {
              const gemini = new GeminiProvider({
                apiKey: apiKey!.key,
                ...(chatModel ? { model: chatModel } : {}),
                ...rulesOpt,
                ...assuredOpt,
              });
              if (hasWorkspaceForTools) {
                gemini.setTools(FILE_ACCESS_TOOLS, toolExecutor);
                console.log('[AIChat DIAGNOSTIC] Tools registered on Gemini provider:', FILE_ACCESS_TOOLS.length, 'tools');
              } else {
                console.warn('[AIChat DIAGNOSTIC] Tools NOT registered on Gemini — workspace service or rootPath missing');
              }
              provider = gemini;
              break;
            }
            case 'anthropic': {
              const claude = new ClaudeProvider({
                apiKey: apiKey!.key,
                ...(chatModel ? { model: chatModel } : {}),
                ...rulesOpt,
                ...assuredOpt,
              });
              if (hasWorkspaceForTools) {
                claude.setTools(FILE_ACCESS_TOOLS, toolExecutor);
                console.log('[AIChat DIAGNOSTIC] Tools registered on Claude provider:', FILE_ACCESS_TOOLS.length, 'tools');
              } else {
                console.warn('[AIChat DIAGNOSTIC] Tools NOT registered on Claude — workspace service or rootPath missing');
              }
              provider = claude;
              break;
            }
            default: {
              // Exhaustiveness guard. NOT a Claude fallback — an unrecognised
              // provider id is a hard error so a local/confidential selection
              // can never be silently downgraded to a cloud provider.
              const never: never = chatProvider;
              throw new Error(`Unsupported chat provider: ${String(never)}`);
            }
          }
        }
        effectiveChatModel = provider.getMetadata().model;

        // Stream A1 — Read raw bytes for each attachment so providers can
        // build their provider-specific image content blocks. Attachments
        // are stored on disk; we read them now so the async I/O is done
        // before we hand off to the provider. Any attachment that fails to
        // read is skipped gracefully (logged but not fatal).
        let attachmentBytes: AttachmentBytes[] | undefined;
        if (messageAttachments && messageAttachments.length > 0 && workspaceServiceRef?.current) {
          const backend = workspaceServiceRef.current.getBackend();
          const attService = backend ? new AttachmentService(backend) : null;
          const loaded: AttachmentBytes[] = [];
          for (const att of messageAttachments) {
            if (!attService) continue;
            try {
              const bytes = await attService.read(att);
              loaded.push({ att, bytes });
            } catch (readErr) {
              console.error(
                `[AIChat] Failed to read attachment bytes for ${att.fileName}:`,
                readErr,
              );
            }
          }
          if (loaded.length > 0) {
            attachmentBytes = loaded;
          }
        }

        // Build conversation history into system prompt
        const conversationContext = messages.slice(0, -1).map(m =>
          `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`
        ).join('\n\n');

        const hasWorkspace = hasWorkspaceForTools;
        const workspaceInstructions = hasWorkspace
          ? `You are running inside Keepance, a local-first workspace app. The user's active workspace folder is "${rootPath}". You have direct access to this workspace via tools: read_file, write_file, create_folder, move_file, delete_file, list_files, search_files. When the user asks you to create, edit, organize, or look at files, USE THESE TOOLS directly — do not refuse, do not ask the user to create the file themselves, and do not pretend you can't access files. You CAN. All file paths should be relative to the workspace root. When creating .md files (documentation, notes, plans, etc.), just write them directly using write_file. After creating or modifying files, briefly confirm what you did.\n\n`
          : '';

        const baseRole = hasWorkspace
          ? `${workspaceInstructions}You are a helpful AI assistant with full read/write access to the user's workspace.`
          : 'You are a helpful AI assistant.';

        // Append any enabled open-file contexts BEFORE the conversation
        // history. This lets the AI treat the files as background material
        // that applies to every turn rather than a stale one-shot attachment.
        // D1 — use scopedOpenFiles so the prompt only contains files within
        // the active folder scope (identical to openFiles when no scope is set).
        const fileBlock = buildOpenFilesPromptBlock(scopedOpenFiles);

        // M2 — workspace context block goes at the very top of the
        // system prompt so the retrieval sources are the first thing
        // the model sees. Empty string when no retrieval ran, so the
        // non-workspace code path is byte-identical to pre-M2.
        const workspaceBlock = buildWorkspaceContextBlock(
          retrievedSources.map((s) => ({
            path: s.path,
            chunkText: s.chunkText,
            score: s.score,
            paragraphIndex: s.paragraphIndex,
            ...(s.sourceType !== undefined ? { sourceType: s.sourceType } : {}),
            ...(s.pageNumber !== undefined ? { pageNumber: s.pageNumber } : {}),
          })),
        );
        const workspacePrefix = workspaceBlock ? `${workspaceBlock}\n\n` : '';

        // M3 — facts memory block sits BEFORE the workspace context
        // block. Facts are durable; retrieval is situational. Putting
        // the memory first frames everything the model reads after.
        const facts = await snapshotFactsForInjection();
        const factsBlock = buildFactsMemoryBlock(facts);
        const factsPrefix = factsBlock ? `${factsBlock}\n\n` : '';

        const systemPrompt = conversationContext
          ? `${factsPrefix}${workspacePrefix}${baseRole}${fileBlock} Here is the conversation history so far:\n\n${conversationContext}\n\nPlease respond to the user's latest message.`
          : `${factsPrefix}${workspacePrefix}${baseRole}${fileBlock}`;

        // Use streaming if available (disabled in production Tauri builds
        // because tauri-plugin-http doesn't support ReadableStream/SSE)
        // Use streaming only when no tools are registered. The streaming code
        // path in the providers doesn't include `tools` in the API request, so
        // streaming + tools would leave the model without access to file ops
        // (and it would hallucinate tool calls as text). Non-streaming works
        // with tools correctly. Also disabled in production Tauri builds
        // because tauri-plugin-http doesn't support ReadableStream/SSE.
        // BUG-060 batch mode: start this turn's change collection fresh — but
        // NEVER wipe a review the user hasn't resolved yet. The review panel is
        // a blocking modal, so in practice a new send can't begin while one is
        // open; this guard makes that invariant explicit (and just clears any
        // stale, already-resolved leftovers).
        if (!useAiBatchReviewStore.getState().reviewOpen) {
          useAiBatchReviewStore.getState().reset();
        }

        const useStreaming = provider.sendMessageStreaming
          && useStreamingForThisSend;
        if (useStreaming) {
          const abortController = new AbortController();
          abortControllerRef.current = abortController;

          // Add a placeholder assistant message that we'll update as chunks arrive
          const streamingMessage: ChatMessage = {
            role: 'assistant',
            content: '',
            timestamp: new Date().toISOString(),
            // M2 — mirror the retrieval hits onto the assistant message
            // so the Sources accordion has something to render even
            // before the stream finishes.
            ...(retrievedSources.length > 0
              ? { sources: retrievedSources }
              : {}),
            // WS-B/C — stamp the scope this turn was retrieved under.
            ...(shouldRetrieve ? { scope: turnScope } : {}),
          };
          addMessage(chatId, streamingMessage);

          let accumulated = '';
          const streamingAuditState = { receivedChunk: false };
          let streamingResponse: Awaited<ReturnType<NonNullable<typeof provider.sendMessageStreaming>>> | null = null;

          try {
            // Race guard (defense-in-depth; cloud providers also fail-closed
            // centrally): the local-only check at the top of this send happened
            // BEFORE the attachment/memory awaits, so re-check immediately before
            // the actual network send.
            assertLocalOnlyAllowsSend(provider.getMetadata().providerId ?? chatProvider);
            streamingResponse = await provider.sendMessageStreaming!(userMessage.content, {
              systemPrompt,
              maxTokens: 4096,
              onChunk: (chunk: string) => {
                streamingAuditState.receivedChunk = true;
                accumulated += chunk;
                // Update the last message in the store with accumulated content
                updateLastMessage(chatId, accumulated);
              },
              signal: abortController.signal,
              ...(attachmentBytes ? { attachmentBytes } : {}),
            });
          } catch (err) {
            if (err instanceof DOMException && err.name === 'AbortError') {
              // User cancelled — keep whatever was streamed so far
              accumulated += '\n\n*(Response stopped by user)*';
              updateLastMessage(chatId, accumulated);
              if (streamingAuditState.receivedChunk) {
                providerSendCompletedOrCancelledAfterEgress = true;
                emitCancelledEgressAudit();
                emitSuccessfulAttachmentAudits();
              }
            } else {
              throw err;
            }
          } finally {
            abortControllerRef.current = null;
          }

          // Q3 — record cost/tokens for the chip. Streaming abort (null
          // response) leaves these at zero; partial-cost tracking for
          // aborted streams isn't worth the complexity.
          if (streamingResponse) {
            providerSendCompletedOrCancelledAfterEgress = true;
            emitSuccessfulEgressAudit();
            emitSuccessfulAttachmentAudits();

            recordCost(chatId, {
              cost: streamingResponse.cost,
              inputTokens: streamingResponse.usage.inputTokens + imageTokenOverhead + pdfTokenOverhead,
              outputTokens: streamingResponse.usage.outputTokens,
              provider: chatProvider,
            });

            // Q4 — emit an audit entry with the cost/token metadata so
            // CostMetrics can aggregate over 30 days. Only log when
            // audit callback is wired; the chat-only surface works
            // without it.
            onAuditLog?.({
              action: 'model_call',
              description: `Chat message to ${effectiveChatModel}`,
              model: effectiveChatModel,
              inputs: { promptLength: userMessage.content.length },
              outputs: { contentLength: streamingResponse.content.length },
              userDecision: 'auto',
              metadata: { chatId, streamed: true },
              tokensIn: streamingResponse.usage.inputTokens,
              tokensOut: streamingResponse.usage.outputTokens,
              costUsd: streamingResponse.cost,
              provider: chatProvider,
            });
          }

          // WS-B/C — verify citations against the local store now the full
          // answer is in. Update the streamed message's sources with the
          // verification flags so unverified citations are surfaced.
          // F-503 — repair number-keyed local-model citations BEFORE
          // verification so the verify loop and chips see resolvable cites.
          const normalizedAnswer = normalizeNumericCitations(accumulated, retrievedSources);
          const verifiedStreamSources =
            retrievedSources.length > 0
              ? await verifyCitations(normalizedAnswer, retrievedSources, { onVerdict: emitCitationVerified, expectedMatterId: activeMatter ? activeMatter.id : null })
              : retrievedSources;

          const finalStreamingMessage: ChatMessage = {
            ...streamingMessage,
            content: normalizedAnswer,
            ...(verifiedStreamSources.length > 0
              ? { sources: verifiedStreamSources }
              : {}),
          };
          const finalMessages = clearExpandedFlags([...updatedMessages, finalStreamingMessage]);
          // Reflect the verified sources in the live store as well.
          updateMessages(chatId, finalMessages);

          if (onSave) {
            onSave({ ...chatData, updated: new Date().toISOString(), messages: finalMessages });
          }
        } else {
          // Non-streaming: wire an AbortController so the Stop button can
          // cancel the in-flight request. UX-39.
          const abortController = new AbortController();
          abortControllerRef.current = abortController;
          // Race guard (defense-in-depth): re-check the mode immediately before
          // the actual send (the top-of-send check predates the awaits above).
          assertLocalOnlyAllowsSend(provider.getMetadata().providerId ?? chatProvider);
          const response = await provider.sendMessage(userMessage.content, {
            systemPrompt,
            maxTokens: 4096,
            signal: abortController.signal,
            ...(attachmentBytes ? { attachmentBytes } : {}),
          });

          providerSendCompletedOrCancelledAfterEgress = true;
          emitSuccessfulEgressAudit();
          emitSuccessfulAttachmentAudits();

          // Q3 — record cost for the chip + Q4 audit entry immediately after
          // provider success. Local post-processing must not be able to hide a
          // real model call or turn it into a false egress_failed row.
          recordCost(chatId, {
            cost: response.cost,
            inputTokens: response.usage.inputTokens + imageTokenOverhead + pdfTokenOverhead,
            outputTokens: response.usage.outputTokens,
            provider: chatProvider,
          });
          onAuditLog?.({
            action: 'model_call',
            description: `Chat message to ${effectiveChatModel}`,
            model: effectiveChatModel,
            inputs: { promptLength: userMessage.content.length },
            outputs: { contentLength: response.content.length },
            userDecision: 'auto',
            metadata: { chatId, streamed: false },
            tokensIn: response.usage.inputTokens,
            tokensOut: response.usage.outputTokens,
            costUsd: response.cost,
            provider: chatProvider,
          });

          // WS-B/C — verify the citations in the answer against the local
          // store BEFORE presenting them. Verified sources are marked safe;
          // any citation that doesn't verify flags its source in the UI.
          // F-503 — repair number-keyed local-model citations BEFORE
          // verification so the verify loop and chips see resolvable cites.
          const normalizedContent = normalizeNumericCitations(response.content, retrievedSources);
          const verifiedSources =
            retrievedSources.length > 0
              ? await verifyCitations(normalizedContent, retrievedSources, { onVerdict: emitCitationVerified, expectedMatterId: activeMatter ? activeMatter.id : null })
              : retrievedSources;

          const assistantMessage: ChatMessage = {
            role: 'assistant',
            content: normalizedContent,
            timestamp: new Date().toISOString(),
            // M2 — attach retrieval sources so the accordion + citation
            // chips rendered below the bubble have data to resolve.
            ...(verifiedSources.length > 0
              ? { sources: verifiedSources }
              : {}),
            // WS-B/C — stamp the scope so the UI shows which matter the
            // answer was confined to.
            ...(shouldRetrieve ? { scope: turnScope } : {}),
          };

          addMessage(chatId, assistantMessage);

          const finalMessages = clearExpandedFlags([...updatedMessages, assistantMessage]);

          if (onSave) {
            onSave({ ...chatData, updated: new Date().toISOString(), messages: finalMessages });
          }
        }
      } catch (error) {
        // UX-39: user clicked Stop on a non-streaming request. The
        // AbortController fires a DOMException with name 'AbortError'.
        // Don't show it as a red error bubble — just reset the loading
        // state silently. (Streaming abort is already handled above.)
        if (error instanceof DOMException && error.name === 'AbortError') {
          abortControllerRef.current = null;
          return;
        }

        console.error('AI chat error:', error);

        const chatProvider = effectiveProvider;
        const chatModel = chatData.model;
        if (!providerSendCompletedOrCancelledAfterEgress || error instanceof LocalOnlyEgressError) {
          const egress = resolveEgress({
            provider: chatProvider,
            mode: getConfidentialityMode(),
            isDemo: IS_DEMO,
            assuredAvailable: assuredAvailableForChat,
          });
          const failureType = error instanceof LocalOnlyEgressError
            ? 'egress_blocked'
            : 'egress_failed';
          onAuditLog?.({
            action: 'user_action',
            description: failureType === 'egress_blocked'
              ? `AI request blocked before sending to ${chatProvider}`
              : `AI request failed before a response from ${chatProvider}`,
            model: chatModel ?? chatProvider,
            inputs: {
              provider: egress.provider,
              ...(chatModel !== undefined ? { model: chatModel } : {}),
              mode: getConfidentialityMode(),
              destination: egress.destination,
              dataLeaves: egress.dataLeaves,
              attachmentCount: messageAttachments?.length ?? 0,
            },
            outputs: {
              success: false,
              reason: error instanceof Error ? error.message : String(error),
            },
            userDecision: 'auto',
            metadata: {
              auditEventType: failureType,
              provider: egress.provider,
              ...(chatModel !== undefined ? { model: chatModel } : {}),
              mode: getConfidentialityMode(),
              destination: egress.destination,
              dataLeaves: egress.dataLeaves,
            },
          });
        }

        let errorContent: string;
        let errorDiagnostic: string | undefined;

        // WS-C honesty — a LOCAL (Ollama) chat that fails is almost always the
        // daemon not running / not reachable. Show a clear, friendly message
        // telling the user how to fix it. We NEVER silently retry on a cloud
        // provider here: a Local-only / Ollama selection that errors stays
        // local-and-failed, it does not leak to the cloud.
        if (isLocalProviderId(effectiveProvider)) {
          errorContent =
            "Ollama isn't running, so this local chat couldn't get a response. " +
            'Start Ollama (then try again), or switch your confidentiality mode ' +
            'in Settings → AI to use a cloud model. Your message was not sent ' +
            'anywhere. Nothing left your machine.';
        } else if (error instanceof ApiResponseParseError) {
          // The response came back but couldn't be parsed as JSON.
          // This is the Tauri HTTP plugin compatibility bug — show the user
          // a clear message and capture the full body for diagnostic copy.
          errorContent =
            `Could not parse the response from the AI provider. ` +
            `This is a known issue when running in the desktop app. ` +
            `Click "Copy diagnostic info" below and share it so we can fix it.`;
          errorDiagnostic = error.toDiagnostic();
        } else if (error instanceof Error) {
          // Try to extract status code from error message pattern "HTTP NNN" or "API error"
          const statusMatch = error.message.match(/HTTP (\d{3})/);
          const statusCode = statusMatch?.[1] ? parseInt(statusMatch[1], 10) : null;

          if (statusCode) {
            const parsed = parseApiError(
              effectiveProvider as 'anthropic' | 'openai' | 'google',
              statusCode,
              error.message,
              chatData.model,
            );
            errorContent = `${parsed.message}\n${parsed.guidance}`;
          } else {
            errorContent = error.message;
          }
        } else {
          errorContent = 'Failed to get response. Check your API key and try again.';
        }

        const errorMessage: ChatMessage = {
          role: 'assistant',
          content: errorContent,
          timestamp: new Date().toISOString(),
          isError: true,
          ...(errorDiagnostic ? { errorDiagnostic } : {}),
        };

        addMessage(chatId, errorMessage);
        const finalMessages = [...updatedMessages, errorMessage];

        if (onSave) {
          onSave({ ...chatData, updated: new Date().toISOString(), messages: finalMessages });
        }
      } finally {
        setLoading(chatId, false);
        // BUG-060 batch mode: now that the turn is done, show the end-of-turn
        // review if any file changes were applied (no-op in other modes / when
        // nothing changed, and even after an abort so applied changes surface).
        useAiBatchReviewStore.getState().openReview();
      }
    })().catch((err) => {
      // Unexpected escape from the try/catch above. Surface it so the
      // conversation failure isn't silently swallowed.
      console.error('Unexpected error escaping AI chat IIFE:', err);
      setLoading(chatId, false);
      useAiBatchReviewStore.getState().openReview();
    });
  }, [inputValue, pendingAttachments, previewUrls, messages, chatData, localAvailability, onSave, isLoading, apiKeys, chatId, addMessage, updateLastMessage, updateMessages, setLoading, workspaceServiceRef, rootPath, onFileTreeChange, onAuditLog, aiRules, openFiles, scopedOpenFiles, scopedFolder, recordCost, clearDraftInput, askWorkspaceMode, activeMatter, includePrivileged]);

  const handleSendAnyway = useCallback(() => {
    bypassNextContextLimitRef.current = true;
    void handleSendMessage();
  }, [handleSendMessage]);

  return { handleSendMessage, handleManualCompress, handleSendAnyway };
}
