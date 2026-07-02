# Phase 2 Brief — NIGO Paperwork Pre-Validation

## The pain (evidence)

The loudest practitioner pain found in the entire discovery: custodian/transfer/annuity
paperwork bouncing back "not in good order." Verbatim from r/CFP: "if one line isn't
filled out properly, the whole form gets returned as a NIGO"; "rejected or NIGO docs
can add 1–2 weeks every time they bounce back"; the top answer to "where do errors slip
through" — "Paperwork. Always the paperwork." Industry benchmarks put NIGO rates at
~25% before automation (vendor figure, directional). The rework lands at the most
fragile moment of the relationship: onboarding. Existing tools (Docupace, Advisor360)
are enterprise/broker-dealer suites; nothing serves the solo/small RIA, and nothing
runs locally over the client's actual on-file data.

## The product design (plain terms)

**A pre-flight check, not a form filler** (form-filling is Jump's Onboard lane and a
custodian-relationship business; checking is a document-intelligence business — ours).
The advisor drops the completed application PDF (or scan) on the client:

- Lantern reads the form (OCR + field extraction) and checks it three ways:
  **completeness** (required fields empty, signature/date lines blank), **internal
  consistency** (page 2 SSN differs from page 5), and **consistency with what's
  already on file** for that client (DOB conflicts with the driver's license on file;
  address differs from the CRM; account title doesn't match the trust name on file).
- Findings render in the product's tracked-changes language: a review card on the
  client — "3 issues before this goes out" — each row citing both sides (the form
  field AND the on-file source chip).
- Cleared forms get a quiet "pre-flight passed · checked against 14 on-file facts"
  line the advisor can keep with the file.

**The rules-pack reality (named honestly):** per-custodian form knowledge is a CONTENT
grind, not an engineering trick — each custodian's forms need field maps + requirement
rules, which change. Strategy: ship **Schwab first** (largest RIA custodian; its forms
are the demo), structure rules as data packs (the template-marketplace pattern) so new
custodians/versions ship without app releases, and support a generic mode (completeness
+ internal consistency + on-file cross-check work on ANY form even without a pack).

## Builds on (Phase 1 rails)

OCR + extraction, per-client sourced facts (Client Map), CRM-read data, the
tracked-changes review-card vocabulary, the template marketplace's pack
distribution shape, audit log.

## Acceptance / demo moment

A deliberately flawed demo Schwab application: missing signature on page 4, DOB
mismatching the on-file license, account title missing the trust suffix. Three
findings, each citing both sides. Fix, re-drop, "pre-flight passed." Demo line:
"the two-week bounce, caught before it left your desk."

## What could go wrong

- **The content grind is the project.** Underestimating rules-pack maintenance is the
  failure mode; plan must include the pack-update pipeline, not just the checker.
- Form-version drift: packs must declare the form revision they know and say so when
  a newer revision arrives ("unknown revision - generic checks only").
- Overclaim: "pre-flight passed" must never imply the custodian will accept it —
  copy: "checked against what's on file; the custodian makes the final call."
- OCR quality on faxed/scanned forms; confidence thresholds must fail toward "couldn't
  read page 3" rather than false assurance.

## Effort: M/L — the checker is M on existing rails; the Schwab rules pack + pack pipeline is the L-ward pull.

## Open questions for discovery calls

1. How many NIGO bounces did you eat in the last quarter, and on which custodian's forms?
2. Who fills the forms today — you, staff, or the custodian's digital flow? (If digital flows are winning, the pain may be migrating.)
3. Would you trust a local pre-flight enough to skip your own manual recheck?
