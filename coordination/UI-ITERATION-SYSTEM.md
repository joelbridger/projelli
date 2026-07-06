# UI Iteration System — approved by Jameson 2026-07-06

**The goal (Jameson's words):** the UI will undergo many iterations (like branding and the logo). We need a flexible, efficient, long-term system to adjust the UI without disrupting fundamental testing or requiring full re-verification each time.

**Approved plan: build this foundation FIRST, right after the demo + post-demo merge window, BEFORE the next round of UI changes.** The UI-simplification branch is its first customer.

## The four parts (in build order)

### 1. Permanent handles (stable `data-testid` on every interactive element)
- Sweep the app: every button, input, card, tab, list row gets a permanent, semantic `data-testid` (e.g. `ask-input`, `client-row`, `connect-outlook`). Naming convention documented in ARCHITECTURE.md; a lint/test guard prevents removal or renaming (renames require a deliberate migration entry).
- All Vitest component tests and all live-drive harness scripts (desktop-drive.mjs flows, bench-smoke) migrate to grip handles (or ARIA roles) — never visual structure, class names, or English copy.
- Copy assertions go through i18n keys, not literal strings (i18n already exists — finish the funnel).

### 2. Paint file (design tokens)
- All colors, type, spacing, radii formalized as tokens (Tailwind config + CSS custom properties — audit what exists in src/ui and consolidate; one authoritative token layer).
- Rule: a "reskin" change touches ONLY the token layer + assets. Brand/logo/theme iterations = token/asset edits.

### 3. Tiered merge gates (classify every UI-touching branch)
- **Tier P (paint-only):** tokens/assets/copy only → gate = typecheck + visual smoke (screenshot pass). No behavioral re-verification.
- **Tier S (structure, handles preserved):** components rearranged/restyled, handles intact → gate = component tests + the robot rehearsal (part 4). 
- **Tier B (behavior):** stores/services/Rust touched → full gate + real-Windows verification (unchanged from today).
- The coordinator classifies at merge time; a diff-path heuristic assists (src/ui tokens vs components vs platform).

### 4. Robot rehearsal (the 6-step demo path, scripted and unattended)
- Script the DEMO-V1 critical path end-to-end against handles (Playwright browser-mode where possible + the desktop-drive/CDP flow for Tauri-only steps; meeting step can run in a reduced "join+card visible" form on bench-2's VB-CABLE audio).
- Target: ~15 min unattended, green/red verdict + screenshots per step, runnable on the Legion or a cloud bench after ANY change.
- Visual-regression snapshots of the key screens ride along (catch unintended visual breakage cheaply).

## Sequencing (post-demo)
1. Demo passes → stamp runbook → open merge window (swallow-p0 → connector-parity → reindex-swap → localai-trimming → ui-simplification after Jameson's gallery OK → qa93 after swallow).
2. THEN build parts 1+2 (one lane each, parallelizable), then 4 (uses the handles), then adopt 3 as standing gate policy in the coordinator playbook.
3. Only after the foundation lands: the next UI iteration rounds begin (cheap from then on).

## Why this works (one line each)
Handles = tests grip what never moves. Tokens = repaints can't touch machinery. Tiers = re-testing effort matches change size. Robot = "test it all again" costs 15 unattended minutes.
