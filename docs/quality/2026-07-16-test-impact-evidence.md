# Test-impact evidence — 2026-07-16

The selector was run against three real recent `merge/combined` lane merges. Each run used `scripts/test-impact-run.mjs`. The wrapper starts from the full Vitest command and narrows only after successful, non-empty selection. Runtime-discovered dependencies currently exist in the repository, so all three runs correctly keep the full suite; this document now records a safety baseline, not an adopted speed claim.

| Merge | Selection | Safety result |
| --- | --- | --- |
| `19d016a6c` directory-composition seam | full suite | runtime-discovered dependency present |
| `76066dc69` audit-write seam | full suite | runtime-discovered dependency present |
| `c601443f0` CRM shell | full suite | runtime-discovered dependency present; the path-read boundary test is included |

The full logs are `/tmp/gate-19d016a6-051438.log`, `/tmp/gate-76066dc6-050224.log`, and `/tmp/gate-c601443f-043338.log`. The affected-only command output was saved during this audit under `/tmp/test-impact-<merge>.run.log`.

The test selection uses the current integration-tip dependency graph and each merge’s real parent-to-merge diff. That is conservative for older merges: later code can only add dependencies to the mapping, never make the recorded selected run look smaller by hiding a dependency.

The 2026-07-16 rerun confirmed these three selector results. One real wrapper launch also reached unfiltered Vitest, then encountered the already-known missing `intake-page` PDF-worker dependency and continued beyond the prior full-gate duration; it was stopped rather than leave a stuck environment check running. This does not replace the authoritative periodic full gate. A future review may recover a safe affected-only speedup after every runtime dependency class is modeled or independently covered; it must not adopt the prior timing claim.
