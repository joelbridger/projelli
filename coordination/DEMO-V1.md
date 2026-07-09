# DEMO V1 — the north star (Jameson, 2026-07-05, from `Demo V1 Requirements.png`)

**Goal: a working, safe demo Jameson can drive through this EXACT critical path. Get every step to GREEN ASAP.**
The running Legion E2E test (cc-lantern-winsmoke) is the DEMO READINESS SCORECARD — realigned to this exact path.

## Critical path (all 6 must PASS)

| # | Step | Requirement | Status / notes |
|---|------|-------------|----------------|
| 1 | **Connect AI** | **ChatGPT (OpenAI) AND on-device Local AI** are critical (Claude/Gemini optional) | Providers exist: OpenAIProvider.ts ✓, AppLocalProvider.ts (bundled llama.cpp "Advisor Prep Hero Local AI") ✓. VERIFY connect-flow works for both. |
| 2 | **Connect Data** | **Outlook, OneDrive, Wealthbox** (other connectors optional) | Connectors exist (email/onedrive/crm). Wealthbox import fix (QA-74) just merged. VERIFY all 3 connect + import. |
| 3 | **Progress Screen** | The app ACTUALLY SHOWS download/import progress as data connects | useAccountSync + per-connector Connect components exist. VERIFY a clear progress UI is shown — likely the biggest UX gap to check. |
| 4 | **Ask** | Ask with **ChatGPT AND Local AI** about the connected data, **as it comes in** (partial/streaming import, not only after) | Ask + RAG isolation verified solid (no cross-client leak). VERIFY ask-during-import + both providers. |
| 5 | **Record Meeting** | Record a **Teams** meeting; the **in-meeting card shows recording** (Meet/Zoom optional) | Notice Card built. Meetings fixes merged. VERIFY Teams record + card appears live. |
| 6 | **Search Transcript** | Transcript safely kept + searchable via **ChatGPT or Local AI** | Confirmed: transcript.json + notes.docx ARE indexed into Ask (via watcher) — QA-88 = add explicit index-on-write for reliability. VERIFY search works. |

## Optional (nice-to-have, NOT demo-blocking)
Connect AI: Claude, Gemini. Connect Data: other connectors. Record: Google Meet, Zoom.

## NOT in the demo (de-scope for now)
Draft-emails-with-AI (was in Jameson's earlier verbal list, NOT in the graphic). Firm/co-edit. Client Map polish beyond what the flow needs.

## The loop to green
winsmoke scorecard → for every BROKEN/CANT-TEST step, spawn a fix immediately (Codex/worker) → re-test that step → repeat until all 6 GREEN. Then a clean 3× demo dry-run on real Windows.

## Robot coverage plan

`scripts/robot/smoke.mjs` is the real Windows done-gate. A green demo run must cover this whole list, not just the older reset/open/sweep/Ask/isolation chain.

The bench smoke also includes a real Local-only privacy tripwire: it switches the app to **On this computer only**, installs the whole-app cloud-AI blocker before walking Ask/Workflows/Clients, and fails the run if any cloud AI URL is touched.

| Demo area | Robot proof required | Current automation status |
|---|---|---|
| AI setup | Open AI setup, prove OpenAI/ChatGPT is connected or can be connected, prove Local AI is installed/ready, then ask with both. | Planned: older smoke only asks once through the seeded provider path. |
| Outlook | Connect/import Outlook mail and prove imported mail appears in client-scoped Ask/search. | Planned. |
| OneDrive | Connect/import OneDrive files and prove imported files appear in client-scoped Ask/search. | Planned. |
| Wealthbox | Connect/import Wealthbox households, show household import counts, and prove one client maps to imported CRM data. | Partly covered by bench-smoke Wave 2 queue checks; Demo V1 needs full connect/import proof. |
| Import progress | While Outlook/OneDrive/Wealthbox import, prove the progress screen updates instead of waiting silently. | Planned. |
| Ask during import | Ask a question while import is still running and prove partial data can be cited without waiting for the full import to finish. | Planned. |
| Meeting recording | Start and stop a Teams meeting recording, then prove the meeting artifact exists. | Planned; current bench has P0 stubs that now count as incomplete, not green. |
| Notice Card | During the Teams recording, prove the in-meeting Notice Card is visible and says recording is active. | Planned. |
| Transcript search | After recording/transcription, ask/search for transcript content and prove citations open the transcript/notes source. | Planned. |

## Demo-specific things to verify/likely-fix (beyond the trust-breakers already merged)
- **Progress screen** clearly shows import progress (step 3) — most likely gap.
- **Ask-as-it-comes-in** (step 4) — can you query partially-imported data?
- **ChatGPT + Local AI** both work end-to-end (not just Claude, which we'd been testing).
- **Teams recording + card live** (step 5).
- QA-88 (explicit transcript index-on-write) for reliable step 6.
