# Phase 2 Brief — The Tax-Season Pack

## The pain (evidence)

Every January–April, advisors become the reluctant document courier between custodian
tax forms, the client, and the CPA. Practitioners: "tax documents are delivered via an
email notice and people are just not paying attention to emails"; advisors reduced to
scripting "log on, click documents, download them and give them to your CPA" (r/CFP
tax-season threads, discovery report). Some firms build in-house tax arms partly to own
this coordination. Seasonal but sharp, hits every client every year, and tax documents
are maximally sensitive — which makes the local-first angle a selling point rather than
a footnote. Holistiplan reads returns for planning insight; nobody owns the
advisor↔CPA document-coordination grind.

## The product design (plain terms)

A seasonal workflow, again folded into existing surfaces, three parts:

1. **The chase list.** Per client, from what's on file plus last year's pattern:
   which tax documents exist already ("1099-R · arrived Feb 2"), which are expected
   but missing ("no 1099 from the Schwab brokerage account yet"). Rendered as the
   standard gap-chip strip on the client's Map during tax season. This is Phase 1's
   completeness machinery pointed at a season.
2. **Figure extraction.** OCR + extraction over arrived 1099s/consolidated statements
   pulls the headline figures (by form type and account), each figure carrying its
   source chip.
3. **The CPA pack.** One click per client: a Word summary (client header, accounts,
   forms received with dates, extracted figures with citations, known-missing list)
   plus the underlying PDFs in a folder — ready to send via the advisor's own email
   (Wave 0's draft path) so the firm's normal archiving applies.

## Builds on (Phase 1 rails)

OCR + extraction, completeness/gap chips, Word engine, matter-scoped email + document
index, Wave 0 draft-to-mailbox, the seasonal workflow shape from the Workflows tab.

## Acceptance / demo moment

Drop a folder of demo 1099s on a client in February-mode; the chase list fills in,
figures appear with chips, one click produces the CPA pack. Demo line: "tax season
without the twelve-email scavenger hunt."

## What could go wrong

- Extraction errors on figures are worse than no extraction — every figure must carry
  its citation and the pack must say "verify against source documents" (honest-limits
  line, no em dashes).
- Form-type coverage creep: v1 = the common 1099 family + consolidated statements,
  not the whole IRS catalog.
- "Expected but missing" inference needs last year's docs on file; first-season users
  get a thinner chase list — copy must set that expectation honestly.

## Effort: M — extraction rules for the 1099 family are the real work; everything else is assembly.

## Open questions for discovery calls

1. Walk me through last tax season: how did client documents reach the CPA, and where did it hurt?
2. Would your CPA accept a summary pack from software, or do they insist on raw documents only?
3. How many clients' tax documents do YOU touch personally each season?
