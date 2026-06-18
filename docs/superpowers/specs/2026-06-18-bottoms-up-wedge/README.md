# START HERE — "Start on your own": the bottoms-up wedge

This folder is a complete, self-contained handoff for a fresh Claude Code instance to implement Keepance's bottoms-up individual-adoption motion. It came out of a 2026-06-18 meeting with a Utah pre-seed investor (Sam Andersen, Element Ventures) who steered Keepance toward "let an individual download and use it on their own, without the firm having to approve it first."

## What this is, in one paragraph
Make Keepance something a single lawyer can download and safely use on their own, that also becomes the way Keepance gets into their firm. The core move is **safe-by-default**: a personal install can't send client text to a cloud AI until the user makes an explicit, informed choice. On top of that: an honest first-run trust moment, a one-click "security pack" PDF the user hands to their firm's IT/GC, a solo-to-firm bridge, and frictionless paid-trial packaging. Keepance never claims to make anyone "firm-compliant" — it handles data safety and gives the user an honest, defensible story.

## Read in this order
1. **`01-design-spec.md`** — the approved design. The "core insight" (§1) and the ethical guardrail (§6) are the soul of this; read them carefully.
2. **`02-implementation-plan.md`** — phased, task-by-task plan. Phase 1 (safe-by-default) is the crux and is fully spec'd with code.
3. **`03-copy-deck.md`** — every customer-facing string, written to the house voice. Use these verbatim; don't rewrite in a markety voice.
4. Repo context: `~/keepance/CLAUDE.md` (model/effort policy + voice rules + "not a developer" note), `~/keepance/ARCHITECTURE.md` (the 5-layer DAG).

## Hard rules (violating any of these is a defect, not a style nit)
- **No silent cloud fallback.** Personal installs never auto-egress.
- **Firm installs unchanged.** Always branch on `isFirm` (`useFirm`).
- **Never claim "guaranteed/fully compliant."** Keepance handles data safety; the firm owns policy. There are tests that assert this phrase never ships.
- **Voice rules on every user-facing string.** No em dashes (there's a test), no AI tells, first-person, concrete. The security pack reads as honest legal-grade prose.
- **Do not cut a build or deploy.** Commercial boundary — Jameson's explicit go only. Build + ship are the one place to stop and ask.
- **Jameson is not a developer.** If you report to him, translate; never dump stack traces.

## Gates (green at the end of every phase)
`npm run typecheck` = 0 · `npx vitest run` green · `npm run lint` introduces nothing new · no-em-dash test passes.

## Two open questions (defaults are safe to build against)
1. Trial length — default 30 days unless Jameson says otherwise.
2. How hard to lean on "no IT ticket required" — default: punchy hero, immediately qualified by the honest framing (copy deck handles this).

## Suggested execution
Subagent-driven (the repo's default): one fresh subagent per task, Opus reviews between tasks, push implementation down to Sonnet/Haiku per `CLAUDE.md`. Phase 1 is independently shippable and worth doing first.

---

### Copy-paste bootstrap prompt for the implementation session

```
Implement the Keepance "Start on your own" bottoms-up wedge.

Read first, in order:
1. docs/superpowers/specs/2026-06-18-bottoms-up-wedge/README.md
2. docs/superpowers/specs/2026-06-18-bottoms-up-wedge/01-design-spec.md (esp. §1 core insight and §6 ethical guardrail)
3. docs/superpowers/specs/2026-06-18-bottoms-up-wedge/02-implementation-plan.md
4. docs/superpowers/specs/2026-06-18-bottoms-up-wedge/03-copy-deck.md
5. CLAUDE.md and ARCHITECTURE.md

Then execute the plan task-by-task using superpowers:subagent-driven-development, starting with Phase 1 (safe-by-default), which is the crux and fully spec'd with code. Honor the hard rules in the README: no silent cloud fallback, firm installs unchanged, never claim "compliant", voice rules on every string, and DO NOT cut a build or deploy (that's Jameson's explicit go). Keep gates green per phase (typecheck 0, vitest green, no-em-dash test). Jameson is not a developer; translate anything you report to him.

Branch: keepance-3.0. Commit per task with the messages in the plan.
```
