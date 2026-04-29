// AI Chat Viewer Component
// Displays full chat history and allows continuing conversations

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { Send, Square, Download, Mic, MicOff, GripVertical, Sparkles, FileText, ChevronDown, ChevronRight, Check, X, Pencil, Brain } from 'lucide-react';
import { ChatInputToolbar } from '@/components/chat/ChatInputToolbar';
import { AttachmentService } from '@/modules/attachments/AttachmentService';
import { SUPPORTED_IMAGE_MIMES, MAX_ATTACHMENT_BYTES, isVisionModel } from '@/modules/models/vision-capability';
import { estimateImageTokens } from '@/modules/attachments/imageTokens';
import type { ChatAttachment } from '@/types/ai';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import type { AIChatFile, ChatMessage, WorkspaceSource } from '@/types/ai';
import type { AuditEntry } from '@/types/audit';
import type { Provider, AttachmentBytes } from '@/modules/models/Provider';
import { ClaudeProvider } from '@/modules/models/ClaudeProvider';
import { OpenAIProvider } from '@/modules/models/OpenAIProvider';
import { GeminiProvider } from '@/modules/models/GeminiProvider';
import { isTauriProductionBuild, parseApiError, ApiResponseParseError } from '@/modules/models/fetchUtils';
import { FILE_ACCESS_TOOLS } from '@/modules/tools/fileAccessTools';
import { useAIChatStore, getDraftInput, useAskWorkspaceMode } from '@/stores/aiChatStore';
import { useFileContextStore } from '@/stores/fileContextStore';
import type { ExtractedContext } from '@/utils/ai-file-context';
import { ChatCostChip } from '@/components/ai/ChatCostChip';
import { useTrialGate } from '@/hooks/useTrial';
import { MemoryService, isMemoryEnabled } from '@/modules/memory/MemoryService';
import {
  DEFAULT_WORKSPACE_TOP_K,
  buildWorkspaceContextBlock,
  citationBasename,
  parseCitations,
  parseWorkspaceCommand,
  resolveCitationPath,
} from '@/modules/memory/workspaceCommand';
import {
  buildFactsMemoryBlock,
} from '@/modules/memory/FactsService';
import {
  snapshotFactsForInjection,
  getFactsService,
  isFactsAutoAcceptEnabled,
} from '@/modules/memory/factsSingleton';
import {
  runExtraction,
  shouldRunExtraction,
  markCheckpointRan,
  markRejected,
  markAccepted,
  makeInitialState,
  type ChatExtractionState,
  type ProposedFact,
} from '@/modules/memory/factsExtraction';

interface APIKey {
  provider: string;
  key: string;
  isValid: boolean;
}

interface AIChatViewerProps {
  chatData: AIChatFile;
  onSave?: (updatedChat: AIChatFile) => void;
  onExport?: (chatData: AIChatFile) => void;
  apiKeys?: APIKey[];
  workspaceServiceRef?: React.MutableRefObject<any>;
  rootPath?: string; // Workspace root path for file access tools
  onFileTreeChange?: () => void; // Callback when AI modifies files
  onAuditLog?: (entry: Omit<AuditEntry, 'id' | 'timestamp'>) => void; // Callback to log AI actions
  /**
   * M2 — called when the user clicks a citation or a source in the
   * accordion. Resolves a workspace-relative path to a real file path
   * (stripping any parent folders the retriever returned) and opens it
   * in the editor. When provided, also opens the paragraph the citation
   * references (editor integration left to the caller; the callback
   * receives the paragraph index as an optional second arg).
   */
  onOpenFileAtPath?: (path: string, paragraphIndex?: number) => void | Promise<void>;
  className?: string;
}

/**
 * Build the "OPEN FILES" block that gets prepended to the chat system prompt.
 * Exposed as a named helper so Playwright tests (and future request logging)
 * can build the same string deterministically without mounting the viewer.
 *
 * Returns an empty string when no files are enabled; otherwise emits a
 * section formatted for Claude-style prompts with per-file `##` headings and
 * `---` separators between files.
 */
export function buildOpenFilesPromptBlock(openFiles: ExtractedContext[]): string {
  if (openFiles.length === 0) {
    return '';
  }
  const intro = `The user currently has these files open in their workspace. Reference them when relevant:`;
  const body = openFiles
    .map(
      (f) =>
        `## ${f.fileName}${f.truncated ? ' (truncated)' : ''}\n\n${f.extractedText}`
    )
    .join('\n\n---\n\n');
  return `\n\n${intro}\n\n${body}`;
}

/**
 * Render markdown-like formatting for messages
 */
function renderMessage(content: string): string {
  let html = content;

  // Escape HTML
  html = html
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Code blocks
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, _lang, code) => {
    return `<pre class="my-2 p-3 rounded bg-muted overflow-x-auto max-w-full"><code class="font-mono text-sm whitespace-pre-wrap break-all">${code.trim()}</code></pre>`;
  });

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code class="px-1.5 py-0.5 rounded bg-muted font-mono text-sm">$1</code>');

  // Bold
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

  // Italic
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');

  // Line breaks
  html = html.replace(/\n/g, '<br />');

  return html;
}

/**
 * M2 — Render the user's `@workspace` command as a visible chip. The
 * chip is non-interactive; it exists purely so the user can see that
 * retrieval fired. We render it as a React fragment (not an HTML string
 * dangerously-set into a div) so the markup stays accessible.
 */
function renderMessageWithWorkspaceChip(content: string): React.ReactNode {
  // Reuse the parser to locate every occurrence of the tag, then split
  // around them so we can replace with a styled span while keeping the
  // surrounding markdown rendered via `renderMessage`.
  const tagRe = /(^|[\s])@workspace(?=$|[\s\p{P}])/gu;
  const parts: Array<{ type: 'text' | 'chip'; content: string }> = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(content)) !== null) {
    const tagStart = m.index + (m[1]?.length ?? 0);
    const tagEnd = tagStart + '@workspace'.length;
    if (tagStart > last) {
      parts.push({ type: 'text', content: content.slice(last, tagStart) });
    }
    parts.push({ type: 'chip', content: '@workspace' });
    last = tagEnd;
  }
  if (last < content.length) {
    parts.push({ type: 'text', content: content.slice(last) });
  }
  if (parts.length === 0) {
    return (
      <span
        // eslint-disable-next-line react/no-danger -- markdown rendered by the pre-existing renderMessage helper
        dangerouslySetInnerHTML={{ __html: renderMessage(content) }}
      />
    );
  }
  return (
    <span>
      {parts.map((p, idx) =>
        p.type === 'chip' ? (
          <span
            key={`chip-${idx}`}
            data-testid="workspace-command-chip"
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium text-xs mx-0.5 align-baseline"
            title="Workspace retrieval will run for this message"
          >
            <Sparkles className="h-3 w-3" />
            @workspace
          </span>
        ) : (
          <span
            key={`text-${idx}`}
            // eslint-disable-next-line react/no-danger -- markdown rendered by the pre-existing renderMessage helper
            dangerouslySetInnerHTML={{ __html: renderMessage(p.content) }}
          />
        ),
      )}
    </span>
  );
}

/**
 * M2 — Render an assistant response with any `[filename paragraph N]`
 * citations turned into clickable chips that navigate to the file. The
 * surrounding text is still rendered with the same markdown helper as
 * before; only the citation substrings are replaced with React elements.
 */
function renderMessageWithCitations(
  content: string,
  sources: WorkspaceSource[] | undefined,
  onCitationClick: (path: string, paragraphIndex: number) => void,
  onMissingCitation: (basename: string) => void,
): React.ReactNode {
  const citations = parseCitations(content);
  if (citations.length === 0) {
    return (
      <span
        // eslint-disable-next-line react/no-danger -- markdown rendered by the pre-existing renderMessage helper
        dangerouslySetInnerHTML={{ __html: renderMessage(content) }}
      />
    );
  }
  const pieces: React.ReactNode[] = [];
  let last = 0;
  citations.forEach((cite, idx) => {
    if (cite.start > last) {
      const text = content.slice(last, cite.start);
      pieces.push(
        <span
          key={`c-pre-${idx}`}
          // eslint-disable-next-line react/no-danger -- markdown rendered by the pre-existing renderMessage helper
          dangerouslySetInnerHTML={{ __html: renderMessage(text) }}
        />,
      );
    }
    const resolved = resolveCitationPath(cite, sources ?? []);
    const label = `${cite.basename} §${cite.paragraphIndex}`;
    const testId = `chat-citation-${cite.basename}-${cite.paragraphIndex}`;
    pieces.push(
      <button
        key={`cite-${idx}`}
        type="button"
        data-testid={testId}
        className="inline-flex items-center gap-1 px-1.5 py-0.5 mx-0.5 rounded border border-primary/30 bg-primary/10 text-primary text-xs font-medium hover:bg-primary/20 align-baseline"
        onClick={() => {
          if (resolved) {
            onCitationClick(resolved, cite.paragraphIndex);
          } else {
            onMissingCitation(cite.basename);
          }
        }}
        title={resolved ? `Open ${resolved}` : 'Source file not found'}
      >
        <FileText className="h-3 w-3" />
        {label}
      </button>,
    );
    last = cite.end;
  });
  if (last < content.length) {
    const tail = content.slice(last);
    pieces.push(
      <span
        key="c-tail"
        // eslint-disable-next-line react/no-danger -- markdown rendered by the pre-existing renderMessage helper
        dangerouslySetInnerHTML={{ __html: renderMessage(tail) }}
      />,
    );
  }
  return <span>{pieces}</span>;
}

/**
 * M2 — Sources accordion shown below any assistant message whose user
 * turn was workspace-aware. Collapsed by default; expanding reveals a
 * list of clickable paths (basename + paragraph). Clicking a row opens
 * the file in the editor.
 */
function ChatSourcesAccordion({
  sources,
  onOpen,
  onMissing,
}: {
  sources: WorkspaceSource[];
  onOpen: (path: string, paragraphIndex: number) => void;
  onMissing: (path: string) => void;
}): React.ReactElement | null {
  const [open, setOpen] = useState(false);
  if (!sources || sources.length === 0) return null;
  return (
    <div
      data-testid="chat-sources-accordion"
      className="mt-2 w-full max-w-[85%]"
    >
      <button
        type="button"
        data-testid="chat-sources-toggle"
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {open ? (
          <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronRight className="h-3 w-3" />
        )}
        {sources.length} source{sources.length === 1 ? '' : 's'}
      </button>
      {open && (
        <ul className="mt-1 ml-4 space-y-1 border-l pl-2 border-muted">
          {sources.map((s, idx) => {
            const base = citationBasename(s.path);
            const testId = `chat-citation-${base}-${s.paragraphIndex}`;
            return (
              <li key={`${s.path}-${s.paragraphIndex}-${idx}`}>
                <button
                  type="button"
                  data-testid={testId}
                  className="text-xs text-muted-foreground hover:text-foreground underline truncate max-w-full text-left"
                  title={s.path}
                  onClick={() => {
                    if (s.path) onOpen(s.path, s.paragraphIndex);
                    else onMissing(base);
                  }}
                >
                  {base} §{s.paragraphIndex}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * M3 — Proposed facts chip row. Rendered below the most recent AI
 * response whenever fact extraction returned candidates. Each chip has
 * Accept / Edit / Reject buttons; editing swaps the chip text for an
 * inline textarea with Save + Cancel.
 */
interface ProposedFactsPanelProps {
  proposals: Array<{ key: string; text: string }>;
  onAccept: (key: string, editedText?: string) => void | Promise<void>;
  onReject: (key: string) => void;
}

function ProposedFactsPanel({
  proposals,
  onAccept,
  onReject,
}: ProposedFactsPanelProps): React.ReactElement {
  const [expanded, setExpanded] = useState(true);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editText, setEditText] = useState('');

  const startEdit = (key: string, currentText: string) => {
    setEditingKey(key);
    setEditText(currentText);
  };
  const cancelEdit = () => {
    setEditingKey(null);
    setEditText('');
  };
  const saveEdit = async (key: string) => {
    await onAccept(key, editText);
    setEditingKey(null);
    setEditText('');
  };

  return (
    <div
      data-testid="proposed-facts-panel"
      className="mt-4 rounded-md border border-primary/30 bg-primary/5 p-3"
    >
      <button
        type="button"
        data-testid="proposed-facts-toggle"
        className="w-full flex items-center gap-2 text-xs font-medium text-primary"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronRight className="h-3 w-3" />
        )}
        <Brain className="h-3.5 w-3.5" />
        {proposals.length} proposed memory fact
        {proposals.length === 1 ? '' : 's'}
      </button>
      {expanded && (
        <ul className="mt-2 space-y-2">
          {proposals.map((p) => (
            <li
              key={p.key}
              data-testid={`proposed-fact-chip-${p.key}`}
              className="flex items-start gap-2 rounded border border-primary/20 bg-background px-3 py-2"
            >
              {editingKey === p.key ? (
                <>
                  <Textarea
                    data-testid={`fact-edit-input-${p.key}`}
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    className="flex-1 min-h-[48px] text-sm"
                  />
                  <div className="flex flex-col gap-1 shrink-0">
                    <Button
                      data-testid={`fact-edit-save-${p.key}`}
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-xs"
                      onClick={() => {
                        void saveEdit(p.key);
                      }}
                      disabled={editText.trim().length === 0}
                    >
                      Save
                    </Button>
                    <Button
                      data-testid={`fact-edit-cancel-${p.key}`}
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs"
                      onClick={cancelEdit}
                    >
                      Cancel
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <span className="flex-1 text-sm leading-relaxed">{p.text}</span>
                  <div className="flex gap-1 shrink-0">
                    <Button
                      data-testid={`fact-accept-${p.key}`}
                      variant="outline"
                      size="sm"
                      className="h-7 w-7 p-0 text-green-700 hover:bg-green-50 dark:text-green-400 dark:hover:bg-green-950/30"
                      onClick={() => {
                        void onAccept(p.key);
                      }}
                      aria-label="Accept fact"
                      title="Accept — save this fact to memory"
                    >
                      <Check className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      data-testid={`fact-edit-${p.key}`}
                      variant="outline"
                      size="sm"
                      className="h-7 w-7 p-0"
                      onClick={() => startEdit(p.key, p.text)}
                      aria-label="Edit fact"
                      title="Edit before saving"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      data-testid={`fact-reject-${p.key}`}
                      variant="outline"
                      size="sm"
                      className="h-7 w-7 p-0 text-destructive hover:bg-destructive/10"
                      onClick={() => onReject(p.key)}
                      aria-label="Reject fact"
                      title="Reject — discard this proposal"
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Convert chat to markdown for export
 */
function chatToMarkdown(chat: AIChatFile): string {
  let markdown = `# ${chat.title}\n\n`;
  markdown += `**Created:** ${new Date(chat.created).toLocaleString()}\n`;
  markdown += `**Updated:** ${new Date(chat.updated).toLocaleString()}\n\n`;
  markdown += `---\n\n`;

  for (const msg of chat.messages) {
    const timestamp = new Date(msg.timestamp).toLocaleString();
    const role = msg.role === 'user' ? 'You' : 'Assistant';
    markdown += `## ${role} (${timestamp})\n\n`;
    markdown += `${msg.content}\n\n`;
    markdown += `---\n\n`;
  }

  return markdown;
}

export function AIChatViewer({ chatData, onSave, onExport, apiKeys = [], workspaceServiceRef, rootPath, onFileTreeChange, onAuditLog, onOpenFileAtPath, className }: AIChatViewerProps) {
  // 30-day trial gate. Locks chat send + voice when expired and not paid.
  const trialGate = useTrialGate();
  // Use global store for chat state (persists across navigation)
  const { sessions, initSession, addMessage, updateLastMessage, setLoading, setDraftInput, clearDraftInput, recordCost, setAskWorkspaceMode } = useAIChatStore();
  const chatId = chatData.id;
  const session = sessions[chatId];
  const askWorkspaceMode = useAskWorkspaceMode(chatId);
  // M2 — surfaced inline beneath the input when a citation can't be
  // resolved. Cleared whenever the user interacts with the input again.
  const [missingSourceWarning, setMissingSourceWarning] = useState<string | null>(null);
  // M3 — proposed facts awaiting user approval. Keyed by chat so a
  // batch from one chat doesn't bleed into another if the user switches.
  type PendingProposal = ProposedFact & { key: string };
  const [proposedFacts, setProposedFacts] = useState<PendingProposal[]>([]);
  const extractionStateRef = useRef<ChatExtractionState>(makeInitialState());
  const extractionInFlightRef = useRef<boolean>(false);

  // Ambient file context from the editor — any open, enabled file that was
  // successfully extracted. Re-renders the viewer when files change so the
  // next message picks up the freshest snapshot automatically.
  //
  // NOTE: select the raw bags of state (not the computed `getActiveContexts`
  // result) so the zustand snapshot is stable. Computing a new array on
  // every selector call caused a React 18 "getSnapshot should be cached"
  // infinite-loop warning when rendered alongside tab-change-driven
  // context updates.
  const contexts = useFileContextStore((s) => s.contexts);
  const disabledPaths = useFileContextStore((s) => s.disabledPaths);
  const openFiles = useMemo<ExtractedContext[]>(() => {
    const out: ExtractedContext[] = [];
    for (const [path, ctx] of Object.entries(contexts)) {
      if (!disabledPaths[path]) out.push(ctx);
    }
    return out;
  }, [contexts, disabledPaths]);

  // Initialize input with saved draft (persists across navigation)
  const [inputValue, setInputValue] = useState(() => getDraftInput(chatId));
  const [isRecording, setIsRecording] = useState(false);
  const [aiRules, setAiRules] = useState<string>('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Stream A1 — Pending attachments state.
  const [pendingAttachments, setPendingAttachments] = useState<ChatAttachment[]>([]);
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({});
  // Stream A1 — Inline error messages (oversized file, etc.)
  const [attachmentError, setAttachmentError] = useState<string | null>(null);

  // Initialize session on mount if it doesn't exist
  useEffect(() => {
    if (!session) {
      initSession(chatId, chatData.messages);
    }
  }, [chatId, session, initSession, chatData.messages]);

  // Test-mode hook: expose a synchronous prompt-builder so Playwright specs
  // can assert on the system prompt without instrumenting every provider's
  // network call. Only mounted when `?testMode=true` is in the URL.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!window.location.search.includes('testMode=true')) return;
    (window as unknown as {
      __buildSystemPromptForTest?: (baseRole?: string) => string;
    }).__buildSystemPromptForTest = (baseRole = 'You are a helpful AI assistant.') => {
      const files = useFileContextStore.getState().getActiveContexts();
      return `${baseRole}${buildOpenFilesPromptBlock(files)}`;
    };
  }, []);

  // Load AI Rules from workspace.
  //
  // DEPS DISCIPLINE: `workspaceServiceRef` must NOT be in this array.
  // Refs are stable by object identity but their `.current` mutates
  // without signaling React; including a ref in deps trips effect
  // re-runs on ref-pointer changes that look like deps changes to the
  // tracker, producing a setState -> render -> setState loop (React
  // #185). See tests/unit/ai-rules-loading.test.tsx for the regression
  // guard.
  useEffect(() => {
    let isMounted = true;

    const loadAIRules = async () => {
      if (!rootPath || !workspaceServiceRef?.current) return;

      try {
        const rulesPath = `${rootPath}/ai-rules.md`;
        const exists = await workspaceServiceRef.current.exists(rulesPath);

        if (!isMounted) return;
        if (exists) {
          const content = await workspaceServiceRef.current.readFile(rulesPath);
          if (isMounted) setAiRules(content);
        } else {
          setAiRules('');
        }
      } catch (error) {
        console.error('Failed to load AI rules:', error);
        if (isMounted) setAiRules('');
      }
    };

    loadAIRules();

    return () => {
      isMounted = false;
    };
  }, [rootPath]);

  // Get messages and loading state from store
  const messages = session?.messages ?? chatData.messages;
  const isLoading = session?.isLoading ?? false;

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // M3 — after each completed turn, check whether extraction should
  // run. Only fires when we're not loading (so the turn is complete),
  // when `shouldRunExtraction` says yes, and when an extraction isn't
  // already in flight. All failure paths silently skip; the next
  // checkpoint is recorded regardless so we don't re-hit the API on
  // every render when the provider is throwing.
  useEffect(() => {
    if (isLoading) return;
    if (extractionInFlightRef.current) return;
    const count = messages.length;
    if (!shouldRunExtraction(count, extractionStateRef.current)) return;

    const chatProvider = chatData.provider ?? 'anthropic';
    const apiKey = apiKeys.find((k) => k.provider === chatProvider && k.isValid);
    if (!apiKey) {
      // No key — silently advance the checkpoint so we don't spin on
      // every render. Next checkpoint will try again when there's a key.
      extractionStateRef.current = markCheckpointRan(
        extractionStateRef.current,
        count,
      );
      return;
    }

    extractionInFlightRef.current = true;
    (async () => {
      try {
        let provider: Provider;
        switch (chatProvider) {
          case 'openai':
            provider = new OpenAIProvider({
              apiKey: apiKey.key,
              ...(chatData.model ? { model: chatData.model } : {}),
            });
            break;
          case 'google':
            provider = new GeminiProvider({
              apiKey: apiKey.key,
              ...(chatData.model ? { model: chatData.model } : {}),
            });
            break;
          case 'anthropic':
          default:
            provider = new ClaudeProvider({
              apiKey: apiKey.key,
              ...(chatData.model ? { model: chatData.model } : {}),
            });
            break;
        }
        const proposals = await runExtraction(provider, messages);
        extractionStateRef.current = markCheckpointRan(
          extractionStateRef.current,
          count,
        );
        if (proposals.length === 0) return;

        // M3 — auto-accept path skips the chip and saves directly.
        if (isFactsAutoAcceptEnabled()) {
          const svc = getFactsService();
          if (svc) {
            for (const p of proposals) {
              try {
                await svc.addFact({
                  text: p.text,
                  approved_by: 'auto',
                  source_chat_id: chatId,
                  source_message_index: count - 1,
                });
              } catch {
                // Best-effort — if one save fails, keep trying the others.
              }
            }
          }
          return;
        }

        // Otherwise surface chips for user approval.
        const keyed = proposals.map((p, i) => ({
          ...p,
          key: `${count}-${i}-${Date.now()}`,
        }));
        setProposedFacts((prev) => [...prev, ...keyed]);
      } catch {
        extractionStateRef.current = markCheckpointRan(
          extractionStateRef.current,
          count,
        );
      } finally {
        extractionInFlightRef.current = false;
      }
    })();
  }, [messages, isLoading, apiKeys, chatData.provider, chatData.model, chatId]);

  // Clear proposed facts + reset extraction state when the chat switches.
  useEffect(() => {
    setProposedFacts([]);
    extractionStateRef.current = makeInitialState();
  }, [chatId]);

  // Stream A1 — Revoke preview URLs when component unmounts.
  useEffect(() => {
    return () => {
      for (const url of Object.values(previewUrls)) {
        URL.revokeObjectURL(url);
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Stream A1 — Vision warning: computed when there is at least one image
  // attachment pending and the current model is not vision-capable.
  const visionWarning = useMemo<string | null>(() => {
    const hasImageAtt = pendingAttachments.some((a) => a.type === 'image');
    if (!hasImageAtt) return null;
    const chatProvider = chatData.provider ?? 'anthropic';
    const chatModel = chatData.model ?? '';
    if (!chatModel) return null;
    if (isVisionModel(chatProvider, chatModel)) return null;
    return `${chatModel} does not support images. Switch to a vision-capable model.`;
  }, [pendingAttachments, chatData.provider, chatData.model]);

  // Save draft input to store (debounced) - persists across navigation
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      if (inputValue.trim()) {
        setDraftInput(chatId, inputValue);
      } else {
        clearDraftInput(chatId);
      }
    }, 300); // 300ms debounce

    return () => clearTimeout(timeoutId);
  }, [inputValue, chatId, setDraftInput, clearDraftInput]);

  const handleSendMessage = useCallback(async () => {
    if ((!inputValue.trim() && pendingAttachments.length === 0) || isLoading) return;

    const rawContent = inputValue.trim();
    const parsed = parseWorkspaceCommand(rawContent);
    // M2 — retrieval triggers when the user explicitly tagged
    // `@workspace`, or when the Ask-my-workspace mode is on for this
    // chat. We call MemoryService (not raw ragRetrieve) so the Settings
    // toggle is respected with a clean `[]` short-circuit when off.
    const shouldRetrieve = parsed.hasCommand || askWorkspaceMode;
    let retrievedSources: WorkspaceSource[] = [];
    let workspaceHint: string | undefined;
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
          const hits = await MemoryService.retrieve(
            retrievalQuery,
            DEFAULT_WORKSPACE_TOP_K,
          );
          retrievedSources = hits.map((h) => ({
            path: h.path,
            chunkText: h.chunkText,
            score: h.score,
            paragraphIndex: h.paragraphIndex,
          }));
        } catch (err) {
          console.error('Workspace retrieval failed:', err);
          workspaceHint =
            "Workspace retrieval failed; this message wasn't workspace-aware.";
        }
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

    // Clear pending attachments and revoke preview URLs.
    setPendingAttachments([]);
    for (const url of Object.values(previewUrls)) {
      URL.revokeObjectURL(url);
    }
    setPreviewUrls({});

    const userMessage: ChatMessage = {
      role: 'user',
      content: rawContent,
      timestamp: new Date().toISOString(),
      ...(messageAttachments ? { attachments: messageAttachments } : {}),
      ...(retrievedSources.length > 0 ? { sources: retrievedSources } : {}),
      ...(workspaceHint ? { workspaceHint } : {}),
    };

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

        // Find valid API key for the chat's provider
        const apiKey = apiKeys.find(k => k.provider === chatProvider && k.isValid);

        if (!apiKey) {
          const providerNames: Record<string, string> = { anthropic: 'Anthropic', openai: 'OpenAI', google: 'Google' };
          throw new Error(`No valid ${providerNames[chatProvider] ?? chatProvider} API key found. Please add your API key in the settings.`);
        }

        // Stream A1 — estimate image token overhead for cost meter.
        const imageTokenOverhead = (messageAttachments ?? []).reduce(
          (sum, att) => sum + estimateImageTokens(chatProvider, att),
          0
        );

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

        switch (chatProvider) {
          case 'openai': {
            const openai = new OpenAIProvider({
              apiKey: apiKey.key,
              ...(chatModel ? { model: chatModel } : {}),
              ...rulesOpt,
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
              apiKey: apiKey.key,
              ...(chatModel ? { model: chatModel } : {}),
              ...rulesOpt,
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
          case 'anthropic':
          default: {
            const claude = new ClaudeProvider({
              apiKey: apiKey.key,
              ...(chatModel ? { model: chatModel } : {}),
              ...rulesOpt,
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
          ? `You are running inside Projelli, a local-first workspace app. The user's active workspace folder is "${rootPath}". You have direct access to this workspace via tools: read_file, write_file, create_folder, move_file, delete_file, list_files, search_files. When the user asks you to create, edit, organize, or look at files, USE THESE TOOLS directly — do not refuse, do not ask the user to create the file themselves, and do not pretend you can't access files. You CAN. All file paths should be relative to the workspace root. When creating .md files (documentation, notes, plans, etc.), just write them directly using write_file. After creating or modifying files, briefly confirm what you did.\n\n`
          : '';

        const baseRole = hasWorkspace
          ? `${workspaceInstructions}You are a helpful AI assistant with full read/write access to the user's workspace.`
          : 'You are a helpful AI assistant.';

        // Append any enabled open-file contexts BEFORE the conversation
        // history. This lets the AI treat the files as background material
        // that applies to every turn rather than a stale one-shot attachment.
        const fileBlock = buildOpenFilesPromptBlock(openFiles);

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
              inputTokens: streamingResponse.usage.inputTokens + imageTokenOverhead,
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

          const finalMessages = [...updatedMessages, { ...streamingMessage, content: accumulated }];

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

          const assistantMessage: ChatMessage = {
            role: 'assistant',
            content: response.content,
            timestamp: new Date().toISOString(),
            // M2 — attach retrieval sources so the accordion + citation
            // chips rendered below the bubble have data to resolve.
            ...(retrievedSources.length > 0
              ? { sources: retrievedSources }
              : {}),
          };

          addMessage(chatId, assistantMessage);

          // Q3 — record cost for the chip + Q4 audit entry.
          recordCost(chatId, {
            cost: response.cost,
            inputTokens: response.usage.inputTokens + imageTokenOverhead,
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

          const finalMessages = [...updatedMessages, assistantMessage];

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

        if (error instanceof ApiResponseParseError) {
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
  }, [inputValue, pendingAttachments, previewUrls, messages, chatData, onSave, isLoading, apiKeys, chatId, addMessage, updateLastMessage, setLoading, workspaceServiceRef, rootPath, onFileTreeChange, onAuditLog, aiRules, openFiles, recordCost, clearDraftInput, askWorkspaceMode]);

  // Stream A1 — File selection handler (paperclip, paste, drag-drop).
  const handleFilesSelected = useCallback(async (files: File[]) => {
    for (const file of files) {
      if (file.size > MAX_ATTACHMENT_BYTES) {
        setAttachmentError(`${file.name} exceeds the 20 MB limit.`);
        setTimeout(() => setAttachmentError(null), 4000);
        continue;
      }
      if (!SUPPORTED_IMAGE_MIMES.includes(file.type)) {
        setAttachmentError(`${file.name} is not a supported image type.`);
        setTimeout(() => setAttachmentError(null), 4000);
        continue;
      }
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const attService = new AttachmentService(workspaceServiceRef?.current);
        const att = await attService.save(bytes, file.name, file.type);
        const previewUrl = URL.createObjectURL(file);
        setPendingAttachments((prev) => [...prev, att]);
        setPreviewUrls((prev) => ({ ...prev, [att.id]: previewUrl }));
        onAuditLog?.({
          action: 'user_action',
          description: `Attachment added: ${file.name}`,
          model: chatData.model ?? chatData.provider ?? 'unknown',
          inputs: { path: att.pathInWorkspace, hash: att.id, type: att.type, byteSize: att.byteSize },
          outputs: {},
          userDecision: 'auto',
          metadata: { auditEventType: 'attachment_added' },
        });
      } catch (err) {
        console.error('Failed to save attachment:', err);
        setAttachmentError(`${file.name} could not be saved.`);
        setTimeout(() => setAttachmentError(null), 4000);
      }
    }
  }, [workspaceServiceRef, onAuditLog, chatData.model, chatData.provider]);

  // Stream A1 — Remove a pending attachment.
  const handleRemoveAttachment = useCallback((id: string) => {
    setPendingAttachments((prev) => {
      const removed = prev.find((a) => a.id === id);
      if (removed) {
        onAuditLog?.({
          action: 'user_action',
          description: `Attachment removed: ${removed.fileName}`,
          model: chatData.model ?? chatData.provider ?? 'unknown',
          inputs: { hash: removed.id, type: removed.type },
          outputs: {},
          userDecision: 'auto',
          metadata: { auditEventType: 'attachment_removed' },
        });
      }
      return prev.filter((a) => a.id !== id);
    });
    setPreviewUrls((prev) => {
      if (prev[id]) URL.revokeObjectURL(prev[id]);
      const { [id]: _removed, ...rest } = prev;
      return rest;
    });
  }, [onAuditLog, chatData.model, chatData.provider]);

  // Stream A1 — Switch model (e.g. from vision warning banner).
  const handleSwitchModel = useCallback((model: string) => {
    if (onSave) {
      onSave({ ...chatData, model, updated: new Date().toISOString() });
    }
  }, [onSave, chatData]);

  const handleStop = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  }, [handleSendMessage]);

  // Voice recording handlers
  const startVoiceRecording = useCallback(() => {
    // Check if browser supports speech recognition
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      alert('Speech recognition is not supported in your browser. Please use Chrome, Edge, or Safari.');
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      recognition.onstart = () => {
        setIsRecording(true);
      };

      recognition.onresult = (event: any) => {
        let interimTranscript = '';
        let finalTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            finalTranscript += transcript + ' ';
          } else {
            interimTranscript += transcript;
          }
        }

        if (finalTranscript) {
          setInputValue(prev => prev + finalTranscript);
        }
      };

      recognition.onerror = (event: any) => {
        console.error('Speech recognition error:', event.error);
        setIsRecording(false);
      };

      recognition.onend = () => {
        setIsRecording(false);
      };

      recognition.start();
      recognitionRef.current = recognition;
    } catch (error) {
      console.error('Failed to start voice recording:', error);
      alert('Failed to start voice recording. Please check your microphone permissions.');
    }
  }, []);

  const stopVoiceRecording = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
      setIsRecording(false);
    }
  }, []);

  const toggleVoiceRecording = useCallback(() => {
    if (isRecording) {
      stopVoiceRecording();
    } else {
      startVoiceRecording();
    }
  }, [isRecording, startVoiceRecording, stopVoiceRecording]);

  const handleExport = useCallback(() => {
    if (onExport) {
      onExport(chatData);
    } else {
      // Default export: download as markdown
      const markdown = chatToMarkdown({ ...chatData, messages });
      const blob = new Blob([markdown], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${chatData.title}.md`;
      a.click();
      URL.revokeObjectURL(url);
    }
  }, [chatData, messages, onExport]);

  // M2 — citation click handler. Invoked from both inline citation
  // chips and the Sources accordion. Calls the caller-provided
  // `onOpenFileAtPath` (wired up in App.tsx / MainPanel). If the
  // callback is missing (e.g. in a unit-test mount), no-op.
  const handleCitationClick = useCallback(
    (path: string, paragraphIndex: number) => {
      setMissingSourceWarning(null);
      if (onOpenFileAtPath) {
        void onOpenFileAtPath(path, paragraphIndex);
      }
    },
    [onOpenFileAtPath],
  );

  const handleMissingSource = useCallback((basename: string) => {
    setMissingSourceWarning(
      `Source file not found: ${basename}. Retrieval may be stale. Re-indexing...`,
    );
  }, []);

  // M2 — Ask-my-workspace toggle handler.
  const handleToggleAskWorkspace = useCallback(() => {
    setAskWorkspaceMode(chatId, !askWorkspaceMode);
  }, [askWorkspaceMode, chatId, setAskWorkspaceMode]);

  // M3 — Accept a proposed fact. Saves to FactsService with
  // approved_by='user' and removes the chip. `editedText` overrides
  // the proposal text for the "user tweaked it" path.
  const handleAcceptProposedFact = useCallback(
    async (key: string, editedText?: string) => {
      const entry = proposedFacts.find((p) => p.key === key);
      if (!entry) return;
      const svc = getFactsService();
      const text = (editedText ?? entry.text).trim();
      if (!svc || text.length === 0) {
        setProposedFacts((prev) => prev.filter((p) => p.key !== key));
        return;
      }
      try {
        await svc.addFact({
          text,
          approved_by: 'user',
          source_chat_id: chatId,
          source_message_index: messages.length - 1,
        });
        extractionStateRef.current = markAccepted(extractionStateRef.current);
      } catch {
        // Save failed — keep the chip so the user can retry. In practice
        // this only happens when the workspace is offline, and the
        // singleton storage bubbles the error up. No toast in v1.5.
      } finally {
        setProposedFacts((prev) => prev.filter((p) => p.key !== key));
      }
    },
    [proposedFacts, chatId, messages.length],
  );

  const handleRejectProposedFact = useCallback(
    (key: string) => {
      extractionStateRef.current = markRejected(extractionStateRef.current);
      setProposedFacts((prev) => prev.filter((p) => p.key !== key));
    },
    [],
  );

  return (
    <div data-testid="ai-chat-viewer" className={cn('flex flex-col h-full', className)}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <div>
          <div className="flex items-baseline gap-2 flex-wrap">
            <h2 data-testid="chat-title" className="text-lg font-semibold">{chatData.title}</h2>
            {chatData.model && (
              <span
                data-testid="chat-header-model"
                className="text-xs text-muted-foreground font-normal"
                title={`Provider: ${chatData.provider ?? 'unknown'}`}
              >
                {chatData.model}
              </span>
            )}
          </div>
          <p data-testid="chat-created-date" className="text-xs text-muted-foreground">
            Created {new Date(chatData.created).toLocaleDateString()}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* M2 — Ask my workspace toggle. When ON, every message in
              this chat retrieves workspace context before calling the
              model. Persisted per-chat in aiChatStore so flipping it
              once sticks across navigation. */}
          <Button
            data-testid="ask-workspace-toggle"
            data-enabled={askWorkspaceMode ? 'true' : 'false'}
            variant={askWorkspaceMode ? 'default' : 'outline'}
            size="sm"
            onClick={handleToggleAskWorkspace}
            className={cn(
              'gap-2',
              askWorkspaceMode && 'bg-primary text-primary-foreground',
            )}
            aria-pressed={askWorkspaceMode}
            title={
              askWorkspaceMode
                ? 'Ask my workspace is ON — every message searches your files first'
                : 'Ask my workspace is OFF — click to have every message search your files'
            }
          >
            <Sparkles className="h-4 w-4" />
            Ask my workspace
          </Button>
          <Button
            data-testid="chat-export-button"
            variant="outline"
            size="sm"
            onClick={handleExport}
            className="gap-2"
          >
            <Download className="h-4 w-4" />
            Export
          </Button>
        </div>
      </div>

      {/* Messages */}
      <div data-testid="chat-messages" className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg, idx) => (
          <div
            key={idx}
            data-testid={`chat-message-${idx}`}
            data-role={msg.role}
            className={cn(
              'flex flex-col gap-1',
              msg.role === 'user' ? 'items-end' : 'items-start'
            )}
          >
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground">
                {msg.role === 'user' ? 'You' : 'Assistant'}
              </span>
              <span className="text-xs text-muted-foreground">
                {new Date(msg.timestamp).toLocaleTimeString()}
              </span>
            </div>
            <div className="flex items-start gap-1 max-w-[85%] min-w-0">
              {/* UX-28: assistant messages carry a drag handle so the content can
                  be dropped onto the file tree to create a new file. The
                  handle, not the whole bubble, is draggable so text selection
                  inside the bubble keeps working. Errored assistant messages
                  skip the handle to avoid offering a non-useful drag source. */}
              {msg.role === 'assistant' && !msg.isError && msg.content.trim().length > 0 && (
                <button
                  type="button"
                  data-testid={`ai-message-drag-handle-${idx}`}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = 'copy';
                    e.dataTransfer.setData('application/x-projelli-chat-message', msg.content);
                    e.dataTransfer.setData('text/plain', msg.content);
                  }}
                  title="Drag to file tree to save as a file"
                  aria-label="Drag to file tree to save as a file"
                  className="mt-2 shrink-0 cursor-grab active:cursor-grabbing p-1 rounded hover:bg-muted/60 text-muted-foreground/50 hover:text-muted-foreground"
                >
                  <GripVertical className="h-3.5 w-3.5" />
                </button>
              )}
              <div
                className={cn(
                  'min-w-0 rounded-lg px-4 py-2 break-words overflow-wrap-anywhere',
                  msg.role === 'user'
                    ? 'bg-primary text-primary-foreground'
                    : msg.isError
                      ? 'bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-red-900 dark:text-red-200'
                      : 'bg-muted'
                )}
              >
                {msg.role === 'user'
                  ? renderMessageWithWorkspaceChip(msg.content)
                  : renderMessageWithCitations(
                      msg.content,
                      msg.sources,
                      handleCitationClick,
                      handleMissingSource,
                    )}
              </div>
            </div>
            {/* M2 — grey hint below the bubble when retrieval couldn't
                run (memory off, retrieval failed, etc.). */}
            {msg.workspaceHint && (
              <p
                data-testid={`chat-message-${idx}-hint`}
                className="text-xs text-muted-foreground italic mt-1"
              >
                {msg.workspaceHint}
              </p>
            )}
            {/* M2 — Sources accordion, only on assistant messages that
                had workspace retrieval. */}
            {msg.role === 'assistant' && msg.sources && msg.sources.length > 0 && (
              <ChatSourcesAccordion
                sources={msg.sources}
                onOpen={handleCitationClick}
                onMissing={handleMissingSource}
              />
            )}
            {msg.isError && idx === messages.length - 1 && (
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <button
                  className="text-xs text-muted-foreground hover:text-foreground underline"
                  onClick={() => {
                    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
                    if (lastUserMsg) {
                      setInputValue(lastUserMsg.content);
                      // Trigger send on the next tick so state is committed first
                      setTimeout(() => handleSendMessage(), 0);
                    }
                  }}
                >
                  ↻ Retry last message
                </button>
                {msg.errorDiagnostic && (
                  <button
                    className="text-xs text-muted-foreground hover:text-foreground underline"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(msg.errorDiagnostic ?? '');
                        // Brief visual feedback by changing the button text
                        const target = document.activeElement as HTMLButtonElement | null;
                        if (target) {
                          const original = target.textContent;
                          target.textContent = '✓ Copied to clipboard';
                          setTimeout(() => { target.textContent = original; }, 2000);
                        }
                      } catch (err) {
                        console.error('Clipboard copy failed:', err);
                        alert('Could not copy. The diagnostic was logged to the developer console (Ctrl+Shift+I).');
                      }
                    }}
                  >
                    📋 Copy diagnostic info
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
        {isLoading && (
          <div data-testid="chat-loading-indicator" className="flex items-center gap-2">
            <div className="bg-muted rounded-lg px-4 py-2">
              <div className="flex gap-1">
                <span className="animate-bounce">●</span>
                <span className="animate-bounce delay-100">●</span>
                <span className="animate-bounce delay-200">●</span>
              </div>
            </div>
            <Button
              data-testid="chat-stop-button"
              variant="outline"
              size="sm"
              onClick={handleStop}
              className="h-7 gap-1 text-xs"
            >
              <Square className="h-3 w-3" />
              Stop
            </Button>
          </div>
        )}
        {proposedFacts.length > 0 && (
          <ProposedFactsPanel
            proposals={proposedFacts}
            onAccept={handleAcceptProposedFact}
            onReject={handleRejectProposedFact}
          />
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div data-testid="chat-input-area" className="border-t p-4">
        {/* Trial-expired banner. Sits above the input so the user knows
             *why* the send button is disabled. */}
        {trialGate.isLocked && (
          <div
            data-testid="chat-trial-expired-banner"
            className="mb-3 px-3 py-2 rounded border border-amber-400/50 bg-amber-50 dark:bg-amber-900/20 text-amber-900 dark:text-amber-200 text-xs"
          >
            <strong>Your {trialGate.trialDays}-day trial has ended.</strong>{' '}
            Activate a license in Settings → License to keep chatting with AI.
            Your existing files stay accessible — only AI calls and workflows
            are paused.
          </div>
        )}
        {/* M2 — inline toast for missing source files. Rendered as a
             dismissable strip above the input so the user can keep
             typing while the warning is visible. */}
        {missingSourceWarning && (
          <div
            data-testid="chat-missing-source-warning"
            className="mb-2 px-3 py-2 rounded border border-amber-400/50 bg-amber-50 dark:bg-amber-900/20 text-amber-900 dark:text-amber-200 text-xs"
          >
            {missingSourceWarning}
            <button
              type="button"
              className="ml-2 underline hover:no-underline"
              onClick={() => setMissingSourceWarning(null)}
            >
              Dismiss
            </button>
          </div>
        )}
        {/* Q3 — real-time cost chip, anchored bottom-right of the chat pane
             just above the input. Hover reveals today's provider breakdown. */}
        <div className="flex justify-end mb-2">
          <ChatCostChip chatId={chatId} />
        </div>
        {/* Stream A1 — attachment error strip */}
        {attachmentError && (
          <div className="mb-2 px-3 py-2 rounded border border-red-400/50 bg-red-50 dark:bg-red-900/20 text-red-900 dark:text-red-200 text-xs">
            {attachmentError}
          </div>
        )}
        {/* Stream A1 — ChatInputToolbar: paperclip, paste, drop, tiles, vision warning */}
        <ChatInputToolbar
          provider={chatData.provider ?? 'anthropic'}
          model={chatData.model ?? ''}
          pendingAttachments={pendingAttachments}
          previewUrls={previewUrls}
          onFilesSelected={handleFilesSelected}
          onRemoveAttachment={handleRemoveAttachment}
          onSwitchModel={handleSwitchModel}
          visionWarning={visionWarning}
          sendDisabled={visionWarning !== null || isLoading || trialGate.isLocked}
          className="mb-2"
        />
        <div className="flex gap-2">
          <Textarea
            data-testid="chat-input"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              trialGate.isLocked
                ? 'Trial ended — activate a license to chat'
                : 'Type your message... (Enter to send, Shift+Enter for new line)'
            }
            className="min-h-[60px] max-h-[200px] resize-none"
            disabled={isLoading || trialGate.isLocked}
          />
          <div className="flex flex-col gap-2 shrink-0">
            <Button
              data-testid="chat-voice-button"
              onClick={toggleVoiceRecording}
              disabled={isLoading || trialGate.isLocked}
              size="icon"
              variant={isRecording ? 'destructive' : 'outline'}
              className={`h-[60px] w-[60px] ${isRecording ? 'animate-pulse' : ''}`}
              title={isRecording ? 'Stop recording' : 'Start voice input'}
            >
              {isRecording ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
            </Button>
          </div>
          <Button
            data-testid="chat-send-button"
            onClick={handleSendMessage}
            disabled={(!inputValue.trim() && pendingAttachments.length === 0) || isLoading || trialGate.isLocked || visionWarning !== null}
            size="icon"
            className="h-[60px] w-[60px] shrink-0"
          >
            <Send className="h-5 w-5" />
          </Button>
        </div>
      </div>
    </div>
  );
}

export default AIChatViewer;
