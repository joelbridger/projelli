# Worker brief — Demo V1 runbook (plain-language script for Jameson)

You are **cc-lantern-runbook**, worktree **~/lp-runbook**, branch **lp/demo-runbook** (off tip 4cafb72f). Writing lane — no product code. You do NOT merge. Push with `--no-verify` (docs only).

## Audience — this shapes every sentence
Jameson is a product designer, NOT an engineer. The runbook must read like a friendly stage script a smart 10-year-old could follow: short sentences, everyday words, zero jargon, zero file paths, zero code. Any technical term that must appear gets a one-line plain explanation. This rule is codified in ~/.claude/CLAUDE.md — follow it exactly.

## Deliverable
`docs/demo/DEMO-RUNBOOK.md` — the step-by-step script for driving the Demo V1 flow live (the 6 steps from `coordination/DEMO-V1.md`): Connect AI → Connect Data → Progress Screen → Ask → Record Meeting → Search Transcript.

## Source material (read all of these)
- `coordination/DEMO-V1.md` — the 6-step critical path
- `docs/demo/DEMO-QA-CRIB.md` — the ready questions + expected answers per client
- `coordination/qa-campaign/evidence/bench1-demo-rehearsal/REPORT.md` (lp/bench1-evidence branch) — what a full rehearsal actually looks like
- `coordination/qa-campaign/evidence/winsmoke-qa90-91/SCORECARD.md` (lp/winsmoke-evidence branch) — the meeting-recording flow in practice

## Must-include beats (all learned tonight — do not lose any)
1. **Before the demo (prep checklist):** ONE workspace only, set up in advance (the app currently keeps one global client list — never switch workspaces live); clients registered; files already indexed; the on-device Local AI model already downloaded (never download live); OpenAI key already connected and tested; do a full app restart and one warm-up question before the audience arrives.
2. **Ask step:** use the crib-sheet questions (short, one-file answers — the local AI has a small working memory); ask with ChatGPT first, then repeat one with Local AI; if data is still importing, the app now says so honestly — that's a feature to narrate, not hide.
3. **Record Meeting step:** after starting the recording, a guest called "Recording Notice" knocks at the meeting — ADMIT it (can take up to ~2 minutes; narrate it as the app announcing itself). HONEST WORDING RULE: say "the app adds a visible recording-notice participant to the meeting" — never "Teams shows everyone a recording banner."
4. **Search Transcript step:** ask about something said in the meeting using the same Ask box.
5. **A "if something goes sideways" page:** what to say/do for each step's most likely hiccup (e.g., notice guest slow to knock → keep talking, admit when it appears; answer looks thin → mention data still importing and re-ask).
6. Mark clearly at the top: DRAFT pending final verification results (the coordinator will confirm which steps are fully verified).

## Done criteria (HARD)
Doc written, committed AND pushed (`git push --no-verify -u origin lp/demo-runbook`). THEN print exactly: `WORKER-DONE: lp/demo-runbook` + 2-line summary.
