# Final command results

Implementation commit checked: `54884dd2152c70eae1001b695e55852fc1bea22d`.

Commands re-run after the final implementation edit:

```text
npm run gate
npm run typecheck
npm run typecheck:tests
node scripts/ui-system/handle-guard.mjs
npx vitest run src/features/crm-projects/internal/internalProjects.test.tsx src/features/crm-home/registry.test.ts --reporter=verbose
npx vitest run tests/unit/i18n/en-json-snapshot.test.ts --reporter=verbose
```

Results:

- `npm run typecheck`: PASS.
- `npm run typecheck:tests`: PASS.
- Handle guard: PASS — 64 frozen handles, no vanished or ambiguous handle.
- Focused Vitest: PASS — 2 files, 5 tests.
- i18n snapshot: PASS — 1 file, 5 tests; 25 catalogs and 2,941 keys complete.
- Full gate: RED for pre-existing environment resources outside this TS-only lane.
  - First, `intake-page/node_modules/pdfjs-dist` was absent. The nested
    dependencies were installed immediately afterward, but that first full run
    had already recorded its failure.
  - The remaining native build, Rust test, and golden-loop steps cannot find
    `src-tauri/binaries/piper-x86_64-unknown-linux-gnu`. No Rust or resource
    file was touched by this lane, and the task explicitly reserves no cargo
    work for it.
  - The gate's frontend suite otherwise reported 978 passing files / 8,294
    passing tests; the sole failed suite was the intake hosting test caused by
    its missing dependency before installation.

Raw terminal output was captured during the run; this committed summary records
the exact commands and final, reviewable outcome without adding a transient log
file as product source.
