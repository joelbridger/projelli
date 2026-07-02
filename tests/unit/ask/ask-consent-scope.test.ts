/**
 * F2.5b — askConsentScope maps an Ask turn to the file-access consent scope it
 * runs under. It MUST mirror useAsk's retrievalScope so a grant is bound to
 * exactly the client data a send could pull (single client vs. all clients).
 */
import { describe, it, expect } from 'vitest';
import { askConsentScope, selectHistoryTurns, deriveTurnGrounding } from '@/features/ask/askHelpers';
import { askChatId } from '@/features/ask/useAsk';
import { fileToolsAllowed, broadestConsentScope, type FileAccessConsent, type ConsentScope } from '@/platform/ai/fileAccessConsent';
import type { AskTurn } from '@/features/ask/askHelpers';

describe('askConsentScope', () => {
  it('active client + "this-matter" → that client\'s matter', () => {
    expect(askConsentScope('m1', 'this-matter')).toEqual({ kind: 'matter', matterId: 'm1' });
  });

  it('active client + Email/Documents (still matter-partitioned) → that client', () => {
    expect(askConsentScope('m1', 'email')).toEqual({ kind: 'matter', matterId: 'm1' });
    expect(askConsentScope('m1', 'documents')).toEqual({ kind: 'matter', matterId: 'm1' });
  });

  it('active client + "all-matters" → all clients (the wider scope needs its own grant)', () => {
    expect(askConsentScope('m1', 'all-matters')).toEqual({ kind: 'allMatters' });
  });

  it('no active client → all clients', () => {
    expect(askConsentScope(null, 'this-matter')).toEqual({ kind: 'allMatters' });
    expect(askConsentScope(undefined, 'all-matters')).toEqual({ kind: 'allMatters' });
  });

  it('binds consent so a single-client grant never widens to an all-clients Ask', () => {
    const grant = { state: 'granted' as const, grantedScope: askConsentScope('m1', 'this-matter') };
    // Same client → allowed.
    expect(fileToolsAllowed(grant, askConsentScope('m1', 'this-matter'))).toBe(true);
    // Same client but the user switched the toggle to "all-matters" → re-ask.
    expect(fileToolsAllowed(grant, askConsentScope('m1', 'all-matters'))).toBe(false);
    // A different client → re-ask.
    expect(fileToolsAllowed(grant, askConsentScope('m2', 'this-matter'))).toBe(false);
  });
});

describe('askChatId — Ask conversations are workspace-scoped (Codex rounds 8-9)', () => {
  it('binds both matter and global conversation ids to the workspace root', () => {
    expect(askChatId(null, '/ws/A')).toBe('ask-global::/ws/A');
    expect(askChatId('m1', '/ws/A')).toBe('ask-m1::/ws/A');
    // Same conversation, different workspace → different id → independent session + consent.
    expect(askChatId('m1', '/ws/A')).not.toBe(askChatId('m1', '/ws/B'));
    expect(askChatId(null, '/ws/A')).not.toBe(askChatId(null, '/ws/B'));
  });
  it('falls back to the un-suffixed id when no workspace is open', () => {
    expect(askChatId(null, null)).toBe('ask-global');
    expect(askChatId('m1', undefined)).toBe('ask-m1');
  });
});

describe('selectHistoryTurns — scope-aware history redaction (Codex round 3)', () => {
  // A current-code general turn carries a DEFINITE groundedFromFiles: false.
  const general: AskTurn = { question: 'q', answer: 'general answer', citations: [], sources: [], groundedFromFiles: false };
  // A LEGACY turn persisted before the marker existed (no groundedFromFiles).
  const legacyUnknown: AskTurn = { question: 'q', answer: 'legacy prose', citations: [], sources: [] };
  const groundedAll: AskTurn = {
    question: 'q', answer: 'cross-client facts', citations: [], sources: [],
    groundedFromFiles: true, groundingScope: { kind: 'allMatters' },
  };
  const groundedM1: AskTurn = {
    question: 'q', answer: 'm1 facts', citations: [], sources: [],
    groundedFromFiles: true, groundingScope: { kind: 'matter', matterId: 'm1' },
  };
  const legacyCited: AskTurn = {
    // No durable marker/scope, but citations → treated as file-derived, scope
    // assumed widest (all clients).
    question: 'q', answer: 'legacy facts',
    citations: [{ n: 1, path: '/x', verified: true } as AskTurn['citations'][number]],
    sources: [],
  };
  const grantAll: FileAccessConsent = { state: 'granted', grantedScope: { kind: 'allMatters' } };
  const grantM1: FileAccessConsent = { state: 'granted', grantedScope: { kind: 'matter', matterId: 'm1' } };
  const denied: FileAccessConsent = { state: 'denied' };
  const M1: ConsentScope = { kind: 'matter', matterId: 'm1' };
  const ALL: ConsentScope = { kind: 'allMatters' };

  it('LOCAL send keeps the full history (never leaks), whatever the scope', () => {
    expect(selectHistoryTurns([general, groundedAll, groundedM1], denied, false, ALL))
      .toEqual([general, groundedAll, groundedM1]);
  });

  it('cloud: general (non-file) turns are always kept', () => {
    expect(selectHistoryTurns([general], denied, true, ALL)).toEqual([general]);
  });

  it('cloud: a single-client grant does NOT carry an all-clients grounded turn (the round-3 leak)', () => {
    expect(selectHistoryTurns([general, groundedAll], grantM1, true, M1)).toEqual([general]);
  });

  it('cloud: a single-client grant keeps only the SAME client\'s grounded history', () => {
    const m2: AskTurn = { ...groundedM1, answer: 'm2 facts', groundingScope: { kind: 'matter', matterId: 'm2' } };
    expect(selectHistoryTurns([groundedM1, m2], grantM1, true, M1)).toEqual([groundedM1]);
  });

  it('cloud: an all-clients grant carries all grounded history', () => {
    expect(selectHistoryTurns([groundedAll, groundedM1], grantAll, true, ALL))
      .toEqual([groundedAll, groundedM1]);
  });

  it('cloud: denied consent drops every file-derived turn', () => {
    expect(selectHistoryTurns([general, groundedAll, groundedM1, legacyCited], denied, true, ALL))
      .toEqual([general]);
  });

  it('cloud: a legacy file-derived turn (no stored scope) rides ONLY under an all-clients grant', () => {
    expect(selectHistoryTurns([legacyCited], grantM1, true, M1)).toEqual([]);
    expect(selectHistoryTurns([legacyCited], grantAll, true, ALL)).toEqual([legacyCited]);
  });

  it('cloud: a LEGACY unmarked turn fails CLOSED — treated as file-derived, widest scope (Codex round 5)', () => {
    // Can't prove it was general → redacted under anything but an all-clients grant.
    expect(selectHistoryTurns([legacyUnknown], grantM1, true, M1)).toEqual([]);
    expect(selectHistoryTurns([legacyUnknown], denied, true, ALL)).toEqual([]);
    expect(selectHistoryTurns([legacyUnknown], grantAll, true, ALL)).toEqual([legacyUnknown]);
  });

  it('cloud: a current-code general turn (definite false marker) is always kept', () => {
    expect(selectHistoryTurns([general], denied, true, ALL)).toEqual([general]);
    expect(selectHistoryTurns([general], grantM1, true, M1)).toEqual([general]);
  });

  it('cloud: an ALL-CLIENTS turn with only a single-client grant drops that client\'s file history too (Codex round 12)', () => {
    // The current turn (all-clients) isn't permitted file content under an m1
    // grant, so even the m1-grounded prior answer must NOT ride along.
    expect(selectHistoryTurns([general, groundedM1], grantM1, true, ALL)).toEqual([general]);
  });
});

describe('broadestConsentScope', () => {
  const m1 = { kind: 'matter' as const, matterId: 'm1' };
  const m2 = { kind: 'matter' as const, matterId: 'm2' };
  const all = { kind: 'allMatters' as const };

  it('empty → all clients (conservative default)', () => {
    expect(broadestConsentScope([])).toEqual(all);
  });
  it('one client → that client', () => {
    expect(broadestConsentScope([m1])).toEqual(m1);
  });
  it('same client repeated → that client', () => {
    expect(broadestConsentScope([m1, m1])).toEqual(m1);
  });
  it('two different clients → all clients', () => {
    expect(broadestConsentScope([m1, m2])).toEqual(all);
  });
  it('any all-clients input → all clients', () => {
    expect(broadestConsentScope([m1, all])).toEqual(all);
  });
});

describe('deriveTurnGrounding — transitive grounding (Codex round 4)', () => {
  const m1 = { kind: 'matter' as const, matterId: 'm1' };
  const all = { kind: 'allMatters' as const };
  const general: AskTurn = { question: 'q', answer: 'a', citations: [], sources: [], groundedFromFiles: false };
  const groundedM1: AskTurn = { question: 'q', answer: 'a', citations: [], sources: [], groundedFromFiles: true, groundingScope: m1 };
  const groundedAll: AskTurn = { question: 'q', answer: 'a', citations: [], sources: [], groundedFromFiles: true, groundingScope: all };

  it('no fresh hits + no file-derived history → not file-derived', () => {
    expect(deriveTurnGrounding({ hadFreshHits: false, turnScope: m1, historyTurns: [general] }))
      .toEqual({ usedFileContent: false });
  });
  it('fresh hits only → scope is the turn scope', () => {
    expect(deriveTurnGrounding({ hadFreshHits: true, turnScope: m1, historyTurns: [] }))
      .toEqual({ usedFileContent: true, scope: m1 });
  });
  it('NO fresh hits but file-grounded history → transitively file-derived at the history scope', () => {
    // "summarize what you just said" with no fresh retrieval still repeats client facts.
    expect(deriveTurnGrounding({ hadFreshHits: false, turnScope: m1, historyTurns: [groundedAll] }))
      .toEqual({ usedFileContent: true, scope: all });
  });
  it('fresh hits at m1 + history grounded at all-clients → effective scope is all-clients', () => {
    expect(deriveTurnGrounding({ hadFreshHits: true, turnScope: m1, historyTurns: [groundedAll] }))
      .toEqual({ usedFileContent: true, scope: all });
  });
  it('fresh hits at m1 + history grounded at m1 → stays m1', () => {
    expect(deriveTurnGrounding({ hadFreshHits: true, turnScope: m1, historyTurns: [groundedM1] }))
      .toEqual({ usedFileContent: true, scope: m1 });
  });
});
