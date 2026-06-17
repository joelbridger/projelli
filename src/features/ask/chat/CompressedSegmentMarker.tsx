/**
 * Stream A4 — renders the ✂️ compressed-segment indicator in the chat
 * message list. Sits where the original batch of messages used to appear.
 *
 * Props:
 *   message         - the ChatMessage with isCompressedSummary: true
 *   onExpand        - called when user clicks [Expand]; parent sets
 *                     expandedForNextSend on the summary message
 */

import { useTranslation } from 'react-i18next';
import type { ChatMessage } from '@/types/ai';
import { estimateTokens } from '@/features/ask/compression';
import { formatContextSize } from '@/modules/models/context-limits';

export interface CompressedSegmentMarkerProps {
  message: ChatMessage;
  onExpand: (summaryTimestamp: string) => void;
}

export function CompressedSegmentMarker({ message, onExpand }: CompressedSegmentMarkerProps) {
  const { t } = useTranslation();
  const originalCount = message.originalMessageCount ?? 0;
  const summaryTokens = estimateTokens(message.content ?? '');
  const isExpanded = message.expandedForNextSend === true;

  return (
    <div
      data-testid="compressed-segment-marker"
      className="flex items-center gap-2 px-4 py-1.5 text-[11px] text-muted-foreground bg-muted/30 border-y border-border/40 my-1"
    >
      <span aria-hidden>&#x2702;&#xFE0F;</span>
      <span data-testid="compressed-segment-label">
        Compressed: {originalCount} {originalCount === 1 ? 'message' : 'messages'}{' -> '}
        {formatContextSize(summaryTokens)} tokens
      </span>
      {isExpanded && (
        <span
          data-testid="compressed-segment-expanded-badge"
          className="rounded-full bg-blue-100 text-blue-700 px-1.5 py-0.5 font-medium"
        >
          {t('chat.compressed.expanded-for-next-send')}
        </span>
      )}
      <button
        data-testid="compressed-segment-expand-btn"
        onClick={() => onExpand(message.timestamp)}
        className="ml-auto text-[11px] underline underline-offset-2 hover:text-foreground transition-colors"
        type="button"
        aria-label={isExpanded ? 'Collapse expanded segment' : 'Expand to include in next send'}
      >
        {isExpanded ? 'Collapse' : 'Expand'}
      </button>
    </div>
  );
}

export default CompressedSegmentMarker;
