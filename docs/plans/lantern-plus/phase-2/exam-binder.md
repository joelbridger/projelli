# Phase 2 Brief — The Exam Binder (audit evidence on demand)

## The pain (evidence)

Every RIA faces periodic SEC or state exams, and small firms without a dedicated CCO
scramble for weeks assembling what the regulator asks for. Practitioners advise each
other to "ask the regulator for the audit list so you can organize your compliance
files based upon how they will ask for them" (r/CFP exam threads — see the discovery
report's practitioner stream); the IAA compliance-testing survey (n=577) shows the
testing load concentrating in exactly the areas where evidence lives in scattered
files: communications, marketing substantiation, vendor oversight. Severity: episodic
but terror-grade; frequency: universal (every registered firm). Existing answers are
consultants selling hours and generic compliance calendars — no small-RIA product
assembles the evidence from the advisor's own files, locally.

## The product design (plain terms)

One action, run from the Workflows tab (it's a workflow, not a new surface):
**"Prepare an exam packet."** The advisor picks (or pastes) the request list — we ship
templates modeled on the common state/SEC request letters — a date range, and a client
scope (one client, several, or the practice). Lantern then assembles, from what it
already indexes (documents, email, meeting artifacts, CRM notes, the audit log):

- a folder per request item, populated with the matching files/emails/notes, each
  item carrying its source citation;
- a **gap page** per request item where nothing matched ("nothing on file for X" is
  itself exam-critical information the advisor needs before the examiner finds it);
- a cover **manifest as a Word document**: what was gathered, from where, when, by
  what query — the attestation trail, drawing on the same audit machinery Phase 1's
  attestation report uses.

Export = a plain folder tree + the manifest (no proprietary format; it prints, zips,
uploads to wherever the firm's counsel wants it). UI folds per the constitution: a
workflow template + one strip on the run ("Packet ready · 34 items · 3 gaps"), chips
throughout, nothing new to learn.

## Builds on (Phase 1 rails)

Matter-scoped cited retrieval (Ask), the RAG index across docs/email/meetings/CRM,
the Wave 4 attestation/audit machinery (hash-chained log, .docx report generation),
Word export, the Workflows template engine, gap-chip vocabulary.

## Acceptance / demo moment

Load the Northcrest demo workspace, run "Prepare an exam packet" with the shipped
mock request letter, and in under a minute show the examiner-shaped folder tree +
manifest + the honest gaps page. The demo line: "the scramble is now a query."

## What could go wrong

- **Overclaim risk (top):** this is evidence ASSEMBLY, not compliance. Copy must
  never say "exam-ready" or "compliant" — say "organized for your review." The
  Phase 1 honest-claims rules bind.
- Recall isn't perfect; a missed responsive document could breed false confidence.
  The manifest must state the query scope plainly ("searched: indexed documents,
  email, meetings — not: systems Lantern doesn't index").
- Request-letter templates vary by state; ship 2–3 modeled shapes + paste-your-own,
  not a fake comprehensive library.

## Effort: M — assembly of existing rails; the new work is request-list templates, the packet composer, and the manifest.

## Open questions for discovery calls

1. When you were last examined, how did you assemble responses, and how long did it take?
2. Would an "assembled from your own files, with gaps flagged" packet be worth paying for on its own?
3. Who actually handles the exam — you, an outsourced compliance firm, counsel? (Determines who the packet's real audience is.)
