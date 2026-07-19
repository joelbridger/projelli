# Foundation F9 Actions receipt

- Launch base: `b453629b282a07d50d6365dcc2acb831a018ea38` (BASE-C).
- Capability commit: `7ba413089` (`feat(meetings): add sealed Actions review inbox`).
- Proof commit: `83da4212d` (`test(meetings): prove Actions pair isolation and lifecycle`).
- Scope stayed in the Meetings foundation. No shell Actions UI, badge binding,
  `MeetingsWorkspace.tsx`, or shell contracts changed; those remain Group E.

## Contract delivered

- G2 keeps its explicit, separately typed, minted firm grant and rechecks both
  the grant and firm-selection state before and after canonical reloads.
- The sealed inbox projection exposes only valid task proposals, CRM before/after
  proposals, edited follow-up drafts, and explicitly review-required speaker or
  unmatched-attendee artifacts.
- Rows carry the typed kind, exact client pair, useful meeting/client labels,
  factual owner (including truly unassigned), needs-review state, independent
  active/archived state, explicit urgency fact, and produced time.
- Need attention / All / Archived / Type / Owner filtering happens only after
  exact client projection. Sorting is explicit-urgent first, then newest.
- Badge counts deduplicate meeting IDs, not artifact rows, after client scope and
  before presentation filters. Archived items do not count.
- Archive/restore is a durable, reversible transition. It does not approve or
  mutate the produced artifact. Stale, cross-client, out-of-order, or forged
  transitions fail closed.
- Loading, refused, retryable error, ready-empty, and ready-populated are distinct
  result types. Selected-client empty copy names the client and filter.

## Isolation proof

- Public compile-negative fixture:
  `fixtures/meetingReviewInbox.import.ts` proves a matter-only read, a firm grant
  used as client proof, and a matter-only selected lifecycle write do not typecheck.
- Runtime fixture gives household A and household B the same `matterId`.
  Household B sees none of A's rows, archives, or badge count.
- The archive filter and unique-meeting badge are both pair-scoped.
- Raw G2 stays inside `MeetingReviewInboxReader`; selected-client consumers receive
  only the sealed projection.
- Whole-tree inventory found no production matter-only Actions projection. The
  only matter-only calls are the expected `@ts-expect-error` fixture lines.

## Verification on code tip `83da4212d`

- `npm run boundaries:check` — PASS: no feature-boundary regression (597 existing
  baseline findings, zero new findings).
- Focused Vitest command covering the inbox, G2 contract, and F8 store chokepoint —
  PASS: 3 files, 43 tests.
- `npm run typecheck` — PASS.
- `npm run typecheck:tests` — PASS.
- Scoped ESLint for all changed code and proof files — PASS.
- `git diff --check` — PASS.
- Shell-file diff against BASE-C — empty.
