# Test-impact evidence — 2026-07-16

The selector was run against three real recent `merge/combined` lane merges. Each run used `scripts/test-impact-run.mjs`, which first builds the static local import graph and then passes exactly its selected file list to Vitest. The full-suite comparison is the saved gate log for that same integration merge.

| Merge | Selected files / full files | Selected tests | Selected wall time | Full-suite tests and wall time | Time saved |
| --- | ---: | ---: | ---: | ---: | ---: |
| `19d016a6c` directory-composition seam | 45 / 1,014 | 257 | 44.39s | 8,433 / 229.60s | 185.21s (80.7%) |
| `76066dc69` audit-write seam | 22 / 1,014 | 140 | 27.25s | 8,429 / 332.29s | 305.04s (91.8%) |
| `c601443f0` CRM shell | 100 / 1,014 | 588 | 84.72s | 8,421 / 404.37s | 319.65s (79.0%) |

The full logs are `/tmp/gate-19d016a6-051438.log`, `/tmp/gate-76066dc6-050224.log`, and `/tmp/gate-c601443f-043338.log`. The affected-only command output was saved during this audit under `/tmp/test-impact-<merge>.run.log`.

The test selection uses the current integration-tip dependency graph and each merge’s real parent-to-merge diff. That is conservative for older merges: later code can only add dependencies to the mapping, never make the recorded selected run look smaller by hiding a dependency.

These timings do not replace the authoritative periodic full gate. They demonstrate the lane-gate speedup only; the periodic full gate remains responsible for proving the combined tip.
