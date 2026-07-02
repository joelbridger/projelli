# Beyond Jump: What Advisors Actually Need — Evidence-Based Discovery

*2026-07-02. Four independent evidence streams: (1) studies/surveys (Kitces time-use n=621, T3/Inside Information 2026 n=2,906, Schwab Benchmarking n=1,288, IAA compliance survey n=577); (2) practitioner voices (r/CFP threads with URLs + quotes, XYPN); (3) an independent Codex investigation (`feasibility/research/codex-advisor-pain-discovery.md`); (4) an internal-evidence audit of our own repos. Raw materials in `feasibility/research/`.*

## The honesty header (read before the matrix)

Our repos contain **almost no arm's-length real-advisor evidence** — the internal pain
catalog is persona simulation and desk research, and our own docs say so ("rests on a
single advisor," "unproven need"). This report therefore leans on EXTERNAL evidence,
and its strongest signals are where external evidence independently confirms an
internal hypothesis. The staged-but-never-launched discovery-interview campaign
(`~/keepance/docs/marketing/campaigns/2026-06-advisor-first-users/DISCOVERY-INTERVIEW.md`)
remains the missing instrument; this report doubles as its hypothesis sheet.

## The headline finding

**The product's existing thesis just got externally validated.** The single largest
documented advisor time-drain is meeting/plan prep — 26% of advisor time vs 19% in
actual client meetings (Kitces, n=621) — and Kitces explicitly finds planning software
makes advisors "better, not faster." Nobody owns prep-time compression. That is Wave 1.
Likewise "client document chaos" (the r/CFP shoebox joke) is the core product, and the
market's documented hatred of bloated all-in-ones is the board's anti-Jump stance with
practitioner receipts. **The biggest discovery isn't a new feature — it's confirmation
the aim is right.**

## Impact × Effort matrix (new opportunities only)

*Impact = severity × frequency × evidence strength. Effort = against our actual rails
(cited RAG, OCR, Word engine, completeness scoring, audit log, connectors, templates).
Evidence class: 🟢 = multiple independent external sources; 🟡 = moderate/one strong
source; 🔴 = thin (internal hypothesis or single voice).*

### 🎯 QUICK WINS — high impact, small/medium effort, whitespace

| Opportunity | Evidence | Impact | Effort | The whitespace |
|---|---|---|---|---|
| **1. Estate/beneficiary mismatch detection** — parse wills/trusts/beneficiary forms; flag "trust says X, account beneficiary says Y" + missing-doc gaps as Client Map completeness chips | 🟢 (r/CFP threads; XYPN "most common early mistake"; internal wow-moment hypothesis confirmed) | HIGH — "the E&O claim that ends careers"; high-stakes, every client | **S/M** — completeness scoring + gap chips + OCR already exist; add estate-doc extraction rules | Holistiplan/Vanilla do estate *planning*; nobody does local mismatch-audit across the actual document pile |
| **2. Exam-packet assembly ("audit binder on demand")** — one action: assemble every record type X for clients Y over period Z into an exportable, attested bundle | 🟢 (r/CFP exam-scramble threads; IAA testing survey; Codex rank #1) | HIGH — episodic but severe; every RIA faces exams; terror-grade anxiety | **M** — RAG + audit log + Word/export rails exist; new work = request-list templates + bundle export | Compliance consultants sell hours; no small-RIA tool assembles evidence from the advisor's own files, locally |
| **3. Tax-season pack** — ingest 1099s/tax docs per client, extract key figures, generate a CPA-ready Word summary; missing-document chase list | 🟢 (r/CFP; seasonal, sharp; tax data maximally sensitive → local resonates) | MED-HIGH — seasonal spike (Jan–Apr), every client, every year | **M** — OCR + extraction + templates exist; new = 1099-form field rules + the seasonal workflow | Holistiplan reads returns for planning; nobody does the advisor↔CPA document-coordination grind |

### 🏗️ BIG BETS — high impact, real builds

| Opportunity | Evidence | Impact | Effort | The whitespace |
|---|---|---|---|---|
| **4. NIGO paperwork pre-validation** — check custodian/transfer/annuity forms against the client's own on-file data before submission ("missing signature; DOB conflicts with the driver's license on file") | 🟢 (THE loudest practitioner pain: "always the paperwork"; ~25% industry NIGO rate) | VERY HIGH — weeks of delay per bounce, at the relationship's most fragile moment | **M/L** — OCR + per-client data exist; new = per-custodian form-rule packs (a content grind, start with Schwab) | Docupace et al. are enterprise/BD tools; no local-first solo/small-RIA pre-flight check exists |
| **5. Reg S-P incident-response evidence kit** — written-program template + "which clients' data was touched, whom must we notify in 30 days" scoping queries + the printable Data Map as the vendor-oversight artifact | 🟢 (June 2026 small-RIA deadline; "RIAs scramble" coverage; only ~22% own any security tooling) | HIGH + URGENT — new, enforceable, unbudgeted obligation | **M** — Data Map/audit/isolation exist; new = program templates + scoping queries. NOT the security controls themselves — evidence and scoping only (overclaim risk; legal review) | Compliance consultancies charge $5-15k; no product turns the advisor's own records into the evidence layer |

### 🧪 TEST FIRST — promising but evidence or fit is thinner

| Opportunity | Evidence | Impact | Effort | Why wait |
|---|---|---|---|---|
| 6. Held-away statement parsing (401k holdings from uploaded statements → allocation view; no trading) | 🟡 (real pain, Pontera scorned — but the pain is *execution*, which we can't do) | MED | M | Test whether visibility-without-trading is worth paying for; Jump ships holdings-CSV already |
| 7. Marketing-rule pre-review (local checklist pass over draft content before compliance sees it) | 🟡 ("I just don't market 😂" — chilling effect is real; fit is partial) | MED | S/M | Archiving (the hard half) can't be local; test if pre-review alone changes behavior |
| 8. Diminished-capacity/aging-client protocol pack | 🔴 (regulatorily real — FINRA 4512/2165 — but advisors aren't voicing it as a software gap; r/CFP nearly silent) | UNKNOWN | S/M | Classic solution-in-search-of-demand risk; ask in discovery calls |

### 🚫 REAL PAINS, WRONG SHAPE FOR US — do not build

- **Client-silence/engagement cadences** (🟢 pain, CRM-shaped — feeds the "CRM is your task system" stance)
- **Fee-billing reconciliation** (🟡, needs live custodian balances — portfolio-accounting shape)
- **Decumulation planning engines, cybersecurity controls proper** (🟢 gaps, entirely different products)
- **Anything all-in-one.** The market explicitly punishes it ("went with Advyzon and now regret it"). Focused-tool-beside-your-CRM is the safe wedge — with receipts.

## Recommendation

1. **Don't stuff these into Waves 0–4.** The program is scoped, Codex-reviewed, and
   design-approved; scope creep now delays the thing these opportunities depend on.
   **One exception worth taking:** #1 (estate/beneficiary mismatch) is small enough to
   ride Wave 4 beside the completeness scoring it extends — and it's the single best
   demo moment discovered ("it caught the stale beneficiary").
2. **Create Phase 2 from this matrix** (quick wins #2, #3 → big bets #4, #5) — added to
   `BACKLOG.md` as the post-parity roadmap, each tagged with its evidence.
3. **Run the discovery interviews.** The campaign is fully staged and was never fired.
   This report is the hypothesis sheet; ten Mom-Test calls with arm's-length advisors
   (XYPN/NAPFA + design-partner peer intros) are worth more than any further research.
   Priority questions: does the recall pain reach wallet-out (the June memo's unknown #1);
   NIGO pre-validation willingness-to-pay; exam-binder emotional pull; diminished-capacity
   reality check.
4. **The story for marketing writes itself:** Jump automates your meetings; Lantern
   carries the whole practice — prep, paperwork pre-flight, the audit binder, tax season —
   on your own machine. The matrix above is the "second act" roadmap that makes
   head-on-with-Jump a starting point, not the destination.
