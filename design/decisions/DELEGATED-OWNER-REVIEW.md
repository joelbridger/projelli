# Delegated owner review — how Design Office owner-blocked reviews can be proxied

When the product owner (Jameson) is capacity-limited, reviews blocked on his personal blessing may
be executed by delegation. Canonical protocol (authoritative copy):
`lantern-coordination/prep/DELEGATED-OWNER-REVIEW-PROTOCOL.md`.
First execution + verdict format example:
`lantern-coordination/prep/R4-DELEGATED-OWNER-REVIEW-VERDICT.md` (2026-07-17, 13/14 greenlit).

Essentials the Design Office must honor:
- The proxy is an expert persona bootstrapped from the owner's documented judgment: this office's
  DESIGNER-ONBOARDING → DESIGN-CHARTER → JAMESON-TASTE → DESIGN-SYSTEM → IA-MAP, reviewed against
  the actual spec files — never from generic taste.
- Delegation requires submitted-turn provenance from the owner, relayed by the consultant; the
  coordinator acts only on the consultant's greenlight relay, with the verdict recorded verbatim.
- Agree/bless verdicts proceed as if owner-blessed, with their binding CONDITIONS enforced by
  builders and verified by reviewers. Genuine dissents return to the owner untouched.
- Never delegable: irreversible or customer-visible decisions, brand-level judgment (naming,
  identity, anything a real outside visitor sees — e.g. the public booking page's rendered
  screenshots), and the release-gate drive.
- Provenance in every downstream ceremony reads "delegated-via-expert-review", never "owner
  blessed".
