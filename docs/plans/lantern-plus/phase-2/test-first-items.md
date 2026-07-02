# Phase 2 Brief — Test-First Items (validate before planning)

*Three candidates where the evidence is thinner or the product fit is partial. None
of these gets a planning session until the discovery-interview campaign produces a
real answer to its validation question. Recorded so they're decided-not-forgotten.*

---

## A. Held-away statement parsing (evidence: 🟡)

**Pain:** tracking held-away 401(k)s/outside assets is a recurring complaint and the
incumbent draws open scorn ("Pontera kind of sucks tbh" — r/CFP). But the pain
advisors voice is substantially about *managing/trading* those assets, which a local
document tool cannot and should not do.

**Design sketch:** upload (or watched-folder) a held-away statement → extraction to
holdings/allocation per account → an "outside assets" section on the Client Map,
citations as always, staleness dating ("statement from March"). Visibility, honestly
framed as visibility. (Jump ships holdings-CSV extraction; ours would be local and
Map-integrated.)

**Builds on:** OCR/extraction, Client Map sourced facts, completeness dating.
**Effort:** M (statement formats are a smaller cousin of the NIGO rules-pack grind).

**Validation question:** *"If Lantern showed held-away holdings from uploaded
statements — current as of the statement date, no trading — is that worth anything to
you, or is trading the whole point?"* Build only if visibility-alone clears
willingness-to-pay.

---

## B. Marketing-rule pre-review (evidence: 🟡)

**Pain:** the SEC Marketing Rule chills advisor marketing ("I just don't market 😂" —
top r/CFP answer). Review overhead is real; but the heavy half of the obligation
(books-and-records archiving of published content) requires immutable third-party
retention a local app must not pretend to provide.

**Design sketch:** a Workflows template — drop a draft post/email/page; a local
checklist pass flags Marketing-Rule tripwires (testimonial language, unbalanced
performance claims, hypothetical-performance markers, missing disclosures) with
citations to the rule text; output is a redlined Word doc for the advisor/CCO. Never
"approved" — always "flagged for review."

**Builds on:** Word redline, workflow templates, honest-claims copy discipline.
**Effort:** S/M (a rules checklist + redline pass; the risk is copy, not code).

**Validation question:** *"Would a pre-review that catches obvious Marketing-Rule
tripwires change how much you publish — or is the archiving/CCO loop the real
blocker?"* Build only if pre-review alone changes behavior.

---

## C. Diminished-capacity / aging-client protocol pack (evidence: 🔴 thin)

**Pain (hypothesized):** regulatorily real (FINRA 4512 trusted-contact, Rule 2165
holds; state equivalents for RIAs), high-stakes when it hits — but practitioners are
NOT voicing it as a software gap (r/CFP nearly silent). Classic
solution-in-search-of-demand risk; the discovery report flags it as hypothesis only.

**Design sketch (if validated):** a per-client protocol layer — trusted-contact on
file? (gap chip if missing), a documented-concern note template that files to the
client with citations and audit trail, and an escalation checklist as a workflow.
Small, mostly assembly.

**Builds on:** gap chips/completeness, note templates, audit log.
**Effort:** S/M.

**Validation question:** *"Have you had a diminished-capacity situation? Walk me
through what you did and where records lived. Would software have changed anything?"*
Build only on multiple unprompted confirmations — this one must be pulled by real
stories, not pushed by regulation.
