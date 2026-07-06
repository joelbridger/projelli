/**
 * citationVerification — the ONE source of truth for citation verification
 * state (lp/badge-consistency).
 *
 * QA-85 wired the Sources cards to the REAL backend citation verifier
 * (`rag_verify_citations_batch`), but the hook and its verdicts lived inside
 * `SourcePanel`, so the answer header's tally pills and the per-block trust
 * labels kept deriving "verified" from the STATIC bind-time
 * `AnswerCitation.verified` flag — two independent signals that could (and
 * did, dry-run Run-2 evidence run2-06) contradict each other on screen.
 *
 * This module owns that state once, app-wide:
 *  - a shared, content-addressed verdict store (keyed by id + matterId +
 *    excerpt) that every surface reads;
 *  - {@link useCitationVerification}: the QA-85/QA-92 fetch-and-hold hook,
 *    relocated here unchanged in behaviour. Any number of components may call
 *    it with overlapping citation sets — a global requested-set dedupes the
 *    backend calls, and results land in the shared store so every consumer
 *    (mounted now or later) sees the same verdict;
 *  - {@link citationTrustState}: the single per-citation aggregation rule the
 *    header/blocks use, so they can never disagree with the cards.
 */

import { useEffect, useRef } from 'react';
import { create } from 'zustand';
import { ragVerifyCitationsBatch, type CitationVerdict } from '@/platform/utils/tauri-commands';
import { auditEventToEntry } from '@/platform/audit/AuditService';
import type { AuditEntry } from '@/platform/types/audit';
import type { AnswerCitation } from './askHelpers';
import type { CitationTrustState } from './answerBlockHelpers';
import { useStillImporting, isImportStatusUnsettled } from './useStillImporting';

/**
 * QA-85 — the real check's outcome for one citation. Extends the backend's
 * four verdicts with `'unavailable'`: thrown when the verifier can't run at
 * all (browser/dev mode has no Tauri backend). `'unavailable'` is NEVER
 * treated as verified — the card just stays in the neutral "Source found"
 * state, same as while the check is still pending.
 */
export type RealVerdict = CitationVerdict['verdict'] | 'unavailable';

/** Content-addressed key: (id, matterId, excerpt). Keying by the QUOTED TEXT,
 *  not just citation identity, means a citation whose excerpt changes in
 *  place (same card, new quote) can never show a verdict computed for the old
 *  quote — the old key's late-arriving result lands under a key nobody reads
 *  anymore (QA-56's stale-async guard, now structural instead of ref-based). */
export function verifyKey(id: string, matterId: string, excerpt: string): string {
  return `${id} ${matterId} ${excerpt}`;
}

interface CitationVerdictsStore {
  /** Every settled verdict, shared across all consumers. Replaced (new Map)
   *  on each update so subscribers re-render on reference change. */
  verdicts: Map<string, RealVerdict>;
  /** Bumped when held-back keys are released for retry (QA-92 round 2) so
   *  every mounted hook instance re-checks its citation set. */
  retryTick: number;
}

export const useCitationVerdictsStore = create<CitationVerdictsStore>(() => ({
  verdicts: new Map<string, RealVerdict>(),
  retryTick: 0,
}));

/** Keys ever handed to the backend (or settled 'unavailable') — global, so
 *  two components showing the same citation never double-fetch or double-audit. */
const requested = new Set<string>();
/** QA-92 round 2 — negative verdicts that landed while a content import was
 *  unsettled. They stay absent from the store (cards read "pending") and are
 *  released for exactly one retry when indexing settles to idle. */
const heldForRetry = new Set<string>();

/** Test-only: clear all module/store state between tests (verdicts are
 *  content-addressed and would otherwise leak across test cases). */
export function resetCitationVerificationForTests(): void {
  requested.clear();
  heldForRetry.clear();
  useCitationVerdictsStore.setState({ verdicts: new Map<string, RealVerdict>(), retryTick: 0 });
}

function bumpRetryTick(): void {
  useCitationVerdictsStore.setState((s) => ({ retryTick: s.retryTick + 1 }));
}

/**
 * QA-85 — automatically runs the real backend citation check for every
 * eligible citation (id + matterId present) the moment it appears, batched in
 * one `rag_verify_citations_batch` call per new set of citations. No user
 * action required. A citation without `id`/`matterId` (pre-3.0 persisted
 * data) is simply never fetched — it stays "Source found" forever, honestly.
 *
 * Safe to call from several components at once (SourcePanel + each answer's
 * header): the global requested-set means each unique citation is checked
 * exactly once and audited exactly once, whichever mount got there first.
 */
export function useCitationVerification(
  citations: AnswerCitation[],
  onAuditLog?: (entry: Omit<AuditEntry, 'id' | 'timestamp'>) => void,
): Map<string, RealVerdict> {
  const verdicts = useCitationVerdictsStore((s) => s.verdicts);
  const retryTick = useCitationVerdictsStore((s) => s.retryTick);

  // QA-92 round 2 — a negative verdict (notFound/textMismatch/matterMismatch)
  // that arrives while a content import (email/CRM/OneDrive/file indexing) is
  // still unsettled must not stick: a re-index in flight can transiently make
  // a real source look missing or mismatched. Keys held in `heldForRetry`
  // stay absent from the store (so the card reads "pending", never a false
  // red) and are released for exactly one retry the moment indexing settles.
  const importStatus = useStillImporting();
  const importUnsettled = isImportStatusUnsettled(importStatus);
  const importUnsettledRef = useRef(importUnsettled);
  importUnsettledRef.current = importUnsettled;
  const wasUnsettled = useRef(importUnsettled);

  useEffect(() => {
    // Idempotent across multiple mounted hook instances: the first effect to
    // observe the unsettled→idle transition drains the held set and bumps the
    // shared retry tick; later ones find it empty and do nothing.
    if (wasUnsettled.current && !importUnsettled && heldForRetry.size > 0) {
      heldForRetry.forEach((key) => requested.delete(key));
      heldForRetry.clear();
      bumpRetryTick();
    }
    wasUnsettled.current = importUnsettled;
  }, [importUnsettled]);

  const eligible = citations.filter(
    (c): c is AnswerCitation & { id: string; matterId: string } => Boolean(c.id && c.matterId),
  );
  const signature = eligible.map((c) => verifyKey(c.id, c.matterId, c.excerpt)).join('|');

  useEffect(() => {
    const toFetch = eligible.filter((c) => !requested.has(verifyKey(c.id, c.matterId, c.excerpt)));
    if (toFetch.length === 0) return;
    toFetch.forEach((c) => requested.add(verifyKey(c.id, c.matterId, c.excerpt)));
    // QA-92 round 2 (coordinator review round 2): capture whether indexing
    // was unsettled at the moment THIS batch was ISSUED, not whatever
    // `importUnsettledRef.current` happens to read once the result lands. A
    // batch issued while unsettled can still race a re-index that started
    // just before it and finished before the result comes back — reading the
    // ref only at result time would miss exactly that case and let a
    // transient negative stick.
    const importUnsettledAtStart = importUnsettledRef.current;
    const run = async () => {
      try {
        const results = await ragVerifyCitationsBatch(
          toFetch.map((c) => ({ id: c.id, claimedMatterId: c.matterId, quotedText: c.excerpt })),
        );
        // Results land in the SHARED store even if this component unmounted
        // mid-flight — verdicts are content-addressed, so they are valid for
        // whichever consumer shows these citations next (this replaces the
        // old per-mount cancelled/cleanup dance, QA-85 round 2).
        const newlyHeld: string[] = [];
        useCitationVerdictsStore.setState((s) => {
          const next = new Map(s.verdicts);
          toFetch.forEach((c, i) => {
            const r = results[i];
            if (!r) return;
            const key = verifyKey(c.id, c.matterId, c.excerpt);
            // QA-92 round 2: a negative verdict from a batch ISSUED while
            // indexing was unsettled is held back — it never enters the
            // store, so the card stays "pending" rather than falsely turning
            // red. It's released for one retry the moment indexing settles to
            // idle (see the transition effect above) — or immediately below,
            // if indexing already settled while this batch was in flight.
            if (r.verdict !== 'verified' && importUnsettledAtStart) {
              heldForRetry.add(key);
              newlyHeld.push(key);
              return;
            }
            next.set(key, r.verdict);
          });
          return { verdicts: next };
        });
        toFetch.forEach((c, i) => {
          const r = results[i];
          if (r && !heldForRetry.has(verifyKey(c.id, c.matterId, c.excerpt))) {
            onAuditLog?.(
              auditEventToEntry({
                type: 'citation_verified',
                timestamp: new Date().toISOString(),
                payload: { citationId: c.id, verdict: r.verdict },
              }),
            );
          }
        });
        // Indexing already settled to idle by the time this result landed
        // (the transition-watching effect above would have already fired,
        // with nothing yet held then — so it won't fire again on its own).
        // Retry these specific keys right away instead of waiting for a
        // future unsettled→idle transition that isn't coming.
        if (newlyHeld.length > 0 && !importUnsettledRef.current) {
          newlyHeld.forEach((key) => {
            requested.delete(key);
            heldForRetry.delete(key);
          });
          bumpRetryTick();
        }
      } catch {
        // Browser/dev mode (no Tauri backend) or a verifier error — never
        // fake-verify. Mark 'unavailable' so these exact keys are not
        // endlessly retried; the card stays neutral "Source found".
        useCitationVerdictsStore.setState((s) => {
          const next = new Map(s.verdicts);
          toFetch.forEach((c) => next.set(verifyKey(c.id, c.matterId, c.excerpt), 'unavailable'));
          return { verdicts: next };
        });
      }
    };
    // eslint-disable-next-line lantern-async/no-silent-failure -- run() wraps everything in try/catch (errors settle keys as 'unavailable') and never rejects
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refetch is keyed by `signature` (content) and `retryTick` (QA-92 round 2 retry trigger), not by the `eligible`/`onAuditLog` references which are recreated every render.
  }, [signature, retryTick]);

  return verdicts;
}

/**
 * The ONE aggregation rule mapping a citation to the trust state the header
 * pills and block labels display — derived from the SAME live verdict store
 * the Sources cards render, so the two surfaces cannot contradict each other:
 *
 *  - live `verified`            → `'verified'`  (card: green "Verified against source")
 *  - live negative verdict      → `'unverified'` (card: red problem line) — a real
 *    refutation ALWAYS downgrades, even a bind-time-verified citation;
 *  - check still pending        → `'checking'`  (card: spinner);
 *  - checker can't run at all (`'unavailable'`, or a pre-3.0 citation with no
 *    id/matterId — card: neutral "Source found") → fall back to the bind-time
 *    `verified` flag. That flag claims grounding ("cited from your files"),
 *    not quote-verification, so it never contradicts the card's neutral
 *    state — and a post-hoc match honestly stays `'unverified'`.
 */
export function citationTrustState(
  cite: AnswerCitation,
  verdicts: ReadonlyMap<string, RealVerdict>,
): CitationTrustState {
  if (!cite.id || !cite.matterId) return cite.verified ? 'verified' : 'unverified';
  const v = verdicts.get(verifyKey(cite.id, cite.matterId, cite.excerpt));
  if (v === undefined) return 'checking';
  if (v === 'verified') return 'verified';
  if (v === 'unavailable') return cite.verified ? 'verified' : 'unverified';
  return 'unverified';
}
