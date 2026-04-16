// System prompt builder for M5 inline AI edits.
//
// The model is given one job: replace the selected text with a revised
// version that honours the user's instruction. We instruct it to emit
// ONLY the replacement text — no preamble ("Sure! Here's..."), no
// Markdown fence wrapper, no commentary. A `stripAccidentalMarkdownFence`
// in streamingDiff.ts handles the occasional ignored rule once the
// stream finishes.
//
// Phase 3 M3 facts and M1/M2 `<workspace_context>` are pre-pended
// automatically by whatever prompt-assembly path feeds the provider;
// this builder owns only the task description.

export interface BuildEditSystemPromptArgs {
  /** The text the user had selected when they triggered the edit. */
  selection: string;
  /** The user's free-text instruction (e.g. "tighten this to 3 sentences"). */
  instruction: string;
  /**
   * Optional hint about the surrounding document format. Lets the prompt
   * remind the model not to, say, strip Markdown markers when editing a
   * `.md` file. Omitted for plain text.
   */
  formatHint?: 'markdown' | 'plain' | 'rich';
}

const BASE_RULES = [
  'You are editing a document inline.',
  "Replace the <selection> text with a revised version that satisfies the user's instruction.",
  'Output ONLY the replacement text.',
  'Do not include a preamble like "Sure, here is..." or "Here is the revised text".',
  'Do not wrap the reply in Markdown code fences unless the original selection was itself a code fence.',
  'Preserve the original formatting cues: headings, list markers, code fences, indentation, line breaks.',
].join(' ');

export function buildEditSystemPrompt(args: BuildEditSystemPromptArgs): string {
  const parts: string[] = [BASE_RULES];
  if (args.formatHint === 'markdown') {
    parts.push(
      'The document is Markdown. Keep Markdown syntax (`#` headings, `-` / `*` lists, `[text](url)` links, fenced code) intact unless the instruction explicitly asks you to change it.'
    );
  } else if (args.formatHint === 'plain') {
    parts.push(
      'The document is plain text. Do not introduce Markdown syntax the user did not already use.'
    );
  } else if (args.formatHint === 'rich') {
    parts.push(
      'The document is a rich-text editor. Keep paragraph breaks as blank lines.'
    );
  }
  parts.push(`User instruction: ${args.instruction}`);
  parts.push(`<selection>\n${args.selection}\n</selection>`);
  return parts.join('\n\n');
}
