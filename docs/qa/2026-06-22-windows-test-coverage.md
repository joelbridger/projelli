# Windows live-test coverage — round-4 QA + flagged items + grant (2026-06-22)

Tracks what's been **driven by hand on the real Legion app** vs. covered only by the (green) automated suite. Branch `keepance-3.0`. Legend: ✅ driven live on Windows · 🟠 driveable, not yet driven (queued) · 🟢 test-only (hard to observe live without special setup) · the full suite is green regardless (vitest 3718 / cargo 597, 0 failed).

## ✅ Confirmed live on Windows this session
| Item | What was confirmed |
|---|---|
| App build/launch/render | The multi-wave merge did NOT break the Windows build; app compiles, launches, renders; light theme. |
| BUG-001 | Egress indicator reads "Sent to your OpenAI account" (follows the configured key). |
| BUG-078 | Activity Log shows the new green "Log verified" hash-chain badge; stays verified as new entries append; migration preserved existing rows. |
| BUG-080 | Running a workflow (Case Timeline Builder) produced a "Workflow Started" audit entry (workflow AI now logged). |
| BUG-081 | A Word AI-redline now logs BOTH "Model Call" + "AI Request Sent" (egress); the pre-fix entry has only Model Call. |
| BUG-009 | "Revise with AI" enabled with an OpenAI key; ran a redline → tracked change produced. |
| BUG-093 | MCP grant/revoke now appear in the live Activity Log ("External AI Matter Access Granted/Revoked") — found + fixed + re-confirmed live. |
| MCP grant (CEO) | Per-matter toggle is OFF by default ("Off by default" label); granting shows the "External AI access allowed" badge. |
| No crashes | Workflows / Privacy Center / Settings / Matters / Documents render without error. |
| Email (earlier pass) | Email viewer renders; privilege tags; "File to matter" present. |

## 🟠 Driveable on Windows but NOT yet driven (the hunt list)
| Item | What to drive |
|---|---|
| BUG-074 | Send a chat, hit Stop mid-stream → confirm it stops cleanly (no retry/spin) + no false success egress. |
| regfix (over-limit) | Paste an over-limit message in chat → confirm the compression/"Send anyway" modal appears + Send-anyway actually sends. |
| BUG-069 | Activity Log: the new Matter filter + scoped CSV/JSON export. |
| BUG-082 | Confirm an AI audit entry shows token/cost/provider after a reload (persisted, not just live). |
| BUG-090 | Settings: export settings → re-import → workflow model pins survive. |
| BUG-068 / 066 / 067 | Export a chat / a .docx with tracked changes + metadata → inspect the exported file (citation honesty / scrub). |
| mail (084/085/087/088) | Trigger a mail sync + search → exercises the mail-store fixes indirectly (needs a fresh Outlook token). |

## 🟢 Test-only / not easily observable live (covered by the green suite + Codex review)
| Item | Why hard to drive live |
|---|---|
| BUG-071 | Needs a model that loops on tool calls. |
| BUG-072 | Needs Ollama running + a PDF. |
| BUG-073 | Internal SSE buffer flush. |
| BUG-075 | Needs a provider that hangs. |
| BUG-076 | Needs a Gemini key configured. |
| BUG-070 | Needs firm Assured mode + the zero-retention proxy. |
| BUG-077 | Needs a forced encrypted-store write failure. |
| BUG-079 | Partly driveable via Stop/abort (see BUG-074 row). |
| BUG-084/085/087/088 | Mail-store internals (IDs, blob paths, charset) — cargo-tested; not surfaced in UI. |
| BUG-089 / 091 | Needs an invalid persisted settings value — unit-tested. |
| BUG-038/039/083 + grant boundary | The actual external-MCP-client read enforcement needs a real external MCP client connecting. The grant UI + audit ARE driven live; the wire-level deny is cargo-tested + Codex-reviewed. |

_Updated as the hunt continues._

## Hunt update #2 (2026-06-22, continued)
Newly confirmed LIVE on Windows:
- **BUG-069** ✅ — Activity Log has a Matter filter (options "All matters / Garcia v. Meridian Properties") + the "Exporting all matters" scope note (was absent before).
- **BUG-082** ✅ (partial) — an AI audit entry's detail shows **provider** ("Model: openai"); the token/cost fields are chat-send-only (need a completed chat to observe).
- **Citation honesty (BUG-016/065 family)** ✅ — on the Search/Ask surface, an off-corpus question declined ("I couldn't find anything…") with the **"Not cited from your files. Verify this before relying on it."** warning — i.e. no fabricated/uncited answer presented as trusted.
- **Grant audit (BUG-093) re-confirmed** ✅ — grant + revoke both show with proper descriptions ("External AI access granted/revoked to matter: Garcia v. Meridian Properties").

Still NOT cleanly driven live (need config to force the condition; unit-tested + green):
- **regfix over-limit / "Send anyway"** — the default `chatContextTokenLimit` is high enough that even a 201k-char message didn't trip the gate; to confirm live, lower the limit (Settings → Advanced) first, then send. CHAT-26 unit test covers it green.
- **BUG-074 Stop/abort** — needs to catch a slow streaming response mid-flight; AIChatViewer opens via **Ctrl+Shift+A** (noted for next time).
- **BUG-082 token/cost (full)** — needs a completed chat send to inspect the persisted token/cost.

How to open the full chat for these: **Ctrl+Shift+A** (opens AIChatViewer as a main-panel tab with `chat-input` / `chat-send-button`).

## Hunt update #3 (2026-06-22) — forced conditions, more confirmed live
By injecting settings + reloading, I forced the harder conditions:
- **regfix over-limit / "Send anyway"** ✅ — with a valid low `chatContextTokenLimit` (10000) + a ~50k-token message, the compression-confirm modal appeared ("This conversation is getting long…"); clicking **"Send anyway" actually sent** (modal did NOT re-trigger — the exact broken behavior I'd fixed). Both halves confirmed live.
- **BUG-089** ✅ — injecting an out-of-range `chatContextTokenLimit=50` (schema min 10000) was DROPPED on hydrate (the chat used the 200k default), i.e. the migration validates persisted values + fails safe. Also saw `version:1` in the persisted settings (the new schema version).
- **BUG-079** ✅ — a failed AI send logs as a FAILURE with full provenance (`User Action — AI request failed — {provider, model, mode, destination, dataLeaves, success:false, reason:"OpenAI API error: HTTP 400…"}`), NOT a false "AI Request Sent" success. Strong audit-honesty confirmation.
- **BUG-082 (provider)** ✅ — audit entry detail carries provider/model/mode/destination even on failure. Token/cost specifically need a SUCCESSFUL chat; see the config note below.

Observation (NOT a product bug): the bench's KeepanceTest chat defaults to **gpt-3.5-turbo**, which OpenAI now returns HTTP 400 for — so live chat sends in that workspace fail (the app handles it correctly: logs the failure, shows an error, no crash). The earlier working AI used gpt-4o (workflow) / the redline model. To live-confirm BUG-082 token/cost, switch the chat model to an available one (e.g. gpt-4o) first.

Still test-only (not forced live): BUG-074 Stop (stream completes faster than CDP poll-and-click), BUG-071/072/073/075/076 provider internals, mail-store internals, the wire-level MCP deny (needs an external MCP client). All green in the suite + Codex-reviewed.

## Hunt update #4 (2026-06-22) — Privacy Center honesty
- **BUG-021/023/024 family** ✅ — Privacy Center ("Where your data is"): correct provider (OpenAI), matter scope shown (Garcia), and the plain-language copy distinguishes "files stay on your machine / nothing uploaded for sync" from "when you use a cloud model, your prompt goes straight to that provider", reserving "nothing leaves" ONLY for local models — i.e. NO false blanket "nothing leaves your machine" claim in cloud mode. Honest egress story confirmed live.

## Practical limit reached (CDP-driveable surface)
Everything cleanly observable via the in-app CDP bridge has been driven live (above). The remaining items need one of: a **native save/open dialog** (document/chat/settings export → file inspection for BUG-066/067/068/090 — drivable only via the pyautogui desktop agent), **external setup** (Ollama for BUG-072, a Gemini key for BUG-076, an external MCP client for the wire-level boundary), **Jameson's hands** (a passkey tap for a fresh Outlook token → mail-store BUG-084/085/087/088 live), or are **internal/timing** (BUG-074 Stop streams faster than CDP poll-and-click; BUG-071/073/075/077 provider internals). All remain green in vitest 3718 / cargo 597 + Codex-reviewed.

## Hunt update #5 (2026-06-22) — found + fixed BUG-094 live; more confirmations
- **BUG-094 FOUND + FIXED + RE-CONFIRMED LIVE** — the Confidentiality Report showed Model "unknown" for the redline egress (default model used → not recorded). Fixed all 3 egress emitters to record `provider.getMetadata().model`. Re-tested live: a fresh redline now records **gpt-4o-mini** in the report (the old pre-fix entry correctly stays "unknown" — append-only history). The full suite caught a test-mock gap (DocxEditor's mock provider lacked getMetadata) — fixed that too. (2nd real bug found purely from live Windows driving, after BUG-093.)
- **BUG-021/023 (mode-reactive egress)** ✅ — switching confidentiality mode to Local-only flipped the indicator to "On your machine / Nothing leaves your machine / local model"; that claim appears ONLY in Local-only (absent in cloud/Direct).
- **BUG-013 (durable email filing)** ✅ — filed an email to a matter, navigated away, reopened → still "Filed to Roberto Garcia…".
- Email keyword search ✅ (50 → 11 matches). Investigated + RULED OUT a suspected "workflow missing from Confidentiality Report" gap — the workflow had only emitted Workflow Started (stopped at the input step, made no AI call), so the report's count was correct.

## Hunt update #6 (2026-06-22) — full workflow run
Ran the Evidence Gap Analyzer workflow to completion (filled its 4-field interview):
- **BUG-080 full chain** ✅ — the COMPLETE workflow audit chain fired live: Workflow Started → AI Request Sent (egress) → Model Call → File Created → Workflow Completed (all gpt-4o). (Previously only Workflow Started was confirmed; this exercises the whole chain.)
- **BUG-094 for workflow egress** ✅ — every workflow event recorded the real model gpt-4o (not "unknown").
- **Confidentiality Report accuracy** ✅ — now shows 3 calls: the workflow egress (gpt-4o) + the new redline (gpt-4o-mini) both with real models; only the single pre-fix historical entry stays "unknown" (append-only, correct). The workflow egress correctly appears in the matter report (definitively ruling out the earlier BUG-095 hypothesis — it appears when the workflow actually egresses).
- Workflow completed + created a file (EVIDENCE_GAP_ANALYSIS) — end-to-end success.

## Hunt update #7 (2026-06-22) — Word "clean copy" scrub leak test (via the native save dialog)
Drove the full flow on real Windows: open redline-test.docx (with a tracked insertion + a tracked deletion) → Export → "Clean copy, accept all changes" → native Save As dialog driven by the pyautogui desktop agent (paste path + Enter) → pulled the exported .docx back → unzipped + inspected.
- **BUG-066** ✅ — the exported clean copy: deleted text "Payment are due within thirty days…" is GONE (count 0); ALL tracked-change markup (`<w:del>`/`<w:delText>`/`<w:ins>`) is gone; the accepted insertion "thirty (30) days" is kept. NO leak of deleted/privileged text.
- **BUG-067** ✅ — the clean-copy package has only the 4 essential parts ([Content_Types], _rels/.rels, word/document.xml, word/_rels) — NO customXml/**, NO docProps/custom.xml, no residual metadata parts.
- Note: this test doc's tracked changes were in PARAGRAPH text; BUG-066's specific raw/table-XML tracked-change case (a `<w:tbl>` with `<w:delText>`) remains covered by the keepance-docx cargo roundtrip test, not by this live doc.
- This was the test flagged as the best remaining bug-finder (leak risk) — it PASSED, no leak.

## Hunt update #8 (2026-06-22) — found + fixed BUG-096 live (a workflow that was impossible to run)
Driving the **Privilege Log Drafter** workflow end-to-end on real Windows surfaced a real, user-facing bug:
- **BUG-096 FOUND + FIXED + RE-CONFIRMED LIVE** — the workflow's required "Privilege types applicable" question is a `multiselect` field, but `InterviewForm` only rendered `text`/`textarea`/`select` types. So the field rendered **no control at all**, the required-field check could never pass, and the workflow was **impossible to complete** for any real user. (Confirmed by inspecting the live form — 0 checkboxes — then the template def + the renderer.) Fixed `InterviewForm` to render `multiselect` as a checkbox group storing a comma-joined string (compatible with the existing string validation + `{{placeholder}}` substitution). TDD: 3 new red→green tests in `tests/unit/InterviewForm.multiselect.test.tsx`. Synced the one TSX to the bench (Vite HMR, no rebuild) → **3 checkboxes now render** (were 0) → completed the workflow live → full clean audit chain (AI Request Sent → Model Call → File Created → Workflow Completed, all real `gpt-4o`) + produced `PRIVILEGE_LOG.docx`. **3rd real bug found purely from live Windows driving** (after BUG-093, BUG-094). Committed + pushed (keepance-3.0 @ 0df7ecf, fast gate green: typecheck + vitest 3724).
- **BUG-080 chain + BUG-094 real model** ✅ re-confirmed on a *second, different* workflow (Privilege Log Drafter), not just Evidence Gap Analyzer — the full audit chain + real model recording is consistent across workflow templates.
- Only one template used `multiselect` (Privilege Log Drafter), so this was the only workflow affected; all others use text/textarea/select and were already runnable.
- Side finding (NOT a Windows bug, separate hygiene): the ESLint-gate baseline is drifted ~23 findings vs committed HEAD (pre-existing, mostly the new react-hooks React-Compiler rules from a plugin bump) — handed to Codex on a `chore/eslint-baseline-drift` worktree branch to fix robustly + verify; does not affect the app at runtime or the pre-push fast gate (typecheck + vitest).
