# User research — advisor product-value session (2026-07-10)

**PRIVATE.** Jameson recorded a ~116-minute session with his wife (practicing financial
advisor at a small RIA, XYPN network; uses Jump, Wealthbox, RightCapital, Schwab,
Calendly, JotForm, Teams, Outlook). This is the second session in the series — the
2026-07-08 onboarding walkthrough covered pillar 1 ("can we use it?" / compliance);
this session covers pillar 2 ("would it be helpful?" / product value). Format: she
reacted out loud to the Lantern feature map (card by card), then the conversation went
deep on her firm's real workflows, pains, and wishes.

## Files (entire folder gitignored — never committed to GitHub; personal voice + client-adjacent detail)
- `Feedback 7-10-26.m4a` (~96 min, part 1)
- `Feedback 7-10-26 2.m4a` (~20 min, part 2)
- `feedback-7-10-26-part1-transcript-raw.md` / `-segments.json` — whisper large-v3 transcript with timestamps
- `feedback-7-10-26-part2-transcript-raw.md` / `-segments.json` — same, part 2

### Transcript accuracy notes
Transcribed with faster-whisper **large-v3** (beam 5, VAD), spot-verified against a
second model on sampled windows. No speaker labels — it is a two-voice conversation
(Jameson = interviewer, wife = participant); attribution in the analysis was done from
content and context. Known systematic mis-hearings to read through:
- "job form" → **JotForm** (the forms product)
- "Seattle" → a **teammate's name** (likely Cielo/Sayla — unverified spelling)
- "what box" / "whelp box" / "wild box" / "web box" → **Wealthbox**
- "right capital" → **RightCapital**; "JMP"/"jump" → **Jump**
- "JBW" → the firm's initials

## Analysis deliverables (created 2026-07-11 by the research-synthesis session)
- `00-executive-synthesis.md` — the decision-oriented summary (start here)
- `01-evidence-ledger.md` — atomic, timestamped evidence observations
- `02-thematic-analysis.md` — codebook + themes with supporting/contradicting evidence
- `03-advisor-workflow-and-jtbd.md` — end-to-end workflow + Jobs-to-be-Done
- `04-product-opportunity-map.md` — evidence → need → opportunity chains
- `05-recommendations-and-roadmap.md` — protect / improve / prototype / research / defer / reject
- `06-repository-gap-analysis.md` — research needs vs the actual codebase
- `07-follow-up-research-plan.md` — what this session cannot answer + next research
- `08-founder-decision-brief.md` — decisions, questions, bets, next move
- `09-strategic-path-options.md` — four paths (conservative → replace-Wealthbox), pros/cons, comparison (requested by Jameson 2026-07-11)
- `10-path4-deep-dive.md` — Path 4 fully built out: designs, architecture feasibility, migration, compliance flags, gated program (requested by Jameson 2026-07-11; supporting research in `analysis-drafts/crm-core-feasibility.md` + `analysis-drafts/crm-market-research.md`)

## Handling
Audio + raw transcripts stay LOCAL (the whole folder is gitignored, permissions 700).
Treat raw content as confidential — it contains her firm's internal workflows, teammate
names, and client-adjacent stories.
