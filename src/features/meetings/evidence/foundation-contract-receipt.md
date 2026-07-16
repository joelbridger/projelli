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

Every named consumer that also needs a missing owner or composition seam is
`coordinator-blocked`, has no fixture, and carries a `COORDINATOR:` reason. The
incompatible local registry lookalikes and their misleading fixtures were
removed. In particular, the top-level Meetings swap, panel/header/insight/list
contributions, spoken notice, diarization, keywords, talk time, signals,
Settings mounts, visibility enforcement, My Meetings, and CRM client tabs are
not launch-ready.

## Acceptance evidence

| Line | Honest result |
| --- | --- |
| M1 | Pass for the narrowed foundation: core/artifact records survive canonical save, independent fresh reload, mounted relay refresh, and distinct local/firm relay identities; context and additive fields survive. |
| M2 | Pass for the local read model: notice evidence is an append-only local fact and never claims capture or delivery. The full named notice consumer remains blocked on its real owner seams. |
| M3 | Not launch-ready: versioned kinds exist, but spoken-notice/diarization/talk-time consumers remain coordinator-blocked on real composition hosts. |
| M4 | Pass for narrowed data inputs: wrong household, matter, meeting parent, kind, version, approval state, and hostile transition all fail closed. Consumer mounts remain blocked where listed. |
| M5 | Pass for the narrowed stores: type, template, settings, visibility, owner, and deferred-descriptor records validate, save, reload, and reject corrupt canonical values. Settings/visibility/My Meetings UI consumers remain blocked. |
| M6 | Pass: only local draft/read descriptors exist; no sender, provider, exporter, cleanup job, audit writer, or automation runner exists. |
| M7 | Not passed for the full consumer map. Three narrowed public fixtures compile; every absent owner doorway is explicitly coordinator-blocked rather than replaced locally. |
| M8 | Not applicable to the removed lookalike registries. The paved path documents only shipped stores/readers and the honest structural stops. |

## Fresh checks

- `npm run typecheck` — pass.
- `npm run typecheck:tests` — pass.
- Four focused foundation/round-trip/relay/manifest files — pass, 10 tests.
- Architecture boundary, English i18n snapshot, and flag-expiry files — pass, 9 tests.
- `npm run boundaries:check` — pass.
- `npm run lint:gate` — pass.
- Handle guard — pass.
- Token guard — pass.
- `npm run i18n:check` — expected repository-level red from inherited dynamic-key warnings; this lane adds no translation key and the English snapshot passes.
- Final unpiped `npm test` full-suite result — pass: 1,083 files / 8,667 tests;
  3 files / 29 tests intentionally skipped; no failed-file rerun was needed.

## Native / Part B status

Native/Rust touched: **NO**. Part B remains parked, unreserved, and awaiting a
coordinator/Jameson decision.
