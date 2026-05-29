# Research Action Plan — 2026-05-28

> **Source:** Three AI research reports ingested from `docs/strategy/`:
> - `ChatGPT Deep Research on Keepance Knowledge Questions.md`
> - `Claude - Keepance_Research_Response.md`
> - `Gemini Deep Research - Pressure-Testing Keepance Product Assumptions.md`
>
> **Purpose:** Translate research findings into concrete product/copy/template changes. Separate
> what can be done now from what requires a licensed professional to confirm.

---

## Part 1: Product update plan

Organized by area, ordered by urgency. Everything in this section is actionable without an advisor.

---

### A. Immediate template redesigns (do before advisor reviews)

#### 1. Client Intake Synthesizer — conflict-check section must be redesigned

**Current:** Template prompt instructs the model to "generate conflict check data" or identify potential conflicts from the intake information.

**Problem:** AI-generated conflict output is malpractice exposure. A false negative (model says no conflict, there is one) leads to disqualification, sanctions, or malpractice. This is the highest-risk feature in the entire legal pack.

**Fix:** Redesign the conflict-check section to generate structured *search parameters*, not results. The output should be:
- A list of party names, aliases, related entities, and relationships to run against the firm's actual conflicts database
- Boolean search strings formatted for common conflicts systems (Clio, Lawmatics, manual index)
- A "run this search before proceeding" instruction block
- Explicit warning: "Do not rely on this output as a conflict determination. Run these search terms against your conflicts database and document the results."

**File:** `src/modules/workflow/templates/legal/ClientIntakeSynthesizer.ts`
**Priority:** Before any advisor shows the template to a colleague.

---

#### 2. §7216 Consent Template — verbatim Treasury language required

**Current:** Template generates a consent form based on general principles.

**Problem:** Rev. Proc. 2013-14 §5.04 specifies exact mandatory language for §7216 consents. Forms that don't use this verbatim text are legally ineffective. The current template almost certainly doesn't reproduce this language.

**Fix:**
- Embed the Rev. Proc. 2013-14 §5.04 required disclosure text verbatim in the template prompt
- Add a 12-point type minimum instruction (required by §301.7216-3(b)(3)(i))
- Add separate consent requirement for each type of use (AI processing = one consent, sharing with other parties = separate consent)
- Add explicit instruction: tax preparer must obtain signed consent *before* processing begins, not after

**File:** `src/modules/workflow/templates/tax/Section7216ConsentTemplate.ts`
**Note:** The exact Rev. Proc. language will be confirmed by a tax advisor, but the template structure must be set up to receive it.

---

#### 3. Privilege Log Drafter — output must match litigation standards

**Current:** Template generates prose-style privilege log entries.

**Problem:** Courts and opposing counsel expect structured columns. A prose privilege log will require manual reformatting before production, creating rework and introducing errors.

**Fix:** Restructure output to emit a tab-delimited or CSV-formatted table with standard columns:
- Document number / Bates range
- Date
- Author(s)
- Recipient(s) (including CC/BCC)
- Document type
- Description (non-revealing, 1-2 sentences)
- Privilege basis (attorney-client / work product / both)
- Withheld/Redacted

Add a note that work-product entries require separate treatment if the underlying document is listed but redacted vs. withheld entirely.

**File:** `src/modules/workflow/templates/legal/PrivilegeLogDrafter.ts`

---

#### 4. Audit Defense File Builder — add missing structural elements

**Current:** Template builds a general audit defense file.

**Missing:**
- Statute of limitations status (SOL) and any Form 872 extensions (consent to extend)
- IDR (Information Document Request) cross-reference index — maps each IDR item to the response file location
- Explicit separation of substantiation (factual proof) from legal basis (argument)
- Appeals-track note: if exam team denies a position, document whether it goes to Appeals vs. Tax Court

**Fix:** Add four new output sections to the prompt:
1. SOL/Extension Tracker (open date, original SOL, any 872 extensions, current deadline)
2. IDR Cross-Reference Index (IDR number, date received, response file, status)
3. Substantiation Package (documents only — no argument)
4. Legal Position Memorandum (argument only — cites Code, Regs, cases)
5. Appeals/Litigation Track Note (one paragraph on posture if exam denies)

**File:** `src/modules/workflow/templates/tax/AuditDefenseFileBuilder.ts`

---

#### 5. Discovery Document Triage — add volume disclaimer

**Current:** No volume limitation mentioned.

**Problem:** AI document review is only viable at small scale (dozens to low hundreds of documents) without proper eDiscovery infrastructure. Attorneys expecting this to replace Relativity/Logikcell on a 50,000-doc production will be disappointed or harmed.

**Fix:** Add a disclaimer block at the top of the template output:
> "This template is designed for small document sets (under ~500 pages). For large productions, use this output as a first-pass triage guide — not a replacement for eDiscovery review platforms. Keepance processes files locally; upload only documents you have authority to analyze."

Also: add a "privilege flag" step that instructs the model to flag any document that may be privileged for human review before any further analysis or production.

**File:** `src/modules/workflow/templates/legal/DiscoveryDocumentTriage.ts`

---

### B. Marketing copy corrections (do before deploying website)

#### 1. Heppner citation — VERIFIED, update status flags

**Status change:** *United States v. Heppner*, No. 1:25-cr-00503-JSR (S.D.N.Y. Feb. 17, 2026) is a real case. The ruling: consumer-grade Claude use by a non-lawyer, without attorney direction, resulted in no privilege protection.

**Action:** Remove `HEPPNER_UNVERIFIED` flags from all files. Replace with proper citation format:
```
United States v. Heppner, No. 1:25-cr-00503-JSR (S.D.N.Y. Feb. 17, 2026), Dkt. No. 27 (Rakoff, J.)
```

**Framing guidance:** The ruling is favorable dicta for counsel-directed, confidentiality-preserving use (Kovel theory). Do not claim it as a holding about what prevents waiver — claim it as evidence of the risk of *unprotected* AI use, which Keepance addresses.

**Suggested marketing language:**
> "A February 2026 SDNY ruling found that a defendant's consumer Claude use, without attorney direction or confidentiality safeguards, did not preserve privilege. Keepance is designed for counsel-directed workflows."

**Files to update:** `docs/strategy/POSITIONING.md`, all three landing pages, all campaign docs that reference Heppner.

---

#### 2. ABA Opinion 512 language — tighten the marketing claim

**Current claim (approximate):** "Local-first architecture is specifically designed to satisfy ABA Formal Opinion 512."

**Problem:** Overclaims. Opinion 512's concern is what happens at the AI *provider's* API — data still leaves the user's machine when they call Anthropic/OpenAI/Google. Local-first removes Keepance from the data path but doesn't remove the provider.

**Fix — suggested replacement:**
> "ABA Formal Opinion 512 (July 2024) requires attorneys to understand where client data goes and to take reasonable precautions. Keepance removes itself from that data path: no Keepance server ever sees your client information. Your API calls go directly from your machine to your AI provider under your account."

This is accurate, defensible, and still strong.

**Files to update:** All three landing pages, `docs/strategy/POSITIONING.md`.

---

#### 3. §7216 criminal vs. civil framing

**Current claim:** "Federal criminal misdemeanor."

**Problem:** Technically accurate but misleading. Criminal prosecution requires knowing or reckless conduct and is vanishingly rare. The realistic enforcement path is civil §6713: $250 per unauthorized disclosure, strict liability, $10,000/year cap. That's what actually happens to practitioners.

**Fix:** Lead with civil §6713 in website copy. Criminal exposure is a reinforcing note, not the headline.

**Suggested marketing language:**
> "IRC §6713 imposes strict-liability civil penalties of $250 per unauthorized disclosure of tax return information — no intent required. For practitioners using cloud AI tools without written client consent, every session is a potential disclosure event."

Then add: "In cases of knowing or reckless disclosure, §7216 makes it a federal criminal misdemeanor."

**Files to update:** Tax landing page, tax campaign docs.

---

#### 4. FTC Safeguards Rule — add as a product hook (currently missing)

The FTC Safeguards Rule (16 CFR Part 314) applies to solo CPAs and EAs. There is no small-practitioner exemption. Every covered financial institution must have a Written Information Security Program (WISP). Keepance's local-first architecture is directly relevant to WISP compliance.

**Add to tax landing page:**
> "The FTC Safeguards Rule requires every tax professional — including solo practitioners — to maintain a Written Information Security Program. Keepance keeps client data off third-party servers, which simplifies your WISP documentation and reduces your breach surface."

**Add to tax campaign docs:** NAEA pitch should reference Safeguards Rule compliance angle.

---

#### 5. Circular 230 parenthetical — update stale reference

**Current:** References to "covered opinions and written advice" under §§10.35-10.37.

**Problem:** The covered opinions regime was repealed in 2014 (T.D. 9668). §10.35 now = Competence, §10.36 = Procedures to ensure compliance, §10.37 = Written advice (substantially different from the old covered opinions standard).

**Fix:** Update any Circular 230 §§10.35-10.37 references to read:
> "Circular 230 §§10.35 (Competence), 10.36 (Procedures), and 10.37 (Written Advice)"

Remove any parenthetical referencing "covered opinions."

**Files to update:** `docs/strategy/POSITIONING.md`, tax landing page, tax campaign docs, `KNOWLEDGE_GATHERING.md`.

---

#### 6. Treas. Reg. citation — fix likely mis-citation

**Current:** `Treas. Reg. §1.6060-1` referenced for preparer copy/retention requirements.

**Problem:** §6060 concerns preparer reporting lists (name/TIN lists). Preparer copy and inspection requirements are at §1.6107-1 (copies of returns for inspection) and §1.6109-2 (PTIN requirements).

**Fix:** Replace `§1.6060-1` with `§§1.6107-1 and 1.6109-2` where the context is copy/retention requirements. Flag for tax advisor confirmation.

---

### C. New templates to build (post-advisor-review, for v2.2 Tax pack expansion)

These came out of the research as genuine practitioner needs not covered by the current 7 templates:

| Template | Description | Priority |
|---|---|---|
| CP-Letter Response Drafter | Structures a response to an IRS CP notice (CP2000, CP575, etc.) — identifies issue, gathers docs, drafts response letter | High |
| S-Corp Reasonable Comp Memo | Generates a reasonable compensation analysis and supporting memo under Rev. Rul. 74-44 / Watson standards | High |
| Schedule C / Hobby Loss Substantiation | Helps preparers build the §183 profit-motive documentation file for Schedule C clients with loss histories | Medium |
| Dependency / EITC Due Diligence Workflow | Structures the Form 8867 due-diligence checklist and supporting documentation for dependency and EITC claims | Medium |

These are tax advisor validation territory — do not build until the CPA/EA advisor reviews the existing pack.

---

### D. New templates to build (for legal pack expansion, v2.1+)

| Template | Description | Priority |
|---|---|---|
| Settlement Authority Memo | Structures a pre-mediation memo on settlement authority, BATNA, and demand/offer ladder | Medium |
| Demand Letter Drafter | Structured demand letter with factual predicate, legal basis, demand, and deadline | Medium |

Requires attorney advisor sign-off before adding.

---

### E. Per-matter workspace isolation — architecture consideration

The research reports flag this as a professional responsibility alignment issue. Under Model Rule 1.6, cross-contamination of context between client matters is a real risk if the AI workspace conflates them.

**Recommended approach:**
- The current workspace/folder structure already supports per-matter isolation (each note/chat is a separate Markdown file)
- Add explicit UI guidance in the First Run Wizard and onboarding copy: "Create one workspace folder per client matter"
- Consider adding a "New Matter" shortcut that creates a dated, client-named folder and opens a blank workspace

This does not require a code redesign — it's a UX and onboarding change.

---

## Part 2: What absolutely needs a real human professional answer

This list is intentionally short. Everything on it cannot be resolved by AI research, verified against public sources, or safely assumed from statute text.

---

### 1. Client Intake Synthesizer conflict-check redesign — attorney validation required

**Why human-only:** The redesign (generate search queries, not results) is the right direction, but a practicing attorney needs to confirm:
- Does the search-query output format match how their actual conflicts system works?
- Is there a jurisdiction where the *act of feeding intake data to AI* creates a conflicts-system obligation before the check runs?
- What disclaimer language is legally sufficient vs. legally misleading?

**Who answers it:** Any bar-active attorney who has run a conflicts check in the last 3 years.

---

### 2. §7216 consent form — exact Rev. Proc. 2013-14 §5.04 language

**Why human-only:** The template must reproduce verbatim Treasury language. An AI can summarize it but may introduce paraphrase errors that make the consent legally ineffective. A licensed CPA or EA needs to:
- Confirm the exact verbatim text the template uses matches the current Rev. Proc.
- Confirm the 12-point type requirement is correctly communicated
- Confirm whether the 2013-14 Rev. Proc. has been superseded or modified by any subsequent guidance

**Who answers it:** Any CPA, EA, or tax attorney who has processed §7216 consents in active practice.

---

### 3. Privilege log column structure — litigator validation

**Why human-only:** Privilege log format varies by court, jurisdiction, and case. The standard columns identified in the research may not match what opposing counsel or specific courts actually accept. A litigator needs to:
- Confirm the column structure is acceptable in their typical jurisdictions
- Flag any columns that are inadvertent disclosures (some courts say "description" can itself waive privilege)
- Confirm whether "withheld" vs. "redacted" distinction is correctly captured

**Who answers it:** Any attorney who has produced or challenged a privilege log in federal or state court.

---

### 4. Heppner dicta framing — attorney gut-check

**Why human-only:** The research confirms Heppner is real. What remains uncertain is whether our marketing language accurately characterizes the *dicta* vs. the *holding*, and whether a bar-active reader would find it misleading or overclaiming. A single read from one attorney ("would you feel comfortable if this appeared in a bar ethics CLE?") is sufficient to clear this.

**Who answers it:** Any bar-active attorney — does not need to be a specialist.

---

### 5. EU absolute-novelty rule framing in Patent Disclosure Draft

**Why human-only:** Patent law is jurisdiction-specific and technical. The EU absolute-novelty rule framing in the Patent Disclosure Draft template and the marketing copy must be reviewed by a registered patent practitioner (USPTO registration + EPC familiarity) before it goes to patent attorneys. A single wrong sentence on novelty bars could make Keepance look incompetent to the exact audience we're trying to win.

**Who answers it:** A registered patent attorney or patent agent with international filing experience.

---

### That's it

Everything else in the knowledge-gathering document can be handled by:
- AI research (already done across three reports)
- Statute text (already verified)
- Public ABA ethics opinions (already verified)
- Conservative template design that doesn't overclaim

The five items above are the only ones where the cost of being wrong is high enough, and the barrier to AI verification is real enough, that a human license-holder is the only acceptable source.

---

*Written: 2026-05-28. Action plan is ready to execute. Template redesigns (Part 1A) can begin immediately — no advisor needed to make the changes, only to confirm them after.*
