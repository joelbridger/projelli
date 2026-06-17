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

import { useCallback } from 'react';
import type { useTranslation } from 'react-i18next';
import { AttachmentService } from '@/modules/attachments/AttachmentService';
import { estimateImageTokens } from '@/modules/attachments/imageTokens';
import { estimatePdfTokens } from '@/modules/attachments/pdfTokens';
import type { PdfExtractionResult } from '@/lib/pdf-extract';
import type { ChatAttachment, AIChatFile, ChatMessage, WorkspaceSource, TurnScope } from '@/types/ai';
import type { AuditEntry, AuditScope, CitationVerdict } from '@/types/audit';
import { auditEventToEntry } from '@/modules/audit/AuditService';
import { resolveEgress } from '@/modules/privacy/egress';
import { getConfidentialityMode } from '@/hooks/useConfidentialityMode';
import type { Provider, AttachmentBytes } from '@/modules/models/Provider';
import { ClaudeProvider } from '@/modules/models/ClaudeProvider';
import { OpenAIProvider } from '@/modules/models/OpenAIProvider';
import { GeminiProvider } from '@/modules/models/GeminiProvider';
import { OllamaProvider } from '@/modules/models/OllamaProvider';
import { isLocalProviderId } from '@/modules/models/providerFactory';
import { resolveAssuredRoute } from '@/modules/firm/resolveAssuredRoute';
import { IS_DEMO } from '@/web-demo/demoModeFlag';
import { createDemoProvider } from '@/web-demo/demoAIProvider';
import { isTauriProductionBuild, parseApiError, ApiResponseParseError } from '@/modules/models/fetchUtils';
import { FILE_ACCESS_TOOLS } from '@/modules/tools/fileAccessTools';
import type { useActiveMatter } from '@/stores/matterStore';
import { matterLabel } from '@/modules/memory/matterResolver';
import type { RetrievalScope } from '@/utils/tauri-commands';
import type { ExtractedContext } from '@/utils/ai-file-context';
import { filterByScope } from '@/utils/client-boundary';
import {
  compressMessages,
  getMessagesForSend,
  clearExpandedFlags,
  estimateMessagesTokens,
  estimateTokens,
} from '@/modules/chat/compression';
import { MemoryService, isMemoryEnabled } from '@/modules/memory/MemoryService';
import {
  DEFAULT_WORKSPACE_TOP_K,
  buildWorkspaceContextBlock,
  normalizeNumericCitations,
  parseWorkspaceCommand,
  verifyCitations,
} from '@/modules/memory/workspaceCommand';
import { buildFactsMemoryBlock } from '@/modules/memory/FactsService';
import { snapshotFactsForInjection } from '@/modules/memory/factsSingleton';
import type { ChatSession, ChatCostEntry } from '@/stores/aiChatStore';
// buildOpenFilesPromptBlock + refusalKeyForReason stay exported from AIChatViewer
// (external importers: useTestModeWorkspace, refusal-key.test). The deferred,
// hoisted-function usage below makes this back-import cycle-safe.
import { buildOpenFilesPromptBlock, refusalKeyForReason } from '../AIChatViewer';
import type { APIKey } from '../AIChatViewer';

export interface UseChatSendingDeps {
  // Props forwarded from AIChatViewer.
  chatData: AIChatFile;
  onSave: ((updatedChat: AIChatFile) => void) | undefined;
  apiKeys: APIKey[];
  workspaceServiceRef: React.MutableRefObject<any> | undefined;
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

  const buildFastProvider = useCallback((): import('@/modules/models/Provider').Provider | null => {
    const chatProvider = chatData.provider ?? 'anthropic';
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
  }, [chatData.provider, apiKeys]);

  const handleManualCompress = useCallback(async () => {
    const currentMessages = sessions[chatId]?.messages ?? chatData.messages;
    const fastProvider = buildFastProvider();
    if (!fastProvider) {
      // Surface error to user — Ollama-only or no API key.
      addMessage(chatId, {
        role: 'assistant',
        content: 'Compression requires a fast cloud model. Configure Claude, OpenAI, or Gemini to enable compression.',
        timestamp: new Date().toISOString(),
        isError: true,
      });
      return;
    }
    try {
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
          const hits = await MemoryService.retrieve(
            retrievalQuery,
            DEFAULT_WORKSPACE_TOP_K,
            retrievalScope,
            includePrivileged,
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
      // Only fire when `askWorkspaceMode` is active (matter-scoped intent
      // has been declared). Normal chat (askWorkspaceMode=false, no @workspace
      // tag) is completely unaffected.
      //
      // Audit events above have already been emitted so the refused turn is
      // fully auditable (the workspace WAS searched; recording it matters).
      if (askWorkspaceMode && retrievedSources.length === 0) {
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

    // Emit attachment_sent_to_provider audit events.
    for (const att of pendingAttachments) {
      onAuditLog?.({
        action: 'user_action',
        description: `Attachment sent to provider: ${att.fileName}`,
        model: chatData.model ?? chatData.provider ?? 'unknown',
        inputs: { hash: att.id, path: att.pathInWorkspace, provider: chatData.provider ?? 'anthropic' },
        outputs: {},
        userDecision: 'auto',
        metadata: { auditEventType: 'attachment_sent_to_provider' },
      });
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
    if (sendTokenEstimate > chatContextTokenLimit) {
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

    // Call AI provider with streaming
    (async () => {
      try {
        // Determine provider from chat data, fallback to anthropic
        const chatProvider = chatData.provider ?? 'anthropic';
        const chatModel = chatData.model;

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

        // Audit (3.0 provenance) — record WHERE this AI request goes, from the
        // egress source of truth (`resolveEgress`), the moment before it is
        // sent: provider, the active confidentiality mode, the resolved
        // destination (local / direct-to-provider / demo relay), and whether
        // anything actually leaves the device. This is the egress half of the
        // defense file and stays consistent with the on-screen egress chip
        // because both derive from the same function.
        {
          const egress = resolveEgress({
            provider: chatProvider,
            mode: getConfidentialityMode(),
            isDemo: IS_DEMO,
            assuredAvailable: assuredAvailableForChat,
          });
          onAuditLog?.(auditEventToEntry({
            type: 'egress',
            timestamp: new Date().toISOString(),
            payload: {
              provider: egress.provider,
              mode: getConfidentialityMode(),
              destination: egress.destination,
              dataLeaves: egress.dataLeaves,
            },
          }));
        }

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
        console.log('[AIChat DIAGNOSTIC] Workspace check:', {
          hasWorkspaceService: !!workspaceServiceRef?.current,
          rootPath,
          hasRootPath: !!rootPath,
          willRegisterTools: hasWorkspaceForTools,
        });

        const toolExecutor = async (toolName: string, params: Record<string, unknown>) => {
          if (!workspaceServiceRef?.current || !rootPath) {
            throw new Error('Workspace not initialized');
          }

          switch (toolName) {
            case 'read_file': {
              const relativePath = params['path'] as string;
              const filePath = `${rootPath}/${relativePath}`.replace(/\/+/g, '/');
              if (!filePath.startsWith(rootPath)) throw new Error('Access denied: path outside workspace');
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
                return {
                  entries: entries.map((e: any) => ({
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
                return { results: searchResults, query };
              } catch (error) {
                throw new Error(`Failed to search files: ${error instanceof Error ? error.message : 'Unknown error'}`);
              }
            }
            case 'write_file': {
              const relativePath = params['path'] as string;
              const content = params['content'] as string;
              const filePath = `${rootPath}/${relativePath}`.replace(/\/+/g, '/');
              if (!filePath.startsWith(rootPath)) throw new Error('Access denied: path outside workspace');
              try {
                const exists = await workspaceServiceRef.current.exists(filePath);
                const action = exists ? 'file_update' : 'file_create';
                const actionLabel = exists ? 'updated' : 'created';
                await workspaceServiceRef.current.writeFile(filePath, content);
                onFileTreeChange?.();
                onAuditLog?.({ action, description: `AI ${actionLabel} file: ${relativePath}`, model: chatModel ?? chatProvider, inputs: { path: relativePath, contentLength: content.length }, outputs: { success: true }, userDecision: 'auto', metadata: { tool: 'write_file' } });
                return { path: relativePath, message: 'File written successfully' };
              } catch (error) {
                throw new Error(`Failed to write file "${relativePath}": ${error instanceof Error ? error.message : 'Unknown error'}`);
              }
            }
            case 'create_folder': {
              const relativePath = params['path'] as string;
              const folderPath = `${rootPath}/${relativePath}`.replace(/\/+/g, '/');
              if (!folderPath.startsWith(rootPath)) throw new Error('Access denied: path outside workspace');
              try {
                await workspaceServiceRef.current.mkdir(folderPath);
                onFileTreeChange?.();
                onAuditLog?.({ action: 'file_create', description: `AI created folder: ${relativePath}`, model: chatModel ?? chatProvider, inputs: { path: relativePath }, outputs: { success: true }, userDecision: 'auto', metadata: { tool: 'create_folder', type: 'folder' } });
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
              try {
                await workspaceServiceRef.current.move(fullFromPath, fullToPath);
                onFileTreeChange?.();
                onAuditLog?.({ action: 'file_move', description: `AI moved file: ${fromPath} → ${toPath}`, model: chatModel ?? chatProvider, inputs: { from: fromPath, to: toPath }, outputs: { success: true }, userDecision: 'auto', metadata: { tool: 'move_file' } });
                return { from: fromPath, to: toPath, message: 'File moved successfully' };
              } catch (error) {
                throw new Error(`Failed to move file from "${fromPath}" to "${toPath}": ${error instanceof Error ? error.message : 'Unknown error'}`);
              }
            }
            case 'delete_file': {
              const relativePath = params['path'] as string;
              const filePath = `${rootPath}/${relativePath}`.replace(/\/+/g, '/');
              if (!filePath.startsWith(rootPath)) throw new Error('Access denied: path outside workspace');
              try {
                await workspaceServiceRef.current.delete(filePath);
                onFileTreeChange?.();
                onAuditLog?.({ action: 'file_delete', description: `AI deleted file: ${relativePath}`, model: chatModel ?? chatProvider, inputs: { path: relativePath }, outputs: { success: true, movedToTrash: true }, userDecision: 'auto', metadata: { tool: 'delete_file' } });
                return { path: relativePath, message: 'File deleted successfully (moved to trash)' };
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
        const assuredRoute = resolveAssuredRoute(chatProvider, chatModel || '');
        const assuredOpt = assuredRoute ? { assured: assuredRoute } : {};

        if (IS_DEMO) {
          // Demo build: route every chat through the demo provider, which
          // either uses a BYOK key (direct to Anthropic) or the shared
          // proxy at /api/demo-chat. Tools are not wired here because the
          // demo's seeded workspace is read-mostly and the proxy is text-only.
          provider = createDemoProvider({ ...(chatModel ? { model: chatModel } : {}) });
        } else {
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

        // Stream A1 — Read raw bytes for each attachment so providers can
        // build their provider-specific image content blocks. Attachments
        // are stored on disk; we read them now so the async I/O is done
        // before we hand off to the provider. Any attachment that fails to
        // read is skipped gracefully (logged but not fatal).
        let attachmentBytes: AttachmentBytes[] | undefined;
        if (messageAttachments && messageAttachments.length > 0 && workspaceServiceRef?.current) {
          const attService = new AttachmentService(workspaceServiceRef.current);
          const loaded: AttachmentBytes[] = [];
          for (const att of messageAttachments) {
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

        const hasWorkspace = workspaceServiceRef?.current && rootPath;
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
        const useStreaming = provider.sendMessageStreaming
          && !isTauriProductionBuild()
          && !hasWorkspace;
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
          let streamingResponse: Awaited<ReturnType<NonNullable<typeof provider.sendMessageStreaming>>> | null = null;

          try {
            streamingResponse = await provider.sendMessageStreaming!(userMessage.content, {
              systemPrompt,
              maxTokens: 4096,
              onChunk: (chunk: string) => {
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
              description: `Chat message to ${chatModel ?? chatProvider}`,
              model: chatModel ?? chatProvider,
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
              ? await verifyCitations(normalizedAnswer, retrievedSources, emitCitationVerified)
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
          const response = await provider.sendMessage(userMessage.content, {
            systemPrompt,
            maxTokens: 4096,
            signal: abortController.signal,
            ...(attachmentBytes ? { attachmentBytes } : {}),
          });

          // WS-B/C — verify the citations in the answer against the local
          // store BEFORE presenting them. Verified sources are marked safe;
          // any citation that doesn't verify flags its source in the UI.
          // F-503 — repair number-keyed local-model citations BEFORE
          // verification so the verify loop and chips see resolvable cites.
          const normalizedContent = normalizeNumericCitations(response.content, retrievedSources);
          const verifiedSources =
            retrievedSources.length > 0
              ? await verifyCitations(normalizedContent, retrievedSources, emitCitationVerified)
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

          // Q3 — record cost for the chip + Q4 audit entry.
          recordCost(chatId, {
            cost: response.cost,
            inputTokens: response.usage.inputTokens + imageTokenOverhead + pdfTokenOverhead,
            outputTokens: response.usage.outputTokens,
            provider: chatProvider,
          });
          onAuditLog?.({
            action: 'model_call',
            description: `Chat message to ${chatModel ?? chatProvider}`,
            model: chatModel ?? chatProvider,
            inputs: { promptLength: userMessage.content.length },
            outputs: { contentLength: response.content.length },
            userDecision: 'auto',
            metadata: { chatId, streamed: false },
            tokensIn: response.usage.inputTokens,
            tokensOut: response.usage.outputTokens,
            costUsd: response.cost,
            provider: chatProvider,
          });

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

        let errorContent: string;
        let errorDiagnostic: string | undefined;

        // WS-C honesty — a LOCAL (Ollama) chat that fails is almost always the
        // daemon not running / not reachable. Show a clear, friendly message
        // telling the user how to fix it. We NEVER silently retry on a cloud
        // provider here: a Local-only / Ollama selection that errors stays
        // local-and-failed, it does not leak to the cloud.
        if (isLocalProviderId(chatData.provider ?? 'anthropic')) {
          errorContent =
            "Ollama isn't running, so this local chat couldn't get a response. " +
            'Start Ollama (then try again), or switch your confidentiality mode ' +
            'in Settings → AI to use a cloud model. Your message was not sent ' +
            'anywhere — nothing left your machine.';
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
              (chatData.provider ?? 'anthropic') as 'anthropic' | 'openai' | 'google',
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
      }
    })();
  }, [inputValue, pendingAttachments, previewUrls, messages, chatData, onSave, isLoading, apiKeys, chatId, addMessage, updateLastMessage, updateMessages, setLoading, workspaceServiceRef, rootPath, onFileTreeChange, onAuditLog, aiRules, openFiles, scopedOpenFiles, scopedFolder, recordCost, clearDraftInput, askWorkspaceMode, activeMatter, includePrivileged]);

  return { handleSendMessage, handleManualCompress };
}
