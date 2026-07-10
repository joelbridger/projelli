# Wave 7 Lane 4 — Mandatory Cross-Lane Contract and Fixture Gate

**Branch:** `lp/intake-w7-contracts`, branched only after Lanes 1, 2, and 3 have all merged to one clean tip. Confirm the exact base commit with the dispatcher before starting.
**You are Codex, the builder.** Build the lane, run the checks, commit. Do NOT push. Do NOT merge. Do not send notifications or messages of any kind; never invoke `notify-jameson`.

## Goal (one paragraph)

Cross-lane contract breaks are the primary integration failure mode this program has seen (every wave's adversarial review has caught something a lane's own scoped tests missed). This lane is not optional and the wave is not ready for final review, benchmark, or release until it's green against the final merged tip. You're proving, with real code and real encrypted round trips — not mocks of the pieces under test — that a standing request created from a saved blueprint (Lane 2) actually reaches the relay with the right opaque, non-semantic shape (Lane 1), that ask-once actually suppresses a known answer end-to-end, that the Requests board and client tab (Lane 3) correctly show both an onboarding and a standing request for the same client without cross-contamination, and that a misdirected submission is rejected rather than mis-filed. You do not modify any production file — if you find a bug, you write a failing test that proves it and report it; you do not fix it yourself.

## Non-negotiables (a reviewer will check these)

- **No production file edits, period.** Test files and synthetic fixtures only. If a test reveals a real bug in a merged lane's code, do not patch around it — write the test to fail clearly, document the exact broken behavior and which lane's file it's in, and stop there. The wave lead decides whether that's a merge-blocking finding needing a fix round.
- Only synthetic names, values, and files in any fixture. No real client information, no real SSNs, no real license numbers, no actual custodial forms, no production form links.
- The contract test extends Lane 1's `src/platform/intake/__tests__/standingRequestContract.test.ts` (it already exists with a baseline round trip) rather than starting a parallel file — check what's already there before writing anything, and build on it.
- Every relay-visible payload assertion actually inspects the serialized HTTP body/URL your test's fetch mock receives — not the in-memory TypeScript objects before serialization. A contract test that only checks the pre-wire object would miss exactly the kind of leak this wave exists to prevent.

## Files you own

**Create only:**
- Extensions to `src/platform/intake/__tests__/standingRequestContract.test.ts` (Lane 1's file — read what's there first).
- `src/features/intake/__tests__/RequestsUiIntegration.test.tsx` (or match whatever naming convention Lane 3 used for its own test files — check `src/features/intake/__tests__/` before naming yours).
- `tests/fixtures/intake-standing-request/` — synthetic fixtures only.

Nothing else.

## The seven required cross-lane acceptance cases (verbatim from `W7-PREP.md` §4 Lane 4)

Each of these needs to be a real, runnable assertion, not a comment describing what should happen. Use the real `createAdvisorIntake` path (Lane 1, exercised through Lane 2's blueprint/composer helpers where the case calls for it), real `IntakeRelayClient` envelope shapes, real `IntakeSyncClient`, real `routeIntakeSubmission`, and the real `factsStore`/`intakeFactMatchList` test seam. Network transport may be mocked (same `getCorsSafeFetch` mock pattern Lane 1 used, matching `inboxSyncContract.test.ts`'s existing harness) — encryption, envelope shape, and routing logic may not be.

1. **A standing request created from a saved blueprint keeps its original local `matter_id`, gets a new request ID, a generated slug, and opaque relay item handles, and reaches the relay with the same ciphertext-only shape as onboarding.** Inspect the actual serialized create-request body your fetch mock receives; assert `matter_id` is absent (string-search the whole serialized body, not just a typed field check) and that no item's `item_id` in that body matches any of the blueprint's real fact-kind/subject strings (e.g. assert the string `'income_annual'` and `'ssn'` don't appear anywhere the relay would see them for a standing request's items).

2. **A known active fact removes its mapped question before the checklist is sealed.** Seed a synthetic active `income_annual` fact for a test `matterId`, build a standing request from a blueprint containing an income item, assert the sealed checklist that would be sent to the relay does not contain that item at all. Then seed a fact with a *different* subject (e.g. `'joint'` instead of `'primary'`) or mark the fact superseded, and assert the item is NOT suppressed in either case — a near-miss must not falsely suppress.

3. **The client completes a standing request through the encrypted path; the advisor decrypts it, files the document, and writes the fact correctly.** Full round trip: real sealed submission → `IntakeSyncClient` → `routeIntakeSubmission` → assert the file lands under `Requests/<standing-slug>/` (not `Requests/onboarding/`) and the fact is written with `channel: 'intake_link'`, the correct `matter_id`, and client-stated provenance.

4. **The same client can have an active onboarding request and a standing request at once; completing the standing request changes neither the onboarding checklist nor `Requests/onboarding/`.** Set up both requests for one `matterId`, complete only the standing one, assert the onboarding `IntakeRecord`'s items/status/received-items array is byte-identical before and after, and that no file was written under `Requests/onboarding/`.

5. **Cross-request/wrong-class submissions are rejected, not mis-filed.** A submission carrying the onboarding request's ID cannot satisfy a standing item, and vice versa. An unknown `item_id` (no match in `IntakeRecord.requestItems`), a JSON body against a `doc_upload`-class item, a file against a `typed_field`/`guided_question`-class item, a body-supplied `fact_kind`/`subject`/`response_format` that conflicts with what the matched item's own fields say, and an upload exceeding the matched item's `accepted_mime_types`/`max_files`/`max_bytes` are all flagged and remain **unacked** (assert no ack call reaches your mocked relay client for any of these cases).

6. **The Requests board and client tab render both requests correctly.** Mount Lane 3's board and client-tab components with one active onboarding request and one active standing request for the same client (real store state, not hand-waved mock data — use the real `intakeStore`/`getIntakesForMatter`). Assert the full board shows both rows; the Onboarding filter shows only the onboarding row; the client Requests tab opens with the correct request selected when navigated from each row, and each request's link controls operate on the correct request (interact with one request's control in the test, assert the other request's state is untouched).

7. **Relay-visible payload inspection proves no leakage for standing requests.** Across every relay-bound call your fixtures exercise (create, chunk upload, submit, inbox fetch), assert the serialized wire payload never contains: clear `matter_id`, a plaintext logical item ID matching any blueprint catalog entry, an item label, a blueprint name, an answer value, a file name, a fact value, or a request title. Assert standing item handles are opaque (not string-matchable to anything in the blueprint registry) — e.g. assert none of them appear as a `blueprintId`, item label substring, or `factKind` string anywhere in the blueprint registry Lane 2 built.

## Additional required test

- `tests/fixtures/intake-standing-request/`: build a small synthetic set (a fake "Annual review update" blueprint with 2-3 items including one guided-money item mappable to a fact, a fake client fact seed, a fake PDF/image file stand-in for the upload item — reuse whatever synthetic-fixture pattern Wave 3/4 used for their `tests/fixtures/intake-*` directories rather than inventing a new format) with a `manifest.json` describing what each fixture represents and what the expected routed outcome is. Wire these into the vitest suite above rather than inlining every fixture as literal strings in the test file — makes future extension easier and keeps the test file readable.

## Self-converge requirement

Run every case in the seven-item matrix plus the UI integration test and the fixture-wired suite until they pass. If a case genuinely cannot pass because of a real bug in a merged lane (not a bug in your test), that's an expected, valid outcome — do not force it green by weakening the assertion. Report exactly which case failed, why (with file:line pointing at the actual bug in the lane's merged code), and what the correct behavior should have been. That report is this lane's most important deliverable if it happens.

## Checks to run (report exact pass/fail for each; every test invocation wrapped in a timeout)

```
timeout 300 npx vitest run src/platform/intake/__tests__/standingRequestContract.test.ts
timeout 300 npx vitest run src/features/intake/__tests__/RequestsUiIntegration.test.tsx
timeout 300 npm run test:contracts
timeout 600 npm run gate:changed
```

If `test:contracts` or `gate:changed` don't exist or don't cover this lane's new files on the tip you're building against, fall back to:

```
timeout 300 npx vitest run src/platform/intake src/features/intake
timeout 120 npx tsc --noEmit
```

## Finish

Commit on `lp/intake-w7-contracts` with a conventional message containing the phrase `W7-LANE4-CONTRACTS`. Do NOT push. Do NOT merge. Report exact check results for all seven acceptance cases individually (pass/fail each, not just an aggregate), any real bugs found in merged lane code with exact file:line, and state the branch is clean.

The very last line of your output — after everything else, on its own line — must be exactly `DONE-EXIT:0` if every case you were able to test passed and the branch is clean and committed, or `DONE-EXIT:1` if a real bug in merged lane code blocked a case from passing (explain which, above that line — this is a valid and useful outcome, not a failure of this lane's own work). The dispatcher watches for this exact anchored line to detect completion; do not print it early, do not print it more than once, and do not let it appear anywhere in quoted/example text earlier in your output.
