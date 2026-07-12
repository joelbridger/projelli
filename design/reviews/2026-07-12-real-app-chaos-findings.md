# Real-app chaos findings — 2026-07-12, round 2

## Verdict: RED

`npm run test:chaos` now launches the real desktop app, reaches the mounted
CRM screen, gives every case its own on-disk encrypted workspace, and sends
`SIGKILL` to the actual Lantern process rather than merely stopping its shell
launcher. Test-mode only skips the native folder-picker welcome screen; before
any CRM read or write, the mounted screen is pointed at the case's real
workspace. No CRM store, Tauri command, or crash boundary is mocked.

The suite remains deliberately red. A green result is not justified until all
eight boundaries below are proved in the running app.

## What ran

The named scenarios were run twice on 2026-07-12.

The first complete run reached every scenario. One result passed:

| Scenario | Result | Exact result |
| --- | --- | --- |
| Client save requested, then SIGKILL | PASS | The app reopened the same encrypted workspace. The unconfirmed record was either absent or complete; it was never malformed. |

The other real-screen operations could not make a safe claim:

| Scenario | Result | Precise reason |
| --- | --- | --- |
| Client save confirmed, then SIGKILL | DATALOSS | The desktop bridge timed out while the confirmed-save assertion was running. The suite did not see a durable record, so it must not claim the visible “saved” result survived. |
| Task create, then complete, with SIGKILL at both boundaries | DATALOSS | The real-app evaluation failed at the desktop bridge (`eval@[native code]`). No complete-or-cleanly-absent task result was proved. |
| Migration import while records land | DATALOSS | The desktop bridge timed out before the interrupted import could be resumed and checked. No clean resumption claim is safe. |
| Propagation apply | DATALOSS | The visible Apply flow does not use the transactional boundary that commits workflow instance, immutable operations, activity, and notification intent together. A crash can split the workflow from its notification. |
| Offline edits queued, then crash and relay return | DATALOSS | The mounted CRM has no durable offline mutation queue plus relay acknowledgement that can be checked after relaunch. |
| Checkpoint/compaction, then SIGKILL | DATALOSS | There is no mounted CRM checkpoint or compaction operation to crash at and reopen. |
| Disk full and read-only workspace | DATALOSS | There is no deterministic real write-failure hook. Permission changes are not a disk-full test, so a loud, honest failure was not proved. |

The immediate repeat also reached all eight names and exited `1`. Its first
six cases all stopped at the desktop bridge's fixed five-second `eval` timeout,
despite the harness requesting a 30-second bridge budget; the final two
reported the same missing-boundary findings. This is an additional reliability
problem in the real-app test path, not evidence that data is safe. It does not
weaken any red finding above.

## DATALOSS release blockers

1. **DATALOSS: propagation can split the user promise.** Wire the screen's
   real Apply action to `crm_core_commit_propagation`, then kill it while the
   operation is in flight and prove the reopened store contains both sides or
   neither.
2. **DATALOSS: offline work has no durable queue proof.** Persist each queued
   edit before saying it is queued, retain its acknowledgement state, and
   prove delivery after a crash and reconnect.
3. **DATALOSS: checkpoint/compaction has no real-screen crash boundary.** Add
   a real operation and a visible recovery state; engine-only tests are not
   enough.
4. **DATALOSS: disk-full/read-only errors are unproved.** Add deterministic
   storage fault injection that reaches the real save screen and asserts a
   clear error without a false “saved” message.
5. **DATALOSS: the desktop bridge is not reliable enough to prove the first
   three persistence paths.** Its five-second JavaScript evaluation timeout
   can end a real assertion before the app answers. Fix the bridge deadline or
   expose a bounded, observable readiness signal, then rerun the confirmed
   client save, task, and import crashes until each yields a durable result.

Run with `npm run test:chaos`. Any `DATALOSS:` line is a release-blocking
integrity finding. It must be fixed and re-proved, never skipped or changed
to a passing assertion.
