# Foundation F4 exact-meeting Agenda receipt

## Scope delivered

The Agenda source is a persisted encrypted live CRM record addressed by the
sealed `householdRef + matterId + meetingId` triple. The record can only be
created after the canonical meeting proves all three values. Reads reload the
canonical record and reject a mismatched parent or stale client switch. Saves
use an expected revision and reject both stale revisions and client switches
that happen while a save is in flight.

The editable panel has local loading, empty, ready, and error states. It shows
the built-in template provenance and the canonical meeting source references.
Its only outward actions are an explicit draft save, clipboard copy, and Word
export of an already persisted revision. It has no send or email action, takes
no raw output path, and cannot share an unsaved render-only draft.

The compatibility binding imports the exact Agenda identifier from
`BLESSED_MEETING_PANEL_IDS` in `@/features/meetings`. It registers only while a
real `MeetingEntry` host is mounted and adds no shell placeholder or panel for
another lane.

## Opus review pointers

Review these commits in order:

1. `5b8be6841` — length-framed key derivation, canonical exact-meeting reads,
   revision-checked writes, and stale-client rejection across async work.
2. `9dce2b86d` — editable panel, stale-load rejection in the UI, provenance,
   explicit save/share/export actions, and the safe Word-export seam.
3. `496cc20fd` — exact blessed Agenda ID import and the real MeetingEntry
   compatibility binding.
4. `3b355f307` — read-error narrowing so write-only stale results cannot escape
   through the reader, plus typed unavailable results for port failures.

## Verification evidence

- `npm run typecheck` — pass.
- `npm run typecheck:tests` — pass.
- Fresh final run of the four new Agenda store/panel/export/binding test files —
  pass: 4 files / 13 tests. The earlier combined Agenda plus host-regression
  run also passed: 8 files / 46 tests.
- `npm run i18n:completeness` — pass: 63 catalogs / 3,800 keys.
- `npm run boundaries:check` — pass: no feature-boundary regression (597
  current baseline findings).
- `git diff --check` — pass.

The official changed gate was run at the exact launch base with
`GATE_BASE=800a5df6512d157aab481376b22cec44cd8bf5cf npm run gate:changed`.
The first allowed attempt found a TypeScript result-union mismatch; the final
commit above fixed it. On the second and final allowed attempt, Tauri parity,
TypeScript, test TypeScript, wire contracts, brand/identity checks, and the
ESLint regression gate all passed. All 309 selected test files and all 1,974
tests also passed. The command nevertheless ended red because the pre-existing
`V1ShellFrame.test.tsx` test left a Radix focus timer running, which later
dispatched a non-jsdom `Event` and was counted as one unhandled test-harness
error. That file is outside this lane's grant. No third gate attempt was made
because the lane permits at most two attempts.

## Fence receipt

- No “today's meeting” or first-client-match lookup.
- No raw path input.
- No silent send or email action.
- No fake saved agenda derived only during render.
- No reconciliation with the stopped shell's Agenda placeholder.
- No component for another panel lane.

Native/Rust touched: **NO**.
