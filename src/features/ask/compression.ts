/**
 * Stream A4 — Summarization compression algorithm.
 *
 * Compresses older messages in a chat history by batching them and sending
 * each batch to a fast model. Returns a new messages array with:
 *   - Most recent N turns kept verbatim (never compressed).
 *   - Older turns replaced by CompressedSummary messages.
 *   - Original messages annotated with compressedIntoId (not removed).
 *
 * The caller is responsible for writing the result back to the AIChatFile.
 */

import type { ChatMessage } from '@/platform/types/ai';
import type { Provider } from '@/platform/providers/Provider';

/** Approximate 4 chars per token. Good enough for meter + batching. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Sum tokens across a messages array. */
export function estimateMessagesTokens(messages: ChatMessage[]): number {
  return messages.reduce((sum, m) => sum + estimateTokens(m.content ?? ''), 0);
}

export interface CompressionOptions {
  /** How many recent turns to keep verbatim. Default: 6. */
  keepRecentTurns: number;
  /** Approximate token target per batch sent to the summarizer. Default: 10000. */
  batchTokenTarget: number;
  /** Provider to use for summarization. If null, compression is skipped. */
  fastProvider: Provider | null;
}

export interface CompressedResult {
  /** Full messages array with summary entries inserted. */
  messages: ChatMessage[];
  /** Number of original messages that were summarized. */
  originalCount: number;
  /** Total tokens in the resulting context (verbatim + summaries). */
  resultingTokens: number;
  /** Tokens in the context before compression. */
  originalTokens: number;
}

const SUMMARIZATION_PROMPT = `You are summarizing a section of a conversation.
Preserve: names of people mentioned, any decisions made, file names or paths referenced, pending questions, key technical details.
Be concise. Return only the summary — no preamble, no "this section discussed" framing.`;

/**
 * Compress a messages array.
 *
 * 1. Splits messages into "recent" (keep verbatim) and "older" (compress).
 * 2. Batches older messages into ~batchTokenTarget chunks.
 * 3. Sends each batch to fastProvider for summarization.
 * 4. Annotates original messages with compressedIntoId.
 * 5. Returns a new messages array with CompressedSummary entries.
 *
 * If fastProvider is null (Ollama-only or offline), throws an error that
 * the UI surfaces as "Compression requires a cloud fast model."
 */
export async function compressMessages(
  messages: ChatMessage[],
  opts: CompressionOptions
): Promise<CompressedResult> {
  if (!opts.fastProvider) {
    throw new Error(
      'Compression requires a fast cloud model. Configure Claude, OpenAI, or Gemini to enable compression.'
    );
  }

  const originalTokens = estimateMessagesTokens(messages);

  // A "turn" is a user+assistant pair. keepRecentTurns * 2 = message count to preserve.
  const keepCount = opts.keepRecentTurns * 2;
  const recentMessages = messages.slice(-keepCount);
  const olderMessages = messages.slice(0, messages.length - keepCount);

  if (olderMessages.length === 0) {
    // Nothing to compress.
    return {
      messages,
      originalCount: 0,
      resultingTokens: originalTokens,
      originalTokens,
    };
  }

  // Batch older messages into groups of ~batchTokenTarget tokens.
  const batches: ChatMessage[][] = [];
  let currentBatch: ChatMessage[] = [];
  let currentBatchTokens = 0;

  for (const msg of olderMessages) {
    const msgTokens = estimateTokens(msg.content ?? '');
    if (
      currentBatch.length > 0 &&
      currentBatchTokens + msgTokens > opts.batchTokenTarget
    ) {
      batches.push(currentBatch);
      currentBatch = [];
      currentBatchTokens = 0;
    }
    currentBatch.push(msg);
    currentBatchTokens += msgTokens;
  }
  if (currentBatch.length > 0) batches.push(currentBatch);

  // Summarize each batch.
  const summaryMessages: ChatMessage[] = [];
  const summaryTimestamps: string[] = [];

  for (const batch of batches) {
    const batchText = batch
      .map(m => `[${m.role.toUpperCase()}]: ${m.content ?? ''}`)
      .join('\n\n');

    const userPrompt = `Here is a segment of conversation to summarize:\n\n${batchText}`;

    const summaryResponse = await opts.fastProvider.sendMessage(userPrompt, {
      systemPrompt: SUMMARIZATION_PROMPT,
    });

    const summaryContent = summaryResponse.content ?? '';
    const summaryTimestamp = new Date().toISOString();
    summaryTimestamps.push(summaryTimestamp);

    summaryMessages.push({
      role: 'assistant',
      content: summaryContent,
      timestamp: summaryTimestamp,
      isCompressedSummary: true,
      originalMessageCount: batch.length,
    });
  }

  // Annotate original messages with compressedIntoId so Expand can find them.
  // Each original message in batch i gets the timestamp of summaryMessages[i].
  let batchIndex = 0;
  let countInBatch = 0;
  const annotatedOlderMessages: ChatMessage[] = olderMessages.map(msg => {
    const currentBatchLen = batches[batchIndex]?.length ?? 0;
    if (countInBatch >= currentBatchLen) {
      batchIndex++;
      countInBatch = 0;
    }
    countInBatch++;
    const summaryId = summaryTimestamps[batchIndex] ?? summaryTimestamps[summaryTimestamps.length - 1] ?? '';
    return {
      ...msg,
      compressedIntoId: summaryId,
    };
  });

  // Build the final messages array:
  // annotated originals (hidden from AI) + summary markers + recent verbatim.
  const resultMessages = [
    ...annotatedOlderMessages,
    ...summaryMessages,
    ...recentMessages,
  ];

  const resultingTokens = estimateMessagesTokens(
    resultMessages.filter(m => !m.compressedIntoId)
  );

  return {
    messages: resultMessages,
    originalCount: olderMessages.length,
    resultingTokens,
    originalTokens,
  };
}

/**
 * Filters a messages array to only the messages that should be sent to the AI.
 * Excludes messages with compressedIntoId UNLESS expandedForNextSend is set
 * on the corresponding summary.
 */
export function getMessagesForSend(messages: ChatMessage[]): ChatMessage[] {
  // Collect which summary timestamps have been expanded.
  const expandedIds = new Set(
    messages
      .filter(m => m.isCompressedSummary && m.expandedForNextSend)
      .map(m => m.timestamp)
  );

  return messages.filter(m => {
    // Keep non-compressed messages always.
    if (!m.compressedIntoId) return true;
    // Keep original messages if their summary was expanded.
    return expandedIds.has(m.compressedIntoId);
  });
}

/**
 * Clears all expandedForNextSend flags after a send completes.
 * Call this after the AI response arrives to reset the expand state.
 */
export function clearExpandedFlags(messages: ChatMessage[]): ChatMessage[] {
  return messages.map(m =>
    m.expandedForNextSend ? { ...m, expandedForNextSend: false } : m
  );
}
