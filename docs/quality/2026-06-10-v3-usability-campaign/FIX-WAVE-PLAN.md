# Phase 7: Fix-Wave Triage & Plan

Consolidates all campaign findings (Phase-0 reviews F-001..F-011, sweep F-201..F-210, persona F-101..F-128, leak F-301) into dispositioned work packages. Branch `keepance-3.0`. The fix wave runs as coordinated subagents AFTER the leak fix (F-301) lands, then full regression, then v3.1.0 RC.

## Triage principle

Many persona "desktop-only" findings are the browser build hitting genuine Tauri-only features (RAG, OOXML editing, mail, contradiction-finder). For those, the **bug is the silent/confident degradation**, not the missing capability. The native pass confirms desktop behavior; the fix wave makes every boundary loud and honest. Capability gaps that are real on ALL platforms (Ollama-in-workflows, docx tables) get built.

## Already fixed (front-run during the campaign)
- F-001 website icons → Advisor Prep Hero mark · F-003 icns brand guard · stale CLAUDE.md reconciled (committed).
- F-203 (wrong template test IDs), F-002 partial (no in-app language picker → reclassified F-208).

---

## WP-1 — P0 silent-failure + egress cluster (workflow/AI provider resolution). HIGHEST PRIORITY.

Owner files: `src/App.tsx` (workflow provider chain ~2337-2414), `src/components/ai/AIChatViewer.tsx`, `src/modules/memory/MemoryService.ts`, `src/utils/tauri-commands.ts`, workflow execution UI. COORDINATE: the leak fix touches MemoryService/useMemoryWiring/rag — WP-1 starts only after the leak fix is committed.

- **F-106 (P0):** A workflow with no real provider must NOT present MockProvider output under a green "Complete". Gate execution: if the resolved provider is the mock (no key and no reachable local model), refuse with a clear "This workflow needs an AI provider — set one up or pick your local model" state, never a success with "This is a mock response." MockProvider stays available only under explicit testMode.
- **F-107 (P0, egress-correctness):** Add the Ollama branch to the workflow provider chain so a template pinned to local actually runs local. A local-pinned template must NEVER fall back to a cloud key — if Ollama is unreachable, error loudly; do not silently egress. This is the data-correctness core of the P0.
- **F-116 (P1, trust-critical "Avianca trap"):** When workspace retrieval fails/unavailable, the chat must NOT return a confident ungrounded answer with a small warning. Either refuse ("I couldn't search your workspace, so I won't answer from your matter") or render the answer unmistakably as ungrounded with no fabricated citations. Applies regardless of platform.
- **F-117 (P1):** AI answers must carry click-through citations when grounding exists (parity with Search). Largely downstream of F-116 + native RAG; verify on the native pass.
- Regression tests: provider-resolution unit tests (no-key→refuse; local-pin→ollama-or-error-never-cloud); a chat test asserting retrieval-failure never yields confident-with-citations.

## WP-2 — Word deliverable fidelity
- **F-108 (P1):** `markdownToDocxBytes` must convert markdown pipe tables to real `<w:tbl>` Word tables (the intake template's conflict-check table is the centerpiece). Test: a table round-trips to ≥1 `<w:tbl>`, zero literal `|` rows.
- **F-112 (P2):** 17/18 legal templates still write SCREAMING_SNAKE `.md`, not `.docx`. Align legal-pack deliverables to Word-native per 3.0 positioning (or document why any stays markdown).

## WP-3 — Trust copy + matters navigation (firm-sale blockers, low-effort/high-value)
- **F-119 (P1):** Replace the developer's real name "Jameson" in privacy/telemetry/unsubscribe/bug-report copy with "Advisor Prep Hero" / a support alias, all locales (`src/locales/{en,de,es}.json`). Diane: "that one line could lose you the firm sale."
- **F-122 / F-009 (P1):** Give Matters a first-class sidebar entry (mount MatterManagerDialog from a sidebar item and/or the status-bar matter widget), not only the AI-chat header.
- **F-104, F-105, F-109, F-115, F-118, F-120, F-124, F-103, F-102, F-128 (P2/P3 copy/UX):** plain-English Privileged Matter Mode pill; BYOK steps mention provider training opt-out; estimate modal shows $0 for local/mock; strip the dev command from the MCP card; positive cloud-egress signal in Direct mode; de-jargon the firm admin console; "license" spelling; first-run folder-idiom copy; Upgrade→pricing ordering. Batchable copy pass.

## WP-4 — Integration & firm honesty
- **F-113 / F-114 (P1/P2):** Disclose the desktop-only requirement on ALL email cards (M365/IMAP, not just Gmail) BEFORE taking a password; add Outlook/M365 app-password guidance.
- **F-123 / F-010 (P1):** Make the firm member's first-open key handshake non-silent: a clear "waiting for your firm admin to grant this device access" state instead of a 404-looking break; ideally auto-publish on member device registration.
- **F-110, F-111, F-125, F-124 (P2/P3):** workflow "Generating…" vs idle; double InterviewForm; shared-notes raw matter-id in title; admin-console ids.

## WP-5 — Native-pass confirmations (after Phase 6 resumes on the fixed build)
- F-116/F-117 desktop RAG + citation chips; F-126 contradiction-finder (should use pasted excerpts even without RAG; verify it surfaces the 3 planted contradictions on desktop); F-127 tracked-change redline round-trip; F-121 privilege retrieval-exclusion demonstrably enforced; F-004 workflow+split-pane at 1366 in the real WebView.

## WP-6 — Test/tooling hygiene (non-product)
- **F-210 (P2):** `horizontalOverflow()` helper must skip elements inside `overflow:hidden/-x:hidden` ancestors (kills the F-201/F-202/L-140/L-216 false positives).
- F-005 accordion aria + arrow keys; F-007 per-step onboarding testids; F-008 open-in-explorer test comment; F-006 PaneScrollable consolidation; F-209 axe-core not installed (decide: install dev-only or accept manual a11y).
- **F-011 (P2):** regenerate website og-image.png with 3.0 positioning.

## Sequencing
1. Land + verify F-301 leak fix (in progress). 2. WP-1 (P0s) solo-ish given file overlap with the leak fix. 3. WP-2/3/4/6 in parallel (disjoint files). 4. Full regression (tsc/vitest/cargo/bun/no-em-dash) + re-run affected persona+firm journeys. 5. Resume Phase 6 native pass on the fixed build → WP-5. 6. v3.1.0 RC: version bumps + CHANGELOG + tag + CI signed build. 7. Auto-deploy (pre-authorized): publish release, deploy site (incl. WP-3 copy + WP-6 og-image + F-001 favicons), deploy firm backend with the new env. 8. Launch-readiness report + notify.

## NOT in the fix wave (recommendations / Jameson decisions)
- LemonSqueezy Firm min-quantity mechanics (Firm card stays "Talk to us").
- Live multi-user .docx co-editing (post-launch increment per the spike gate).
- Design-partner recruiting; SOC 2 / DPA execution.

---

## Progress

### Wave A — COMPLETE + committed (2026-06-10)
- **WP-1 (P0s):** F-106 (no silent mock/false-green), F-107 (egress-correct provider resolution, regression-locked via the new pure `resolveWorkflowProvider`; controlled-revert proven), F-116 (refuse on failed AND empty retrieval). F-117 deferred to native pass. + 2 display P2s (folder litter, cross-tab error bleed).
- **WP-2:** F-108 (markdown→Word tables), F-112 (17 legal templates → .docx).
- **WP-6:** F-210 (overflow-helper clip-awareness → F-201/F-202 resolved), F-005 (accordion a11y), F-007 (per-step testids), F-008 (test comment), F-011 (3.0 og-image).
- Gates: tsc clean, 2747 vitest pass. Three commits on keepance-3.0.
- Pre-front-run earlier: F-001 (site icons), F-003 (icns guard), F-203 (template test IDs), stale CLAUDE.md.

### Wave B — pending (this turn): WP-3 (trust copy incl. F-119 name leak + matters nav F-122/F-009 + copy/UX batch) and WP-4 (integration desktop-only disclosure F-113/F-114 + firm silent-handshake F-123/F-010). Sole locale writer per wave.

### Still open after Wave B → native pass (WP-5): F-116/F-117 desktop citation chips, F-126 contradiction-finder, F-127 redline round-trip, F-121 privilege exclusion, F-004 workflow+split-pane in the real WebView.
