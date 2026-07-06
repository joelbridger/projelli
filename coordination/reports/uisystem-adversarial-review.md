codex
Read-only review complete. I did not change files or run mutating commands.

**Main Finding**
The design’s biggest danger is false confidence. It can say “cheap UI change, quick pass” while the user-facing app is broken, because it mostly trusts file paths, handles, and a short robot path. Those are useful, but they are not the same as checking what Jameson will actually see and do.

**P0 — Tier P Can Hide Real Behavior Risk**
Failure story: someone changes only `src/styles/globals.css`, so the branch is called “paint-only.” But CSS is not just paint. It can change `pointer-events`, `z-index`, focus rings, disabled states, layout width, animation timing, or hide an overlay. The gate may only run typecheck plus screenshots, while the app’s “Connect Outlook” button is now unclickable behind an invisible layer.

Evidence: Tier P is defined as tokens/assets/copy only with no behavior re-check in [coordination/UI-ITERATION-SYSTEM.md](/home/jameson/lantern-plus/coordination/UI-ITERATION-SYSTEM.md:19). But the token/component layer already contains real control styling and behavior-adjacent CSS like transitions, disabled pointer behavior, sizes, and hover states in [src/styles/globals.css](/home/jameson/lantern-plus/src/styles/globals.css:232).

Fix: split Tier P into `P-safe` and `P-risky`. Any CSS touching display, position, overflow, pointer-events, z-index, opacity, disabled, focus, media queries, animation, or component classes must become Tier S.

**P0 — Path-Based Tiering Will Misclassify Feature Files**
Failure story: a “simple UI cleanup” in `src/features/ask/...` preserves handles but changes when the Ask button enables, which provider is selected, or whether citations show. The path says UI structure, handles still exist, robot clicks through one happy path, and a real demo fails when Local AI is selected.

Evidence: the spec says the coordinator classifies by a “diff-path heuristic” in [coordination/UI-ITERATION-SYSTEM.md](/home/jameson/lantern-plus/coordination/UI-ITERATION-SYSTEM.md:22). That is too weak because `features` files often mix UI and behavior. Current gates only know fast/full, not P/S/B, per [scripts/gate.sh](/home/jameson/lantern-plus/scripts/gate.sh:1) and [package.json](/home/jameson/lantern-plus/package.json:32).

Fix: classifier must scan changed code, not just paths. If a UI file changes hooks, async calls, local state rules, provider selection, event handlers, import progress logic, storage, or Tauri invokes, it is Tier B.

**P0 — Handles Can Drift While Tests Still Pass**
Failure story: `data-testid="connect-outlook"` stays present, but moves from the real button to a wrapper card. The robot finds the handle and “clicks,” but the real button inside is disabled or blocked. Another version: duplicate handles exist, and the robot clicks the first one, not the visible one Jameson uses.

Evidence: the spec says handles are the stable grip in [coordination/UI-ITERATION-SYSTEM.md](/home/jameson/lantern-plus/coordination/UI-ITERATION-SYSTEM.md:9), but the analysis says there is no full inventory or guard yet in [coordination/reports/uisystem-implementation-analysis.md](/home/jameson/lantern-plus/coordination/reports/uisystem-implementation-analysis.md:18). Current desktop tools click directly by test id in [scripts/desktop-drive.mjs](/home/jameson/lantern-plus/scripts/desktop-drive.mjs:85).

Fix: guard more than “handle string still exists.” Require uniqueness, visible/enabled checks, expected role, expected tag, and “handle attached to the actual clickable/input element” for controls.

**P1 — Robot Rehearsal Misses Big Visual Bugs**
Failure story: every handle is present, Ask answers, and the run is green. But the progress panel is clipped, the Local AI badge is unreadable, citations overlap the input, or the meeting card appears below the fold. Jameson sees a broken UI in the demo.

Evidence: the promised robot is the 6-step demo path in [coordination/UI-ITERATION-SYSTEM.md](/home/jameson/lantern-plus/coordination/UI-ITERATION-SYSTEM.md:24), but the current robot runs reset/open/sweep/ask/isolation in [scripts/robot/smoke.mjs](/home/jameson/lantern-plus/scripts/robot/smoke.mjs:50). Screenshot support exists, but screenshot capture is not the same as a failing visual comparison; current desktop screenshots are just artifacts in [scripts/bench-smoke/driver.mjs](/home/jameson/lantern-plus/scripts/bench-smoke/driver.mjs:114).

Fix: each demo step needs visual assertions: no horizontal overflow, key controls inside viewport, no overlapping boxes, text contrast pass, loading/progress visible, and screenshot diff against a blessed baseline.

**P1 — The 15-Minute Promise Is Fragile**
Failure story: the team expects quick green/red UI rounds. But one run waits on indexing, live connectors, Teams, audio, or Local AI startup. People start skipping the robot because it is “temporarily too slow,” then the system stops protecting the app.

Evidence: the spec targets ~15 minutes in [coordination/UI-ITERATION-SYSTEM.md](/home/jameson/lantern-plus/coordination/UI-ITERATION-SYSTEM.md:26), but existing PDF indexing wait allows up to 30 minutes by itself in [scripts/robot/verbs/workspace.mjs](/home/jameson/lantern-plus/scripts/robot/verbs/workspace.mjs:51). The demo requires real connector/progress/meeting checks in [coordination/DEMO-V1.md](/home/jameson/lantern-plus/coordination/DEMO-V1.md:10).

Fix: define two robots: fast deterministic UI robot under 15 minutes, and slower live-bench drift robot. Never let a slow live dependency block the cheap UI loop.

**P1 — Copy-Only Is Not Safe**
Failure story: copy changes from “Connect” to “Connect Microsoft 365 and import the last 24 months” and the button overflows on small screens. Or an i18n key changes and English works but Spanish shows missing text. The tier says copy-only, but the demo looks broken.

Evidence: copy assertions are supposed to use i18n keys in [coordination/UI-ITERATION-SYSTEM.md](/home/jameson/lantern-plus/coordination/UI-ITERATION-SYSTEM.md:12), but the analysis found tests still use literal text and i18n key parity is not fully blocking in [coordination/reports/uisystem-implementation-analysis.md](/home/jameson/lantern-plus/coordination/reports/uisystem-implementation-analysis.md:28) and [scripts/gate.sh](/home/jameson/lantern-plus/scripts/gate.sh:21).

Fix: copy-only changes need layout smoke at desktop and narrow width, plus blocking i18n key checks before they qualify as Tier P.

**P2 — Accessibility Is Informational, Not Enforced**
Failure story: a token change makes muted text too pale. Robot sees handles and text; screenshots look “close enough”; advisors cannot read the app.

Evidence: axe scan logs violations but does not fail the sweep in [tests/campaign/sweep/misc-surfaces.spec.ts](/home/jameson/lantern-plus/tests/campaign/sweep/misc-surfaces.spec.ts:490). Some visual snapshots exist, like [tests/e2e/app-layout.spec.ts](/home/jameson/lantern-plus/tests/e2e/app-layout.spec.ts:29), but coverage is thin.

Fix: make contrast/accessibility blocking for demo screens, especially connector cards, Ask, progress, meeting card, transcript search, modals, and disabled/loading states.

**Recommended Spec Patch**
```diff
- Tier P (paint-only): tokens/assets/copy only → gate = typecheck + visual smoke.
+ Tier P-safe: token value swaps, image asset swaps, and copy edits only,
+ with no selector/class/component CSS changes. Gate = typecheck + visual +
+ contrast + narrow-width smoke.
+
+ Tier P-risky: any CSS affecting layout, visibility, z-index, pointer events,
+ focus, disabled state, animation, overflow, or component classes. Treat as Tier S.

- The coordinator classifies at merge time; a diff-path heuristic assists.
+ A script classifies every changed file and code pattern. Human coordinator may
+ only raise the tier, never lower it without a written exception.

+ Handles must be unique, role-checked, visible, enabled, and attached to the
+ actual clickable/input element. Keeping the same string is not enough.

+ Robot pass requires functional proof plus visual proof: no overlap, no clipping,
+ key controls in viewport, contrast pass, and blessed screenshot diff for each
+ DEMO-V1 step.

+ After every 5 UI rounds, run one full real-Windows verification. After every
+ 20 rounds, refresh handle inventory, token audit, screenshot baselines, and
+ demo-path coverage before more cheap rounds are allowed.
```
tokens used
108,643
Read-only review complete. I did not change files or run mutating commands.

**Main Finding**
The design’s biggest danger is false confidence. It can say “cheap UI change, quick pass” while the user-facing app is broken, because it mostly trusts file paths, handles, and a short robot path. Those are useful, but they are not the same as checking what Jameson will actually see and do.

**P0 — Tier P Can Hide Real Behavior Risk**
Failure story: someone changes only `src/styles/globals.css`, so the branch is called “paint-only.” But CSS is not just paint. It can change `pointer-events`, `z-index`, focus rings, disabled states, layout width, animation timing, or hide an overlay. The gate may only run typecheck plus screenshots, while the app’s “Connect Outlook” button is now unclickable behind an invisible layer.

Evidence: Tier P is defined as tokens/assets/copy only with no behavior re-check in [coordination/UI-ITERATION-SYSTEM.md](/home/jameson/lantern-plus/coordination/UI-ITERATION-SYSTEM.md:19). But the token/component layer already contains real control styling and behavior-adjacent CSS like transitions, disabled pointer behavior, sizes, and hover states in [src/styles/globals.css](/home/jameson/lantern-plus/src/styles/globals.css:232).

Fix: split Tier P into `P-safe` and `P-risky`. Any CSS touching display, position, overflow, pointer-events, z-index, opacity, disabled, focus, media queries, animation, or component classes must become Tier S.

**P0 — Path-Based Tiering Will Misclassify Feature Files**
Failure story: a “simple UI cleanup” in `src/features/ask/...` preserves handles but changes when the Ask button enables, which provider is selected, or whether citations show. The path says UI structure, handles still exist, robot clicks through one happy path, and a real demo fails when Local AI is selected.

Evidence: the spec says the coordinator classifies by a “diff-path heuristic” in [coordination/UI-ITERATION-SYSTEM.md](/home/jameson/lantern-plus/coordination/UI-ITERATION-SYSTEM.md:22). That is too weak because `features` files often mix UI and behavior. Current gates only know fast/full, not P/S/B, per [scripts/gate.sh](/home/jameson/lantern-plus/scripts/gate.sh:1) and [package.json](/home/jameson/lantern-plus/package.json:32).

Fix: classifier must scan changed code, not just paths. If a UI file changes hooks, async calls, local state rules, provider selection, event handlers, import progress logic, storage, or Tauri invokes, it is Tier B.

**P0 — Handles Can Drift While Tests Still Pass**
Failure story: `data-testid="connect-outlook"` stays present, but moves from the real button to a wrapper card. The robot finds the handle and “clicks,” but the real button inside is disabled or blocked. Another version: duplicate handles exist, and the robot clicks the first one, not the visible one Jameson uses.

Evidence: the spec says handles are the stable grip in [coordination/UI-ITERATION-SYSTEM.md](/home/jameson/lantern-plus/coordination/UI-ITERATION-SYSTEM.md:9), but the analysis says there is no full inventory or guard yet in [coordination/reports/uisystem-implementation-analysis.md](/home/jameson/lantern-plus/coordination/reports/uisystem-implementation-analysis.md:18). Current desktop tools click directly by test id in [scripts/desktop-drive.mjs](/home/jameson/lantern-plus/scripts/desktop-drive.mjs:85).

Fix: guard more than “handle string still exists.” Require uniqueness, visible/enabled checks, expected role, expected tag, and “handle attached to the actual clickable/input element” for controls.

**P1 — Robot Rehearsal Misses Big Visual Bugs**
Failure story: every handle is present, Ask answers, and the run is green. But the progress panel is clipped, the Local AI badge is unreadable, citations overlap the input, or the meeting card appears below the fold. Jameson sees a broken UI in the demo.

Evidence: the promised robot is the 6-step demo path in [coordination/UI-ITERATION-SYSTEM.md](/home/jameson/lantern-plus/coordination/UI-ITERATION-SYSTEM.md:24), but the current robot runs reset/open/sweep/ask/isolation in [scripts/robot/smoke.mjs](/home/jameson/lantern-plus/scripts/robot/smoke.mjs:50). Screenshot support exists, but screenshot capture is not the same as a failing visual comparison; current desktop screenshots are just artifacts in [scripts/bench-smoke/driver.mjs](/home/jameson/lantern-plus/scripts/bench-smoke/driver.mjs:114).

Fix: each demo step needs visual assertions: no horizontal overflow, key controls inside viewport, no overlapping boxes, text contrast pass, loading/progress visible, and screenshot diff against a blessed baseline.

**P1 — The 15-Minute Promise Is Fragile**
Failure story: the team expects quick green/red UI rounds. But one run waits on indexing, live connectors, Teams, audio, or Local AI startup. People start skipping the robot because it is “temporarily too slow,” then the system stops protecting the app.

Evidence: the spec targets ~15 minutes in [coordination/UI-ITERATION-SYSTEM.md](/home/jameson/lantern-plus/coordination/UI-ITERATION-SYSTEM.md:26), but existing PDF indexing wait allows up to 30 minutes by itself in [scripts/robot/verbs/workspace.mjs](/home/jameson/lantern-plus/scripts/robot/verbs/workspace.mjs:51). The demo requires real connector/progress/meeting checks in [coordination/DEMO-V1.md](/home/jameson/lantern-plus/coordination/DEMO-V1.md:10).

Fix: define two robots: fast deterministic UI robot under 15 minutes, and slower live-bench drift robot. Never let a slow live dependency block the cheap UI loop.

**P1 — Copy-Only Is Not Safe**
Failure story: copy changes from “Connect” to “Connect Microsoft 365 and import the last 24 months” and the button overflows on small screens. Or an i18n key changes and English works but Spanish shows missing text. The tier says copy-only, but the demo looks broken.

Evidence: copy assertions are supposed to use i18n keys in [coordination/UI-ITERATION-SYSTEM.md](/home/jameson/lantern-plus/coordination/UI-ITERATION-SYSTEM.md:12), but the analysis found tests still use literal text and i18n key parity is not fully blocking in [coordination/reports/uisystem-implementation-analysis.md](/home/jameson/lantern-plus/coordination/reports/uisystem-implementation-analysis.md:28) and [scripts/gate.sh](/home/jameson/lantern-plus/scripts/gate.sh:21).

Fix: copy-only changes need layout smoke at desktop and narrow width, plus blocking i18n key checks before they qualify as Tier P.

**P2 — Accessibility Is Informational, Not Enforced**
Failure story: a token change makes muted text too pale. Robot sees handles and text; screenshots look “close enough”; advisors cannot read the app.

Evidence: axe scan logs violations but does not fail the sweep in [tests/campaign/sweep/misc-surfaces.spec.ts](/home/jameson/lantern-plus/tests/campaign/sweep/misc-surfaces.spec.ts:490). Some visual snapshots exist, like [tests/e2e/app-layout.spec.ts](/home/jameson/lantern-plus/tests/e2e/app-layout.spec.ts:29), but coverage is thin.

Fix: make contrast/accessibility blocking for demo screens, especially connector cards, Ask, progress, meeting card, transcript search, modals, and disabled/loading states.

**Recommended Spec Patch**
```diff
- Tier P (paint-only): tokens/assets/copy only → gate = typecheck + visual smoke.
+ Tier P-safe: token value swaps, image asset swaps, and copy edits only,
+ with no selector/class/component CSS changes. Gate = typecheck + visual +
+ contrast + narrow-width smoke.
+
+ Tier P-risky: any CSS affecting layout, visibility, z-index, pointer events,
+ focus, disabled state, animation, overflow, or component classes. Treat as Tier S.

- The coordinator classifies at merge time; a diff-path heuristic assists.
+ A script classifies every changed file and code pattern. Human coordinator may
+ only raise the tier, never lower it without a written exception.

+ Handles must be unique, role-checked, visible, enabled, and attached to the
+ actual clickable/input element. Keeping the same string is not enough.

+ Robot pass requires functional proof plus visual proof: no overlap, no clipping,
+ key controls in viewport, contrast pass, and blessed screenshot diff for each
+ DEMO-V1 step.

+ After every 5 UI rounds, run one full real-Windows verification. After every
+ 20 rounds, refresh handle inventory, token audit, screenshot baselines, and
+ demo-path coverage before more cheap rounds are allowed.
```
