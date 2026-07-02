// MessageBubble — a single chat message card (the normal bubble; the
// compressed-summary marker + the `.map` loop stay in AIChatViewer). Extracted
// VERBATIM as a pure render: no state mutation lives here, only the caller's
// handler callbacks are invoked. The map key stays on <MessageBubble> in the
// parent, so the root div no longer carries it.
//
// Perf (P1.2): memoized, and takes `isLastMessage` + `onRetryLastError`
// instead of the full `messages` array. The old `messages` prop meant EVERY
// bubble's props changed identity whenever the array changed for ANY
// reason (a new token, a new message anywhere) — which broke memoization
// for the whole list at once, not just the bubble that actually changed.
// `onRetryLastError` is a stable callback the parent builds via a ref
// (it always acts on the latest messages/send-handler without needing
// either as a reactive dependency), so a memoized bubble truly skips
// re-rendering when nothing about IT changed.

import { memo } from 'react';
import { GripVertical, AlertTriangle, Briefcase, Globe } from 'lucide-react';
import type { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import type { ChatMessage } from '@/platform/types/ai';
import type { EntityLabel } from '@/platform/hooks/useEntityLabel';
import { hasUnverifiedCitations } from '@/platform/rag/workspaceCommand';
import { PdfModeChip } from '@/features/ask/chat/PdfModeChip';
import { ChatSourcesAccordion } from '@/features/ask/ChatSourcesAccordion';
import {
  renderMessageWithWorkspaceChip,
  renderMessageWithCitations,
} from '@/features/ask/renderingHelpers';

interface MessageBubbleProps {
  msg: ChatMessage;
  idx: number;
  isLastMessage: boolean;
  t: ReturnType<typeof useTranslation>['t'];
  entityLabel: EntityLabel;
  handleCitationClick: (
    path: string,
    paragraphIndex: number,
    sourceType?: string,
    pageNumber?: number,
    snippet?: string,
  ) => void;
  handleMissingSource: (basename: string) => void;
  onRetryLastError: () => void;
}

function MessageBubbleImpl({
  msg,
  idx,
  isLastMessage,
  t,
  entityLabel,
  handleCitationClick,
  handleMissingSource,
  onRetryLastError,
}: MessageBubbleProps) {
  return (
          <div
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
                    e.dataTransfer.setData('application/x-keepance-chat-message', msg.content);
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
            {/* Stream A2 — PDF mode chips, shown below user messages that
                carried one or more PDF attachments. */}
            {msg.role === 'user' &&
              msg.attachments &&
              msg.attachments
                .filter((a) => a.type === 'pdf')
                .map((a) => (
                  <PdfModeChip
                    key={a.id}
                    mode={a.metadata.extractionMode ?? 'text-extract'}
                    className="mt-1"
                  />
                ))}
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
            {/* WS-B/C — scope indicator: shows which matter the answer was
                confined to (or the explicit cross-matter mode). Rendered on
                assistant messages whose turn was workspace-aware. */}
            {msg.role === 'assistant' && msg.scope && (
              <div
                data-testid={`chat-message-${String(idx)}-scope`}
                data-scope-kind={msg.scope.kind}
                className={cn(
                  'mt-1 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium',
                  msg.scope.kind === 'allMatters'
                    ? 'bg-amber-50 text-amber-800'
                    : 'bg-primary/10 text-primary',
                )}
                title={
                  msg.scope.kind === 'allMatters'
                    ? `This answer searched across every ${entityLabel.one}.`
                    : `This answer was confined to the active ${entityLabel.one}. Other clients' data was not searched.`
                }
              >
                {msg.scope.kind === 'allMatters' ? (
                  <Globe className="h-3 w-3" />
                ) : (
                  <Briefcase className="h-3 w-3" />
                )}
                {msg.scope.kind === 'allMatters'
                  ? `All ${entityLabel.other}`
                  : (msg.scope.matterName ?? `this ${entityLabel.one}`)}
              </div>
            )}
            {/* WS-B/C + BUG-065 — flag when ANY citation in this answer isn't
                proven: a source that failed verification OR a fabricated citation
                that resolves to no retrieved source. Only proven citations are
                safe to present. */}
            {msg.role === 'assistant' &&
              msg.sources &&
              hasUnverifiedCitations(msg.content, msg.sources) && (
                <div
                  data-testid={`chat-message-${String(idx)}-unverified-warning`}
                  className="mt-1 flex items-start gap-1.5 rounded border border-red-300 bg-red-50 px-2 py-1.5 text-[11px] text-red-700 max-w-[85%]"
                >
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>{t('matter.citation.unverified-warning')}</span>
                </div>
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
            {msg.isError && isLastMessage && (
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <button
                  className="text-xs text-muted-foreground hover:text-foreground underline"
                  onClick={onRetryLastError}
                >
                  {t('ai.chat.retry-last-message')}
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
                    {t('ai.chat.copy-diagnostic')}
                  </button>
                )}
              </div>
            )}
          </div>
  );
}

export const MessageBubble = memo(MessageBubbleImpl);
