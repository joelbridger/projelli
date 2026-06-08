# WS4 — Competitor-Watch Routine Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development for execution.

**Goal:** Keep the competitive landscape from decaying with a scheduled agent that re-checks incumbents, flags material change (especially any move toward a local/zero-egress/BYOK option), logs it, and notifies Jameson only on material change.

**Status (2026-06-08):**
- Baseline research pass: DONE. Findings written to `docs/strategy/competitor-watch-log.md` (## 2026-06-08 baseline). Verdict: wedge intact, no incumbent ships a true local/zero-egress option; closest encroachment is Lexis+ Protégé BYOK-encryption (cloud + customer-held key, not zero-egress). CoCounsel ceiling rose to ~$500/mo.
- Routine prompt + recommended cadence: documented verbatim in `docs/strategy/competitor-watch-log.md`.
- **Recurring cron: NOT created — escalation-gated.** The recurring scheduled-agent cost needs Jameson's go-ahead before enabling.

**To enable after Jameson's go-ahead (one step):** use the `schedule` skill to create a routine on a quarterly (or monthly-light) cadence with the verbatim prompt in the log, writing dated entries to `docs/strategy/competitor-watch-log.md` and calling `notify-jameson` only on a material change. Log what cadence/cost was chosen.

**Guardrails:** sources cited for every claim; "unconfirmed" rather than guessing; notify only on material change; the log is a sibling file (never edit the landscape doc, which other workstreams read).
