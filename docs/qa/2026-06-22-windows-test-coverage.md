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
