# Connector Access Options — RightCapital & Jump (Every Way *Beyond* the Official API)

**Date:** 2026-06-29 · **Author:** connector-access research session (Claude Opus 4.8) — three parallel public-web research passes + an independent Codex (gpt-5.5) brainstorm, then a Codex pressure-test of the recommendation · **Audience:** Jameson (Board) + future Claude sessions · **Status:** internal, private. **This is research + a recommendation. Nothing was built; no production code changed.**

> **This extends, does not repeat, the earlier feasibility doc.** The companion file [`2026-06-29-connector-feasibility-rightcapital-jump.md`](./2026-06-29-connector-feasibility-rightcapital-jump.md) already answered the narrow API question (RightCapital has a gated Partner API; Jump has none; the export-PDF path works today). **This file answers the wider question Jameson actually asked:** *beyond the official API, what are ALL the other ways Advisor Prep Hero could connect to — or simply acknowledge and read the OUTPUT of — these two programs, automatically?* I enumerated every vector, researched each, and recommend the best legitimate near-automated path for each tool, plus exactly what Advisor Prep Hero can honestly *say*.

---

## Plain-language note (a few terms you'll see)

- **Connector** — a one-way pipe that pulls data from an outside tool *into* Advisor Prep Hero, files it under the right client, and makes it answerable with citations.
- **API** — a tool's official software "doorway" that lets other software read its data automatically.
- **Ride the destination** — instead of reading the source tool, read the place the source tool *already drops its output* (a CRM, a cloud folder). Advisor Prep Hero already reads several of those places.
- **Watched folder / watched mailbox** — a folder or email inbox Advisor Prep Hero keeps an eye on; anything that lands there gets pulled in automatically.
- **iPaaS (Zapier / Make)** — a "robot plumber" service: *"when X happens in tool A, do Y in tool B."* No code; the advisor sets it up once.
- **Scraping / browser automation** — software that reads or clicks through a website's screen automatically. When it's done *behind a login*, it carries real legal and security baggage (covered honestly below).
- **ToS** — a tool's Terms of Service: the rules you agree to when you use it. Breaking them is a *contract* problem even when it isn't a *criminal* one.

---

## TL;DR — the answer in two boxes

The honest headline: **the two tools need two different shapes, because their valuable output sits in two different places.**

> **A) RIGHTCAPITAL → ride its EXPORT.** RightCapital's real value (the plan — retirement, cash-flow, tax, net-worth) is **not** pushed anywhere rich. Its sync to Wealthbox/Redtail only carries thin "I added a note/task" activity, **not** the plan itself. But RightCapital has a strong, built-in **"download the plan as a branded PDF"** feature (and a few CSV exports), and one of its download buttons literally saves a copy to a folder. So the best legitimate automated-ish path is an **"Export Inbox": the advisor saves the RightCapital PDF into a folder Advisor Prep Hero watches** (ideally their OneDrive/SharePoint client folder, which Advisor Prep Hero *already* reads — making it hands-free after setup). Advisor Prep Hero recognizes it as a plan, files it to the right client, and shows a **"last exported on…" freshness label** so nobody mistakes a snapshot for live data. Keep applying for the Partner API quietly in the background (per the prior doc) — but you do **not** need it to credibly say *"Advisor Prep Hero reads your RightCapital plan."*

> **B) JUMP → ride its DESTINATIONS (now incl. a Zapier bridge).** Jump's real value (the meeting notes) **is** pushed to places Advisor Prep Hero reads or can reach. It already lands as rich notes in **Wealthbox** (which Advisor Prep Hero reads today) and as PDFs in **SharePoint** (which Advisor Prep Hero reads today), plus **Google Drive and Box** (which it doesn't yet). And — a new finding since the last doc — **Jump now publishes Zapier triggers** ("Note Finalized," "Meeting Processed"), so the advisor can set up a recipe that drops every finished Jump note into **OneDrive or a watched mailbox**, closing the OneDrive gap with zero Advisor Prep Hero code, zero Jump credentials, zero scraping. **One honest caveat (Codex caught this):** Zapier is *itself a cloud service the client's note passes through* (held in Zapier's US servers, ~29–69 days), and the useful version needs a *paid* Zapier plan — so it's a **fallback the firm must approve, not the hero.** The notes that arrive natively through **Wealthbox and SharePoint come first.** So the Jump answer is **"Jump notes everywhere": recognize Jump-authored notes wherever they already arrive, with Zapier as an optional add-on for firms that already use it.** Build no branded "Jump connector."

**The single highest-leverage build that serves BOTH:** make Advisor Prep Hero's **folder-and-mailbox ingestion + "this came from RightCapital / Jump" recognition + freshness labelling** boring-reliable. Both tools' best legitimate path ends in *a file landing in a folder or inbox Advisor Prep Hero already watches.* One solid pipeline covers both — and it's the lightest, cheapest, lowest-risk option on the board, which is exactly what the 2026-06-29 board stance ("simple AI app, win on the document pile, lightest mechanism, not integration breadth") asks for.

**And the blunt warning:** the vectors that *sound* the most magical — a browser extension that reads the advisor's logged-in RightCapital/Jump screen, or screen-capture/OCR of their UI — are the **worst** choices. They're brittle (break on every UI change), they sit in live legal-contract risk (logged-in automation is *not* protected by the scraping case law), they'd make Advisor Prep Hero a juicy hacking target, they create a compliance burden under the SEC's privacy rule for the exact advisors you're courting, **and they directly violate Advisor Prep Hero's own stated value** (its CLAUDE.md lists *"web scraping/crawling"* as out of scope). For a product whose entire pitch is *"provably private,"* shipping a scraper is self-sabotage. Don't.

---

## The big picture: why two tools need two shapes

Picture each tool as a factory. We want what comes off the line.

- **RightCapital's factory** keeps its best product (the finished plan) *inside the building.* It mails a postcard ("the advisor updated a note") to the CRM, but not the product. The only way to get the actual plan out is to **print it** — which RightCapital makes easy (a polished PDF, optionally dropped straight into a folder). So you collect the printout.
- **Jump's factory** *ships its product out the door by default.* The finished meeting note is automatically trucked to the CRM and to cloud folders. You don't need to get inside the building — you just **stand where the trucks already deliver.** And Jump even added a new loading dock (Zapier) that can deliver to an address of your choosing.

That's the whole strategy in one image. **Collect RightCapital's printout; stand at Jump's loading dock.** Everything below is the detailed map and the honest risk read behind those two moves.

---

## How this was researched (and what's unverified)

Public information only: WebSearch + WebFetch over both vendors' help centers (help.rightcapital.com, help.jumpapp.com), their marketing/integration pages, partner help docs (Wealthbox, Redtail, Zapier), plus legal/security sources (court opinions, EFF, law-firm analyses, regulator summaries) — no logins, no auth bypass, robots.txt respected. Three Claude research passes ran in parallel (native exports; destinations + iPaaS + webhooks; the legal/security/aggregator landscape), an independent Codex brainstorm enumerated the same vectors from a different model's blind spots, and a final Codex pass attacked the recommendation. Findings were cross-checked against Advisor Prep Hero's own connector code on `keepance-3.0` ([`docs/reference/CONNECTORS.md`](../reference/CONNECTORS.md)).

**What Advisor Prep Hero reads *today* (the baseline that decides which vectors are "free"):** Email (Outlook/M365, Gmail, IMAP) · **Wealthbox** CRM · **OneDrive/SharePoint** cloud files · Calendly. Code-complete but credential-gated: DocuSign, Salesforce, Redtail. Source-type allowlist: `text, pdf, mail, docx, rtf, xlsx, pptx, transcript, crm, onedrive, esign, meeting`.

**Honest limits:** RightCapital's and Jump's exact Terms-of-Service language could not be fully confirmed (RightCapital's `/terms` returned a 404; Jump's results mixed with similarly-named companies) — so the ToS-risk reads below lean on the strong industry norm plus the relevant case law, and are labelled as inference where they are. Partner-gated APIs are not publicly documented, so field lists and webhook availability are "absence of public evidence," not proof of absence. Confidence is stated per finding.

---

# The full menu — 11 access vectors, assessed for each tool

Each vector gets: **how it works**, **automation level** (Full / Semi / Manual-assisted), **feasibility & reliability**, **honest ToS/legal/security risk**, and **what it actually yields**. Vectors are ordered roughly best-to-worst for *this* product.

### Vector A — The official API *(baseline, covered by the prior doc)*
- **RightCapital:** a real OAuth **Partner API** exists (Jump and Zocks use it) but is **invite-only** — no public portal/keys. *Apply quietly, build later.* Confirmed reachable: plan inputs (goals/income/expenses/household). Plan *outputs* (projections/Roth) unverified.
- **Jump:** **no public/partner read API** exists. Nothing to apply for.
- **Risk:** none (it's the sanctioned path). **Yield:** richest, but gated/absent. **Verdict:** RC = pursue in background; Jump = N/A.

### Vector B — Native export / report files *(the RightCapital winner)*
- **How it works — RightCapital:** the **Report Builder** (Gear → Report) lets the advisor tick any plan modules (Snapshot, Retirement Analysis, Cash Flows, Tax Strategies, Blueprint, Estate, Insurance, Education, Net Worth, Custom Pages) and click **"Download selected pages"** → one compiled, firm-branded **PDF**. A dropdown also offers **"Download and Save to Vault"** (saves a copy to the client's RightCapital Vault *and* downloads locally). Plus narrow **CSV** exports: the detailed **Balance Sheet** and **RightIntel "Opportunities"** tabs (Premium/Platinum). No XLSX/DOCX/JSON/TXT.
- **How it works — Jump:** **"Export Notes"** → a customizable **PDF** of the meeting note (toggle logo/title/attendees); a **"Copy"** clipboard button (plain text); **CSV** only on the aggregate Insights Dashboard (analytics, not note content); downloadable **audio/video** recording; transcript is **view + clipboard-copy only — no file download.** (All of copy/download can be switched off firm-wide by Jump's compliance settings.)
- **Automation:** Manual-assisted (a human clicks "export/save"). Becomes **Semi → effectively Full** if the export lands in a synced cloud folder Advisor Prep Hero already watches.
- **Feasibility/reliability:** High and stable — these are first-class product features, not hacks. PDFs are exactly what Advisor Prep Hero's pile ingests; text-extraction from a clean vendor PDF is reliable.
- **Risk:** **Low — and lower than everything below it, but not literally zero (Codex's sharpest catch).** The advisor exports *their own* data through a *supported* feature, so there's no scraping/security exposure. But the export is only the *start* of the chain — Advisor Prep Hero then stores it in a local **RAG index, which is literally an "information storage and retrieval system,"** and RightCapital's *advisor* terms reportedly restrict storing platform materials in such a system without permission, and restrict letting the output be used by another party to provide services. That's close enough to *"export the plan PDF → index it in Advisor Prep Hero"* that it deserves **careful wording + a one-time firm-consent step**, not a "legally frictionless" claim. (RightCapital's exact terms couldn't be fully confirmed publicly — treat this as a flag to verify, not a settled fact.) Net: still by far the *least-bad* route, just not a clean one. See the legal caveat under the recommendations.
- **Yield:** **RightCapital — the rich, real plan** (the one thing nothing else surfaces). **Jump — the full note** (but a manual export when better automatic paths exist). **Verdict:** **RC = best legitimate path. Jump = good fallback only.**

### Vector C — Ride the destination *(the Jump winner)*
- **RightCapital:** pushes **notes + tasks** (real-time, one-way) into **Wealthbox** and **Redtail** since Apr 2025 — Advisor Prep Hero reads Wealthbox today, so it gets this **for free.** *But this is thin:* only the planning *activity* the advisor logged, **not** the plan itself. **No** cloud-storage destination at all (no SharePoint/OneDrive/Drive/Box). So riding the destination gives RightCapital *breadcrumbs, not the meal.*
- **Jump:** pushes **rich notes + tasks + workflow + CRM-field updates** into **Wealthbox / Redtail / Salesforce + ~9 other CRMs** (semi-auto: advisor approves, one click), and saves **note PDFs** to **SharePoint (beta), Google Drive, and Box.** Advisor Prep Hero already reads **Wealthbox + SharePoint** → **the valuable Jump output already arrives for free** for the most common firm setups. Google Drive + Box are not yet read by Advisor Prep Hero.
- **Automation:** Full (after the advisor turns the destination on once). **Reliability:** High via CRM; SharePoint sync is still beta and partly per-meeting-manual; Drive is auto, Box is per-meeting-manual.
- **Risk:** **None** — neutral hubs, the advisor's own tokens, no dependency on RightCapital or Jump granting Advisor Prep Hero anything.
- **Yield:** **Jump — its real notes. RightCapital — only activity breadcrumbs.** **Verdict:** **Jump = best legitimate path. RC = a free bonus layer, not the main course.**

### Vector D — Email-based (auto-forward to a watched mailbox/folder)
- **RightCapital:** sends advisors only a **daily activity-digest** email (and immediate notification pings) — **no plan PDF is ever attached.** So forwarding RightCapital email yields *notifications, not content.* Weak.
- **Jump:** the **client recap email** is auto-*drafted* but **manually sent** by the advisor (not a reliable auto-feed); notification emails ("meeting processed") are **content-free pings.** So email gives a useful *signal that a note exists* but rarely the note itself — unless paired with Zapier (below).
- **Automation:** Semi (needs a forward rule). **Risk:** Low-to-medium (the advisor is moving their own mail; watch email-retention/compliance norms). **Yield:** thin for both. **Verdict:** supporting signal only; not a primary path.

### Vector E — Browser automation with the user's OWN logged-in session ("you log in, we read your own screen") ⚠️
- **How it works:** a Advisor Prep Hero browser extension or local automation reads the DOM / clicks through the advisor's already-authenticated RightCapital or Jump tab and extracts the plan/notes. Precedents exist (the "polite scraper" extension pattern; FINTRX's advisor extension; SaaS-session-reading tools), and credential/screen-scraping built the whole account-aggregation industry (Yodlee, early Plaid, MX, Finicity).
- **But that industry spent the last five years *fleeing* this model** toward sanctioned OAuth/API access (FDX): Fidelity banned screen-scrapers in 2023, Jack Henry moved to eliminate it, Plaid pledged to migrate the majority of its traffic off scraping — driven by security breaches, ~30%+ breakage rates, and regulator hostility. Copying the pattern they're abandoning is the wrong side of history.
- **Automation:** Semi/Full. **Reliability:** **Poor** — any UI change silently breaks it; permanent maintenance tax with no version guarantee.
- **Risk — HONEST and HIGH:**
  - **Legal/ToS:** the criminal-hacking law (CFAA) is *narrow* after *Van Buren* (2021) — a ToS violation alone isn't a crime. **But the live threat is breach of contract.** *hiQ v. LinkedIn* ultimately died on a **contract** claim ($500K consent judgment), and *Meta v. Bright Data* (2024) only protected **logged-OUT** scraping of public data — it pointedly **did not** immunize **logged-IN** automation, which is exactly this vector. Standard SaaS terms ban "automated access" broadly enough to cover a local DOM-reading extension; no court has cleanly blessed it. A law-firm alert aimed *at investment advisers* specifically warns that scraping sites where you hold an account "requires particular diligence." So: **real contract exposure for the advisor (account termination, possible suit), and for Advisor Prep Hero as the tool-maker.**
  - **Security:** the 2024 **Cyberhaven** breach (a poisoned extension update hit 2.6M users and exfiltrated session tokens that bypass MFA) is the cautionary tale. An extension reading the advisor's RightCapital + Jump sessions makes **Advisor Prep Hero itself a high-value target** that concentrates access to many advisors' client systems.
  - **Compliance:** under the SEC's updated **Reg S-P (2024)** + the GLBA Safeguards Rule, an advisor using Advisor Prep Hero to auto-access client systems would have to treat Advisor Prep Hero as a **regulated service provider** (vendor oversight, 72-hr breach notice). Automated third-party access can itself read as an *inadequate safeguard.*
  - **Identity:** Advisor Prep Hero's own product values list *"web scraping/crawling"* as **out of scope.** Shipping this contradicts the brand.
- **Verdict:** **Reject for both.** Highest risk, lowest reliability, off-brand. Worse for Jump than RightCapital (Jump already exports cleanly, so there's no excuse).

### Vector F — Screen capture / OCR of their UI ⚠️
- **How it works:** screenshot or capture the RightCapital/Jump screen and OCR it into text. Advisor Prep Hero even *has* an OCR engine (Tesseract) already, for documents.
- **Automation:** Semi/Full. **Reliability:** **Bad** — charts, scroll state, and hidden fields don't OCR cleanly, hurting citation quality; and to reach the right screen you must *navigate automatically*, which is the same automated-access ToS problem as Vector E.
- **Risk:** **High** — getting to the screen is automated access (ToS-covered); OCR-extraction is "extracting data by automated means" under any reasonable terms; no case law carves out "pure OCR of an authorized screen."
- **Yield:** lossy, low-trust. **Verdict:** **Reject for both** — internal-demo curiosity at most, never a shipped, customer-facing feature. (OCR stays where it belongs: reading the advisor's *own* documents in the pile.)

### Vector G — Data aggregators / feeds (Plaid-like, custodian, advisor data-warehouse)
- **Finding:** the big advisor aggregators (Morningstar **ByAllAccounts**, Envestnet/**Yodlee**) carry **account/holdings data only** — they do **not** carry RightCapital's *plan* or Jump's *notes.* Custodian (Schwab) feeds are likewise account data, and flow *into* these tools, not out. The only RightCapital "data portability" that exists is **bilateral formal partnerships** (e.g., PreciseFP↔RightCapital) — not something an outsider can tap. No third-party aggregator resells Jump notes.
- **Risk:** medium (compliance/vendor access) and it's pure **integration breadth** — the thing the board said *not* to chase. **Yield:** wrong data entirely (numbers, not plan/notes). **Verdict:** **Reject for both** — doesn't carry the data we want, and off-strategy.

### Vector H — iPaaS / integration marketplaces (Zapier / Make / Workato) *(the Jump bridge)*
- **RightCapital:** **no Zapier/Make/Workato app** found. Dead end.
- **Jump:** **has a published Zapier app** with five **triggers** — *Meeting Processed, Meeting Scheduled, Note Created, Pre-Meeting Prep Generated, New Task Created.* (Triggers only, no actions yet — meaning Zapier can *react to* Jump events, which is exactly what we need.) An advisor can build a one-time Zap: **"when a Jump note is finalized → save the note to OneDrive"** (a folder Advisor Prep Hero already reads) **or → email it to a Advisor Prep Hero-watched mailbox.** This is the clean way to close the **Jump→OneDrive gap** and to capture Jump notes for firms not on Wealthbox/SharePoint.
- **Automation:** Full after setup. **Reliability:** High (Zapier is stable; Jump publishes the triggers). **Risk:** **Low–Med — and this is the catch (Codex):** it's Jump's *own sanctioned* surface so there's no scraping, **but Zapier is a *new cloud processor* the client's meeting note now flows through and sits in** (Zapier stores content in US AWS, retaining Zap content/history ~29–69 days). For a privacy-anxious advisor that's a **Reg S-P vendor-oversight item** the firm must approve — it quietly *adds* a cloud vendor to the very stack Advisor Prep Hero's pitch is about minimizing. Plus practical gates: the triggers are **read-only** (Zapier can't push *into* Jump), useful routing (filters, formatting, client-matching) needs a **paid Zapier plan**, and OneDrive-on-Zapier requires **Microsoft 365 Business/Enterprise** (not a consumer OneDrive). So it's neither free nor frictionless.
- **Yield:** the real Jump note, routed to where Advisor Prep Hero reads. **Verdict:** **Jump = useful OPTIONAL fallback for firms already on Zapier — not the hero path; prefer the native Wealthbox/SharePoint arrival. RC = unavailable.**

### Vector I — Webhooks / push
- **RightCapital:** Partner API is **inbound-write only** for partners; **no public outbound webhook.** None.
- **Jump:** no documented native outbound webhook to arbitrary URLs — **Zapier (Vector H) is effectively its push mechanism.** **Verdict:** use Zapier for Jump; nothing for RightCapital. (And a raw Advisor Prep Hero webhook endpoint would mean running a content server — against the local-first value — so even if offered, prefer email/folder.)

### Vector J — Manual-but-assisted "lightest touch" (drag-drop, paste, watched folder, send-to-Advisor Prep Hero)
- **How it works (both):** a first-class **"drop your RightCapital report / Jump note here"** flow + a **watched folder** + **filename/content recognition** ("this looks like a RightCapital plan / a Jump meeting note") + client-matching + a **"came from RightCapital/Jump"** provenance tag + a **freshness date.** Optionally "paste the note text." For the advisor who already saves exports into their OneDrive/SharePoint client folder, this is *already automatic* because Advisor Prep Hero watches that folder.
- **Automation:** Manual-assisted → Semi/Full when wired to a synced/watched folder. **Reliability:** **Highest of all options** — nothing to break, no dependency, no permission. **Risk:** **None.**
- **Yield:** the real export, reliably filed. **Verdict:** **The dependable backbone for BOTH** — it's where Vectors B and C *land.* This is the thing to make excellent.

### Vector K — The "acknowledge them" UX / marketing layer
- Independent of mechanism: what may Advisor Prep Hero honestly *say and show?* Covered in its own section below — because the line between *honest* and *overclaiming* is the part most likely to get Jameson in trouble, and it's worth getting exactly right.

---

## The options matrix (blunt)

Automation: **F**ull / **S**emi / **M**anual-assisted. ToS-risk: **None / Low / Med / High**. ✅ = strong fit · ➖ = weak/partial · ❌ = reject/not available.

| # | Vector | Tool | Automation | Feasibility / Reliability | ToS-risk | Data it yields | Fit |
|---|---|---|---|---|---|---|---|
| A | Official API | RightCapital | F | High *(if granted)* — **gated** | None | Richest (plan inputs; outputs?) | ➖ apply, don't block on it |
| A | Official API | Jump | — | None exists | — | — | ❌ nothing to build |
| **B** | **Native export PDF/CSV** | **RightCapital** | **M→S** | **High, stable** | **Low\*** | **The real plan (rich)** | ✅ **best path** |
| B | Native export PDF | Jump | M | High | None | Full note (manual) | ➖ fallback only |
| C | Ride destination (CRM/cloud) | RightCapital | F | High | None | Thin activity notes only | ➖ free bonus, not the meal |
| **C** | **Ride destination (Wealthbox/SharePoint…)** | **Jump** | **F** | **High** *(SharePoint beta)* | **None** | **The real notes** | ✅ **best path** |
| D | Email auto-forward | RightCapital | S | Low (no content in mail) | Low | Notifications only | ❌ |
| D | Email auto-forward | Jump | S | Low (pings/manual recap) | Low–Med | Signal, rarely content | ➖ signal only |
| E | BYO-login browser automation | both | S/F | **Poor (breaks on UI change)** | **High** | Plan/notes, lossy | ❌ **reject** |
| F | Screen capture / OCR | both | S/F | **Bad** | **High** | Lossy text | ❌ **reject** |
| G | Data aggregators / feeds | both | F | Med | Med | Wrong data (accounts, not plan/notes) | ❌ |
| H | iPaaS (Zapier) | RightCapital | — | None found | — | — | ❌ unavailable |
| **H** | **iPaaS (Zapier)** | **Jump** | **F** *(paid plan)* | **High** | **Low–Med\*\*** | **Real note → OneDrive/mailbox** | ✅ **optional fallback** |
| I | Webhooks / push | RightCapital | — | None | — | — | ❌ |
| I | Webhooks / push | Jump | F | (= Zapier) | None/Low | (see H) | ➖ via Zapier |
| **J** | **Manual-assisted (watched folder/drop/paste + recognize)** | **both** | **M→S/F** | **Highest** | **None\*** | **The real export, filed** | ✅ **backbone for both** |

> **\*** The *mechanism* carries no scraping/security risk, but storing a vendor's exported material in Advisor Prep Hero's local RAG can brush against that vendor's advisor terms (the "information-retrieval-system" wrinkle). Mitigate with a one-time **firm-consent checkbox + audit-log entry**, not by pretending it's frictionless. **\*\*** Zapier adds a new cloud processor (US AWS, ~29–69-day retention) + needs a paid plan + M365 Business for OneDrive — a firm-approval item, so it's a fallback, not the default.

---

## Recommendation per tool

### RightCapital → **"Export Inbox"** (Vectors B + J, with A in the background)

**The path:** the advisor generates the plan PDF in RightCapital (a feature they already use) and **saves it into their client folder** — ideally a OneDrive/SharePoint folder Advisor Prep Hero already watches, so after one-time setup it's hands-free. Advisor Prep Hero **recognizes** it as a RightCapital plan, **files** it to the right client, indexes it as a `pdf` source in the pile, and **shows a "exported on [date]" freshness label.** Where the advisor enables RightCapital→Wealthbox, Advisor Prep Hero *also* picks up the thin activity notes for free — a bonus, not the substance.

- **Why this and not the API:** the API is gated and slow, and **you don't need it to honestly say "Advisor Prep Hero reads your RightCapital plan."** Keep the lightweight partner-access outreach running in parallel (per the prior doc) so a live auto-sync is available *if* paying advisors push for it — the trigger is the staleness complaint, not a discovery-call "that'd be nice."
- **Why not the other vectors:** RightCapital has no cloud destination, no Zapier, no outbound webhook, no email-with-attachment — so D/C-cloud/H/I are dead ends for it. E/F/G are rejected on risk/strategy. That leaves export-to-folder as the *only* clean automated-ish path, and happily it's also the lightest.
- **The hole to design around (Codex's sharpest point):** a PDF is a **snapshot.** Advisor Prep Hero can truthfully answer *"what did the last plan say?"* but **not** *"what does RightCapital say right now?"* A label in the file list isn't enough — **treat a stale plan like a stale lab result:** put the **report date inside the answer itself** ("Using your RightCapital report generated June 12, 2026…") and **warn before answering** if the plan is older than a configurable limit. This is the honesty mechanism that keeps the claim defensible.
- **Don't imply you reason over the *live* model (Codex):** RightCapital reportedly shipped its **own embedded planning AI ("Iris," ~June 2026)** that runs inside its calculation engine. Advisor Prep Hero reads *exported evidence* — it does **not** run retirement simulations or inspect live assumptions. Position accordingly: Advisor Prep Hero answers *across* the plan + documents + email + notes, with the plan as one cited (dated) source — it is **not** a live planning calculator. *(Iris claim is Codex-surfaced and not independently verified here — confirm before using it in any copy.)*

### Jump → **"Jump notes everywhere"** (Vectors C + H + J — and **no branded connector**)

**The path (in priority order):** treat Jump's output as something that *arrives*, and be excellent at receiving it: (1) **read Jump notes from Wealthbox** (already do — the preferred path); (2) **read Jump note-PDFs from SharePoint** (already do) and from a **watched folder**; (3) **recognize, de-duplicate, and provenance-tag** Jump-authored notes (the same note can arrive as both a Wealthbox note *and* a SharePoint/Drive PDF — don't import it twice; preserve the meeting date; label it a meeting source); (4) **only as an opt-in fallback** for firms that already use Zapier and don't have the native paths, offer a **Zapier recipe** — *"when a Jump note is finalized → save to OneDrive / email my Advisor Prep Hero mailbox."* Per the pressure-test, Zapier is **not** the hero: it adds a cloud vendor the firm must approve and needs a paid plan, so it's the last resort, not the default.

- **Why no connector:** there's no Jump read-API to build against, a branded "Jump connector" would **put your biggest competitor's logo in your product** and create a goodwill dependency Jump could cut — and you **already get the value for free** through neutral hubs. Building Google Drive/Box connectors *speculatively* is the "connect 60 things" breadth trap the board warned against; lean on SharePoint + the Zapier→OneDrive bridge first, and only add Drive/Box if a paying advisor needs it.
- **The honest limit:** you capture what the advisor *chose to sync* (a curated layer), not necessarily every Jump artifact — fine, but don't claim "everything Jump produces."

### The one build that serves both — and how to frame it
Both recommendations **end in a file landing in a folder or mailbox Advisor Prep Hero already watches.** So the highest-leverage engineering is the **shared receiving pipeline**: rock-solid watched-folder/mailbox ingestion + "this came from RightCapital / Jump" recognition + de-dup + a freshness date. That single, on-strategy, low-risk capability is the real answer to *"how does Advisor Prep Hero work with RightCapital and Jump?"* — and it needs **no** partnership, **no** scraping, and **no** new branded logos.

**Frame it as generic evidence ingestion, not pseudo-connectors (Codex's reframe).** Don't build or position these as "a RightCapital connector" and "a Jump connector." Build **one generic capability** — *"Advisor Prep Hero reads the files, email, CRM notes, and cloud drives you already approved"* — and let **RightCapital and Jump be recognized *source types* inside it.** This is more honest (no implied partnership), it dodges the "integration breadth" trap the board warned about, and the same pipeline quietly works for Holistiplan PDFs, eMoney exports, custodian statements, and anything else that lands in the pile.

### The legal caveat the pressure-test forced (read this before writing any copy)
The export/watch-folder route is the **least-bad** route — it is **not a legally frictionless one.** Two honest wrinkles:
- **The vendor's own terms can reach the export.** A local RAG index *is* an "information storage and retrieval system," and RightCapital's advisor terms reportedly restrict storing platform materials in such a system and restrict third-party use of its output. So *"just export the PDF"* is safer than scraping but still wants **careful language + the advisor's affirmation that their firm permits it.**
- **The fix is cheap and on-brand: a one-time consent + audit-log step.** When an advisor first imports a RightCapital/Jump export, show a plain checkbox — *"My firm permits me to store this exported report in Advisor Prep Hero and use my chosen AI provider on it"* — and record that choice in the existing append-only **audit log.** That turns a fuzzy ToS question into a documented, advisor-owned decision (and it reinforces, rather than fights, the "you're in control / it's all auditable" trust story).
- **Two small build-time safety notes Codex added:** harden the ingestion against hostile files (malformed PDFs / zip-bomb / active content — sandbox the parser), and **require human confirmation when client-match confidence is low** so a sensitive plan never silently misfiles to the wrong household.

---

## What Advisor Prep Hero can *credibly claim* (honest vs. overclaiming)

This is the part to get exactly right — the difference between confident-and-true and a claim a competitor or regulator could call a lie.

**The governing line:** **claim the *capability*, never a *partnership* or *live sync* you don't have.** *"Reads your exported RightCapital plan"* is true. *"RightCapital integration / official partner"* is not (until the API is live). *"Reads the meeting notes you've saved from tools like Jump"* is true. *"Jump integration"* is not (Jump hasn't approved anything).

| ✅ Honest to say / show | ❌ Overclaiming — avoid |
|---|---|
| "Reads the **RightCapital plan reports you export or save** into your client folder, then files and cites them." | "**Connects to / integrates with RightCapital**" or a "**certified partner**" badge — false until the Partner API is live. |
| "Pulls in the **Jump meeting notes you've saved** — from your CRM, SharePoint, a cloud folder, or email." | "**Jump integration**" / a Jump logo implying a partnership — Jump approved nothing. |
| "**Works alongside** tools like RightCapital and Jump" (the existing *fits-your-stack* framing). | "**Syncs live** with your plan / your meetings" — it's a snapshot; say *"as of your last export."* |
| Logos in a neutral **"works with your stack"** row, with an honest note that it reads their *exported files / synced notes.* | A **"certified integrations" grid** with their logos implying endorsement. |
| "Shows you **when the plan was last exported**, so you always know how current it is." | "**Reads everything** Jump produces" — only what the advisor synced. |
| "AI requests go **directly from your machine to the provider you choose**; Advisor Prep Hero runs no content server." | "Your client data **never leaves your control**" stated flatly — in BYOK-cloud mode chunks *do* go to your chosen AI provider; say *how* it's controlled, don't imply nothing ever leaves. |

**Practical guardrails:** always pair a tool's name with the *mechanism* ("reads your **exported** RightCapital plan," "the meeting notes you've **saved**"); put a small disclaimer under any logo row ("Advisor Prep Hero reads exported files and synced notes; names/logos are the property of their owners and do not imply partnership"); and surface the **freshness date** in the product itself so the UI never silently implies live data.

---

## The trust paradox (why the lightest path is also the *right* path)

Worth stating plainly because it's the strategic heart of this report: **the vectors that look the most impressive in a demo are the ones that would quietly destroy Advisor Prep Hero's only real moat.**

Advisor Prep Hero's entire pitch to a confidentiality-anxious advisor is *"your clients' data never leaves your control; every answer is cited; we're provably private."* A browser extension that automates logins, or an OCR robot reading a third-party screen, would: introduce a **breach-of-contract** liability the advisor inherits; create a **session-token attack surface** (Cyberhaven-style) on the exact client systems; turn Advisor Prep Hero into a **Reg S-P service-provider** the firm must police; and **contradict Advisor Prep Hero's own stated values.** You cannot sell "provably private" and ship a scraper. So the lightest, lowest-risk options here aren't a *compromise* — getting the OUTPUT to flow into the pile via sanctioned exports, neutral hubs, and the advisor's own Zapier recipe is **simultaneously** the cheapest, the most reliable, the most honest, and the most on-brand. The strategy is self-reinforcing.

---

## Codex pressure-test — what two independent passes added

This recommendation was run past an independent Codex (gpt-5.5) **twice**: first a from-scratch brainstorm of the same vectors (different-model blind spots), then an adversarial pass instructed to *attack the finished recommendation.* Both **independently confirmed** the spine — they surfaced the Jump Zapier triggers, RightCapital's CSV exports, and the Box/Drive/SharePoint destinations on their own, and converged on the same two-shape answer (RightCapital "Export Inbox"; Jump "notes everywhere"; **reject** scraping/OCR/credential automation as *"fighting the lightest-risk board direction and creating trust risk in the exact market Advisor Prep Hero needs to impress"*). The adversarial pass then materially **sharpened the risk story** — its blunt verdict: *"Keep the technical plan. Change the risk story. Export/watch-folder is the least-bad route, not a legally frictionless one."* Everything it raised is folded in above:
1. **The biggest miss was legal, not engineering.** A local RAG index is an "information storage and retrieval system," and RightCapital's advisor terms may restrict storing its materials in one — so the *export path itself* needs careful wording + a firm-consent step, not a "frictionless" claim. → added the legal-caveat section + consent checkbox + audit-log.
2. **The Zapier bridge is real but not free or risk-zero.** Triggers are read-only; useful routing needs a *paid* Zapier plan; OneDrive-on-Zapier needs M365 Business; and Zapier becomes a *new cloud processor* (US AWS, ~29–69-day retention) the firm must approve. → downgraded Zapier to an opt-in fallback, not the hero.
3. **A freshness *label* isn't enough — snapshot-vs-live is the real trust trap.** → put the report **date inside the answer** + warn before answering on a stale plan.
4. **RightCapital shipped its own embedded AI ("Iris," ~June 2026).** → Advisor Prep Hero reads *exported evidence*, must not imply it reasons over the *live* model.
5. **Reframe as generic evidence ingestion, not pseudo-connectors** — RightCapital/Jump are recognized *source types*, not branded connectors. (Also: harden ingestion against hostile files; require human confirmation on low-confidence client matches.)
6. **Marketing discipline:** say *"reads RightCapital/Jump exports / saved notes,"* never *"integrates with"*; and don't state *"data never leaves your control"* flatly when BYOK-cloud sends chunks to the chosen provider — describe *how* control works instead.

---

## What Jameson should do next (plain and short)

1. **Don't build a "RightCapital connector" or a "Jump connector" as new logo-bearing features.** The lightest path wins, and the board already said so.
2. **Make ONE thing excellent: the "receiving dock" — as a *generic* capability, not two branded connectors.** A reliable *watched-folder + watched-mailbox* pipeline that **recognizes** a RightCapital plan PDF or a Jump meeting note (just two *source types* inside a generic ingester), files it to the right client, avoids importing the same note twice, puts the **report date inside the answer** (and warns when it's stale), and captures a **one-time firm-consent checkbox** (logged in the audit trail) the first time. This single capability is the real answer for *both* tools — cheap, safe, on-strategy. *(Engineering, when the feature-freeze lifts — not during the demand test.)*
3. **For RightCapital:** in demos and pilots, show the plan via the **exported PDF in the client folder** (works today). Keep the **lightweight partner-API outreach** running in the background. Watch for advisors who *complain the PDF goes stale* — that pull, from someone using Advisor Prep Hero weekly, is the only signal that should trigger building the live API connector.
4. **For Jump:** rely on the notes that **already arrive** via Wealthbox + SharePoint. Keep the **Zapier recipe** (Jump note finalized → OneDrive / your Advisor Prep Hero mailbox) as an *opt-in fallback* — note that it routes notes through Zapier's cloud and needs a paid plan, so it's a firm-approval choice, not the default. Build no branded Jump connector; speak of the *capability* ("reads the meeting notes you've saved from tools like Jump"), not a connector.
5. **Say it honestly.** "Reads your **exported** RightCapital plan." "Pulls in your **saved** Jump notes." "**Works alongside** your stack." Never "integration / certified partner / live sync." Put the freshness date in the product so the UI itself stays honest.
6. **Do NOT ship browser-login automation or screen-OCR of these tools.** Highest legal + security + compliance risk, the most fragile, and it contradicts the one thing Advisor Prep Hero sells — trust.

---

## Appendix — confidence & sources

**High confidence:** RightCapital exports a branded multi-module **PDF** via Report Builder (+ "Download and Save to Vault") and narrow **CSV** (balance sheet, RightIntel) — but has **no cloud-storage destination, no Zapier, no outbound webhook, no report-by-email.** It pushes only thin **notes/tasks** to Wealthbox/Redtail. Jump exports **note PDFs** (+ clipboard, downloadable A/V) and pushes **rich notes** to ~12 CRMs and **PDFs to SharePoint/Google Drive/Box** (not OneDrive/Dropbox), and **publishes Zapier triggers.** Advisor Prep Hero already reads Wealthbox + SharePoint + OneDrive + email. Logged-IN browser automation and OCR carry real breach-of-contract + security + Reg S-P exposure and contradict Advisor Prep Hero's stated values.

**Medium / unverified (confirm before betting):** Jump→OneDrive native support (appears absent; SharePoint/OneDrive-for-Business overlap is fuzzy); Jump's Google-Drive auto vs. per-meeting cadence; the exact RightCapital and Jump **ToS** language (pages 404'd / name-collided — risk reads are industry-norm + case-law inference, labelled as such); **specifically, whether RightCapital's advisor terms restrict storing exported reports in a third-party "information retrieval system" (Codex flagged sharp language here — get a real read before any "frictionless" claim);** whether RightCapital's Partner API exposes plan *outputs* (projections/Roth) vs. only *inputs*; whether any private NDA partner API exists for either; **RightCapital's embedded "Iris" AI** (Codex-surfaced, ~June 2026 — not independently confirmed here); and Zapier's exact **content-retention window + paid-tier requirements** for the routing recipe (treat as a real, firm-approved cloud vendor, not a free utility).

**Selected sources** — *RightCapital:* [Report Builder](https://help.rightcapital.com/knowledge-base/more-menu/create-reports) · [Report customization](https://help.rightcapital.com/knowledge-base/reports/report-customization) · [Vault download](https://help.rightcapital.com/knowledge-base/client-portal/vault/download-files-from-the-vault) · [Balance-sheet CSV](https://help.rightcapital.com/module-overview/client-portal/dashboard/balance-sheet) · [RightIntel](https://help.rightcapital.com/knowledge-base/advisor-portal/business-intelligence) · [Notes/tasks → Wealthbox](https://help.rightcapital.com/integrations/crm/rightcapital-notes-tasks-in-wealthbox) · [Notes/tasks → Redtail](https://help.rightcapital.com/integrations/crm/rightcapital-notes-tasks-in-redtail) · [Integrations overview](https://help.rightcapital.com/integrations/overview) · [Smart Import (inbound)](https://help.rightcapital.com/knowledge-base/advisor-portal/data-import/smart-import). *Jump:* [Export notes](https://help.jumpapp.com/en/articles/11333235-how-to-export-notes-when-you-don-t-have-a-crm-integration) · [Zapier triggers](https://help.jumpapp.com/en/articles/12694050-zapier-integration) · [Zapier app](https://zapier.com/apps/jump/integrations) · [SharePoint](https://help.jumpapp.com/en/articles/13417352-sharepoint-integration) · [Box](https://help.jumpapp.com/en/articles/12923026-box-integration) · [Wealthbox](https://help.jumpapp.com/en/articles/12011656-wealthbox-integration) · [Recap email](https://help.jumpapp.com/en/articles/11089285-how-does-the-recap-email-work) · [Notifications](https://help.jumpapp.com/en/articles/9842820-how-to-receive-jump-notifications) · [Transcripts](https://help.jumpapp.com/en/articles/9298593-how-to-view-meeting-transcripts) · [Compliance/retention](https://help.jumpapp.com/en/articles/11526343-compliance-settings) · [Integrations](https://jump.ai/integrations). *Legal/security:* [Van Buren v. US (Proskauer)](https://newmedialaw.proskauer.com/2021/06/06/supreme-court-ends-long-running-circuit-split-over-cfaa-exceeds-authorized-access-issue-adopting-a-narrow-interpretation-that-will-reverberate-in-scraping-disputes-and-litigation-ov/) · [hiQ v. LinkedIn outcome (Morgan Lewis)](https://www.morganlewis.com/blogs/sourcingatmorganlewis/2022/12/linkedin-v-hiq-landmark-data-scraping-suit-provides-guidance-to-data-scrapers-and-web-operators) · [Meta v. Bright Data — adviser implications (Lowenstein Sandler)](https://www.lowenstein.com/news-insights/publications/client-alerts/meta-v-bright-data-ruling-has-important-implications-for-webscraping-activities-by-investment-advisers-im) · [Cyberhaven extension breach (Valence)](https://www.valencesecurity.com/resources/blogs/saas-oauth-attack-leads-to-widespread-browser-extension-breach) · [SEC Reg S-P 2024 (Baker Botts)](https://www.bakerbotts.com/thought-leadership/publications/2024/july/sec-amends-regulation-sp-heightening-protections-for-nonpublic-information-about-consumers) · [Fidelity bans screen-scrapers (RIABiz)](https://riabiz.com/a/2023/10/19/fidelity-just-dropped-the-hammer-on-screen-scrapers-to-cheers-but-some-firms-like-plaid-are-holdouts-and-the-cfpb-may-wield-the-final-gavel) · [Morningstar ByAllAccounts (no plan/notes data)](https://developers.byallaccounts.morningstar.com/). *Advisor Prep Hero internal:* [CONNECTORS.md](../reference/CONNECTORS.md) · [prior feasibility doc](./2026-06-29-connector-feasibility-rightcapital-jump.md) · [advisor-ecosystem-fit](./2026-06-23-advisor-ecosystem-fit.md) · [board decision — leading advisor AI](./2026-06-29-board-decision-leading-advisor-ai.md).
