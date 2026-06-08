# WS3 — Trust & Compliance Signals: Execution Plan

**Date:** 2026-06-08
**Workstream:** 3 of 6 (Competitive Activation)
**Scope:** public trust page, security FAQ, DPA template, SOC 2 decision brief

---

## Goal

Give regulated-vertical prospects (CCO, IT reviewer, malpractice carrier) something concrete to evaluate Keepance's data posture. Nothing here claims certifications we don't hold. Everything is honest about current state and gaps.

## Deliverables

| # | File | Gate |
|---|------|------|
| A | `website/security/index.html` | Deploy-gated (Jameson review) |
| B | `docs/marketing/security-faq.md` | Internal; no deploy gate |
| C | `docs/legal/dpa-template.md` | Escalation — needs lawyer review before use |
| D | `docs/strategy/2026-06-08-soc2-decision-brief.md` | Decision brief for Jameson |

## Key constraints

1. **Honesty first.** No SOC 2 claim. No DPA-signed claim. State both as "in progress / not yet" explicitly.
2. **Local-vs-cloud precision.** Only local model = zero egress. BYOK cloud key still sends the prompt to the provider. Must be stated in the same sentence as any zero-egress claim.
3. **No em dashes.** No AI-tell words (leverage, seamless, empower, unlock, transform, elevate, delve, tapestry). No "It's not X, it's Y."
4. **Light theme.** Match `ai-workspace-privacy` nav, footer, canonical structure.
5. **Pricing** (if mentioned): $49 one-time Personal / $129 one-time Professional / $399 one-time Practice.

## Execution steps

1. Write plan file (this file). Done.
2. Build `website/security/index.html` — clone ai-workspace-privacy structure; honest posture statements; "what we don't have yet" section.
3. Build `docs/marketing/security-faq.md` — Q&A format answering CCO/IT/carrier questions.
4. Build `docs/legal/dpa-template.md` — standard DPA structure; DRAFT header; lawyer-review flag; open questions listed.
5. Build `docs/strategy/2026-06-08-soc2-decision-brief.md` — plain-language founder brief; cost/timeline bands; recommendation; "your call" closing.
6. Self-check: grep for em dashes, AI tells, false certification claims, canonical tag.

## Escalations (do not block)

- SOC 2 certification: board-level spend decision, Jameson's call.
- DPA legal review: lawyer must review before any customer use.
- Deploy: trust page is deploy-gated; Jameson approves before going live.
