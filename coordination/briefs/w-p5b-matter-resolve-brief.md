ROLE: P0 fix worker — the Windows smoke-2 re-test PASSED Waves 0-1 but the Wave-2 headline flow is still dead: the "Send to Wealthbox" button never RENDERS (absent from DOM, not disabled) on a normal client Word note, on real Windows, with VERIFIED-correct folder mappings. Root-cause investigation + robust fix (Keepance no-shortcuts rule: take the long route). TDD — failing test FIRST.

WORKDIR: ~/lp-p5 (git worktree, branch lp/matter-resolve-windows off current origin/lantern-plus — pull first). NOT self-merged.

READ FIRST (the bench did superb legwork — start from it, don't redo it):
- docs/evidence/windows-smoke-2/RUN-LOG.md on branch origin/lp/windows-smoke-evidence — the "Send to Wealthbox ... FAIL" section, verbatim evidence.
- Key facts from it: tab.path is workspace-relative (`Clients/Caldwell, Jennifer/Planning/Meeting Notes 2024-05-20 - Caldwell, Jennifer.docx`); folderPaths verified correct twice (`C:/lantern-plus-smoke/Northcrest Wealth Partners/Clients/Caldwell, Jennifer`), written through the app's own addFolderPath action; a manual replication of the matcher "should match" — yet `resolveMatterIdForWorkspacePath(tab.path, rootPath)` at src/app/shell/layout/MainPanel.tsx:853-863 returns UNASSIGNED for the open tab, so `onSendToWealthbox` is never passed (src/platform/hooks/useMemoryWiring.ts:284-290, matterResolver matching).
- SECONDARY SYMPTOM, same suspected root: Draft follow-up's "To" auto-suggestion also failed despite imported mail (run-log Wave-0 section) — the same resolver feeds that lookup. Your fix should heal both; add a test for the To-suggestion path too if it shares the resolver.

INVESTIGATION DIRECTION (verify, don't assume): the discrepancy is almost certainly Windows path-shape sensitivity in the join/compare — drive-letter casing, backslash vs forward-slash, spaces, trailing separators, or what `rootPath` actually holds at runtime on Tauri-Windows (vs the dev-browser shape the tests use). NOTE: the Wave-4 Ask lane hit a "Windows path detection" bug days ago and fixed it (commit 334412ec, "fix Windows path detection") — read that fix first; if a shared path-normalization seam exists or should exist, USE/CREATE it rather than patching one call site (robustness rule: fix the resolver for every caller, not just this button).

REQUIREMENTS:
1. Failing test FIRST that reproduces the bench state: Windows-style absolute rootPath (drive letter + spaces, both slash styles), workspace-relative tab.path, folderPaths as the app's addFolderPath writes them on Windows. Test through resolveMatterIdForWorkspacePath (the real seam), not a copy of its logic.
2. Fix robustly at the resolver/normalization layer. Audit the resolver's OTHER call sites for the same latent failure (grep resolveMatterIdForWorkspacePath) and cover the important ones with tests.
3. Keep behavior for non-Windows/browser paths unchanged (existing tests stay green).
4. TS-only expected; if the true fix needs Rust, STOP and flag COORDINATOR: first.

ENVIRONMENT: no cargo. `npx vitest run <touched>` loop; handoff bar: `npx tsc --noEmit` + full `timeout 1150 npx vitest run`; self-converge via codex-review to a clean round. Evidence handoff (HEAD SHA, test counts, root-cause explanation in one plain-language paragraph, call sites audited, "NOT self-merged"); sentinel as the very LAST line: WORKER-DONE: lp/matter-resolve-windows ready for review
