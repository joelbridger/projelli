# Phase 2 — Design Briefs (post-parity roadmap)

*Created 2026-07-02 from the advisor-needs discovery
([`../2026-07-02-ADVISOR-NEEDS-DISCOVERY.md`](../2026-07-02-ADVISOR-NEEDS-DISCOVERY.md)),
per Jameson's direction. These are DESIGN BRIEFS, not implementation plans — the
distinction is deliberate and binding.*

## The standalone guarantee (read first)

**Phase 1 (Waves 0–4) is complete, shippable, and fully usable WITHOUT Phase 2.
Nothing in any Phase 1 wave plan depends on, references as a prerequisite, or is
blocked by anything in this folder.** Phase 2 items are additive layers that build
ON Phase-1-shipped rails (calendar, CRM write path, meeting artifacts, retention/
audit machinery). If a Phase 2 brief ever seems to require changing Phase 1 scope,
the brief is wrong — flag it to Jameson, don't touch the wave plans.

## Why briefs now, plans later

Phase 1 plans were written against today's real code, line-anchored and Codex-verified.
Writing task-level Phase 2 plans against a codebase that five waves are about to
transform would produce stale plans full of wrong anchors — the exact failure the
Phase 1 process was built to avoid. So Phase 2 captures the thinking that should NOT
wait (the pain, the evidence, the product design, the honest-claims boundaries) and
defers the thinking that MUST wait (files, tasks, code).

## The planning ritual (same as Phase 1, per item)

1. **Preconditions:** Waves 0–4 merged and gate-green; for `test-first-items.md`
   entries, discovery-call validation FIRST (see below).
2. **Plan:** an Opus 4.8 planning session reads the brief + the then-current code and
   writes the detailed implementation plan using the superpowers **writing-plans**
   skill (bite-sized TDD, real code, exact anchors) into this folder's parent.
3. **Review:** Codex adversarial review of the plan against the codebase; fix findings.
4. **Design:** if the item adds visible UI, prototype it in the product's design
   language and get Jameson's sign-off BEFORE build (the Phase 1 prototype ritual;
   the UI-INTEGRATION-SPEC constitution binds Phase 2 UI identically).
5. **Execute:** subagent-driven, per-wave-style gate + Codex review + merge ritual.

**Never start a Phase 2 build from a brief alone.**

## The validation instrument

The discovery-interview campaign staged at
`~/keepance/docs/marketing/campaigns/2026-06-advisor-first-users/` should run DURING
Phase 1 execution (it needs no engineering), so that arm's-length advisor evidence
exists by the time Phase 2 planning starts. The discovery report is the hypothesis
sheet; each brief lists its open questions for those calls. Reality check recorded
2026-07-02: the repos contain near-zero arm's-length advisor evidence today — the
briefs marked test-first stay unbuilt until real calls say otherwise.

## The briefs

| Brief | One-line design idea | Evidence class | Effort |
|---|---|---|---|
| [`exam-binder.md`](exam-binder.md) | The audit scramble becomes one query: assemble an attested, exportable evidence bundle from the advisor's own files | 🟢 strong | M |
| [`tax-season-pack.md`](tax-season-pack.md) | Ingest the client's tax docs, extract the figures, hand the CPA a clean Word summary + a missing-doc chase list | 🟢 strong | M |
| [`nigo-pre-validation.md`](nigo-pre-validation.md) | Pre-flight custodian paperwork against what's already on file, before it bounces (Schwab rules pack first) | 🟢 strongest pain | M/L |
| [`reg-sp-evidence-kit.md`](reg-sp-evidence-kit.md) | Turn the advisor's own records into the Reg S-P evidence layer: program template, scoping queries, the Data Map as the vendor-oversight artifact | 🟢 urgent window | M |
| [`test-first-items.md`](test-first-items.md) | Held-away statement parsing · marketing-rule pre-review · diminished-capacity pack — each with the discovery question that must be answered first | 🟡/🔴 | S/M each |
