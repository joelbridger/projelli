# 7. Beyond parity — the value Jump doesn't have and can't quickly copy

*RECOMMENDATIONS ONLY. Nothing here is a wave plan or a build order; each candidate is
scored so the board can pick. Ground truth: the 2026-07-02 advisor-needs discovery
report (four independent evidence streams: Kitces time-use n=621, T3/Inside Information
2026 n=2,906, Schwab Benchmarking n=1,288, IAA compliance survey n=577, plus r/CFP
practitioner threads and an independent Codex investigation), scored against our actual
rails (cited RAG, OCR, Word engine, completeness scoring, audit log, connectors,
capture, vault).*

## Why this section matters strategically

"Replace Jump" is the opening move, not the game. If all we ever are is "Jump, but
private and cheaper," we're a comparison-page company, and Jump's $80M eventually blurs
our story. The winning arc is: **match the meeting loop (the parity program) → beat it
on trust and price → then carry the advisor's *whole practice* in ways Jump's
architecture can't follow.** Every candidate below deepens the same asset — the client's
real file pile on the advisor's own machine — which is exactly the ground Jump can't
stand on without asking advisors to upload everything to their cloud.

The one-line version for marketing later: *Jump automates your meetings. Lantern carries
your whole practice.*

## Scoring

- **Impact** (1–5): severity × frequency × strength of external evidence that advisors
  feel this pain.
- **Defensibility** (1–5): how hard for Jump specifically — 5 = requires local
  whole-pile architecture or cuts against their business model; 1 = they could ship it
  next quarter in the cloud.
- **Build cost** (S/M/L): honest read against the codebase's existing foundations, per
  the discovery report's effort calls.

## The candidates, ranked

### Tier 1 — do these first (highest impact-per-effort, on-thesis)

**1. Estate/beneficiary mismatch detection** — Impact 5 · Defensibility 4 · Cost S/M
Parse wills, trusts, and beneficiary forms in the client's pile; flag "the trust says X
but the account beneficiary form says Y" and missing-document gaps as Client Map chips.
Evidence: 🟢 multiple independent sources (r/CFP threads; XYPN calls it the most common
early mistake). This is "the E&O claim that ends careers" — every client, high stakes.
Why Jump can't follow fast: it requires reading the actual document pile, which their
cloud would have to ingest wholesale. Why cheap for us: completeness scoring, gap chips,
and OCR already exist; the new work is estate-document extraction rules. **Also the
single best demo moment discovered** ("it caught the stale beneficiary"). **Status:
already decided — Jameson folded this into Wave 4** (deterministic, no-LLM version;
see the Wave 4 plan). Listed here so the scoring context survives; the rest of this
section remains recommendations only.

**2. Exam-packet assembly ("audit binder on demand")** — Impact 5 · Defensibility 4 · Cost M
One action: assemble every record of type X for clients Y over period Z into an
exportable, attested bundle. Every RIA faces SEC/state exams; the scramble is
terror-grade (r/CFP receipts; IAA survey; the independent Codex investigation ranked it
#1). Our rails: RAG + audit log + Word/export engine exist; new work is request-list
templates + bundle export. Jump's version would cover only what lives in Jump; ours
covers the practice's actual records. Compliance consultants charge hours for this
today; no small-RIA product does it locally.

**3. Tax-season pack** — Impact 4 · Defensibility 3 · Cost M
Ingest 1099s and tax docs per client, extract key figures, generate a CPA-ready Word
summary plus a missing-document chase list. Sharp seasonal pain (Jan–Apr, every client,
every year), and tax data is maximally sensitive — local resonates hardest here.
Holistiplan reads returns for *planning*; nobody owns the advisor↔CPA document
coordination grind. Defensibility is a 3 because a cloud vendor could build a version —
but again only on uploaded documents.

### Tier 2 — big bets (very high impact, real builds; start after Tier 1 proves the arc)

**4. NIGO paperwork pre-validation** — Impact 5 · Defensibility 4 · Cost M/L
"NIGO" = not-in-good-order: custodian/transfer/annuity paperwork that bounces for a
missing signature or mismatched data (~25% of industry paperwork, per the discovery
research — the loudest practitioner complaint we found: "it's always the paperwork").
Lantern checks a form against the client's own on-file data *before* submission
("missing signature on page 4; DOB conflicts with the driver's license on file"). Weeks
of delay saved at the exact moment a new client relationship is most fragile. Cost is
M/L because the real work is per-custodian form-rule packs (a content grind — start
with Schwab). Existing enterprise tools (Docupace) serve broker-dealers; nobody serves
the solo/small RIA locally. Jump's Onboard does form *filling* for account opening;
this is form *checking* against the pile — different job, deeper trust.

**5. Reg S-P incident-response evidence kit** — Impact 4 · Defensibility 5 · Cost M
The SEC's amended customer-data rule hit small RIAs in June 2026: they now need a
written incident-response program and 30-day client notification scoping. Lantern turns
the advisor's own records into the evidence layer: program templates, "which clients'
data was touched, whom must we notify" scoping queries, and the printable Data Map as
the vendor-oversight artifact. Defensibility 5 with a twist: **Jump is on the other
side of this rule** — they're a vendor the advisor must oversee; we're the tool that
reduces what needs overseeing. Scope discipline from the discovery report: evidence and
scoping ONLY, not the security controls themselves, and legal review before any
marketing claim (overclaim risk is real here).

### Tier 3 — test before building (evidence or fit is thinner)

**6. Held-away statement parsing** — Impact 3 · Defensibility 3 · Cost M — 401(k)
holdings from uploaded statements into an allocation view, no trading. Real pain, but
the pain is *execution* (which we can't and shouldn't do); Jump already ships holdings
CSV extraction. Test willingness-to-pay in discovery calls first.
**7. Marketing-rule pre-review** — Impact 3 · Defensibility 2 · Cost S/M — a local
checklist pass over draft content before compliance sees it. The chilling effect is
real ("I just don't market 😂"), but archiving — the hard half — can't be local.
**8. Diminished-capacity protocol pack** — Impact ? · Defensibility 3 · Cost S/M —
regulatorily real (FINRA rules on senior investors), but advisors aren't voicing it as
a software gap. Classic solution-in-search-of-demand risk; ask in discovery calls, don't
build.

### Deliberate NOs (recorded so future sessions don't "discover" them)

- **Client-silence/engagement cadences** — CRM-shaped; feeds our "your CRM is your task
  system" stance rather than competing with it.
- **Fee-billing reconciliation** — needs live custodian balances; portfolio-accounting
  shape, not ours.
- **Anything all-in-one.** The market punishes it with receipts ("went with Advyzon and
  now regret it" — r/CFP). Focused-tool-beside-your-CRM is the wedge. This is also the
  discipline that keeps us from becoming the sprawl we're attacking in Jump.

## How this sequences with the parity program

1. **Now:** finish Waves 3–4; touch nothing here (#1 already rides Wave 4's
   completeness work, per Jameson's decision).
2. **At program completion:** pick Tier 1 (#1–#3) as the first "beyond Jump" trio —
   they share the same extraction+templates muscle, they're all demo-friendly, and each
   produces a marketing moment Jump can't answer ("it caught the stale beneficiary,"
   "the audit binder built itself," "tax season in an afternoon").
3. **After first real users:** let discovery interviews (section 6) pick between #4 and
   #5 — both are big; real advisors should rank them.

**Board recommendation:** adopt Tier 1 as the official post-parity roadmap now (as
BACKLOG items, not wave plans), so marketing can honestly say "and here's where it goes
next" in the replace-Jump story without promising vapor.
