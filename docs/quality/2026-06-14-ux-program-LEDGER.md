# Keepance UX Program — Master Ledger

> The single source of truth for the first-time-user UX program. Every idea is recorded here
> with a status, so nothing is ever lost. Updated each round. Companion docs:
> - Round 1 review: `2026-06-14-first-time-ux-review.md`
> - Round 1 plan: `2026-06-14-ux-fix-execution-plan.md`
> - Deferred structural work: `2026-06-14-matter-spine-future.md`
> - Round 2 review + plan: `2026-06-14-ux-review-round2.md` (added in Round 2)
>
> Status legend: ✅ shipped · ⏸️ deferred (needs greenlight) · 🔭 open/residual · 🔁 carried to next round

---

## ROUND 1 — shipped to keepance-3.0 (merged `ae8fae5`, NOT deployed)

Gates at merge: typecheck 0 · vitest 3190 passed · cargo 457 passed · live visual sweep clean.

### Bugs fixed ✅
- **New matter button was a no-op** — dispatched `keepance:open-matter-manager` with no listener; App.tsx now opens MatterManagerDialog.
- **Opening an email showed a blank page** — full-page Email surface bypassed MainPanel, and a fragile `setTimeout` cleanup cancelled the Documents editor-advance; fixed by adding `'email'` to `REAL_FILE_TYPES` + a ref-guarded direct `setViewMode`, and navigating to the editor on open.

### Plain language ✅
- Nav renames: **Ask→Search**, **Associate→Workflows**, **AI Audit→Activity Log** (internal ids + testids unchanged). Audit filter "AI / Egress"→"AI Requests".
- Confidentiality: **3 modes → 2 plain choices for solos** ("On this computer only" / "Cloud AI, your account"); **Assured hidden unless in a firm** (no more greyed "Needs admin key").
- Egress label "Direct to <P> (your account)" → "Sent to your <P> account".
- Security "Privileged matter" → "Isolated / Network lockdown" (kept distinct from attorney-client privilege).
- Jargon purge (user copy + en.json): egress→"AI request", **API key→account key** (Settings now "AI Account Keys"), workspace→folder (selector/license only), tokens/"context is full"/"compress"→plain, "MCP write blocked"→"External AI write blocked", stripped "Markdown" and the "embedding vectors" caveat.

### First-run funnel ✅
- AI-key step: **"Skip for now" is the dominant default**, honest cost anchor ("$2 to $5 a month"), cut the "copy it ONCE" panic, removed the "turn off training" step from onboarding.
- Firm step greets solos: "How do you practice?" + dominant "I practice alone, skip this".
- Done step: one CTA ("Create your first matter") + honest no-AI note; sample toggle reworded.
- Cold landing: plain empty-state copy (dropped "scope AI retrieval"); trial chip calm, no corner upsell on first launch.
- **Get-started setup card** (live AI/email status) on the Matters empty state, deep-links to Settings.
- "Where your data goes" step: 10-row accordion → **3 plain bullets** + "Read the full data map" link.

### The aha moment (flagship) ✅
- **A brand-new user with NO AI key gets a cited answer on day one.** `sampleMatterDemo.ts` ships 3 pre-baked, citation-backed answers over the "Garcia v. Meridian Properties LLC" sample; citations open the real file (Verified badge, excerpt, "Open in editor").
- matterStore `isSample` + `getOrCreateSampleMatter`; ReimaginedAsk has a no-cloud-key demo branch; sample-matter chips auto-submit; post-onboarding lands you in that Ask.

### Consistency & simplification ✅
- Status bars de-duplicated + tidied; egress trust line never clips; **stale breadcrumb fixed** (hidden on non-editor surfaces); matter scope shown once.
- Email "Ask AI" mode: headline + explainer + 3 example chips + fixed placeholder.
- Documents empty state sells Word-native value; "New Word document" primary.
- Workflows library: horizontal practice-area filter (hidden for single-category law persona).
- Editor toolbar context-sensitive to file type (.txt/.md/.docx).

### Matter spine (safe increment) ✅
- **Matters launchpad**: each matter has Ask / Documents / Email quick-actions (`keepance:matter-launch`) that set it active + jump scoped to it.
- Workflows shows "Running in: <matter>".

### New capability ✅
- **Email attachment send** across Microsoft 365 (Graph fileAttachment), Gmail + IMAP/SMTP (multipart/mixed). Compose paperclip + removable chips. (End-to-end send needs the one-time scope re-consent on real hardware.)

---

## ⏸️ DEFERRED — needs Jameson's greenlight (full detail in `2026-06-14-matter-spine-future.md`)
- **S1 — Full matter hub.** Entering a matter opens a hub whose Ask/Docs/Email/Workflows are all pre-scoped to it; top-level nav collapses. Fundamental nav-model change; design with Jameson first.
- **C4 — Persistent Documents split.** File list left + document right (Finder/VS Code style), no browser↔editor toggle. Reworks Wave A view logic; do deliberately.
- **C6 — Unify the two Ask experiences** into one "Ask anything" with a scope toggle (All / This matter / Email / Documents). Best done with the hub.
- **C2 — Consistent primary-action placement** across every surface. Low individual value, spread risk; fold into hub.
- **S3 — Celebrate the Isolated matter.** A confirmation/shield moment when network lockdown is enabled (badge already exists).

## 🔭 OPEN / RESIDUAL
- Email send (incl. attachments) verified by plumbing + tests only; **needs a connected account + one-time scope re-consent on real hardware** for true end-to-end proof.
- Demo answers cite a single sample file (Matter Overview); could be richer (cite Client Intake too) and cover more question phrasings.
- The matter launchpad quick-actions are hover-revealed (discoverable on hover; fine on desktop, worth noting for touch).

## Raw reviewer ideas worth keeping (from the 4 Round-1 lenses, not all actioned)
- Onboarding: workspace path strings were Unix-jargon (`~/Documents/...`) — partly addressed via folder language; verify the picker copy.
- Settings has ~20 categories — the setup checklist now fronts it, but the category list itself is still long (future IA pass).
- Strategic: the unique value (Word-native, matter isolation, privilege enforcement) is still under-surfaced outside the moments we added; a "second wow" + returning-user habit loop is the next frontier.
- Proof moat (named attorneys, DPA/SOC2) is Jameson-owned, not a code task.

---

## ROUND 2 — (appended after the Round 2 review below)
