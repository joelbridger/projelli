# UX/UI Evaluation — Advisor Prep Hero desktop app
**Author: coordinator (senior-designer pass, Fable), 2026-07-03 · evidence: `keepance-coordination/ux-atlas/` (66 live Windows screenshots @f65ca919), `DRIVE-FINDINGS.md`, bench pass-3 + final reports @9ca325db · brief: Jameson's R21 — "simplify the UI, make it more elegant, so easy that it never gets in the way, that it almost becomes invisible."**

---

## 1. Executive summary

The core of this product — ask a question, get a cited answer you can verify, with an always-visible answer to "did anything leave my machine?" — is **excellent and differentiated**. The citation chips, the "Answered over your own files" attestation, the Sources rail with verified excerpts, the egress pill flipping blue→green with an "Isolated client" toast, and real Word tracked-changes redlining are the best screens in the app and need almost nothing.

What keeps the app from feeling invisible is **everything wrapped around that core**: the same information presented two or three times at once, three separate consent mechanisms, blocked states that look broken instead of asking for what they need, and control-dense surfaces that put every option on screen at all times. None of these are hard problems individually; together they make a simple product feel complicated — the exact opposite of the board's "win on simplicity" stance.

**One-sentence diagnosis: the AI core has earned trust and elegance; the chrome around it hasn't caught up.**

---

## 2. What is genuinely excellent — keep, and amplify

| What | Evidence | Why it matters |
|---|---|---|
| Cited-answer surface: numbered chips, attestation banner, Sources rail with "Verified against source" | 053 | This IS the product's pitch rendered as UI. Nothing else in the category looks like this. |
| Egress indicator + mode toast ("Isolated client: outside connections are blocked") | 070 | Privacy made *visible and felt*, not claimed. |
| AI redline = real Word tracked changes with per-change accept/reject | 046/047 | Meaningfully differentiated vs. every chat-diff competitor. |
| Onboarding fork screen ("sample practice" vs "own data", recommended, benefit bullets, privacy reassurance per card) | 012 | Best-written screen in onboarding; the pattern to copy elsewhere. |
| Two-mode AI picker copy ("On this computer only" vs "Cloud AI (your account)") | 043 | Plain, honest, decision-sized. |
| Indexing banner tone ("Nothing leaves your machine.") | 035 | The trust voice, applied to a boring moment. |

Design principle to extract: **the app is at its best when it shows the user proof instead of asking them to trust labels.** Every recommendation below pushes more surfaces toward that standard.

---

## 3. Systemic findings (ranked by impact on "invisible")

### S1 — The same things are on screen twice (navigation redundancy)
**Evidence:** 031, 035, 053. The left sidebar lists all 26 clients — and the Client Map main view lists the same 26 clients again, side by side. The sidebar renders every client's name **twice** (title + identical subtitle). Each table row carries three permanent buttons (Ask / Documents / Email) — 78 buttons on one screen — while the row itself is also clickable and the client hub has the same three tabs. In Ask, the client sidebar persists even though Ask has its own scope control.
**Why it matters:** duplication is the #1 reason the app reads "busy." It also halves the content width everywhere.
**Direction:** one mental model — *the sidebar is the client switcher; the main area is the workspace.* When the main view IS the client list, collapse the sidebar to icons. Kill the duplicated subtitle line (show a real secondary fact — last activity, doc count — or nothing). Row quick-actions become hover/focus-revealed; the row's primary click opens the hub.

### S2 — Consent is three different systems, and two of them dead-end
**Evidence:** 034/035/041 (Settings-sentence gate), 051 (RightCapital dialog), plus the new Ask banner ("Allow for all / Not now") that shipped this week. The Client Map blocked state is one gray sentence above white space — it *looks broken* (it was mistaken for a bug twice in testing). The sentence tells you to "go to Settings → Privacy" with no button, and the Settings card you must click **already looks selected** (checkmark + "Recommended"), so the fix is undiscoverable. Meanwhile Ask now has a proper in-place consent banner — so the app currently mixes one good pattern and two bad ones.
**Why it matters:** consent moments are where a privacy-first product either earns trust or feels bureaucratic. Three inconsistent mechanisms is the "note-taker with settings" feel we're positioned against.
**Direction:** **one consent component, used everywhere.** The Ask banner pattern (clear question, Allow-for-scope / Not-now, remembered per scope, visible state afterward) becomes the single gate for Client Map builds and document redline too — rendered *in the blocked spot, at the moment of need*, never as a sentence pointing at Settings. The RightCapital-style per-source dialog stays (it's good, specific disclosure) but visually inherits the same component family. Settings keeps only the *mode* choice (local vs cloud); it stops doubling as a hidden consent lever. Selected vs. confirmed states must be visually distinct.

### S3 — Blocked and empty states don't say what they need
**Evidence:** 035 (blank Client Map), 036 (email empty state is decent copy but no action), pass-2's eternal "Loading email…" (since fixed), 015 ("AI key saved — not verified yet" on the local-AI path). 
**Direction:** adopt a hard **three-state rule** for every content surface: *working* (spinner + what's happening), *needs-you* (one sentence + the action button right there), *honestly empty* (what this will show and the one next step). The blank-map case becomes: "Ready to build the Hollings Family Client Map — [Build map] · Uses your cloud AI." A state that can't name its own next action doesn't ship.

### S4 — Control density: everything visible, all the time
**Evidence:** 053 (five scope pills + a Files-only toggle stacked above the Ask box — seven decisions before typing), 031 (78 row buttons), 042–044 (two-level settings nav + a permanent red "Reset to Defaults" on every page), stacked double headers (workspace bar + client bar) on every screen.
**Direction:** progressive disclosure. Ask scope becomes **one segmented control** (This client · All clients · More▾) with Email/Documents/Files-only as a compact "sources" popover — the 90% case is two choices. Reset-to-Defaults moves inside a menu. The two headers merge into one contextual bar. Settings flattens to a single scrollable page with section anchors + the (already good) search.

### S5 — First-run polish (the five-minute impression)
**Evidence:** 010/011 (primary CTA cut off below the fold at the app's own fixed 1200×800; duplicate overlapping icons colliding with captions), 015 (wrong verification copy for local AI; "Wealthbox — 0 households — Done" reads as failure), 032 (indexing banner counts 77 files while 301 PDFs index invisibly).
**Why it matters:** this is literally the first thing a trial user sees, and it currently contains the app's most visible rendering bug and a hidden primary button. These are small fixes with outsized payoff.
**Direction:** onboarding screens must fit 1200×800 with the CTA visible (compress the hero, or pin the CTA); fix the duplicate-icon render; branch the step-3 copy by AI path; one combined indexing total ("Indexing 378 files — 73 done · Nothing leaves your machine").

### S6 — Trust claims need surgical precision
**Evidence:** 011's trust chips ("Advisor Prep Hero stores none of your data" / "Fully encrypted (AES-256)" / "AI provider is SOC 2 certified").
**Why it matters:** this audience reads claims like a compliance officer. "Stores none of your data" is arguably imprecise (the app stores plenty locally — that's the point); "AI provider is SOC 2 certified" is true of the provider but is one careless read away from "Advisor Prep Hero is SOC 2 certified" — a claim we must never make.
**Direction:** rewrite to precise, prouder claims: "Your data stays on your computer" · "Encrypted on your device (AES-256)" · "Works with SOC 2-certified AI providers (your account)." Legal-review the chip row once, then lock it.

### S7 — Product decision needed: link insertion in the Word editor
Bench pass 3 confirmed "insert link" exists only in the legacy Markdown editor; the Word (.docx) engine — the flagship — has no link tool. Either the Word toolbar grows a proper hyperlink control (engine work) or we accept links-via-AI-redline only. Recommendation: schedule the engine control; it's a table-stakes editor affordance for the format we call first-class. (Ticketed for post-test.)

---

## 4. Change plan

**Wave A — surgical, ship before the installer (small diffs, no layout risk):** onboarding CTA/fold fix · duplicate-icon bug · consent sentence → inline consent component on Client Map + redline (reuse the shipped Ask banner) · blank-map needs-you state · sidebar duplicate-subtitle removal · local-AI copy branch · combined indexing count · trust-chip copy rewrite.

**Wave B — structural, build in the `ui-reimagine` worktree for Jameson's side-by-side review:** single client-list mental model (collapsible icon sidebar, hover row actions) · Ask composer scope redesign · merged contextual header · flattened settings · three-state audit across every surface.

**Wave C — bigger bets, discuss before building:** a true "invisible mode" default — spine reduced to **Clients** and **Ask**, Workflows moved into Ask as suggestions-in-context; the app opens directly into "ask something about your practice" with the map one click away. This is the logical end of the board's "so easy it disappears" instruction, and it's cheap to prototype behind a flag in the reimagine worktree.

**Sequencing note:** nothing in Wave A blocks Jameson's current personal test; Wave B/C wait for his test feedback so his fresh impressions inform them.
