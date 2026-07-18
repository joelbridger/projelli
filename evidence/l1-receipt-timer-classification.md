# L1 receipt timer classification

## Receipt failure

- Receipt commit: `457a44be8d46e3b81a3ab4332e99fabbc5905365`
- Comparison base: `974f34e2394ad7b4131557be5c9fa9b09de0322c`
- Machine receipt: `evidence/self-check-receipt-457a44be8d46.txt`
- Raw failed-step log (machine-generated, ignored by Git):
  `evidence/failed-step-gate:changed-457a44be8d46.log`
- Result: all 123 selected files and all 646 tests passed, followed by one
  unhandled `ReferenceError: localStorage is not defined`.
- Stack: `expandAllFolders` in `src/platform/fs/workspaceStore.ts`, called by
  the 100 ms timeout in `src/App.tsx`, while
  `src/features/audit/auditWrite.app.test.tsx` was being torn down.

## Base-commit reproduction matrix

The 123 file names selected by the failed receipt were extracted from its raw
log. Those same file names were then run from a detached worktree at the exact
base commit. The base has 641 tests in those files; the branch adds five.

| Run | Commit | Selection | Result | Duration |
| --- | --- | --- | --- | --- |
| Focused | `974f34e23` | `auditWrite.app.test.tsx` | 1 file, 4 tests passed; exit 0 | 6.80 s |
| 1 | `974f34e23` | Same 123 files as receipt | 123 files, 641 tests passed; exit 0 | 63.50 s |
| 2 | `974f34e23` | Same 123 files as receipt | 123 files, 641 tests passed; exit 0 | 70.61 s |
| 3 | `974f34e23` | Same 123 files as receipt | 123 files, 641 tests passed; exit 0 | 85.79 s |
| 4 | `974f34e23` | Same 123 files as receipt | 123 files, 641 tests passed; exit 0 | 86.83 s |

The late exception did not recur in these base runs. That confirms its flaky,
timing-dependent nature rather than a stable test failure.

## Code-origin proof

The three files on the failing stack have identical Git object IDs at the
base and receipt commits:

| File | Base object | Receipt object |
| --- | --- | --- |
| `src/App.tsx` | `bbb2c2fd432d7f77afe86683ce756b3c05ccb915` | `bbb2c2fd432d7f77afe86683ce756b3c05ccb915` |
| `src/platform/fs/workspaceStore.ts` | `a3b71e121e14c06447d396b48baff5567185eeb9` | `a3b71e121e14c06447d396b48baff5567185eeb9` |
| `src/features/audit/auditWrite.app.test.tsx` | `1ddb899165681c6ba6fdde258b7f10bc7f755484` | `1ddb899165681c6ba6fdde258b7f10bc7f755484` |

`git diff --exit-code 974f34e23 457a44be8 --` for those three files exited
0. The uncancelled timer and the test teardown behavior therefore pre-date
this branch. The branch exposed an existing intermittent leak; it did not add
the leak.

## Disposition

No test, timer, or workspace-store code was changed or silenced in this fix
round. The pre-existing teardown leak should be handled in its separately
routed ticket.
