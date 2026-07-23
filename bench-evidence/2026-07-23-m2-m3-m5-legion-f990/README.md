# Legion M2 → M3 → M5 evidence — f990b564

## Result

| Milestone | Verdict | What happened |
| --- | --- | --- |
| M2 | PARTIAL | Hendricks was selected in the fresh app and Meetings opened, but its real Past view said **“No processed meetings yet.”** The fresh workspace does contain the seeded annual-review files, yet no row was available to open. |
| M3 | NOT RUN | M2 did not pass, so no approval write was attempted. |
| M5 | NOT RUN | M3 was not run, so Ask was not attempted. |

**First blocker:** M2.1. The required seeded annual-review detail could not be opened from the real Meetings UI. The exact fresh workspace contained `Meetings/2026-07-02-hendricks-annual-review/meeting.json`, notes, and transcript, while the selected Hendricks Past screen showed no processed meetings. This is a real application/fixture-ingestion gap, not a fabricated pass.

No email was sent. No review/approval write was attempted. No retry build was run. No M3 or M5 action was attempted after the M2 blocker.

## Exact build and package

The source was exactly `f990b5647784bc3c31fa716a56fa760de845ee2c` (tree `537c26d642bf2cdbca3ce0ae5f4e5d2a48535792`). Its Git archive was SHA-256 `3df3cb77bd362a1d931bab1b3df812439322792db05bcd567eb0ff57b7ef23cf` (247,500,800 bytes), unpacked fresh at `C:\Lantern-M2-M3-M5-f990b564\source` on Legion.

Exactly one Rust/package build began after the one-build marker was written. It produced the executable and NSIS installer below, then correctly remained a **development/package partial** because the updater private signing key was unavailable. The missing key is a release failure, not a reason to rebuild.

| Item | SHA-256 |
| --- | --- |
| Release executable | `c433062ad247d77cdd1d32e1ac47fc94a248886fe5d497cbd835d5e0e064e82b` |
| NSIS installer | `dcf307e6d1989116a1332306ff8bfd90eb1663105060202ce56426e451ff3f20` |
| Packaged executable launched on desktop | `c433062ad247d77cdd1d32e1ac47fc94a248886fe5d497cbd835d5e0e064e82b` |

The build marker-to-installer time was 730.304 seconds. The prior cold marker-to-artifact marker was about 538.5 seconds, so this run was about 191.8 seconds slower. `sccache` 0.16.0 was configured at `D:\Lantern-sccache-cache` with a 25 GiB cap, but both visible statistics snapshots reported zero requests, hits, and misses. There is no observed cache speed benefit to claim.

## Desktop drive

The new package was launched by a scheduled task in Legion’s logged-in `james` desktop session. The OS desktop helper captured the original screenshots; no HTTP bridge or process reachability was used as app proof. The old prior-lane application (`C:\Lantern-M2-M3-51ee5bab\package\lantern.exe`, PID 81432) was already present and was not stopped. The new exact application was PID 111900 at `C:\Lantern-M2-M3-M5-f990b564\package\lantern.exe`.

The fresh profile was rooted at `C:\Lantern-M2-M3-M5-f990b564\profile`; the fresh synthetic workspace was `C:\Lantern-M2-M3-M5-f990b564\workspace\Hendricks`. Local-only AI was selected. Hendricks remained visibly selected and Whole Firm stayed closed.

The detailed, machine-bound facts and image hashes are in [receipt.json](receipt.json). [GALLERY.md](GALLERY.md) is the quick visual index. Run `python3 verify.py` to check this evidence fails closed.
