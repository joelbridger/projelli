# Advisor Prep Hero UI Reimagining — UX Brief
## Stream A: Research Consolidation

**Date:** 2026-06-13
**Author:** UX Research, Stream A
**Status:** Foundational — every design decision in the reimagining is measured against this brief
**Instrument:** Diane Marchetti, solo/small-firm civil litigator, $375/hr, "competent end user" (Outlook/Word/Acrobat/Clio fluent, never opened a terminal)

---

## Preface

This brief converts the entire attorney research corpus into concrete UI requirements. The corpus comprises four independent lenses:

- **S1** `docs/research/2026-06-08-ux-attorney-v2.5.1/transcripts/interview-transcript.md` — 60-minute synthetic generative interview
- **S2** `docs/research/2026-06-08-ux-attorney-v2.5.1/transcripts/usability-test-transcript.md` — hands-on think-aloud usability test
- **S3** `docs/research/2026-06-08-ux-attorney-v2.5.1/deep-research-reports/Attorney UX Review of Advisor Prep Hero.md` — senior commercial-litigation / e-discovery / regulatory lens
- **S4** `docs/research/2026-06-08-ux-attorney-v2.5.1/deep-research-reports/ChatGPT deep research attorney UX report Advisor Prep Hero.md` — vendor-diligence and public-record lens
- **QC** `docs/quality/2026-06-10-v3-usability-campaign/persona-findings.md` + `findings.md` + `native-findings.md` + `VISION-COVERAGE-AUDIT.md` — v3.0 quality campaign (28 findings, F-101 through F-128)

The convergence rule applied throughout this brief: when a finding is supported by two or more independent lenses, it is treated as high-confidence and is marked accordingly.

---

## 1. Jobs as UI Requirements

Jobs are ranked by verified pain intensity from the corpus. Each "The UI must make _____ effortless" statement is followed by 2-4 concrete acceptance criteria.

---

### Job 1 (Pain rank: 1 of 5): Find-Anything Privately — the Wedge

**Verified pain intensity: DAILY, "background radiation," estimated 150+ hours per year lost.**
Source: S1 §Section 3 — *"I'd say I lose three, four hours a week to looking for things that I know exist. That's... a hundred and fifty hours of my life spent looking for things I already had."*

**The UI must make finding any email, document, or decision across the full matter history effortless and private.**

Acceptance criteria:

1. A plain-English question typed into a single search input ("What did my client say about the settlement number back in the spring?") returns the exact email, quoted passage, and its matter context in one click — not a list of 250 results to sift. Source: S1 §Section 1 — *"I live in my email and I can't find anything in it. That's not a small problem. That's my Tuesday."* QC `persona-findings.md` Task 4 positives — *"Full-text Search is the wedge that lands — 8 hits/4 files for 'second appraisal', each with matter path + the exact quoted sentence inline, click-through to the passage."*

2. Search spans the full archive, including imported email stores, without any visible "showing most recent results" truncation or silent cap. Source: S1 §Section 3 — *"it shows you a bunch and then... it has quietly decided you don't need to see everything. And in my world everything is exactly what I need to see."*

3. Every AI answer over client data carries a one-click citation that opens the exact source passage. An answer without a verifiable citation must not appear. Source: QC `persona-findings.md` F-117 — *"In Search, every hit opened the document. Here the AI gives me page numbers as plain text. I would not put 'p. 31' in a brief because this told me so."* `analysis-and-report.md` §5 F5 — *"Citations win lawyers (hard constraint). Protect it absolutely; never ship an uncited answer over client data."*

4. The current matter scope is always visible at the search prompt, and the user can narrow or expand scope without leaving the search surface. Source: QC `persona-findings.md` F-122 — matters hidden inside the AI chat is a P1 finding; the matter must be a first-class navigation concept, not buried.

---

### Job 2 (Pain rank: 2 of 5): The Litigation Associate — Contradiction-Finder and Issue-Spotter

**Verified pain intensity: "My weekends" — multiple evenings and full weekends per case, on the most important, highest-skill work she does.**
Source: S1 §Section 3 — *"Email is my Tuesday. The documents are my weekends. Give me my weekends."*

**The UI must make surfacing every contradiction across transcripts, statements, and emails effortless — and must frame every finding as a proposal, not a verdict.**

Acceptance criteria:

1. The deposition or document analysis surfaces findings as a numbered list of contradiction candidates, each one citing the exact page and passage from both sides of the contradiction, in a Word document the attorney can open, annotate, and take to court. The UI label for this workflow is "find where the witness contradicts himself" — not "run the Deposition Contradiction Finder." Source: S1 §Section 7 — *"the machine that reads my eighteen hundred pages and my two-hundred-forty-page transcript and says 'Diane, here are the eleven places the witness contradicts himself, go verify these.'"* `vision-most-viable-keepance.md` §4 Job 2 — *"framing the research demands: this is a tireless first-year associate that flags things for you to verify, not an oracle that you trust blindly."*

2. Every finding carries a "verify" affordance that is one click to the exact source location. A finding without a verifiable citation must be flagged as unverified with a visible warning — not silently presented as established fact. Source: `analysis-and-report.md` §Executive Summary point 4 — *"She refused to trust the AI's answer until she clicked through and verified the source email. A cited answer won her; an uncited one would have destroyed trust in every answer."* QC `persona-findings.md` F-116 — *"That is precisely the Avianca trap."*

3. The workflow starts from documents the attorney already has on this matter — production PDFs, deposition transcripts, prior statements — without requiring a separate upload step or any configuration beyond selecting the matter. Source: S1 §Section 7 — *"I need to know that [the document analysis] finds the contradictions across the corpus, the way email search finds the email."* QC `native-findings.md` F-422 (workflow start confirmed on native build); F-415 (full run gated on populated index — a gap to close before launch).

4. A "propose, do not decide" label appears persistently on every workflow output — not in a help article. The lawyer's role (verify, decide, sign off) is made explicit in the surface where findings appear, not in onboarding. Source: `analysis-and-report.md` §5 F5; `vision-most-viable-keepance.md` §6 Non-negotiable 1 — *"Every AI answer over the lawyer's data carries a one-click, verifiable citation. No exceptions."* S1 §Section 4 — *"I'd treat it like a very fast, very tireless first-year associate... I don't need the machine to be perfect. I need it to be a good first pass."*

---

### Job 3 (Pain rank: 3 of 5): Real Word Deliverables on Letterhead

**Verified pain intensity: Systemic — every document that leaves the firm must pass this gate, or it is not a document.**
Source: S1 §Section 2 — *"If it isn't in Word with my letterhead, it isn't a real document."*

**The UI must make producing a final, on-letterhead Word or PDF deliverable the natural end of every AI-assisted workflow.**

Acceptance criteria:

1. Every legal workflow output lands as a `.docx` file in the matter's folder — not an ALL-CAPS markdown filename with slashes and underscores. The attorney opens it and it is a Word document with correct formatting (tables, numbered lists, heading styles). Source: QC `persona-findings.md` F-112 — *"'Real Word documents in a normal folder, you said. CLIENT_INTAKE_PACKAGE-dot-md is neither.'"* (Fixed in v3.2.0 per `CURRENT-STATE.md` §3, but this acceptance criterion guards against regression.)

2. The "Export as Word" and "Export as PDF" actions are primary, visible controls on every AI output — not hidden behind an icon or buried in a menu. Source: `analysis-and-report.md` §5 F4 — *"Word export is buried, and fidelity is a real worry (severity 3). The export exists and the .docx cleared her 'real document' bar (a genuine strength), but it hides behind an unlabeled icon."*

3. Tracked changes generated by the AI appear as real Word tracked changes — attributed to the AI, visually distinct, accept/reject from the Reviewing pane — not as a separate diff view. Source: QC `native-findings.md` F-406 (verified pass — 4 tracked changes rendered, accept/reject preserved on save); F-417 (AI redline round-trip confirmed).

4. Markdown is never visible to the attorney in any user-facing deliverable or workflow output. Plain-text or internal notes surfaces are acceptable for AI-internal context only. Source: `vision-most-viable-keepance.md` §2 — *"The lawyer should never see Markdown again... For this audience that is a liability, not a selling point."* `analysis-and-report.md` §5 F3 — *"Raw Markdown is the wrong default for this user (severity 3). It reads as code."*

---

### Job 4 (Pain rank: 4 of 5): The Trust Story — Confidentiality Architecture as a UI Surface

**Verified pain intensity: Existential gating — Diane will not adopt anything for real client work unless she can explain where the data goes in one sentence.**
Source: S1 §Section 4 — *"If I put client information into this thing, have I disclosed it? To whom? Could it come out?... So 'confidentiality' with AI, to me, is the single gate. Everything else is features. That's the gate."*

**The UI must make the confidentiality architecture visible, comprehensible, and verifiable at all times — especially at the moment a prompt is sent.**

See also Section 6 (Trust/Confidentiality UI Requirements) for the full treatment.

Acceptance criteria:

1. At the exact moment the attorney sends a prompt, a persistent, clearly visible indicator shows exactly where that prompt is going — "On your machine. Nothing leaves." (local model) or "Going to Anthropic, directly from your device — not through Advisor Prep Hero" (BYOK direct). Source: `analysis-and-report.md` §4.3 — *"S4's concrete fix is the best idea in either report: a highly visible egress indicator at the point of sending each prompt."* QC `persona-findings.md` Task 4 positives — *"Live egress indicator during send... Egress-comprehension probe PASSED with certainty; she could point at the screen."*

2. A printable, one-page Data Map — "where your data goes, in plain English" — is reachable from a persistent, labeled entry in the UI (not only from the onboarding wizard). The attorney can show it to a worried client without translating it. Source: QC `persona-findings.md` Task 5 positives — *"Data Map is a genuine firm-sale asset — 'printable so you can show a client.'"* S1 §Section 4 — *"I need to understand, in language I can actually follow, where my client's information goes and who can touch it."*

3. The confidentiality mode (Local-only, Direct BYOK, Assured) is surfaced as a per-matter setting with a plain-English label for each state, not as a settings panel the attorney visits once. Source: QC `persona-findings.md` F-104 — *"'Privileged Matter Mode: network extensions disabled' is network-engineer jargon."* F-118 — *"plain-English explanation lives only on the confidentiality settings card — not where the pill shows."*

4. Every AI action is added to an audit trail labeled "your defense file" — not "audit log." The framing is "I can prove what happened and to whom" — not "this system is monitoring you." Source: QC `persona-findings.md` Task 5 positives — *"Audit log framing is exactly right... 'kept on your machine for your files and your defense' reads as protective, not surveillance."* `analysis-and-report.md` §5 F6 — *"'my defense file.' One protective line at the top prevents the negative first read."*

---

### Job 5 (Pain rank: 5 of 5): The Firm Tier — Safe Team Collaboration

**Verified pain intensity: Systemic for firm sale — she is not a solo island, and a tool that only works for one person fractures her team.**
Source: S1 §Section 7 — *"You should have asked me about Priya and Carol... if I've got some magic search that only lives on my machine and only I can use, that's, that helps me but it might fracture the team."*

**The UI must make sharing a matter securely within the firm as natural as sharing a folder in OneDrive — without requiring the attorney to understand cryptography.**

Acceptance criteria:

1. Matters are a top-level navigation concept with a dedicated sidebar entry. Creating, opening, and sharing a matter never requires navigating inside an AI chat. Source: QC `persona-findings.md` F-122 — *"Matters should be a thing in the sidebar, not buried inside the AI chat. I'd never have found this without being shown."* `findings.md` F-009 — *"Matter management... ONLY reachable from the matter scope selector inside an open AI chat header."*

2. When a team member's device is added to a matter, the UI guides both the admin and the member through the key-grant step with visible status on both sides — not a silent process that looks like a 404 error to the member. Source: QC `persona-findings.md` F-123 — *"She'd have called me saying 'it's broken'... The security model is excellent; the choreography is invisible at exactly the moment two non-technical people need it explained."*

3. The ethical-wall action is labeled "conflict wall" or "ethical wall" (a term she knows from conflicts checks), not a cryptographic control. The admin view shows matter names, not raw IDs or "epoch N" jargon. Source: QC `persona-findings.md` F-124 — *"'Unnamed device' and 'epoch 1' are exactly the words that make me nervous, because I can't audit what I can't read."*

4. All company-facing copy uses "Advisor Prep Hero" as the vendor identity — never a founder's first name. Source: QC `persona-findings.md` F-119 — *"'the moment my risk committee sees 'reply to any email from Jameson,' this stops being 'a vendor' and becomes 'some guy.'"*

---

## 2. End-to-End Journey Maps

### Journey A: "Find the email where the client agreed to X back in the spring" (the Wedge)

**Scenario (from S1):** Mr. Castellano emails asking what they agreed about a settlement number "back in the spring." Diane knows the answer is in an email from March. The current-state journey costs her 25 minutes.

---

**Step 1: Client asks a question.**

| | Current state | Target state |
|---|---|---|
| What she does | Opens Outlook. Reads the client's email. Feels the knot in her stomach. | Opens Advisor Prep Hero. Reads the notification in the matter feed. |
| What she feels | "I know I have this. I just have to find it." | "I'll have this in 30 seconds." |
| Confidence today | Low — knows Outlook will lie about what it finds | High — she has used this before and it found things Outlook could not |
| UI in target state | Matter feed surfaces recent client activity, with the client's question linked | — |

**Step 2: She initiates the search.**

| | Current state | Target state |
|---|---|---|
| What she does | Types "settlement" or "Castellano" into Outlook search. Waits. Gets 250 results with no obvious ranking. | Types "What did Castellano say about the settlement floor?" into the search bar inside the Castellano matter. |
| What she feels | Frustration beginning. Begins scanning results. | Neutral — this is the thing she came here for. |
| Confidence today | Low — "showing most recent results" notice appears; archive not searched | High — "all of it" is the promise, including the archived PST equivalent |
| UI in target state | Single plain-English query field, matter scope shown ("Castellano matter"), no syntax required |

**Step 3: She evaluates results.**

| | Current state | Target state |
|---|---|---|
| What she does | Scans 250 subject lines. Tries to guess which one is right. Opens and reads several wrong threads. | Sees 1-3 results, each showing the exact quoted passage from the email, the date, and the sender, inline. |
| What she feels | "None of these are obviously right." Switches to keyword guessing — tries "walk-away number." | "That's the one." Reads the quoted passage in the result card. |
| Confidence today | Zero until she opens and reads the right one | High — the quoted passage IS the answer; she sees it before clicking |
| UI in target state | Each result card shows: matter path, sender, date, and the exact sentence matching the query — all inline, no click required to confirm it is the right result |

**Step 4: She verifies and uses the result.**

| | Current state | Target state |
|---|---|---|
| What she does | Clicks into the right thread. Reads it. Copies the relevant sentence. Replies to the client. Bills 0.2 and eats 20 more minutes. | Clicks the citation chip. Source email opens to the exact passage highlighted. Copies the sentence. Replies to the client. |
| What she feels | Mild relief mixed with resentment at the time spent | Satisfied. One click confirmed what the AI said. No second-guessing. |
| Confidence today | Retroactive — only confident AFTER she manually re-read the email | Prospective — confident BEFORE she clicked, because the cited passage was already visible |
| UI in target state | Citation chip on the AI answer opens the source email at the exact quoted line. "Verified" label appears after she clicks it. Total elapsed time: under 60 seconds. |

**What the research says this unlocks:** *"If I could search all of my email, including the archives, the welded-shut drawers, and actually find the Castellano walk-away number in five seconds instead of twenty-five minutes, I, that alone, that's the whole pitch for me."* — S1 §Section 6.

---

### Journey B: "Prep tomorrow's deposition — hunt contradictions across 1,800 pages" (the Litigation Associate)

**Scenario (from S1):** Deposition prep for the Brennan employment case. 1,800 pages of production plus a 240-page supervisor deposition transcript. Need every place the supervisor's testimony contradicts his earlier written statements and company emails. Current state: legal pad, sticky tabs, Ctrl+F. Duration: two evenings.

---

**Step 1: She opens the matter and the documents.**

| | Current state | Target state |
|---|---|---|
| What she does | Opens the production folder in Windows Explorer. Opens the deposition transcript in Acrobat. Opens a blank legal pad. | Opens the Brennan matter in Advisor Prep Hero. All indexed documents are listed with their date and source. |
| What she feels | "This is the job. This is going to take a while." | "Where do I start?" — the matter index gives her a snapshot of what has been indexed and when. |
| Confidence today | Zero — has no idea which of the 1,800 pages has the contradiction she needs | Moderate — she knows the corpus is indexed and the AI can surface candidates |
| UI in target state | Matter view shows all indexed documents with source, date, page count, and indexing status. A "Find contradictions" action is visible at the matter level — not buried in a workflow gallery. |

**Step 2: She runs the contradiction analysis.**

| | Current state | Target state |
|---|---|---|
| What she does | Opens Acrobat, runs Ctrl+F for "terminate," "fire," "manage out." Reads every hit. Takes manual notes. Repeats for dozens of terms she guesses might be relevant. | Opens the "Find where the witness contradicts himself" workflow from the matter view. Selects the deposition transcript and the production folder as the inputs. Runs. |
| What she feels | Grinding drudgery — *"this is the work I became a lawyer to do, and it is being strangled by document volume"* | Delegation — "I'm assigning this to the first-year. I'll check the results." |
| Confidence today | None that she found everything — "I find what I guessed to look for" | Moderate to high that the AI flagged the candidates — she still verifies, but she trusts the pass was exhaustive |
| UI in target state | Inputs: select the deposition transcript + select the prior statements / company emails (auto-suggested from matter). One "Find contradictions" button. Estimated run time shown. Zero configuration. |

**Step 3: She reviews the findings.**

| | Current state | Target state |
|---|---|---|
| What she does | Reviews her legal pad notes. Tries to cross-reference page references she wrote down. Finds she missed a contradiction she only notices when reading a second time. | Opens the output: a numbered list of contradiction candidates, each with the deposition citation and the prior-statement citation side by side. |
| What she feels | Uncertain — *"I'm not slow because I'm not smart. I'm slow because there are two thousand pages and one of me."* | Focused — she is doing the lawyer part (evaluating whether the contradiction is real and how to use it), not the search-engine part. |
| Confidence today | Depends on how many evenings she spent | High that she has a complete first pass to evaluate — the AI is the tireless first-year; she is the partner |
| UI in target state | Output is a `.docx` in the matter folder titled "Contradiction Analysis — Brennan v. Employer — [date].docx." Each finding reads: "Deposition p. 84: '[exact quote]' — Prior Statement, email of [date]: '[exact quote]' — Candidate contradiction: [plain-English summary]." Each citation is clickable. A "Verify" button opens both source passages side by side. |

**Step 4: She verifies and uses the contradictions.**

| | Current state | Target state |
|---|---|---|
| What she does | For each note on her legal pad, finds the page in Acrobat, re-reads the passage, decides if it is usable. Hours of re-reading. | For each numbered finding, clicks "Verify" — both passages open side by side. She reads, decides, annotates. Some she marks "Use." Some she rejects. All in one surface. |
| What she feels | Relief when she is done, mixed with anxiety about whether she missed something | Confident she has a defensible, complete picture — the AI did the exhaustive pass; she did the judgment pass. |
| Confidence today | *"I'm not slow because I'm not smart. I'm slow because there are two thousand pages and one of me."* | *"I'd weep with gratitude."* — S1 §Section 3. |
| UI in target state | Side-by-side source comparison with inline annotation. Each finding has a status she sets ("use," "reject," "review again"). The annotated output is saved back to the matter as a Word document she can take to court. |

**What the research says this unlocks:** *"If something could have read those documents and said 'Diane, here are the eleven places where what this guy testified contradicts what he wrote, go look at these,' and been right, even mostly right, even right enough that I'd verify it and find it held up, I would have wept with gratitude."* — S1 §Section 3.

---

## 3. Vocabulary Do/Don't Table

The legal mind is precise about language. A word the attorney does not recognize is friction. A word that signals "this was written for a developer" ends the session.

### Terms the UI must use

| Term | Why it matters | Source |
|---|---|---|
| **Matter** | The organizing unit of legal practice. Not "project," not "workspace," not "folder." Every file, email, and conversation belongs to a matter. | S1 §Section 2 — *"Clio's the backbone. Matters, contacts, calendar..."* QC F-122 — absence of a sidebar "Matters" entry is a P1 finding. |
| **Client** | The person whose confidentiality is at stake. Never "user," "account," or "stakeholder." | S1 §Persona card — *"150-200 emails/day across ~40 active matters."* The research grounds every confidentiality fear in "my client." |
| **Privilege / Work product** | The legal distinction that makes some files discoverable and others protected. The UI must use both terms correctly. | S3 Theme 3 — *"If a prompt reveals the attorney's strategic mental impressions... that prompt is theoretically protected under the attorney work-product doctrine."* QC F-121 — privilege must be enforceable, not cosmetic. |
| **Discovery** | The litigation process of exchanging documents with opposing counsel. The attorney's anxiety about "discoverable records" is real and specific. | `analysis-and-report.md` §6.2 — *"Because every conversation becomes a permanent local file, a lawyer accumulates thousands of discoverable records."* |
| **Deposition** | The sworn testimony session. The contradiction-finder workflow must use this word, not "transcript analysis" or "interview review." | S1 §Section 1 — *"Mid-morning is deposition prep..."* S1 §Section 7 — *"The document contradiction-finder... because the email search solves my mornings, but the contradiction-finder solves my weekends."* |
| **Redline / Tracked changes** | How attorneys mark up documents. "Redline" is the verb and noun for the process. "Tracked changes" is the Word mechanism. Both are native. | S1 §Section 2 — *"I redline it in Word, track changes, I send it back."* `vision-most-viable-keepance.md` §3 — *"faithfull, bidirectional round-trip with track changes, comments, styles."* |
| **Engagement letter** | The contract between the attorney and the client that defines the representation. A specific, formal document type the attorney sends. | S1 §Section 2 — *"Briefs, motions, demand letters, engagement letters, client memos."* QC `native-findings.md` F-406 (fixture: `engagement-letter-tracked.docx`). |
| **Firm / Solo** | The two organizational contexts. "Firm" means colleagues sharing matters. "Solo" means one attorney, one machine. | S1 §Section 1 — *"Three of us... the managing partner, the IT department, and the person who empties the dishwasher."* |
| **Litigation** | The practice area that drives the highest pain. The product's ICP. | S1 §Persona card — *"~60% plaintiff-side civil litigation."* `vision-most-viable-keepance.md` §3 — *"Land with the solo. Grow into the firm. Win law before anything else."* |

### Terms to purge from user-facing copy

| Term | Why it fails | What to use instead | Source |
|---|---|---|---|
| **Workspace** | Read as "something cloudy that belongs to the software company" until she discovered it meant a folder. Drops the product into competition with Notion. | "Your matter folder," "your work," or — when necessary — "folder" | S1 §Section 6 — *"'workspace' briefly read as 'something cloudy that belongs to the software company.'"* `analysis-and-report.md` §4.2. |
| **Markdown** | Reads as "code, a developer thing." Never appears in deliverables for this user. | Never appears. Word and PDF only. | S1 §Persona card — *"If it isn't in Word with my letterhead, it isn't a real document."* QC F-112, F-102. |
| **API key** | "I don't know what that is." Near-disqualifying drop-off. | "Your AI account" or "your Claude / OpenAI account password" | `analysis-and-report.md` §5 F1. QC F-105 — missing training-opt-out guidance compounds the problem. |
| **Whiteboard** | Nothing in a law practice is a whiteboard. Signals the wrong product category. | Remove. | `vision-most-viable-keepance.md` §9 — *"Not a generic AI note-taking app."* |
| **Brainstorm** | Not in the legal vocabulary. Implies unstructured ideation, not matter work. | "Review," "analyze," "draft," "prepare" | S1 §Section 4 — *"I'm not looking for a toy. I'm looking for two or three hours of my life back."* |
| **Founder / "Jameson"** | A personal name in trust-critical copy signals "some guy," not a company. Fatal to firm adoption. | "Advisor Prep Hero" or a support alias (support@keepance.com) | QC F-119 — *"'the moment my risk committee sees 'reply to any email from Jameson,' this stops being a vendor and becomes some guy.'"* |
| **Competitor** | Legal professionals do not use this word about opposing parties or market alternatives. | Remove entirely from user-facing copy | `vision-most-viable-keepance.md` §9 — *"Not a generic AI note-taking app or a Notion competitor."* |
| **Business kickoff / Marketing-speak** | The word "business" and marketing idioms ("transform," "unlock," "leverage," "seamless") are audibly wrong in a legal context. | Specific, concrete nouns and verbs: "find," "draft," "prepare," "review" | `attorney-persona.md` §Signature quotes — *"She has a sharp BS detector for compliance claims."* |
| **docs/ research/ templates/ (with trailing slashes)** | Developer file-system notation on the first-run screen. Signals "this was built by a programmer." | "Documents," "Research," "Templates" in natural language | QC F-102 — *"Slashes after folder names is how software people write, not how I write."* |

**Formatting rule:** No em-dashes in any user-facing copy. Use commas, periods, or restructure the sentence. Source: global writing policy.

---

## 4. The Five Non-Negotiables as UI Acceptance Tests

From `vision-most-viable-keepance.md` §6 — *"These are not differentiators. They are the price of being allowed to play."*

---

### Non-negotiable 1: Every AI answer over client data carries a one-click, verifiable citation.

**UI acceptance test:** Open any AI chat session with "Ask my matter" enabled. Send a question that has a real answer in the indexed corpus. The response must: (a) include at least one clickable citation chip; (b) clicking the chip opens the source document at the exact quoted passage; (c) a "Verified" label appears on the chip after the click. A response that contains page numbers as plain text ("see p. 31") without a clickable chip FAILS. A response that answers fluently with no citation FAILS.

**Pass / fail evidence today:** The full-text Search surface PASSES (QC `persona-findings.md` Task 4 positives). AI chat citation chips over a populated index are BUILT but UNVERIFIED end-to-end due to the embedder model not being bundled (QC `VISION-COVERAGE-AUDIT.md` Non-negotiable 1, Job 1). This is the most important gap to close before any redesigned surface goes live.

Source: `analysis-and-report.md` §Executive Summary point 4 — *"The citation is the price of admission, not a feature. She refused to trust the AI's answer until she clicked through and verified the source email."*

---

### Non-negotiable 2: Output is real, faithful Microsoft Office and PDF on letterhead. Never Markdown the attorney sees.

**UI acceptance test:** Run any legal workflow. The artifact that lands in the matter folder must be a `.docx` file that opens in Microsoft Word without a repair dialog, with correct headings, body text, and any tables rendered as real Word tables (not pipe-character text). Exporting to PDF must produce a file that opens in Adobe Acrobat without errors. An output file named `ENGAGEMENT_LETTER.md` FAILS. A `.docx` file where tables appear as `| Column | Value |` text FAILS.

**Pass / fail evidence today:** Word round-trip PASSES (QC `native-findings.md` F-406, F-417). Markdown table conversion to Word tables PASSES (F-108 fixed in v3.2.0). PDF export PARTIAL — depends on LibreOffice being installed (QC `VISION-COVERAGE-AUDIT.md` Pillar 4). All 18 legal templates output `.docx` (F-112 fixed per `CURRENT-STATE.md` §3).

Source: S1 §Section 2 — *"A document isn't real until it's in Word with my letterhead on it."* S3 Theme 4 — *"Advisor Prep Hero excels at the ideation and first-draft phases, it creates a severe bottleneck during the finalization phase."*

---

### Non-negotiable 3: The attorney can always explain, in one sentence, where their data is.

**UI acceptance test:** After a full onboarding session with no coaching, show the attorney the Data Map dialog and ask: "Where are your client files? Who can see your email? What happens when you ask the AI a question on the Local-only setting?" All three must be answerable in one sentence each. A response that includes "I think" or "I'm not sure" FAILS. A response that confuses "Advisor Prep Hero's servers" with "the AI provider" FAILS.

**Pass / fail evidence today:** PASSES in QC `persona-findings.md` Task 1 comprehension probe — verbatim PASS. Data Map labeled "a genuine firm-sale asset" (Task 5 positives). Critical gap: the status bar shows a positive egress signal only in Local-only mode — in Direct mode, switching off the local indicator leaves silence where there should be a clear "going to your AI provider" signal (QC F-120).

Source: `vision-most-viable-keepance.md` §6 Non-negotiable 3 — *"The lawyer can always explain, in one sentence, where their data is. If they cannot, the product has failed, regardless of how secure it actually is."*

---

### Non-negotiable 4: Only honest claims — the whole truth about provider exposure, told by Advisor Prep Hero first.

**UI acceptance test:** Before any AI prompt is sent, the confidentiality mode card must include the statement: "When you use a cloud AI (Claude, OpenAI, Google), your question goes directly to that provider. Advisor Prep Hero never sees it, but the provider does — for roughly 30 days by default. You can turn off training in your provider's account settings." If this disclosure is absent from the key-setup flow AND from the confidentiality mode card, FAILS. If the website claims a feature that does not exist in the application (currently: Clio integration implied as a connector; in prior versions, SSO), FAILS.

**Pass / fail evidence today:** In-app disclosure PASSES — the confidentiality mode card includes the training-opt-out reminder (QC `persona-findings.md` Task 4 positives). BYOK key-setup walkthrough PARTIALLY FAILS — the 5-step provider key walkthrough omits the training opt-out step (QC F-105). Website Clio claim and SSO claim were both false at various points (QC `VISION-COVERAGE-AUDIT.md` Pillar 7, Moat 2) — both must be current before any redesign ships.

Source: `analysis-and-report.md` §4.4 — *"She is allergic to overclaims... The vendor I'd actually trust is the one who says 'here is the one slice we handle, here is everything still on you.'"* S1 §Section 4 — *"Don't tell me you make me compliant. Compliance is my job."*

---

### Non-negotiable 5: It fits beside Clio, Outlook, and Word — never demands the attorney abandon her system of record.

**UI acceptance test:** Present the product to an attorney who has been using Clio for 5+ years. At no point in the onboarding must any screen suggest that Advisor Prep Hero replaces Clio, Outlook, or Word. The copy must say where Advisor Prep Hero sits — "beside your existing tools, not instead of them." A screen that says "replace your practice management system" FAILS. An integration card that implies a Clio connector exists when none does FAILS.

**Pass / fail evidence today:** Positioning copy PASSES on this test (no "replace Clio" claims visible in the app). Clio integration: PARTIAL FAIL on the honesty requirement — "fits beside Clio" is positioning only; there is no Clio matter or contact sync (QC `VISION-COVERAGE-AUDIT.md` Pillar 7). The redesign must represent the actual integration surface honestly.

Source: `analysis-and-report.md` §4.5 — *"All four sources agree it complements rather than replaces the system of record."* S1 §Section 2 — *"I'm not replacing Clio. I want to be clear about that."*

---

## 5. Prioritized Friction and Pain List, Tagged to Screen/Surface

Ranked by severity. Each item includes the screen or UI surface where it must be addressed, and references the specific research finding.

---

### Friction 1 (Severity: P0 / Daily / "My Tuesday"): Broken Outlook search

**Pain:** Diane spends an estimated 150 hours per year looking for emails she knows exist. Outlook caps results and silently excludes archived mail. This is the primary reason she would pay.

**Surface where it must be addressed:** The email search panel within a matter — the wedge feature. The AI "Ask my matter" surface. The full-text search panel.

**UI requirement:** The search surface must make "find all of it, including the archive" the default behavior, not an option to configure. It must show the quoted passage inline in the result, not just a subject line. Every AI answer must have a clickable citation to the source email.

**Research grounding:** S1 §Section 1 — *"That's not a small problem. That's my Tuesday. That's every Tuesday."* QC `persona-findings.md` Task 4 positives — full-text Search with inline quoted passages drew the protocol's "oh wow / finally" reaction. QC F-117 — AI answers that give page numbers as plain text instead of citation chips FAIL this test.

---

### Friction 2 (Severity: P1 / Weekly / "My Weekends"): Deposition contradiction-hunting

**Pain:** Manual review of 1,800 pages with a legal pad and Ctrl+F. The highest-value, highest-skill work is being strangled by document volume.

**Surface where it must be addressed:** The "Find contradictions" action at the matter level. The deposition analysis workflow. The output document (`.docx` in the matter folder).

**UI requirement:** The contradiction-finding workflow must be reachable from the matter view without opening a workflow gallery or entering a configuration screen. The inputs must be auto-suggested (documents already indexed for this matter). The output must be a Word document with numbered contradiction candidates, each with side-by-side citations.

**Research grounding:** S1 §Section 7 — *"The contradiction-finder solves my weekends."* QC F-126 — deposition contradiction finder hard-fails in browser build (P1). QC `VISION-COVERAGE-AUDIT.md` Job 2 — *"the marquee feature (contradiction finder) has never been seen surfacing real contradictions end to end."* This gap must be closed before the redesign ships.

---

### Friction 3 (Severity: P0-class / Existential / "The Gate"): Confidentiality fear and the data-location mental model

**Pain:** She cannot articulate where client data goes, so she cannot use the product for real client work. Her mental model conflates "stored on Advisor Prep Hero's servers" with "sent to the AI provider." Both feel like "the cloud." She stopped using ChatGPT because she lay awake worrying.

**Surface where it must be addressed:** The egress indicator (visible on every chat prompt). The confidentiality mode selector. The Data Map dialog (reachable from a persistent UI element, not only onboarding). The status bar (Direct mode must show a positive cloud-egress signal, not silence).

**UI requirement:** The egress indicator must be visible at the moment of sending — not just during onboarding. In Direct mode, the status bar must positively state "Going to [provider], directly from your device" — not go silent when Local-only is turned off (QC F-120). The confidentiality mode pill must link to a plain-English explanation at the point of display, not only in Settings (QC F-118, F-104).

**Research grounding:** `analysis-and-report.md` §4.3 — *"The data-location mental model is broken, and it is the central risk... Severity: 4."* S1 §Section 6 — *"Both involve something leaving, but they're not the same animal, and right now I couldn't swear to you which one this is."* QC Task 4 — egress indicator confirmed, comprehension probe PASSED. QC F-120 — Direct-mode status bar silence is still a P2 gap.

---

### Friction 4 (Severity: P1 / Routine / "Typing is not lawyering"): Drafting drag

**Pain:** First drafts of intake summaries, demand letters, case timelines, and discovery responses eat billable-quality hours. The repetitive parts are mechanical. She wants the machine to do the first pass and she does the judgment.

**Surface where it must be addressed:** The legal workflow gallery. The workflow output (`.docx` deliverable). The "Export as Word" primary action on every output.

**UI requirement:** The legal workflow gallery must be organized by what the attorney is about to do ("Prepare a demand letter," "Summarize a client intake," "Build a case timeline") — not by abstract workflow names. Every workflow must produce a `.docx` with visible acceptance criteria ("this draft follows the structure of [template]; you review before sending"). No mock responses must be silently presented as real output (QC F-106 — P0 finding).

**Research grounding:** S1 §Section 3 — *"The most repetitive writing in my week is probably status updates to clients and the routine procedural stuff... That's mechanical. That's not lawyering, that's transcription with extra steps."* QC F-106 — workflow that silently runs MockProvider and presents "This is a mock response." under a green "Complete" bar is a P0 trust-killer.

---

### Friction 5 (Severity: P1 / First session / "Abandoned in the first ten minutes"): Setup friction — API key and onboarding

**Pain:** The API key step is the #1 predicted and confirmed drop-off. She does not know what an API key is, why she needs one, who she is paying, or what it means for her client's data. "I'm only sort of kidding" when she says she'll close it in eight minutes if there's an API key screen.

**Surface where it must be addressed:** The first-run wizard AI setup step. The BYOK provider key walkthrough. The "Set this up later" escape at every wizard step.

**UI requirement:** The AI account connection screen must never use the term "API key." Instead: "Connect your AI account" with a plain-English description ("You pay Claude or ChatGPT directly for AI use — we never handle your data or charge you for AI"). The 5-step key walkthrough must include: what training opt-out means, how to turn it off, and what the provider does with your questions (QC F-105). The "Set this up later" escape must be prominent and must work (QC Task 1 positives confirm it exists).

**Research grounding:** `analysis-and-report.md` §5 F1 — *"API-key step is the #1 drop-off (severity 3 to 4). 'I don't know what that is.'"* S1 §Persona card — *"'API key' is developer jargon. She will not know what it is, why she needs one, or that she pays the AI provider, not Advisor Prep Hero. High risk of drop-off at setup."* QC F-105 — BYOK walkthrough omits training/retention opt-out.

---

### Friction 6 (Severity: P1 / Adoption gate / "Show me a lawyer I'd have a drink with"): No peer proof

**Pain:** For real client work, social proof from named attorneys she respects is 80-90% of the adoption decision. Zero testimonials is close to disqualifying. Features get her curious; other lawyers get her to adopt.

**Surface where it must be addressed:** The trust panel / social proof surface. The pricing page. Any screen where a new user evaluates whether to put a real matter in. The attorney-facing marketing site (outside app scope but load-bearing).

**UI requirement:** An in-app "attorneys using Advisor Prep Hero" surface — showing full name, bar association, practice area — must exist and be reachable from the first session. The trial-to-purchase path must not show a license key entry field before the pricing tiers (QC F-128). The vendor identity must be "Advisor Prep Hero" throughout — no "Jameson" in any user-facing string (QC F-119).

**Research grounding:** S1 §Section 5 — *"Other lawyers using it gets me to actually adopt. They're not the same step. I've been curious about lots of things I never adopted. The bridge from curious to adopted is almost always another lawyer I trust saying 'it's fine, I use it, here's how.'"* `analysis-and-report.md` §7 — *"Three conditions, none of them capability: proof from real attorneys, a data-safety story she can repeat to a worried client, and a real trial on one real, low-stakes matter."*

---

### Prior UX Findings — Confirmed, Tagged to Surface

The following findings from the v3.0 quality campaign are directly relevant to the redesign and must not be regressed:

| Finding | Severity | Surface | UI requirement |
|---|---|---|---|
| F-102: developer idiom folder names ("docs/ research/ templates/") | P3 | Workspace selector / first-run | Replace with natural-language labels; never use trailing slashes |
| F-117: no click-through citations on AI answers | P1 | AI chat / "Ask my matter" | Every AI answer must have clickable citation chips — this is Non-negotiable 1 |
| F-119: "Jameson" in privacy/telemetry/unsubscribe copy | P1 | Settings / privacy / trust copy | Replace all personal-name references with "Advisor Prep Hero" and a support alias |
| F-122: matters buried inside the AI chat | P1 | Sidebar navigation | Matters must be a top-level sidebar entry with its own panel — not reachable only from inside a chat |
| F-104: "network extensions disabled" jargon | P2 | Status bar privilege pill | Rewrite in lawyer vocabulary: "Privileged matter: AI stays on your machine" |
| F-120: no positive cloud-egress signal in Direct mode | P2 | Status bar | Show a visible "Going to [provider]" state when Direct mode is active, not just silence |
| F-106: silent mock/degraded AI presented as "Complete" | P0 | Workflow completion panel | Any degraded, mock, or desktop-only failure must be surfaced as an explicit error — never a green checkmark |
| F-126: Deposition Contradiction Finder hard-fails in browser | P1 | Workflow execution | Workflow must either complete or refuse gracefully with a clear "what's missing" explanation |

---

## 6. Trust and Confidentiality UI Requirements

The confidentiality architecture is not a settings panel — it is the brand. Every UI surface that touches client data must reinforce that the attorney is in control. These requirements specify what must always be visible, always be accessible, and never be absent.

---

### 6.1 Egress Indicator: Always On, at the Moment of Sending

**Requirement:** A persistent visual indicator shows exactly where the current prompt is going — for every chat, every workflow, every AI action — before and during the send, not just in a help article.

**Three required states:**

1. **Local-only (green):** "On your machine. Nothing leaves. This runs on your local model — no prompt or file is sent over the network." (Verified working in QC `native-findings.md` F-411.)

2. **Direct BYOK (amber or neutral):** "Going to [Anthropic / OpenAI / Google], directly from your device. Advisor Prep Hero never sees this. Your provider receives the question and retains it for approximately 30 days by default — adjust in your account settings." (QC F-120: currently ABSENT in the status bar when Direct mode is active — this is a required addition.)

3. **Assured (firm managed):** "Going through your firm's private relay. The relay never stores your content — only your firm's admin can see session metadata." (Required for firm tier.)

**Research grounding:** `analysis-and-report.md` §4.3 — *"S4's concrete fix is the best idea in either report: a highly visible egress indicator at the point of sending each prompt."* S1 §Section 6 — *"I'd need it spelled out, in lawyer-plain English, what exactly goes to the AI company and what doesn't."*

---

### 6.2 Matter Scope: Always Visible at the Query Surface

**Requirement:** Every AI query surface — chat, workflow, search — shows the current matter scope persistently. The attorney always knows whether the AI is looking at "everything" or "only the Brennan matter." Changing scope requires one click, not a navigation step.

**Research grounding:** QC F-122 — matter management is P1 buried finding. S1 §Section 7 — *"any tool I bring in, the real question is does it work for the three of us, or does it create a new silo."* The matter scope protects against the attorney accidentally pulling in documents from a different client when answering a question.

---

### 6.3 The Plain-English Data Map: Always Reachable, Always Printable

**Requirement:** The Data Map — a one-page, plain-English description of where files live, what is encrypted, what the AI provider sees, how to opt out of training — must be reachable from a permanent, labeled UI entry accessible at all times (not only during onboarding). It must be printable / exportable as PDF in one click so the attorney can show it to a client or attach it to an engagement letter.

**Six required sections** (from `DataMapDialog.tsx`, verified working QC `persona-findings.md` Task 1 comprehension probe PASS):
1. Your files stay on this computer, in a folder you chose.
2. Your AI account key is kept in your operating system's secure keychain — Advisor Prep Hero never stores it.
3. When you use a cloud AI (Claude, OpenAI, Google), your question goes directly to that provider. We never see it. The provider retains it for approximately 30 days by default.
4. For matters where nothing must leave this machine, use Local-only mode.
5. Your imported email is encrypted on this computer — Advisor Prep Hero's company servers never receive a copy.
6. The only thing Advisor Prep Hero's servers ever see is a license check.

**Research grounding:** QC Task 5 positives — *"Data Map is a genuine firm-sale asset — 'printable so you can show a client,' six plain-English sections."* S1 §Section 4 — *"I'd need a plain-English, client-shareable explainer."*

---

### 6.4 The Confidentiality Spectrum: Local / Direct / Assured — Per-Matter

**Requirement:** The three confidentiality modes are not global application settings to be configured once — they are per-matter choices the attorney makes when she decides how sensitive a given matter is. The UI must surface this choice at the matter level, with plain-English labels:

- **Local-only:** "AI stays on this computer. Nothing leaves. Best for your most sensitive matters."
- **Direct (your AI account):** "Questions go straight to your AI provider. Advisor Prep Hero never sees them. Your provider's standard terms apply."
- **Assured (firm):** "Questions go through your firm's private relay with zero retention. For matters your firm manages jointly."

**Research grounding:** `vision-most-viable-keepance.md` §5 Moat 1 — *"the full spectrum and let the user pick per matter... the unfair advantage: Microsoft 365 Copilot and the other cloud assistants cannot credibly promise 'we never see your data.'"* S1 §Addendum — *"She likes that her files are 'really hers,' but when asked directly whether client files sitting readable on a laptop worry her, she wants the option to lock them."*

---

### 6.5 The Audit Trail as "Your Defense File"

**Requirement:** The audit trail UI must use the heading "Your defense file" (or "Your activity record") — not "Audit log." The framing in every label, tooltip, and explainer is: "This record protects you. It shows what the AI did, when, and over which matter — so you can prove your supervision if you are ever asked."

**Three required framing elements:**
1. A one-sentence header on the audit surface: "A private record of every AI action in this matter, kept on your machine."
2. Exportable as CSV or PDF in one click, for inclusion in a privilege log or in response to a bar inquiry.
3. Entries are labeled by action type and matter — not by internal event names or system codes.

**Research grounding:** QC `persona-findings.md` Task 5 positives — *"Audit log framing is exactly right... 'kept on your machine for your files and your defense' reads as protective, not surveillance."* `analysis-and-report.md` §5 F6 — *"First read 'is this watching me,' then self-reframed as 'my defense file.' One protective line at the top prevents the negative first read."*

---

### 6.6 The Trust Story as a Transparent Limitation, Not a Compliance Claim

**Requirement:** Every piece of copy that describes the confidentiality architecture must include what Advisor Prep Hero does NOT handle, not only what it does. The formula is: "Here is the one slice we handle — [X]. Here is what is still on you — [Y]."

Examples of correct framing:
- "We keep your files on your machine and route your AI questions directly to your provider. What happens at the provider — retention, training, breach — is governed by your account with them. We show you how to configure it."
- "We do not make you ABA 512 compliant. Compliance is your job. We show you exactly where we fit and where we don't."

**Examples of prohibited framing:**
- "We solve your confidentiality problem."
- "We make you ABA 512 compliant."
- "Your data never leaves your machine." (Without the asterisk for cloud AI prompts.)

**Research grounding:** S1 §Section 4 — *"The vendor I'd actually trust is the one who says 'here is the one slice we handle, and here is everything still on you.' That honesty is so rare that when I hear it, it actually makes me want to buy."* `analysis-and-report.md` §4.4 — *"The precise, modest, fully-disclosed story is both the most persuasive and the most defensible."*

---

## Appendix: Research Corpus Index

| Source | Path | Primary value |
|---|---|---|
| Persona card | `docs/research/2026-06-08-ux-attorney-v2.5.1/personas/attorney-persona.md` | Ground truth on Diane's tools, pain, and voice |
| Interview transcript (S1) | `docs/research/2026-06-08-ux-attorney-v2.5.1/transcripts/interview-transcript.md` | First-person pain narrative; verbatim quotes |
| Usability test transcript (S2) | `docs/research/2026-06-08-ux-attorney-v2.5.1/transcripts/usability-test-transcript.md` | Task-by-task findings; severity ratings |
| Analysis and report | `docs/research/2026-06-08-ux-attorney-v2.5.1/report/analysis-and-report.md` | Triangulated findings; prioritized recommendations |
| Vision: Most Viable Advisor Prep Hero | `docs/research/2026-06-08-ux-attorney-v2.5.1/vision-most-viable-keepance.md` | Strategic north star; three jobs; six non-negotiables; seven pillars |
| Attorney UX Review (S3) | `docs/research/2026-06-08-ux-attorney-v2.5.1/deep-research-reports/Attorney UX Review of Advisor Prep Hero.md` | E-discovery; work-product; regulatory breadth; DMS gap |
| ChatGPT deep research (S4) | `docs/research/2026-06-08-ux-attorney-v2.5.1/deep-research-reports/ChatGPT deep research attorney UX report Advisor Prep Hero.md` | Provider exposure; governance inconsistency; enterprise assurance gaps |
| Persona study findings (QC) | `docs/quality/2026-06-10-v3-usability-campaign/persona-findings.md` | 28 v3.0 findings; F-101 through F-128; Diane's verdict |
| Quality campaign findings | `docs/quality/2026-06-10-v3-usability-campaign/findings.md` | F-001 through F-210; brand; layout; spec findings |
| Native desktop pass | `docs/quality/2026-06-10-v3-usability-campaign/native-findings.md` | F-401 through F-426; proven and blocked items on real hardware |
| Vision coverage audit | `docs/quality/2026-06-10-v3-usability-campaign/VISION-COVERAGE-AUDIT.md` | Per-pillar build status; verified vs. unverified; gaps to close |
| Current state | `docs/operations/2026-06-13-CURRENT-STATE.md` | v3.2.0 live; what shipped; what is still open |

---

*This brief is the foundation the redesign is measured against. Every screen decision in the UI reimagining must be traceable to a finding cited here. Where a design choice conflicts with this brief, the brief governs unless new real-participant evidence overrides it.*
