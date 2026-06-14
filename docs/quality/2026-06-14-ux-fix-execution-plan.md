# Keepance — UX-Fix Execution Plan (2026-06-14)

> **STATUS: COMPLETE.** Waves A-F + the attachment backend all shipped, verified (typecheck 0,
> full vitest 3190 passed, cargo 457 passed, live visual sweep clean), and merged to `keepance-3.0`.
> The only deliberately deferred items are the full matter-hub restructure and its companions,
> captured in `2026-06-14-matter-spine-future.md` for a Jameson-greenlit follow-up. NOT deployed.

> **Autonomous execution tracker.** Jameson authorized a full autonomous pass to fix EVERYTHING
> in `2026-06-14-first-time-ux-review.md`, in priority order, without stopping. This doc is the
> compaction-proof source of truth. If context is reset, **resume from the first unchecked item.**
>
> **Branch:** `feature/ux-fixes-2026-06-14` (off `keepance-3.0`). Backup tag: `pre-ux-fixes-2026-06-14`.
> **Boundary:** implement + verify + merge to `keepance-3.0`. **DO NOT DEPLOY** (commercial; needs Jameson's explicit go).
> **Rules:** light theme; no em-dashes in user-facing copy; first-person voice; verify on the LIVE dev server
> (`--kp-navy` non-empty + zero page errors); subagents NEVER run git; commit each verified wave before the next.
> **Model policy:** Opus 4.8 (me) orchestrates+reviews; Sonnet subagents implement; commit between parallel batches.

## Verification gate (every wave)
- `npm run typecheck` → 0 errors
- Targeted Vitest for touched areas; full `npm run test` at wave boundaries
- `npx eslint <touched files>` clean (pre-existing backlog unchanged)
- Playwright on live `npm run dev`: changed surfaces render, `--kp-navy` non-empty, zero pageerror
- `cargo test` only if Rust touched

---

## WAVE A — Table stakes: the two bugs + low-risk polish  ☐
- [ ] **B1. "New matter" does nothing.** `ReimaginedMattersHome` dispatches `keepance:open-matter-manager` but no listener exists. Wire a listener in `App.tsx` that opens `MatterManagerDialog` (the canonical creator). Verify clicking either New-matter button (header + empty state) opens the dialog.
- [ ] **B2. Opening an email shows nothing.** Full-page Email surface bypasses `MainPanel`, where the opened email tab renders. Fix: when `keepance:open-email` fires (or on row "Open"), switch `sidebarActiveTab` to the editor view (`'files'` / Documents, which renders `MainPanel`), so the `EmailViewer` tab is visible. Verify Open shows the email.
- [ ] **A3. Compose "SUBJ" → "Subject"** in the new-email modal.
- [ ] **A4. Compose: add an attach (paperclip) affordance** (email list shows attachments; compose has none). If full attach plumbing is heavy, ship the control wired to file-pick + note "attachments send-side" honestly; do not fake it.
- [ ] **A5. Formatting toolbar by file type.** `.txt` shows only relevant controls (no H1/H2/H3/Preview that do nothing); `.md` full; `.docx` Word-appropriate.
- [ ] **A6. AI Audit description**: lead with the benefit; drop "0 entries total" from the description paragraph (counts belong in the results area). (Will also be renamed in Wave B.)
- [ ] **A7. Trust bar truncation** ("On your machine. Nothing leav...") → a sentence that fully fits; add hover tooltips to the two icon buttons.
- [ ] **A8. Status bar**: clear the stale breadcrumb when switching between unrelated surfaces; don't show the "Privileged matter: outside connections are blocked" badge when there is no active matter.
- **Commit:** `fix(ux): wave A — dead New matter + invisible email open + compose/toolbar/trust-bar polish`

## WAVE B — Language & naming pass  ☐
- [ ] **L1. "Associate" → "Workflows"** everywhere user-facing (nav label, license-unlock copy, tour step, any subtitle). Keep internal tab id `workflows`.
- [ ] **L2. "AI Audit" → "Activity Log"** everywhere (nav label, header, tour, license copy). Audit filter "AI / Egress" → "AI Requests".
- [ ] **L3. "Ask" clarity** — relabel nav to **"Search"** (keep internal id `search`); align the surface heading/subtitle so it's clear it searches *your files/matters*.
- [ ] **L4. Confidentiality: 3 modes → 2 visible plain states.** Trust bar / egress: "On your machine. Nothing leaves." and "Sent to your [provider] account." (drop "Direct"/"your key"). Fold **Assured** into firm-tier settings; stop showing it greyed-out ("Needs admin key") to solo users. Keep the architecture; simplify the *visible* surface.
- [ ] **L5. Jargon purge (user-facing copy only):** egress→"AI request"/"sent to AI"; "API key"→"account key" (make Settings match onboarding); "workspace" (the folder)→"folder"; tokens/"context is full"/"compress"→plain ("this conversation is getting long" / "shorten history and send"; reassure nothing is deleted); the security sense of "Privileged matter"→"Network lockdown"/"Isolated" (leave the legal attorney-client *privilege* tagging intact); strip "Markdown", "embedding vectors", "MCP write blocked"→"External AI write blocked", "RAG".
- **Watch:** update tests asserting old labels/testids; keep `data-testid`s stable where tests rely on them (rename label text, not necessarily ids).
- **Commit:** `refactor(ux): wave B — plain-language nav + 2-state privacy + jargon purge`

## WAVE C — First-run funnel  ☐
- [ ] **F1. AI-key step**: make "Set this up later" the primary action; add a cost anchor ("$2–5/month for most"); cut the "copy IMMEDIATELY / shown ONCE" panic copy; move "turn off training" out of onboarding into a post-setup privacy note.
- [ ] **F2. Firm step for solos**: heading not "Invite firm members" when signed-out; "I practice alone, skip this" as the big top action; firm sign-in secondary.
- [ ] **F3. Done step**: one primary action "Create your first matter"; reconsider sample-files default+copy; if AI not connected, replace "try the AI" with an accurate next step.
- [ ] **F4. Cold landing copy**: "scope AI retrieval to their work only" → "Keep a client's documents and emails together"; soften the trial "Upgrade" pressure on first launch.
- [ ] **F5. Setup checklist** (AI / Email / Done, live-derived) surfaced at the TOP of the first screen the user lands on (Settings → General and/or a dismissible card on the Matters empty state), not buried under Settings → Onboarding.
- [ ] **F6. "Where your data goes" step**: replace the 10-row accordion with 3 plain bullets + "read the full data map" link.
- **Commit:** `fix(onboarding): wave C — first-run funnel (key-later, solo-first, one CTA, setup checklist)`

## WAVE D — The aha moment (highest leverage)  ☐
- [ ] **A1. Instant cited answer on sample data, before any setup.** Pre-load + index the sample matter ("Garcia v. Meridian Properties") on first run; make Ask answer its suggested questions immediately. Since a brand-new user has no AI key, deliver the aha WITHOUT requiring one: ship a small set of pre-baked, citation-backed demo answers for the sample matter's example questions (clearly a guided demo), so the first cited answer is felt in <2 min. Include a finished Associate output deliverable in the sample matter as proof.
- [ ] **A2. Re-sequence onboarding** so value precedes the key: profession → workspace → **try the sample (instant cited answer)** → connect email → AI key (as the upgrade) → done. (Finalizes F1's placement.)
- **Commit:** `feat(onboarding): wave D — sample-matter aha moment before setup`

## WAVE E — Consistency & simplification  ☐
- [ ] **C1. Unify search grammar**: AI prompt always bottom; keyword search an identical toolbar field across Ask/Email/Documents.
- [ ] **C2. Consistent primary-action placement** across all surfaces.
- [ ] **C3. Combine the two status bars** (trust bar + status bar) into one bottom strip (left=trust, center=context, right=account/upgrade) preserving all info; reclaim vertical space.
- [ ] **C4. Documents persistent split** — file list left + document right (no browser↔editor toggle that loses place; drop the tiny "‹ Documents" link).
- [ ] **C5. Email "Ask AI" mode** — add a headline + 2–3 email-specific example prompts (match main Ask); fix the truncated placeholder.
- [ ] **C6. Combine the two "Ask" experiences** (Ask tab + Email Ask AI) into one "Ask anything" with a scope toggle (All matters / This matter / Email / Documents). Sequence after C1; coordinate with Wave F.
- [ ] **C7. Word-native surfacing** on the Documents empty state (tagline: track changes, AI redline; "New Word document" as primary).
- [ ] **C8. Associate orientation** — show category count / a horizontal practice-area filter so the 56-item library has an obvious entry.
- **Commit (per sub-item or small groups):** `refactor(ux): wave E — unified search, one status bar, persistent docs split, ...`

## WAVE F — Structural: matter as the felt spine  ☐
- [ ] **S1. Matter-as-spine.** Entering a matter shows its documents, email, and a matter-scoped Ask together, instead of six parallel tabs. **Highest risk** — large IA change. Approach: implement behind the reimagined shell carefully with heavy verification; if it cannot be done safely in this autonomous pass without destabilizing the shell, ship the strongest safe increment (e.g., matter-scoped entry points into Ask/Documents/Email + "Running in: <matter>" context) and DOCUMENT the remaining full-spine work precisely. Do not leave the shell broken.
- [ ] **S2. Associate matter-scoped entry** ("Running in: <matter>", surface the most relevant workflows) — folds into S1.
- [ ] **S3. Celebrate "Privileged/Isolated matter"** — confirmation + shield moment when enabled (overlaps L4/C3).
- **Commit:** `feat(shell): wave F — matter-scoped spine`

---

## FINAL
- [ ] Full `npm run test` + `cargo test` green; typecheck 0; lint clean on touched files
- [ ] Live dev-server visual sweep of every surface (no pageerror; `--kp-navy` ok)
- [ ] Merge `feature/ux-fixes-2026-06-14` → `keepance-3.0`; push; prune branch
- [ ] Update `CHANGELOG.md` + this plan's checkboxes + the project memory
- [ ] **NOT deployed.** notify-jameson DONE with what shipped + what (if anything) was scoped down and why
- [ ] If S1 was partial: a crisp follow-up note of exactly what remains

## Resume note
Each wave is committed on `feature/ux-fixes-2026-06-14`. To resume after compaction: `git log --oneline` to see which waves landed, then continue at the first unchecked box above. The detailed rationale for every item is in `2026-06-14-first-time-ux-review.md`.
