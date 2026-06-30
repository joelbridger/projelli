# Advisor Prep Hero — Knowledge Gathering Document

**Prepared by:** Jameson Daines, founder  
**For:** [Advisor name] — confidential, for professional review and annotation  
**Date:** 2026-05-28  
**Format:** Please annotate inline or respond by section. Every question is numbered for reference.

---

## What this document is

I am building a commercial software product called Advisor Prep Hero. It is a local-first AI workspace designed specifically for attorneys, CPAs, enrolled agents, and independent consultants who cannot or should not transmit client data to cloud-based AI services.

This document exists because I need expert input across legal ethics, tax regulation, and professional practice before I can responsibly market or ship several components of this product. My current knowledge in these domains comes from public sources, primary texts, and secondary analysis. I need a practitioner with direct experience to pressure-test my assumptions, correct my errors, and fill the gaps I do not know exist.

There is no time pressure on your response. I would rather have accurate answers in three weeks than fast answers today.

---

## Product overview

### What Advisor Prep Hero does

Advisor Prep Hero is a desktop application (Windows and macOS) that gives professionals an AI workspace where all data remains on their local machine. The user connects their own AI provider account — Anthropic (Claude), OpenAI (GPT-4o), or Google (Gemini) — and all AI requests are sent directly from the user's computer to the provider's API. Advisor Prep Hero's servers never receive, process, store, or log any user content, client data, or AI conversation output.

Every AI conversation produces persistent Markdown files saved to a folder the user controls on their own hard drive. The application includes a document editor, full-text search across the local file library, PDF ingestion and querying, and a workflow template engine that guides users through structured multi-step document production tasks.

### Technical architecture relevant to professional liability analysis

The following architecture details are material to several of the questions below:

**Data flow on an AI request:**
1. User types a prompt or runs a workflow step inside the desktop application
2. The application reads any referenced local files (e.g., a client document the user has placed in their workspace folder)
3. The application constructs an API request containing the prompt and any file context
4. That request is transmitted via HTTPS directly from the user's machine to the selected AI provider's API endpoint (e.g., `api.anthropic.com`)
5. The provider returns a response; the application writes it to a local Markdown file
6. No copy of the request, the response, or the file context passes through any server owned or operated by Advisor Prep Hero

**What Advisor Prep Hero's servers do and do not receive:**
- Advisor Prep Hero operates a license validation service (`licenses.keepance.com`) that receives only a license key and an anonymous machine identifier on each application launch. It receives no content, no prompts, no filenames, and no user data of any kind.
- Advisor Prep Hero does not operate any AI proxy, relay, or caching layer.

**API key handling:**
- The user's AI provider API key is stored in the operating system's native credential store (Windows Credential Manager / macOS Keychain). It is never written to disk in plaintext, never transmitted to Advisor Prep Hero, and never logged.

**Local audit log:**
- The application maintains an append-only local audit log of all AI actions (prompt sent, model used, output file written, timestamp). This log is stored in the user's workspace folder and is never transmitted anywhere.

**No cloud sync:**
- Advisor Prep Hero has no cloud sync, no remote backup, no collaboration features. All data is local by design and by architecture.

### Profession-specific template packs

Advisor Prep Hero ships with three profession-specific workflow template packs. Each template is a structured multi-step workflow that interviews the user (collects relevant matter details), then generates a professional document using the AI. All generated documents are saved locally and are explicitly marked as drafts requiring attorney or preparer review before any professional use.

**Legal Practice pack (7 templates — draft, pending attorney review):**
1. Deposition Contradiction Finder
2. Evidence Gap Analyzer
3. Case Timeline Builder
4. Privilege Log Drafter
5. Discovery Document Triage
6. Patent Disclosure Draft
7. Client Intake Synthesizer

**Tax Practice pack (7 templates — draft, pending CPA/EA review):**
1. Engagement Letter Builder
2. 1040 Pre-Review Checklist
3. Section 7216 Consent Form
4. Tax Research Memo
5. Client Document Inventory
6. Audit Defense File Builder
7. Quarterly Estimate Reminder

**Consulting Practice pack (5 templates):**
1. Client Discovery Synthesizer
2. Confidential Research Memo
3. Stakeholder Map Generator
4. NDA-Safe Slide Outliner
5. Engagement Retrospective Builder

### Intended users

- Solo and small-firm attorneys (general practice, litigation, family, estate, patent/IP)
- Tax preparers, CPAs, and Enrolled Agents in solo or small-firm practice
- Independent management/strategy consultants working under NDA

### Pricing

- **Personal** — $49 one-time (AI workspace only, no profession pack)
- **Professional** — $129 one-time (AI workspace + one profession pack)
- **Practice** — $399 one-time (up to 5 seats, all packs)

---

## Part I — Legal ethics and professional responsibility

### I-A. Competence and technology (ABA Model Rule 1.1)

The 2012 amendment to Comment 8 of Model Rule 1.1 established that competent representation includes keeping "abreast of changes in the law and its practice, including the benefits and risks associated with relevant technology." ABA Formal Opinion 512 (July 2024) extended this to AI tools specifically.

**Q1.** What does technological competence under Rule 1.1 affirmatively require of a solo practitioner who uses an AI tool for client work? Is the standard currently understood as: (a) understanding what the tool does at a high level, (b) being able to evaluate the output critically, (c) understanding how the tool processes data and where it goes, or some combination?

**Q2.** Does competence require affirmative disclosure to a client when AI tools assist in preparing a work product? If so, at what level of specificity — that AI was used generally, that a specific provider was used, the data architecture of the tool? Is this currently governed by ethics opinions, state bar guidance, or individual engagement letter practice?

**Q3.** If a solo practitioner uses Advisor Prep Hero (with the architecture described above), and the AI output is reviewed and substantially edited by the attorney before filing or sending, does that constitute competent use under the current state of opinion? What distinguishes competent from incompetent AI use in the drafting context?

---

### I-B. Confidentiality (ABA Model Rule 1.6)

Rule 1.6(c) requires lawyers to "make reasonable efforts to prevent the inadvertent or unauthorized disclosure of, or unauthorized access to, information relating to the representation of a client."

**Q4.** The routing of client information through a cloud AI provider's API — even one with strong contractual data confidentiality provisions — has been characterized by some as a potential Rule 1.6 issue. In your view, does transmitting client information to Anthropic, OpenAI, or Google via their API constitute "disclosure" for purposes of Rule 1.6, or does it fall within the "reasonable efforts" safe harbor given the contractual protections those providers offer?

**Q5.** Where does the local-first architecture described above land on the Rule 1.6 analysis, in your view? The client data never leaves the user's machine to any Advisor Prep Hero server — it goes only from the user's machine to the AI provider's API endpoint. Does this create a meaningfully different 1.6 posture than a cloud-based tool that routes through an intermediate server?

**Q6.** Which state bars have issued guidance on AI and confidentiality that is stricter than the ABA model? California, New York, Texas, and Florida all have large attorney populations we are trying to reach. Are there 1.6-equivalent provisions in any of those states' rules that would affect the analysis differently?

**Q7.** ABA Formal Opinion 512 states that attorneys should "review the provider's terms of service and privacy policies." We plan to include guidance in our documentation directing users to review their AI provider's terms before use with client data. Does this adequately discharge the due diligence obligation, or is there more specific review the opinion requires?

---

### I-C. Attorney-client privilege and work product doctrine

**Q8.** The voluntary disclosure rule holds that attorney-client privilege may be waived by disclosing privileged communications to third parties outside the attorney-client relationship. The question in the AI context is whether the AI provider is a "third party" for this purpose, or whether it functions analogously to a clerical service or technology vendor whose involvement does not destroy privilege.

What is the current state of authority on whether transmitting privileged communications to a cloud AI provider's API constitutes a waiver-triggering disclosure? Is there established case law, ethics opinions, or privilege treatise analysis you would rely on for this proposition?

**Q9.** Does the answer to Q8 differ depending on (a) whether the AI provider has contractual data confidentiality protections, (b) whether the data is processed on the user's machine vs. transmitted to the provider's servers, or (c) whether the attorney takes affirmative steps to exclude privileged content from AI prompts?

**Q10.** ~~We have seen a reference to a case styled *U.S. v. Heppner*, SDNY, February 2026, reportedly holding that a party's use of a consumer AI tool with documents at issue in litigation constituted a waiver of privilege over those documents. We have not been able to verify this citation independently.~~ **[RESOLVED — VERIFIED]** The case is confirmed real: *United States v. Heppner*, No. 1:25-cr-00503-JSR (S.D.N.Y. Feb. 17, 2026), Dkt. No. 27 (Rakoff, J.). Consumer Claude use without attorney direction — no privilege protection. Favorable dicta for counsel-directed, confidentiality-preserving workflows. We are now using this citation in marketing copy with appropriate Kovel-theory framing. Remaining open question: have a bar-active attorney confirm that our specific marketing language accurately characterizes the dicta vs. the holding.

**Q11.** How does the work product doctrine apply in this context? Work product protection is generally broader than privilege (it protects attorney mental impressions, not just communications). Does transmitting attorney work product to a cloud AI API carry the same waiver risk as transmitting privileged communications, or does the doctrine apply differently?

**Q12.** If an attorney uses Advisor Prep Hero to draft a document — and the AI conversation log is stored locally on the attorney's machine as part of Advisor Prep Hero's audit trail — is that log discoverable in litigation? Does the answer depend on whether the log contains privileged communications, work product, or merely procedural metadata (timestamp, model used, output filename)?

---

### I-D. Supervision of non-lawyer assistance (ABA Model Rules 5.1, 5.3)

**Q13.** Rule 5.3 requires attorneys to take "reasonable managerial authority" over non-lawyers whose work the attorney supervises, and Rule 5.1 extends this to supervising lawyers. Some ethics commentary has analogized AI tools to non-lawyer assistants for purposes of these rules — meaning the attorney has a supervisory obligation over AI output similar to supervising a paralegal's work.

Is this analogy currently endorsed in any formal bar opinion or ethics authority you are aware of? What does that supervisory obligation require in practice — a full independent re-draft, a substantive review of each assertion, or something else?

**Q14.** If an attorney uses Advisor Prep Hero's Deposition Contradiction Finder template, which ingests deposition transcript excerpts and identifies potential inconsistencies, and then relies on the output without independently cross-checking each flagged passage, would that constitute a failure of supervisory duty under the Rule 5.3 analogy? What standard would a disciplinary panel apply?

---

### I-E. Safekeeping of client property (ABA Model Rule 1.15)

**Q15.** Rule 1.15 governs an attorney's obligation to safeguard client property in their possession. Client documents provided to an attorney during representation are generally considered property subject to 1.15.

If a client provides an attorney with documents, and the attorney ingests those documents into Advisor Prep Hero for AI analysis, does that trigger any safekeeping obligation beyond the physical/digital security of the originals? Does the creation of an AI-generated analysis of those documents (which is stored locally) affect the Rule 1.15 analysis?

---

### I-F. Malpractice, insurance, and bar discipline

**Q16.** Do you know whether any professional liability carriers for attorneys (ALPS, Lawyers Mutual, etc.) have issued underwriting guidance, policy exclusions, or required disclosures related to AI tool use? Would a solo attorney be obligated to disclose AI tool adoption to their carrier?

**Q17.** Has any state bar disciplinary body issued a formal opinion or taken a disciplinary action arising from an attorney's use of AI tools in client matters? (The Mata v. Avianca hallucination sanctions are widely cited, but that is a sanctions issue, not a disciplinary proceeding.) Are there any bar discipline cases we should be aware of?

**Q18.** If an attorney uses Advisor Prep Hero to produce a document that contains a factual error (AI hallucination), reviews it without catching the error, and submits it in a client matter where it causes harm — what is the malpractice exposure? How does the AI-assisted origin of the error affect the standard of care analysis?

---

### I-G. Patent-specific issues (EU absolute-novelty rule)

**Q19.** Patent applications are subject to the absolute-novelty requirement in most jurisdictions: any public disclosure of an invention prior to filing destroys novelty and bars patentability. The question is whether transmitting a description of an unpatented invention to a cloud AI provider's API constitutes a "disclosure" that could trigger the absolute-novelty bar.

Our current understanding: transmitting to a cloud provider's API is likely not a "public" disclosure in jurisdictions that define disclosure as disclosure to the general public, because the transmission is subject to contractual confidentiality. However, there may be jurisdictions where any third-party transmission — even under NDA or equivalent contractual protection — is treated as a potentially novelty-defeating disclosure.

Is our current understanding correct? Are there specific jurisdictions (EPO member states, Japan, Korea, China) where the answer differs? Is the risk real enough that we should be framing it as "be careful" rather than "safe with cloud AI under contract"?

**Q20.** Our Patent Disclosure Draft template is designed for use after a formal attorney-client relationship is established and before any provisional application is filed. The template collects invention details and generates a structured disclosure document for the attorney's file. Does this workflow carry any distinct risks relative to the absolute-novelty analysis — specifically, is there a problem with using AI to process an invention disclosure that has not yet been filed?

---

### I-H. Discovery implications

**Q21.** Advisor Prep Hero maintains a local audit log of all AI operations: timestamp, model used, prompt summary (not the full prompt), and output filename. This log is stored in the user's workspace folder on their local machine.

If a client's matter goes to litigation and discovery is served on the attorney, is this audit log discoverable? Does the answer depend on whether the log is considered a "document" within the scope of FRCP Rule 34 (or state equivalents), or whether it is protected as attorney work product?

**Q22.** If the full content of an AI conversation (prompt + response) is stored locally as part of the workflow output, is that full conversation log discoverable in the same matter? Does privilege apply to the attorney's prompts if those prompts reveal litigation strategy?

---

## Part II — Tax and accounting regulation

### II-A. IRC §7216 — scope and application

IRC §7216 prohibits a "tax return preparer" from "disclos[ing] any information furnished to him for, or in connection with, the preparation of any such return" without consent. Violation is a criminal misdemeanor: up to $1,000 fine and one year imprisonment.

**Q23.** The threshold question for our product is whether a tax preparer who uses a local-first AI tool — where client return data is transmitted from the preparer's machine to an AI provider's API endpoint but never to any Advisor Prep Hero server — is "disclosing" return information within the meaning of §7216.

Our current framing: we describe the risk as "an open question worth thinking through" rather than "a confirmed statutory violation," because we are not aware of any IRS ruling, PLR, or enforcement action applying §7216 to AI API calls. Is this framing accurate? Is there authority that more definitively resolves whether an API call to Anthropic or OpenAI constitutes "disclosure" under §7216?

**Q24.** The §7216 consent requirement specifies that consent must: (a) be in writing; (b) identify the purpose of the disclosure or use; (c) identify the recipient of the disclosure; (d) be signed and dated. Treasury Regulation 301.7216-3 governs the form of consent.

Our Section 7216 Consent Form template collects client acknowledgment of AI tool use and is designed to satisfy these requirements. The specific problem is identifying "the recipient" — the AI provider (Anthropic, OpenAI, or Google) — when the preparer does not know at consent time which provider they will use, or may use multiple.

How should a §7216 consent form handle the multi-provider uncertainty? Should the form identify all possible providers by name, or is a description of the category ("an AI language model provider whose API receives return information for processing") sufficient under Treasury Regulation 301.7216-3?

**Q25.** §7216 uses the phrase "furnished to him for, or in connection with, the preparation of any such return." Does this scope extend to: (a) documents the client provides that are not technically tax return data (e.g., a lease agreement provided to analyze deductibility); (b) preparer-generated analysis that incorporates return data; (c) information gathered during a client interview that has not yet been committed to a return?

**Q26.** We currently frame the §7216 risk in our marketing as raising the question of whether cloud AI use triggers §7216 without consent, and we describe the penalty as a "federal criminal misdemeanor." Is the criminal misdemeanor characterization technically accurate as applied to a preparer who uses a cloud AI tool without obtaining consent? Or is the more realistic enforcement path a civil penalty and license action rather than criminal prosecution?

**Q27.** Does the §7216 analysis differ between a tax attorney (who is also a licensed attorney subject to privilege rules) and a non-attorney CPA or EA? Specifically, does attorney-client privilege over tax return information affect the §7216 disclosure analysis for attorney-preparers?

---

### II-B. IRS Circular 230

Circular 230 governs the practice of attorneys, CPAs, enrolled agents, and others before the IRS.

**Q28.** Are there any provisions of Circular 230 that would be directly implicated by an EA or CPA using an AI tool to prepare tax returns, draft tax advice memos, or conduct tax research? Specifically: (a) §10.22 (due diligence); (b) §10.34 (standards for positions on returns and advising clients); (c) §§10.35 (Competence), 10.36 (Procedures to ensure compliance), and 10.37 (Written advice) — note: the "covered opinions" regime under the prior §10.35 was repealed in 2014 by T.D. 9668; the current provisions govern competence, firm compliance procedures, and written advice standards respectively.

**Q29.** If a tax research memo is drafted with AI assistance (using our Tax Research Memo template), reviewed by the preparer, and then provided to a client — does it constitute "written advice" under Circular 230 §10.37, and if so, what standards apply to its content and disclosures?

---

### II-C. AICPA, state boards, and NAEA

**Q30.** Has the AICPA published any formal position, practice aid, or official guidance on CPA use of AI tools with client data? We are aware the AICPA has published general AI resources, but we are specifically looking for any ethics-level guidance from the AICPA Code of Professional Conduct or its interpretations.

**Q31.** Which state CPA licensing boards have issued guidance specifically addressing AI use with client data? Are any state rules on data handling for CPAs stricter than the AICPA Code? California and New York are priorities.

**Q32.** Has the NAEA (National Association of Enrolled Agents) published any position on AI use for enrolled agents? Are there NAEA member conduct standards that would be relevant?

**Q33.** The FTC Safeguards Rule (16 CFR Part 314, as amended effective June 2023) requires financial institutions — defined broadly to include tax preparers — to implement a written information security program. Does this rule apply to solo CPAs and EAs who do not otherwise meet the definition of a financial institution? What does compliance require in practice for a solo practitioner?

---

### II-D. Tax practice workflow and template accuracy

**Q34.** Our 7 tax templates are designed around what we believe to be the high-value workflows in solo/small-firm tax preparation and advisory practice. Please assess whether these reflect the actual moments where AI assistance would be most valuable, most used, and where the output quality matters most professionally:

1. **Engagement Letter Builder** — generates a draft engagement letter from client and scope details
2. **1040 Pre-Review Checklist** — generates a filing checklist organized by section (income, deductions, credits, carryovers, signatures, state) with elevated-scrutiny flags
3. **Section 7216 Consent Form** — generates a client consent form for AI tool use with their return data
4. **Tax Research Memo** — structures a tax research analysis with Issue/Facts/Analysis/Conclusion/Authorities format
5. **Client Document Inventory** — generates a client-facing document request list and an internal tracker
6. **Audit Defense File Builder** — generates an issue-by-issue defense memo with legal basis, supporting documents, strategy, and open items
7. **Quarterly Estimate Reminder** — generates a client-ready quarterly payment reminder with safe harbor calculation

Which of these would a working CPA or EA actually use? Which are designed around workflows that do not reflect how tax practice actually operates? What is missing?

**Q35.** The Tax Research Memo template uses the IRAC structure (Issue/Rule/Application/Conclusion, which we label as Issue/Facts/Analysis/Conclusion/Authorities). Is this the format a CPA or EA would produce for an internal research memo, or is there a different standard format in tax practice? Is there a specific authorities-citation format (e.g., citing Code sections, Reg. sections, Rev. Procs., PLRs, and cases) that the template should enforce?

**Q36.** The Audit Defense File Builder template generates a memo with sections for each issue under audit, including position summary, legal basis, supporting documentation, strategy, and open items. Is this the right structure for an audit defense file? What does a competent audit defense file actually look like in practice?

---

## Part III — Legal Practice template accuracy

**Q37.** Deposition Contradiction Finder: The template ingests deposition transcript excerpts and produces a topic-organized analysis of internal inconsistencies, contradictions with prior testimony, and suggested follow-up questions. Is this a workflow that litigation attorneys actually run — and if so, where in the litigation timeline does it occur? What format would the output need to be in to be usable in practice?

**Q38.** Evidence Gap Analyzer: The template is designed to analyze a set of described evidence against the elements of a stated legal theory and identify gaps. Is "analyzing evidence against legal elements" a workflow that solo and small-firm litigators would actually value from an AI tool? What are the practical limitations of AI-generated evidence analysis that we should communicate clearly in the template's output?

**Q39.** Privilege Log Drafter: The template collects document metadata (author, recipient, date, description, privilege basis claimed) and generates a formatted privilege log. Federal courts and many state courts have local rules specifying the required format and content of privilege logs. Is our template's output designed for a specific format, or is it generic enough to be adapted? What are the most common privilege log format requirements we should be aware of?

**Q40.** Discovery Document Triage: The template helps an attorney prioritize a document production by assessing documents against the stated case theory. Is this a genuine workflow, or does the volume of documents in most discovery contexts (often thousands or millions) make AI-assisted triage at the individual-document level impractical for a solo attorney? What does realistic small-firm discovery triage look like?

**Q41.** Client Intake Synthesizer: The template collects initial client consultation information and generates a structured intake brief (matter summary, conflict check data, preliminary scope). Is conflict check data the right output to generate with AI, given the accuracy requirements and malpractice implications of a failed conflict check? Should we include a disclaimer stronger than our current "draft — review before use" notation?

**Q42.** Patent Disclosure Draft: The template collects invention details and generates a structured disclosure document. A patent disclosure document is not the same as a patent application — it is a pre-filing record of the invention for the attorney's file and for inventor-to-attorney transmission. Is this a useful document in the patent prosecution workflow? What relationship should the template output have to the actual patent application?

---

## Part IV — Market, pricing, and product design

### IV-A. Pricing and purchasing behavior

**Q43.** At $129 one-time for the Professional tier (application + one profession pack), is this pricing credible and attractive to a solo attorney in general practice? At what price does it become "obviously worth trying" versus "requires justification"?

**Q44.** What does the software purchasing decision look like at a solo or two-person law firm or CPA practice? Does the attorney or CPA make the decision individually, or does it go through a bookkeeper, office manager, or practice management platform vendor? Is a one-time payment model (as opposed to monthly SaaS) a meaningful benefit or a risk signal?

**Q45.** What objections would a sophisticated solo practitioner raise upon first hearing about Advisor Prep Hero? We anticipate: (a) "I don't trust AI output for professional work"; (b) "How is this different from ChatGPT?"; (c) "If I'm the one sending data to Anthropic's API, doesn't Anthropic still have my data?"; (d) "What happens if the AI hallucinates?". Are there objections we are not anticipating?

**Q46.** What would cause a solo attorney or CPA to recommend Advisor Prep Hero to a colleague? What would need to be true about their experience with the product for them to mention it unprompted?

---

### IV-B. Product design questions requiring professional input

**Q47.** Advisor Prep Hero's local audit log records AI operations (timestamp, model, output file) but does not capture the full content of prompts or AI responses (those are captured in the workspace files themselves). For professional liability purposes, what should the audit log capture? Is there a retention period for AI-assisted work records that parallels the existing record-keeping obligations for attorney work product (typically five to seven years) or tax preparer records (three years — likely under Treas. Reg. §1.6107-1, which covers preparer copy/retention requirements; note that §1.6060-1 covers preparer reporting lists, not copy/retention — flag for tax advisor confirmation)?

**Q48.** Should we build a client consent workflow directly into the application — a formal step that generates and records a client's consent to AI tool use before any matter is opened? Or is this an engagement-letter-level matter that is better handled outside the tool?

**Q49.** Our current workspace design does not enforce isolation between client matters — an attorney could theoretically open multiple client files in the same workspace and run a workflow that ingests both. Should we architect per-matter workspace isolation as a default, or is the attorney's judgment about what goes into each prompt sufficient? Is matter isolation a professional responsibility requirement, a best practice, or an aspirational design choice?

**Q50.** If an attorney or CPA uses Advisor Prep Hero to generate a document, should the output document carry metadata or a visible disclosure indicating it was generated with AI assistance? Is there a professional standard emerging for such disclosure — either in bar guidance, court rules, or practice norms?

---

### IV-C. Channels and credibility

**Q51.** We are planning to pitch a guest column to Lawyerist.com (Bob Ambrogi's audience), submit a talk abstract to ABA TECHSHOW, and post in r/LawFirm. On the tax side, we plan to pitch to NAEA's Tax Pro Today newsletter and AICPA channels. Are these the right channels to reach the solo and small-firm practitioners who are our ICP, or are there higher-signal communities we are missing?

**Q52.** ABA Formal Opinion 512 is our primary legal citation in all marketing materials. Is there anything about the way we are characterizing Opinion 512 that a practicing attorney would immediately recognize as inaccurate or overstated? Our characterization: "ABA Formal Opinion 512 (July 2024) establishes that attorneys using AI tools for client work must understand where their data goes and take competent precautions — an obligation that local-first architecture is specifically designed to satisfy."

**Q53.** What would make a 30-year practitioner trust a software product for use with client data? Not "what would make them interested" — what specific signals would satisfy them that the product is professionally responsible to use?

---

## Appendix — Citation and document status

| Citation / Document | Status |
|---|---|
| ABA Formal Opinion 512 (July 2024) | **Confirmed real.** We have referenced the ABA's summary. We have not read the full opinion text. |
| IRC §7216 | **Confirmed real.** Full statutory text reviewed. |
| Treasury Regulation 301.7216-3 | **Confirmed real.** Review of consent requirements in progress. |
| IRS Circular 230 | **Confirmed real.** §§10.22, 10.34, 10.35-10.37 reviewed. |
| FTC Safeguards Rule (16 CFR Part 314) | **Confirmed real.** June 2023 amendments reviewed in summary. |
| ABA Model Rules 1.1, 1.6, 1.15, 5.1, 5.3 | **Confirmed real.** Cited from the current ABA Model Rules text. |
| EU absolute-novelty rule | **Confirmed real as a doctrine.** Specific citation to EPC Art. 54 confirmed. Jurisdiction-by-jurisdiction nuance not fully researched. |
| *United States v. Heppner*, No. 1:25-cr-00503-JSR (S.D.N.Y. Feb. 17, 2026), Dkt. No. 27 (Rakoff, J.) | **VERIFIED.** Confirmed real. Consumer Claude use by a non-lawyer without attorney direction — no privilege protection. Favorable dicta for counsel-directed, confidentiality-preserving use (Kovel theory). Safe for use in marketing copy with accurate framing. |

---

*This document is confidential and intended solely for professional review. Nothing in it constitutes legal advice, and no attorney-client or accountant-client relationship is created by its transmission.*
