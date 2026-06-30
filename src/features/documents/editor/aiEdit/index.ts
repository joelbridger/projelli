// Barrel for the M5 inline-edit engine.
export { computeLineDiff, splitIntoHunks, applyHunks, stripAccidentalMarkdownFence } from './streamingDiff';
export { buildEditSystemPrompt } from './editPrompt';
export type {
  DiffHunk,
  HunkResolution,
  ChangeAuthor,
  AiAuthorshipMetadata,
  InlineEditSession,
} from './types';
