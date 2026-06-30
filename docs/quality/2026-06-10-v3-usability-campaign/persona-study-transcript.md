# Persona Usability Study — Diane Marchetti × Advisor Prep Hero 3.0

**Date:** 2026-06-10 (attempt 3; two prior runs killed by server restarts — screenshots t1-01..t2-01 from prior attempts retained/overwritten where re-captured)
**Method:** Synthetic moderated think-aloud per `docs/research/2026-06-08-ux-attorney-v2.5.1/instruments/usability-test-protocol.md`. Claude plays both moderator (Dr. Lena Whitfield, method notes in *italics*) and participant (Diane Marchetti, 54, solo/small-firm litigator, Cleveland). The app is driven live via Playwright against `http://localhost:5173` (branch `keepance-3.0`); the think-aloud is written from the actual captured screens, text dumps, and console logs of each run.
**Environment:** Vite dev server (browser build, WebFS), Ollama `llama3.2:3b` local, GreenMail IMAP at `127.0.0.1:3143` seeded with 12 Johnson-matter emails, firm backend at `127.0.0.1:5290` via `/api/firm` proxy, fixture corpus `tests/fixtures/matter-corpus/`. Tasks 1–5 at 1366×768; firm scenario at 1536×864. No real cloud keys used anywhere.
**Harness notes:** Task 1 runs WITHOUT `testMode` (true first run). The native folder picker cannot complete in a headless browser; the study notes that limitation in place and continues under `?testMode=true` (mock workspace) — declared in the transcript where it happens. Screenshots land in `screenshots/persona/`. Console errors are collected per context and reported as findings.

**Findings live in:** `persona-findings.md` (F-101+). This file is the session transcript.

---
## Task 1 — First run: install to a working workspace (NO testMode, fresh context)

*Moderator note: fresh browser context, cold load of `http://localhost:5173/` with no flags. Console collector attached before navigation. Screens: `persona/t1-01` … `t1-13`. Baseline confidence check: "Diane, one to seven?" — "Five. A colleague liked it, and I already like that it isn't a website asking me to make an account."*

**[t1-01-first-launch]** The wizard opens over a quiet launch screen. Card reads "Welcome to Advisor Prep Hero — The private place your work lives, that answers you back."

**Diane:** "Okay. 'Keeps your documents and email on your own machine… answers with citations you can check… your files stay real files in a folder you control.' That's three sentences and it already answered my first three questions. 'Citations you can check' — somebody on that team has read about the Avianca thing. Good. And it says setup is about 2 minutes with three steps listed up front. I'll hold you to that, because I bill in tenths."

**[t1-02-profession-picker]** "What kind of work do you do?" — Legal practice / Tax & accounting / Consulting & strategy / Something else.

**Diane:** "Legal practice, obviously. 'Attorneys, paralegals, and legal professionals. Comes with the Legal Practice template pack.' Fine. I notice there's a 'Skip for now' in the corner of every one of these screens, which I appreciate — nothing's holding me hostage." *(picks Legal; the continue button reads "Got it")*

**[t1-04-folder-explainer]** "Pick a workspace folder — Your files stay on your machine, in a folder you control."

**Diane:** "'Real Word documents, PDFs, and notes in a normal folder on your hard drive. Nothing is uploaded anywhere.' That's my language. And look at this — 'a folder inside Dropbox, iCloud, or OneDrive syncs across devices, but that also means your files sit with that provider. For client-confidential work I'd keep the folder local.' That is the single most honest sentence I've read in legal software marketing. My NAS guy put my matters on OneDrive and I've never been sure whether that was smart. One gripe: the title says 'pick a workspace folder' but the fine print says 'the next screen will let you actually pick the folder. For now, just confirm you understand.' So step one isn't picking a folder, it's agreeing to pick a folder later. Don't make me 'Got it' twice for one decision."

**[t1-05/t1-06 data-map]** The "Where your data lives and who can see it" step; six plain-language accordion sections. Diane expands all six.

**Diane (reading the headers aloud):** "'Your files and notes stay on your machine.' 'Your AI keys live in your operating system keychain.' 'When you use a cloud model, your prompt goes straight to that provider.' 'For nothing-leaves work, use a local model.' 'Imported email is encrypted on your machine.' 'The only thing Advisor Prep Hero's own servers ever see is a licence check.' … This is the page I'd print and staple to my malpractice-carrier questionnaire. It even tells me the browser demo routes through a shared relay and should never see client data — which is the kind of against-interest honesty I trust. The one wrinkle: a cloud prompt 'goes straight to that provider.' So the AI company still sees what I send it. It's not hiding that, which is the point. Spelling nit: it says 'licence' like a British solicitor wrote that one paragraph."

**[t1-07-ai-setup-choice]** "Connect an AI to help you. One short choice, then you are done. There is no wrong answer here." Three cards: Use your own AI account (Recommended for most) / Keep everything on your computer (Most private) / Set this up later.

**Diane:** "Here's where these tools usually lose me — last one of these I tried said 'enter your API key' like I'd know what that means, and I closed the tab. This says I connect my own account, my questions 'never pass through Advisor Prep Hero,' and I 'pay that company directly, usually a few dollars a month.' So Advisor Prep Hero isn't reselling me the AI. Honest, but somebody at a CLE will need that drawn as a picture. Let me look at the recommended one first."

**[t1-08-byok-claude-steps]** The BYOK panel: Claude/OpenAI/Gemini tabs, 5 numbered steps with the explainer: "You will copy a short code called an AI key. What is that? It is like a password that lets your computer talk directly to Claude… Advisor Prep Hero stores it in your computer's secure keychain and never on a server."

**Diane:** "'A short code called an AI key… like a password.' Finally somebody translated it. The five steps are real instructions — which menu, what NOT to click ('NOT Workspaces or Members'), and 'copy the key IMMEDIATELY, Anthropic shows it once.' That's the kind of detail you only write after watching people fail. I could do this. I'm not doing it today — I'm not giving a new tool a credit card on day one — but for the first time the key step reads like a recipe, not an initiation rite. Where's the 'most private' one?" *(clicks Other options, then "Keep everything on your computer")*

**[t1-09-local-ai-detected]** Local AI panel: "…a free tool called Ollama… It is the most private option… The trade-off is that local models are usually less capable than Claude or GPT." Status: **"Ollama is running, with 1 model ready. You are all set to run AI privately on this machine."**

**Diane:** "'Nothing is sent over the internet, not even to an AI company.' And it tells me the trade-off — local is dumber. I respect a product that tells me its own bad news. It also says choosing this turns on 'Local-only mode… so nothing can leave your machine by accident.' By accident — that phrase is doing a lot of good work. And it already found this Ollama thing running on the machine. On MY office PC nothing called Ollama is running, and I'd be staring at an install step here — but today it's green, so: use local AI and continue." *(Moderator note: machine has Ollama preinstalled; the not-installed path was not exercised in this pass.)*

**[t1-10-first-workflow-step]** "Run your first workflow — see the magic moment in action," with a "Populate workspace with 2 sample files" toggle.

**Diane:** "It's pointing me at a Workflows tab and offering sample files so I can see a finished example first. Smart — I'd rather see one than make one. 'Open my workspace.'"

**[t1-11-real-folder-picker]** The wizard closes onto the launch screen: keepance logo, "Your AI workspace. Your files. Your machine.", two cards — **Open Existing** ("Select a workspace folder") and **New Workspace** ("docs/ research/ templates/").

**Diane:** "Two cards. 'Open Existing' versus 'New Workspace.' I don't have an existing anything, so New Workspace. The little 'docs/ research/ templates/' in typewriter font is the first whiff of programmer in this whole thing — slashes after folder names is how software people write, not how I write. I'd say 'It creates Documents, Research and Templates folders for you.'" *(clicks New Workspace)* "…And nothing happened. I clicked it twice. Nothing. In real life this is where I'd assume I broke it, wait ten seconds, click once more, and then call my paralegal in to watch me click it."

*Moderator/harness note: in a headless browser the native File System Access directory picker cannot open — this is a known browser-automation limitation, not a product defect; on the desktop app this opens a normal Windows folder dialog. As declared in the method, the study continues from here under `?testMode=true` (mock workspace, sample files `test1`/`test2`). Console errors pre-switch: 0.*

**[t1-13-workspace-first-view]** The workspace shell: sidebar (Files, Search, Workflows, AI Assistant, Research, Whiteboard, AI Audit, Trash), editor with two sample tabs, status bar showing "Free trial · 30 days left · Upgrade", "Privileged Matter Mode: network extensions disabled", "All matters", "Memory: ready".

**Diane:** "Alright, this looks like a real program — file list on the left, document in the middle, and the bottom bar already says 'Free trial, 30 days left' so I know where I stand. 'AI Audit' right there in the sidebar — noting that for later, because that's the receipts drawer. 'Privileged Matter Mode: network extensions disabled' — I have no idea what a network extension is, but 'privileged' is my word, the one I'd use, so I want to know what that does."

**Comprehension probe (protocol):** *"In your own words, where are your files now, and who can see them?"*
**Diane:** "On this computer, in a folder I picked — well, would have picked. Real files, Word-friendly. Advisor Prep Hero the company never sees them; the only thing their server ever hears from me is 'is her licence paid.' If I use the cloud AI, the question I type goes to that AI company directly — so they see what I send, which is why there's a local mode where nothing leaves at all. I'd put the privileged matters on local mode." *(Moderator: that is a correct articulation of the data model, including the cloud-prompt nuance the persona brief flagged as her known blind spot.)*

**Task 1 wrap:**
- **Success criteria:** Success, unassisted (informed AI choice made — local; correct data-model articulation; reached workspace via declared harness bridge at the folder-pick boundary).
- **Time-to-task feel:** Fast — quicker than her Clio onboarding by a wide margin; the wizard's "2 minutes" claim felt honest.
- **SEQ:** 6/7. "Would've been 7 if step one didn't make me agree to pick a folder before letting me pick a folder."
- **Her verdict line:** "Whoever wrote this setup has met a lawyer. I got through the part where I always quit, and I can repeat their privacy story back — that's a first."
- **Console errors:** 0 (both pre- and post-switch contexts).

---
## Task 2 — Produce a real deliverable: legal workflow → Word

*Moderator note: new context, `?testMode=true` (mock workspace; the file tree does not list written files under the mock FS — a harness artifact, flagged where it bites). Ollama running with `llama3.2:3b`, per her Task 1 choice. No cloud keys configured — exactly the state a "keep everything on my computer" user is in. Screens `persona/t2-01` … `t2-15`. Scenario read aloud: new client intake → clean summary → Word on letterhead.*

**[t2-01/t2-02]** Sidebar → Workflows. The panel lists "BUILT-IN (55)" with the legal pack on top: Deposition Contradiction Finder, Evidence Gap Analyzer, Case Timeline Builder, Privilege Log Drafter, … Client Intake Synthesizer.

**Diane:** "Now this reads like someone who's met my week. 'Deposition Contradiction Finder… every finding carries a citation you verify.' 'Privilege Log Drafter… formatted to common court standards with attorney review flags.' 'Legal Research Memo… every AI-supplied citation is placed in an UNVERIFIED table for attorney verification.' Whoever wrote these knows the Avianca lesson cold. There's even 'Engagement Letter with AI Disclosure Clause… meeting ABA Opinion 512's client-consent duty' — okay, that's the first product I've seen that cites 512 without claiming to BE my compliance. Client Intake Synthesizer: 'Matter Summary, a Conflict Check Memo with parties to search, and a Preliminary Scope of Work.' That's my Tuesday. Start."

**[t2-03 estimate]** A "Start workflow" dialog: Total steps 2, AI calls 1, **"Estimated cost $0.012 – $0.036 … Billed directly by your AI provider."**

**Diane:** "A cost estimate before it runs — in actual dollars, and honest that the AI company bills me, not Advisor Prep Hero. I like the instinct. Except… I chose the keep-it-on-my-computer AI, which you told me was free. So who exactly is billing me a cent and a half? Either it's free and this is wrong, or it's not free and the setup screen was wrong. Small thing, but pennies are how you earn or lose me on honesty. Run workflow."

**[t2-04 + questions dialog]** The execution tab opens — and immediately says **"Generating: Intake Call Information — This may take a moment depending on the AI provider"** — while a "Workflow Questions" dialog pops over it. Behind the dialog, the tab ALSO shows the same questions as an inline form.

**Diane:** "Hold on. The screen behind says it's 'Generating' — generating what? I haven't told it anything yet. And there's a form behind this form with the same questions on it. Which one am I supposed to be in? I'll answer the one on top, but if I clicked the wrong place I'd be typing into the dead one." *(fills the dialog: Teresa Okafor; Employment; Referral from existing client; pastes her rough call notes — shorthand, dates, the husband's vendor company as a conflict flag; Moderate; conflicts note)* "The questions themselves are excellent, for the record — 'referral source may itself be a conflict' is a thing real intake forms forget. Continue."

**[t2-06 run-complete]** The run bar goes green: **Complete**. Her answers echo back, then a yellow banner: **"Verify before relying. This output is a structured intake record. Run the conflict check independently — this template does not perform or replace a conflict search."** Then the panel: **Generated Output — "This is a mock response."** Below it: Firm name (optional), Save as file, Export .docx, Export .pptx, and "Use this as input for another template" suggestions.

**Diane (long pause):** "…'This is a mock response.' That's it? Five fields and my whole intake narrative, the bar fills up green, it stamps it 'Complete,' and the work product is five words of nothing. Is it broken? Did I not pay for something? It didn't say a single word about anything being wrong. If this is a trial limitation, TELL me it's a trial limitation. If it needed the cloud AI, tell me THAT — I picked the on-my-computer option because your own setup screen recommended it for sensitive work, and the AI panel found the model just fine. Right now this reads like the product equivalent of a junior associate handing me a binder labeled 'Memo' with blank pages inside and saying 'done!' I bill in tenths of an hour. That just cost me one and produced literally a sentence telling me it produced nothing."

*Moderator note: the console (invisible to her) logged "No API key configured - using mock provider (documents will contain placeholder content)." The UI surfaced nothing. Code inspection (`src/App.tsx` workflow provider chain ~2337-2414) confirms workflows resolve claude/openai/gemini keys then fall back to a MockProvider; there is no Ollama branch anywhere in App.tsx — while onboarding sells local AI, Settings → Templates offers pinning any template to Ollama, and the chat surface supports Ollama via `providerFactory.ts`. Per protocol this is recorded, not fixed.*

**Diane (continuing, on the completion panel itself):** "I'll say this for the wrapper: the 'Verify before relying… does not perform or replace a conflict search' banner is exactly right — that's my duty and it knows it. And the export row is right there: Word, PowerPoint, a firm-name box — no hunting through menus. The bones of this screen are good. The meat is missing."

**[t2-12 … t2-15, editor + export]** *Moderator bridge, declared: to judge the Word output against her letterhead bar despite the mock content, the moderator placed a realistic intake package (same structure the template promises: Matter Summary, conflict table, numbered scope) into a document and used the editor's own Export as → Word (.docx) — the identical `markdownToDocxBytes` pipeline the workflow uses for .docx deliverables. The browser save dialog cannot open headless; bytes were captured by stubbing the picker (harness note, not a product issue). Export as menu offers: Markdown (.md), Word (.docx), PDF (.pdf), PowerPoint (.pptx).*

**Diane (looking at the document in the editor first):** "In the editor my memo has two asterisks around every bold word and pound signs for headings — there's a Preview button that cleans it up, but the default view is the typewriter version. I'd live in Preview if I lived here at all." *(the exported .docx is opened and inspected)* "The Word file itself: title, real headings, the numbered list survived, body text is fine — honestly better than I expected, it's a real document, not a printout of code. But the conflict-check table — the one table I actually need — came through as text with vertical bars and a row of dashes in it. In Word. A conflict memo I'd have to rebuild by hand as a table before it touches letterhead. Close, and 'close' on tables means my paralegal redoes it, which means it isn't done."

**Task 2 wrap:**
- **Success criteria:** **Fail** on the protocol's own terms — the workflow completed mechanically but the deliverable was placeholder text with no explanation ("concludes the output isn't a usable professional document," compounded by a wrong belief about why). The interview/form model itself: clear pass. Word pipeline: partial (headings/lists/styles yes; tables no).
- **Time-to-task feel:** The form was fast — faster than filling her paper intake sheet. The dead-end is what burned the time.
- **SEQ:** 2/7. "The form deserves a six. The ending deserves a one."
- **Her verdict line:** "You wrote workflow descriptions that made a 24-year litigator feel seen, then shipped me five words of nothing with a green checkmark on it."
- **Console errors:** 0 (the mock-fallback notice went to the console, where no lawyer will ever read it).

---
## Task 3 — Connect email and understand what just happened (IMAP path)

*Moderator note: scenario adapted to the seeded GreenMail server (IMAP `127.0.0.1:3143`, `diane@marchetti-law.test`). Screens `persona/t3-01` … `t3-03`. IMPORTANT HARNESS BOUNDARY DISCLOSED UP FRONT: the entire mail engine (connect, sync, bounded import, encrypted store, mail viewer) lives in the Tauri desktop backend (`src/utils/mail-commands.ts` guards every call with "only available in the desktop app"); this Playwright harness drives the browser build, so the study can capture the connect UX up to the wall, and the wall itself, but NOT the sync/progress/bounded-import experience. Those sub-steps are recorded as BLOCKED, not failed.*

**[t3-01 integrations panel]** Settings → Integrations. Cards: Microsoft 365 email, Other email (IMAP), Gmail (native), MCP server, Ollama (local models).

**Diane:** "'Microsoft 365 email — Bring your Outlook mail into Advisor Prep Hero **so you can actually find it**.' Whoever wrote that sentence has sat next to me at 7:40 in the morning. That's the entire reason I'm in this chair. And the next line: 'Your mail is encrypted and stays on this machine.' Both halves of my question answered before I asked. The IMAP one says my password 'is stored only in this device's keychain and never leaves your machine' — keychain, machine, mine. Consistent story everywhere I poke."

**Diane (scanning further down):** "The Gmail card says 'Requires the Advisor Prep Hero desktop app.' Hm — does the Microsoft one require it too? It doesn't say. And what's this 'MCP server' thing — 'Bundle not available. Run node scripts slash build dash mcpb dot mjs first.' I'm sure that's a sentence in some language. That's the one card on this page written for someone who is not me. The Ollama box though — 'Ollama ready, 1 model installed, llama3.2:3b. Zero cost. Zero network. Zero data sharing.' — fine, that one I actually understand, and it matches what setup told me."

**[t3-02 IMAP filled]** She fills the IMAP form: Host 127.0.0.1, Port 3143, her test address, the app password.

**Diane:** "My firm mail is Microsoft, so in real life I'd hit the big blue 'Connect Microsoft 365' button. For today's test account it's this IMAP form. 'App password (Gmail and Outlook require one)' — I know what a password is; an 'app password' I'd have to Google, and the helpful link here is only for Gmail. If Outlook 'requires one,' where's MY link? Also, I notice I'm typing a password into a box. The line above promises it goes to my keychain. Okay. Connect."

**[t3-03 the wall]** Inline, under the form: **"Something went wrong: Email connect is only available in the desktop app."**

**Diane:** "…So this whole form was never going to work in this version? Then why did it take my password first? Tell me at the top of the card — like the Gmail one does — not after I've typed my credentials into a dead end. I'll say this much: the error is in English. 'Only available in the desktop app' I understand, and in real life I'd be ON the desktop app, so fine. But the order of operations here is: ask for the secret, then mention the precondition. Lawyers notice clause order."

*Moderator note: BLOCKED beyond this point in this harness — device-code sign-in, folder scoping / bounded import, sync progress, the encrypted mail store, and the FDE (full-disk-encryption) nudge (`mailFdeStatus` returns unknown in browser). These need a desktop-app pass and are flagged as such in findings and the ledger notes. The seeded GreenMail server answered on 3143 throughout (verified out-of-band), so the desktop path had a live target.*

**Comprehension probe (asked on what she's seen):** *"Walk me through what happened — where would your email be? Could Advisor Prep Hero read it? Could the AI?"*
**Diane:** "If this worked the way every screen here says: Advisor Prep Hero pulls a copy of my mailbox onto THIS computer and scrambles it — encrypted, on my machine. Advisor Prep Hero the company never has it; the only thing their server hears is whether I paid. The AI sees a piece of mail when I ask a question about it — and if I'm on the local model, even that never leaves the building. The part I can't tell you, because I never got to it: whether I can import just SOME of it. Forty matters of mail is one thing; my entire 19-gigabyte archive going into any new program — even on my own machine — I'd want a 'just this folder' option, and I never got far enough to see one."

*Moderator note: her articulation matches the product's documented model (encrypted local mail store, license-check-only egress, per-question provider egress). The bounded-import question she raises is exactly the protocol's unanswered probe.*

**Storage-at-rest probe (addendum):** *"If someone stole this laptop, what could they read?"*
**Diane:** "The mail — no, it says encrypted. My documents — those are regular Word files in a regular folder, that's the whole pitch, so whoever has the laptop has them unless the disk itself is locked. Which on my office machine, I genuinely don't know if it is. If your product knows my disk isn't encrypted, that's a thing I'd want it to nag me about." *(Moderator: the codebase HAS an FDE-status nudge in the mail connect flow — `mailFdeStatus`, G6 — unobservable in this harness; whether it fires correctly on desktop is an open verification item.)*

**Task 3 wrap:**
- **Success criteria:** Partial-by-harness: connect-flow comprehension and the privacy articulation PASS (her mental model is correct and she can repeat it); the actual connection/sync is BLOCKED (desktop-only) — not scoreable here.
- **Time-to-task feel:** Finding the right place was quick (Settings → Integrations was her first guess); the wall came fast too.
- **SEQ:** 4/7 "for the part I could do" — "the words are the best I've seen, the doors were locked."
- **Her verdict line:** "You've written the most honest email-privacy story I've read in legal tech; now let me actually walk through the door, and let me bring just one matter's worth of mail with me."
- **Console errors:** 0.

---
## Task 4 — THE WEDGE: find what the record says, with citations

*Moderator note: the seeded mail wedge (the buried October-deadline email) lives behind the desktop-only mail engine (Task 3), so the make-or-break "find what the client said" moment is run here against the seeded **Halvorsen Estate** matter (`?testMode=true&recordMatter=1`): five real matter files including a deposition with a planted self-contradiction. This tests the same two muscles the mail wedge tests — full-text Search, and a natural-language AI ask that returns the source with a citation she can open — on content that actually loads in this build. Local-only (Ollama) is engaged first, per her Task 1 choice. Screens `persona/t4-01` … `t4-15`.*

**[t4-01]** The matter opens with the file tree expanded: Deposition Notes.md, Deposition contradictions.aichat, Privilege Log.md, Case Timeline.md, Client Intake Summary.md.

**Diane:** "Okay, this is a matter — depo notes, a privilege log, a timeline, an intake summary. This is what a real folder of mine looks like, minus the 200 PDFs. Client's on the phone asking what we have on the second appraisal and when the sale actually closed. Normally this is the 25-minute hunt. Let's see."

**[t4-02 search]** Sidebar → Search → "second appraisal". **8 hits, 4 files**, each labeled with the matter path and a snippet showing the exact quoted language.

**Diane (immediately):** "Oh. *Oh.* Look at that. I typed two words and it handed me the deposition line — 'p. 12… No. I never saw a second appraisal' — the intake summary, the timeline entry, all of it, with the actual sentence shown right in the result so I don't have to open four files to find the one. This is the thing. This is the thing Outlook can't do. In Outlook 'second appraisal' gets me 250 emails and a spinning wheel; here it's four files and the sentence is *right there*. If this worked on my email the way it just worked on these files, that alone is worth the money. That's not a feature, that's my Saturday morning back."

**[t4-03]** She opens the deposition note from a result; it lands on the cited passage.

**Diane:** "Click the result, it opens the document to the spot. Good. That's verifiable — I'm reading my own document, not taking a robot's word for it."

**[t4-04]** Second search, "closing date sale closed" → 1 result, the depo note ("sometime in November, the 20th or so").

**Diane:** "One result, the right one. The closing date he gave under oath. Fine."

**[t4-05/t4-06 confidentiality]** Settings → AI → Confidentiality mode. Three cards: Local-only / Direct (your key) / Assured (needs admin key). She selects **Local-only**.

**Diane (reading):** "'Local-only — Nothing leaves your machine. Only local models can be selected; cloud providers are turned off. Use this for your most sensitive client work.' That's the sentence I needed in plain sight. 'Direct (your key)… The provider sees your prompt, so control retention and training in your provider account' — there it is, finally, the training-opt-out reminder I was missing during setup. And 'Assured… zero-retention proxy… We keep nothing (DPA + provider zero-retention)' for the firm. Three honest tiers, named for what they actually do. I'll click Local-only — estate matter, real client. And it tells me Privileged Matter Mode flips on automatically and stays on. So THAT'S what that bottom-bar thing meant. It should've said this the first time."

**[t4-07/t4-08 egress + local pane]** Status bar updates; AI Assistant shows the green "Local-only mode is on… nothing leaves your machine" note and a "Local model (Ollama)" picker with llama3.2:3b.

**Diane:** "The app visibly changed when I flipped that switch — green note in the AI panel, the bottom bar shows 'Privileged Matter Mode.' I believe a setting more when I can see it took effect."

**[t4-09 … t4-12 the ask]** She starts a local chat, turns on **"Ask my workspace,"** and asks: *"When did the sale close in the Halvorsen Estate matter, and what does the record say about whether Halvorsen saw the second appraisal? Cite the documents you used."*

While it runs, the egress indicator reads: **"On your machine. Nothing leaves — This runs on a local model (Ollama). No prompt or file is sent over the network."**

**Diane (pointing at the egress line):** "THAT. That little green bar, right while I'm asking — 'On your machine. Nothing leaves.' For the first time in two years of AI panic, a piece of software is telling me, at the exact moment it matters, that the question I just typed about a client did not leave the building. If you asked me afterward where my question went, I could point at the screen and say 'there, it says so.' That's the whole ballgame for me."

The answer comes back: *"The sale closed 'sometime in November,' with a specific date mentioned as the 20th (p. 31). … Markus Halvorsen did not see the second appraisal, but this statement seems contradictory when compared to another point (p. 12 vs p. 47)."*

**Diane:** "And the answer's actually *right* — November 20th, page 31, and it caught the p.12-versus-p.47 contradiction on the appraisal. On a free model running on my own computer. Two years I've been told I had to choose between 'good AI in the cloud' and 'safe but useless.' This is neither bad nor in the cloud."

**[the catch]** Above the answer, a yellow line: **"Workspace retrieval failed; this message wasn't workspace-aware."** The answer cites "p. 31" and "p. 12 vs p. 47" as plain text — there is no clickable citation chip, and no sources accordion appears.

**Diane (smile fades):** "Hold on though. There's a yellow warning — 'Workspace retrieval failed; this message wasn't workspace-aware.' So… it answered anyway? Where did 'page 31' come from if the workspace lookup failed — did it read my open document, or did it make a confident guess that happened to be right? And it says 'p. 31' but I can't *click* 'p. 31.' In Search, every hit opened the document. Here the AI gives me page numbers as plain text and a warning that it might not have actually looked. That is precisely the Avianca trap: a fluent, correct-sounding answer with cites I can't open and a quiet note that the grounding failed. I would not put 'p. 31' in a brief because this told me so. I'd go back to Search — which actually worked — and read it myself."

*Moderator note: console logged `Workspace retrieval failed: Error: RAG is only available in the desktop app.` (`src/utils/tauri-commands.ts:86`). In the browser build, the "Ask my workspace" grounding/RAG path is desktop-only; the chat silently degrades to answering from open-file context (which is why it was nonetheless accurate) and shows the yellow warning, but produces NO openable citations. On desktop, RAG + citation chips are the intended experience — UNVERIFIED in this harness. The wedge's make-or-break criterion ("AI answer includes a citation she can open and verify") is therefore MET by Search, NOT MET by the AI ask in this build.*

**[t4-15 the designed experience]** She opens the seeded `Deposition contradictions.aichat` (a Claude-authored chat shipped as the demo).

**Diane:** "Now THIS is what it's supposed to look like — 'page 12 he says… page 47 he says…,' names the exhibit, and ends with 'I am not drawing a legal conclusion… confirm each cite against the certified transcript.' That closing line is exactly the discipline I want. If the live local answer read like this — with cites I could click — I'd be sold. The polished example and the thing I actually got are not the same product yet."

**Egress comprehension probe (addendum):** *"When you asked that, where did your question go and who could read it?"*
**Diane:** "On my machine. The green bar said so while I typed it — local model, nothing over the network. Nobody could read it. That one I'm certain of, and I'm certain because the software told me at the right moment, not in a help article."

**Task 4 wrap:**
- **Success criteria:** Split. **Search = unambiguous Success** with the audible "oh wow / finally" the protocol hunts for (and the explicit Outlook-beat comparison). **AI ask = Partial→Fail on the citation criterion** in this build: correct answer, excellent live egress signal, but no openable citation and a silent grounding-degradation warning a lawyer reads as a trap.
- **Time-to-task feel:** Search: dramatically faster than Outlook (her words: "25 minutes to four files"). AI: fast to answer, but the trust check sent her back to Search.
- **SEQ:** Search 7/7; AI ask 3/7. ("Two different scores because they're two different experiences.")
- **Her verdict line:** "The search alone is worth paying for. The AI that can't hand me a citation I can click is the AI I was already scared of — make it click through like Search does and you've got me."
- **Console errors:** 1 — `RAG is only available in the desktop app.` (the workspace-retrieval failure; surfaced to the user as the yellow degradation warning).

---
## Task 5 — Trust and proof: would you bet a real matter on this?

*Moderator note: `?testMode=true&recordMatter=1` (Halvorsen matter loaded). Screens `persona/t5-01` … `t5-07`. Tests the Audit log, the printable Data Map, cost tracking, the egress indicator across a Local-only↔Direct switch, and the real adoption verdict + firm/e-discovery addenda.*

**[t5-01 AI Audit]** Sidebar → AI Audit. A sky-blue header: **"Your private record of every AI action, kept on your machine for your files and your defense."** Below it, in amber: **"Stored in your browser and not encrypted. Use the desktop app for confidential work."** Empty state: "No AI actions yet — Every AI action in your workspace… gets logged here so you can review or audit what happened." Export JSON / Export CSV buttons present; date/model filters.

**Diane:** "'For your files and your defense' — that framing is exactly right. This isn't the app watching ME, it's me keeping a record I can show a judge or my malpractice carrier. Protective, not surveillance. Export to CSV, filter by date and model — that's a discovery response waiting to happen, in a good way. The amber line is the honest one again: 'stored in your browser and not encrypted, use the desktop app.' On my real desktop install it'd be encrypted; here in the demo it's warning me not to trust it with the real thing. I keep waiting for this product to oversell and it keeps refusing to. It's empty right now because my one chat ran before this, but I can see what it'd hold."

**[t5-02/t5-03 Data Map]** Settings → Privacy → "Open the data map." A dialog: **"Where your data lives and who can see it — Plain-English, and printable so you can show a client,"** with a **Print / Save PDF** button and six expandable sections (files stay on your machine; keys in OS keychain; cloud prompt goes straight to provider — with an honest asterisk about provider abuse-monitoring retention and "set your training opt-out"; local model for nothing-leaves; email encrypted; servers see only a license check).

**Diane:** "This is the document I'd hand a nervous client, or attach to an engagement letter. 'Printable so you can show a client' — somebody understood that my confidentiality duty becomes MY problem to explain, and gave me the page to explain it with. And look at the cloud section: it actually says the provider 'may retain it for a limited window… for abuse monitoring,' and 'set your training opt-out… in their console, not Advisor Prep Hero.' A lesser product would've hidden that. This is the first vendor privacy page I'd actually believe, because it tells me the parts that AREN'T in my favor."

**[t5-04 … t5-06 egress across a mode switch]** She flips Local-only on (status bar shows "Privileged Matter Mode: network extensions disabled"), then switches to Direct (your key). The status-bar Privileged-Matter pill disappears.

**Diane:** "When I'm Local-only, the bottom bar tells me 'Privileged Matter Mode' is on. When I switch to 'Direct, your key,' that pill goes away — which is correct, because now my prompt CAN go to Anthropic. But here's the gap: in Local-only the live green 'nothing leaves' banner sat right by the chat where I was typing. In Direct, the bottom bar just goes quiet — the pill vanishes and nothing replaces it down there to say 'heads up, your next question goes to Anthropic.' The reassuring signal is loud; the cautionary one is just… absence. I'd want the 'this is going to the cloud now' state to be as loud as the safe state. Silence isn't a signal I can rely on."

*Moderator note: the per-chat egress indicator (captured live in Task 4: "On your machine. Nothing leaves") does reflect Direct mode when a chat is open; her point is specifically about the always-on status bar, where Direct mode shows no positive egress statement.*

**[t5-07 cost]** Settings → Cost & Usage: "This month: $0.00 across 0 calls," a 30-day range, by-provider breakdown, "Run a chat to see data here."

**Diane:** "Dollars by provider by month, and it's honest that local runs cost zero — that's the honesty I wanted back at the estimate screen. For a BYOK tool this is the right answer: I can see exactly what I'm spending and to whom, and it's pennies, not a surprise SaaS invoice. Cost is not my worry with this product. Cost is the part it gets right."

**E-discovery / work-product probe (addendum):** *"Every AI chat is saved as a file here. If this matter were in discovery, how do you feel about that?"*
**Diane:** "Double-edged. My work product as durable files I own — good, that's mine, it's privileged, I'd fight to protect it. But every chat being a discoverable artifact means I need to treat these chats like I treat my notes: privileged until proven otherwise, and I need to be able to SEGREGATE them. I saw a 'privileged' toggle on the chat and a Privilege Log template, so the instinct is in there. What I'd demand before trusting it: the ability to mark a chat or a matter privileged and have THAT be real — excluded from any search a paralegal runs, tagged in the audit log — not just a label. And honestly, a 'this chat is attorney work product' stamp on the export."

**Firm / risk-committee probe (addendum):** *"Would you put this in front of your firm or a risk committee, and what would they demand?"*
**Diane:** "For just me, on my own laptop, on the local model? I'd try it on a live matter tomorrow — the search alone earns that. In front of a risk committee, or even my one associate? Different bar. They'd want: a signed DPA or a clear statement that there's no data processor because nothing leaves; SOC 2 or at least a straight answer on why there isn't one for a local-first tool; who Advisor Prep Hero IS as a company; and references — which attorneys I'd respect already run this. I saw 'Assured… DPA + provider zero-retention' for firms, so they've thought about it. But right now the thing that would stop a committee cold is sitting in your own Privacy screen."

**Diane (the name leak, unprompted, reading the Privacy panel):** "Wait. Down here under the usage stats it says 'JSONL stored on **Jameson's** server,' and to unsubscribe I should 'reply UNSUB to any email from **Jameson**, they all forward straight to him.' Who is Jameson? Is that the whole company — one guy named Jameson? Because that's what this reads like. I don't care if it's a solo shop, plenty of great software is, but do NOT tell me that in the privacy disclosure of a tool I'm about to trust with privileged client files. The moment my risk committee sees 'reply to any email from Jameson,' this stops being 'a vendor' and becomes 'some guy.' Put a company name there. That one line could lose you the firm sale even though the actual privacy engineering behind it is the best I've seen."

**Evidence-grade probe (addendum):** *"For a contested matter, are the audit log and version history enough to defend how a document was produced, or do you need something stronger?"*
**Diane:** "For most of my work, an audit log I can export and a version history is more than I have today — it's better than 'I think I drafted that in March.' For a genuinely contested 'did you fabricate this' fight, I'd want it harder: timestamps I can't fudge, maybe a hash, something a forensic person would bless. But that's an edge case. The audit-plus-versions is enough for 95% of what I do, as long as I'm sure it's complete."

**Task 5 wrap:**
- **Success criteria:** Success — she located Audit, Data Map, and Cost, interpreted all three correctly (audit = protective not surveillance; data map = client-facing proof; cost = honest/low), and gave a clear, reasoned verdict with specific conditions.
- **Time-to-task feel:** Fast; the trust surfaces were where she expected (sidebar for audit, Settings → Privacy for the map).
- **SEQ:** 6/7. ("Docked one for the disappearing cloud-egress signal and for making me find 'Jameson' on my own.")
- **Her verdict line:** "Solo, on my laptop, local model — I'd put a real matter on this tomorrow because the search and the egress bar earn it. For my firm, fix three things: make 'privileged' actually segregate, put a company name where 'Jameson' is, and give me a citation I can click — then bring me the names of three lawyers who already trust it."
- **Console errors:** 0.

---
## Task 6 — Firm scenario (two contexts: Diane = admin, her associate = member)

*Moderator note: this is the one task that genuinely exercises the firm backend. Two isolated browser contexts at 1536×864 share the dev server's `/api/firm` proxy → seeded backend at `127.0.0.1:5290`. Context A = Diane (admin `admin@keepance-e2e.test`); Context B = her associate (member `member@keepance-e2e.test`); 5-seat license key from `/tmp/firm-e2e-license.txt`. Screens `persona/t6-01` … `t6-15` (captured under the `persona-firm` journey, copied into `persona/`). The full convergence ran green end-to-end: admin sign-in + seat, share matter, invite by email, type a note; member sign-in + seat, open the shared matter (with the admin key-republish step), see the note, reply; admin sees the reply. Console: admin 0 errors; member 1 (an expected 404 — the documented "key not yet published to this device" on first open, resolved by the admin's re-publish + retry).*

**[t6-01/t6-02 admin sign-in + seat]** Diane goes Settings → Firm, signs in, and activates a seat with the license key.

**Diane:** "So the firm side is a login plus a license key — that's two different credentials, and I want to be sure I understand: the key is what I bought, the login is who I am. It activated a 'seat.' Fine, I know seats from Clio. This part felt like enterprise software in the good sense — it knew what a seat was and didn't make me think."

**[t6-03 … t6-05 share a matter]** She opens the matter manager (via the AI chat's matter-scope control), creates "Okafor v. Lakeshore / Teresa Okafor," and clicks Share. A "Shared" badge appears.

**Diane:** "Creating the matter is straightforward — name and client. But notice how I GOT here: I had to open an AI chat, click a little 'scope' control in the chat header, and pick 'Manage matters.' Matters are the spine of my whole practice — they should be a thing in the sidebar, not buried inside the AI chat. I'd never have found this without being shown. Once I'm here, sharing is one button and a clear 'Shared' badge, so the actual sharing is fine. It's the front door that's hidden." *(this is the F-009 problem, confirmed — see Extended Checks)*

**[t6-06/t6-07 shared notes]** She opens the matter's notes: a panel headed **"Shared notes • Live — Everyone on this matter sees these notes. They sync live,"** and types a task for her associate.

**Diane:** "'Everyone on this matter sees these notes, they sync live.' Good, that's a shared legal pad. I'll leave my associate a note: pull the April compliance emails, verify the 90-day whistleblower window. This is genuinely useful — it's the thing I currently do over email or a sticky note on her door."

**[t6-08 invite by email]** Settings → Firm → the admin console. She selects the matter and invites `member@…` by email. Result: **"Invitation sent."**

**Diane:** "The admin console is actually thorough — invite by email, 're-publish keys to all member devices,' 'raise ethical wall,' a members list, a seats list. An **ethical wall** as a button — that's a conflicts screen, that's the thing every firm my size fumbles with a memo and a prayer. Whoever built this has done a conflicts check. Two gripes, though, and they're the kind a managing partner notices: my matter shows up as 'Teresa Okafor mq834p1f — epoch 1.' What is 'mq834p1f'? What is 'epoch 1'? And I have TWO matters both just called 'Teresa Okafor' in this list — I can't tell them apart. Under Seats it says 'Unnamed device 372a6dad' twice. If I'm the partner managing who can see what, 'Unnamed device' and 'epoch 1' are exactly the words that make me nervous, because I can't audit what I can't read."

**[t6-09 … t6-12 member joins]** Context B: the associate signs in, activates her own seat, opens the matter manager, and clicks to open the shared matter. First attempt errors (key not yet on her device); Diane (admin) clicks "Re-publish keys to all member devices"; the associate retries and the matter links.

**Diane (as moderator relays the two-step):** "From my associate's chair: she signed in, took a seat, went to open the matter — and it didn't work the first time. Then I had to go click 're-publish keys' on my end, and then she could open it. Now — I understand WHY: the encryption means her device needs a key only I can hand out, and frankly I LIKE that the secrecy is real enough to need that handshake. But nobody told either of us that's what was happening. She'd have called me saying 'it's broken,' I'd have said 'I don't know, it works on mine,' and we'd have both decided the firm feature is flaky. The security model is excellent; the choreography around it is invisible at exactly the moment two non-technical people need it explained."

**[t6-13 member sees admin's note]** The associate opens the notes; Diane's sentence is there, synced.

**Diane:** "And there's my note, on her screen, live. Once the key thing sorted itself, the actual collaboration is seamless — pun noted. That's a real shared workspace for a privileged matter, encrypted, on our own machines. I don't know another tool that does THAT for a two-lawyer shop."

**[t6-14/t6-15 reply converges back]** The associate types her reply (90-day clock from the May 27 termination, window closes Aug 25, two flagged compliance emails); it appears on Diane's screen.

**Diane:** "Her answer comes back to me without either of us emailing anything or putting a client's name in a Google Doc. That's the part that matters. If the onboarding for this — the seat, the key handshake — were as well-explained as the privacy story was, I'd put my associate on this next week."

**E-discovery instinct (addendum):** *"These shared notes and chats are saved artifacts. If this matter were in discovery, how do you feel?"*
**Diane:** "Same as before but more so, because now two of us are writing in it. I need to know: are these shared notes work product, and can I segregate them if a matter goes sideways? And the 'ethical wall' had better do what it says — if I wall my associate off a matter because her cousin is on the other side, I need her key actually revoked, not just a hidden menu item. I saw the wall raises an 'epoch' — if that means her old key stops working, good, that's real. But I'd want my IT-person-of-one, which is me, to be able to PROVE that to a court."

**Risk-committee probe (addendum):** *"Would you show this to your risk committee?"*
**Diane:** "The collaboration demo? Yes, and they'd lean in at 'ethical wall enforced by encryption, the server only ever holds scrambled text.' That's a better answer than my current 'we're careful.' But they'd stop me on three things, and they're the same three: who is the company (the 'Jameson' thing from the privacy screen), what happens to a matter if a seat or the vendor goes away, and show-me-the-audit-trail for the wall. The engineering would impress them. The company-maturity signals would worry them."

**Task 6 wrap:**
- **Success criteria:** Success — every protocol step completed: admin seat + share + invite + type; member seat + open + see + reply; admin sees reply (verified by content convergence both directions). Ethical-wall + key-republish capabilities present.
- **Time-to-task feel:** The convergence itself was quick once keys were published; the hidden matter front-door and the silent key-handshake added avoidable friction.
- **SEQ:** 5/7. ("Minus two for finding matters inside the AI chat and for the key handshake nobody narrated.")
- **Her verdict line:** "This is real encrypted collaboration for a small firm, which I genuinely didn't think existed — but it's gated behind a hidden matters menu and an unexplained key handshake that will generate support calls from people exactly like me."
- **Console errors:** admin 0; member 1 (expected first-open 404 before key re-publish — benign, documented behavior; should be surfaced to the user as "waiting for access," not a silent failure).

---
## Task 7 — Extended spot checks (one paragraph each)

*Moderator note: seven targeted probes, each isolated. Screens `persona/t7a` … `t7g` (captured under `persona-checks`, copied into `persona/`). Fixtures from `tests/fixtures/matter-corpus/`. All seven ran with 0 console errors except where noted.*

**7A — Privilege tagging + retrieval exclusion.** The chat header carries an **"Include privileged"** toggle alongside "Ask my workspace" (seen live in Task 4, `persona/t4-08`), and selecting a privileged matter / Local-only drives the "Privileged Matter Mode" status pill. So the *affordance* to tag and to opt privileged content in/out of a query exists and is where she'd look. **Diane:** "Good — there's an 'Include privileged' switch right where I ask, so by default my privileged material isn't being swept into every query. That's the right default." The hard part — proving the *exclusion is enforced at retrieval* (a paralegal's search genuinely cannot surface a walled/privileged chat) — runs through the same RAG layer that is desktop-only in this build, so it could not be verified here. **BLOCKED (desktop-only):** retrieval-exclusion enforcement. Her stated condition from Task 5 stands: the label must be a real boundary, not décor.

**7B — Redline round-trip on the fixture engagement letter.** Loading `engagement-letter-tracked.docx` (4 tracked changes + 2 comments) opens it cleanly as a real document — letterhead, "ENGAGEMENT LETTER," the Johnson v. Nexus retention terms, proper fonts — but under an amber banner: **"Editing Word documents with tracked changes is only available in the Advisor Prep Hero desktop app. Showing a read-only preview here."** Zero tracked-change marks rendered and no review pane in the browser build. **Diane:** "It looks like a real Word document, finally — letterhead and all. But it's telling me I can only READ it here, not work the tracked changes. Accepting and rejecting redlines IS my job on an engagement letter. On my desktop I'd want to see Jim's two deletions and my two insertions, accept and reject them one by one, and know the result is clean. I can't judge that from a read-only preview." **BLOCKED (desktop-only):** the accept/reject tracked-changes round-trip. (The engine itself is validated by the repo's Rust `campaign_fixtures.rs`; the in-app UX round-trip needs a desktop pass.)

**7C — Deposition Contradiction Finder vs the fixture transcript.** I pasted the real Johnson deposition excerpts (with all 3 planted contradictions) and the incident summary directly into the workflow's own textareas, ran it, and it **Failed** with "RAG is only available in the desktop app." The analyze step ("Retrieve the matter record, flag candidate contradictions…") hard-depends on the desktop-only retrieval layer, so it errors out rather than working from the pasted excerpts — **the 3 contradictions did NOT surface, and no citations were produced, in this build.** **Diane:** "This is the one I actually wanted — the two-evening legal-pad job. I handed it the transcript and my summary on a silver platter, and it just… failed. It didn't even try to use what I pasted. If the headline litigation feature only works on the desktop and silently dies in the trial I'm evaluating, I'd never know it was the crown jewel." **BLOCKED (desktop-only)** + a real defect: the workflow should degrade to using the pasted excerpts or refuse up front, not fail after I've done the work. See F-126.

**7D — Version history.** Editing `test1.md` produced a clean, timestamped **History (50)** panel: "Latest," numbered versions, byte-size deltas (e.g. "124 B  -1 B"), per-version restore arrows, and a total-size footer. **Diane:** "Now THIS I trust. Every save is a version, time-stamped, and I can roll back any one of them. For a 'who changed this and when' question — which is half my malpractice anxiety — this is better than anything I have today. And it ties straight into what I told you about defending how a document was produced." Clear pass; pairs with her Task 5 evidence-grade verdict (enough for ~95% of her work).

**7E — Trash / restore.** The Trash tab opens to its own panel; with no deletions staged in the seeded matter it showed the empty state, so the restore round-trip wasn't exercised. **Diane:** "There's a Trash, which means a deleted file isn't gone-gone — that's the safety net I want. I didn't delete anything to test it, but knowing soft-delete exists lowers my blood pressure." **Partial (empty-state only):** the soft-delete/restore cycle should be exercised in a desktop pass with real files.

**7F — Trial banner / upgrade touchpoint.** The status-bar chip reads **"Free trial · 30 days left · Upgrade"** and clicking it opens License → the pricing tiers: **Solo $468/yr ($39/mo), Professional $948/yr "MOST POPULAR," Firm $1,548/seat/yr (min 3 seats)**, each with plain feature lists ("Word-native editor," "confidential matter-scoped cited recall," "privilege controls," "local model or your own AI key"). **Diane:** "Honest pricing — annual or month-to-month, no 'contact sales' nonsense, and it tells me the Professional tier is where the litigation tools live, which is exactly where a litigator like me lands. $948 a year for the contradiction-finder and discovery triage is a couple of billable hours; if it works, that's nothing. Note the word 'if' — I'm only buying the tier whose marquee feature (7C) I couldn't get to run." No dark patterns; the upgrade path is clear and the value framing is in her language.

**7G — F-009 probe: can she find matter management unaided?** Cold workspace, no coaching. The sidebar tabs are exactly: **Files, Search, Workflows, AI Assistant, Research, Whiteboard, AI Audit, Trash** — there is **no "Matters" tab.** The only "matter" affordance on the cold screen is the "All matters" label in the status bar. To create/share/open a matter she must open an AI chat and use the matter-scope control in the chat header (confirmed in Task 6). **Diane:** "If you sat me here cold and said 'set up your matter,' I'd click Files, then Search, then maybe Workflows, then I'd give up and call somebody. 'Matters' isn't on this list. For a product whose whole pitch is organizing my practice BY matter, the word 'matter' being absent from the main menu is backwards. The one at the bottom says 'All matters' but it's not where I'd click to MAKE one." **Confirmed F-009:** matter management is not discoverable unaided (see F-122).

**Task 7 wrap:**
- **Success criteria:** Version history = Success; trial/upgrade = Success; privilege affordance = present (enforcement BLOCKED desktop-only); redline round-trip = BLOCKED desktop-only; contradiction finder = FAIL in browser (desktop-only RAG, hard error); trash = Partial (empty state); F-009 = confirmed not-discoverable.
- **Cross-cutting read:** three of her highest-value litigation features (tracked-change redlining, the contradiction finder, workspace-grounded citations) are all gated behind the desktop-only RAG/OOXML-edit layer and degrade poorly (read-only preview, or a hard "Failed") in the browser build a prospect would trial. The non-AI trust scaffolding (versions, trash, audit, pricing) is solid and honest.
- **Console errors:** 0 across all seven checks (the 7C failure is a surfaced workflow error, not a console error).

---
