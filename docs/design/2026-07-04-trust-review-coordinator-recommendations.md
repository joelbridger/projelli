# Coordinator's Recommendations on the Skeptical-Advisor Trust Review

*Companion to `2026-07-04-skeptical-advisor-trust-review.md`. Per Jameson's directive: the review is presented for decisions — NOTHING has been changed. This is my adjudication of each finding: where I agree, where I push back, what I'd sequence first, and what I would not act on. Every item below waits for Jameson's per-area go.*

## My overall read

The review is right about the big thing: the product's engineering trust is largely earned (citations hold up, isolation holds, data survives abuse), and the exposed surface is **honesty and provability, not missing machinery**. That's the good kind of problem — most of the high-severity items are copy corrections, default flips, and label honesty, not rebuilds. I verified the two claims that would be worst if wrong: the Data Map "read-only" line **is** verbatim in the code next to a shipped write feature (E1 confirmed), and the hallucinated "2013" line **did** reach a queued CRM card in the smoke evidence (E3 confirmed). This review was not exaggerating.

One important context note: **E2's core (participants can't see the recording) is already being addressed** — the Notice Card build Jameson approved this morning is mid-build right now. The review's E2 contribution is the *evidence semantics* around it ("copied" logged like "delivered", overclaiming labels, and a consent-script step that failed to render in a live run — that last one smells like a plain bug worth confirming regardless of any decision here).

## Decision menu — grouped the way I'd approve them

### Tier A — "Stop saying untrue things." Approve as ONE small lane (~a day). My strongest recommendation.
Pure copy/label honesty; zero architecture; every item is a place a skeptic catches the app overclaiming:
- **E1** — fix the false "Wealthbox never writes back" Data Map line to describe the approval-gated write path honestly. *(The single cheapest/highest-stakes item on the list.)*
- **E5-headline** — reconcile "nothing ever leaves your machine" to the true version ("nothing leaves unless you choose cloud AI or a connector — and here's exactly what").
- **R7** — make the provider name agree everywhere (the Privacy Center saying "OpenAI" while calls went to Anthropic is functionally a bug; embarrassing, trivial).
- **R3** — reorder the "notes blocked" copy so it doesn't coach turning privacy off (lead with "connect a local model").
- **P4** — soften/clarify the SOC-2 onboarding pill (provider's cert, not ours).
- **P6** — replace the bare "Recommended" badge on Cloud AI with honest framing ("Most capable" vs "Most private").
- **E2-labels** — rename ledger evidence honestly ("notice copied", not implied delivery; "spoken notice detected", not "consent noted") + confirm/fix the consent-script render bug.

### Tier B — "Guard the outbound door." Approve as 1-2 scoped lanes (few days, real but bounded engineering).
The hallucination-travels class (E3) plus its erosion siblings — the scariest *behavioral* gap:
- Never let an unresolved/needs-review meeting note be sendable to CRM or email (the AI-apology-as-client-note case must be structurally impossible to ship outward).
- Provenance travels with outbound artifacts: CRM notes carry an "AI-drafted from [meeting, date]" line; the firm-tier compliance note defaults **ON** (R5); saved/sent follow-up emails retain their citations (R4).
- Kill generate-on-open in the Draft Follow-Up modal (R4) — content shouldn't leave the machine before a deliberate click.
- Whole-practice Ask gets a pre-send "about to send summaries of N clients" confirmation (R6).
- R1: don't pre-check the consent attestation in all-party-consent states.
- P2: fix the `matter_…` folder-name leak in the Documents tree (a locked facade rule is being violated in visible UI).

### Tier C — "Build the proof." Plan-first flagships (design doc before any build; my recommended order):
- **E4 — the provable privacy record** ("what left, and what the AI read, per answer, per client, tamper-evident, exportable"). I agree with the reviewer this is the compliance-officer veto AND the deepest moat — and we already own the hard parts (citation engine knows the sources; the audit chain is already tamper-evident). I recommend this as the next flagship **after the Notice Card ships**, with a proper design doc first. It converts the entire category pitch from "trust us" to "here's the evidence."
- **E5-retention** — rethink "Summary only" (it deletes the accurate record and keeps the AI's interpretation). Minimum: a compliance warning + firm-tier default that retains transcripts. Possibly fold into E4's design.
- **R9 — voiceprint biometric consent.** Real (BIPA-class states regulate voiceprints). Cheap interim: an explicit biometric-consent step + disclosure before speaker enrollment. Proper answer needs a lawyer's eyes — recommend batching this into the legal-review board item rather than engineering it blind.
- **R2 — move consent/jurisdiction setup away from the record-time moment** (capture at client creation; record-time becomes confirmation). Fold into the next notice iteration rather than its own lane.
- **R10 — citation integrity under retention** (warn when deleting cited audio; annotate notes when their sources are removed). Fold into E4/E5 design.

### What I do NOT recommend acting on (or not now)
- **P3 (trial countdown placement)** — pure business/design call, yours alone; there are honest arguments both ways and it's revenue-relevant.
- **P5 (localization completeness)** — already an active workstream (three merges today); no new decision needed.
- **R8** — both underlying bugs are already fixed (one live-verified today); the "silent failure must never look like empty state" principle it teaches is already being applied.
- **Anything touching the "strengths" list** — the review is right that the citation experience, the consent dialog's tone, isolation, and resilience are the soul of the product. No lane should touch those except to protect them.

## If you only approve one thing
Tier A. It's a day of work, and it removes every place where a compliance officer can catch the product in a demonstrable overclaim — which is the failure mode the reviewer correctly calls unrecoverable. Tier B second: it makes the one genuinely dangerous behavior (confident AI wrongness traveling into systems of record) structurally impossible.

*— The coordinator (Fable 5), 2026-07-04 evening. Awaiting per-tier decisions; no lanes opened.*
