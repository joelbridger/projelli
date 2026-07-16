# Test-impact selectivity diagnosis — 2026-07-16

## Finding

The 1,014/1,014 result is not a real registry, i18n, setup, or public-index fan-out. `selectImpact()` builds one repository-wide graph, then immediately returns the complete suite when `graph.opaqueModules.size > 0`. Thus all selections flow through that one global safety condition before the changed lane is walked.

## One lane-shaped trace

For `ec42ef163..6780be2d0` (directory-composition), the measured reverse graph reaches 33 tests. The selector also always runs the reviewed 14-test floor and 28 tests that cover the remaining real runtime-discovery helpers. With overlap, the correct affected result is 70/1,014.

| Module | Edge kind | Walk branches entering it | What it connects |
| --- | --- | ---: | --- |
| `src/features/crm-clients/index.ts` | normal public re-export/import | 9 | CRM clients' public surface to direct consumers |
| `src/features/crm-clients/tabRegistry.ts` | normal import | 9 | household tab list to tab-feature tests |
| `src/features/crm-clients/recordRegistry.tsx` | normal import | 8 | record surface to direct consumers |
| `src/features/crm-clients/HouseholdRecordSurface.tsx` | normal import | 7 | record composition to direct consumers |

These are genuine local dependencies and reach 33 relevant tests, not the whole suite. Cutting their edges would omit consumers and is not justified by the always-run floor.

The same measured graph sizes for the other lanes are: record-member `37f29f741^..37f29f741`: 2 direct plus the 38-test combined floor = 40/1,014; bell-slot `a8457767b^..a8457767b`: 15 direct plus that floor, with overlap = 51/1,014.

## Why the global condition is permanently set

The current graph visit found 86 opaque modules. Many are false positives: the parser treats any method whose name is `readFile`, `readFileSync`, `exec`, or similar as a build-time source read. `src/App.tsx` is marked opaque for `workspaceServiceRef.current.readFile(path)`, `src/platform/fs/TauriFSBackend.ts` for `fs.readFile(absolutePath)`, and `src/platform/fs/tauriFsPlugin.ts` for `getTauriFsModule().readFile(path)`. Those are product runtime reads of user data, not source-file dependency reads. Because these modules are widely imported, their accidental opaque labels make the global abort permanent.

The path-read miss-class fix has a deliberately wider safety boundary: a test that reads a path reaching into `src/` through `node:fs`, `node:fs/promises`, `fs`, `fs-extra`, or a filesystem-shaped unrecognized binding is opaque and always runs. The parser retains a concrete reverse edge when it can prove one, but it never relies on that edge alone. This includes aliases such as `import { promises as fs } from 'node:fs'`. A test with no source dependencies and no dynamic/filesystem source access remains safe to skip; an invisible dependency is never treated as an empty dependency set. Unknown paths, directory scans, and spawned commands remain opaque too. Rather than making unrelated lanes full, the selector always includes every test that reaches each opaque helper. If an opaque helper has no reachable test, it still fails open to the full suite.

## Fix required by this diagnosis

Do not cut registry, i18n, setup, or public-index edges: no unsupported all-suite hub was found. Keep product data reads out of the Node-binding rule, but make any source-path filesystem read opaque at the boundary so unsupported bindings cannot silently appear safe. Keep the conservative runtime-helper coverage, the wrapper's full-suite fail-open behavior, and the path-read edge. Regression tests cover product methods that share a Node API name and the `node:fs` promises alias. Merge-commit ranges remain full-suite by design because their combined parent histories are not a single safe lane diff.
