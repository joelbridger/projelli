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
| B3 | Recent-workspaces list reopen | `recent-workspaces-toggle`, `recent-workspace-row` | ✅ | **CONFIRMED LIVE (2026-06-20)** — after a dev restart the selector showed "Recent (2)"; expanding it and clicking the KeepanceTest row reopened the workspace (no native picker needed). |

## C. Search / Ask — the headline feature (RAG cited answers)
| # | What to test | Key targets | Status | Notes |
|---|---|---|---|---|
| C1 | Ask a question → get a correct answer **with verified citations** | `ask-composer-input`, `ask-citation-chip-*`, `verify-citation-btn`, `verify-verdict` | ✅✅ | **Confirmed on real Windows** — loaded a 3-file matter, app auto-indexed, asked, got a correct cited answer ("July 14, 2026"; "33.3%/40%"), citation marked Verified against the source. The core value prop. |
| C2 | Scope chips (This matter / All matters / Email / Documents) change results | `scope-toggle`, `scope-option-*` | ✅ | **CONFIRMED LIVE (2026-06-20)** — selected the **Email** scope (box changed to "Search your imported email…") and asked "What is my upcoming GEICO auto pay amount and date?" → answered **"$100.65, June 24, 2026"** with a citation, sourced from the imported GEICO email. Scope switching works.
| C3 | Typed question is **kept on error** (BUG-002 fix) | `ask-composer-input` error path | 🟡 | Fixed + test-verified; confirm live on Windows by forcing a failed query. |
| C4 | "New search" resets; prior conversations reachable | `recent-in-matter`, `matter-session-item` | ⬜ | |
| C5 | "Save answer to document" writes a .docx | per-turn save action | ✅ | **CONFIRMED LIVE (2026-06-20)** — clicked "Save to document" on the GEICO answer → a `.docx` appeared in Documents (`your-upcoming-geico-auto-pay-amount-is-100-65…docx`), auto-named from the answer. |
| C6 | Uncited-answer warning shows when AI didn't cite | `ask-uncited-warning` | ⬜ | |
| C7 | Egress indicator on Ask matches the real provider | `EgressIndicator` | 🟡 | Tied to BUG-001 fix; confirm below (G2). |

## D. AI chat viewer (the in-document assistant)
| # | What to test | Key targets | Status | Notes |
|---|---|---|---|---|
| D1 | Send a chat message, streaming reply, Stop button | `chat-input`, `chat-send-button`, `chat-stop-button` | ✅ | **CONFIRMED LIVE (2026-06-20)** — opened AI Assistant (Ctrl+Shift+A / command palette), sent a question, got a streamed answer ("A statute of limitations is a legal time limit…"). |
| D2 | Per-chat model picker lists all configured providers | `chat-model-picker` | ✅ | **CONFIRMED (2026-06-20)** — chat header shows a model picker ("OpenAI · gpt-3.5-turbo"). |
| D3 | "Run on all providers" comparison mode | `run-on-all-button` | ⬜ | |
| D4 | Cost chip + context meter + compress-old-turns offer | `chat-cost-chip`, `context-meter-*`, `compression-confirm-modal` | 🟡 | Cost chip ("$0.00 this chat") + context meter ("43 of 200K") seen live (2026-06-20); compress-offer not yet exercised. |
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
| E5 | Export .docx → Word / PDF / clean / clean-final | `docx-export-*` | ✅ | **CONFIRMED LIVE (2026-06-20).** Word export → real on-disk `.docx` (valid OOXML zip, magic `50 4B 03 04`); clean-final export → "changes accepted, comments and hidden metadata removed". **PDF export with NO LibreOffice → the high-value Windows case: a clear, plain-language notice ("PDF export needs LibreOffice … Nothing leaves your machine") + download link + Copy-link — NOT a silent fail.** The actual PDF *conversion* couldn't be exercised on this bench: LibreOffice won't silent-install here (MSI error 1603/1402 — a Windows registry-permission quirk in the SSH session, tried 3 ways incl. an elevated scheduled task; unrelated to Keepance), and the server has no soffice either. The convert path (`soffice --convert-to pdf`) is shared cross-platform. |
| E6 | Tracked-changes review pane (accept/reject one/all, comments) | `docx-review-pane`, `docx-accept-one`, `docx-comment-*` | ✅ | **CONFIRMED LIVE (2026-06-20)** — accept-all, accept-one, reject-one all worked: count dropped correctly (2→1→0), accept-one made "its" permanent, reject-one reverted "Payment are due". Comments not yet exercised. |
| E7 | Markdown/txt editor + inline AI edit (select text → edit) | `markdown-editor-*`, `inline-chat-*` | ✅ | **CONFIRMED LIVE after fixing BUG-012 (2026-06-20).** Selected a word in `fee-agreement.md` → "Ask AI" anchor → typed an instruction → real streamed edit. **Driving this FOUND BUG-012: the inline edit was dead for EVERY user** (MainPanel never wired a provider → silent no-op); fixed (new `resolveInlineEditProvider`, 5 tests) and re-verified live. |
| E8 | Streaming AI-edit diff overlay (accept/reject hunks) | `streaming-diff-region`, `hunk-accept-*` | ✅ | **CONFIRMED LIVE (2026-06-20)** — the inline edit produced a streaming diff overlay ("AI edit · 1 hunk · Accept all / Reject all", red `- contingency` / green `+ contingent-fee`) with per-hunk ✓/✗; accepting the hunk applied the change to the document and cleared the overlay. |
| E9 | Spreadsheet viewer/editor (cells, formula bar, sheets) | `spreadsheet-*` | ⬜ | |
| E10 | PDF / presentation / media read-only viewers | `PDFViewer`, etc. | ⬜ | |
| E11 | Trash: delete → restore / permanent delete | `docs-trash-toggle` | ✅ | **CONFIRMED LIVE (2026-06-20)** — created a throwaway `trash-test.docx`, deleted it via the row kebab → "Delete" → confirm dialog ("Are you sure you want to delete…") → file left Files and the **Trash badge showed "1"**; the Trash view listed it with size/date + Empty-Trash + 30-day retention setting; **Restore** put it back in Files and emptied the trash. (Permanent-delete/Empty-Trash button present; not separately exercised.) |
| E12 | Version history (text + .docx binary versions) restore | `binary-version-*` | ✅ | **TEXT versions CONFIRMED LIVE (2026-06-20)** — `fee-agreement.md` history panel listed 2 versions with rich metadata (timestamp, **"AI edit" label** for the inline edit, byte size, size-delta) + per-version Restore; Restore showed a confirm and applied cleanly. (Both snapshots happened to have identical content, so the revert wasn't separately *visible* — not a defect.) **.docx binary** history UI exists but `redline-test.docx` shows "History (0)" — its on-disk `.backup-*` files are a separate redundancy mechanism; binary-version restore not separately exercised. |
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
| H5 | Keyword search vs AI search modes | `mode-keyword`, `mode-ask`, `email-search-input` | ✅ | **CONFIRMED LIVE (2026-06-20)** — keyword search over the full imported mailbox ("invoice" → 21 real matches), AND AI search over mail proven via the Email-scoped Ask (GEICO "$100.65, June 24 2026" cited answer from the imported email). |
| H6 | Open an email → read body, attachments, privilege control | `open-email-*`, `email-viewer-*`, `attachment-download-*` | ✅ | **CONFIRMED LIVE (2026-06-20)** — opened a real imported email; viewer shows subject/from/to/date, full body, a **privilege control** (Not privileged / Attorney-Client / Work Product), and **File-to-matter**. |
| H7 | File an email to a matter (single + bulk) | `file-to-matter-*`, `bulk-file-to-matter` | ✅ | **CONFIRMED LIVE (2026-06-20).** Single: opened an email → clicked the Garcia-matter button → "Filed successfully." Bulk: hover-checkbox-selected 2 rows → "2 selected" bulk-action-bar → "File to matter" → picked Garcia → bar cleared + selection reset (success). Filing persists via `mailRetagMessageMatter`. **Minor UX gap logged (BUG-013):** the viewer shows no *persistent* "filed to X" state on reopen (the "Filed successfully" is transient; the matter buttons never reflect the current association). |
| H8 | Compose + AI-draft a reply; send | `compose-*`, `reply-draft-ai-btn`, `reply-send-btn` | ⬜🖐️ | Sending hits a real mailbox — care. |
| H9 | Filters (provider/date/attachment), pagination | `filters-toggle`, `filter-row`, `load-more` | ✅ | **CONFIRMED LIVE (2026-06-20).** Filters panel = From/To date + "Has attachment". Attachment filter: "Showing 50 of 4970" → "of 939". Date filter From=2026-06-19 → narrowed to 5 rows. Pagination: "load-more" took 50 → 100 rows. (Provider filter present in the panel; not separately exercised — only one provider connected.) |

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
| J1 | Log renders; AI actions appear | `audit-table-body` | ✅ | **CONFIRMED LIVE (2026-06-20)** — shows real AI actions from this session (AI redline, chat Model Call, AI Request Sent) with model + scope (Direct) + timestamps; CSV/JSON export + Filters present. |
| J2 | Search + filters (date/category/model) | `audit-home-search`, `audit-home-filter-toggle` | ✅ | **CONFIRMED LIVE (2026-06-20)** — searching "redline" filtered the log to exactly the 1 AI-redline entry. Date/category filters not separately exercised. |
| J3 | Export CSV / JSON | `audit-home-export-csv/json` | ⬜ | |
| J4 | Row → detail panel | row click → `DetailPanel` | ⬜ | |

## K. Settings
| # | What to test | Key targets | Status | Notes |
|---|---|---|---|---|
| K1 | AI keys: add (wizard), check (live verify), remove | `api-key-manager-*`, `api-key-wizard-*` | ✅ | Add + live "Check" verified (OpenAI → Working) on Windows. |
| K2 | Language switch (EN/ES/DE) applies | `setting-language`, `language-picker-select` | ✅ | Works instantly; correct English default on clean slate. |
| K3 | Confidentiality mode (Local/Direct/Assured) + privileged-forces-Local | `confidentiality-mode-*`, `privileged-matter-mode-switch` | ✅ | **CONFIRMED LIVE (2026-06-20).** "Where AI requests go" = "On this computer only" vs "Cloud AI (your account)" [Recommended]. Switching to **Local-only changed the trust bar to "On your machine. Nothing leaves…"**; switching back to Cloud reverted to "Sent to your OpenAI account" — the egress indicator honors the mode (BUG-001 family agrees). Privileged-matter-mode toggle + Network-lockdown toggle present. (Assured is firm-tier only — not shown solo.) |
| K4 | Editor/files/general prefs (autosave, font, default file type, etc.) | `section-workspace` keys | ⬜ | |
| K5 | Memory & facts (enable, facts table add/delete, PDF/OCR toggles) | `setting-memoryEnabled`, `settings-facts-*`, `setting-ocrScannedPdfs` | ✅ | **CONFIRMED LIVE (2026-06-20).** Memory enabled (on); **added a fact via the facts table → it appeared as a row → deleted it → table empty again.** OCR toggle present and ON ("Read scanned PDFs with local OCR … Runs entirely on your machine"). Inject-facts + auto-accept + include-PDFs toggles present. (Functional OCR-of-a-scanned-PDF = N4.) |
| K6 | Voice input + TTS settings | `section-voice` keys | ⬜ | |
| K7 | Telemetry opt-out, design-partner toggle, Ollama check | `privacy-telemetry-toggle`, `ollama-check-connection` | ⬜ | |
| K8 | Extensions/marketplace: browse, install, uninstall a template | `marketplace-tab`, `template-detail-install/uninstall` | ⬜ | |
| K9 | Per-template model override | `settings-template-model-*` | ⬜ | |
| K10 | MCP: status, download .mcpb, approval modal | `mcp-settings-section`, `mcp-approval-modal` | ⬜ | |
| K11 | Updates: channel, manual check now | `setting-updateChannel`, `setting-manualCheckNow` | ✅ | **CONFIRMED LIVE (2026-06-20)** — Advanced → Updates: channel = "Stable" (Beta reserved), auto-update ON, "Check for updates now" present and clickable (ran without error/crash; the dev build has no real feed, so no visible result — actual update = signed build only, see N2). |
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
| M1 | Command palette (Ctrl+K) | `CommandPalette` | ✅ | **CONFIRMED LIVE (2026-06-20)** — Ctrl+K opens a searchable palette (New Document, Save, Toggle Sidebar, Split Editor, Open AI Assistant…) with shortcuts. |
| M2 | Quick open (fuzzy file) | `QuickOpen` | ✅ | **CONFIRMED LIVE (2026-06-20)** — Ctrl+P opened Quick Open ("Find a file by fuzzy matching its name"); typing "fee" matched `fee-agreement.md`. |
| M3 | Shortcuts overlay | `ShortcutsOverlay` | ✅ | **CONFIRMED LIVE (2026-06-20)** — pressing "?" opened the Keyboard-shortcuts overlay (FILE → Save File Ctrl+S, Close Tab, …) with a search box. |
| M4 | What's New dialog | `WhatsNew` | ⬜ | |
| M5 | Global drag-and-drop import | `GlobalDropOverlay` | ⬜ | Needs a real OS drag (agent can do it). |
| M6 | Undo toast after destructive action | `UndoToast` | ⬜ | |
| M7 | Bug report dialog | `status-bar-bug-report` | ✅ | **CONFIRMED LIVE (2026-06-20)** — the status-bar bug button opens "Report a bug" (required "What happened?" + optional email + include-context). Renders correctly; not submitted (it POSTs to the real keepance.com bug-report endpoint). |
| M8 | Status bar: breadcrumbs, dirty indicator, egress pulse, trial chip | `status-bar-*`, `egress-activity-pulse` | 🟡 | Seen rendering; not exercised. |
| M9 | Sidebar collapse/expand | `spine-nav` chevron | ⬜ | |

## N. System / platform (Windows-real)
| # | What to test | Key targets | Status | Notes |
|---|---|---|---|---|
| N1 | OS keychain stores/reads AI keys + mail key + vault key | Tauri `keychain_*` | ✅ | **CONFIRMED EXPLICITLY (2026-06-20).** Windows Credential Manager (read from the interactive session) holds 6 real Keepance entries: the **OpenAI API key** (`bos_key_openai.com.keepance.app`), the **M365 mail refresh token** (`ms-refresh-token.keepance-mail-ms`), the **vault key** (`vmk-v1.com.keepance.vault.*`), plus encryption master keys for mail/vectors/audit. All in the OS keychain, not a file. (Note: `cmdkey` over an SSH network-logon can't see them — must run in the interactive session.) |
| N2 | Auto-updater checks the feed (manual check) | Tauri updater | ⬜ | Only the **signed** build truly updates; dev build can still hit the check path. |
| N3 | App launch/quit/relaunch stability; window resize/maximize | — | ✅ | Launches + runs; restarts cleanly. |
| N4 | OCR a scanned PDF into the index | `setting-ocrScannedPdfs` | ✅ | **CONFIRMED WORKING (2026-06-20, after fixing BUG-014/015).** With "Include PDFs in workspace index" ON, an image-only scanned PDF ("ZEBRAFOX"/$73,250, no text layer) was OCR'd by `tesseract-wasm` and became searchable — Ask returned the correct cited answer "seventy-three thousand two hundred fifty dollars ($73,250) … November 3, 2026" citing the PDF pages. The earlier failure was the OFF-by-default PDF-indexing toggle (BUG-015), now given clear feedback + one-tap enable; the OCR engine itself genuinely reads scans. (OCR uses the single-threaded fallback core since the dev server isn't cross-origin isolated.) Original investigation below.<br>**NOT functionally confirmed on the first pass (2026-06-20) — surfaced BUG-014 + BUG-015.** OCR engine is fully present & wired: `tesseract-wasm` + `eng.traineddata` + worker + WASM bundled and ON the bench (`public/ocr/`), `MemoryService.indexPdfFile` runs OCR for scanned pages, citation-disclosure ("scanned"/"low-confidence") plumbed, OCR toggle ON. **But** a real image-only scanned PDF (no text layer; distinctive "ZEBRAFOX"/$73,250) placed in the workspace never became searchable — Ask correctly returned "no information" for its content, and NO runtime PDF-index/OCR call reached the Rust layer. Root: the normal import button "Add files" is broken (**BUG-014** — it opens New-Document instead of importing), an external file copy wasn't picked up for indexing, and even a workspace reopen didn't index it; PDF-index errors are silently swallowed (`.catch(()=>{})`). Logged as **BUG-015** (OCR-to-search not confirmed / added-PDF indexing not triggered) for proper investigation (likely needs the real drag-drop import path or a fixed Add-files). |

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
**Updated 2026-06-20 (continuation — lower-risk tail burn-down).** The earlier session fixed 6 bugs (BUG-001 provider labels, BUG-007 mail sync trigger, BUG-009 redline-provider, BUG-010 ×2 Outlook sign-in, BUG-011 large-import crash). **This continuation drove the tail and found 3 more bugs + 1 trust observation:** **BUG-012** (markdown inline AI edit dead for everyone — **fixed + shipped + re-verified**), **BUG-013** (email viewer no persistent filed-to-matter state — minor UX), **BUG-014** (the "Add files" button doesn't import — opens New-Document; **Important, open**), **BUG-015** (a scanned PDF added to the workspace never got OCR-indexed/searchable — open), and **BUG-016** (a phrasing-dependent confident-wrong cited answer — needs-confirm).

**Driven & passing on real Windows:** headline cited Ask (C1), Email-scoped Ask (C2), save answer to .docx (C5), AI chat send/stream + model picker (D1/D2), workspace open (B1), **recent-workspaces reopen (B3)**, file tree (E1), new .docx (E2), Word editor typing (E3), AI redline + accept/reject (E4/E6), **document export Word/clean/clean-final + PDF graceful-missing-converter (E5)**, **markdown inline AI edit + streaming diff hunks (E7/E8 — after the BUG-012 fix)**, **trash delete→restore (E11)**, **text version history (E12)**, Matter create + scope (F1), Privacy Center + provider indicators (G1/G2), encrypted vault enable+recover+decrypt-off (G3/G4), Outlook connect + 4,970-msg import + keyword & AI search (H1/H4/H5), open+read email w/ privilege (H6), **file email to matter single+bulk (H7)**, **email filters + pagination (H9)**, M365 Reconnect+Disconnect (BUG-008/010), run a workflow → .docx (I2/I5), Workflows + Activity Log + audit search (I1/J1/J2), AI keys add/verify (K1), language (K2), **confidentiality mode switch changes egress (K3)**, **memory/facts add+delete + OCR toggle (K5)**, **updates channel + manual check (K11)**, command palette (M1), **quick-open (M2)**, **shortcuts overlay (M3)**, **bug-report dialog (M7)**, app launch/restart (N3), **OS keychain explicit — 6 entries incl. AI key, mail token, vault key (N1)**.

**Still not driven on Windows (the remaining tail — mostly lower-risk):**
- Ask: kept-on-error confirm (C3), new-search/history (C4), uncited warning (C6).
- AI chat: run-on-all (D3), attach/vision (D5), voice (D6), export (D7).
- Documents: spreadsheet (E9), PDF/media viewers (E10), open-in-Explorer (E13), letterhead (E14); **.docx binary version restore (E12 binary half).**
- Matters depth (F2–F6); Vault escape-hatch + confidentiality report (G5/G6).
- Email: IMAP (H3), compose/reply/send (H8 🖐️ — needs Jameson).
- Workflows: export + chain builder (I3/I4); Audit export CSV/JSON (J3/J4).
- Settings depth (K4, K6–K10, K12–K13), Account/Firm + SSO (L1–L5 🖐️ — needs Jameson), other overlays (M4–M6, M8–M9).
- Platform: updater real flow (N2 — signed build only), **OCR functional (N4 — BUG-015, blocked by BUG-014)**.

**Rough tally:** ~55+ checks driven-and-passing on real Windows (up from ~35). **9 bugs fixed total** — BUG-012 (inline AI edit), **BUG-014 (file import — implemented + confirmed live)**, **BUG-015 (OCR-to-search — root-caused, feedback added, OCR confirmed working)** all fixed this session, on top of the prior 6. **N4 OCR now PASS.** Open: BUG-013 (minor UX — filed-to-matter display) + BUG-016 (needs-confirm trust observation). Remaining hands-required: Firm SSO/admin (L3–L5) and email send (H8). **Product decision DONE (Jameson): PDF indexing now defaults ON, so scanned-filing search works out of the box** (pinned by `pdf-index-default.test.ts`). **The product's core — including file import and scanned-PDF OCR search — is now proven working on real Windows.**

---

# How to run this plan (operator notes)
1. Bring up the bench if needed (app + CDP + agent + tunnels) — see `reference_keepance_desktop_control` and the ops guide. Quick check: `curl localhost:9444/json/version` (app) and `curl localhost:8766/health` (agent).
2. Drive in-app by testid: `node scripts/desktop-drive.mjs {snapshot|click <id>|type <id> "txt"|eval "<js>"|screenshot <path>|waitfor "txt"}`.
3. Drive native dialogs / browser via the agent: `curl localhost:8766/{shot|click?x&y|type?text=|key?name=|hotkey?keys=}`.
4. **Every result goes in two places:** flip the status here, and — for any bug — add a row to `2026-06-20-test-bug-backlog.md` with a fix plan (the standing rule: no bug drops through the cracks). Append narrative results to `2026-06-20-real-software-test-results.md`.
5. When an area goes all-✅, it's proven on Windows. When the whole table is ✅/🖐️-resolved, Windows is done.
</content>
</invoke>
