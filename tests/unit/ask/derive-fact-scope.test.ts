/**
 * A1 (isolation) — deriveFactScope decides which client a fact extracted from a
 * chat transcript may be stamped with, using ONLY the scope frozen on messages
 * at send time. It must NEVER attribute a fact to the wrong specific client;
 * any ambiguity falls back to global (undefined), which never injects into a
 * specific client.
 */

import { describe, expect, it } from 'vitest';
import { deriveFactScope } from '@/features/ask/hooks/deriveFactScope';
import type { ChatMessage, TurnScope } from '@/platform/types/ai';

const matter = (matterId: string): TurnScope => ({ kind: 'matter', matterId, matterName: matterId });
const allMatters: TurnScope = { kind: 'allMatters' };

function user(content: string, scope?: TurnScope): ChatMessage {
  return { role: 'user', content, timestamp: 't', ...(scope ? { scope } : {}) };
}
function assistant(content: string): ChatMessage {
  return { role: 'assistant', content, timestamp: 't' };
}

describe('deriveFactScope (A1)', () => {
  it('stamps the single client of an unambiguous client-scoped chat', () => {
    const msgs = [user('q', matter('client-a')), assistant('a')];
    expect(deriveFactScope(msgs)).toBe('client-a');
  });

  it('falls back to GLOBAL when the latest turn is plain (unscoped) even if an earlier turn was scoped — the leak Codex R3 flagged', () => {
    // Earlier Client-B workspace turn, then user switched to Client A and sent a
    // plain (non-workspace) message. The fact must NOT be stamped Client B.
    const msgs = [
      user('scoped B question', matter('client-b')),
      assistant('B answer'),
      user('plain A question'), // no scope
      assistant('A answer'),
    ];
    expect(deriveFactScope(msgs)).toBeUndefined();
  });

  it('falls back to GLOBAL when the chat touched two different clients', () => {
    const msgs = [
      user('B question', matter('client-b')),
      assistant('B answer'),
      user('A question', matter('client-a')),
      assistant('A answer'),
    ];
    expect(deriveFactScope(msgs)).toBeUndefined();
  });

  it('is GLOBAL for an all-matters turn', () => {
    expect(deriveFactScope([user('q', allMatters), assistant('a')])).toBeUndefined();
  });

  it('is GLOBAL for a fully unscoped (plain) chat', () => {
    expect(deriveFactScope([user('q'), assistant('a')])).toBeUndefined();
  });

  it('falls back to GLOBAL when an EARLIER user turn is plain, even if the latest is client X', () => {
    // A plain earlier turn can carry content about a different client, so the
    // window is ambiguous — never stamp the latest client onto it.
    const msgs = [
      user('plain'),
      assistant('a'),
      user('scoped A', matter('client-a')),
      assistant('a2'),
    ];
    expect(deriveFactScope(msgs)).toBeUndefined();
  });

  it('falls back to GLOBAL when an earlier all-matters turn precedes a client turn (Codex R4 repro)', () => {
    // The all-matters turn can mention Client Y; a fact about Y must NOT be
    // stamped Client X just because the latest turn is X.
    const msgs = [
      user('Client Y is doing a Roth conversion', allMatters),
      assistant('...'),
      user('@workspace summarize Client X IPS', matter('client-x')),
      assistant('...'),
    ];
    expect(deriveFactScope(msgs)).toBeUndefined();
  });

  it('stamps the client only when EVERY user turn is that same client', () => {
    const msgs = [
      user('q1', matter('client-a')),
      assistant('a1'),
      user('q2', matter('client-a')),
      assistant('a2'),
    ];
    expect(deriveFactScope(msgs)).toBe('client-a');
  });

  it('CONTRACT: undefined means the fact is DROPPED (never saved global) — review P1 fail-closed', () => {
    // A `undefined` result is the ambiguous case. The AIChatViewer extraction
    // effect treats it as "drop the fact" (do not save, do not offer a chip),
    // so an ambiguous fact never becomes a global fact that could surface in
    // the cross-client all-matters view. This test pins that the ambiguous
    // cases resolve to undefined (the drop signal), not to any client id.
    const ambiguous = [
      user('a mix', matter('client-a')),
      assistant('...'),
      user('of clients', matter('client-b')),
      assistant('...'),
    ];
    expect(deriveFactScope(ambiguous)).toBeUndefined();
    expect(deriveFactScope([user('plain'), assistant('...')])).toBeUndefined();
  });
});
