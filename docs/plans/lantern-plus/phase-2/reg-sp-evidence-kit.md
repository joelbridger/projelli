# Phase 2 Brief — Reg S-P Evidence Kit (scoping + evidence ONLY)

## ⚠️ The boundary, stated first

This item is **evidence and scoping, never security controls.** Lantern must NEVER
claim to be an incident-response program, a security product, or "Reg S-P compliance."
Every surface, doc, and marketing line about this feature passes legal review before
shipping (hard gate, non-negotiable). What we sell: when the firm's (externally
defined) program needs to know *what client data exists where and who is affected*,
the advisor's own indexed records can answer in minutes instead of weeks.

## The pain (evidence)

The SEC's amended Reg S-P requires small RIAs (deadline June 3, 2026 — already live)
to maintain a written incident-response program, notify affected customers within 30
days, and oversee vendors — "operational and testable, not merely documented."
Industry coverage: "RIAs scramble to meet Reg S-P compliance deadline"
(WealthManagement). Meanwhile only ~22% of firms use any cybersecurity software at all
(2026 T3 survey, n=2,906). Firms with no security staff now own an enforceable,
unbudgeted obligation. Consultancies charge thousands for the paperwork; no product
turns the advisor's own records into the evidence layer beneath it.

## The product design (plain terms)

Three artifacts, all folding into existing surfaces:

1. **Scoping queries** (the core): given an incident hypothesis ("the laptop that held
   X was lost", "this mailbox was compromised"), answer from the index: which
   clients' data was present, what kinds (SSNs? account numbers? statements?), and
   produce the **affected-customer list** the 30-day notification duty needs — each
   entry cited. This is matter-scoped retrieval pointed at a grim but well-defined
   question.
2. **The Data Map as the vendor-oversight artifact.** Phase 1's printable Data Map
   already answers "everywhere data can go, per confidentiality mode" — extend it
   with a vendor table (AI provider, connectors in use, what each touches) so it
   slots directly into the firm's vendor-oversight file.
3. **Program template as a workflow** — a Word skeleton of a written incident-response
   program with the firm's Lantern-specific facts pre-filled (where data lives, the
   egress posture, the audit log's existence), and blanks clearly marked for the
   firm/counsel to complete. A document head-start, never "your program."

There is also a quiet structural story to tell honestly: a local-first architecture
shrinks the incident surface Reg S-P worries about (no vendor-held client-content
database to breach) — that's positioning for marketing under the existing
honest-claims rules, not a product feature.

## Builds on (Phase 1 rails)

Matter-scoped cited retrieval, the Data Map dialog + print path, the audit log,
Word/workflow templates, the Wave 4 attestation machinery.

## Acceptance / demo moment

"A laptop with the Q1 statements folder was lost." One query → the affected-client
list with citations + the notification-scoping summary as a Word doc. Demo line:
"the 30-day clock starts with an answer, not an archaeology dig."

## What could go wrong

- **Overclaim is existential here** — a false "only these 3 clients were affected"
  could shape a legal notification decision. The output must state scope limits
  in-line ("based on what Lantern indexes; systems outside Lantern are not covered")
  and the honest-limits line throughout. Legal review gate before any release.
- PII-kind detection (SSN/account-number presence) needs precision work; false
  negatives must be described as possible in the artifact itself.
- Template liability: the program skeleton must be unmistakably a starting draft
  ("complete with your counsel"), not legal work product.

## Effort: M — retrieval, Data Map, and templates exist; the new work is PII-kind detection, the scoping composer, and the legal-review pass.

## Open questions for discovery calls

1. Do you have a written incident-response program today, and who wrote it?
2. If a device went missing tomorrow, how would you determine which clients to notify?
3. What did (or would) you pay a consultant for the Reg S-P paperwork?
