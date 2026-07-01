// deriveFactScope — A1 isolation guard for durable "facts" memory.
//
// Decides which client/matter a fact extracted from a chat transcript may be
// stamped with, using ONLY the scope frozen on the messages at send time
// (`ChatMessage.scope`, stamped by useChatSending) — never the live client
// picker, which can have moved on by the time post-turn extraction runs.
//
// The rule is deliberately conservative: stamp a SPECIFIC client id ONLY when
// we are certain of it, and fall back to GLOBAL (undefined) on ANY ambiguity.
// A global fact is never injected into a specific client (see
// `selectFactsForInjection`), so falling back to global can never leak a fact
// into the wrong client — whereas guessing a specific client can.

import type { ChatMessage } from '@/platform/types/ai';

/**
 * The matter/client id a fact extracted from `messages` may be stamped with, or
 * `undefined` (global) when it can't be attributed to exactly one client.
 *
 * Fact extraction reads a WINDOW of the transcript (see `runExtraction`), so a
 * fact can be drawn from ANY user turn in the chat — not just the latest. The
 * only provably-safe attribution is therefore: stamp a specific client X ONLY
 * when EVERY user turn is scoped to that same matter X (its frozen `scope`,
 * stamped at send time by useChatSending). If ANY user turn is a different
 * matter, an all-matters turn, or a plain/unscoped turn — all of which can
 * carry content about a DIFFERENT client — the window is ambiguous and this
 * returns `undefined` (global). A global fact is never injected into a specific
 * client (see `selectFactsForInjection`), so global can never leak; only a
 * wrong SPECIFIC id can, and that is exactly what this refuses to guess.
 *
 * Assistant turns carry no scope (never stamped) and are ignored — their
 * content is the model's answer to the preceding user turn, already covered by
 * that turn's scope.
 */
export function deriveFactScope(messages: ChatMessage[]): string | undefined {
  let matterId: string | undefined;
  let sawUser = false;
  for (const m of messages) {
    if (m.role !== 'user') continue;
    sawUser = true;
    const s = m.scope;
    // Any user turn that is not a single-matter scope makes the window
    // ambiguous — fail safe to global.
    if (!s || s.kind !== 'matter' || !s.matterId) return undefined;
    if (matterId === undefined) matterId = s.matterId;
    else if (matterId !== s.matterId) return undefined;
  }
  return sawUser ? matterId : undefined;
}
