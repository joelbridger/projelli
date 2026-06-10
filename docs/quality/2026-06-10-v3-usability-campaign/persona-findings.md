# Persona Study Findings — Diane Marchetti × Keepance 3.0 (F-101+)

**Source:** `persona-study-transcript.md` (same directory). Synthetic moderated usability study, 2026-06-10, branch `keepance-3.0`, browser build at 1366×768 (firm scenario 1536×864).
**Severity:** P0 = blocks task or causes a wrong belief about where data goes; P1 = major, impedes completion or trust; P2 = minor; P3 = cosmetic.
**Type:** bug | inconsistency | copy | ux-improvement. Each finding carries: repro, screenshot, and Diane's quote.
**Note:** This file is owned by the persona-study agent. `findings.md` and `coverage-ledger.md` are owned by other agents and are NOT edited here.

## Findings table

| ID | Sev | Type | Surface | Title |
|----|-----|------|---------|-------|

<!-- FINDINGS-APPEND-POINT: detailed findings appended per task below -->

---

## Task 1 findings — first run / onboarding

### F-101 · P2 · ux-improvement · FirstRunWizard workspace step
**Title:** The "Pick a workspace folder" wizard step doesn't pick a folder — the real pick happens after the wizard, splitting one decision into two screens.
**Repro:** Fresh context, no testMode → wizard → Legal → "Pick a workspace folder" step. Copy says "The next screen will let you actually pick the folder. For now, just confirm you understand what we're about to ask"; CTA is "Got it". The actual picker (Open Existing / New Workspace cards) only appears after the final wizard step ("Open my workspace").
**Screenshot:** `persona/t1-04-folder-explainer.png`, `persona/t1-11-real-folder-picker.png`
**Diane:** "So step one isn't picking a folder, it's agreeing to pick a folder later. Don't make me 'Got it' twice for one decision."
**Label:** communication (the explainer content is excellent; the sequencing is the problem).

### F-102 · P3 · copy · WorkspaceSelector "New Workspace" card
**Title:** Folder-structure hint "docs/ research/ templates/" is developer idiom (monospace, trailing slashes) on the single most important first-run screen.
**Repro:** Complete wizard → launch screen → "New Workspace" card subtitle.
**Screenshot:** `persona/t1-11-real-folder-picker.png`
**Diane:** "Slashes after folder names is how software people write, not how I write."
**Label:** communication.

### F-103 · P3 · inconsistency · DataMapDialog
**Title:** British "licence" (×3) in the data-map's license-check section; every other surface uses American "license" (68 files).
**Repro:** Onboarding data-map step → expand "The only thing Keepance's own servers ever see is a licence check". Source: `src/components/privacy/DataMapDialog.tsx:99-100`.
**Screenshot:** `persona/t1-06-data-map-expanded.png`
**Diane:** "It says 'licence' like a British solicitor wrote that one paragraph."
**Label:** communication.

### F-104 · P2 · copy · Status bar "Privileged Matter Mode"
**Title:** Status-bar pill "Privileged Matter Mode: network extensions disabled" explains a lawyer-critical feature in network-engineer vocabulary.
**Repro:** Open workspace (testMode shell) → status bar, right side.
**Screenshot:** `persona/t1-13-workspace-first-view.png`
**Diane:** "I have no idea what a network extension is, but 'privileged' is my word — so I want to know what that does."
**Label:** communication. ("Privileged" earns attention; "network extensions disabled" spends it.)

### F-105 · P2 · ux-improvement · BYOK provider steps (protocol addendum S3 probe)
**Title:** The 5-step Claude/OpenAI/Gemini key walkthroughs never mention checking the provider's training/data-retention setting — the one provider-side step a confidentiality-bound user can't discover alone.
**Repro:** Onboarding → "Use your own AI account" → read all 5 Claude steps (account, key creation, copy, credits). No step covers provider training opt-out / data retention.
**Screenshot:** `persona/t1-08-byok-claude-steps.png`
**Diane (when probed):** "If my question goes straight to the AI company, what do THEY do with it? The recipe tells me where the key button is but not that."
**Label:** capability gap in the explainer content (communication).

**Task 1 positives logged for summary:** Dropbox/OneDrive synced-folder warning EXISTS in onboarding (protocol S4 probe answered "yes, warned, in plain language"); browser-demo relay disclaimer is against-interest honesty; "AI key… like a password" + "copy it IMMEDIATELY" recipe defuses the documented #1 drop-off; Ollama detection green-path worked ("Ollama is running, with 1 model ready"); "Skip for now" escape on every wizard step; data-map comprehension probe PASSED (she articulated the full model back, including the cloud-prompt nuance).

---

## Task 2 findings — workflows → Word deliverable

### F-106 · P0 · bug · Workflow execution / completion panel
**Title:** With no cloud key configured, workflows silently run a MockProvider and present "This is a mock response." as a green-bar "Complete" success — no UI warning before, during, or after.
**Repro:** testMode (or any install with no cloud API key), Ollama running or not → run Client Intake Synthesizer → answer questions → run completes green; Generated Output is "This is a mock response." Only signal is a console.log ("No API key configured - using mock provider…"), `src/App.tsx:2411-2413`.
**Screenshot:** `persona/t2-06-run-complete.png`
**Diane:** "It stamps it 'Complete' and the work product is five words of nothing. If it needed the cloud AI, tell me THAT."
**Label:** communication failure around a capability gap; per protocol severity rules a wrong belief about what happened/whether it worked = top severity. The onboarding wizard's own step 3 ("run your first workflow") routes every local-AI/no-key first-run user straight into this.

### F-107 · P0 · inconsistency · Workflow provider resolution vs local AI promise
**Title:** Workflows cannot use Ollama at all — onboarding sells "keep everything on your computer," Settings → Templates lets users pin any template to Ollama, the chat surface supports Ollama, but `src/App.tsx`'s workflow provider chain (≈2337–2414) has no Ollama branch: local-pinned templates fall through to a cloud key if one exists, else to the mock.
**Repro (verified):** no keys + template default → mock (F-106). Code-verified (not driven; no real cloud key permitted in study): with an anthropic key present and a template pinned to Ollama, `pickedProvider==='ollama'` matches no branch and falls into `else if (anthropicKey)` → Claude — a workflow the user explicitly pinned LOCAL would egress to the cloud. Settings UI offering the pin: `TemplateModelSettings.tsx` (`PROVIDER_LABEL` includes `ollama`); `TemplateProviderId` includes `'ollama'` (`src/types/workflow.ts:222`).
**Screenshot:** `persona/t2-11-template-model-settings.png`, `persona/t1-09-local-ai-detected.png`
**Diane:** "I picked the on-my-computer option because your own setup screen recommended it for sensitive work."
**Label:** capability (build the Ollama branch) + a P0-class data-egress risk in the fallback ordering. The cloud-fallback leg deserves immediate engineering verification.

### F-108 · P1 · bug · Markdown→Word pipeline (`markdownToDocxBytes`)
**Title:** Markdown tables are not converted to Word tables — they land in the exported .docx as raw pipe/dash text. Headings, bold, and numbered lists convert correctly.
**Repro:** Any document containing a pipe table → Export as → Word (.docx) → unzip: `word/document.xml` contains `| Name to Check | … |` and `|---|---|---|---|` as literal paragraph text; `<w:tbl>` count = 0. Verified on a realistic conflict-check memo (bytes at /tmp/persona-t2-realistic.docx during the run). The conflict-check table is the centerpiece of the intake template's promised output.
**Screenshot:** `persona/t2-14-export-as-menu.png` (path), byte inspection in transcript.
**Diane:** "The one table I actually need came through as text with vertical bars in it. 'Close' on tables means my paralegal redoes it, which means it isn't done."
**Label:** capability.

### F-109 · P2 · copy · Workflow estimate modal
**Title:** Pre-run cost estimate always shows a dollar range "Billed directly by your AI provider" — even when the run will use the mock (no key) or a local model ($0), contradicting the onboarding's "free" local pitch.
**Repro:** No keys (or local-only) → start any workflow → estimate modal: "Estimated cost $0.012 – $0.036 … Billed directly by your AI provider."
**Screenshot:** `persona/t2-03-estimate-modal.png`
**Diane:** "I chose the keep-it-on-my-computer AI, which you told me was free. So who is billing me a cent and a half?"
**Label:** communication.

### F-110 · P2 · bug · WorkflowExecutionTab status copy
**Title:** Execution tab shows "Generating: Intake Call Information — This may take a moment depending on the AI provider" while the engine is actually idle, waiting for the user's interview answers.
**Repro:** Start Client Intake Synthesizer → confirm estimate → before answering the questions dialog, read the tab behind it.
**Screenshot:** `persona/t2-04-execution-tab.png`
**Diane:** "It says 'Generating' — generating what? I haven't told it anything yet."
**Label:** communication.

### F-111 · P2 · inconsistency · Dual interview surfaces
**Title:** Two live InterviewForm renderings for the same step — the App-level "Workflow Questions" dialog (`src/App.tsx:3511`) over an identical inline form in the execution tab (`WorkflowExecutionTab.tsx:379`). The background form looks interactive, is blocked by the dialog, and does not mirror values typed in the dialog.
**Repro:** Launch any interview-bearing workflow from the gallery → observe both forms at once (questions dialog over Step-1 form).
**Screenshot:** run artifact `runs/persona-Task-2…/test-failed-1.png` (first capture), `persona/t2-04-execution-tab.png`
**Diane:** "There's a form behind this form with the same questions on it. Which one am I supposed to be in?"
**Label:** communication/architecture duplication.

### F-112 · P2 · inconsistency · Legal pack deliverable formats vs 3.0 Word-native positioning
**Title:** 17 of 18 legal templates write SCREAMING_SNAKE markdown deliverables (`CLIENT_INTAKE_PACKAGE.md`, `ENGAGEMENT_LETTER.md`, …); only Deposition Contradiction Finder writes a .docx — despite 3.0's "Word is first-class; Markdown never appears in user-facing copy."
**Repro:** `grep outputFile src/modules/workflow/templates/legal/*.ts`. Mitigated partially by the completion panel's Export .docx button, but the artifact that lands in her folder (the thing 3.0 says is "real Word documents") is an ALL-CAPS .md.
**Screenshot:** `persona/t2-06-run-complete.png`
**Diane:** "Real Word documents in a normal folder, you said. CLIENT_INTAKE_PACKAGE-dot-md is neither."
**Label:** capability (flip `outputFile`s to .docx) — the engine already supports it (`writeDeliverable`).

**Task 2 positives logged for summary:** the legal template gallery copy is domain-fluent and trust-literate (UNVERIFIED citation quarantine, ABA 512 engagement-letter clause, "does not perform or replace a conflict search"); "Verify before relying" banner on output; export surfaced directly on the completion panel (.docx/.pptx + firm name) — the old "export under-surfaced" audit finding looks fixed; chain suggestions ("use this as input for another template") map to how matters actually flow; interview questions show real legal-practice judgment ("referral source may itself be a conflict").

---

## Task 3 findings — email connect (IMAP path; desktop-only wall)

### F-113 · P1 · inconsistency · Settings → Integrations (browser build)
**Title:** Desktop-app requirement is disclosed on the Gmail card only; Microsoft 365 and IMAP cards let the user fill in credentials and click Connect before failing with "Email connect is only available in the desktop app."
**Repro:** Browser build → Settings → Integrations → fill IMAP form (any values) → Connect → inline error after submit. Gmail card states "Requires the Keepance desktop app" up front; M365/IMAP cards do not. Guards: `src/utils/mail-commands.ts` (`mailImapConnect`, `mailBeginLogin`).
**Screenshot:** `persona/t3-01-integrations-panel.png`, `persona/t3-02-imap-filled.png`, `persona/t3-03-imap-after-connect.png`
**Diane:** "Why did it take my password first? Tell me at the top of the card — like the Gmail one does."
**Label:** communication (one consistent precondition banner across all three mail cards). Aggravator: it accepts a real password into a form that can never succeed in this build.

### F-114 · P2 · copy · IMAP "App password" guidance
**Title:** "App password (Gmail and Outlook require one)" links help for Gmail only; no Outlook/M365 app-password guidance, for the segment (attorneys on M365) the product targets — and many M365 tenants have app passwords disabled, which the copy doesn't acknowledge.
**Repro:** Settings → Integrations → Other email (IMAP) → password field placeholder + card text; single hyperlink → Google app passwords.
**Screenshot:** `persona/t3-02-imap-filled.png`
**Diane:** "An 'app password' I'd have to Google, and the helpful link here is only for Gmail. If Outlook requires one, where's MY link?"
**Label:** communication.

### F-115 · P2 · copy · MCP server card leaks developer commands into Settings UI
**Title:** The MCP integration card shows "Bundle not available. Run node scripts/build-mcpb.mjs first, or install via a released build." — a build-system instruction rendered in end-user Settings.
**Repro:** Settings → Integrations → MCP server (dev/browser build state).
**Screenshot:** `persona/t3-01-integrations-panel.png`
**Diane:** "That's the one card on this page written for someone who is not me."
**Label:** communication (gate the dev-state string; show a user-facing "not available in this build" line).

**BLOCKED (recorded, not failed):** bounded import / folder scoping UI, sync progress, encrypted-store verification, FDE nudge firing, mail viewer — all desktop-only (`isTauri()` guards). The seeded GreenMail IMAP at 127.0.0.1:3143 was alive and answering throughout. These need a desktop (Tauri + WebDriver) pass; flagged for the campaign owners.

**Task 3 positives logged for summary:** "Bring your Outlook mail into Keepance so you can actually find it" is the single best line of copy in the product for this persona (names the bleeding wound); the encrypted-local story is repeated consistently (onboarding data map ↔ integrations cards); the failure message is plain-language; the Ollama card's "Zero cost. Zero network. Zero data sharing." lands; comprehension probe PASSED on copy alone.

---

## Task 4 findings — the wedge (search + AI citations)

### F-116 · P1 · bug · AI chat "Ask my workspace" grounding (browser build)
**Title:** With "Ask my workspace" ON, the chat's RAG retrieval throws "RAG is only available in the desktop app," then silently answers anyway from open-file context, showing only a small yellow "Workspace retrieval failed; this message wasn't workspace-aware" line and NO openable citations.
**Repro:** `?testMode=true&recordMatter=1` → Local-only → AI Assistant → new Ollama chat → enable "Ask my workspace" → ask a matter question → answer returns with the yellow warning; console: `Workspace retrieval failed: Error: RAG is only available in the desktop app.` (`src/utils/tauri-commands.ts:86`, via `MemoryService.retrieve`, `AIChatViewer.tsx:948`).
**Screenshot:** `persona/t4-12-answer.png`
**Diane:** "It answered anyway? … a fluent, correct-sounding answer with cites I can't open and a quiet note that the grounding failed. That is precisely the Avianca trap."
**Label:** capability (browser RAG) + a trust-critical communication failure: degrading from "grounded with citations" to "ungrounded guess that happens to read confidently" is the single most dangerous failure mode for this user. Even where RAG is legitimately desktop-only, the chat should refuse-or-clearly-flag, not produce an authoritative-sounding answer. Desktop citation-chip behavior is UNVERIFIED here and must be confirmed.

### F-117 · P1 · ux-improvement · AI answers lack click-through citations (vs Search)
**Title:** Search opens each result to the exact passage; the AI answer renders "p. 31" / "p. 12 vs p. 47" as plain text with no clickable source — the opposite of the wedge promise ("answers with citations you can check," per the welcome screen).
**Repro:** Task 4 AI ask (above); compare to Search result click-through (`persona/t4-03-search-result-opened.png`).
**Screenshot:** `persona/t4-12-answer.png` vs `persona/t4-02-search-results.png`
**Diane:** "In Search, every hit opened the document. Here the AI gives me page numbers as plain text. I would not put 'p. 31' in a brief because this told me so."
**Label:** capability/communication. (Partly downstream of F-116: no retrieval → no source objects to cite. A local model emitting "p. 31" as prose will never be clickable without grounding.)

### F-118 · P2 · ux-improvement · Privileged Matter Mode auto-on is explained only inside Settings
**Title:** Selecting Local-only auto-enables "Privileged Matter Mode" (the cryptic status-bar pill from F-104). The plain-English explanation ("Turns off network-capable extensions so confidential work cannot leave your machine") lives only on the confidentiality settings card — not where the pill shows.
**Repro:** Settings → AI → select Local-only → read the Privileged Matter Mode block; compare to the bare status-bar pill.
**Screenshot:** `persona/t4-06-local-only-active.png`, status bar in `persona/t4-07-statusbar-local-only.png`
**Diane:** "So THAT'S what that bottom-bar thing meant. It should've said this the first time."
**Label:** communication (link/tooltip the pill to this copy). Pairs with F-104.

**Task 4 positives logged for summary (several are top-tier):**
- **Full-text Search is the wedge that lands** — 8 hits/4 files for "second appraisal", each with matter path + the exact quoted sentence inline, click-through to the passage. Drew the protocol's target "oh wow / finally" reaction and an explicit "this is what Outlook can't do." THE strongest moment of the study.
- **Live egress indicator during send** — "On your machine. Nothing leaves — This runs on a local model (Ollama). No prompt or file is sent over the network." Egress-comprehension probe PASSED with certainty; she could point at the screen. This directly satisfies the S4 egress-indicator need.
- **Confidentiality mode card copy** is honest and decisive (Local-only / Direct "the provider sees your prompt, control retention and training in your provider account" / Assured "we keep nothing"). The training-opt-out reminder missing in onboarding (F-105) exists HERE.
- **Local model accuracy** — llama3.2:3b correctly returned Nov 20 / p.31 and caught the p.12-vs-p.47 contradiction. The local path is genuinely useful, not theater.
- **Visible state change** on toggling Local-only (green note + status pill) built trust ("I believe a setting more when I can see it took effect").
- **The seeded demo `.aichat`** models the ideal answer discipline ("I am not drawing a legal conclusion… confirm each cite against the certified transcript").

---

## Task 5 findings — trust & proof

### F-119 · P1 · copy · Privacy / telemetry / unsubscribe copy leaks the developer's real name ("Jameson")
**Title:** Customer-facing copy refers to the solo founder by first name in trust-critical places: Privacy settings telemetry note ("JSONL stored on Jameson's server"), unsubscribe ("reply UNSUB to any email from Jameson, they all forward straight to him"), email opt-in help ("Goes straight to Jameson"), and bug-report titles ("sends directly to Jameson"). Present in EN and DE (all locales).
**Repro:** Settings → Privacy → read the Anonymous usage stats + Email updates sections. Source: `src/locales/en.json:179,185,586` (+ lines 12, 67) and `de.json:298,308,949` (+16,112).
**Screenshot:** `persona/t5-02-privacy-settings.png`
**Diane:** "The moment my risk committee sees 'reply to any email from Jameson,' this stops being 'a vendor' and becomes 'some guy.' Put a company name there — that one line could lose you the firm sale."
**Label:** communication. For a $468–1,548/yr legal product sold on trust ("trust before features"), a personal-name leak in the privacy disclosure is a direct firm-sale blocker. Low-effort fix (string replace → "Keepance" / a support alias), high credibility impact.

### F-120 · P2 · ux-improvement · No positive cloud-egress signal in the status bar for Direct mode
**Title:** The always-on status bar shows a "Privileged Matter Mode: network extensions disabled" pill in Local-only, but switching to Direct (your key) simply removes the pill — nothing replaces it to state "prompts now go to your cloud provider." The reassuring (safe) state is loud; the cautionary (egress) state is signaled only by absence.
**Repro:** Settings → AI → toggle Local-only (pill appears) ↔ Direct (pill disappears, no replacement); status bar dumps `persona/t5-04-egress-localonly.png` vs `persona/t5-06-egress-direct.png`.
**Diane:** "I'd want the 'this is going to the cloud now' state to be as loud as the safe state. Silence isn't a signal I can rely on."
**Label:** communication. (Per-chat egress indicator DOES show Direct state when a chat is open — F not about that surface; it's about the persistent status bar.)

### F-121 · P2 · ux-improvement · "Privileged" needs to be enforceable, not just a label (e-discovery probe)
**Title:** Diane's stated adoption condition: a chat/matter marked privileged must actually be excluded from workspace search/retrieval and tagged as such in the audit/export — not merely visually labeled. The pieces exist (include-privileged chat toggle, Privilege Log template, matter scoping) but their enforcement guarantee is not surfaced/explained to the user.
**Repro:** Conceptual + Task 6/Extended-checks (privilege tagging tested separately); raised here as the headline firm-adoption condition.
**Screenshot:** `persona/t5-01-audit-log.png` (audit/export context)
**Diane:** "I need to mark a chat or matter privileged and have THAT be real — excluded from any search a paralegal runs, tagged in the audit log — not just a label."
**Label:** capability/communication (verify-and-explain the exclusion guarantee). See Extended Spot Checks for the actual privilege-exclusion test result.

**Task 5 positives logged for summary:**
- **Audit log framing is exactly right for the persona** — "kept on your machine for your files and your defense" reads as protective, not surveillance (the protocol's framing-dependent risk resolved in the right direction); honest amber "not encrypted in browser, use desktop app" note; JSON/CSV export + date/model filters.
- **Data Map is a genuine firm-sale asset** — "printable so you can show a client," six plain-English sections, and an against-interest cloud-retention/abuse-monitoring + training-opt-out disclosure. She'd attach it to an engagement letter.
- **Cost & Usage** — by-provider monthly dollars, honest that local = $0; "cost is the part it gets right."
- **Egress indicator across mode switch** is visibly responsive (the Local-only safe state is excellent — the gap is only the Direct-mode status-bar silence, F-120).
- **Adoption verdict captured (primary strategic finding):** solo-on-local = "real matter tomorrow"; firm = conditional on (1) enforceable privilege, (2) a company identity replacing "Jameson", (3) clickable citations, (4) named attorney references + DPA/SOC2 answers. Audit+versions judged "enough for 95%" of her work; harder evidence-grade (hashes) only for contested-fabrication edge cases.

---
