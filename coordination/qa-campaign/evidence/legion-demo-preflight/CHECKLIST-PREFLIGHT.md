# Demo pre-flight — DEMO-RUNBOOK.md "get-ready checklist" executed for real on the Legion

**Date:** 2026-07-06
**Bench:** Legion Windows laptop, app running at tip `4cafb72f` (unchanged from the QA-91 retest — this pass touches app state/settings, not code)
**Runbook checked against:** `docs/demo/DEMO-RUNBOOK.md` (fetched from `origin/lantern-plus`, commit `6ecf94d7`) — "Before the demo: get-ready checklist"

## Result per checklist item

| Checklist item | Status | Evidence |
|---|---|---|
| One demo workspace, set up ahead of time | ✅ PASS | "Beacon Ridge Demo" open, persists across restarts |
| Example clients already loaded | ✅ PASS | 3 households (Hendersons, Alvarez, Nair) registered with folders mapped |
| Clean up the client sidebar | ⚠️ **PARTIAL — real bug found, see below** | `01-clients-table-clean-3-only.jpeg`, `02-sidebar-still-shows-archived-bug.jpeg` |
| All files already "read" (indexed) | ✅ PASS | "3 clients, 3 folders indexed" after cleanup; instant cited answers |
| Q&A crib sheet ready | ✅ PASS (no action needed) | `docs/demo/DEMO-QA-CRIB.md` already exists, unchanged |
| Local AI model downloaded/ready | ✅ PASS | `04-local-ai-installed-ready.jpeg` — "Installed and ready" |
| ChatGPT (OpenAI) key connected + tested | ✅ PASS (after action) | `03-openai-and-anthropic-working.jpeg` — was "Unverified", clicked "Check", now "✓ Working" (Anthropic too) |
| Full restart + warm-up question before anyone arrives | ✅ PASS | Full app kill+restart, then a real warm-up Ask question answered correctly with citation |

## The one real problem: "clean up the client sidebar" can't fully be done via Archive

I did the normal-UI thing the checklist describes: opened the Clients page and clicked **Archive** on all 42 non-Beacon-Ridge test clients (Northcrest households + 2 Winsmoke test clients), leaving exactly 3 in the main **Clients** table — `01-clients-table-clean-3-only.jpeg` shows "3 clients, 3 folders indexed" and only the 3 real households.

**But the app's left-hand sidebar client list is a different, separate list that does not hide archived clients.** After archiving all 42, the sidebar still lists every one of them (confirmed: 51 buttons in the sidebar, vs. 3 rows in the main table) — `02-sidebar-still-shows-archived-bug.jpeg` shows the "Clients" management dialog with the old clients still present, offering only "Restore," not delete, once archived. I traced this to the code: the main Clients table correctly filters out archived clients (`useNonArchivedMatters()`), but the sidebar component (`Spine.tsx`) reads the unfiltered full list (`useMatters()`) instead — so **archiving a client removes it from the main table but never from the sidebar**. This looks like a real, previously-unknown product bug, not something I did wrong.

**I did not go further and permanently delete the 42 old clients** to force the sidebar clean, because: (a) that's a more destructive, less-reversible action than what "archive... via the normal UI" implies, and (b) those old Northcrest/Winsmoke clients may still be referenced by other testers' work — deleting them felt like it crossed from "tidy the demo" into "touch other people's shared test data" without asking first. I stopped and left them archived (safe, reversible) rather than decide that unilaterally.

**Recommendation for whoever owns the final demo script:** either (1) fix the sidebar to also respect archived status (the actual bug, small fix — `Spine.tsx` should use `useNonArchivedMatters()`), or (2) if that's not fixed before the real demo, plan to just not open/scroll the sidebar during the live show (the main Client Map / Ask flows never show the archived names), or (3) explicitly authorize permanently deleting the 42 old clients if a fully clean sidebar is required and shared-history risk is accepted.

## Other checklist feedback (asked for: unclear / wrong / missing steps)

- **"Connect and test your ChatGT key... ask it one test question"** — in practice, the app's own **"Check"** button on the API key (Settings → AI & Privacy → Manage AI Account Keys) is the real mechanism, not a chat question — it flips straight from "Unverified" to "✓ Working" with no need to actually spend a real Ask question on it. Worth updating the wording so a presenter doesn't waste time thinking they need to go ask Chat a throwaway question just for this — the checklist and Step 1 of the demo already describe pointing at the checkmark, but the "get-ready" checklist's phrasing ("ask it one test question to make sure it says yes, working") could mislead someone into over-testing.
- **No checklist step for old test *meeting recordings*.** Separately from clients, my earlier QA-91 retest work left 3 "Needs review" test meeting recordings sitting under The Hendersons' Meetings tab (all failed Notice Card attempts). The checklist has no line item for checking/clearing leftover meeting history under the demo clients — worth adding one, since a presenter accidentally clicking into "Meetings" for a demo client could show stale test recordings.
- **The onboarding tour ("A quick look at the new layout," Step 1 of 11) reappeared on more than one fresh app launch** during my testing — it doesn't seem to reliably stay dismissed across restarts. If the real demo does a "restart once before anyone arrives" per the checklist, worth explicitly adding "dismiss the tour if it reappears" as a sub-step so it doesn't catch a presenter by surprise live.
- Everything else in the checklist was accurate and directly actionable as written — no other gaps found.

## Screenshots

- `01-clients-table-clean-3-only.jpeg` — Clients table after archiving, exactly 3 rows
- `02-sidebar-still-shows-archived-bug.jpeg` — Clients management dialog, archived section still present/visible with old names
- `03-openai-and-anthropic-working.jpeg` — both provider keys "✓ Working" after Check
- `04-local-ai-installed-ready.jpeg` — Local AI card, "Installed and ready"
- `05-post-restart-warmup-question-answered.jpeg` — full restart + warm-up Ask question answered correctly with citation

## State left on the Legion

- App running, Cloud AI mode, tip `4cafb72f`.
- 42 old clients **archived** (not deleted) — reversible via "Restore" in the Clients dialog.
- Both OpenAI and Anthropic keys verified "Working."
- Workspace: Beacon Ridge Demo, 3 clients, files indexed, one warm-up question already asked (harmless, doesn't need clearing before the real demo).
