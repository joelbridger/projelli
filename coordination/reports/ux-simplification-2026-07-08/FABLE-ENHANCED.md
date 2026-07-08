# Lantern UX Simplification — Enhanced Audit (Fable pass, 2026-07-08)

*This builds on the seven Codex screen audits and SYNTHESIS.md in this folder. Codex read the code; this pass fact-checked its claims against the code AND looked at live screenshots of every screen (sample data, browser dev mode, 1440x900). Read SYNTHESIS.md first; this file only records what changed: the verdict, new findings, corrections, and the build plan.*

## 1. Verdict on the Codex audit

**Keep it. Roughly 90% of it goes straight into the build.** Spot-checks of its file/line claims all verified (dual scope pills in Ask, Files/Trash double navigation in Documents, duplicate file chip in the status bar, 62 visible "Advisor Prep Hero" strings in en.json plus 10 in onboarding copy). The do-not-touch lists correctly protect every trust signal. Impact ratings are sane. The five synthesis themes are the right ones.

What it structurally could not do: see the rendered app. Every new finding below came from looking.

## 2. New findings (not in any Codex audit)

**F1 — Contradictory trust pills on one screen (worst finding; fix first).**
On Ask, the top bar says "No AI connected" while the Ask header simultaneously shows a green "Using local AI" pill. Two different components compute egress state independently. A trust indicator that disagrees with itself is worse than no indicator. Fix: ONE egress source of truth, rendered ONCE (top bar). Per-surface egress pills (Ask header, Client Map header, Workflow template detail) are removed, not shortened. The Workflows screen currently shows "No AI connected" three times.

**F2 — The All Clients home screen was never audited.**
`MattersHome.tsx` (1,234 lines): every client row carries five always-visible quick-action buttons (Ask, Documents, Email, Meetings, Activity) plus a row menu — the exact theme-1 violation the audits flagged everywhere else. Also: on first open the right pane is a dead "Click a client on the left" message; make All Clients (or the client's Map) the actual landing surface. Activity Log was also unaudited (small; fold into the chrome lane as a quiet pass).

**F3 — Red means three different things.**
The brand accent (red/pink) marks selected tabs, primary chips, AND destructive "Remove" links. The Client Map shows six red "Remove" links on a calm reading page — it reads as alarm. Rule: accent = selection/primary only; red = destructive/error only; destructive actions live in row menus (audit already moves them there — this makes the *why* explicit and adds a check to the design QA wave).

**F4 — Client rail labels are noisy and truncate badly.**
"The Brennan Household - Brennan..." — the label repeats the household name in a suffix and then truncates. Show the display name only; put the rest in the tooltip.

**F5 — Empty rail columns.**
Client Email/Meetings tabs render a bare left column ("Email", "Meetings" + dead space) when there is no data, doubling the empty state that the right pane already shows. When a rail has zero items, show its one empty hint inside the rail OR collapse the rail — never two empty panes side by side.

**F6 — Workflows Run is visually weak.**
The audits say "make Run the only strong action" — on screen, Run is an *outline* button, weaker than the filter chips above it. Run becomes the one filled primary button on that surface.

**F7 — Pluralization bugs read as sloppiness.**
"0 required inputs", "1 outputs" as gray badge rows (they also look like disabled buttons). The metadata-row consolidation (workflows audit #4) must use proper i18n plural forms; add a plural check to the copy lane.

**F8 — The trial banner floats over content.**
Amber "Free trial, 30 days left" sits in the bottom-right on every screen. Chrome audit item 17 already moves it to the account menu until it is urgent; confirmed visually, promote to the chrome lane's must-do list.

**F9 — Onboarding intro can't be reached in test mode** (`forceOnboarding` skips it by design). The onboarding lane must verify the intro simplification by running the real first-run path, not the test flag.

## 3. Corrections to Codex recommendations

**C1 — Don't hide AI search in Email behind a sparkle icon** (email audit #8). Board stance: Lantern competes as the AI-first advisor app; AI entry points get MORE prominence, not less. Do simplify the teaching copy and hide scores/raw IDs (keep #7). Longer term (NOT this build, Jameson decides): Email AI search should simply *be* Ask with the email scope — one AI door for the whole app, since Ask already has an email scope. Same question later for Client Map's guided interview.

**C2 — Replace item-count thresholds with consistent collapsed-by-default patterns.** Several recommendations gate visibility on counts ("show search after 8+ conversations", "expand search when more than seven clients"). Threshold UI is its own complexity: the screen changes shape as data grows and users can't build habits. Rule: search fields in rails are ALWAYS an icon that expands on click/typing, regardless of count. Same everywhere.

**C3 — "New question" in Ask: compact `+ New` row, not icon-only.** Asking is the product's core action; don't reduce its discoverability to a bare icon (audit #10 offered both; we pick the labeled compact row).

**C4 — Copy rewrites are approved as written, with one addition:** the sweep also replaces the old mascot/wordmark asset top-left (it still renders "Advisor Prep Hero" with the old character logo) with the Lantern mark, per the existing brand assets. Copy tone: sentence case, no ellipses, no em dashes in UI strings (house rule, tested by the gate).

## 4. Build plan (all lanes land on preview branch `lp/ux-simplify-v1`; nothing touches the live app until Jameson approves)

| Lane | Scope | Model |
|---|---|---|
| L0 foundation | TrustNote (trust-ladder) + QuietStatus primitives, single-source egress (F1), red-usage rule (F3) | Opus 4.8 |
| L1 chrome + settings + onboarding | chrome-settings.md items + F8 trial chip + Activity Log quiet pass | Sonnet 5 |
| L2 ask | ask.md items + owns SourcePanel flattening (shared with Client Map) + C3 | Sonnet 5 |
| L3 client map | clientmap.md items (consumes SourcePanel from L2) | Sonnet 5 |
| L4 documents | documents.md items | Sonnet 5 |
| L5 email | email.md items with C1 correction | Sonnet 5 |
| L6 meetings | meetings.md items incl. the send-flow merge (review-gated send is correctness-critical) | Opus 4.8 |
| L7 workflows | workflows.md items + F6 + F7 | Sonnet 5 |
| L8 copy sweep + All Clients | Global rename sweep (62+10 strings, F2 MattersHome cleanup, F4 labels, plural forms, i18n snapshot hygiene) | Sonnet 5 |

Verification: every lane gets an independent adversarial Codex review before merge; coordinator merges serially; one full gate (typecheck + i18n + 7,000+ tests + lint + Rust) on the integration branch; before/after screenshot gallery from the same capture script; preview deployed to the Legion only after gate green.

## 5. Protected (unchanged from SYNTHESIS.md)

Everything in the synthesis "Deliberately kept" list stands. Nothing in F1–F9 or C1–C4 weakens a consent gate, a citation, client isolation, recoverability, or recording rules. F1 *strengthens* the egress signal by making it single-sourced.
