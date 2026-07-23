# Legion corrective Windows evidence — `897640c95` R2

## Verdict

- **Package build: FAIL.** The one permitted R2 task wrote its marker and returned exit code `1` in `0.0262136` seconds. It produced neither an executable nor an installer. The command’s redirected log file was never created. This is a **build-invocation/tooling failure**, not a tested app failure.
- **M2: NOT RUN.** No package existed to launch.
- **M3: NOT RUN.** M2 was not passed.
- **M5: NOT RUN.** M3 was not passed.
- **Product: NOT TESTED.** No product assertion, screen, email action, CRM write, task approval, Ask request, or screenshot occurred.

## First blocker and exact stop point

The R2 marker was written at `2026-07-23T06:37:49.2891295Z`. The single command recorded as `npm run tauri:build` then returned `1` at `2026-07-23T06:37:49.3193517Z`, before Node, Cargo, or rustc appeared in the direct process check. There was no `build.log`, no package file, and the scheduled task naturally settled to `Ready` with result `1`.

The immediate cause is the R2 harness command form `cmd.exe /c "npm.cmd run tauri:build > \"$log\" 2>&1"`. Windows did not create the requested redirected log, and the receipt shows no compiler or artifact. The lane stopped there. It did not retry, stop a task, stop a process, delete a task, send mail, modify data, or drive the app.

## Exact identities

| Item | Value |
| --- | --- |
| Machine | `DESKLINK129887` / `DESKLINK129887\james` |
| Accepted app revision | `897640c95d50f14400fe0868904f5da3f11aa9fb` |
| Accepted source tree | `163d6fe1a81941ba3023552130559a5949b95ee6` |
| Deterministic archive SHA-256 | `a7e856b35840aa40aa416558ff0d7927e167f94d6313b1464029f7bfdbd796f5` |
| `package.json` SHA-256 | `192f9b6e8237344fe730d4dcf058759bd3b0457664501f3fa1f0b351f380e012` |
| Tauri config SHA-256 | `6d270bb49caebbd0d685efa9ac8ffbb4a74bd1eb8e4da71d9767f0e699772608` |
| Fresh R2 root | `D:\Lantern-M2-M3-M5-897640c95-R2` |
| One-build count | `1` |
| Sidecar source | verified hash-keyed local mirror; 446 files copied and re-hashed |
| Cache claim | none |

The four approved V1 flags were all `true`: selection authority boot gate, Meetings shell V1, shared client bar, and V1 shell frame.

## Attempt-one correction record

Attempt one is **OPERATOR-ABORTED / PRODUCT-NOT-TESTED**, never an app or build failure. Its faulty CIM query and false conclusion are preserved verbatim in [BENCH-TOOLING-DEFECT.md](BENCH-TOOLING-DEFECT.md). The original log contains no independent `Get-Process cargo,rustc` capture from the historical moment; pretending otherwise would be false. The approved corrective instruction itself records that Cargo and rustc were active. This R2 lane used only direct `Get-Process cargo,rustc,node,powershell,sccache` checks for liveness.

## Evidence map

- `remote-receipts/` contains copied machine receipts, the marker, and the task-state capture.
- `stage-pinned-sidecars.ps1` records every explicit sidecar copy and destination hash check.
- `build-once.ps1` is the exact R2 one-build task script whose failed redirection is recorded above.
- `screenshots/` is intentionally empty: no named product assertion was reached.
- `GALLERY.md` lists the honest no-screen state.

Run `python3 bench-evidence/2026-07-23-m2-m3-m5-legion-897640c95-rebuild/verify.py` for the local fail-closed check.
