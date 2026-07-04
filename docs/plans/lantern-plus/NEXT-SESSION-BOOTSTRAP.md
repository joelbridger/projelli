# Lantern-Plus — Bootstrap prompt for the Opus 4.8 coordinator

*Recorded 2026-07-02 at Jameson's request. Paste the block below verbatim into a fresh
Claude Code session (Opus 4.8) to start execution.*

> **Currency note (2026-07-04): this bootstrap has already run.** All five waves
> (0-4) are merged and the program is feature-complete against Jump, including the
> full real-Windows verification pass — see `docs/PRODUCT-JOURNEY.md`'s 2026-07-04
> entries. Do NOT paste the block below into a fresh session expecting to "begin
> Wave 0" — there is nothing left to build from this plan. The block is kept as a
> historical record of how the program was kicked off; current work (QA, cleanup,
> bench confirmation) is tracked in `~/lantern-plus/coordination/`.

```
You are the Opus 4.8 coordinator for the Lantern-Plus program. Work ONLY in
~/lantern-plus (branch lantern-plus). Read, in order: LANTERN-PLUS.md, then
docs/plans/lantern-plus/2026-07-02-MASTER-PLAN.md, then
docs/plans/lantern-plus/2026-07-02-UI-INTEGRATION-SPEC.md (the binding design
contract — where a wave plan's UI step disagrees with it, the spec wins), then
docs/plans/lantern-plus/PARALLEL-OPERATIONS.md (BINDING coexistence rules with
the main-line coordinator working in ~/keepance — scope walls, Legion
reservation via ~/keepance-coordination/PARALLEL-EFFORTS.md, separate
CARGO_TARGET_DIR=~/.cargo-target-lantern-plus, the one-way merge valve), then
the Wave 0 plan (2026-07-02-wave-0-story-assembly.md).

FIRST ACTIONS, in order: (1) append your session start to the bulletin;
(2) downstream merge: git fetch origin && git merge origin/keepance-3.0 into
lantern-plus, resolve in main's favor outside program modules, npm run gate
until green; (3) spot-check the Wave 0 plan's file anchors against the merged
code (find by symbol if lines moved); (4) begin Wave 0.

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
merge. Phase 2 (docs/plans/lantern-plus/phase-2/) is design briefs ONLY — do
not build from briefs; its detailed planning happens after waves 0-4 merge,
per phase-2/README.md. Phase 1 is fully standalone and never depends on
Phase 2. Separately: remind Jameson early that the advisor discovery-interview
campaign (staged in ~/keepance/docs/marketing/campaigns/2026-06-advisor-first-users/)
should run DURING the build so Phase 2 validation data exists when it's needed.
```

## Closing recommendation (Fable, 2026-07-02 — sequencing portion OVERRIDDEN same day)

Original counsel was to validate Waves 0-2 with a real advisor before Wave 3.
Jameson overrode this on 2026-07-02: all waves build before advisors see anything
(logged in DESIGN-DECISIONS.md) — that decision governs. What still stands from the
recommendation: features make Lantern credible in sales conversations, but
distribution and weekly-active advisors remain the scarce thing — the program must
never crowd out getting the product into real hands once it is complete.
