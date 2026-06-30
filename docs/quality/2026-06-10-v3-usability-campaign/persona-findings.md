# Persona Study Findings — Diane Marchetti × Advisor Prep Hero 3.0 (F-101+)

**Source:** `persona-study-transcript.md` (same directory). Synthetic moderated usability study, 2026-06-10, branch `keepance-3.0`, browser build at 1366×768 (firm scenario 1536×864).
**Severity:** P0 = blocks task or causes a wrong belief about where data goes; P1 = major, impedes completion or trust; P2 = minor; P3 = cosmetic.
**Type:** bug | inconsistency | copy | ux-improvement. Each finding carries: repro, screenshot, and Diane's quote.
**Note:** This file is owned by the persona-study agent. `findings.md` and `coverage-ledger.md` are owned by other agents and are NOT edited here.

## Findings table

| ID | Sev | Type | Surface | Title |
|----|-----|------|---------|-------|
| F-106 | P0 | bug | Workflow completion | No-key workflows silently run MockProvider and present "This is a mock response." as a green "Complete" |
| F-107 | P0 | inconsistency | Workflow provider resolution | Workflows cannot use Ollama; local-pinned template falls back to a cloud key if present (egress risk) |
| F-108 | P1 | bug | markdownToDocxBytes | Markdown tables export to .docx as raw pipe/dash text (no Word table) |
| F-113 | P1 | inconsistency | Settings → Integrations | Desktop-only requirement disclosed on Gmail card only; M365/IMAP take a password then fail |
| F-116 | P1 | bug | AI "Ask my workspace" | RAG fails in browser, then silently answers ungrounded with a small warning and no citations |
| F-117 | P1 | ux-improvement | AI answers | AI answers lack click-through citations (Search has them; the welcome promises them) |
| F-119 | P1 | copy | Privacy/telemetry/unsub | Customer-facing copy leaks the developer's real name "Jameson" (all locales) |
| F-122 | P1 | ux-improvement | Matter management | Matters buried inside the AI chat; no sidebar entry (F-009 confirmed) |
| F-123 | P1 | ux-improvement | Firm member first-open | Encryption key-handshake is silent; member's first open looks broken (404) until admin republishes |
| F-126 | P1 | bug | Deposition Contradiction Finder | Hard-fails in browser (desktop-only RAG) instead of using pasted excerpts; 0 contradictions surface |
| F-101 | P2 | ux-improvement | FirstRunWizard | "Pick a workspace folder" step doesn't pick a folder — split across two screens |
| F-104 | P2 | copy | Status bar | "Privileged Matter Mode: network extensions disabled" is network-engineer jargon |
| F-105 | P2 | ux-improvement | BYOK key steps | Provider key walkthrough never mentions the training/retention opt-out |
| F-109 | P2 | copy | Workflow estimate | Always shows a dollar cost "billed by your provider" even for mock/local ($0) runs |
| F-110 | P2 | bug | WorkflowExecutionTab | Shows "Generating…" while actually idle, waiting for interview answers |
| F-111 | P2 | inconsistency | Interview surfaces | Two live InterviewForms for one step (App dialog over the exec-tab form) |
| F-112 | P2 | inconsistency | Legal pack deliverables | 17/18 legal templates write SCREAMING_SNAKE .md, not .docx (vs 3.0 Word-native) |
| F-114 | P2 | copy | IMAP app-password help | App-password link is Gmail-only; no Outlook/M365 guidance for the target segment |
| F-115 | P2 | copy | MCP integration card | Leaks dev command "Run node scripts/build-mcpb.mjs first" into end-user Settings |
| F-118 | P2 | ux-improvement | Privileged Matter Mode | Auto-on explanation lives only in Settings, not where the cryptic status pill shows |
| F-120 | P2 | ux-improvement | Status bar egress | No positive cloud-egress signal in Direct mode (safe state loud, egress state = silence) |
| F-121 | P2 | ux-improvement | Privilege enforcement | "Privileged" must demonstrably exclude from retrieval, not just label (firm condition) |
| F-124 | P2 | copy | Firm admin console | Crypto jargon + unreadable ids ("epoch 1", "Unnamed device", no matter name) |
| F-127 | P2 | ux-improvement | DocxEditor (browser) | Tracked-changes editing desktop-only; redline round-trip undemonstrable in web trial |
| F-102 | P3 | copy | WorkspaceSelector | "docs/ research/ templates/" developer idiom on the first-run screen |
| F-103 | P3 | inconsistency | DataMapDialog | British "licence" ×3 vs American "license" everywhere else |
| F-125 | P3 | ux-improvement | Shared-matter title | Raw matter-id suffix leaks into the shared-notes tab/title |
| F-128 | P3 | ux-improvement | Trial → pricing | "Upgrade" lands on a key-entry panel before the pricing tiers |

**Counts:** P0 = 2 · P1 = 8 · P2 = 14 · P3 = 4 · **total = 28.** Capability-vs-communication: ~8 capability/boundary (F-107 partial, F-108, F-116, F-117, F-122, F-123, F-126, F-127), the rest communication/copy/UX. Both P0s are "wrong belief / silent failure" class (the protocol's severity-4 trigger).

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
**Repro:** Onboarding data-map step → expand "The only thing Advisor Prep Hero's own servers ever see is a licence check". Source: `src/components/privacy/DataMapDialog.tsx:99-100`.
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
**Repro:** Browser build → Settings → Integrations → fill IMAP form (any values) → Connect → inline error after submit. Gmail card states "Requires the Advisor Prep Hero desktop app" up front; M365/IMAP cards do not. Guards: `src/utils/mail-commands.ts` (`mailImapConnect`, `mailBeginLogin`).
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

**Task 3 positives logged for summary:** "Bring your Outlook mail into Advisor Prep Hero so you can actually find it" is the single best line of copy in the product for this persona (names the bleeding wound); the encrypted-local story is repeated consistently (onboarding data map ↔ integrations cards); the failure message is plain-language; the Ollama card's "Zero cost. Zero network. Zero data sharing." lands; comprehension probe PASSED on copy alone.

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
**Label:** communication. For a $468–1,548/yr legal product sold on trust ("trust before features"), a personal-name leak in the privacy disclosure is a direct firm-sale blocker. Low-effort fix (string replace → "Advisor Prep Hero" / a support alias), high credibility impact.

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

## Task 6 findings — firm scenario (two contexts)

### F-122 · P1 · ux-improvement · Matter management is buried inside the AI chat (also the F-009 probe)
**Title:** The only path to create/share/open a matter is: open an AI chat → click the matter-scope control in the chat header → "Manage matters." Matters — the spine of a legal practice — have no sidebar entry of their own.
**Repro:** testMode → there is no "Matters" sidebar tab; matter manager reachable only via `matter-scope-selector` → `matter-scope-manage` inside AIChatViewer (or Ctrl+Shift+A).
**Screenshot:** `persona/t6-03-matter-manager.png`
**Diane:** "Matters should be a thing in the sidebar, not buried inside the AI chat. I'd never have found this without being shown."
**Label:** capability/navigation. Directly answers the F-009 probe: she could NOT find matter management unaided (see Extended Checks for the cold-find attempt).

### F-123 · P1 · ux-improvement · Encryption key-handshake on member first-open is silent (looks broken)
**Title:** A member's first attempt to open a shared matter fails (device key not yet published); it only works after the admin clicks "Re-publish keys to all member devices." Neither side is told this is expected or what to do — the member sees a failure and a console 404.
**Repro:** Two contexts; member opens shared matter pre-publish → `firm-open-error` + console "404 Not Found"; admin must `firm-republish-keys`; member retries → links.
**Screenshot:** `persona/t6-11-member-remote-matters.png`, `persona/t6-12-member-after-open.png`
**Diane:** "She'd have called me saying 'it's broken'… we'd have both decided the firm feature is flaky. The security model is excellent; the choreography is invisible at exactly the moment two non-technical people need it explained."
**Label:** communication around a (good) capability. Suggested: auto-prompt the admin to publish on invite, and show the member a "waiting for the firm admin to grant your device access" state instead of an error. The 404 should not reach the console as an unhandled error.

### F-124 · P2 · copy · Firm admin console exposes crypto jargon + unreadable identifiers
**Title:** The admin console lists matters as "[client name] [matter-id-suffix] epoch N" (no matter NAME; "epoch 1" is cryptographer jargon), and seats as "Unnamed device [hex]" — a firm admin auditing access cannot read what she's governing. Two distinct matters both displayed as "Teresa Okafor" were indistinguishable.
**Repro:** Admin → Settings → Firm → matter list + Seats list. Source: `FirmAdminConsole.tsx` (`epoch-label`, matter row, seat rows).
**Screenshot:** `persona/t6-15-admin-sees-reply.png`, `persona/t6-08-member-invited.png`
**Diane:** "'Unnamed device' and 'epoch 1' are exactly the words that make me nervous, because I can't audit what I can't read."
**Label:** communication (show matter name; relabel "epoch" as "access version" or hide it; let devices be named). Pairs with the firm-adoption / risk-committee axis.

### F-125 · P3 · ux-improvement · Shared-matter tab/title carries the raw matter-id suffix
**Title:** The shared-notes tab and document title read "Teresa Okafor mq834p1f: Shared notes" — the internal id fragment leaks into the title both lawyers see.
**Repro:** Open shared matter notes (either context); tab + breadcrumb show "[client] [id-suffix]: Shared notes".
**Screenshot:** `persona/t6-13-member-sees-admin-text.png`
**Diane:** "What is 'mq834p1f'?"
**Label:** communication.

**Task 6 positives logged for summary (the firm story is real and differentiated):**
- **Genuine end-to-end encrypted, live-converging shared notes between two solo-grade users** — admin↔member bidirectional convergence verified on content. She explicitly said she "didn't think this existed for a two-lawyer shop."
- **Ethical wall as a first-class admin action** enforced by key-epoch rotation (not UI hiding) — lands hard with her conflicts-screen instinct ("an ethical wall as a button… whoever built this has done a conflicts check").
- **The server-holds-only-ciphertext model** is the answer she'd take to a risk committee ("better than my current 'we're careful'").
- **Seat model** reads as familiar enterprise (Clio-like), login + license-key separation understood.
- The friction is packaging (hidden matters door, silent key handshake, jargon), NOT the underlying capability — an important strategic read: the hard cryptographic engineering works; the last-mile explanation doesn't.

---

## Task 7 findings — extended spot checks

### F-126 · P1 · bug · Deposition Contradiction Finder hard-fails in browser instead of using pasted inputs
**Title:** The flagship litigation workflow's analyze step depends on desktop-only RAG ("Retrieve the matter record…") and throws "RAG is only available in the desktop app," failing the whole run — even though the user pasted the full transcript + prior statements directly into the workflow's own textareas. The 3 planted contradictions never surface; no citations produced.
**Repro:** `?testMode=true` → Workflows → Deposition Contradiction Finder → paste `deposition-transcript-johnson.txt` into depositionExcerpts + `incident-summary-johnson.md` into priorStatements → run → "Failed: RAG is only available in the desktop app." (analyze step, `MemoryService.retrieve`).
**Screenshot:** `persona/t7c-02-result.png`
**Diane:** "I handed it the transcript and my summary on a silver platter, and it just… failed. If the headline litigation feature silently dies in the trial I'm evaluating, I'd never know it was the crown jewel."
**Label:** capability (browser RAG) + defect: a workflow given sufficient inline inputs should not hard-require RAG; it should use the pasted excerpts or refuse before the user does the work. Most damaging because it's the Professional-tier marquee feature (per the pricing page).

### F-127 · P2 · ux-improvement · Tracked-changes editing is desktop-only with no in-context "why / what you're missing"
**Title:** In the browser build the DocxEditor is read-only ("Editing Word documents with tracked changes is only available in the Advisor Prep Hero desktop app"), with no tracked-change rendering and no review pane — so a prospect cannot experience accept/reject redlining, a core sell, anywhere in the trial-able web build.
**Repro:** Open any tracked-changes .docx (fixture `engagement-letter-tracked.docx`) in the browser build → read-only banner; 0 insertion/deletion marks; no `docx-review-pane`.
**Screenshot:** `persona/t7b-01-docx-loaded.png`
**Diane:** "Accepting and rejecting redlines IS my job on an engagement letter. I can't judge that from a read-only preview."
**Label:** capability boundary (desktop-only) — flagged as a go-to-market gap: the redline round-trip and contradiction finder (F-126) are the two features she'd pay for, and neither is demonstrable in the web build. The committed Rust `campaign_fixtures.rs` validates the engine; the in-app UX round-trip needs desktop verification.

### F-128 · P3 · ux-improvement · Trial chip → pricing is good; "Upgrade" lands on a key-entry License panel, not the tiers, on first click
**Title:** Clicking the status-bar "Upgrade" chip opens the License panel ("Activate Advisor Prep Hero with a license key purchased at keepance.com") with the pricing tiers below; a buyer who hasn't purchased sees an activation field first. Minor ordering nit — pricing/value should lead for a not-yet-customer.
**Repro:** Status bar "Free trial · 30 days left · Upgrade" → License settings; pricing-tiers render but below the activation copy.
**Screenshot:** `persona/t7f-01-license-settings.png`, `persona/t7f-02-pricing-tiers.png`
**Diane:** "Honest pricing once I scroll to it; just lead with what I get, not with a key box for a key I don't have yet."
**Label:** communication (minor).

**Task 7 BLOCKED (desktop-only, recorded not failed):** privilege retrieval-exclusion enforcement (7A), tracked-change accept/reject round-trip (7B), contradiction-finder analysis (7C, also F-126), trash/restore full cycle (7E, empty-state only). Pattern: the RAG/OOXML-edit layer is desktop-gated; the browser build a prospect trials cannot demonstrate the three highest-value AI features.

**Task 7 positives logged for summary:**
- **Version history (7D)** — timestamped versions, per-version restore, byte deltas, total size; "better than anything I have today," ties to her evidence-grade defense need. Clean Success.
- **Trial → pricing (7F)** — honest annual/monthly pricing, no "contact sales," tier feature lists in her language; Professional correctly positioned as the litigator tier. No dark patterns.
- **Privilege "Include privileged" toggle (7A)** exists at the point of asking, defaulting privileged content OUT of queries — the right default.
- **Soft-delete Trash (7E)** exists as a safety net (lowers her anxiety even unexercised).
- **F-009 (7G)** definitively answered: NO "Matters" sidebar entry; matter management undiscoverable unaided (reinforces F-122 to P1).

---

---

## Diane's overall verdict

"Here's my honest read after an hour. The *story* this product tells is the best I have ever seen in legal software — it knows my bleeding wound is Outlook search, it tells me the truth about where my data goes including the parts that aren't in its favor, and it gives me a printable page I'd staple to an engagement letter. The full-text **search** and the live **'nothing leaves your machine'** signal are, by themselves, worth the price of admission — the search alone would give me back a Saturday a month, and for the first time in two years I could point at the screen and *prove* my client's question didn't leave the building.

But there's a gap between the story and the thing I actually got my hands on. The first workflow I ran handed me five words of nothing under a green checkmark. The AI answer that should clinch it gave me page numbers I can't click and a tiny note admitting it didn't really look — which is exactly the Avianca trap I'm terrified of. The two features I'd most pay for — redlining tracked changes and the contradiction-finder — I couldn't even test in the version you gave me; one was read-only, the other failed outright. And in your own privacy screen, the thing meant to make me trust you, it says 'email Jameson' — which tells my risk committee this is one guy, not a company.

So: **for just me, on my own laptop, on the local model — I'd put a real, low-stakes matter on this next week**, because the search and the privacy posture earn that much trust. **For my firm, not yet.** Fix the silent failures so I always know whether the AI actually did the work, make every AI answer hand me a citation I can click like Search does, put a company's name where 'Jameson' is, and show me three lawyers I respect who already trust it. Do those, and this stops being the most promising thing I've seen and becomes the first AI tool I'd actually adopt for client work. You are closer than anyone else. You are not done."

**Adoption verdict (structured):**
- **Solo / own laptop / local model:** *Would adopt now* for a real low-stakes matter — driven by Search + egress trust.
- **Firm / risk committee:** *Conditional.* Named conditions: (1) no silent AI failures — always signal mock/degraded/desktop-only; (2) click-through citations on every AI answer; (3) a company identity replacing "Jameson"; (4) enforceable (not cosmetic) privilege/ethical-wall with an auditable trail; (5) named attorney references + DPA/SOC-2 answers.
- **The one fix that most changes her answer:** make the AI's grounded, cited answer work end-to-end (F-116/F-117) — "a citation I can click is the difference between the AI I'm scared of and the AI I'd use."

## Top 5 delights
1. **Full-text Search across the matter** — "I typed two words and it handed me the sentence. This is what Outlook can't do." The single strongest moment; drew the target "oh wow / finally." (Task 4)
2. **Live egress indicator** — "On your machine. Nothing leaves," shown at the exact moment she sends a prompt. Resolved two years of AI privacy anxiety in one green bar. (Task 4)
3. **The honesty of the data story** — onboarding data map + the printable Data Map ("printable so you can show a client") + against-interest cloud-retention/training-opt-out disclosure. "The first vendor privacy page I'd actually believe." (Tasks 1, 5)
4. **Real encrypted firm collaboration** with an ethical-wall button enforced by key rotation — "I didn't think this existed for a two-lawyer shop." (Task 6)
5. **Version history + audit log framed as 'your defense'** — "better than anything I have today" for the who-changed-what anxiety. (Tasks 5, 7D)

## Top 5 frictions
1. **Silent mock/degraded AI** — workflow "Complete" = "This is a mock response." (F-106); AI ask degrades to ungrounded with a buried warning (F-116). Wrong-belief class; her #1 trust-killer.
2. **The two pay-for features undemonstrable/broken in the trial build** — contradiction finder hard-fails (F-126); tracked-change redlining is read-only (F-127).
3. **AI answers without click-through citations** (F-117) — "the Avianca trap"; sends her back to Search.
4. **"Jameson" in the privacy/trust copy** (F-119) — "this stops being a vendor and becomes some guy"; a firm-sale blocker hiding in the trust surface.
5. **Matter management hidden inside the AI chat** (F-122 / F-009) — the practice's organizing concept has no front door; undiscoverable unaided.

## Comprehension-probe quotes (verbatim)
- **Task 1 — "where are your files now, who can see them?"** *(PASS)*: "On this computer, in a folder I picked. Real files, Word-friendly. Advisor Prep Hero the company never sees them; the only thing their server ever hears is 'is her licence paid.' If I use the cloud AI, the question I type goes to that AI company directly — which is why there's a local mode where nothing leaves at all. I'd put the privileged matters on local mode."
- **Task 3 — "where did your email go? could Advisor Prep Hero read it? the AI?"** *(PASS on copy)*: "Advisor Prep Hero pulls a copy of my mailbox onto THIS computer and scrambles it — encrypted, on my machine. Advisor Prep Hero the company never has it; the only thing their server hears is whether I paid. The AI sees a piece of mail only when I ask about it — and on the local model, even that never leaves the building."
- **Task 3 — storage-at-rest**: "The mail's encrypted. My documents are regular Word files in a regular folder, so whoever has the laptop has them unless the disk itself is locked — and I don't know if my office machine's disk is. If your product knows it isn't, that's a thing I'd want it to nag me about."
- **Task 4 — egress "where did your question go?"** *(PASS, with certainty)*: "On my machine. The green bar said so while I typed it — local model, nothing over the network. Nobody could read it. And I'm certain because the software told me at the right moment, not in a help article."

## Coverage-ledger surfaces touched (informational — ledger owned by another agent)
This study exercised, at minimum: FirstRunWizard (welcome, profession, workspace, data-map, AI-setup BYOK + local), WorkspaceSelector, DataMapDialog (onboarding + Settings→Privacy, L-169-ish), Sidebar tabs files/search/workflows/ai-assistant/audit/trash, SearchPanel, AIAssistantPane (local-only picker, new-chat-ollama, api-keys/models tabs), AIChatViewer (ask-workspace, include-privileged, egress indicator, sources), EgressIndicator, ConfidentialityModeSettings (local/direct/assured + privileged-matter), StatusBar (trial chip, privileged pill, breadcrumb), WorkflowPanel + estimate modal + execution tab + InterviewForm (Client Intake Synthesizer L-062, Deposition Contradiction Finder L-065), markdownToDocxBytes export, editor Export-as menu, MainPanel docx viewer/editor (read-only browser path), version history (toolbar-history), TrashPanel, Settings categories (License/Firm/AI/Privacy/Integrations/Cost&Usage/Templates), MailImapConnect + MailConnect + MailGmailConnect + MCP/Ollama integration cards, PricingTiers, AuditLog, TemplateModelSettings, FirmSignIn + seat activation + FirmAdminConsole (invite, republish-keys, ethical-wall, members, seats), MatterManagerDialog + matter-scope-selector, MatterNotesEditor (two-context live convergence). Ledger rows plausibly implicated include L-060/L-062/L-065, L-110, L-121, L-167/L-169, L-171–L-176. **Not edited here** — flagged for the ledger-owning agent.

## Harness boundaries (honest BLOCKED list for a desktop follow-up)
The browser build cannot exercise the Tauri-only mail engine and the desktop-only RAG/OOXML-edit layer. BLOCKED and needing a desktop (Tauri + WebDriver) pass: email device-code sign-in + bounded import + sync progress + encrypted-store + FDE nudge (Task 3); "Ask my workspace" grounded citations (Task 4, F-116); tracked-change accept/reject round-trip (Task 7B, F-127); Deposition Contradiction Finder analysis (Task 7C, F-126); privilege retrieval-exclusion enforcement (Task 7A); trash/restore full cycle (Task 7E). The native folder picker (Task 1) is a browser limitation, not a defect.
