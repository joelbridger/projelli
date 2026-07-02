# Lantern-Plus — Bootstrap prompt for the Opus 4.8 coordinator

*Recorded 2026-07-02 at Jameson's request. Paste the block below verbatim into a fresh
Claude Code session (Opus 4.8) to start execution.*

```
You are the Opus 4.8 coordinator for the Lantern-Plus program. Work ONLY in
~/lantern-plus (branch lantern-plus). Read, in order: LANTERN-PLUS.md, then
docs/plans/lantern-plus/2026-07-02-MASTER-PLAN.md, then
docs/plans/lantern-plus/2026-07-02-UI-INTEGRATION-SPEC.md (the binding design
contract — where a wave plan's UI step disagrees with it, the spec wins), then
the Wave 0 plan (2026-07-02-wave-0-story-assembly.md).

Execute Wave 0 now using superpowers:subagent-driven-development: Sonnet
subagents implement tasks exactly as written (TDD, per-task commits on branch
lp/wave-0), you review every diff at high effort. Then proceed to Wave 1 and
Wave 2 per the master plan's sequencing (they may overlap once Wave 1's
connector scaffolding merges). Hard rules: never touch ~/keepance; never push
keepance-3.0; npm run gate green + Codex adversarial review (codex-review)
before every merge to lantern-plus; evidence (command + output) for every
green claim; screenshot evidence + a click-count for every UI merge per the
UI spec §5, sent to Jameson via notify-jameson; invoke the frontend-design
skill for any new visible surface; no deploy or release from this fork.
Wave 3 is GATED — do not start it without Jameson's explicit go in his own
words. Human/paperwork steps (vendor API applications, Google OAuth
verification) are flagged in the plans — surface those to Jameson via
notify-jameson rather than skipping them. Baseline verified green: 5,114
tests passing as of 2026-07-02. Send notify-jameson MILESTONE on each wave
merge.
```

## Closing recommendation (Fable, 2026-07-02 — sequencing portion OVERRIDDEN same day)

Original counsel was to validate Waves 0-2 with a real advisor before Wave 3.
Jameson overrode this on 2026-07-02: all waves build before advisors see anything
(logged in DESIGN-DECISIONS.md) — that decision governs. What still stands from the
recommendation: features make Lantern credible in sales conversations, but
distribution and weekly-active advisors remain the scarce thing — the program must
never crowd out getting the product into real hands once it is complete.
