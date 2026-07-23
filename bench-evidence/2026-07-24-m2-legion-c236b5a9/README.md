# M2 Legion evidence — c236b5a9

## Verdict

**M2: PARTIAL. M3 and M5: NOT RUN.**

The real unsigned development build opened on Legion's logged-in desktop. The
fresh built-in Hendricks sample selected the client, listed the completed July
2 annual review in Meetings → Past, and opened its Summary.

**First blocker: M2.2.** The real Summary screen said **“Sign in before making
this note private.”** No verified signed-in owner was available in this fresh
run. The private note was not created, no identity was invented, and the run
stopped before persistence, sign-out, Send to team, M3, or M5.

## Build continuation

This is a monitor/drive continuation, not build attempt two. The original
monitor job was `20260723-144123-cziaxxxx`; this continuation is
`m2-legion-c236b5a9-resume-20260724`. The original marker was present and the
same PowerShell → Node → Cargo → Rust → NSIS process family was watched until
its own result appeared. `one_build_count` is **1** and no retry ran.

The result file recorded exit `254`. Its only captured error was PowerShell
treating Tauri's informational version-check output as a `NativeCommandError`.
The native Rust executable and NSIS installer were both produced, so this is a
usable **unsigned development/package-partial** artifact, not release proof.
Both files are not digitally signed.

## Exact identity

| Item | SHA-256 |
| --- | --- |
| Source archive `D:\\LanternM2Sources\\lantern-c236b5a9.tar` | `25c982e7e641263768514d30cb96620febf84aa9276dd26fd53dead7d19a7231` |
| Built executable | `a92509484effe0d5903ac05eacd17a03273bb6f7d6193f967fafb2e9908af49f` |
| NSIS installer | `425a388f0bbafa06dc5cb2d31709bdb57ba2de64d9dfde20760e6fcf8448f8eb` |
| Exact executable launched in the logged-in desktop (PID 150584) | `a92509484effe0d5903ac05eacd17a03273bb6f7d6193f967fafb2e9908af49f` |

The full machine-bound receipt, assertion states, process lineage, and image
hashes are in [receipt.json](receipt.json). Run `python3 verify.py` to validate
the evidence fail-closed.
