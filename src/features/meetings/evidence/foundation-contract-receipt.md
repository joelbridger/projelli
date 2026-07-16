# Meetings foundation contract receipt

## Scope

Part A only. The public `@/features/meetings` doorway now provides local
meeting records, append-only artifacts, notice-evidence projections,
client-bounded approved-artifact readers, validated type/template/settings
catalogues, and appendable composition registries. It uses the canonical
encrypted live-record save and fresh-reload route.

No Part B work is included: no recording/capture, microphone access, spoken
audio-playback claim, transcription/diarization engine, model/provider call,
email delivery, export, automation execution, retention cleanup, audit write,
native command, Rust change, migration, or command-manifest change.

## Public-import proof

The following outside-module fixtures import their exact registry/type from
the public Meetings index:

- `meetingPanelRegistry.import.ts`
- `meetingHeaderActionRegistry.import.ts`
- `meetingInsightRegistry.import.ts`
- `meetingListRegistry.import.ts`
- `meetingListToolRegistry.import.ts`
- `meetingArtifactRegistry.import.ts`
- `noticeEvidenceProviderRegistry.import.ts`

The current tip does not publicly export the required Settings and CRM-clients
registry contracts. Per the seam brief, their dependent mounts remain blocked;
this foundation does not recreate those owner registries.

## Acceptance evidence

| Line | Result |
| --- | --- |
| M1 | Pass in focused contract test: canonical-port save/reload and unknown-field-preserving patch. |
| M2 | Pass: append-only notice evidence projects only shown/confirmed/attached-statement local facts. |
| M3 | Contract exported: versioned artifact kinds and read-only consumers; dependent diarization/talk-time lane remains separate. |
| M4 | Pass: approved artifact source adapter limits results to the exact household and matter. |
| M5 | Pass in focused contract test: validated type and template catalogues save through the same reload path. Visibility remains declared-policy input only. |
| M6 | Pass by contract boundary: only local deferred descriptors exist; no sender, provider, exporter, cleanup job, or automation runner exists. |
| M7 | Pass: public fixture imports plus typecheck and feature-boundary check. No foundation UI or flag was added. |
| M8 | Pass: paved path in `src/features/meetings/SKILL.md`; registry test includes a genuine third contribution, ordering, duplicate/malformed rejection, and dark exclusion. |

## Checks

- `npm run typecheck` — pass.
- `npm run typecheck:tests` — pass.
- `vitest run src/features/meetings/foundation/contract.test.ts` — pass, 6 tests.
- `vitest run tests/unit/architecture-boundaries.test.ts tests/unit/i18n/en-json-snapshot.test.ts src/platform/flags/expiry.test.ts` — pass, 9 tests.
- `npm run boundaries:check` — pass.
- Touched-file ESLint — pass.
- `node scripts/ui-system/token-guard.mjs` — pass; no new hard-coded colour.
- `node scripts/ui-system/handle-guard.mjs` — pass; no permanent or ambiguous handle regression.
- `npm run i18n:check` — red on pre-existing dynamic-key warnings elsewhere in the app; this contract adds no translation key.
- One `npm test` full-suite run was started and completed under the shared four-worker test slot. Its terminal wrapper did not retain the final exit line, so this receipt intentionally records the result as unavailable. It was not retried.

## Native / Part B status

Native/Rust touched: **NO**. Part B remains parked, unreserved, and awaiting a
coordinator/Jameson decision.
