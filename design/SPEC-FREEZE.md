# SPEC-FREEZE — LANTERN-CRM design phase (2026-07-11)

**This file freezes the design.** From this commit forward, `design/00-master-spec.md`
(decisions D1–D26) and `design/01–06` are the build contract for the one-shot wave. A
build lane that needs the spec to change STOPS and escalates to the coordinator; the spec
does not drift silently. Frozen at commit: `c016f2a3` (branch `lantern-crm`).

## Review record (charter requirement: ≥2 adversarial rounds — met, with a third)

| Round | Passes | Result | Reports |
|---|---|---|---|
| 1 | Codex cross-doc consistency (20 findings) + Codex sync attack (~14 blockers) | D1–D11 adjudicated; reconciliation lanes R1–R6 | `reviews/2026-07-11-codex-xdoc-consistency.md`, `reviews/2026-07-11-codex-sync-attack.md` |
| — | Live Wealthbox API probe (evidence-based correction) | 05 amended (R7): workflow-instance + attachment fallbacks | `evidence/2026-07-11-wealthbox-api-probe.md` |
| 2 | Fresh cross-doc (XD2-1..14) + second sync attack (SA2-1..10) + screens-vs-contracts (SC-1..22) | 15 blockers; D12–D25 adjudicated; lanes R8–R12 | `reviews/2026-07-11-codex-xdoc-round2.md`, `-sync-attack-round2.md`, `-screens-round2.md` |
| 3 | Closure verification (46 findings: 41 closed, 5 remainders) + fresh-drift sweep (FD-1..14) | D26 adjudicated; lanes R13–R14 | `reviews/2026-07-11-codex-round3-closure.md`, `-round3-freshdrift.md` |
| 3b | Coordinator spot-verification of R13/R14 merges | PASS: all D26 items grep-verified in 02; zero retired-name leftovers; every cross-doc section anchor machine-checked and resolving; seeded re-probe corrections folded into 05 | this file |

Independent Claude review (charter's "Codex + independent Claude reviewer"): the round-1
design lanes ran on Claude and every one of their outputs was subsequently adversarially
reviewed by Codex (three rounds); the coordinator (Fable 5) independently reviewed every
reconciliation diff, catching and fixing one relay-metadata privacy regression the lanes
missed. Cross-model coverage is therefore two-way: Claude-written docs attacked by Codex,
Codex-written fixes gated by an Anthropic reviewer.

## Open risks — ACCEPTED at freeze (each named, with the accepting rationale)

1. **Open-workflow API import is unproven; the design ships the guided fallback** (05
   §2.5a). The seeded re-probe (05 §6.4, in flight at freeze) can only UPGRADE fidelity —
   if populated workflow state proves readable, B8 may add an importer path post-wave; the
   fallback remains the contract either way.
2. **Attachments are not API-migratable** (05 §2.5b). Accepted: operator export +
   per-client exported-or-gap accounting; an unflagged absence is defined as a migration
   failure.
3. **Envelope metadata** (D5/03 §2.4): the relay sees recipient, timing, count, and size
   band; padding/batching reduce but cannot eliminate traffic-analysis inference. Accepted
   as the cost of offline encrypted routing; disclosed honestly in-product (04 §10).
4. **A later ethical wall cannot retract an already-delivered/pending envelope** (03
   §2.2). Accepted: honest weaker guarantee; new sends reject, keys rotate, TTL bounds
   informational exposure.
5. **True concurrent scalar edits on money/status fields resolve by HLC LWW** (02 §7.1):
   the losing value survives in the operation record + activity trail, not the field.
   Accepted for ≤10-seat firms; revisit only on pilot evidence.
6. **Wealthbox `updated_since` exact format, deleted-item filters beyond contacts,
   OAuth-vs-token scope differences, rate limits at full-pull scale, CSV rollback
   coverage** (05 §7): simulator-modeled risks, resolved against fabricated fixtures; the
   importer's fidelity gate catches divergence at parallel-run time, never at cutover.
7. **Retention far-end purge policy** (02 §7.5) is a separate, counsel-gated
   specification; v1 ships archive-before-prune with no far-end purge.
8. **Government IDs stay in encrypted vault documents** (02 §7.4); no structured ID field
   without a dedicated redaction-reviewed design.
9. **Parallel-run write-back stays read-only per field until live connector proof** (04
   §16.4, 05 §4.2). Accepted as a build-phase gate, not a design gap.
10. **External sends block when recipient verification is unavailable** (04 §16.5).
    Accepted: safe-refusal is the intended behavior, stated in UI copy.
11. **Attention-versus-fee triage starts without a fee source and SAYS SO** (04 §16.7):
    plain "missing fee data" state; never a silent estimate.
12. **Relay knows which envelopes are retention-exempt** (approval-class flag, 03 §2.3):
    one lifetime bit per envelope, disclosed in 03 §2.4's metadata truth table. Accepted —
    required for D16's durable-approval promise.

## Freeze-time decisions on the docs' open questions

- **06 seat roles (06 §7.1):** the Layer-3 week-script uses the deep-dive's 6-person RIA:
  owner-advisor, associate advisor, two CSAs, ops manager, part-time compliance.
- **06 meeting capture (06 §7.2):** live capture is reused-as-proven; Day 3 exercises only
  CRM downstream behavior (notes/tasks attach correctly).
- **06 fast-check (06 §7.3):** APPROVED as a dev dependency for Layer-1 property tests.
- **02 import note classification (02 §7.2):** default internal; migration wizard offers
  bulk reclassification (04 §11).
- **02 calendar boundary (02 §7.3):** timeline-only import stands; existing subsystems own
  calendar/mail/files (D9).
- **02 custom-role curation (02 §7.6):** unmapped source contact roles import as
  custom-field values; curation is manual via the D23 editors; originals retained in the
  archive.

## What freezes

- `design/00-master-spec.md` — decisions D1–D26 + build-lane map B1–B10 (the wave's
  execution contract).
- `design/01–06` — feature matrix, data model, sync/notifications/propagation, screens,
  migration, test campaign. All headers state conformance to D1–D25/D26.
- `design/evidence/` + `design/reviews/` — the audit trail (append-only; new evidence may
  be ADDED, e.g. the seeded re-probe, without unfreezing).

## What happens next (charter one-shot workflow, step 2)

The build wave launches per 00's build-lane map: 10 Codex lanes, coordinator-merged in
the stated order, one cargo compile at a time, no design-build-test loops. The 06 campaign
is the exit exam and runs only after the whole wave lands. Prerequisite still open at
freeze: a clean quiet-box `npm run gate` baseline (watcher armed; charter status log
tracks it).
