# Task foundation round-trip test harness

## Bound code and receipt

- Final code commit: `cdaeb99fb020f1c66457112003173d986cd99042`
- Approved additive base: `daf4c88c8af3bf1d369f44560682b3fb7fa047af`
- Machine receipt: `evidence/self-check-receipt-cdaeb99fb020.txt`
- Receipt result: `overall: GREEN`
- Push, merge, and Cargo: **not run**

## Additive result

- Tests can import `roundTripTaskRecord` from the test-only public entry point
  `@/features/crm-tasks/testing`.
- The helper creates through `useTaskRecordStore`, discards the writer, mounts
  a fresh reader, and returns the task recovered through `crm_live_list`.
- Item 11 of the work-management paved path includes a minimal example and
  explicitly rejects clone/save-echo proofs.
- The harness self-test makes the save response differ from canonical stored
  data, then proves the returned snapshot contains the stored value.
- Existing task behavior, stores, routes, registries, tests, and exports were
  not reshaped.

## Final-code checks

- Changed gate: PASS — 1,031 test files passed; 8,474 tests passed.
- Typecheck: PASS.
- Test typecheck: PASS.
- Handle guard: PASS.
- Architecture boundary guard: PASS.
- English language snapshot guard: PASS.
- Foundation-focused suite: PASS — 16 files, 61 tests.
- Machine receipt: `overall: GREEN`.

The first uncommitted receipt attempt caught one loaded-machine timeout in
`SettingsSurfaceFlagGate.integration.test.tsx`; its lazy Settings content stayed
on the loading spinner for the test's one-second wait. That exact test passed
alone in 732 ms, and the complete suite passed in the final receipt rerun. The
timeout test does not import or exercise the task harness.

## Attestations

1. **Fresh checks:** every final result above was run after the last code edit
   and against `cdaeb99fb020f1c66457112003173d986cd99042`.
   `[attest: yes + cdaeb99fb020f1c66457112003173d986cd99042]`
2. **Scope:** every product touch is one of two new test-harness files, the
   requested Item 11 paved-path addition, or its changelog entry; this file and
   the machine receipt are evidence only. `[attest: yes]`
3. **Guard integrity:** no test, guard, assertion, type, timeout, snapshot,
   baseline, or manifest was weakened, and no suppression was added.
   `[attest: yes]`
4. **Round-trip contract:** the helper uses the public task store and canonical
   live-record route, destroys the writer before opening a fresh reader, and its
   self-test proves the returned value came from reload rather than the save
   response or a clone. `[attest: yes]`
