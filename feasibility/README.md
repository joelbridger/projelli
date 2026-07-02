# Jump Feature-Parity Feasibility Assessment

**Question:** What would it take to implement all of Jump's (jumpapp.com) features into
Keepance / Advisor Prep Hero so we can directly compete with them?

**Requested by:** Jameson, 2026-07-02.

## Contents

| File | What it is |
|---|---|
| `ASSESSMENT.md` | The main deliverable — plain-language feasibility assessment |
| `jump-feature-inventory.md` | Consolidated inventory of every Jump feature (existing research + fresh 2026-07 web research) |
| `codex-codebase-readiness.md` | Independent Codex (gpt-5.5) read-only investigation of how ready the Keepance codebase is for each Jump feature |
| `keepance-current-map.md` | What Keepance can actually do today (code-grounded) |
| `research/deep-research-findings.md` | Fresh adversarially-verified web research on Jump (2026-07-02) |
| `research/brainstorm-local-first.md` | Design brainstorm: local-first capture engine (no bot, loopback audio) |
| `research/brainstorm-lean-reuse.md` | Design brainstorm: maximum reuse, wave build order |
| `research/brainstorm-simplicity-ux.md` | Design brainstorm: simplicity/UX, anti-roadmap, demo moments |
| `research/codex-design-brainstorm.md` | Independent Codex design proposal |
| `research/codex-review-of-assessment.md` | Codex adversarial review of the assessment (all findings incorporated) |

## Key prior work this builds on (read-only, in the Keepance repo)

- `~/keepance/competitive-analysis/jump-vs-keepance/` — full competitive report (2026-06-28)
- `~/keepance/docs/strategy/2026-06-29-board-decision-leading-advisor-ai.md` — controlling board stance:
  compete head-on as a simple AI-first app, NEVER a note-taker
- `~/keepance/docs/strategy/2026-06-29-connector-*-jump.md` — Jump has no public API; its notes already
  land in Wealthbox/SharePoint which Keepance reads

## Ground rules

- Keepance repo is READ-ONLY for this evaluation; everything new lands here.
- This is a feasibility assessment, not a decision. The 2026-06-29 board stance
  ("never a note-taker") stands unless Jameson explicitly changes it.
