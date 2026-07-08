// buildSystemPrompt — pure string composition for the chat system prompt.
//
// Extracted VERBATIM from useChatSending. The LAYER ORDER is load-bearing and
// must not change: facts memory (M3) → workspace retrieval context (M2) →
// base role (+ workspace tool instructions) → open-files block → conversation
// history, with the withheld-export note appended last.
//
// The export-consent gate (dropUnconsentedExports) and the facts I/O
// (snapshotFactsForInjection) stay in the hook; this helper receives the
// already-consented `fileBlock` and the already-loaded `facts` so it is pure.

import type { ChatMessage, WorkspaceSource } from '@/platform/types/ai';
import type { Fact } from '@/platform/rag/FactsService';
import { buildWorkspaceContextBlock } from '@/platform/rag/workspaceCommand';
import { buildFactsMemoryBlock } from '@/platform/rag/FactsService';
import { brandText } from '@/config/brandText';

export interface BuildSystemPromptArgs {
  messages: ChatMessage[];
  hasWorkspace: boolean;
  rootPath: string | undefined;
  /** Output of buildOpenFilesPromptBlock over the consented open files. */
  fileBlock: string;
  retrievedSources: WorkspaceSource[];
  /** Output of snapshotFactsForInjection (durable memory). */
  facts: Fact[];
  /** Generic system note when an unconsented export attachment was withheld. */
  withheldExportNote: string;
}

export function buildSystemPrompt({
  messages,
  hasWorkspace,
  rootPath,
  fileBlock,
  retrievedSources,
  facts,
  withheldExportNote,
}: BuildSystemPromptArgs): string {
  // Build conversation history into system prompt
  const conversationContext = messages.slice(0, -1).map(m =>
    `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`
  ).join('\n\n');

  const workspaceInstructions = hasWorkspace
    ? brandText(`You are running inside Lantern, a local-first workspace app. The user's active workspace folder is "${rootPath}". You have direct access to this workspace via tools: read_file, write_file, create_folder, move_file, delete_file, list_files, search_files. When the user asks you to create, edit, organize, or look at files, USE THESE TOOLS directly — do not refuse, do not ask the user to create the file themselves, and do not pretend you can't access files. You CAN. All file paths should be relative to the workspace root. When creating .md files (documentation, notes, plans, etc.), just write them directly using write_file. After creating or modifying files, briefly confirm what you did.\n\n`)
    : '';

  const baseRole = hasWorkspace
    ? `${workspaceInstructions}You are a helpful AI assistant with full read/write access to the user's workspace.`
    : 'You are a helpful AI assistant.';

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
  const factsBlock = buildFactsMemoryBlock(facts);
  const factsPrefix = factsBlock ? `${factsBlock}\n\n` : '';

  return (conversationContext
    ? `${factsPrefix}${workspacePrefix}${baseRole}${fileBlock} Here is the conversation history so far:\n\n${conversationContext}\n\nPlease respond to the user's latest message.`
    : `${factsPrefix}${workspacePrefix}${baseRole}${fileBlock}`) + withheldExportNote;
}
