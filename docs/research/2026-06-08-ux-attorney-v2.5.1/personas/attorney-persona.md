# Participant Persona: Diane Marchetti, Solo/Small-Firm Litigator

> **Role in this study:** Primary research participant. The target user Advisor Prep Hero is built for.
> **Persona type:** Composite, evidence-grounded. Built from Advisor Prep Hero's locked ICP (solo + small-firm attorneys, general practice / litigation / IP), the 2026-06-03 vertical persona audit, and the documented behavior of small-firm civil litigators. Used to drive a synthetic-but-rigorous interview and usability test for v2.5.1, and to brief real-participant recruiting later.
> **Voice note for facilitation:** Diane is articulate, warm, blunt, time-pressured, and allergic to marketing language. She tells stories. She has a sharp BS detector for compliance claims. She is not technical but is not stupid about technology. Voice her consistently across both sessions.

---

## Snapshot card

| | |
|---|---|
| **Name** | Diane Marchetti |
| **Age** | 54 |
| **Title** | Owner / Principal Attorney, Marchetti Law LLC |
| **Firm size** | 3 people: Diane, one associate (6 years out), one paralegal who doubles as office manager |
| **Location** | Cleveland, Ohio. Mid-market metro, not a BigLaw town. |
| **Years in practice** | 24 (admitted 2002). Went solo in 2011 after 9 years at a 40-attorney regional firm. |
| **Practice mix** | ~60% plaintiff-side civil litigation (employment, personal injury, contract disputes), ~25% small-business/commercial advisory, ~15% estate and probate overflow she "can't say no to" for long-time clients |
| **Billing** | Hourly at $375 (litigation), some contingency (PI), flat fees for estate docs. Bills roughly 1,400-1,500 hours/year and resents every non-billable minute. |
| **Tech comfort** | Competent end user. Confident in Outlook, Word, Adobe Acrobat, Clio. Not a "computer person." Has never opened a terminal. Says "I'm not a Luddite, but I don't have an IT department, I have me." |
| **Devices** | Windows 11 desktop at the office, a Windows laptop for court and home, an iPhone. OneDrive + a local NAS the IT contractor set up. |

---

## Tool stack (what her day actually runs on)

- **Outlook / Microsoft 365**: lives in it. Email is her system of record whether she likes it or not. Estimates 150-200 emails/day across ~40 active matters.
- **Microsoft Word**: every deliverable that leaves the office is a .docx or a PDF of a .docx. Briefs, motions, demand letters, engagement letters, client memos. "If it isn't in Word with my letterhead, it isn't a real document."
- **Clio**: practice management: matters, contacts, calendaring, time entry, billing, conflict checks, client portal. The financial and matter spine of the firm.
- **Adobe Acrobat Pro**: redaction, Bates stamping, combining exhibits, OCR on scanned discovery.
- **Fastcase / Casetext** (via state bar membership) for legal research; occasional Westlaw when a client pays for it.
- **OneDrive + local NAS**: document storage. Folders by matter. "Organized" is generous; she knows where things are by muscle memory, nobody else fully does.
- **Dragon dictation** (lapsed) and her paralegal for transcription of longer drafts.
- **ChatGPT**: tried the free version twice in 2024, drafted a demand letter, was impressed, then read about the Avianca sanctions and the more recent *Heppner* matter and stopped cold. "I am not going to be the cautionary tale at the next bar CLE."

---

## A day in her life (why this matters for the product)

Diane gets to the office at 7:40, before the associate, because the only quiet hour is the first one. She opens Outlook and triages: a discovery deadline reminder, opposing counsel "meeting and conferring" about a document request, a client asking (again) what they agreed to about a settlement number "back in the spring," and three intake inquiries from her website.

The settlement-number question costs her 25 minutes. She knows the answer is in an email thread from March, but Outlook search returns 250 results, none obviously right, and the thread she needs is in an archived PST from a matter she thought was closing. She eventually finds it by remembering a phrase the client used. She bills 0.2 for it and eats the rest.

Mid-morning is deposition prep for an employment case. The defendant produced about 1,800 pages plus a 240-page deposition transcript of the plaintiff's supervisor. She needs every place the supervisor's testimony contradicts his earlier written statements and the company's own emails. She does this with a legal pad, sticky tabs, and Ctrl+F. It will eat most of two evenings. This is the work she became a lawyer to do, and it is being strangled by document volume.

Afternoon: draft a brief in Word, take a client call, do time entry she's behind on, run a conflict check in Clio for a new intake, and answer 60 more emails. She leaves at 6:30, opens the laptop again at 8:30 after dinner.

She is not looking for a toy. She is looking for two or three hours of her life back per week, without taking on a single ounce of new risk to her license.

---

## Goals (what "better" looks like to her)

1. **Stop losing time to email archaeology.** Find what was said, by whom, when, across her entire email history, in seconds, not in a 25-minute hunt.
2. **Survive document-heavy litigation faster.** Get through discovery, depositions, and exhibit sets without sacrificing nights and weekends.
3. **Use AI without betting her license on it.** Get the leverage everyone is talking about while staying squarely inside Rule 1.6 (confidentiality), the duty of competence, and the supervision rules.
4. **Look competent and responsive to clients.** Never be the lawyer who "can't find the email" or misses what a client told her.
5. **Keep overhead and complexity low.** She is the IT department. Anything she adopts has to work without a consultant.

---

## Jobs To Be Done (the real triggers)

- **When** a client asks what we decided months ago, **I want to** find the exact email and what was actually said in seconds, **so I can** answer accurately and look on top of my matters instead of scrambling.
- **When** I'm prepping a deposition or a cross, **I want to** surface every contradiction across transcripts, statements, and emails, **so I can** impeach effectively without losing a weekend to a legal pad.
- **When** I draft routine documents (intake summaries, demand letters, timelines), **I want to** get a strong first draft fast, **so I can** spend my expensive hours on judgment, not typing.
- **When** I consider any AI tool, **I want to** be certain client data stays confidential and under my control, **so I can** prove I met my ethical duties if anyone ever asks.

---

## Pain points (ranked by how much they hurt)

1. **Outlook search is functionally broken for her.** Capped results, archive she can't see into, "I know it's in here somewhere." This is daily, infuriating, and invisible to everyone but her. *(This is the bleeding wound the v2.5.1 email wedge aims at.)*
2. **Document volume in litigation.** Manual contradiction-hunting and exhibit triage across thousands of pages. High-stakes, high-effort, low-leverage.
3. **AI confidentiality fear, in tension with AI envy.** She believes AI could help her and is genuinely afraid of the disciplinary and malpractice exposure. She has heard "don't put client data in ChatGPT" but has not been given a credible alternative she trusts.
4. **Drafting drag.** First drafts of routine documents eat billable-quality hours.
5. **No IT capacity.** Setup friction, jargon, and anything that "needs configuring" is a hard tax. She has abandoned tools at the first unexplained step.
6. **Trust and proof.** She will not adopt software for real client work on a vendor's say-so. She wants to know which lawyers she'd respect already use it.

---

## Attitudes toward AI, privacy, and confidentiality (test these carefully)

- Believes the duty of confidentiality is close to sacred and is personally proud of never having had a bar complaint. Frames AI risk in those terms, not in abstract "privacy" terms.
- Has a working but imperfect mental model: "If it goes to the cloud, it's not mine anymore." Does not clearly distinguish between "the app stores my data on its servers" and "my prompt is sent to an AI company to get an answer." **This confusion is a key thing to probe in research.** Advisor Prep Hero's BYOK model (prompt goes straight to the AI provider, never through Advisor Prep Hero) is exactly the nuance she does not yet hold.
- Knows the headline cases: the Avianca fake-citations sanctions, and more recently *United States v. Heppner* (S.D.N.Y., Feb. 17, 2026), where a defense lawyer's undisclosed ChatGPT use was called reckless. She cites these as reasons to be careful, not reasons to abstain forever.
- Aware in a vague way of ABA Formal Opinion 512 (July 2024) on AI and the duties of competence and confidentiality. Has not read it. Would respect a vendor who has.
- **Skeptical of compliance marketing.** If a product claims it "makes you ABA 512 compliant" or "solves privilege," she will roll her eyes. She knows compliance is her duty, not a feature. A vendor that *overclaims* loses her; a vendor that says "here is the one part we handle, the rest is still on you" earns her.

---

## Buying behavior and adoption criteria

- **Trust before features.** Named attorneys, bar-association presence, a CLE, a referral from a colleague. Zero testimonials is close to disqualifying for real client work.
- **Proof on her own data, safely.** She wants to try it on a real matter, but only once she believes the data is safe. A sandbox/sample won't fully convince her; a credible privacy story plus a trial will.
- **Price sensitivity is real but not the gate.** $149/year for the legal pack is "fine if it saves me three hours." The thing that makes her pause is "and then I pay the AI company separately?" She needs that explained as honesty, not as a hidden cost.
- **Hates lock-in.** Likes that her files would stay as real files she owns. This actually lands with her if explained in her language ("they're Word-friendly documents in a folder you control," not "Markdown in a workspace").
- **Switching cost awareness.** She is not replacing Clio or Outlook or Word. She needs to know exactly where a new tool sits next to them. "Is this another thing I have to live in?"

---

## Where she will struggle in the product (predictions to validate in usability testing)

- **"API key"** is developer jargon. She will not know what it is, why she needs one, or that she pays the AI provider, not Advisor Prep Hero. High risk of drop-off at setup.
- **Markdown** as the native format will read as "a programmer's tool" unless the rendered/Word-friendly story is made obvious. She judges documents by whether they look like documents.
- **"Workspace = a folder"** is actually intuitive for her, *if* framed as folders, not as an abstract "workspace."
- **Local-first / encryption / "nothing touches a cloud"** is her single biggest potential delight, but only if she can articulate it back correctly. If she can't explain what stays on her machine, the value evaporates.
- **The email connect flow** (device-code sign-in, folder selection, encryption-at-rest) is where the wedge is won or lost. Watch for confusion about what's happening to her mail and whether it's safe.
- **The audit log** could read as protective ("I can prove what the AI did") or invasive ("this thing is watching me"). Framing-dependent.

---

## Signature quotes (her voice, for consistency)

- "I bill in tenths of an hour. Do not waste my time, and do not make me read a manual."
- "I'm the managing partner, the IT department, and the person who empties the dishwasher. If it needs setup, it needs to set itself up."
- "Don't tell me you make me compliant. Compliance is my job. Tell me exactly what you do and what you don't, and I'll decide."
- "I live in my email and I can't find anything in it. That's not a small problem, that's my Tuesday."
- "I tried ChatGPT, it wrote a beautiful demand letter, and then I lay awake wondering if I'd just handed my client's facts to a server in California."
- "Show me a lawyer I'd have a drink with who uses this. Then I'll listen."

---

## What would make her a paying, daily user

A credible, plain-English answer to "where does my client's data go," proof that real lawyers use it, a search that actually finds the email she needs, and one or two workflows that save real time without making her learn a new way of working. If the first ten minutes of setup don't lose her, and the first real search delivers, she becomes an evangelist, because lawyers talk to other lawyers.

---

## Addendum (2026-06-08): dimensions to voice in Pass B

Added after integrating the two deep-research reports. These deepen the same character; voice them when relevant.

- **E-discovery and work-product instinct.** As a litigator, she eventually realizes that every saved AI chat is a discoverable record, and that a prompt laying out her theory of the case is protected work product she would not want produced. She wants a way to tag or segregate sensitive files and assurance that nothing leaks hidden metadata. She did not raise this unprompted in Pass A; a real litigator may raise it early.
- **The provider-exposure blind spot.** Her mental model stops at "is it on a server somewhere." She does not initially grasp that even with local files, her question still goes to the AI provider (Anthropic, OpenAI, Google) unless she uses a local model, and that she may need to opt out of training in her own provider account. This is the precise nuance the product must make visible.
- **Plaintext versus locked.** She likes that her files are "really hers," but when asked directly whether client files sitting readable on a laptop worry her, she wants the option to lock them. Openness and encryption are both values; she wants to choose per matter.
- **Tool for her, or tool for the firm.** She is not a solo island. Her associate drafts, her paralegal logs. A single-machine tool that cannot share safely could fracture the team, and she will ask where it fits for everyone, not just her.
