# Vitest flake audit — 2026-07-16

## Result

There are no active Vitest quarantines. The recent gate-log sweep found two already-landed fixes and two late-cleanup failures. The remaining cleanup risks are now covered by explicit test teardown; the three affected files passed together ten times in a row (30 file-runs / 160 test-runs), with no unhandled errors or React `act` warnings.

## What the logs showed

| Test / class | Evidence and root cause | Resolution |
| --- | --- | --- |
| `src/ui/kp/RailShell.test.tsx` | A virtualizer timer fired after jsdom had removed `window` (`/tmp/gate-0de59a7a-110858.log`). | Already fixed in `f4a614f2c`: drain pending virtual-rail timers before unmount. The landing recorded 20/20 successful runs. Included in today’s ten-run confirmation. |
| `SharedClientBarOwnership.test.tsx` | This was a cross-lane mock-shape mismatch, not random timing: a new registry export was absent from a complete module mock (`/tmp/gate-f346b814-040906.log`). | Already fixed in `fcd24cf0a` by using Vitest’s partial `importOriginal` mock. The next gate passed it. |
| `src/features/intake/__tests__/PhoneWalkthrough.test.tsx` | One historic full run ended with Radix FocusScope dispatching after jsdom teardown (`/tmp/gate-c4dcedcd-215617.log`). | The test now explicitly unmounts and gives that final timer turn a live DOM before teardown. |
| `src/features/crm-form-activity/FormActivitySurface.integration.test.tsx` | One historic full run reported a late `tasks.map` render after the test had completed (`/tmp/gate-bff741b9-200939.log`). The test had been resetting the shared flag before its mounted CRM reader was closed. | The test now closes the tree, waits one cleanup turn inside `act`, then resets the flag. |

The other recent red test entries were deterministic change-integration failures (flag cap, expected i18n snapshot, or architecture contract) and are not quarantinable flakes.

## Confirmation command

```bash
for run in $(seq 1 10); do
  npx vitest run src/ui/kp/RailShell.test.tsx \
    src/features/intake/__tests__/PhoneWalkthrough.test.tsx \
    src/features/crm-form-activity/FormActivitySurface.integration.test.tsx \
    --reporter=dot
done
```

All ten runs passed: 3 files and 16 tests each. No test is skipped, and no quarantine manifest is needed. If a future intermittent failure cannot be repaired quickly, it must be added as an explicit owner-and-expiry entry before any `skip` is introduced.
