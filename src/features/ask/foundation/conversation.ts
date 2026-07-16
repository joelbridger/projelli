import { useMemo } from 'react';
import { useLiveCrmRecords } from '@/platform/crm/useLiveCrmRecords';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';
import type { AskConversationMetadata, AskReviewDraft } from './contracts';

type AskStoredRecord = LiveCrmRecord & {
  readonly kind: 'askConversation' | 'askReviewDraft';
  readonly payload: AskConversationMetadata | AskReviewDraft;
};

function isAskStoredRecord(record: LiveCrmRecord): record is AskStoredRecord {
  return (
    (record.kind === 'askConversation' || record.kind === 'askReviewDraft') &&
    typeof record['payload'] === 'object' &&
    record['payload'] !== null
  );
}

function recordFor(
  payload: AskConversationMetadata | AskReviewDraft
): AskStoredRecord {
  const kind = 'destination' in payload ? 'askReviewDraft' : 'askConversation';
  const matterId =
    payload.scope.kind === 'whole-firm'
      ? undefined
      : payload.scope.kind === 'single-meeting'
        ? payload.scope.meeting.matterId
        : payload.scope.kind === 'selected-meetings'
          ? payload.scope.meetings[0]?.matterId
          : payload.scope.matterId;
  return {
    id: `ask:${kind}:${payload.id}`,
    kind,
    payload,
    ...(matterId ? { matterId } : {}),
  };
}

/**
 * Reactive persisted Ask metadata/draft doorway. It uses only the encrypted
 * live-record route and keeps typing/streaming state out of persistence.
 */
export function useAskConversation() {
  const live = useLiveCrmRecords();
  const stored = useMemo(
    () => live.records.filter(isAskStoredRecord),
    [live.records]
  );
  const conversations = useMemo(
    () =>
      stored
        .filter((record) => record.kind === 'askConversation')
        .map((record) => record.payload as AskConversationMetadata),
    [stored]
  );
  const reviewDrafts = useMemo(
    () =>
      stored
        .filter((record) => record.kind === 'askReviewDraft')
        .map((record) => record.payload as AskReviewDraft),
    [stored]
  );
  return {
    conversations,
    reviewDrafts,
    saveConversation: async (metadata: AskConversationMetadata) =>
      live.save(recordFor(metadata)),
    saveReviewDraft: async (draft: AskReviewDraft) =>
      live.save(recordFor(draft)),
  };
}

export { recordFor as askConversationLiveRecord };
