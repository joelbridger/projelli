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
import { loadAttachmentBytes } from './loadAttachmentBytes';
import { withAskTimeout, ASK_RETRIEVAL_TIMEOUT_MS } from '@/features/ask/askTimeout';
import type { WorkspaceService } from '@/platform/fs/WorkspaceService';
import { estimateImageTokens } from '@/features/ask/attachments/imageTokens';
import { extractImageTextForCloudScan } from '@/features/ask/attachments/imageOcrForCloudScan';
import { estimatePdfTokens } from '@/features/ask/attachments/pdfTokens';
import type { PdfExtractionResult } from '@/lib/pdf-extract';
import type { ChatAttachment, AIChatFile, ChatMessage, WorkspaceSource, TurnScope } from '@/platform/types/ai';
import type { AuditScope, CitationVerdict } from '@/platform/types/audit';
import { auditEventToEntry } from '@/platform/audit/AuditService';
import {
  createAuditPairId,
  mustLogAuditPhase,
  type AuditEntryInput,
  type AuditLogSink,
} from '@/platform/audit/durableAudit';
import { resolveEgress } from '@/platform/privacy/egress';
import { sendPreparedMessageWithEgressAudit, sendPreparedStreamingWithEgressAudit } from '@/platform/privacy/promptPreparation';
import { getConfidentialityMode } from '@/platform/hooks/useConfidentialityMode';
import type { Provider } from '@/platform/providers/Provider';
import { createProvider, isLocalProviderId } from '@/platform/providers/providerFactory';
import { OPENAI_DEFAULT_MODEL } from '@/platform/providers/OpenAIProvider';
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
import { isAuthRejectionError } from '@/features/ask/askHelpers';
import { markKeyInvalid, isVerifiableProvider } from '@/platform/providers/keyVerification';
import { FILE_ACCESS_TOOLS } from '@/platform/tools/fileAccessTools';
import type { Matter } from '@/platform/types/matter';
import { readSelectionOperationDecision } from '@/platform/client-context';
import { useMatterStore } from '@/platform/matter/matterStore';
import { matterLabel } from '@/platform/rag/matterResolver';
import {
  pathInActiveMatter as pathInActiveMatterGuard,
  assertInActiveMatter as assertInActiveMatterGuard,
  assertDirInActiveMatter as assertDirInActiveMatterGuard,
  assertNotOpenWithUnsavedEdits,
  assertNoOpenDescendant,
} from './fileAccessGuards';
// F2.8 — the SINGLE cross-platform path-join + boundary helpers. `workspacePath`
// replaces every hand-rolled `${rootPath}/${x}` template (absolute-passthrough +
// non-string guard); `sameOrInside` replaces the raw `startsWith(rootPath)`
// workspace-boundary check, which was a no-op tautology (filePath is literally
// `rootPath + "/" + rel`, so it ALWAYS started with rootPath) and — on Windows,
// where rootPath carries backslashes — could never be made a real check by
// normalizing the join alone without failing closed on every legitimate path.
// Migrating join + guard together makes the workspace boundary a genuine,
// separator/-case-correct check at the tool layer (PathValidator still backstops
// it downstream; the matter boundary stays with assertInActiveMatter).
import { workspacePath, sameOrInside } from '@/platform/fs/appPath';
import {
  fileToolsAllowed,
  fileToolsRegistered,
  resolveWorkspaceRetrieval,
  type ConsentScope,
} from '@/platform/ai/fileAccessConsent';
import { getFileAccessConsent } from '@/platform/state/aiChatStore';
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
  parseWorkspaceCommand,
} from '@/platform/rag/workspaceCommand';
import { verifyCitationsInResponse } from './verifyCitationsInResponse';
import { buildSystemPrompt } from './buildSystemPrompt';
import {
  filterHitsForExportConsent,
  dropUnconsentedExports,
  isExternalExportConsentGiven,
} from '@/platform/rag/exportConsent';
import { recognizeProvenance } from '@/platform/rag/sourceProvenance';
import { snapshotFactsForInjection } from '@/platform/rag/factsSingleton';
import type { ChatSession, ChatCostEntry } from '@/platform/state/aiChatStore';
// buildOpenFilesPromptBlock + refusalKeyForReason stay exported from AIChatViewer
// (external importers: useTestModeWorkspace, refusal-key.test). The deferred,
// hoisted-function usage below makes this back-import cycle-safe.
import { buildOpenFilesPromptBlock, refusalKeyForReason } from '../AIChatViewer';
import type { APIKey } from '../AIChatViewer';
import { sendDiagnosticEvent } from '@/platform/utils/diagnostics';
import { EV_TRASH_CHANGED } from '@/config/identity';
import { brandText } from '@/config/brandText';
import { askSendPipeline } from '../pipeline/AskSendPipeline';
import { BRAND } from '@/config/brand';

export function fileSearchQueryToRegex(query: string): RegExp {
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const wildcardPattern = escaped.replace(/\\\*/g, '.*').replace(/\\\?/g, '.');
  return new RegExp(wildcardPattern, 'i');
}

export interface UseChatSendingDeps {
  // Props forwarded from AIChatViewer.
  chatData: AIChatFile;
  /** Whether the embedded Lantern Local AI model is ready — so a chat with no
   *  saved provider resolves to 'lantern-local' (on-device) instead of a cloud
   *  fallback. Keeps the send path in agreement with the egress badge. */
  localAvailability: LocalModelAvailability;
  onSave: ((updatedChat: AIChatFile) => void) | undefined;
  apiKeys: APIKey[];
  workspaceServiceRef: React.MutableRefObject<WorkspaceService | null> | undefined;
  rootPath: string | undefined;
  onFileTreeChange: (() => void) | undefined;
  onAuditLog: AuditLogSink | undefined;
  // Hook + store values.
  t: ReturnType<typeof useTranslation>['t'];
  assuredAvailableForChat: boolean;
  sessions: Record<string, ChatSession>;
  addMessage: (chatId: string, message: ChatMessage) => void;
  updateLastMessage: (chatId: string, content: string) => void;
  updateMessages: (chatId: string, messages: ChatMessage[]) => void;
  setLoading: (chatId: string, isLoading: boolean) => void;
  /**
   * Perf (P1.2) — the live in-flight streamed text for the current assistant
   * message. This is component-LOCAL state (a plain useState in
   * AIChatViewer), never the Zustand store: writing to the global store on
   * every token would clone + broadcast the whole session on every chunk.
   * Set to the accumulated text (throttled to at most once per animation
   * frame) while a stream is in flight, and cleared to null once the turn's
   * single final store commit (updateMessages/updateLastMessage) has landed.
   *
   * Tagged with the chatId the stream belongs to (Codex review, P1):
   * AIChatViewer's local state survives a `chatId` prop change (MainPanel
   * reuses the same instance across open chats, no per-chat `key`), so an
   * in-flight stream's callbacks — still running after the user switches to
   * a DIFFERENT chat — must never be mistaken for the newly-viewed chat's
   * content. The caller only applies this preview when its `chatId` matches
   * whatever chat is currently being viewed. It's a real `useState` setter
   * (not a plain callback) so `createStreamFlusher`'s `finish()` can use the
   * functional-update form to clear it only when it still belongs to the
   * finishing turn, without racing a read of the current value.
   */
  setStreamingPreview: React.Dispatch<React.SetStateAction<{ chatId: string; content: string } | null>>;
  clearDraftInput: (chatId: string) => void;
  recordCost: (chatId: string, entry: ChatCostEntry) => void;
  chatId: string;
  askWorkspaceMode: boolean;
  scopedFolder: string | null;
  activeMatter: Matter | null;
  includePrivileged: boolean;
  messages: ChatMessage[];
  isLoading: boolean;
  aiRules: string;
  openFiles: ExtractedContext[];
  scopedOpenFiles: ExtractedContext[];
  inputValue: string;
  pendingAttachments: ChatAttachment[];
  /** Connector-access: cached PDF text per attachment id, so a recognized export
   *  attached under a renamed/generic filename is still caught by its branding
   *  content (not just its name) before its bytes are sent. */
  pdfExtractions: Record<string, PdfExtractionResult>;
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

/**
 * Perf (P1.2) — per-turn token-stream buffering. `onChunk` fires once per
 * SSE token (dozens of times a second); this coalesces arrivals into at
 * most one flush per animation frame instead of a React/Zustand write per
 * token.
 *
 * Codex review (P1, round 4): this MUST be created fresh per `sendMessage`
 * call, never shared as a hook-level ref. `AIChatViewer`'s local streaming-
 * preview state outlives a `chatId` prop change (MainPanel reuses the same
 * instance across open chats), so if the user switches chats and sends
 * again before the first turn's stream finishes, two concurrent streams
 * would exist. A SHARED buffer/frame-id pair would let a late chunk from
 * the old turn overwrite the new turn's buffered text just before its
 * flush fires — publishing the WRONG chat's content under the right
 * chatId, still a confidentiality leak even with the chatId tag from the
 * previous fix. Each call to `createStreamFlusher` closes over its own
 * `buffer`/`rafId`, so two turns in flight at once never share state.
 */
export function createStreamFlusher(
  chatId: string,
  setStreamingPreview: UseChatSendingDeps['setStreamingPreview'],
) {
  let buffer = '';
  let rafId: number | null = null;
  return {
    /** Buffer a chunk and schedule a flush if one isn't already pending. */
    push(content: string) {
      buffer = content;
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        setStreamingPreview({ chatId, content: buffer });
      });
    },
    /** Flush immediately (terminal states: abort, or the outer error catch). */
    flushNow(content: string) {
      buffer = content;
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      setStreamingPreview({ chatId, content: buffer });
    },
    /** Whatever was buffered so far — used to preserve partial text if the
     *  stream throws a non-abort error (see the outer catch below). */
    getBuffer() {
      return buffer;
    },
    /**
     * End of turn: cancel any pending frame (so a late tick can't resurrect
     * this turn's preview after it's been cleared) and clear the preview —
     * but ONLY if it's still showing THIS turn's chatId. A different,
     * still-in-flight turn's live preview (a different or the same chat,
     * sent again) must not be wiped out just because this one finished.
     */
    finish() {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      setStreamingPreview((prev) => (prev && prev.chatId === chatId ? null : prev));
    },
  };
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
    setStreamingPreview,
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
    pdfExtractions,
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

  const buildFastProvider = useCallback((): { provider: import('@/platform/providers/Provider').Provider; providerId: string; model: string } | null => {
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
      // Use the chat's ACTUAL local engine for compression so a Lantern Local
      // AI chat isn't silently rerouted to the user's Ollama daemon (which may
      // not even be running). Both stay fully on-device.
      const provider = chatProvider === 'lantern-local'
        ? createProvider({ provider: 'lantern-local' })
        : createProvider({ provider: 'ollama' });
      return { provider, providerId: chatProvider, model: provider.getMetadata().model };
    }
    // Personal-install choice gate (Task 1.3 fix): compression is cloud generation;
    // block it until the user has made an explicit confidentiality choice.
    // assertCloudGenerationAllowed throws synchronously — buildFastProvider is
    // called inside try/catch in handleManualCompress, so the error surfaces
    // as the inline error message without crashing the send path.
    assertCloudGenerationAllowed(chatProvider);
    const apiKey = apiKeys.find(k => k.provider === chatProvider && k.isValid);
    if (!apiKey) return null;
    // One front door (fix F2.2): build the fast compression provider through the
    // shared factory. The "fast" model ids are pinned here (compression wants a
    // cheap/quick model, not the chat's main model).
    switch (chatProvider) {
      case 'anthropic': {
        const provider = createProvider({ provider: 'anthropic', apiKey: apiKey.key, model: 'claude-3-5-haiku-latest' });
        return { provider, providerId: 'anthropic', model: provider.getMetadata().model };
      }
      case 'openai': {
        const provider = createProvider({ provider: 'openai', apiKey: apiKey.key, model: 'gpt-4o-mini' });
        return { provider, providerId: 'openai', model: provider.getMetadata().model };
      }
      case 'google': {
        const provider = createProvider({ provider: 'google', apiKey: apiKey.key, model: 'gemini-1.5-flash' });
        return { provider, providerId: 'google', model: provider.getMetadata().model };
      }
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
      const fastResolved = buildFastProvider();
      if (!fastResolved) {
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
      const compressionScope = askSendPipeline.buildContext({
        activeMatterId: activeMatter?.id ?? null,
        activeMatterName: activeMatter ? matterLabel(activeMatter) : null,
      }).auditScope;
      const result = await compressMessages(currentMessages, {
        keepRecentTurns,
        batchTokenTarget: 10_000,
        fastProvider: fastResolved.provider,
        sendSummary: (provider, prompt, options, batchIndex) =>
          sendPreparedMessageWithEgressAudit({
            provider,
            providerId: fastResolved.providerId,
            model: fastResolved.model,
            surface: 'chat_compression',
            prompt,
            options,
            parts: [{ id: 'chat-history', origin: 'chat_history', label: 'Earlier chat messages', text: prompt }],
            background: true,
            ...(onAuditLog ? { onAuditLog } : {}),
            scope: compressionScope,
            modelCall: (response) => ({
              action: 'model_call',
              description: `Chat compression batch to ${fastResolved.model}`,
              model: fastResolved.model,
              inputs: { chatId, batchIndex, promptLength: prompt.length },
              outputs: { contentLength: response.content.length },
              userDecision: 'auto',
              metadata: { chatId, feature: 'chat_compression', batchIndex },
              tokensIn: response.usage.inputTokens,
              tokensOut: response.usage.outputTokens,
              costUsd: response.cost,
              provider: fastResolved.providerId,
            }),
          }),
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
      const message = err instanceof Error && err.message === 'prompt_review_required'
        ? 'Review private links before sending this summary to AI.'
        : `Compression failed: ${err instanceof Error ? err.message : String(err)}`;
      addMessage(chatId, {
        role: 'assistant',
        content: message,
        timestamp: new Date().toISOString(),
        isError: true,
      });
    }
    setCompressionModalOpen(false);
  }, [sessions, chatId, chatData, buildFastProvider, keepRecentTurns, onSave, onAuditLog, addMessage, activeMatter]);

  const handleSendMessage = useCallback(async () => {
    if ((!inputValue.trim() && pendingAttachments.length === 0) || isLoading) return;
    const currentSelection = readSelectionOperationDecision({
      operationClass: 'matter-scoped',
      allowAllMatters: true,
      requireFollowerAgreement: true,
      expectedScope: activeMatter
        ? { kind: 'matter', matterId: activeMatter.id }
        : { kind: 'all-matters' },
    });
    if (currentSelection.kind === 'refused') {
      addMessage(chatId, {
        role: 'assistant',
        content: currentSelection.message,
        timestamp: new Date().toISOString(),
        isError: true,
      });
      return;
    }
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

    // F2.5 — snapshot the file-access consent decision at send start (single
    // source of truth reused below for retrieval gating, tool registration, the
    // system prompt, and the egress audit). A grant is bound to the scope it was
    // made under; a local provider never leaks, so consent is a cloud concern.
    const sendContext = askSendPipeline.buildContext({
      activeMatterId: activeMatter?.id ?? null,
      activeMatterName: activeMatter ? matterLabel(activeMatter) : null,
    });
    const turnConsentScope: ConsentScope = sendContext.consentScope;
    const fileToolsEnabled = fileToolsAllowed(getFileAccessConsent(chatId), turnConsentScope);
    const providerIsCloud = !isLocalProviderId(effectiveProvider);

    const rawContent = inputValue.trim();
    const parsed = parseWorkspaceCommand(rawContent);
    // M2 — retrieval triggers when the user explicitly tagged `@workspace`, or
    // when the Ask-my-workspace mode is on for this chat. We call MemoryService
    // (not raw ragRetrieve) so the Settings toggle is respected with a clean `[]`
    // short-circuit when off.
    //
    // F2.5 — "reading is sending" also covers ambient retrieval. A TYPED
    // `@workspace` mention is per-message intent (the user asked, right now), so
    // it's always allowed. But the persistent Ask-my-workspace TOGGLE is NOT
    // per-message intent — leaving it on would send workspace snippets to a cloud
    // provider on every message with no per-conversation consent. So ambient
    // (toggle-driven) retrieval requires the file-access consent when the provider
    // is a cloud one; local providers are unaffected (nothing leaves the device).
    const { shouldRetrieve, ambientBlockedByConsent } = resolveWorkspaceRetrieval({
      explicitWorkspace: parsed.hasCommand,
      askWorkspaceMode,
      isCloudProvider: providerIsCloud,
      fileAccessGranted: fileToolsEnabled,
    });
    let retrievedSources: WorkspaceSource[] = [];
    let workspaceHint: string | undefined;
    // Option B: the raw retrieval error, kept separate from the user-facing
    // hint so the refusal below can route on the `model-not-ready` marker
    // without ever rendering the raw error string.
    let retrievalFailure: unknown;
    // WS-B/C — resolve the retrieval scope from the active matter. Captured at
    // send time so a later rename/delete of the matter doesn't rewrite history.
    // A null active matter is the explicit cross-matter ("all matters") scope.
    const retrievalScope: RetrievalScope = sendContext.retrievalScope;
    const turnScope: TurnScope = sendContext.turnScope;
    // F2.5 — the Ask-my-workspace toggle is on but this cloud conversation hasn't
    // consented to file access, so ambient retrieval was skipped. Say so plainly
    // (mirrors the "Memory is off" hint) instead of silently doing nothing — the
    // composer's "Allow file access" affordance is how the user turns it on.
    if (ambientBlockedByConsent) {
      workspaceHint =
        "Ask-my-workspace is paused until you allow file access for this chat.";
    }
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
          // fix/ask-list-hang — bound this LOCAL vector search with a hard
          // timeout so a stalled retrieval (LanceDB kept busy on a large
          // workspace) rejects instead of hanging the send forever. The throw is
          // caught just below (sets the "retrieval failed" hint → the F-116
          // guard refuses honestly) rather than leaving an infinite spinner.
          const hits = await withAskTimeout(
            MemoryService.retrieve(
              retrievalQuery,
              DEFAULT_WORKSPACE_TOP_K,
              retrievalScope,
              includePrivileged,
              undefined,
              enableReranker,
              enableHybridSearch,
            ),
            ASK_RETRIEVAL_TIMEOUT_MS,
            'retrieval',
          );
          // D1 — filter workspace retrieval results to the active folder scope
          // so @workspace searches don't surface documents from other client
          // folders when the chat is scoped to a specific folder.
          const scopedHits = scopedFolder && rootPath
            ? hits.filter((h) => {
                const scopedPaths = filterByScope([h.path], rootPath, scopedFolder);
                return scopedPaths.length > 0;
              })
            : hits;
          // Connector-access: drop recognized RightCapital/Jump exports here when
          // consent has not been given, so @workspace chat never AI-processes an
          // exported report before consent — and the context, the citation/source
          // list, and the empty-evidence check all use the same consented set.
          const filteredHits = filterHitsForExportConsent(scopedHits);
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
              ? t('ai.chat.model-not-ready-refuse')
              : t('ai.chat.retrieval-failed-refuse', { reason });

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
        const auditScope: AuditScope = sendContext.auditScope;
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

    // Connector-access: a chat attachment is another way file content reaches the
    // model. When consent is off, an attachment recognized (by filename) as a
    // RightCapital/Jump export is withheld from the provider. `sentAttachments`
    // is the subset that is ACTUALLY sent — used for loading bytes, token
    // estimates, AND the "sent to provider" audit, so the audit never claims a
    // withheld file left the device. `messageAttachments` (all of them) still
    // records what the user attached on their own message. Withheld filenames are
    // sanitized before going anywhere near the prompt (prompt-injection guard).
    const withheldExportAttachments: ChatAttachment[] =
      messageAttachments && !isExternalExportConsentGiven()
        ? messageAttachments.filter(
            (a) =>
              recognizeProvenance({
                path: a.fileName || a.pathInWorkspace,
                // Catch a renamed export by its branding content too (not just the
                // filename), using the PDF text already extracted in the composer.
                // Images / scanned PDFs have no text — those fall back to filename.
                text: pdfExtractions[a.id]?.pages.join('\n'),
              }) !== null,
          )
        : [];
    const sentAttachments: ChatAttachment[] | undefined = messageAttachments
      ? messageAttachments.filter((a) => !withheldExportAttachments.includes(a))
      : undefined;
    // Generic note ONLY — never put the withheld filename in the prompt. Advisor
    // filenames can carry client names / report details, so sending them to the
    // model would itself leak metadata about a file we deliberately withheld (and
    // a crafted name could attempt prompt injection). The user sees which file in
    // their own message UI; the model only needs the count.
    const withheldExportNote =
      withheldExportAttachments.length > 0
        ? `\n\nNOTE (system): ${withheldExportAttachments.length === 1 ? 'One attachment the user added was' : `${String(withheldExportAttachments.length)} attachments the user added were`} recognized as exported report(s) from an outside tool (for example RightCapital or Jump) and ${withheldExportAttachments.length === 1 ? 'was' : 'were'} NOT included, because using exported reports with AI needs the advisor's one-time confirmation (Settings > AI & Privacy, or the Ask tab). Tell the user this plainly; do not pretend to have read ${withheldExportAttachments.length === 1 ? 'it' : 'them'}.`
        : '';

    // Connector-access: attachment-only send where EVERY attachment was a withheld
    // export and there's no typed question. The provider would get an empty user
    // message and reject it, so answer LOCALLY with the consent explanation. This
    // runs BEFORE the context-limit/compression check and the attachment-clearing
    // below, so it still fires in a long, over-limit thread.
    if (
      rawContent === '' &&
      withheldExportAttachments.length > 0 &&
      (sentAttachments?.length ?? 0) === 0
    ) {
      const consentUserMessage: ChatMessage = {
        role: 'user',
        content: rawContent,
        timestamp: new Date().toISOString(),
        ...(messageAttachments ? { attachments: messageAttachments } : {}),
      };
      const consentRefusalMessage: ChatMessage = {
        role: 'assistant',
        content:
          withheldExportAttachments.length === 1
            ? 'I didn’t use that attachment. It looks like an exported report from an outside tool (for example RightCapital or Jump), and using exported reports with AI needs your one-time confirmation first. Turn on "Allow exported reports from other tools" in Settings → AI & Privacy (or ask in the Ask tab, where you’ll be prompted), then send it again.'
            : 'I didn’t use those attachments. They look like exported reports from outside tools (for example RightCapital or Jump), and using exported reports with AI needs your one-time confirmation first. Turn on "Allow exported reports from other tools" in Settings → AI & Privacy (or ask in the Ask tab, where you’ll be prompted), then send them again.',
        timestamp: new Date().toISOString(),
      };
      addMessage(chatId, consentUserMessage);
      // Reset the composer (mirrors the normal send path's cleanup).
      setPendingAttachments([]);
      for (const url of Object.values(previewUrls)) {
        URL.revokeObjectURL(url);
      }
      setPreviewUrls({});
      setPdfExtractions({});
      setInputValue('');
      clearDraftInput(chatId);
      addMessage(chatId, consentRefusalMessage);
      // Persist to the .aichat file like every other send path — addMessage only
      // updates the in-memory store, so build the final array explicitly (store
      // updates are async) rather than relying on stale state.
      if (onSave) {
        onSave({
          ...chatData,
          updated: new Date().toISOString(),
          messages: [...messages, consentUserMessage, consentRefusalMessage],
        });
      }
      return;
    }

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

    // Perf (P1.2): declared here — OUTSIDE the IIFE below — so both its body
    // (the try/catch/finally) AND the `.catch()` chained onto it can read/
    // finish the same flusher. Assigned only when the streaming path runs.
    let streamFlusher: ReturnType<typeof createStreamFlusher> | null = null;

    // Call AI provider with streaming. The IIFE is voided because
    // handleSendMessage itself is async — this fire-and-forget inner
    // IIFE intentionally runs off the main call stack (streaming updates
    // continue after the caller's useCallback returns). All errors are
    // caught inside; the outer .catch surfaces any unexpected escape.
    void (async () => {
      let providerSendCompletedOrCancelledAfterEgress = false;
      // Fix 3 (connect-flow demo hardening) — set true right BEFORE the
      // provider call, unlike providerSendCompletedOrCancelledAfterEgress
      // (which only flips on a SUCCESSFUL completion/cancel). Mirrors
      // useAsk's providerCallStarted: it must stay true even when the call
      // itself throws, so the catch block below can tell "the provider
      // rejected this" apart from "we never reached the provider" (e.g. no
      // API key configured).
      let providerCallAttempted = false;
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
          // A3: build the egress audit scope from the scope CAPTURED at send time
          // (`turnScope`), NOT a late getActiveScope(). The egress records which
          // client this request's data actually left under; if the user switches
          // the active client while the response is still streaming, a late
          // getActiveScope() would name the NEW client in the Data Map — falsely
          // attributing one client's egress to another. turnScope is frozen at
          // send and carries the human label captured then (matterResolver).
          const auditScope: AuditScope = sendContext.auditScope;
          return { egress, auditScope };
        };

        const buildSuccessfulEgressAuditEntry = (): AuditEntryInput => {
          const { egress, auditScope } = buildEgressAuditPayload();
          return auditEventToEntry({
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
              // F2.5 — record whether READ-class file tools were enabled for this
              // send, so the trust surface (Data Map / audit) is honest about
              // which sends could pull more files.
              fileToolsEnabled,
            },
          });
        };

        const emitSuccessfulEgressAudit = async (auditPairId: string) => {
          await mustLogAuditPhase(
            onAuditLog,
            buildSuccessfulEgressAuditEntry(),
            'outcome',
            auditPairId,
          );
        };

        const buildCancelledEgressAuditEntry = (): AuditEntryInput => {
          const { egress, auditScope } = buildEgressAuditPayload();
          return {
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
              fileToolsEnabled, // F2.5
            },
          };
        };

        const emitCancelledEgressAudit = async (auditPairId: string) => {
          await mustLogAuditPhase(
            onAuditLog,
            buildCancelledEgressAuditEntry(),
            'outcome',
            auditPairId,
          );
        };

        const buildModelCallAuditEntry = (
          contentLength: number,
          streamed: boolean,
          usage?: { inputTokens?: number; outputTokens?: number },
          cost?: number,
        ): AuditEntryInput => ({
          action: 'model_call',
          description: `Chat message to ${effectiveChatModel}`,
          model: effectiveChatModel,
          inputs: { promptLength: userMessage.content.length },
          outputs: { contentLength },
          userDecision: 'auto',
          metadata: { chatId, streamed },
          tokensIn: usage?.inputTokens ?? 0,
          tokensOut: usage?.outputTokens ?? 0,
          costUsd: cost ?? 0,
          provider: chatProvider,
        });

        // The prepared helper emits its receipt synchronously before it starts
        // its egress operation. Keep the older durable intent pair, but create
        // it only after that receipt says this request may proceed. The helper's
        // own egress/model rows are intentionally not duplicated here: this
        // chat path already records the durable intent/outcome pair below.
        const preparedAuditLogger: AuditLogSink = (entry) => {
          if (entry.action !== 'prompt_preparation') return;
          onAuditLog?.(entry);
        };

        const saveDurableIntent = async (auditPairId: string, streamed: boolean) => {
          await mustLogAuditPhase(
            onAuditLog,
            buildSuccessfulEgressAuditEntry(),
            'intent',
            auditPairId,
          );
          await mustLogAuditPhase(
            onAuditLog,
            buildModelCallAuditEntry(0, streamed),
            'intent',
            auditPairId,
          );
        };

        const emitSuccessfulAttachmentAudits = () => {
          // Only attachments actually sent — a withheld unconsented export must
          // NOT be audited as "sent to provider".
          for (const att of sentAttachments ?? []) {
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

        // Stream A1 — estimate image token overhead for cost meter (only what is
        // actually sent; a withheld export contributes no tokens).
        const imageTokenOverhead = (sentAttachments ?? []).reduce(
          (sum, att) => sum + estimateImageTokens(chatProvider, att),
          0
        );

        // Stream A2 — estimate PDF token overhead for cost meter.
        const pdfTokenOverhead = (sentAttachments ?? []).reduce((sum, att) => {
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
        // F2.5 — the single predicate for "are file tools registered for this
        // send?". Drives BOTH setTools below AND the system prompt (hasWorkspace),
        // so the prompt can never claim tools the provider wasn't given. The demo
        // provider is text-only and never gets setTools (see the IS_DEMO branch
        // below), so it must report false here too (Codex P2) — otherwise the demo
        // prompt would advertise tools that were never registered.
        const fileToolsRegisteredForSend = !IS_DEMO && fileToolsRegistered({
          hasWorkspace: hasWorkspaceForTools,
          isCloudProvider: providerIsCloud,
          fileAccessGranted: fileToolsEnabled,
        });
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
        // Matter-scope + open-editor guards (BUG-036/047/063) — bodies live in
        // fileAccessGuards.ts; these thin closures bind THIS send's matter scope
        // so every tool call site below stays byte-identical. assertNotOpenWithUnsavedEdits
        // and assertNoOpenDescendant take no scope, so they're imported directly.
        const pathInActiveMatter = (absPath: string): boolean =>
          pathInActiveMatterGuard(absPath, toolActiveMatterId, toolMatters);
        const assertInActiveMatter = (absPath: string, relativePath: string): void => {
          assertInActiveMatterGuard(absPath, relativePath, { toolActiveMatterId, toolMatters, activeMatterName });
        };
        // F2.5 — list_files fail-closed pre-check (ancestor-aware): rejects '..'
        // and cross-matter dirs BEFORE the FS is touched, while still allowing
        // navigation down through ancestors of the matter's folders.
        const assertDirInActiveMatter = (absDir: string, relativePath: string): void => {
          assertDirInActiveMatterGuard(
            absDir,
            relativePath,
            { toolActiveMatterId, toolMatters, activeMatterName },
            activeMatterFolders,
          );
        };

        // F2.5 — the per-conversation file-access consent decision was snapshot at
        // send start (`fileToolsEnabled`, above). It gates BOTH ambient retrieval
        // and the file-tool registration below, so both agree and neither can be
        // changed by a mid-stream client switch. `assertFileToolAllowed` is the
        // executor backstop; the registration site is the primary gate.
        const assertFileToolAllowed = (): void => {
          // Defense-in-depth: ALL file tools (read AND write) are withheld from
          // the registered tool set when consent is off, so the model can't call
          // them at all. This guard fails closed even if a provider hallucinates
          // a call or a future change re-registers a tool without re-checking.
          if (!fileToolsEnabled) {
            throw new Error(
              'File access is off for this conversation. Ask the user to allow AI file access (the "Allow file access" control above the message box) before reading, listing, searching, or changing files.',
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
          // F2.5 — fail closed for EVERY file tool if this conversation hasn't
          // consented to file access under the current scope. Defense-in-depth:
          // when consent is off the tools aren't registered on the provider at
          // all, so the model can't reach here; this backstops a hallucinated
          // call or any future registration change.
          assertFileToolAllowed();

          switch (toolName) {
            case 'read_file': {
              const relativePath = params['path'] as string;
              const filePath = workspacePath(rootPath, relativePath);
              if (!sameOrInside(rootPath, filePath)) throw new Error('Access denied: path outside workspace');
              assertInActiveMatter(filePath, relativePath); // BUG-036
              try {
                const content = await workspaceServiceRef.current.readFile(filePath);
                // Connector-access: read_file is a third way file content reaches
                // the model. If this file is a recognized RightCapital/Jump export
                // and the advisor hasn't consented, WITHHOLD its content (return a
                // notice, not the report) so "read RightCapital-Plan.pdf" can't
                // leak it. Consent is granted in the Ask tab or Settings.
                if (
                  !isExternalExportConsentGiven() &&
                  recognizeProvenance({ path: relativePath, text: content }) !== null
                ) {
                  return {
                    content:
                      brandText(`This file is recognized as an exported report from an outside tool (for example RightCapital or Jump). ${BRAND.name} needs your one-time confirmation before exported reports are used with AI. Turn on "Allow exported reports from other tools" in Settings → AI & Privacy, or ask about it in the Ask tab where you will be prompted. The file content was not read.`),
                    path: relativePath,
                    withheld: true,
                  };
                }
                return { content, path: relativePath };
              } catch (error) {
                throw new Error(`Failed to read file "${relativePath}": ${error instanceof Error ? error.message : 'Unknown error'}`);
              }
            }
            case 'list_files': {
              const relativePath = (params['path'] as string) || '.';
              const dirPath = relativePath === '.' || relativePath === '' ? rootPath : workspacePath(rootPath, relativePath);
              if (!sameOrInside(rootPath, dirPath)) throw new Error('Access denied: path outside workspace');
              // F2.5 eval fix — fail closed on '..' / cross-matter BEFORE the FS
              // is touched (the startsWith check above can't catch '..'; the old
              // code only post-filtered results AFTER listing). Ancestor dirs are
              // still allowed so the model can navigate down.
              assertDirInActiveMatter(dirPath, relativePath);
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
                      visibleInScope(workspacePath(dirPath, e.name), e.type !== 'file'),
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
              const rawQuery = params['query'];
              const query =
                typeof rawQuery === 'string'
                  ? rawQuery
                  : typeof rawQuery === 'number' || typeof rawQuery === 'boolean' || typeof rawQuery === 'bigint'
                    ? String(rawQuery)
                    : '';
              try {
                const fileTree = await workspaceServiceRef.current.getFileTree();
                const searchResults: Array<{ name: string; path: string; type: string }> = [];
                const regex = fileSearchQueryToRegex(query);
                const searchNode = (nodes: any[], parentPath = '') => {
                  for (const node of nodes) {
                    const nodePath = parentPath ? `${parentPath}/${node.name}` : node.name;
                    if (regex.test(node.name)) searchResults.push({ name: node.name, path: nodePath, type: node.type });
                    if (node.children) searchNode(node.children, nodePath);
                  }
                };
                searchNode(fileTree);
                // BUG-036: drop results outside the active matter so the model
                // can't discover another matter's files by name search.
                const scopedResults = searchResults.filter((r) =>
                  pathInActiveMatter(workspacePath(rootPath, r.path)),
                );
                return { results: scopedResults, query };
              } catch (error) {
                throw new Error(`Failed to search files: ${error instanceof Error ? error.message : 'Unknown error'}`);
              }
            }
            case 'write_file': {
              const relativePath = params['path'] as string;
              const content = params['content'] as string;
              const filePath = workspacePath(rootPath, relativePath);
              if (!sameOrInside(rootPath, filePath)) throw new Error('Access denied: path outside workspace');
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
              const folderPath = workspacePath(rootPath, relativePath);
              if (!sameOrInside(rootPath, folderPath)) throw new Error('Access denied: path outside workspace');
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
              const fullFromPath = workspacePath(rootPath, fromPath);
              const fullToPath = workspacePath(rootPath, toPath);
              if (!sameOrInside(rootPath, fullFromPath) || !sameOrInside(rootPath, fullToPath)) throw new Error('Access denied: path outside workspace');
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
              const filePath = workspacePath(rootPath, relativePath);
              if (!sameOrInside(rootPath, filePath)) throw new Error('Access denied: path outside workspace');
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
                  window.dispatchEvent(new CustomEvent(EV_TRASH_CHANGED));
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
          // WS-C honesty — one front door (fix F2.2): this is the single chat
          // send path, and it builds the provider through the shared factory so
          // it can never drift from redline / Client Map / At-a-Glance on which
          // provider a selection maps to. A LOCAL id ('ollama'/'lantern-local')
          // constructs the on-device engine and ignores the empty key + assured
          // route; the factory throws on an unknown id rather than defaulting to
          // Claude, so a confidential/local chat can never be silently routed to
          // the cloud. (createProvider ignores `assured` for local ids.)
          provider = createProvider({
            provider: chatProvider,
            apiKey: apiKey?.key ?? '',
            // Preserve the pre-F2.2 no-model default EXACTLY: when a chat carries
            // no stored model (a legacy/edge .aichat), OpenAI used its own
            // constructor default (gpt-4o), not the factory's free-tier default
            // (gpt-4o-mini). Local ids and Anthropic/Gemini already match, so
            // only OpenAI needs the explicit fallback.
            ...(chatModel
              ? { model: chatModel }
              : chatProvider === 'openai'
                ? { model: OPENAI_DEFAULT_MODEL }
                : {}),
            ...rulesOpt,
            ...assuredOpt,
          });
          // File-access tools are a CLOUD-provider capability: the local engines
          // don't support tool calling (the non-tool streaming path handles them
          // and the egress indicator stays "nothing leaves"). setTools lives on
          // the concrete cloud classes (Claude/OpenAI/Gemini share the
          // ClaudeStyleTool shape), not on the base Provider interface — hence
          // the narrow cast at this one boundary.
          //
          // F2.5 — ONE predicate (fileToolsRegistered) decides registration AND
          // drives the system prompt below (hasWorkspace), so the model is never
          // told about tools it doesn't have. Tools register only for a CLOUD
          // provider, with a workspace, once file access is consented for this
          // scope. When off, NO file tools register (read OR write) — the model
          // can't read/list/search or use a write tool as a silent existence
          // oracle. WRITE tools still self-gate per action once registered.
          if (fileToolsRegisteredForSend) {
            (provider as unknown as {
              setTools: (tools: typeof FILE_ACCESS_TOOLS, executor: typeof toolExecutor) => void;
            }).setTools(FILE_ACCESS_TOOLS, toolExecutor);
            console.log('[AIChat DIAGNOSTIC] File tools registered on', chatProvider, 'provider:', FILE_ACCESS_TOOLS.length, 'tools');
          } else if (hasWorkspaceForTools && providerIsCloud) {
            console.log('[AIChat DIAGNOSTIC] File tools WITHHELD on', chatProvider, '— file access not consented for this conversation/scope');
          } else if (!hasWorkspaceForTools) {
            console.warn('[AIChat DIAGNOSTIC] Tools NOT registered on', chatProvider, '— workspace service or rootPath missing');
          }
        }
        effectiveChatModel = provider.getMetadata().model;

        // Stream A1 — Read raw bytes for each attachment so providers can
        // build their provider-specific image content blocks. Attachments
        // are stored on disk; we read them now so the async I/O is done
        // before we hand off to the provider. Any attachment that fails to
        // read is skipped gracefully (logged but not fatal).
        // Load bytes ONLY for sentAttachments — unconsented exports were already
        // excluded above, so their bytes are never read or handed to the provider.
        let attachmentBytes = await loadAttachmentBytes(
          sentAttachments,
          workspaceServiceRef?.current?.getBackend() ?? null,
        );
        // Vision uploads are only allowed after the existing local OCR seam has
        // read their text. Clean images retain their original bytes; a secret or
        // an OCR failure is blocked by prompt preparation below (we cannot safely
        // redact image pixels yet).
        const imageOcrText = new Map<string, string>();
        for (const attachment of attachmentBytes ?? []) {
          const text = await extractImageTextForCloudScan(attachment);
          if (text !== undefined) imageOcrText.set(attachment.att.id, text);
        }
        attachmentBytes = attachmentBytes?.map((attachment) => {
          const extractedText = imageOcrText.get(attachment.att.id);
          return extractedText === undefined ? attachment : { ...attachment, extractedText };
        });

        // F2.5 — the system prompt's "you have read/write file tools" block MUST
        // match what was ACTUALLY registered (same predicate). When file access
        // isn't consented (or the provider is local, or there's no workspace) no
        // tools register, so the prompt must NOT claim them — otherwise the model
        // is told to use tools it doesn't have and "refuse"-loops or hallucinates
        // tool calls as text.
        const hasWorkspace = fileToolsRegisteredForSend;

        // Append any enabled open-file contexts BEFORE the conversation
        // history. This lets the AI treat the files as background material
        // that applies to every turn rather than a stale one-shot attachment.
        // D1 — use scopedOpenFiles so the prompt only contains files within
        // the active folder scope (identical to openFiles when no scope is set).
        // Connector-access: an open editor tab is another way file content reaches
        // the model, so apply the SAME export-consent gate here — a recognized
        // RightCapital/Jump export sitting in an open tab is withheld until the
        // advisor consents (consistent with the @workspace retrieval gate above).
        const consentedOpenFiles = dropUnconsentedExports(
          scopedOpenFiles,
          (f) => ({ path: f.path || f.fileName, text: f.extractedText }),
        );
        const fileBlock = buildOpenFilesPromptBlock(consentedOpenFiles);

        // M3 — facts are durable memory; snapshot them (async I/O) before the
        // pure string assembly. buildSystemPrompt does the layered composition
        // (facts → workspace context → base role → open files → history) so the
        // exact prefix order can't drift.
        // A1 (isolation): inject ONLY facts that may be sent under THIS turn's
        // client scope. A client-scoped turn gets only that client's facts (and
        // no global/legacy ones); an all-matters turn gets only global facts.
        // `activeMatter` is the same value the retrieval + tool scope captured
        // at send start, so facts can never leak across the client boundary.
        const facts = await snapshotFactsForInjection(
          activeMatter ? { matterId: activeMatter.id } : { matterId: null },
        );
        const systemPrompt = buildSystemPrompt({
          messages,
          hasWorkspace,
          rootPath,
          fileBlock,
          retrievedSources,
          facts,
          withheldExportNote,
        });

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
          // Perf (P1.2): fresh per turn (see createStreamFlusher's doc) — if
          // the user switches chats and sends again before this stream
          // finishes, the two turns' flushers never share buffer/frame state.
          // Captured into a local `const` (not just the outer mutable
          // `streamFlusher`) so the nested `onChunk`/abort-catch closures
          // below get a use that TS can narrow as non-null.
          const flusher = createStreamFlusher(chatId, setStreamingPreview);
          streamFlusher = flusher;
          const auditPairId = createAuditPairId('chat');

          try {
            // Race guard (defense-in-depth; cloud providers also fail-closed
            // centrally): the local-only check at the top of this send happened
            // BEFORE the attachment/memory awaits, so re-check immediately before
            // the actual network send.
            assertLocalOnlyAllowsSend(provider.getMetadata().providerId ?? chatProvider);
            providerCallAttempted = true;
            streamingResponse = await sendPreparedStreamingWithEgressAudit({
              provider,
              providerId: provider.getMetadata().providerId ?? chatProvider,
              model: effectiveChatModel,
              surface: 'chat_send',
              prompt: userMessage.content,
              options: {
                systemPrompt,
                maxTokens: 4096,
                onChunk: (chunk: string) => {
                  streamingAuditState.receivedChunk = true;
                  accumulated += chunk;
                  // Buffer locally (component state, not the Zustand store)
                  // and flush at most once per animation frame. The store
                  // gets exactly one write for this turn, once the stream
                  // finishes (or is aborted) — see the `finally` below and
                  // the citation-verification commit further down.
                  flusher.push(accumulated);
                },
                signal: abortController.signal,
                ...(attachmentBytes ? { attachmentBytes } : {}),
              },
              onAuditLog: preparedAuditLogger,
              beforeEgress: () => saveDurableIntent(auditPairId, true),
              parts: [
                { id: 'prompt', origin: 'typed_question', label: 'Your message', text: userMessage.content },
                { id: 'chat-history', origin: 'chat_history', label: 'Earlier chat messages', text: messages.map((message) => message.content).join('\n') },
                { id: 'retrieval', origin: 'retrieval', label: 'Retrieved workspace material', text: retrievedSources.map((source) => source.chunkText).join('\n') },
                { id: 'open-files', origin: 'open_file', label: 'Open files', text: fileBlock },
                { id: 'facts', origin: 'chat_history', label: 'Saved chat facts', text: facts.map((fact) => fact.text).join('\n') },
                ...(attachmentBytes ?? []).map((attachment, attachmentIndex) => {
                  const extraction = pdfExtractions[attachment.att.id];
                  const imageText = imageOcrText.get(attachment.att.id);
                  return {
                    id: `attachment-${attachment.att.id}`,
                    origin: 'attachment_text' as const,
                    label: 'Attachment',
                    attachment: {
                      attachmentId: attachment.att.id,
                      attachmentIndex,
                      canRedact: attachment.att.type === 'pdf',
                      ...(extraction
                        ? { extractedText: extraction.pages.join('\n') }
                        : imageText !== undefined ? { extractedText: imageText } : {}),
                    },
                  };
                }),
              ],
            });
          } catch (err) {
            if (err instanceof DOMException && err.name === 'AbortError') {
              // User cancelled — keep whatever was streamed so far
              accumulated += '\n\n*(Response stopped by user)*';
              flusher.flushNow(accumulated);
              if (streamingAuditState.receivedChunk) {
                providerSendCompletedOrCancelledAfterEgress = true;
                await emitCancelledEgressAudit(auditPairId);
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
            await emitSuccessfulEgressAudit(auditPairId);
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
            await mustLogAuditPhase(
              onAuditLog,
              buildModelCallAuditEntry(
                streamingResponse.content.length,
                true,
                streamingResponse.usage,
                streamingResponse.cost,
              ),
              'outcome',
              auditPairId,
            );
          }

          // WS-B/C — verify citations against the local store now the full
          // answer is in. Update the streamed message's sources with the
          // verification flags so unverified citations are surfaced. The
          // normalize-then-verify step (incl. the per-citation audit callback)
          // lives in verifyCitationsInResponse so it can't drift from the
          // non-streaming path below.
          const { normalized: normalizedAnswer, verified: verifiedStreamSources } =
            await verifyCitationsInResponse(accumulated, retrievedSources, activeMatter, emitCitationVerified);

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
          const auditPairId = createAuditPairId('chat');
          providerCallAttempted = true;
          const response = await sendPreparedMessageWithEgressAudit({
            provider,
            providerId: provider.getMetadata().providerId ?? chatProvider,
            model: effectiveChatModel,
            surface: 'chat_send',
            prompt: userMessage.content,
            options: {
              systemPrompt,
              maxTokens: 4096,
              signal: abortController.signal,
              ...(attachmentBytes ? { attachmentBytes } : {}),
            },
            scope: sendContext.auditScope,
            fileToolsEnabled: fileToolsRegisteredForSend,
            isDemo: IS_DEMO,
            assuredAvailable: Boolean(assuredRoute),
            onAuditLog: preparedAuditLogger,
            beforeEgress: () => saveDurableIntent(auditPairId, false),
            parts: [
              { id: 'prompt', origin: 'typed_question', label: 'Your message', text: userMessage.content },
              { id: 'chat-history', origin: 'chat_history', label: 'Earlier chat messages', text: messages.map((message) => message.content).join('\n') },
              { id: 'retrieval', origin: 'retrieval', label: 'Retrieved workspace material', text: retrievedSources.map((source) => source.chunkText).join('\n') },
              { id: 'open-files', origin: 'open_file', label: 'Open files', text: fileBlock },
              { id: 'facts', origin: 'chat_history', label: 'Saved chat facts', text: facts.map((fact) => fact.text).join('\n') },
              ...(attachmentBytes ?? []).map((attachment, attachmentIndex) => {
                const extraction = pdfExtractions[attachment.att.id];
                const imageText = imageOcrText.get(attachment.att.id);
                return {
                  id: `attachment-${attachment.att.id}`,
                  origin: 'attachment_text' as const,
                  label: 'Attachment',
                  attachment: {
                    attachmentId: attachment.att.id,
                    attachmentIndex,
                    canRedact: attachment.att.type === 'pdf',
                    ...(extraction
                      ? { extractedText: extraction.pages.join('\n') }
                      : imageText !== undefined ? { extractedText: imageText } : {}),
                  },
                };
              }),
            ],
            modelCall: (modelResponse) => ({
              action: 'model_call',
              description: `Chat message to ${effectiveChatModel}`,
              model: effectiveChatModel,
              inputs: { promptLength: userMessage.content.length },
              outputs: { contentLength: modelResponse.content.length },
              userDecision: 'auto',
              metadata: { chatId, streamed: false },
              tokensIn: modelResponse.usage.inputTokens,
              tokensOut: modelResponse.usage.outputTokens,
              costUsd: modelResponse.cost,
              provider: provider.getMetadata().providerId ?? chatProvider,
            }),
          });

          providerSendCompletedOrCancelledAfterEgress = true;
          await emitSuccessfulEgressAudit(auditPairId);
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
          await mustLogAuditPhase(
            onAuditLog,
            buildModelCallAuditEntry(
              response.content.length,
              false,
              response.usage,
              response.cost,
            ),
            'outcome',
            auditPairId,
          );

          // WS-B/C — verify the citations in the answer against the local
          // store BEFORE presenting them. Verified sources are marked safe;
          // any citation that doesn't verify flags its source in the UI. Shares
          // verifyCitationsInResponse with the streaming path so the two can't
          // drift (same normalize-then-verify order + per-citation audit).
          const { normalized: normalizedContent, verified: verifiedSources } =
            await verifyCitationsInResponse(response.content, retrievedSources, activeMatter, emitCitationVerified);

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

        // Perf (P1.2) fix: a stream that throws mid-response (e.g. a network
        // reset) after at least one chunk has arrived left its partial text
        // stranded in the local buffer — it was never written to the store
        // per-chunk, and the flusher's `finish()` below wipes the local
        // preview too. Without this, the placeholder assistant message
        // (added empty when the stream started) stays empty forever and the
        // user loses the partial answer they already saw on screen. Commit
        // whatever was streamed so far to that placeholder before the error
        // bubble is appended below.
        const bufferedPartial = streamFlusher?.getBuffer();
        if (bufferedPartial) {
          updateLastMessage(chatId, bufferedPartial);
        }

        const chatProvider = effectiveProvider;
        const chatModel = chatData.model;
        const promptReviewRequired = error instanceof Error && error.message === 'prompt_review_required';
        if (!providerSendCompletedOrCancelledAfterEgress || error instanceof LocalOnlyEgressError) {
          const egress = resolveEgress({
            provider: chatProvider,
            mode: getConfidentialityMode(),
            isDemo: IS_DEMO,
            assuredAvailable: assuredAvailableForChat,
          });
          const failureType = error instanceof LocalOnlyEgressError || promptReviewRequired
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
              attachmentCount: sentAttachments?.length ?? 0,
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

        // Fix 3 (connect-flow demo hardening): a genuine auth rejection from
        // the resolved cloud provider means the stored key is bad — record it
        // so a new chat never defaults back to it. Reuses the SAME
        // classification useAsk's unified send path uses (isAuthRejectionError),
        // so the two paths can never disagree about what counts as a dead key.
        const rawErrorMessage = error instanceof Error ? error.message : String(error);
        if (
          providerCallAttempted &&
          isVerifiableProvider(chatProvider) &&
          isAuthRejectionError(rawErrorMessage, {
            mode: getConfidentialityMode(),
            reachedProvider: providerCallAttempted,
          })
        ) {
          markKeyInvalid(chatProvider);
        }

        let errorContent: string;
        let errorDiagnostic: string | undefined;

        // WS-C honesty — a LOCAL (Ollama) chat that fails is almost always the
        // daemon not running / not reachable. Show a clear, friendly message
        // telling the user how to fix it. We NEVER silently retry on a cloud
        // provider here: a Local-only / Ollama selection that errors stays
        // local-and-failed, it does not leak to the cloud.
        if (promptReviewRequired) {
          errorContent = 'Review private links before sending this material to AI.';
        } else if (isLocalProviderId(effectiveProvider)) {
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
        // Perf (P1.2): the turn is over one way or another (success, abort,
        // or error) — drop the local streaming buffer/preview now that the
        // store holds whatever final content this turn produced. `finish()`
        // only clears the preview if it's still showing THIS turn's chatId,
        // so it can't wipe a different (or the same, re-sent) chat's still-
        // in-flight preview out from under it.
        streamFlusher?.finish();
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
      streamFlusher?.finish();
      useAiBatchReviewStore.getState().openReview();
    });
  }, [inputValue, pendingAttachments, pdfExtractions, previewUrls, messages, chatData, localAvailability, onSave, isLoading, apiKeys, chatId, addMessage, updateLastMessage, updateMessages, setLoading, setStreamingPreview, workspaceServiceRef, rootPath, onFileTreeChange, onAuditLog, aiRules, openFiles, scopedOpenFiles, scopedFolder, recordCost, clearDraftInput, askWorkspaceMode, activeMatter, includePrivileged]);

  const handleSendAnyway = useCallback(() => {
    bypassNextContextLimitRef.current = true;
    void handleSendMessage();
  }, [handleSendMessage]);

  return { handleSendMessage, handleManualCompress, handleSendAnyway };
}
