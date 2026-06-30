# Connector Feasibility — RightCapital & Jump

**Date:** 2026-06-29 · **Author:** connector/strategy research session (Claude Opus 4.8), public-info-only feasibility pass + an independent Codex pressure-test · **Audience:** Jameson (Board) + future Claude sessions · **Status:** internal, private. **This is research + a recommendation. Nothing was built; no production code was changed.**

> **Plain-language note.** Two pieces of jargon you'll see. A **"connector"** is a one-way pipe that pulls data from some outside tool *into* Advisor Prep Hero and files it under the right client, so Advisor Prep Hero can answer questions about it with citations. An **"API"** is a tool's official doorway that lets another piece of software read its data automatically. The whole question of this report is: do RightCapital and Jump have a doorway Advisor Prep Hero could read through, and — separately — *should* Advisor Prep Hero bother walking through it right now.

---

## TL;DR (read this and you have the answer)

**Two connectors were investigated, both as "fits your stack" plays. The verdict for each:**

**A) RightCapital** (the planning tool that builds the retirement / "will the money last" plan). **Can we build it? Yes, technically — but not on our own schedule.** RightCapital has a real, working **"Partner API"** (an official doorway, OAuth-secured) that its partners use to read a client's goals, income, expenses, and household details. We know it works because Jump and Zocks — two of our competitors — already read from it. **The catch: that doorway is invite-only.** There's no public sign-up, no published manual, no self-serve key. You have to apply to RightCapital and be accepted as a named partner, and they decide if and when. **Should we build it now? No — apply now, build later.** Here's the honest part: an advisor can already *export their RightCapital plan as a PDF into the client's folder, and Advisor Prep Hero reads that today, with zero API*. So the demo already works. Applying for partner access is free and runs in the background; building the live auto-sync connector should wait until a paying advisor specifically asks for it.

**B) Jump** (the meeting note-taker that is also our biggest competitor — the "ride them, don't fight them" idea). **Can we build it? There's nothing to build — and that's the good news.** Jump has *no* public doorway for outsiders to read its data. But it doesn't matter, because **Jump already drops its meeting notes exactly where Advisor Prep Hero already looks.** Jump saves meeting-note PDFs into SharePoint folders and pushes meeting notes into Wealthbox — and Advisor Prep Hero *already* has connectors for both SharePoint and Wealthbox. So when an advisor uses Jump, Advisor Prep Hero already picks up Jump's notes for free, with no "Jump connector" at all. **Should we build a branded "Jump connector"? No — skip it.** Building one would put our biggest competitor's logo in our own product (making us look secondary), and would depend on Jump's goodwill, which Jump can revoke. We already get the upside without any of that.

**The blunt head-to-head — if Jameson builds at most ONE "fits your stack" connector next, which is it?**
> **Neither, as a *new* build right now.** The single integration the strategy already put in scope — **Wealthbox + OneDrive/SharePoint** — quietly delivers *both* of these wins at once: it's the pipe Jump's meeting notes already travel through, *and* it sits right next to where RightCapital's exported plan PDF lands. The highest-leverage move is to make that one path boring-reliable, not to add a new logo. **If forced to invest in one connector beyond that, it's RightCapital** (apply-for-partner-access-now, build-later) — because RightCapital adds genuinely *new* structured plan data the Client Map can't get any other way, the doorway provably exists, and applying is free and async. **Jump is not a build at all** — its value already arrives for free, and a direct Jump connector is a dependency trap with no doorway to build through anyway.

---

## How this was researched (and what I can't verify)

Public information only, per the brief: WebSearch + WebFetch over RightCapital's and Jump's own sites, their help centers, their press releases, and the help articles of partners who already integrate with them (Wealthbox, Zocks, PreciseFP, Capitect). No logins, no auth bypass, no hidden/undocumented endpoints, `robots.txt` respected. Findings were cross-checked against Advisor Prep Hero's own code (`keepance-3.0`) and the existing strategy docs, and the strategic recommendation was pressure-tested by an independent Codex pass.

**The honest limits:** APIs that are partner-gated are, by definition, not fully documented in public — so I can confirm *that* RightCapital's Partner API exists and roughly *what* it carries (from how Jump and Zocks describe using it), but I cannot see its full field list, its rate limits, its exact read-vs-write scopes, or the partner-application terms without applying. For Jump, "no public API" is an absence-of-evidence finding: I found no developer portal, keys, or webhooks anywhere public, which is strong but cannot 100% rule out a private partner API offered under NDA. Confidence levels are stated per finding.

---

# Connector A — RightCapital (financial planning)

## A1. Feasibility — can we build it?

**Verdict: technically yes (the doorway exists and carries the right data), but access is partner-gated — that gate is the binding constraint.**

| Question | Finding | Confidence | Source |
|---|---|---|---|
| Is there an API a third party could read from? | **Yes — the "RightCapital Partner API."** It is explicitly named and used by third-party tools. Jump's help docs say Jump "pushes the approved changes using the RightCapital Partner API" and *reads* "expenses, goals, households, income, and more" for pre-meeting briefs. Zocks syncs to "more than 200 fields in RightCapital." So a third-party AI tool reading and writing a client's plan data through this API is a proven, live pattern. | **High** | [Jump↔RightCapital help](https://help.jumpapp.com/en/articles/11408193-rightcapital-integration), [Zocks↔RightCapital press](https://www.zocks.io/press/zocks-and-rightcapital-announce-ai-powered-integration-to-accelerate-time-to-advice) |
| Is it open to any developer, or partner-gated? | **Partner-gated.** RightCapital's integrations page lists named partners by category (custodians, CRMs, "Data Management" = PreciseFP, Jump, Zocks, etc.). There is **no public developer portal, no published API reference, no self-serve API keys, no webhooks** anywhere public. RightCapital's GitHub org has only two unrelated old forks. Access requires a formal, named partnership. | **High** | [RightCapital integrations overview](https://help.rightcapital.com/integrations/overview), [RightCapital GitHub](https://github.com/RightCapital) |
| Auth model? | **OAuth 2.0, advisor-authorized.** The advisor signs into RightCapital from inside the partner's tool ("a RightCapital login window will open… grant access"). This is exactly the model Advisor Prep Hero wants: the *advisor* consents, the data flows under their own login, no firm-admin/IT approval needed. The partner (Advisor Prep Hero) must hold registered OAuth client credentials issued by RightCapital — i.e. you need to be an approved partner *first*. | **High** | [Jump↔RightCapital help](https://help.jumpapp.com/en/articles/11408193-rightcapital-integration) |
| What data is reachable (for the Client Map)? | **Confirmed reachable:** goals, income, expenses, household/family composition (the *inputs* of the plan), across 200+ fields. **Probable but unverified:** the rendered *outputs* — retirement projections, Roth-conversion modeling, "will the money last" results. The partner integrations all describe syncing plan *data/fields*, not pulling the finished projection charts. Treat plan-data as confirmed; projection-outputs as "verify when you have access." | **High** (inputs) / **Low-Med** (projection outputs) | [Zocks press](https://www.zocks.io/press/zocks-and-rightcapital-announce-ai-powered-integration-to-accelerate-time-to-advice), [advisor-ecosystem-fit doc](./2026-06-23-advisor-ecosystem-fit.md) |
| Is there a no-API fallback? | **Yes, and it already works.** RightCapital produces a PDF plan/report; the advisor exports it into the client folder; Advisor Prep Hero's existing engine indexes the PDF and cites it in the Client Map **today, with no API at all.** RightCapital's data *also* already flows into Wealthbox (real-time notes/tasks sync), so some of it reaches Advisor Prep Hero via the existing Wealthbox connector too. | **High** | [RightCapital→Wealthbox](https://www.wealthbox.com/rightcapital-enhances-wealthbox-integration-with-real-time-notes-and-tasks-sync/) |

**What becoming a partner would take (best public read, no time estimates):** there's no public application form, so step one is simply contacting RightCapital's partnerships team to request Partner API access, the same path PreciseFP/Capitect/Zocks/Jump walked. Expect a named-partner agreement, issuance of OAuth client credentials, and a sandbox/test account. It is a *relationship* gate, not a technical one — and crucially, **a small unproven vendor with no users may not be an attractive partner to RightCapital yet**, which is a real risk to the timeline (you don't control it).

> **Codex pressure-test correction — "free" needs an asterisk.** Applying is free *in dollars*, but not free *in attention*. Because there's no self-serve developer portal, "apply" can turn into security-review questionnaires, sales calls, roadmap promises, and a "come back when you have customers" — real founder time during a 60-day window where the whole point is to spend time *selling*, not vendor-managing. So apply *quietly and lightweight* (one outreach email), don't let it become a project, and don't promise the connector to anyone based on it.

> **Second Codex correction — the API may not expose what Advisor Prep Hero most wants.** Jump and Zocks prove OAuth integration *exists*, but their use of it is mostly *writing data INTO* RightCapital and reading plan *inputs* (goals, income, expenses, household). That does **not** guarantee a partner can cleanly READ the rich plan *outputs* — the finished retirement projections, the Roth-conversion scenarios, the assumptions, or the plan-change history — which is arguably the most valuable part for a Client Map. Treat "we can pull the *plan logic and outputs*, not just the input fields" as an explicit unknown to confirm *before* committing to a build, not an assumption.

## A2. How it would fit Advisor Prep Hero's read-only pattern (a SKETCH, not code)

RightCapital slots cleanly into the existing connector mold (`docs/reference/CONNECTORS.md`). It would look almost identical to the **OneDrive/DocuSign** OAuth connectors that are already "code-complete, gated on vendor credentials":

- **New `source_type`: `"planning"`** — added to `EXTERNAL_SOURCE_TYPE_ALLOWLIST` (today: text, pdf, mail, docx, rtf, xlsx, pptx, transcript, crm, onedrive, esign, meeting). The plan is genuinely a new kind of source, distinct from a generic PDF.
- **Backend module `src-tauri/src/commands/rightcapital/`** mirroring `commands/crm/` (client / engine / model / render / source / commands), following the `*_set_workspace` / `*_connect` / `*_is_connected` / `*_sync*` / `*_cancel_sync` shape.
- **Auth:** OAuth 2.0 PKCE, partner client credentials gated behind a `KEEPANCE_RIGHTCAPITAL_CLIENT_ID` env var (exactly like Salesforce's `KEEPANCE_SALESFORCE_CLIENT_ID` and Redtail's key sit unfilled until the partnership lands); refresh token in the OS keychain (`keepance-planning-rightcapital`). **Read-only scopes only.**
- **Matter map:** `RightCapitalMatterMapEntry { householdId, matterId }` — one RightCapital household → one matter (identical shape to the CRM map). Same most-specific-wins + ambiguity-is-unassigned safety rules.
- **Render → index:** for each household, render goals/income/expenses/family (and projection summaries if reachable) to plain text, then `spawn_external_rag_index(workspace, "rightcapital:<householdId>:<kind>", text, matter_id, "planning")`. Called **directly from the advisor's machine, never via a Advisor Prep Hero server** — same Local-only guarantee as Wealthbox.
- **What it adds to the Client Map:** the one slice nothing else in the stack contributes — the *plan logic* (goals, the retirement trajectory, the cash-flow assumptions), cited, sitting alongside the documents and email. This is real, differentiated content for the "knows the whole household" pitch.

## A3. Strategic fit — should we build it now?

**The case FOR:** RightCapital is the single most valuable *new* data a connector could add. The advisor-ecosystem analysis is explicit that "the plan logic" lives only in RightCapital and that no tool today synthesizes the plan *together with* the documents and email — that synthesis is Advisor Prep Hero's whole wedge. The plan is structured, high-signal, and exactly what you'd want cited in a pre-meeting brief. And it's a clean "fits your stack" story for the ~21%-and-growing slice of advisors on RightCapital.

**The case AGAINST (and why it wins for *now*):**
1. **The strategy says freeze features and keep exactly ONE sales-enabling integration** — already chosen (Wealthbox + OneDrive/SharePoint). A second connector during the 60-day demand test is the "build trap" the strategic memo warns is the #1 founder risk.
2. **You can't build it on your schedule anyway** — it's partner-gated, and a no-traction vendor may not get a fast yes.
3. **The demo already works without it.** "The plan is in the Client Map" is true *today* via the exported PDF. A live API connector adds *convenience* (auto-sync, no manual export), not a new capability. Convenience features have near-zero willingness-to-pay until a user is already hooked.
4. **(Codex flag) RightCapital could pull Advisor Prep Hero into the wrong lane.** If the demo over-centers retirement/Roth/cash-flow *plan* data, Advisor Prep Hero starts to look like an *add-on to planning software* rather than the *private document/client-intelligence layer* that is its actual wedge. The plan should be *one cited source among many* in the Client Map, never the headline. Lead with the document + email pile (the thing nothing else reads); let the plan be a supporting citation.

**Recommendation: PURSUE PARTNER ACCESS NOW (LIGHTWEIGHT), BUILD LATER (and fake-it-in-the-demo today).** Send one short outreach email to the RightCapital partner program now — it's free in dollars and asynchronous, so access (if granted) lands quietly while you run the demand test. Keep it *lightweight*: don't let it become a vendor-management project and don't promise the connector to anyone. In demos and pilots, use the PDF-export path (already works). **Do not write the connector until the demand signal below appears.**

**The customer signal that triggers a build (and *why* — the staleness gap):** the PDF path is demo-good but workflow-weak. The moment an advisor relies on it, they'll ask the questions Codex surfaced — *is this the current plan, which scenario is it, did the assumptions change since I exported it?* That **stale-data risk** is exactly the friction that converts into a build request. So the trigger is: two or three *paying or pilot* advisors who live in RightCapital independently say some version of *"re-exporting the PDF is annoying and I never trust that it's current — I want the live plan to stay synced in Advisor Prep Hero automatically."* Polite "oh that'd be nice" in a discovery call is **not** the signal — it has to come from someone using Advisor Prep Hero weekly.

---

# Connector B — Jump (the incumbent meeting-intelligence competitor)

## B1. Feasibility — can we build it?

**Verdict: there is no direct doorway to build through — but you don't need one, because Jump's output already arrives through doorways Advisor Prep Hero already has.**

| Question | Finding | Confidence | Source |
|---|---|---|---|
| Does Jump expose a public/partner API to READ from (summaries, action items, briefs, transcripts)? | **No public API found.** No developer portal, no API keys, no webhooks, no "build on Jump" partner program anywhere public. Jump is an API *consumer* — it reads/writes to 39 other tools — but it does **not** publicly expose its own data for others to read. (Can't 100% rule out a private NDA partner API, but nothing is public.) | **Med-High** | [Jump integrations](https://jump.ai/integrations), [Jump help center](https://help.jumpapp.com/en/collections/13842287-integrations) |
| Indirect path #1 — does Jump push its notes into the CRM? | **Yes.** Jump "automatically drafts CRM notes, follow-up tasks… then lets you review, edit, and sync them to Salesforce, Redtail, Wealthbox… and dozens more." Those become ordinary Wealthbox/Redtail notes. **Advisor Prep Hero's existing Wealthbox connector already reads them.** | **High** | [Wealthbox+Jump](https://www.wealthbox.com/integrations/jump/), [Jump post-meeting sync](https://jump.ai/products/meet/post-meeting-data-sync) |
| Indirect path #2 — does Jump drop note files into cloud storage Advisor Prep Hero reads? | **Yes — SharePoint.** Jump saves "meeting notes as PDFs directly to your firm's SharePoint folders" (also Google Drive and Box). **Advisor Prep Hero's existing OneDrive/SharePoint connector already reads SharePoint folders.** (Jump→OneDrive specifically is not advertised; Jump→Google Drive/Box would need connectors Advisor Prep Hero doesn't have yet.) | **High** | [Jump SharePoint integration](https://help.jumpapp.com/en/articles/13417352-sharepoint-integration), [Advisor Prep Hero CONNECTORS.md](../reference/CONNECTORS.md) |
| Auth / gating for the indirect path? | **None new.** It uses the advisor's *existing* Wealthbox token and SharePoint OAuth that Advisor Prep Hero already supports. No dependency on Jump granting anything. | **High** | [Advisor Prep Hero CONNECTORS.md](../reference/CONNECTORS.md) |

**The punchline:** the entire "ride Jump, become the synthesis layer over its meeting notes" play is **already live with zero new code.** An advisor running Jump + Wealthbox (the most common pairing) already has Jump's meeting notes flowing into Wealthbox, and Advisor Prep Hero already ingests Wealthbox notes into the Client Map — where they get synthesized with the document and email pile Jump can't see. That *is* the strategy, working for free.

> **Codex pressure-test caveats (two honest limits on the "free" path).** (1) **You only get what the advisor chose to sync.** Jump lets advisors review and select what flows to the CRM — it may be only summaries, only tasks, or only selected notes, not full transcripts, metadata, or every meeting artifact. So Advisor Prep Hero captures the *curated* meeting layer, not necessarily the *complete* one. That's usually fine (the summary is the useful part), but don't claim "we ingest everything Jump produces." (2) **"No connector" still implies a little product work.** To use these notes well, Advisor Prep Hero should *recognize* a Jump-authored note arriving via Wealthbox/SharePoint, preserve the meeting date, link it to the right client, and avoid duplicate imports (the same note can arrive as both a Wealthbox note *and* a SharePoint PDF). That's lightweight cleanup inside the existing connectors — not a Jump connector — and it's the one small thing worth doing here.

## B2. How it would fit the read-only pattern (a SKETCH — and why it's "don't build")

There is essentially nothing to build, and that's the recommendation. For completeness:

- **A *direct* Jump connector** would need a Jump read API that doesn't publicly exist → **not buildable** today, and would create a goodwill dependency on a competitor.
- **The indirect data already lands** as `source_type: "crm"` (Jump's notes inside Wealthbox) and `source_type: "onedrive"` (Jump's PDFs in SharePoint). No new source_type, no new module.
- **The only *optional* polish** (and it's optional): a thin enhancement so the Client Map can *recognize* a Jump-authored note (they arrive with recognizable formatting/attribution) and label its provenance as a meeting/transcript source rather than a generic CRM note. That's a nice-to-have tagging tweak inside the *existing* connectors — **not a "Jump connector,"** and not worth doing during the freeze.

## B3. Strategic fit — should we build it? (be blunt)

**Upside (real):** complement-not-compete is the right instinct. Advisor Prep Hero ingesting Jump's meeting layer and adding document + email synthesis + local-first + Word redline is exactly the competitive report's "don't be a notetaker; be the synthesis layer; ride Wealthbox." The good news is **you already have this upside for free** via the existing connectors.

**Risk/tension (decisive):** building and *marketing* a branded "Jump connector" is a double-edged trap the competitive report flags hard:
- It **legitimizes your biggest, best-funded competitor** and puts Jump's logo in your own product, making Advisor Prep Hero look like a Jump accessory rather than its own thing.
- It creates a **dependency on Jump's goodwill** — and a direct API (if Jump ever opened one) is something Jump could rate-limit, change, or cut off the moment Advisor Prep Hero looks threatening. The competitive report's whole thesis is to lead with what Jump *can't* say (local + the document pile + Word redline), not to hitch to Jump's wagon.
- The indirect path has **none** of these downsides: Jump's notes arrive via the *neutral* hub (Wealthbox/SharePoint), so Advisor Prep Hero never depends on Jump at all, and never has to say "Jump" in its marketing.

**Recommendation: SKIP the dedicated Jump connector — go INDIRECT-ONLY.** Don't build a branded connector. Quietly rely on the fact that Jump's notes already arrive through Wealthbox and SharePoint, plus the small recognition/dedup cleanup noted above. The "ride them, don't fight them" play is best executed without putting Jump's logo in the product.

> **One refinement from Codex on the "never name Jump" stance.** Advisors think in vendor names, so total silence can *under-sell* the capability. The nuance: don't build or market a *branded "Jump connector,"* but it's fine — even helpful — to say in a live demo, *"and it reads the meeting notes you've saved from tools like Jump."* That communicates the benefit in the advisor's own vocabulary without making Advisor Prep Hero look like a Jump add-on or creating any dependency. Mention the *capability*, not a *connector*.

**The customer signal that would change this:** essentially none in the near term. The only world where a direct Jump connector makes sense is if (a) Jump opens a genuine public/partner READ API *and* (b) multiple paying advisors specifically demand Jump-native provenance that the Wealthbox path can't deliver. Neither is true today, and even then you'd weigh it against the dependency risk. For now: indirect-only, no build.

---

## Head-to-head — the one connector question, answered bluntly

**If Jameson builds at most ONE "fits your stack" connector next, which is it — RightCapital, Jump, or neither?**

**Neither, as a new build right now — because the integration already in scope quietly covers both.** The strategy already chose **Wealthbox + OneDrive/SharePoint** as the single sales-enabling "fits your stack" integration, and that one path is doing double duty:
- it's **the pipe Jump's meeting notes already travel through** (Jump → Wealthbox notes, Jump → SharePoint PDFs), so it *is* the Jump play; and
- it sits **right next to where RightCapital's exported plan PDF lands** (the client folder / OneDrive), so the RightCapital plan is already in the Client Map for the demo.

So the highest-leverage move during the 60-day demand test is **not** a new logo — it's making that Wealthbox + OneDrive/SharePoint path boring-reliable on real Windows, which the strategy already calls for. Adding RightCapital or Jump now would be the build-trap.

**If forced to rank the two as future investments, RightCapital wins, clearly:**

| | RightCapital | Jump |
|---|---|---|
| Doorway to build through? | **Yes** — Partner API, OAuth, proven by Jump/Zocks | **No** — no public read API exists |
| Adds *new* data to the Client Map? | **Yes** — the plan logic, available nowhere else | **No** — its notes already arrive via Wealthbox/SharePoint |
| Can you start the access now, free & async? | **Yes** — apply to the partner program | N/A — nothing to apply for |
| Dependency / competitive risk | Low — RightCapital is a neutral planning vendor, not a rival | **High** — depending on / legitimizing your biggest competitor |
| Recommended action | **Apply now, build later (PDF in demo today)** | **Skip the connector; rely on the free indirect path** |

RightCapital is the better *bet* because it adds genuinely new, differentiated content and the doorway provably exists; Jump isn't really a "build" at all (no doorway, and the value is already free). **But neither should jump the queue ahead of making the already-chosen Wealthbox + OneDrive/SharePoint path bulletproof.**

---

## What Jameson should do next (plain and short)

1. **Don't build either connector now.** The strategy's feature-freeze holds. The one integration already in scope (Wealthbox + OneDrive/SharePoint) already delivers both wins — make *that* rock-solid instead.
2. **Apply for RightCapital partner access now — lightweight.** One short outreach email to their partnerships team. It's free in dollars and lands quietly during the demand test, so you're never blocked later — but keep it small (it can turn into security reviews / sales calls / "come back when you have customers"), don't let it become a project, and **don't promise the connector to anyone.** It does **not** mean building anything yet. *(Jameson/Claude task — outreach, not engineering.)*
3. **In demos and pilots, show the RightCapital plan via the PDF-export path** (already works today) — but keep the plan as *one cited source among many*, not the headline, so Advisor Prep Hero doesn't drift into looking like a "planning assistant." Watch whether advisors *push* for live plan sync because the PDF goes stale — that pull is the only thing that should trigger building the RightCapital connector.
4. **For Jump: build no connector and market no "Jump connector."** When a pilot advisor uses Jump + Wealthbox, Advisor Prep Hero is already the synthesis layer over Jump's notes + the docs + the email, for free. In a demo you *can* say "it reads the meeting notes you've saved from tools like Jump" — mention the capability, not a connector.
5. **The one small piece of product work actually worth doing** (when you get to it, not during the freeze): lightweight *recognition* of planning PDFs and Jump-style meeting-note files inside the existing connectors — tag their provenance, preserve dates, de-duplicate — so the Client Map treats them well **without** any new named connector. (Codex's revised concrete step.)

---

## Appendix — confidence & caveats

- **Well-sourced (high confidence):** RightCapital has a named, OAuth-based Partner API used by third-party AI tools to read plan data (Jump and Zocks both document doing it); it is partner-gated with no public dev portal/keys. Jump exposes no public read API but pushes its notes into CRMs (Wealthbox/Redtail/Salesforce) and into SharePoint/Google Drive/Box folders. Advisor Prep Hero already has connectors for Wealthbox and OneDrive/SharePoint.
- **Verify before relying:** RightCapital's exact read scopes, field list, rate limits, and whether *projection/Roth outputs* (not just plan inputs) are reachable — unknowable without applying. The partner-application terms and whether RightCapital will onboard a no-traction vendor quickly. Whether any private Jump partner API exists under NDA (none public). Whether Jump→OneDrive (vs SharePoint/Drive/Box) is ever offered.
- **Pressure-test:** the strategic recommendation was run past an independent Codex (gpt-5.5) pass instructed to attack it. It agreed with the core verdict and sharpened five things, all folded in above: (1) "apply is free" needs an asterisk — free in dollars, costs founder attention, gated on traction; (2) the Partner API may expose plan *inputs* but not the rich plan *outputs* Advisor Prep Hero most wants; (3) the PDF path is demo-good but stale-data-weak (which is *why* the build trigger appears); (4) RightCapital risks pulling Advisor Prep Hero into the "planning assistant" wrong lane; (5) the indirect Jump path captures only what the advisor chose to sync and needs light recognition/dedup/provenance cleanup. Codex's revised stance matched the recommendation: Wealthbox + OneDrive/SharePoint as the only build; apply to RightCapital quietly; do lightweight planning-PDF + meeting-note recognition before any named connector.
- **Source list:** [RightCapital integrations overview](https://help.rightcapital.com/integrations/overview) · [RightCapital integrations (marketing)](https://www.rightcapital.com/integrations/) · [RightCapital GitHub](https://github.com/RightCapital) · [Jump↔RightCapital integration](https://help.jumpapp.com/en/articles/11408193-rightcapital-integration) · [Zocks↔RightCapital press](https://www.zocks.io/press/zocks-and-rightcapital-announce-ai-powered-integration-to-accelerate-time-to-advice) · [PreciseFP↔RightCapital API integration](https://www.prnewswire.com/news-releases/rightcapital-and-precisefp-announce-new-data-integration-to-better-serve-financial-planning-community-301904299.html) · [Jump integrations](https://jump.ai/integrations) · [Jump help center — integrations](https://help.jumpapp.com/en/collections/13842287-integrations) · [Jump SharePoint integration](https://help.jumpapp.com/en/articles/13417352-sharepoint-integration) · [Jump post-meeting data sync](https://jump.ai/products/meet/post-meeting-data-sync) · [Wealthbox + Jump](https://www.wealthbox.com/integrations/jump/) · [RightCapital→Wealthbox real-time sync](https://www.wealthbox.com/rightcapital-enhances-wealthbox-integration-with-real-time-notes-and-tasks-sync/) · Advisor Prep Hero internal: [CONNECTORS.md](../reference/CONNECTORS.md), [advisor-ecosystem-fit](./2026-06-23-advisor-ecosystem-fit.md), [strategic-advisor-memo](./2026-06-28-strategic-advisor-memo.md), [Jump competitive report](../../competitive-analysis/jump-vs-keepance/jump_vs_keepance_competitive_report.md).
