# WB-039 task-priority parity result

- Branch: `v1/task-priority-parity`
- Verified base: `8118b12cca5f05892e1418c254818268795694e8`
- Fix-round starting tip: `eaca895c23ab01cc5357d41cc713256961820deb`
- Receipt-bearing final-tip SHA and clean-status proof:
  `git notes --ref=verification show HEAD`
  (the verification note is attached only after this receipt is committed and
  the checks are rerun, so it can record the commit's own SHA without a false
  self-reference)
- Pushed/merged: no/no

## Result

PASS for the builder-owned outcome, including strict-review findings 1-3.

The task list shows High, Normal, and Low as compact urgency badges with both
readable words and distinct ▲, ◆, and ▼ shapes. Colour reinforces the signal
but is not its meaning. In the editor, the native select reflects the draft,
while the adjacent urgency marker reflects the saved task. A cancelled edit or
failed/pending save therefore cannot claim an urgency that was never stored.

No priority model, enum, store, migration, preference, or alternate save path
was added. Legacy records with no stored priority still project as the existing
`normal` default.

## Real save and reload proof

`Tasks.priority.test.tsx` no longer mocks `useLiveCrmRecords`, supplies a fake
`onUpdateTask`, or hand-builds a UI projection from a store reader. It mounts
`CrmHome` on the Tasks route with the production `LiveCrmHome` adapter. Only the
native Tauri command boundary is replaced by an in-memory encrypted-store
stand-in, as in the repository's other live persistence tests.

The test begins with a canonical legacy task whose priority is absent. The
production projection displays Normal. A keyboard-capable native select edit
changes the draft to High while the saved marker remains Normal. Pressing the
real Save button drives `adapter.actions.updateTask`, `mergeCrmTaskRecord`,
`crm_live_upsert`, and a later `crm_live_list`. The whole screen is then
unmounted and freshly mounted; only the canonical reload can make the reopened
marker display High.

A separate cancellation assertion changes the draft to High, confirms the
saved marker stays Normal, closes without saving, and confirms the list still
shows Normal. Assertions were strengthened; none were weakened or removed to
make the suite green.

## Accessibility proof

The focused suite proves:

- list markers have the accessible names `High priority`, `Normal priority`,
  and `Low priority`;
- their visible contents are `▲High priority`, `◆Normal priority`, and
  `▼Low priority`;
- each task's keyboard-openable button includes the same priority words in its
  accessible name;
- the native select receives focus and its accessible name changes from
  `Task priority: Normal priority` to `Task priority: High priority`; and
- the adjacent status remains `Normal priority` until canonical save/reload,
  preventing a false saved-state announcement.

## Final-tip verification

The exact final SHA, the clean `git status --short` result after the receipt
commit, and the fresh command outputs are stored in the attached verification
note named above. The required commands are:

```text
npx vitest run src/features/crm-tasks/Tasks.priority.test.tsx
npm run typecheck
npm run typecheck:tests
npm run boundaries:check
npx vitest run tests/unit/architecture-boundaries.test.ts
git diff --check 8118b12cca5f05892e1418c254818268795694e8..HEAD
git status --short
```

No suppressions, skips, snapshots, or baseline updates were added.

## Scope attestation

The runtime change is one value binding in `Tasks.tsx`: the editor badge now
reads the saved task priority instead of the draft priority. The focused test
and this result receipt are the only other changed files. Shell, routing,
client/matter selection, workflows, flags, locales, native/Rust code, stores,
and migrations are unchanged.

Independent review remains coordinator-owned. The design screenshot review may
rerun on this final tip; the visual treatment itself was not changed in this
fix round.

WORKER-DONE: v1/task-priority-parity fix round ready for review
