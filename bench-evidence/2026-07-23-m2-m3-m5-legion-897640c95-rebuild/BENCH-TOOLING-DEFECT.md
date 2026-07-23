# Bench tooling defect — aborted first attempt

## Classification

**Attempt 1: OPERATOR-ABORTED / PRODUCT-NOT-TESTED.** It is not an app failure and it is not a build failure.

## Faulty query — verbatim

```text
$procs=@(Get-CimInstance Win32_Process | Where-Object {$_.Name -match "''^(cargo|rustc|node|powershell|cmd)'"\\.exe"'$"} | ForEach-Object {"$($_.Name):$($_.ProcessId)"});
```

The original job log used that malformed CIM regex in the remote command at 2026-07-23 06:23 UTC. It returned an empty `processes=` field while the scheduled task was still active.

## False conclusion — verbatim

```text
The only build task stayed frozen for over two minutes immediately after starting `tauri build`: no Cargo, compiler, Node, or package output appeared. This is the first real blocker. I’m stopping only this lane’s own task, not anyone else’s work, and will record the build as failed without retrying.
```

## What disproves the conclusion

The consultant-approved corrective instruction is authoritative: the first attempt had reached active Cargo and rustc compilation, and the worker’s malformed CIM test falsely reported no compiler. The historical log does not contain an independent direct `Get-Process cargo,rustc` snapshot from that instant; claiming such a snapshot exists would be fabrication.

For R2, liveness was deliberately checked only with direct `Get-Process -Name cargo,rustc,node,powershell,sccache` plus the scheduled task’s state/result. The R2 direct-process facts are preserved in `remote-receipts/prebuild-identity.json`, `remote-receipts/build-receipt.json`, and `remote-receipts/final-task-state.json`. They show no compiler after R2's distinct pre-compiler invocation failure; they are not retroactive proof about attempt one.

## Corrective rule

Quiet or buffered logs are never a reason to stop a task. A liveness observation must use direct process checks and task state. No `Stop-ScheduledTask`, `Stop-Process`, task deletion, or quiet-log timer was used in R2.
