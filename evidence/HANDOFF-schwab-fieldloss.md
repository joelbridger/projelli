# Lane v1/w2-schwab-fieldloss-fix — HANDOFF

**Lane:** v1/w2-schwab-fieldloss-fix (Opus builder lane; correctness/data-loss routing)
**Base:** 5d472f689950f26de6e7eb9f48ce71303c5a6964 (combined/merge tip)
**Code commit (final):** 97121c2fc9b5
**Receipt:** evidence/self-check-receipt-97121c2fc9b5.txt — overall GREEN @ 97121c2fc9b5
**Worktree:** /home/jameson/v1-w2-schwab-fieldloss-fix

## Defect (confirmed, fixed)
`SchwabPrefillReview.tsx` controlled field inputs (`value={field.value}`) are backed by
`fields` state. An effect re-seeded `fields` from `withState(buildSchwabProposal(...))`
whenever the derived `proposed` reference changed — which happens when async
`listMasked` facts resolve, OR when a parent re-render hands a new `household` prop
object reference. It blindly replaced the whole array, silently discarding whatever the
advisor had already typed. Real advisor data loss; also the root of the flaky
`reports an audit stall and does not create a receipt` test (a re-seed racing the
typed value back to empty).

Secondary vector fixed: the load effect had `t` in its dependency list, so when the
i18n language pack became ready mid-session the effect re-ran `setFields([])` and
reloaded, wiping typed data. `t` is now read via a ref; the effect keys on
`household.id` only.

## Fix (component made deterministic — alarm NOT silenced)
Dirty-tracking merge. `dirtyKeysRef` records every field the advisor personally touches
(set in `update`, `choose`, and the confirm checkbox). The seed effect now:
- on a genuine CONTEXT change (household id or account type) → resets dirty set and
  re-seeds fully (correct: a different form);
- otherwise (same form, async/prop re-seed) → preserves every dirty field's
  value/source/conflict/confirmed and only refreshes UNTOUCHED fields one-way from the
  proposal. Prefill still works; edits are sacred.

## Original alarm: still gated + green (coordinator directive honored)
`reports an audit stall and does not create a receipt` is unchanged, UNSKIPPED, in the
normal gated path (no `.skip`/`.only`/move). It passed in all 20/20 determinism runs.
The suite is deterministic because the COMPONENT is deterministic, not because the test
was weakened.

## Determinism proof
- New load-bearing tests: `preserves an advisor-edited field when an async household
  re-seed lands mid-edit` and `keeps advisor edits through repeated async re-seeds`.
- Proven load-bearing: with the component fix reverted, both new tests FAIL (2 failed);
  with the fix, all 8 pass.
- 20x loop of the full file: **20/20 green** (8/8 tests each run).

## Checks
- tsc --noEmit: PASS (0)
- tsc -p tsconfig.test.json: PASS (0)
- eslint (changed files): clean
- boundaries:test: 5/5 PASS
- self-check receipt: overall GREEN (gate:changed 157/157, typecheck, typecheck:tests,
  handle-guard, arch-dag-guard, i18n-snapshot, focused 8/8 — all PASS)

## Cross-pollination (same defect class: async/prop re-seed of controlled form state, no dirty guard)
Audited 14 named surfaces + extra grep hits. Verdicts:

SAME-BUG (should be fixed before they gate — a follow-on lane, not this one):
- `src/features/crm-connectors/EmailDropboxSurface.tsx` — `config` (useState ~68) backs
  controlled inputs (~196-198); effect ~75-82 re-seeds `setConfig(savedConfig)` on
  `[savedConfig]` (a live.records-derived record); a late records load or later
  `live.save` rebuild hands a fresh `savedConfig` and overwrites what the advisor types.
- `src/features/crm-clients/extensions/custom-fields/CustomFieldsSection.tsx` — `values`
  (useState ~92) backs `value={values[field.id]}` (~150); effect ~96-99 re-seeds
  `setValues(persistedValues)` where `persistedValues` is memoized on the `household`
  prop; a new household reference re-runs the effect and clobbers unsaved edits (the raw
  object in deps defeats the content signature). No dirty guard.
- `src/features/intake/NudgeReviewModal.tsx` — `body` (useState ~138) backs
  `value={body}` (~466); effect ~142-169 re-seeds `setBody(nextDraft.bodyText)` on
  `[open,row,intake,now]`; caller passes a live-store `intake` whose reference changes
  when the intake updates while the modal is open → overwrites the advisor's edited body.
  (Its own `isStale`/regenerate UI confirms auto-reseed is exactly what shouldn't happen.)

SUSPECT (verify before shipping):
- `src/features/crm-firm/FirmSetup.tsx` (RecordValues subcomponent) — `draft`/`tagIds`
  (~192-193) back controlled inputs; effect ~199 re-seeds on
  `[recordId, selected?.updatedAt, field-ids]` with no dirty guard. Intended trigger is
  the recordId context switch, but a live.records reload bumping the selected record's
  `updatedAt` (concurrent save/sync) or a mid-edit field-catalog change re-seeds and
  clobbers unsaved edits. Other FirmSetup editors use once-only initializers and are safe.

SAFE (10): CrmActivitySurface, HouseholdConnectorSurface, MergeHeaderAction,
TaskTemplatesAdminSettings, TaskTemplateLibrary, FormBuilderEditor (prop keyed on stable
selection), RequestFromClientDialog (generation-fenced + open-reset), 
DocumentExtractionProposalCard, NudgeDraftCard (read-only preview, nothing to type),
TemplateLibraryPanel. Extra grep hits also SAFE: email/ComposeModal,
matters/NewClientDialog, matters/NewClientGroupDialog (all reset only on dialog `open`).

## Notes / landmines
- The fix is UI-local: no foundation/store change was needed (no STOP condition hit).
- Do not remove the two new determinism tests; they are the regression guard and are
  proven load-bearing.
- Independent Sonnet review (data-loss focus + 20x probe) still to run per the brief.
