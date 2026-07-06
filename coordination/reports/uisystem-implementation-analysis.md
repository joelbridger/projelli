codex
Read-only check complete. I did not create, edit, move, delete, run tests, or touch external systems.

**Bottom Line**
The spec is buildable on top of what exists. The codebase already has a lot of the plumbing: `data-testid` usage, token-like CSS variables, real desktop drivers, screenshots, and full gates.

But it is not ready to “just turn on.” The biggest gaps are:

1. Handles are common, but not permanent or complete.
2. Tests still depend on English words and page shape.
3. Tokens exist, but hard-coded styling still leaks through.
4. There is no tier classifier yet.
5. The current robot smoke is not the approved 6-step demo rehearsal.

**Spec Map**
| Spec part | Existing code it builds on | Gap |
|---|---|---|
| Permanent handles | [Button forwards DOM props](/home/jameson/lantern-plus/src/ui/kp/Button.tsx:58), [IconButton forwards DOM props](/home/jameson/lantern-plus/src/ui/kp/IconButton.tsx:34), [desktop harness has `testid()` helpers](/home/jameson/lantern-plus/tests/desktop/harness/webdriver.mjs:95), [bench driver clicks by testid](/home/jameson/lantern-plus/scripts/bench-smoke/driver.mjs:40) | No full inventory, no rename migration list, no guard against removing handles. |
| Design tokens | [main token layer](/home/jameson/lantern-plus/src/styles/globals.css:11), [component CSS layer](/home/jameson/lantern-plus/src/styles/globals.css:224), [brand source of truth](/home/jameson/lantern-plus/brand/brand.config.json:21), [brand sync script](/home/jameson/lantern-plus/scripts/brand-sync.mjs:1) | Tokens are real, but hard-coded colors/sizes still exist. No “paint-only” enforcement. |
| Tiered gates | [package scripts](/home/jameson/lantern-plus/package.json:30), [canonical gate](/home/jameson/lantern-plus/scripts/gate.sh:1), [full gate adds browser + desktop](/home/jameson/lantern-plus/scripts/gate.sh:47) | Only fast/full gates exist. No P/S/B classifier. |
| Robot rehearsal | [approved demo path](/home/jameson/lantern-plus/coordination/DEMO-V1.md:6), [robot smoke framework](/home/jameson/lantern-plus/scripts/robot/smoke.mjs:50), [screenshots/artifact helper](/home/jameson/lantern-plus/scripts/robot/artifacts.mjs:12), [bench screenshots](/home/jameson/lantern-plus/scripts/bench-smoke/driver.mjs:117) | Current robot smoke is not the 6-step demo path. It runs reset/open/sweep/ask/isolation. |

**Contradictions**
- Spec says every interactive element gets a permanent handle. But `SegmentedToggle` option buttons have no `data-testid`: [SegmentedToggle.tsx](/home/jameson/lantern-plus/src/ui/kp/SegmentedToggle.tsx:44).
- Sidebar client rows are clickable but lack handles: [Spine.tsx](/home/jameson/lantern-plus/src/app/shell/layout/Spine.tsx:173).
- Several `MainPanel` controls lack handles: split select [MainPanel.tsx](/home/jameson/lantern-plus/src/app/shell/layout/MainPanel.tsx:974), title rename input [MainPanel.tsx](/home/jameson/lantern-plus/src/app/shell/layout/MainPanel.tsx:1028), rename button [MainPanel.tsx](/home/jameson/lantern-plus/src/app/shell/layout/MainPanel.tsx:1051), right panel buttons [MainPanel.tsx](/home/jameson/lantern-plus/src/app/shell/layout/MainPanel.tsx:1385).
- `ConfirmDialog` buttons have no handles: [ConfirmDialog.tsx](/home/jameson/lantern-plus/src/ui/ConfirmDialog.tsx:53).
- Spec says tests should avoid English copy. Current tests still click/assert literal words like `Files`, `OK`, `Shell Matter`, `Open Settings`: [10-files-editor.mjs](/home/jameson/lantern-plus/tests/desktop/specs/10-files-editor.mjs:32), [10-files-editor.mjs](/home/jameson/lantern-plus/tests/desktop/specs/10-files-editor.mjs:42), [19-global-shell.mjs](/home/jameson/lantern-plus/tests/desktop/specs/19-global-shell.mjs:146), [19-global-shell.mjs](/home/jameson/lantern-plus/tests/desktop/specs/19-global-shell.mjs:265).
- The desktop test docs explicitly allow text fallback when no handle exists: [README.md](/home/jameson/lantern-plus/tests/desktop/README.md:74).
- Spec says copy assertions go through i18n keys. ESLint i18n rule applies only to `src/**/*`, not tests: [eslint.config.js](/home/jameson/lantern-plus/eslint.config.js:22). Tests still use `screen.getByText`: [Spine.test.tsx](/home/jameson/lantern-plus/src/app/shell/layout/Spine.test.tsx:22).
- Spec says Tailwind config plus CSS variables. This repo is Tailwind v4-style CSS-first: [postcss.config.js](/home/jameson/lantern-plus/postcss.config.js:1), [globals.css](/home/jameson/lantern-plus/src/styles/globals.css:1). There is no `tailwind.config.*`.
- Spec says reskins touch only tokens/assets. But hard-coded values remain inside the token/component layer, for example `#0d2f53`: [globals.css](/home/jameson/lantern-plus/src/styles/globals.css:258), [globals.css](/home/jameson/lantern-plus/src/styles/globals.css:279).
- Spec says ~15-minute robot rehearsal. Existing Ask waits can run up to 30 minutes just for PDF indexing: [workspace.mjs](/home/jameson/lantern-plus/scripts/robot/verbs/workspace.mjs:51).
- Spec says 6-step demo path. Current robot smoke has 5 different steps: [smoke.mjs](/home/jameson/lantern-plus/scripts/robot/smoke.mjs:50).

**Implementation Steps**
1. **Small: write the handle rules.** Add naming convention to `ARCHITECTURE.md`: stable, semantic, no copy words, no index-only names unless item has no stable id.
2. **Medium: add handle support to shared primitives.** Start with `SegmentedToggle` option handles, `ConfirmDialog` root/cancel/confirm handles, `SlidePanel` close handle, `TrustBar` icon handles.
3. **Large: demo-path handle sweep.** Add handles only to the 6-step DEMO-V1 path first: AI setup, connector cards, progress UI, Ask composer/scope/result/citations, meeting record/notice card, transcript search.
4. **Medium: migrate the brittle test helpers.** Replace visible-text clicks in `tests/desktop/specs/*` and `scripts/bench-smoke/checks/*` where handles now exist.
5. **Medium: add a handle guard.** Best first version: a script that snapshots all `data-testid` strings and fails when one is removed without a migration entry.
6. **Medium: token cleanup.** Keep Tailwind v4 `@theme`; do not create old Tailwind config unless needed. Move hard-coded app colors/sizes into `--kp-*` tokens.
7. **Medium: add tier classifier.** A script can classify changed files: tokens/assets/copy = P, UI components/features = S, platform/Rust/stores = B.
8. **Large/XL: build the real 6-step robot rehearsal.** Reuse `scripts/robot` and `scripts/bench-smoke`, but create a new script aligned exactly to `DEMO-V1.md`.

**Riskiest Piece**
The riskiest piece is the robot rehearsal, because it depends on real bench state: AI keys, Outlook/OneDrive/Wealthbox, import progress, Teams recording, audio, transcript indexing, and Ask. It is not just a UI test. It is a whole “walk through the store and buy something” test.

**Best First Slice**
Start with **handles for the demo path only**, especially `SegmentedToggle` and the current text-click fallbacks. That gives the robot something stable to grab before touching the whole app. Then build one rehearsal step: **Ask with cited answer**, because existing robot code already does most of it and it proves the handle pattern before expanding to connectors and meetings.
213,836
Read-only check complete. I did not create, edit, move, delete, run tests, or touch external systems.

**Bottom Line**
The spec is buildable on top of what exists. The codebase already has a lot of the plumbing: `data-testid` usage, token-like CSS variables, real desktop drivers, screenshots, and full gates.

But it is not ready to “just turn on.” The biggest gaps are:

1. Handles are common, but not permanent or complete.
2. Tests still depend on English words and page shape.
3. Tokens exist, but hard-coded styling still leaks through.
4. There is no tier classifier yet.
5. The current robot smoke is not the approved 6-step demo rehearsal.

**Spec Map**
| Spec part | Existing code it builds on | Gap |
|---|---|---|
| Permanent handles | [Button forwards DOM props](/home/jameson/lantern-plus/src/ui/kp/Button.tsx:58), [IconButton forwards DOM props](/home/jameson/lantern-plus/src/ui/kp/IconButton.tsx:34), [desktop harness has `testid()` helpers](/home/jameson/lantern-plus/tests/desktop/harness/webdriver.mjs:95), [bench driver clicks by testid](/home/jameson/lantern-plus/scripts/bench-smoke/driver.mjs:40) | No full inventory, no rename migration list, no guard against removing handles. |
| Design tokens | [main token layer](/home/jameson/lantern-plus/src/styles/globals.css:11), [component CSS layer](/home/jameson/lantern-plus/src/styles/globals.css:224), [brand source of truth](/home/jameson/lantern-plus/brand/brand.config.json:21), [brand sync script](/home/jameson/lantern-plus/scripts/brand-sync.mjs:1) | Tokens are real, but hard-coded colors/sizes still exist. No “paint-only” enforcement. |
| Tiered gates | [package scripts](/home/jameson/lantern-plus/package.json:30), [canonical gate](/home/jameson/lantern-plus/scripts/gate.sh:1), [full gate adds browser + desktop](/home/jameson/lantern-plus/scripts/gate.sh:47) | Only fast/full gates exist. No P/S/B classifier. |
| Robot rehearsal | [approved demo path](/home/jameson/lantern-plus/coordination/DEMO-V1.md:6), [robot smoke framework](/home/jameson/lantern-plus/scripts/robot/smoke.mjs:50), [screenshots/artifact helper](/home/jameson/lantern-plus/scripts/robot/artifacts.mjs:12), [bench screenshots](/home/jameson/lantern-plus/scripts/bench-smoke/driver.mjs:117) | Current robot smoke is not the 6-step demo path. It runs reset/open/sweep/ask/isolation. |

**Contradictions**
- Spec says every interactive element gets a permanent handle. But `SegmentedToggle` option buttons have no `data-testid`: [SegmentedToggle.tsx](/home/jameson/lantern-plus/src/ui/kp/SegmentedToggle.tsx:44).
- Sidebar client rows are clickable but lack handles: [Spine.tsx](/home/jameson/lantern-plus/src/app/shell/layout/Spine.tsx:173).
- Several `MainPanel` controls lack handles: split select [MainPanel.tsx](/home/jameson/lantern-plus/src/app/shell/layout/MainPanel.tsx:974), title rename input [MainPanel.tsx](/home/jameson/lantern-plus/src/app/shell/layout/MainPanel.tsx:1028), rename button [MainPanel.tsx](/home/jameson/lantern-plus/src/app/shell/layout/MainPanel.tsx:1051), right panel buttons [MainPanel.tsx](/home/jameson/lantern-plus/src/app/shell/layout/MainPanel.tsx:1385).
- `ConfirmDialog` buttons have no handles: [ConfirmDialog.tsx](/home/jameson/lantern-plus/src/ui/ConfirmDialog.tsx:53).
- Spec says tests should avoid English copy. Current tests still click/assert literal words like `Files`, `OK`, `Shell Matter`, `Open Settings`: [10-files-editor.mjs](/home/jameson/lantern-plus/tests/desktop/specs/10-files-editor.mjs:32), [10-files-editor.mjs](/home/jameson/lantern-plus/tests/desktop/specs/10-files-editor.mjs:42), [19-global-shell.mjs](/home/jameson/lantern-plus/tests/desktop/specs/19-global-shell.mjs:146), [19-global-shell.mjs](/home/jameson/lantern-plus/tests/desktop/specs/19-global-shell.mjs:265).
- The desktop test docs explicitly allow text fallback when no handle exists: [README.md](/home/jameson/lantern-plus/tests/desktop/README.md:74).
- Spec says copy assertions go through i18n keys. ESLint i18n rule applies only to `src/**/*`, not tests: [eslint.config.js](/home/jameson/lantern-plus/eslint.config.js:22). Tests still use `screen.getByText`: [Spine.test.tsx](/home/jameson/lantern-plus/src/app/shell/layout/Spine.test.tsx:22).
- Spec says Tailwind config plus CSS variables. This repo is Tailwind v4-style CSS-first: [postcss.config.js](/home/jameson/lantern-plus/postcss.config.js:1), [globals.css](/home/jameson/lantern-plus/src/styles/globals.css:1). There is no `tailwind.config.*`.
- Spec says reskins touch only tokens/assets. But hard-coded values remain inside the token/component layer, for example `#0d2f53`: [globals.css](/home/jameson/lantern-plus/src/styles/globals.css:258), [globals.css](/home/jameson/lantern-plus/src/styles/globals.css:279).
- Spec says ~15-minute robot rehearsal. Existing Ask waits can run up to 30 minutes just for PDF indexing: [workspace.mjs](/home/jameson/lantern-plus/scripts/robot/verbs/workspace.mjs:51).
- Spec says 6-step demo path. Current robot smoke has 5 different steps: [smoke.mjs](/home/jameson/lantern-plus/scripts/robot/smoke.mjs:50).

**Implementation Steps**
1. **Small: write the handle rules.** Add naming convention to `ARCHITECTURE.md`: stable, semantic, no copy words, no index-only names unless item has no stable id.
2. **Medium: add handle support to shared primitives.** Start with `SegmentedToggle` option handles, `ConfirmDialog` root/cancel/confirm handles, `SlidePanel` close handle, `TrustBar` icon handles.
3. **Large: demo-path handle sweep.** Add handles only to the 6-step DEMO-V1 path first: AI setup, connector cards, progress UI, Ask composer/scope/result/citations, meeting record/notice card, transcript search.
4. **Medium: migrate the brittle test helpers.** Replace visible-text clicks in `tests/desktop/specs/*` and `scripts/bench-smoke/checks/*` where handles now exist.
5. **Medium: add a handle guard.** Best first version: a script that snapshots all `data-testid` strings and fails when one is removed without a migration entry.
6. **Medium: token cleanup.** Keep Tailwind v4 `@theme`; do not create old Tailwind config unless needed. Move hard-coded app colors/sizes into `--kp-*` tokens.
7. **Medium: add tier classifier.** A script can classify changed files: tokens/assets/copy = P, UI components/features = S, platform/Rust/stores = B.
8. **Large/XL: build the real 6-step robot rehearsal.** Reuse `scripts/robot` and `scripts/bench-smoke`, but create a new script aligned exactly to `DEMO-V1.md`.

**Riskiest Piece**
The riskiest piece is the robot rehearsal, because it depends on real bench state: AI keys, Outlook/OneDrive/Wealthbox, import progress, Teams recording, audio, transcript indexing, and Ask. It is not just a UI test. It is a whole “walk through the store and buy something” test.

**Best First Slice**
Start with **handles for the demo path only**, especially `SegmentedToggle` and the current text-click fallbacks. That gives the robot something stable to grab before touching the whole app. Then build one rehearsal step: **Ask with cited answer**, because existing robot code already does most of it and it proves the handle pattern before expanding to connectors and meetings.
