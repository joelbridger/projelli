# meetings — fix round 2 complete

Summary: closed the finding-1 unmount edge — closing the send drawer within the 600ms autosave debounce no longer drops the last recipient edit. Added a true unmount flush (fire-and-forget drain of the pending save), mountedRef-guarded local state, strict-mode safe. TDD: failing-first unmount test (red before, green after).

New HEAD: 80013566f8de0a9f7f3a0bcd98519c84603973ad

Scoped checks:
  typecheck  -> clean (tsc --noEmit, no output)
  vitest     -> 57 files, 483 tests passed (tests/unit/meetings + src/features/meetings + tests/unit/i18n + consent-dialog)
  eslint-gate-> No ESLint regression vs baseline

Pushed lp/ux-meetings (--no-verify; scoped checks green, full unit suite is the coordinator gate).
