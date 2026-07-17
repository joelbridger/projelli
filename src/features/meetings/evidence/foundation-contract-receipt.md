# Meetings foundation contract receipt

## Scope

Part A only. The public `@/features/meetings` doorway provides canonical local
meeting records, append-only artifact transitions, notice-evidence projections,
parent-verified client-bound readers, reactive type/template/settings stores,
and a cited Ask source adapter. Saves use the encrypted live-record route and
reload from its canonical result. Shared records carry a delivery route derived
from the active local-to-firm matter mapping; mismatched local matters stop.

No Part B work is included: no recording/capture, microphone access, spoken
audio claim, transcription/diarization engine, model/provider call, email
delivery, export, automation execution, retention cleanup, audit write, native
command, Rust change, migration, or command-manifest change.

## Honest public-import manifest

The complete manifest is `foundation/manifest.ts`. These meeting-side seams
have outside-module public fixtures and are ready:

- `meetingsShell.import.ts` — core records/stores only, not the top-level shell.
- `noticeEvidence.import.ts` — local notice-evidence read model only.
- `askAcrossMeetings.import.ts` — client-bound cited source adapter.
- `meetingComposition.import.ts` — the panel / header-action / insight append
  path, which `MeetingEntry` renders through its default composition.

The meeting **panel, header-action, and insight** composition registries are
now wired into the real `MeetingEntry` host via the codebase's open-world
composition idiom (`createMeeting*Composition(...contributions)` +
`defaultMeeting*Composition`), published through `@/features/meetings`, and
covered by open-world tests. A dependent contribution renders in the product.

Every remaining consumer that needs a still-absent owner or composition host is
`coordinator-blocked`, has no fixture, and carries a `COORDINATOR:` reason
naming the absent doorway. No empty lookalike registry was invented for them. In
particular: the top-level Meetings swap, meeting lists / list-tools /
artifact-contribution panels / notice-evidence providers (all owned by the
blocked `meetings-shell-v1`, whose `appSurfaceRegistry` public doorway is absent
at base), spoken notice, diarization, keywords, talk time, signals, Settings
mounts, visibility enforcement, My Meetings, and CRM client tabs are not
launch-ready.

## Acceptance evidence

| Line | Honest result |
| --- | --- |
| M1 | Pass for the narrowed foundation: core/artifact records survive canonical save, independent fresh reload, mounted relay refresh, and distinct local/firm relay identities; context and additive fields survive. |
| M2 | Pass for the local read model: notice evidence is an append-only local fact and never claims capture or delivery. The full named notice consumer remains blocked on its real owner seams. |
| M3 | Partial: versioned kinds exist and the insight composition host is wired; spoken-notice/diarization/talk-time consumers stay coordinator-blocked on the `meetings-shell-v1` panel/list hosts (absent `appSurfaceRegistry` doorway). |
| M4 | Pass for narrowed data inputs: wrong household, matter, meeting parent, kind, version, approval state, and hostile/stale transition all fail closed. Client isolation resolves the active client LIVE at every operation (production hooks read the live source via getState, never a store-grab snapshot), so a store held across a client switch — including one held across an in-flight await — fails closed on the stale client for get/list/update/transition/append/approve/artifact-read. Proven at the low level (same held store A→B→none→A) AND at the hook layer (real production hook, switch behind its back, plus the approve-started-under-A / switch-mid-await scenario). The construction API forbids the isolation-less shape: createMeetingStore / createMeetingArtifactStore require a live getActiveMatterId resolver (ClientScopedLivePort), so a store with no client isolation is a compile error, and a resolver returning null/undefined fails closed — the paved path documents only this safe construction and a test proves the unsafe shape does not type-check. Consumer mounts remain blocked where listed. |
| M5 | Pass for the narrowed stores: type, template, settings, visibility, owner, and deferred-descriptor records validate, save, reload, and reject corrupt canonical values. Settings/visibility/My Meetings UI consumers remain blocked. |
| M6 | Pass: only local draft/read descriptors exist; no sender, provider, exporter, cleanup job, audit writer, or automation runner exists. |
| M7 | Pass for the wired composition seam (panel/header/insight registries, real host `MeetingEntry`, open-world tested, public consumer fixture compiles). Not passed for the full consumer map: every absent owner/host doorway is explicitly coordinator-blocked with the named absent doorway, not replaced locally. |
| M8 | Pass for the shipped composition registries: base composition plus a genuine third contribution, stable order, duplicate/malformed rejection, and dark exclusion are covered; the paved path shows a real append example per registry. Blocked hosts ship no lookalike. |

## Fresh checks

- `npm run typecheck` — pass.
- `npm run typecheck:tests` — pass.
- Seven focused foundation files (contract incl. construction-safety, live
  round-trip, relay, production relay-chain, composition open-world, hook-layer
  client isolation, manifest) plus the MeetingEntry host-render composition
  proof and the legacy registry test — 9 files / 43 tests pass.
- Architecture boundary and English i18n snapshot files — pass.
- `npm run boundaries:check` — pass (no feature-boundary regression).
- `npm run lint:gate` — pass (no ESLint regression vs baseline).
- Handle guard — pass.
- `vitest run --changed` vs the approved base — pass: 149 affected test files /
  754 tests. The machine `evidence/self-check-receipt-<sha>.txt` binds the final
  commit and is the authoritative gate proof (gate:changed runs the full
  changed-file suite within the official window).

## Native / Part B status

Native/Rust touched: **NO**. Part B remains parked, unreserved, and awaiting a
coordinator/Jameson decision.
