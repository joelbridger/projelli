# Data-loss cross-pollination handoff

## Code

- Code commit: `b28dc9e1dd7b` (`fix(crm): preserve advisor edits during live re-seeds`)
- Approved base: `fdf59ef968bd`
- No shared store or foundation change was needed.

## Fixed surfaces

1. `EmailDropboxSurface.tsx`: a refreshed live configuration record replaced controlled mailbox settings. Each user-edited configuration key is now dirty-tracked and preserved across live-record refreshes. This screen has one fixed per-advisor configuration context, so there is no client/record selector to reset.
2. `CustomFieldsSection.tsx`: a new household prop object re-seeded all values. Dirty field IDs survive same-household refreshes; a different household ID clears the dirty set and fully seeds its values.
3. `NudgeReviewModal.tsx`: a refreshed row/intake prop re-ran async drafting and replaced the editable email body. The body survives updates within the same open intake; switching intake ID or opening a new modal session fully resets it. Explicit regenerate is intentionally a user-requested reset.
4. `FirmSetup.tsx` `RecordValues`: confirmed SAME-BUG, not safe. `selected.updatedAt` and field catalog updates re-seeded drafts. Dirty custom fields and tags now survive same-record updates, while changing record ID fully resets the form.

## Regression proof

Each added test edits a controlled value, re-renders with an updated source in the same context, and proves the edit survives. The custom-fields, nudge, and firm tests also switch to another context and prove the new source value wins. The email dropbox test exercises ten live-refresh cycles internally. The four focused test files were run as a suite ten consecutive times: all 10 runs passed, with 4 files and 18 tests each run.

## Checks

- `npm run typecheck`: PASS
- `npm run typecheck:tests`: PASS
- Focused Vitest: PASS (4 files, 18 tests)
- `npm run boundaries:test`: PASS (5/5)
- Receipt attempt 1: RED; it found real TypeScript issues in the new fixtures, which were fixed before amending the code commit.
- Receipt attempt 2: INCONCLUSIVE under shared-machine load. Its changed gate exceeded the receipt's 300-second limit; every later receipt step passed, including both typechecks and focused tests. Receipt: `evidence/self-check-receipt-b28dc9e1dd7b.txt`.

Do not treat the receipt as green. The next coordinator may re-run the changed gate in a quieter window and replace this inconclusive receipt only if it obtains a green result.
