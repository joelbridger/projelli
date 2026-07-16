# Proposed affected-only Vitest adoption

This branch does **not** change `merge-gate.sh`. It supplies a separately reviewed tool for the coordinator to adopt through the receipt-lock ceremony.

## Exact proposed substitution

In the merge gate's existing Vitest step only, replace the broad Vitest invocation with:

```bash
node scripts/test-impact-run.mjs --range "$MERGE_BASE..HEAD"
```

`$MERGE_BASE` must be the exact pre-merge integration commit already recorded by the receipt-lock gate. The tool returns a list of tests whose static local import graph reaches a changed local module or imported artifact, plus the named always-run set in `scripts/test-impact-always-run.json`.

It deliberately fails open: the wrapper begins with the complete Vitest suite and narrows it only after a successful, non-empty selector result. Any selector exception, nonzero exit, timeout, empty output, unreadable diff, deleted/renamed local module, unresolved local import, runtime-discovered import, runtime filesystem scan, or malformed manifest runs the complete Vitest suite. Static `readFileSync`/`existsSync` paths assembled from literals and `node:path` are included as dependency-graph edges. Configuration and test-impact-tool edits are also hard-coded full-suite triggers.

The surrounding merge-gate steps remain unchanged. In particular, the architecture, i18n, client-boundary, consent, egress, flag, and handle-adjacent Vitest tests are in the always-run manifest; the existing permanent-handle command and Golden Loop command still run as their existing separate steps.

## Full-gate authority stays in place

The receipt-lock merge gate remains the sole authority allowed to push. The scheduled periodic FULL gate continues to run `npx vitest run` with no selection and runs the rest of `scripts/gate.sh` unchanged against the integration tip. A fast lane result is therefore never the only source of truth for the combined tip.

## Adoption checklist

1. Independently review this branch and its evidence.
2. Run `node --test scripts/__tests__/test-impact.test.mjs` and `npm run typecheck`.
3. Confirm the tested script bytes are the exact bytes being adopted.
4. Change only the one merge-gate Vitest invocation above; do not alter receipt-lock or periodic-FULL scheduling.
