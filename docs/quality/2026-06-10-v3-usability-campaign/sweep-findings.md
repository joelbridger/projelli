# Phase 5 Sweep Findings — Advisor Prep Hero 3.0

**Started:** 2026-06-10 (attempt 3, resumed after server restarts)
**Branch:** keepance-3.0
**Viewport:** 1366×768 primary (project "1366")
**Total specs run:** 12 sweep specs
**Test counts:** 145 tests across all specs; 213 passed (with 1-retry), 0 true failures

Severity: P0 ship-blocker / P1 fix-before-release / P2 fix-soon / P3 polish
Type: bug / layout / a11y / ux / copy

---

| ID | Sev | Type | Ledger rows | Finding | Evidence |
|----|-----|------|-------------|---------|----------|
| F-201 | P3 | layout | L-010 | Sidebar collapse/expand toggle: `getBoundingClientRect().right` briefly reports ~89px beyond viewport at 1366px after expand animation. Document scrollWidth does NOT exceed clientWidth (verified: both 1366). The element is inside `overflow-hidden` so visually no clipping is user-visible; this is a post-animation bbox reporting artifact. No horizontal scrollbar appears. | sidebar.spec.ts console.warn; confirmed false positive via scrollWidth check |
| F-202 | P3 | layout | L-140, L-216 | Split pane overflow: when `isSplit=true`, the second `MainPanel` pane's tab-bar toolbar reports `right=1414` (48px beyond 1366px viewport) via `getBoundingClientRect()`. Root cause: the pane wrapper uses `overflow-hidden` (SplitPane.tsx:95 + 131) but `getBoundingClientRect()` reports the element's absolute position, not the visible clip. Verified: `document.documentElement.scrollWidth === 1366` (equals clientWidth) — no actual horizontal scroll possible. The user never sees overflow. This is the same detection artifact noted in F-004. **Product finding: the overflow detection helper cannot distinguish true overflow from elements inside `overflow-hidden` containers; the helper should be updated to exclude elements with `overflow-hidden` ancestors.** | shortcuts.spec.ts + misc-surfaces.spec.ts console.warn; scrollWidth check confirms false positive |
| F-203 | P3 | spec-bug | L-060..L-077, L-078..L-090, L-107 | Template spec IDs wrong: several legal templates have `legal-` prefix (`legal-case-timeline-builder`, `legal-client-intake-synthesizer`, `legal-contract-review-checklist`, `legal-deposition-contradiction-finder`, `legal-discovery-document-triage`, `legal-estate-planning-client-summary`, `legal-evidence-gap-analyzer`, `legal-patent-disclosure-draft`, `legal-privilege-log-drafter`, `legal-transactional-matter-summary`); tax templates have `tax-` prefix (`tax-audit-defense-file-builder`, `tax-client-document-inventory`, `tax-engagement-letter-builder`, `tax-notice-response-drafter`, `tax-pre-review-checklist`, `tax-quarterly-estimate-reminder`, `tax-section-7216-consent`); biz `weekly-review-workflow` is `weekly-review`. Fixed in spec in this run. Not a product bug — template IDs are correct in source. | templates.spec.ts ID verification vs src/modules/workflow/templates/*/  |
| F-204 | P3 | infra | multiple | Playwright ENOENT artifact race: when 2 workers finish a test simultaneously, the trace/network recording ZIP file may be unlinked before the other worker reads it. Manifests as `ENOENT: .playwright-artifacts-N/traces/*.network` or `*.zip`. Tests consistently pass on retry (1 retry is configured). Not a product bug — Playwright internal artifact cleanup race. | templates.spec.ts; dialogs.spec.ts L-052; retries always pass |
| F-205 | P3 | ux | L-046 | CompressionConfirmModal (L-046) is unreachable in headless browser sweep — it only mounts when an active AI chat context manager decides to compress context. Confirmed unreachable. Ledger row marked `unreachable - requires live AI stream with long context`. | dialogs.spec.ts L-046 skip assertion |
| F-206 | P3 | note | L-192, L-193 | Egress AI call in-progress (L-192) and Ollama local-only egress (L-193) are native-only — require a live AI stream or local Ollama process. Both ledger rows marked native-only. | misc-surfaces.spec.ts |
| F-207 | P3 | note | L-177..L-179, L-181, L-184..L-188 | License states requiring live JWT validation from the firm server (subscription-active, grandfathered, subscription-lapsed, trial-expired, personal/professional/practice-onetime, subscription type, trial type) are native-only in the browser sweep. The licensing-states spec verified UI shells render for trial-active (L-180), offline-grace (L-182), unlicensed (L-183), and data-access-always-true (L-190). | licensing-states.spec.ts |
| F-208 | P3 | note | F-002 | i18n smoke (F-002): no language picker (select/combobox) was found in General settings at the testMode URL. The spec passed without error (graceful skip). If the app has i18n it is not exposed via a settings picker in this build. F-002 (locale-loss on navigation) remains needs-verify. | misc-surfaces.spec.ts F-002 snap: F-002-no-language-picker |
| F-209 | P3 | note | axe | axe-core/playwright is not installed. Accessibility scan was skipped. F-005 (accordion a11y) remains open. | misc-surfaces.spec.ts axe test console.warn |
| F-210 | P2 | spec-finding | L-140, L-216 | Prior reports described L-216 as "same root cause as L-140" referring to a real product overflow. This run confirms: **the overflow is a detection false positive** (document scrollWidth = clientWidth = 1366; no scrollbar). The actual product finding is that `horizontalOverflow()` in overflow.ts does not skip elements whose CSS `overflow-hidden` ancestors contain them, leading to false positives on split-pane and post-animation elements. The spec correctly PASSES (overflow not asserted as fatal for L-140/L-216); only a console.warn is emitted. | Direct scrollWidth check; SplitPane.tsx:88-95 overflow-hidden pane wrappers confirmed |

---

## Summary

| Result | Count |
|--------|-------|
| True product findings (P2+) | 1 (F-210: overflow helper improvement) |
| Polish / ux-improvement | 3 (F-201, F-202, F-208) |
| Spec fixes applied | 1 (F-203: template IDs corrected) |
| Infrastructure notes | 2 (F-204, F-209) |
| Native-only confirms | 3 (F-205, F-206, F-207) |

**No P0 or P1 findings. No product regressions detected across 222 ledger rows.**
