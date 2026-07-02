// ChatMessageList — the scrollable message history, split out of
// AIChatViewer so it can be memoized (Perf P1.2). AIChatViewer re-renders on
// every keystroke in the composer (inputValue lives there); as long as this
// component's props stay referentially stable across a pure keystroke
// (messages/isLoading/callbacks unchanged), React.memo skips re-rendering
// the whole message history on every character typed.

import { memo } from 'react';
import { Square } from 'lucide-react';
import type { useTranslation } from 'react-i18next';
import { Button } from '@/ui/button';
import type { ChatMessage } from '@/platform/types/ai';
import type { EntityLabel } from '@/platform/hooks/useEntityLabel';
import type { ProposedFact } from '@/platform/rag/factsExtraction';
import { CompressedSegmentMarker } from '@/features/ask/chat/CompressedSegmentMarker';
import { MessageBubble } from '@/features/ask/chat/MessageBubble';
import { ProposedFactsPanel } from '@/features/ask/ProposedFactsPanel';

type PendingProposal = ProposedFact & { key: string; matterId?: string };

interface ChatMessageListProps {
  messages: ChatMessage[];
  isLoading: boolean;
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
  handleExpandSegment: (summaryTimestamp: string) => void;
  onRetryLastError: () => void;
  onStop: () => void;
  proposedFacts: PendingProposal[];
  onAcceptProposedFact: (key: string, editedText?: string) => void | Promise<void>;
  onRejectProposedFact: (key: string) => void;
  messagesEndRef: React.RefObject<HTMLDivElement>;
}

function ChatMessageListImpl({
  messages,
  isLoading,
  t,
  entityLabel,
  handleCitationClick,
  handleMissingSource,
  handleExpandSegment,
  onRetryLastError,
  onStop,
  proposedFacts,
  onAcceptProposedFact,
  onRejectProposedFact,
  messagesEndRef,
}: ChatMessageListProps) {
  return (
    <div data-testid="chat-messages" className="flex-1 overflow-y-auto p-4 space-y-4">
      {messages.map((msg, idx) => {
        // Stream A4 — don't render original messages that have been compressed.
        // The CompressedSegmentMarker speaks for them.
        if (msg.compressedIntoId) return null;
        // Stream A4 — render compressed summary marker instead of normal bubble.
        if (msg.isCompressedSummary) {
          return (
            <CompressedSegmentMarker
              key={idx}
              message={msg}
              onExpand={handleExpandSegment}
            />
          );
        }
        return (
          <MessageBubble
            key={idx}
            msg={msg}
            idx={idx}
            isLastMessage={idx === messages.length - 1}
            t={t}
            entityLabel={entityLabel}
            handleCitationClick={handleCitationClick}
            handleMissingSource={handleMissingSource}
            onRetryLastError={onRetryLastError}
          />
        );
      })}
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
            onClick={onStop}
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
          onAccept={onAcceptProposedFact}
          onReject={onRejectProposedFact}
        />
      )}
      <div ref={messagesEndRef} />
    </div>
  );
}

export const ChatMessageList = memo(ChatMessageListImpl);
