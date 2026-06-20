# Keepance — Windows Desktop Test Plan (drive the real app)

**Goal:** prove the **whole** app has no user-facing bugs **on real Windows**, by **driving the actual desktop app on the laptop** — every screen, every button, every feature — not just the parts that also run in a browser.

**This is the living tracker.** Every surface of the app is listed below with a status. As each is driven and passes (or a bug is found), its status changes here. When everything is ✅, Windows is proven.

- **Owner of the driving:** Claude (autonomously, via the desktop control bridge) + Jameson only where his hands/accounts are required (logins, keys, a native folder pick).
- **Machine:** the Legion (`james@100.127.67.22`) over Tailscale — the unsigned dev build (`tauri:dev`), driven by the in-app CDP bridge (`scripts/desktop-drive.mjs`) + the full-desktop agent (`scripts/legion_agent.py`). Bring-up steps: see [`reference_keepance_desktop_control`](../../../.claude/projects/-home-jameson/memory/reference_keepance_desktop_control.md) and `docs/operations/2026-06-19-test-bench-operations-guide.md`.
- **Source of completeness:** the full app-surface map (every nav, feature, action, testid) compiled 2026-06-20, cross-checked against `docs/quality/2026-06-18-user-test/USER-STORIES.md` (~540 stories) and the per-area inventories there. The automated test pyramid (L0–L4) that backs this is in `docs/quality/2026-06-19-pre-release-master-test-plan.md`; **this plan is the top of that pyramid — the real-Windows, driven-by-hand layer.**

## Why drive on Windows at all (what the automated tests can't catch)
The server already runs ~3,375 frontend tests, ~450 Rust tests, browser E2E, and a headless Linux desktop harness on every change. Those catch logic bugs cheaply. They **cannot** catch: WebView2-specific rendering/behavior (Windows uses Microsoft's Edge engine), the real OS keychain, real OAuth sign-in in the system browser, native file/folder dialogs, the real on-disk encrypted index/vault, real mail sync against a live mailbox, the auto-updater, and "does it actually feel right when a human clicks through it." Those are exactly what this plan covers. (See `docs/quality/2026-06-19-linux-vs-windows-coverage.md`.)

## Status legend
- ✅ **PASS** — driven on real Windows, works.
- 🐞 **BUG** — driven, found a bug (logged in `2026-06-20-test-bug-backlog.md` with a fix plan).
- 🟡 **PARTIAL** — some of the area driven, more to do.
- ⬜ **NOT YET** — not driven on Windows yet.
- 🖐️ **NEEDS JAMESON** — needs his hands once (a login, an API key, a native folder pick) before Claude can drive the rest.
- 🌐 **BROWSER-OK** — also fully testable in the browser path (lower Windows risk), but still worth a Windows confirm.

---

# Coverage tracker (every surface)

## A. First-run & onboarding
| # | What to test (drive it) | Key targets | Status | Notes |
|---|---|---|---|---|
| A1 | Fresh first-run wizard, all 6 steps (welcome → profession → workspace → data map → AI setup → demo/finish) | `onboarding-next-*`, `profession-card-*`, `ai-setup-*`, `first-run-samples-toggle` | 🟡 | Steps 1–6 walked with Jameson on real Windows (green). Re-run clean from a wiped state to confirm no stale-state issues. |
| A2 | Guided onboarding variant (identity → trust → ai-key → email → firm → done) | `onboarding-step-*`, `firm-option-*` | ⬜ | Newer firm-aware flow; not yet driven. |
| A3 | Post-onboarding feature tour (highlights each nav tab) | `feature-tour-next/back/finish/skip` | ✅ | Confirmed present; dismiss path used during the sweep. |
| A4 | "Get started" checklist + AI-setup reminder nudges | `setup-checklist`, `api-key-setup-card`, `ai-setup-reminder` | ⬜ | |

## B. Workspace selection (native)
| # | What to test | Key targets | Status | Notes |
|---|---|---|---|---|
| B1 | Open existing workspace (native folder picker) | `open-existing-workspace` | ✅ | Driven end-to-end via the desktop agent (Ctrl+L → path → Select Folder). |
| B2 | Create new workspace (native folder picker) | `new-workspace` | ⬜ | Same native picker; confirm create path. |
| B3 | Recent-workspaces list reopen | `recent-workspaces-toggle`, `recent-workspace-row` | ⬜ | |

## C. Search / Ask — the headline feature (RAG cited answers)
| # | What to test | Key targets | Status | Notes |
|---|---|---|---|---|
| C1 | Ask a question → get a correct answer **with verified citations** | `ask-composer-input`, `ask-citation-chip-*`, `verify-citation-btn`, `verify-verdict` | ✅✅ | **Confirmed on real Windows** — loaded a 3-file matter, app auto-indexed, asked, got a correct cited answer ("July 14, 2026"; "33.3%/40%"), citation marked Verified against the source. The core value prop. |
| C2 | Scope chips (This matter / All matters / Email / Documents) change results | `scope-toggle`, `scope-option-*` | ⬜ | |
| C3 | Typed question is **kept on error** (BUG-002 fix) | `ask-composer-input` error path | 🟡 | Fixed + test-verified; confirm live on Windows by forcing a failed query. |
| C4 | "New search" resets; prior conversations reachable | `recent-in-matter`, `matter-session-item` | ⬜ | |
| C5 | "Save answer to document" writes a .docx | per-turn save action | ⬜ | |
| C6 | Uncited-answer warning shows when AI didn't cite | `ask-uncited-warning` | ⬜ | |
| C7 | Egress indicator on Ask matches the real provider | `EgressIndicator` | 🟡 | Tied to BUG-001 fix; confirm below (G2). |

## D. AI chat viewer (the in-document assistant)
| # | What to test | Key targets | Status | Notes |
|---|---|---|---|---|
| D1 | Send a chat message, streaming reply, Stop button | `chat-input`, `chat-send-button`, `chat-stop-button` | ⬜ | |
| D2 | Per-chat model picker lists all configured providers | `chat-model-picker` | ⬜ | |
| D3 | "Run on all providers" comparison mode | `run-on-all-button` | ⬜ | |
| D4 | Cost chip + context meter + compress-old-turns offer | `chat-cost-chip`, `context-meter-*`, `compression-confirm-modal` | ⬜ | |
| D5 | Attach a file for vision (paperclip) | `chat-paperclip-button`, `attachment-tiles-strip` | ⬜ | |
| D6 | Voice press-to-talk | `chat-voice-button` | ⬜ | Needs mic; lower priority. |
| D7 | Export chat to file | `chat-export-button` | ⬜ | |

## E. Documents (files + editors)
| # | What to test | Key targets | Status | Notes |
|---|---|---|---|---|
| E1 | File tree shows workspace files; open a file | `file-tree`, `tab-*` | ✅ | Confirmed during the sweep. |
| E2 | New file menu (.docx/.pptx/.xlsx/.csv), new folder, upload | `new-file-type-*`, `new-folder-button`, `upload-button` | 🟡 | **"New document" → Create Word Document dialog → .docx created cleanly (2026-06-20).** Folder/upload not yet driven. |
| E3 | **.docx Word-native editor** — type, autosave, page render | `docx-editor`, `docx-canvas`, `docx-page` | ✅ | **CONFIRMED typing + render on Windows (2026-06-20)** — clicked into the custom canvas and typed a full paragraph; it rendered + autosaved ("Saved"). Canvas typing now solved (see the coordinate-mapping note below). |
| E4 | **AI redline** on a .docx (revise-with-AI → tracked changes) | `docx-revise-with-ai`, `docx-redline-*`, `docx-accept-all/reject-all` | ✅ | **CONFIRMED LIVE on Windows (2026-06-20)** — typed a paragraph with 2 deliberate errors, ran "Revise with AI" (real OpenAI call), got 2 correct tracked changes ("it's"→"its"; "Payment are"→"Payments are") shown as Word redlines + in the Review pane. **Surfaced + fixed BUG-009** (redline was dead for any non-Anthropic BYOK provider — MainPanel never passed the resolved provider to DocxEditor). |
| E5 | Export .docx → Word / PDF / clean / clean-final | `docx-export-*` | ⬜ | |
| E6 | Tracked-changes review pane (accept/reject one/all, comments) | `docx-review-pane`, `docx-accept-one`, `docx-comment-*` | ✅ | **CONFIRMED LIVE (2026-06-20)** — accept-all, accept-one, reject-one all worked: count dropped correctly (2→1→0), accept-one made "its" permanent, reject-one reverted "Payment are due". Comments not yet exercised. |
| E7 | Markdown/txt editor + inline AI edit (select text → edit) | `markdown-editor-*`, `inline-chat-*` | ⬜ | |
| E8 | Streaming AI-edit diff overlay (accept/reject hunks) | `streaming-diff-region`, `hunk-accept-*` | ⬜ | |
| E9 | Spreadsheet viewer/editor (cells, formula bar, sheets) | `spreadsheet-*` | ⬜ | |
| E10 | PDF / presentation / media read-only viewers | `PDFViewer`, etc. | ⬜ | |
| E11 | Trash: delete → restore / permanent delete | `docs-trash-toggle` | ⬜ | Destructive; test carefully. |
| E12 | Version history (text + .docx binary versions) restore | `binary-version-*` | ⬜ | |
| E13 | "Open on desktop" (reveal in Explorer) | `open-on-desktop` | ⬜ | Native shell call. |
| E14 | Set a .docx as firm letterhead | `use-as-letterhead` | ⬜ | |

## F. Matters
| # | What to test | Key targets | Status | Notes |
|---|---|---|---|---|
| F1 | Create a matter (name, client, privileged) → auto-folders | `matter-new-*`, `matter-create-button` | ✅ | Created "Garcia v. Meridian / Roberto Garcia"; auto-made folders, mapped the mail account, showed per-matter lockdown. |
| F2 | Matter table: sort columns, search when >5 | `matters-search-input`, column sort headers | ⬜ | |
| F3 | Open a matter → MatterHub (inline ask, AI glance, quick-launches) | `matter-row-*`, `hub-ask-*`, `hub-ai-glance-*`, `hub-panel-*` | ⬜ | |
| F4 | Privileged matter → badge + confidentiality enforcement | `matter-new-privileged`, `privileged-matter-badge` | 🟡 | Scoping seen; confirm the privileged→Local enforcement. |
| F5 | Archive / restore / delete a matter; isolate-confirm | `matter-archive-*`, `matter-restore-*`, `matter-isolate-confirm-*` | ⬜ | |
| F6 | Matter notes editor + sync badge | `matter-notes-editor`, `matter-notes-sync-badge` | ⬜ | |

## G. Privacy Center, Data Map, Vault, Egress
| # | What to test | Key targets | Status | Notes |
|---|---|---|---|---|
| G1 | Privacy Center renders: data map accordion + confidentiality report | `privacy-center-report-button`, `DataMapContent` | ✅ | Renders clean + comprehensive. |
| G2 | **All provider indicators agree** (Privacy "Current mode" == trust bar == Ask) — BUG-001 fix | `EgressIndicator`, `TrustBar`, `useActiveEgressProvider` | ✅ | **CONFIRMED LIVE 2026-06-20** — Privacy Center + trust bar both read "Sent to your OpenAI account". BUG-001 fixed. |
| G3 | **Vault enable** (AES-256) + recovery-phrase ceremony | `vault-enable-trigger`, `vault-enable-ceremony` | ✅ | **CONFIRMED LIVE on a throwaway workspace (2026-06-20).** Enabled the vault: honest 2-step ceremony, 24-word phrase shown once, confirm-3-words gate, Activate → "Workspace encrypted". **Verified at the disk level over SSH:** the test file became real ciphertext (starts with the `KPV1` magic header; the secret plaintext was gone). Folder names stayed visible, as promised. |
| G4 | **Vault lock → unlock** with the phrase | `recovery-phrase-input`, `vault-unlock-error` | ✅ | **CONFIRMED LIVE (2026-06-20)** via the app's own recovery command: a **wrong** phrase was rejected (BIP39 checksum), the **correct** phrase recovered the key, and the encrypted file then decrypted back to the exact original secret. Also drove "Turn off vault and decrypt" → files restored to plaintext + vault metadata removed. (Note: tested the recovery *cryptography* path directly — there's no in-app "lock" affordance and the OS keychain isn't reachable from the SSH session to force the locked-UI prompt; the substance of recovery is proven.) |
| G5 | Vault "lost my phrase" escape hatch | `VaultEscapeHatchDialog` | ⬜ | |
| G6 | Confidentiality report prints for a matter | `ConfidentialityReportDialog` | ⬜ | |

## H. Email
| # | What to test | Key targets | Status | Notes |
|---|---|---|---|---|
| H1 | Connect Microsoft 365 (OAuth in system browser) | `MailConnect` | ✅🖐️ | Connected on real Windows with Jameson (first time ever). Persists across restart. |
| H2 | Connect Gmail (OAuth) | `MailGmailConnect` | 🖐️ | Dev build lacks baked Google creds (expected); needs the signed build or creds injected. Validated server-side already. |
| H3 | Connect IMAP (manual host/port form) | `MailImapConnect` | ⬜ | |
| H4 | **Mail actually syncs** after restart + **"Sync now"** works (BUG-007 fix) | `email-sync-now`, mail list | ✅ | **CONFIRMED LIVE 2026-06-20 — real Outlook mail IMPORTS.** After fixing the sign-in (BUG-010: ShellExecuteW + bind `localhost`), Jameson reconnected with his passkey and mail imported for real (count climbed 84→194→504→… messages). "Sync now" present + auto-fires on open (BUG-007). The earlier "spins forever" (BUG-008) was the stale token; with a fresh sign-in it imports normally. |
| H5 | Keyword search vs AI search modes | `mode-keyword`, `mode-ask`, `email-search-input` | 🟡 | **Keyword search CONFIRMED LIVE (2026-06-20)** over the full imported mailbox — searching "invoice" returned 21 real matches with correct subjects/senders. AI-search mode not yet driven. |
| H6 | Open an email → read body, attachments, privilege control | `open-email-*`, `email-viewer-*`, `attachment-download-*` | ⬜ | |
| H7 | File an email to a matter (single + bulk) | `file-to-matter-*`, `bulk-file-to-matter` | ⬜ | |
| H8 | Compose + AI-draft a reply; send | `compose-*`, `reply-draft-ai-btn`, `reply-send-btn` | ⬜🖐️ | Sending hits a real mailbox — care. |
| H9 | Filters (provider/date/attachment), pagination | `filters-toggle`, `filter-row`, `load-more` | ⬜ | |

## I. Workflows (AI document templates)
| # | What to test | Key targets | Status | Notes |
|---|---|---|---|---|
| I1 | Workflow catalog renders, filter by practice, search | `associate-home`, `associate-practice-filter`, `associate-search` | ✅ | Loads without errors. |
| I2 | **Run a workflow** end-to-end (Q&A interview → .docx output) | `associate-run-*`, InterviewForm, `workflow-execution-tab-wrapper` | ✅ | **CONFIRMED LIVE (2026-06-20)** — ran "Case Timeline Builder": Q&A interview (required-field validation enforced) → real OpenAI call → created a folder + a real `CASE_TIMELINE.docx` correctly built from the inputs (parties, jurisdiction, trial date, events organized into phases with significance + source per event), opening in the Word editor. Run shows in Recent Runs (green ✓). Minor note: the InterviewForm fields have no data-testids (testability gap, not a user bug); workflow-template disclaimers contain em dashes (minor copy style, in generated-doc output not UI chrome). |
| I3 | Export workflow output (.docx/.pptx) | `workflow-export-*` | ⬜ | |
| I4 | Chain builder (multi-step) | `chain-builder-modal`, `chain-*` | ⬜ | |
| I5 | Recent runs history | `associate-recent-runs` | ✅ | Confirmed (2026-06-20) — the completed Case Timeline Builder run appears in "Recent Runs" with a green completed check + relative timestamp. |

## J. Activity Log (audit)
| # | What to test | Key targets | Status | Notes |
|---|---|---|---|---|
| J1 | Log renders; AI actions appear | `audit-table-body` | ✅ | Loads without errors. |
| J2 | Search + filters (date/category/model) | `audit-home-search`, `audit-home-filter-toggle` | ⬜ | |
| J3 | Export CSV / JSON | `audit-home-export-csv/json` | ⬜ | |
| J4 | Row → detail panel | row click → `DetailPanel` | ⬜ | |

## K. Settings
| # | What to test | Key targets | Status | Notes |
|---|---|---|---|---|
| K1 | AI keys: add (wizard), check (live verify), remove | `api-key-manager-*`, `api-key-wizard-*` | ✅ | Add + live "Check" verified (OpenAI → Working) on Windows. |
| K2 | Language switch (EN/ES/DE) applies | `setting-language`, `language-picker-select` | ✅ | Works instantly; correct English default on clean slate. |
| K3 | Confidentiality mode (Local/Direct/Assured) + privileged-forces-Local | `confidentiality-mode-*`, `privileged-matter-mode-switch` | ⬜ | |
| K4 | Editor/files/general prefs (autosave, font, default file type, etc.) | `section-workspace` keys | ⬜ | |
| K5 | Memory & facts (enable, facts table add/delete, PDF/OCR toggles) | `setting-memoryEnabled`, `settings-facts-*`, `setting-ocrScannedPdfs` | ⬜ | OCR is desktop-only. |
| K6 | Voice input + TTS settings | `section-voice` keys | ⬜ | |
| K7 | Telemetry opt-out, design-partner toggle, Ollama check | `privacy-telemetry-toggle`, `ollama-check-connection` | ⬜ | |
| K8 | Extensions/marketplace: browse, install, uninstall a template | `marketplace-tab`, `template-detail-install/uninstall` | ⬜ | |
| K9 | Per-template model override | `settings-template-model-*` | ⬜ | |
| K10 | MCP: status, download .mcpb, approval modal | `mcp-settings-section`, `mcp-approval-modal` | ⬜ | |
| K11 | Updates: channel, manual check now | `setting-updateChannel`, `setting-manualCheckNow` | ⬜ | Auto-updater is Windows-real; worth a check. |
| K12 | Settings search, export/import/reset | `settings-search`, `settings-export/import/reset` | ⬜ | |
| K13 | Shortcuts list + About/version | `setting-shortcut-*`, `settings-about-version` | ⬜ | |

## L. Account & Firm
| # | What to test | Key targets | Status | Notes |
|---|---|---|---|---|
| L1 | Account tab: edit name/firm, upload avatar/logo | `account-name-input`, `account-image-input` | ⬜ | |
| L2 | Usage tab: AI spend by provider | `account-tab-usage`, `CostMetrics` | ⬜ | |
| L3 | Firm sign-in (password + **SSO/OIDC** in browser) | `firm-signin-*`, `firm-sso-submit` | ⬜🖐️ | SSO opens the system browser; needs an IdP. |
| L4 | Firm claim / activate org | `firm-claim-*` | ⬜🖐️ | Needs a license key. |
| L5 | Firm admin console: members, shared matters, ethical walls | `FirmAdminConsole` | ⬜🖐️ | Multi-user; heavy setup. |

## M. Global shell & overlays
| # | What to test | Key targets | Status | Notes |
|---|---|---|---|---|
| M1 | Command palette (Ctrl+K) | `CommandPalette` | ⬜ | |
| M2 | Quick open (fuzzy file) | `QuickOpen` | ⬜ | |
| M3 | Shortcuts overlay | `ShortcutsOverlay` | ⬜ | |
| M4 | What's New dialog | `WhatsNew` | ⬜ | |
| M5 | Global drag-and-drop import | `GlobalDropOverlay` | ⬜ | Needs a real OS drag (agent can do it). |
| M6 | Undo toast after destructive action | `UndoToast` | ⬜ | |
| M7 | Bug report dialog | `status-bar-bug-report` | ⬜ | |
| M8 | Status bar: breadcrumbs, dirty indicator, egress pulse, trial chip | `status-bar-*`, `egress-activity-pulse` | 🟡 | Seen rendering; not exercised. |
| M9 | Sidebar collapse/expand | `spine-nav` chevron | ⬜ | |

## N. System / platform (Windows-real)
| # | What to test | Key targets | Status | Notes |
|---|---|---|---|---|
| N1 | OS keychain stores/reads AI keys + mail key + vault key | Tauri `keychain_*` | 🟡 | Implied working (key + mail connect persisted); verify explicitly. |
| N2 | Auto-updater checks the feed (manual check) | Tauri updater | ⬜ | Only the **signed** build truly updates; dev build can still hit the check path. |
| N3 | App launch/quit/relaunch stability; window resize/maximize | — | ✅ | Launches + runs; restarts cleanly. |
| N4 | OCR a scanned PDF into the index | `setting-ocrScannedPdfs` | ⬜ | Desktop-only Rust OCR. |

---

# The "must test on Windows" shortlist (highest risk, desktop-only)
These can't be proven anywhere but real Windows. Prioritize:
1. **C1 headline cited Ask** — ✅ done.
2. **E3/E4 .docx editing + AI redline** — the Word-native engine in WebView2.
3. **H4/H6 mail sync + read** (BUG-007 fix) + **H1 Outlook** — ✅ connect done, sync confirm in progress.
4. **G3/G4 vault encrypt + recover** — data-loss-sensitive; throwaway workspace.
5. **N1 OS keychain** + **N2 auto-updater** (updater fully only on the signed build).
6. **I2 run a workflow** to a real .docx.
7. **K10 MCP** + **N4 OCR** — native sidecars.

# Edge cases & additions (from an independent Codex code-review of this plan, 2026-06-20)
A second AI engineer (Codex) read this plan against the actual code and flagged these to add:
- **E5 — .docx → PDF export likely depends on a native converter (LibreOffice/`soffice`) being installed.** On a Windows machine without it, PDF export can fail. **Test that PDF export actually produces a valid PDF on the real Legion, and that a missing-converter case shows a clear error (not a silent fail).** High-value, Windows-specific.
- **Email — add: disconnect an account, cancel an in-progress sync, export an email to the workspace, and attach a file when composing** (`compose-attach`). These were not separate checks; they are now (H6/H8 cover read/compose, but disconnect + cancel-sync + export-to-workspace need their own driving). Cancel-sync ties directly to BUG-008. **Update 2026-06-20: a Microsoft 365 "Disconnect" button + `mail_disconnect` command were built (BUG-008 follow-up) and CONFIRMED RENDERING live (Account → Connections shows Reconnect + Disconnect on the connected M365 panel); the full disconnect/reconnect cycle completes once Jameson does the one Microsoft passkey tap.**
- **Workflows — the catalog has dozens of built-in templates across Legal/Tax/Consulting/Advisor.** I2 ("run a workflow") should run **at least one per practice area**, not just one overall, since each category's templates exercise different output paths.
- **Confirmed accurate:** the `.docx` editor test-ids (`docx-canvas`, `docx-page`) and the export menu exist as the plan states.

# Needs Jameson once (then Claude drives the rest)
- Gmail connect (H2) — signed build or injected Google creds.
- Firm SSO / claim / admin (L3–L5) — IdP + license key + multi-user.
- Sending a real email (H8) — confirm before hitting a live mailbox.
- The very first native folder pick per fresh workspace (B1/B2) — or the dev/test workspace hook (CAP fix) removes even this.

---

# Current coverage summary (the evaluation: what's tested vs not)
**Driven & passing on real Windows so far:** the headline cited Ask (C1), workspace open (B1), Documents file tree (E1), Matter create + scope (F1), Privacy Center render (G1), Outlook connect (H1), AI keys add/verify (K1), language (K2), Workflows + Activity Log render (I1/J1), app launch/restart (N3). Plus the two bug fixes (BUG-001 G2, BUG-007 H4) **pushed and being confirmed live now.**

**Biggest untested-on-Windows areas (the real "what's left"):**
- **.docx editing + AI redline** (E3–E8) — the flagship Word feature, never driven on Windows.
- **Running a workflow** to output (I2–I4).
- **Vault encrypt/recover** (G3–G5).
- **Email beyond connect** — sync confirm, reading, filing, compose (H4–H9).
- **AI chat viewer** depth (D1–D7), **scoped Ask** (C2–C6).
- **Settings depth** (K3–K13), **Account/Firm** (L1–L5), **global overlays** (M1–M9).
- **Platform**: keychain explicit (N1), updater (N2), OCR (N4).

**Rough tally:** ~15 of ~80 checks driven-and-passing; ~2 fixed-and-confirming; the rest not yet driven on Windows. So: **the foundation and the headline are proven; the long tail of features is the work that remains.** This plan is the list to burn down.

---

# How to run this plan (operator notes)
1. Bring up the bench if needed (app + CDP + agent + tunnels) — see `reference_keepance_desktop_control` and the ops guide. Quick check: `curl localhost:9444/json/version` (app) and `curl localhost:8766/health` (agent).
2. Drive in-app by testid: `node scripts/desktop-drive.mjs {snapshot|click <id>|type <id> "txt"|eval "<js>"|screenshot <path>|waitfor "txt"}`.
3. Drive native dialogs / browser via the agent: `curl localhost:8766/{shot|click?x&y|type?text=|key?name=|hotkey?keys=}`.
4. **Every result goes in two places:** flip the status here, and — for any bug — add a row to `2026-06-20-test-bug-backlog.md` with a fix plan (the standing rule: no bug drops through the cracks). Append narrative results to `2026-06-20-real-software-test-results.md`.
5. When an area goes all-✅, it's proven on Windows. When the whole table is ✅/🖐️-resolved, Windows is done.
</content>
</invoke>
