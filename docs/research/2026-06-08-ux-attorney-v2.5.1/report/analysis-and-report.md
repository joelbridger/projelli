# Keepance v2.5.1: Attorney UX Research, Findings and Recommendations

**Prepared by:** Dr. Lena Whitfield, Principal UX Researcher
**Date:** 2026-06-08
**Product:** Keepance 2.5.1 (email-intelligence release)
**Evidence base:** four independent sources (see Section 1).

> **How to read this report.** It does not pre-filter findings to fit the current ICP, scope, pricing, or product identity. Where the evidence challenges a decision already made (who the customer is, the local-only and no-collaboration stance, plaintext Markdown storage, the "removed from the data path" claim, the one-person-vendor posture), it says so plainly and frames the strategic choice rather than quietly setting it aside. Prioritization is by real-world impact and effort, so the work can be sequenced. Nothing is dropped for failing to match the existing plan.
>
> **Honest confidence caveat.** All four sources are pre-real-user: two are synthetic role-played sessions, two are desk analyses of the public record. Convergence across four independent lenses is a strong prior, not proof. Pass B with real recruited attorneys against the live build remains essential before betting the roadmap. Treat numbers (SUS, SEQ) as illustrative of one modeled experience, not as a measured score.

---

## 1. Sources and what each is good for

| Tag | Source | Lens | Best for |
|---|---|---|---|
| **S1** | Synthetic depth interview, participant Diane Marchetti (small-firm civil litigator), ~10,400 words | First-person, daily-workflow, emotional reality | Pains, language, mental models, what wins or loses a real practitioner |
| **S2** | Synthetic usability test, same participant, ~15,300 words | Hands-on, task-based, think-aloud | Where the critical path to value breaks, severity-rated UX failures |
| **S3** | Deep-research report, "Attorney UX Review of Keepance" | Senior commercial-litigation / corporate-advisory; e-discovery and legal-ops depth | Discoverability, work-product, encryption, MCP risk, regulatory breadth |
| **S4** | Deep-research report, ChatGPT, grounded in the public record with citations | Vendor-diligence and public-governance | Documentation inconsistency, provider-retention reality, enterprise-assurance gaps, integration depth |

S1 and S2 are mine (this study). S3 and S4 are the two deep-research reports generated in parallel. They were produced independently, which is exactly why their agreement matters: when a first-person practitioner, a hands-on usability run, a litigation-ops review, and a public-record diligence pass all land on the same point, that point is close to a safe bet.

[Interview](../transcripts/interview-transcript.md) | [Usability test](../transcripts/usability-test-transcript.md) | [S3](<../deep-research-reports/Attorney UX Review of Keepance.md>) | [S4](<../deep-research-reports/ChatGPT deep research attorney UX report Keepance.md>)

---

## 2. Executive summary

Eight honest takeaways. The first five are about what to do with the product as it is. The last three are about decisions bigger than the product.

1. **The email feature is the wedge. Lead with it.** Finding what a client said, instantly and privately, was the single moment the product clicked (S2), the thing the participant said would make her pay. All four sources rate email/deposition/document analysis as the most credible attorney workflows. The current "AI workspace" framing buries the one thing that wins.

2. **The product's central promise has an asterisk you are not telling, and lawyers will find it.** "Your data never leaves your machine" / "we are removed from the data path" is true about Keepance's own servers. It is not true about the AI provider: unless the user runs a local model (Ollama), the prompt still goes to Anthropic, OpenAI, or Google, who retain it for a window (roughly 30 days for OpenAI and Anthropic, up to 55 days for Google's abuse monitoring) and where the user must separately opt out of training in their own provider console (S4, S3). The participant could not tell the difference between "stored on a vendor server" and "sent to an AI to answer a question," and that confusion is the core trust failure (S1, S2). The fix is radical honesty plus a visible egress indicator at the moment a prompt is sent (S4). Told straight, this is a moat. Told as "nothing leaves," it is a credibility risk for the one audience that reads the fine print for a living.

3. **The biggest usability failure is that she cannot explain where her data goes.** For a confidentiality-bound professional, an uncertain answer to "where is my client's data and who can see it" is a disqualifying answer. The product largely does the right thing; she cannot tell that it does (S2, severity 4). This is communication, not engineering, and it is the single most valuable fix in the study.

4. **The citation is the price of admission, not a feature.** She refused to trust the AI's answer until she clicked through and verified the source email. A cited answer won her; an uncited one would have destroyed trust in every answer (S2, echoed by S4 on hallucination and provenance).

5. **The "developer tool wearing a suit" diagnosis is confirmed and specific.** The API-key step nearly lost her, raw Markdown read as "code," and the Word export was buried (S2). Markdown to Word and to firm document systems is a real bottleneck, not a quibble (all four sources). These are fixable without inventing new capability.

6. **Trust, proof, and basic governance are missing, and this audience does diligence for a living.** Zero named attorneys vouch for it (S1). There is no SOC 2, DPA, trust center, or SLA, the vendor is a sole proprietor, and the EULA caps liability at the greater of fees paid or $100 (S4). On top of that, the public documentation contradicts itself across pricing, licensing (perpetual versus annual), version numbers (download page shows one version, the repository another), telemetry, kill-switch claims, and template counts (15 versus 18 versus 28) (S3, S4). To a lawyer, inconsistency reads as unreliability.

7. **Local-first moves risk, it does not abolish it, and the current storage model has two unresolved tensions.** The workspace is plaintext Markdown by design (a selling point: "real files you own"). But plaintext on disk, protected only by OS-level encryption, is flagged as insufficient for firm confidentiality and audits (S3, S4), and v2.5.1 encrypts imported email but not the workspace itself. Separately, every AI chat is saved as a permanent local file, which means a lawyer is silently generating thousands of discoverable records that may contain privileged mental impressions, with no tagging or metadata scrubbing to manage them (S3). Two of the product's identity choices (plaintext portability, save-everything) collide with two core legal duties (confidentiality at rest, work-product protection).

8. **The evidence raises a real question about who the customer is, and it is yours to answer.** Keepance is excellent as a private drafting-and-search sidecar for a solo or very small firm. It is not, today, a platform a firm can adopt: no real collaboration, no document-management integration, no enterprise assurance, single-user local installs even on the multi-seat tier (S3, S4), and even the participant noted she is "not a solo island," her associate and paralegal touch the same work (S1). You can win the solo wedge as it stands, or you can invest to serve firms, which is a materially bigger and different company. You probably cannot be both right now. This is a board-level decision the research surfaces but does not make for you (Section 8).

The one-line version: **Keepance has a genuinely strong wedge and a genuinely honest architecture, wrapped in a story that overclaims in one place, under-explains in another, and has not yet decided whether it is a tool for one lawyer or a platform for a firm.**

---

## 3. The attorney's world: context and ranked pains (S1, with S3/S4 support)

The participant is a 54-year-old solo/small-firm civil litigator, 24 years in practice, who bills in tenths of an hour and is, in her words, "the managing partner, the IT department, and the person who empties the dishwasher." Her pains, ranked:

1. **Email archaeology (daily).** 25 minutes to find a March email she knew existed; Outlook's archive is "the welded-shut drawers"; an estimated 150 hours a year lost to "the looking." *"I live in my email and I can't find anything in it. That's not a small problem. That's my Tuesday."* This is exactly the wound v2.5.1's email wedge targets.

2. **Document volume in litigation (her "weekends").** Manual contradiction-hunting across an 1,800-page production and a 240-page deposition with a legal pad and Ctrl+F. Asked for a magic wand she did not say email: *"Email is my Tuesday. The documents are my weekends. Give me my weekends."* S3 and S4 independently rate deposition analysis, contradiction spotting, and timeline building as the most credible attorney workflows, so this is both her biggest pain and the product's natural next strength.

3. **AI envy in tension with AI fear.** Tried ChatGPT in 2024, found it "eighty percent there," then stopped, "wondering if I'd just handed my client's facts to a server in California." She knows Avianca and *Heppner*. *"The upside is I save some time. The downside is I lose everything I've built."*

4. **A litigator's e-discovery instinct (surfaced strongly in S3).** A sophisticated attorney immediately worries that every saved AI chat is discoverable ESI, that prompts reveal protected mental impressions, and that hundreds of local Markdown files need privilege logging and metadata hygiene. My participant did not raise this unprompted, but she is precisely the litigator for whom it applies, so Pass B must probe it.

5. **Drafting drag, no IT capacity, and the need for proof** (covered in Sections 6 and 7).

**Jobs To Be Done:** find the exact email and what was said in seconds; surface every contradiction across transcripts, statements, and emails without losing a weekend; get a strong first draft fast; and, underneath all of it, be certain client data stays under control so she can prove she met her ethical duties if anyone ever asks.

---

## 4. Does the positioning land? (Strategic findings)

### 4.1 The email wedge is the strongest reason to adopt (S1, S2; supported S3, S4). Confidence: high.
Task 4 (find what a client said) was the high point of the study: success, unaided, SEQ 6/7. She tried keyword search first out of Outlook habit, found it merely incremental, then asked the AI a plain-English question and got the exact email back with a clickable citation: *"Oh. That's the thing... there's no comparison... the reason I'd actually pull out a credit card."* S4 independently calls email import "potentially very compelling" because "email is often where the matter really lives," and flags that it could be "one of the product's strongest differentiators if documented well enough for attorneys to trust it." The feature that wins is also the one whose public trust scaffolding is weakest (see 6.1). Lead with it, and document its security model.

### 4.2 "Local-first" only lands when translated, and "nothing leaves" overclaims (S1, S2, S4). Confidence: high.
Abstract "your files stay on your computer" washed over her; concrete "documents in folders you control, that nobody can hold hostage" landed in her gut. "Workspace" briefly read as "something cloudy that belongs to the software company" until she realized it meant a folder. Local-first is a genuine purchase driver in plain, ownership language. But the stronger claim, that data never leaves, is only fully true on a local model. S4 is explicit: the architecture "does reduce exposure to Keepance itself" but "does not remove exposure to the chosen AI provider unless the lawyer uses a local model." This is the asterisk from Executive Summary point 2.

### 4.3 The data-location mental model is broken, and it is the central risk (S1, S2, S4). Confidence: high. Severity: 4.
She cannot separate "my documents are stored on Keepance's computers" from "my documents are on my computer but my questions get sent to the AI": *"Both involve something leaving, but they're not the same animal, and right now I couldn't swear to you which one this is."* After connecting email she was worse, not better: *"If I can't explain to a worried client exactly where their email is and who saw it, I can't use this."* S4's concrete fix is the best idea in either report: a highly visible **egress indicator** at the point of sending each prompt ("Local model" / "Direct to Anthropic API" / "Direct to OpenAI API" / "Google paid tier", with a stronger warning for the browser demo), plus a **banner when the workspace lives in a synced cloud folder** (Dropbox/iCloud/OneDrive), because that quietly reintroduces the third-party exposure the product claims to remove.

### 4.4 Honesty beats compliance theater, and it is also the legally accurate position (S1, S3, S4). Confidence: high.
She is allergic to overclaims: *"Don't tell me you make me ABA 512 compliant. Compliance is my job."* She would buy from a vendor who says "here is the one slice we handle, here is everything still on you." S3 and S4 confirm the law is unsettled: ABA Opinion 512 and *Heppner* make the local-first direction "directionally credible," but no lawyer should treat it as "a complete privilege answer by itself." S3 adds dimensions the current narrative omits: the **duty of technological competence** (ABA Model Rule 1.1, adopted in 28 states) and **state AI statutes** such as the Utah AI Policy Act, which imposes disclosure duties on regulated occupations with fines up to $2,500 per violation. The precise, modest, fully-disclosed story is both the most persuasive and the most defensible.

### 4.5 Keepance sits beside Clio, Outlook, and Word, and that is the honest ceiling today (S1, S3, S4). Confidence: high.
All four sources agree it complements rather than replaces the system of record. S4 quotes Keepance's own comparison pages saying it "sits beside Clio." This is fine as positioning, but it caps the product at "private drafting and analysis sidecar" until the integration and collaboration questions in Sections 6 and 8 are answered.

---

## 5. Usability findings (task-by-task, severity-rated; S2, with cross-source support)

| Task | Outcome | SEQ | Main issue (severity) |
|---|---|---|---|
| 1. Onboarding to a working workspace | Success (assisted) | 4/7 | API key + data comprehension (3 to 4) |
| 2. Run a legal workflow, export to Word | Success | 5/7 | Markdown default + buried export + format fidelity (3) |
| 3. Connect email, understand what happened | Success mechanically, **partial comprehension** | 4/7 | Data-location uncertainty (4) |
| 4. Find what a client said | Success (unaided) | 6/7 | Search-vs-AI ambiguity (1 to 2) |
| 5. Trust, cost, verdict | Success | 5/7 | Audit framing (2), cost predictability (2 to 3) |

**Overall SUS: 65** ("usable with real friction"). The two depressors were the API-key step and data-comprehension uncertainty. Both are communication gaps.

- **F1. API-key step is the #1 drop-off (severity 3 to 4).** "I don't know what that is." The explainer and the praised "test this key" button partially rescue her, but "what is this, where do I get one, am I paying you or them, and do I need to turn off training" remain unanswered (S2; S3 stresses the attorney must opt out of training in the provider console, which the setup should surface).
- **F2. The data-location story does not stick (severity 4).** Her own fix: a plain-English, client-shareable "here is exactly where your data is and who can see it." Pair with the S4 egress indicator and synced-folder banner.
- **F3. Raw Markdown is the wrong default for this user (severity 3).** It reads as code; the rendered view recovered it but is not the default.
- **F4. Word export is buried, and fidelity is a real worry (severity 3).** The export exists and the .docx cleared her "real document" bar (a genuine strength), but it hides behind an unlabeled icon, and S3 warns that complex legal formatting (redlines, tables, tables of authorities, line numbering) often breaks on Markdown-to-Word export. So "find the button" is necessary but not sufficient; the output has to survive real legal formatting.
- **F5. Citations win lawyers (hard constraint).** Protect it absolutely; never ship an uncited answer over client data.
- **F6. Audit log is double-edged but nets positive (severity 2).** First read "is this watching me," then self-reframed as "my defense file." One protective line at the top prevents the negative first read. Note from S3/S4: it is useful provenance but not evidence-grade chain of custody (no hashing, immutable seals, or legal hold).
- **F7. Cost predictability worries a small firm (severity 2 to 3).** BYOK honesty earns respect ("not nickel-and-diming me"), but "I don't know what it'll cost me in a heavy month" is real. S4 confirms typical solo spend of roughly $5 to $15 per month, which should be shown as a forecast with an optional cap.

**Positives to protect:** the profession picker speaks her language; workspace-as-folder reads as anti-lock-in once understood; the device-code email sign-in nets positive once she recognized the Microsoft domain ("I'm not giving Keepance my password"); the read-only consent screen matching the app's claim built trust; folder scoping on import read as control.

---

## 6. The full set of findings the deep-research reports add

These are reported as findings, not filtered by whether they fit the current scope. Several point past the solo wedge toward firm-grade needs; that tension is the subject of Section 8, not a reason to omit them here.

### 6.1 The email wedge is under-documented for trust (S4).
The strongest differentiator has the thinnest public security documentation: no clear public guide to mailbox authentication, the encryption implementation, threading, attachment handling, or how email metadata is indexed and protected. Attorneys will not put real client mail into a feature whose security model they cannot read. Documenting this is as important as building it.

### 6.2 Saved AI chats are discoverable ESI and may contain work product (S3). 
Because every conversation becomes a permanent local file, a lawyer accumulates thousands of discoverable records. Prompts that lay out strategy ("find weaknesses in the indemnity clause to use in settlement") are opinion work product. There is no way to tag a file or block as privileged, segregate prompts from outputs for privilege review, or scrub hidden metadata before sharing. For a litigator this is a real exposure, and it is created by the product's save-everything default.

### 6.3 Encryption at rest is the unresolved core (S3, S4).
The workspace is plaintext Markdown protected only by OS-level encryption, which S3 and S4 both call insufficient for firm confidentiality and security audits. v2.5.1 encrypts imported email but not the workspace. This collides directly with a marketed selling point ("real Markdown you can open in VS Code"). Both reports recommend an application-level encrypted vault (AES-256, master password or biometric) as an option.

### 6.4 MCP and plugins are an exfiltration attack surface (S3, S4).
Exposing the local workspace to external AI clients (Cursor, Zed, Claude Desktop) via MCP, or to plugins with `network` permission plus `workspace:read`, is a potential data-exfiltration path. S4 praises the plugin permission model as one of the better small-tool ones but still wants signing, allowlists, endpoint controls, logging, and a "firm mode" that disables risky extensions for privileged matters. S3 wants prominent warnings before MCP activation.

### 6.5 Provider exposure and training opt-out (S4, S3).
The BYOK story needs the whole truth: the provider sees the prompt unless Ollama is used; retention windows vary; and the attorney must opt out of training in their provider console. The product should guide this, and make the local-model path a first-class "nothing leaves the machine" option, not a footnote.

### 6.6 Evidence-grade controls are absent (S3, S4).
Version history is good for work-product history but is not litigation-grade: no immutable snapshots, cryptographic sealing, file hashing, legal hold, or export manifests. Provenance of AI-assisted drafting is not the same as chain of custody for evidence.

### 6.7 Collaboration and the team reality (S1, S3, S4).
Real-time collaboration is explicitly not in the product, and even the multi-seat Practice tier is separate local installs, not a shared matter room with permissions, comments, review workflows, or ethical walls. The participant independently flagged that her associate and paralegal touch the same work and a single-machine tool could "fracture the team."

### 6.8 Integration depth (S3, S4).
No native connectors to practice management (Clio, MyCase, Litify), document management (NetDocuments, iManage), e-discovery (Relativity, Everlaw, Reveal), document automation (HotDocs, Gavel), or court e-filing. Files siloed on a local drive bypass firm governance and create version sprawl.

### 6.9 Enterprise assurance and vendor risk (S4).
No SOC 2, ISO 27001, DPA, trust center, breach-notification commitments, or SLA. Sole-proprietor vendor; EULA caps liability at the greater of fees or $100. Acceptable for a solo pilot; a hard stop for a firm risk committee.

### 6.10 Documentation and governance inconsistency (S3, S4).
Pricing, licensing (perpetual versus annual), version numbers (download page versus repository), telemetry claims, "no kill switch" versus weekly license validation, and template counts (15 versus 18 versus 28) are misaligned across the homepage, FAQ, EULA, roadmap, changelog, download page, and repository. For a profession that does diligence, this is a trust problem in its own right.

### 6.11 Scale ceiling (S3, S4).
Great for one critical deposition; not an e-discovery or technology-assisted-review platform for 50,000 documents. Worth owning explicitly so the positioning stays honest.

### 6.12 Concrete missing features named across S3/S4.
Metadata scrubbing on export; local OCR (for scanned filings) before analysis; privilege/work-product tagging and automated privilege-log generation; structured matter metadata (matter number, client, custodian, Bates ranges, privilege status, retention/hold state); secure review-package export; redaction previews and field-level no-send rules; secure delete for trash.

---

## 7. The trust and adoption equation

Her verdict (S1, S2) was a **cautious yes, gated on three conditions, none of them capability:**
1. **Proof from real attorneys** (testimonials, an advisor or two, a CLE, bar presence). Recurring and near-disqualifying in its absence: *"Show me a lawyer I'd have a drink with who uses this."*
2. **A data-safety story she can repeat to a worried client**, because the first thing a sophisticated client asks is "where is my stuff, and did you give it to an AI."
3. **A real trial on one real, low-stakes matter**; a sandbox does not earn real-client trust.

S4 adds the firm-level layer she did not, because she is a solo: a risk committee needs the enterprise assurance package (Section 6.9) and the governance reconciliation (Section 6.10) before a firm-wide yes is even possible. So there are two distinct trust thresholds: the solo's ("show me a lawyer and tell me where my data is") and the firm's ("show me your SOC 2, your DPA, and paperwork that agrees with itself"). Which one you must clear depends on Section 8.

---

## 8. The strategic tensions the evidence forces

These are board-level. The research surfaces them; the calls are yours. For each I give a recommendation, but the point is to make the choice consciously rather than by default.

**Fork A: Who is the customer, one lawyer or a firm?** The product is a strong solo/small-firm private-drafting-and-search sidecar and, today, cannot be a firm's platform (no collaboration, no DMS, no assurance, single-user installs). My recommendation: **commit to winning the solo and very-small-firm wedge first**, lead with email search, and treat firm-grade capability as a deliberate, later, much larger bet rather than drifting toward it. But if firms are the real destination, several "later" items below become "now," and the company itself has to grow up (Fork D). Do not leave this implicit.

**Fork B: Plaintext portability versus encryption at rest.** "Real Markdown you own, open it anywhere" is a marketed identity. Plaintext on disk is also a confidentiality gap for this audience (6.3). Recommendation: **keep plaintext as the default and add an optional encrypted-vault mode** for privileged matters, clearly documented. This modifies a core selling point; own the change rather than hoping no one asks.

**Fork C: "Removed from the data path" versus the provider reality.** The honest claim is narrower than the current one (4.2, 6.5). Recommendation: **tell the whole truth, add the egress indicator, and make Ollama the first-class "nothing leaves" path.** This may soften a marketing line. For this audience, the honesty is the differentiator, and the alternative is being caught overclaiming by the exact people who read fine print.

**Fork D: A one-person vendor versus what firms require.** A sole proprietorship with a $100 liability cap and no SOC 2 or DPA cannot clear firm diligence (6.9). Recommendation: **if Fork A stays solo, this is acceptable and should be stated plainly to buyers; if firms are the destination, the company must mature** (entity, assurance, support commitments, SLA). Either way, stop the documentation from contradicting itself (6.10); that is cheap and it is bleeding credibility now.

**Fork E: Local-only and no-collaboration identity versus how lawyers actually work.** Lawyers work across devices and in teams (6.7). The current stance forces sync workarounds that reintroduce the very third-party exposure the product rejects. Recommendation: **give the team a deliberate, scoped answer** (a secure review-package export, the Practice tier story made real, and a documented "if you sync, here is the risk and how to reduce it" posture), and decide consciously whether real collaboration is a future product rather than treating "no" as permanent by inertia.

---

## 9. Recommendations, prioritized by real-world impact

Tiers are by impact and urgency. Effort is noted (S = small, M = medium, L = large) so you can sequence, not so you can skip. Source tags show how well-supported each is.

### P0: do before any real-attorney launch
- **R1. Tell the truth about data, visibly. (S1, S2, S4. Effort M.)** One plain-English, client-shareable explainer of where files live, what is encrypted, what the AI provider sees and never sees, and how to opt out of training, plus the egress indicator at send time and the synced-folder banner. Fixes the severity-4 comprehension failure and the overclaim at once.
- **R2. Rebuild the API-key step for a non-technical professional. (S2, S3. Effort S to M.)** Plain "what this is, you pay the provider not us, here is your key in three steps, here is how to turn off training," keep the test button, offer a no-shame "later."
- **R3. Guarantee and foreground citations on every answer over client data. (S2, S4. Effort S as a constraint.)** Never return an uncited answer; make verification one click.
- **R4. Reconcile every public document. (S3, S4. Effort S.)** One canonical pricing, licensing, version, telemetry, and kill-switch story, identical across homepage, FAQ, EULA, roadmap, changelog, download page, and repository. Cheap, and it is actively costing trust today.

### P1: high priority, near-term
- **R5. Lead the story with email search, and publish its security model. (S1, S2, S4. Effort M.)** Make "find anything you have ever emailed, privately" the hero; document mailbox auth, encryption, attachments, and indexing so attorneys can trust it with real mail.
- **R6. Default to the rendered view, surface export, and harden Word/PDF fidelity. (S2, S3, S4. Effort M.)** Readable document by default, a clearly labeled Export, and real fidelity for legal formatting (tables, numbering, redlines).
- **R7. Add an optional encrypted-vault mode. (S3, S4. Effort M to L.)** Application-level AES-256 with a master password, default off to preserve plaintext portability, on for privileged matters. Resolves Fork B in product form.
- **R8. Stand up proof and a lightweight trust packet. (S1, S4. Effort M, slow to mature so start now.)** Named attorney advisors and testimonials, a CLE, bar presence, plus a one-page security overview, data-flow diagram, and retention map.
- **R9. Cost predictability. (S1, S4. Effort S.)** Monthly forecast and an optional spend cap or alert.
- **R10. Audit log: protective framing now, evidence-grade later. (S2, S3, S4. Effort S now.)** A one-line protective header immediately; hashing and export manifests if Fork A moves toward litigation-grade use.

### P2: important, sequenced after the above
- **R11. Privilege and work-product handling for litigators. (S3. Effort M.)** Tag files or blocks as privileged, segregate prompts from outputs, scrub metadata on export, and consider automated privilege-log generation. Directly addresses the discoverable-ESI exposure (6.2) and serves her "weekends" pain.
- **R12. The document contradiction-finder as the next wedge. (S1, S3, S4. Effort M to L.)** Deposition and discovery contradiction-spotting, cited, framed as "a tireless first-year associate," not an oracle. Her single biggest pain, and the workflow all sources rate most credible.
- **R13. MCP and plugin guardrails. (S3, S4. Effort M.)** Visible warnings, signing, allowlists, logging, and a privileged-matter mode that disables network extensions.
- **R14. Local OCR for scanned filings. (S3. Effort M.)** So image-only PDFs can be analyzed without external tools.
- **R15. Broaden the (accurate) regulatory narrative. (S3. Effort S.)** Add the duty of technological competence and state AI statutes (Utah) to the ABA 512 / Heppner story, all framed precisely, never as "we make you compliant."
- **R16. A safe real-matter trial path. (S1, S4. Effort M.)** Guided pilot on one real low-stakes matter, mirroring S4's onboarding timeline (non-final matters first).

### Strategic bets (only if Fork A points at firms)
- **B1. Practice-management and DMS handoff** (Clio, NetDocuments, iManage): connectors or a clean export package. (S3, S4. Effort L.)
- **B2. A real collaboration or secure review-package layer** beyond separate local installs. (S3, S4. Effort L.)
- **B3. Enterprise assurance**: SOC 2 or equivalent, DPA, SLA, and company maturation. (S4. Effort L, and as much legal/organizational as technical.)
- **B4. Evidence-grade chain of custody**: hashing, immutable logs, legal hold, manifests, structured matter metadata. (S3, S4. Effort L.)

These four are deliberately separated because they are the "become a firm platform" investments. They are real needs the evidence documents. Whether they are *your* needs depends entirely on Fork A, which is why they are bets, not backlog.

---

## 10. Evidence and triangulation matrix

| Finding | S1 | S2 | S3 | S4 | Confidence |
|---|:--:|:--:|:--:|:--:|---|
| Email search is the strongest wedge | ✓ | ✓ | ✓ | ✓ | High |
| Local-first/BYOK is the defining strength | ✓ | ✓ | ✓ | ✓ | High |
| "Nothing leaves" overclaims (provider still sees prompts) | ✓ | ✓ | ✓ | ✓ | High |
| User cannot articulate where data goes | ✓ | ✓ | | ✓ | High |
| Citations are mandatory for lawyer trust | ✓ | ✓ | | ✓ | High |
| Markdown to Word/DMS friction | ✓ | ✓ | ✓ | ✓ | High |
| API-key step is a drop-off | | ✓ | ✓(opt-out) | ✓ | High |
| Plaintext-at-rest is a confidentiality gap | | | ✓ | ✓ | Med-High |
| Saved chats = discoverable ESI / work product | | | ✓ | (✓) | Med (1 strong source) |
| MCP/plugin exfiltration risk | | | ✓ | ✓ | Med-High |
| No proof / testimonials | ✓ | ✓ | ✓ | ✓ | High |
| Documentation/governance inconsistency | | | ✓ | ✓ | High |
| Enterprise assurance gap (SOC2/DPA/SLA) | | | (✓) | ✓ | Med-High |
| Collaboration/team gap | ✓ | | ✓ | ✓ | High |
| Integration depth gap (PM/DMS/e-discovery) | | | ✓ | ✓ | High |
| Regulatory breadth beyond ABA 512/Heppner | | | ✓ | (✓) | Med |
| Cost predictability concern | ✓ | ✓ | | ✓ | Med-High |

A check in parentheses means partial or indirect support. Single-strong-source findings (notably discoverable-ESI/work-product, from S3) are the ones to confirm first in Pass B.

---

## 11. What to validate in Pass B (real participants, on release)

Run the same [screener](../instruments/screener.md), [discussion guide](../instruments/discussion-guide.md), and [usability protocol](../instruments/usability-test-protocol.md) (now updated with probes for the new dimensions) against the live build, with 5 to 7 attorneys across litigation and transactional, solo and small firm:
1. Does the email wedge land as hard for real attorneys, including transactional?
2. Replicate the data-location comprehension failure; it is the load-bearing finding behind R1.
3. Confirm the API-key drop-off, and test whether the rebuilt flow fixes it.
4. Probe the e-discovery / work-product / discoverable-chats concern, which rests on a single strong source (S3).
5. Test reaction to plaintext-at-rest once understood, and demand for an encrypted vault.
6. Surface the firm-versus-solo question directly: would they adopt firm-wide, and what would a risk committee require? This informs Fork A.
7. Test the repositioned "email search" message against the current "AI workspace" message.
8. Re-verify every tactical UI finding against the shipped binary.

Strategic findings (lead with email, tell the truth about data, prove it with peers, decide the customer) are robust to UI changes. Tactical findings should be re-checked on screen.

---

## 12. Appendix: artifacts
- Personas: [participant](../personas/attorney-persona.md), [facilitator](../personas/researcher-persona.md)
- Instruments: [research plan](../instruments/research-plan.md), [screener](../instruments/screener.md), [discussion guide](../instruments/discussion-guide.md), [usability test protocol](../instruments/usability-test-protocol.md)
- Transcripts: [interview](../transcripts/interview-transcript.md), [usability test](../transcripts/usability-test-transcript.md)
- Deep-research inputs: [S3](<../deep-research-reports/Attorney UX Review of Keepance.md>), [S4](<../deep-research-reports/ChatGPT deep research attorney UX report Keepance.md>)
