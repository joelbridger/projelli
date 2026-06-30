# Competitor one-pager: FutureVault vs Advisor Prep Hero

*Prepared 2026-06-25, for Jameson (internal). This is our closest competitor. The point of this doc is one crisp sentence: why an advisor should choose us over them.*

---

## FutureVault in one line

FutureVault is an enterprise, **cloud-hosted** "digital vault" for banks, broker-dealers, and large RIAs, with an AI layer bolted on top of client documents. It's the closest competitor to Advisor Prep Hero's "Client Map" *idea* — but the **opposite** of Advisor Prep Hero on the two things that matter most: where the data lives (their cloud vs. the advisor's own machine) and who can buy it (big enterprises vs. solo advisors).

## What they are / what they do

They call themselves the "AI-Powered Digital Vault and Intelligent Document Processing platform" for financial services, and they coined the **"Client Life Management Vault"** — a secure, client-facing place to store and share a household's whole document life (tax docs, estate files, insurance, statements). Think of it as a branded, compliant document portal for wealth firms, with a records/compliance backbone.

On **March 10, 2026** they launched the **AI Advisor Insights Engine** — the part that overlaps us directly. It reads across a client's documents, builds a knowledge graph, and produces real-time insights (flag an onboarding gap, auto-prep a meeting summary when docs are uploaded) plus "automated advisor actions." This is the same "documents → cited intelligence" promise as the Client Map, but running inside *their* cloud, at enterprise scale, today.

## Who they sell to & how it's deployed (the key part)

- **Deployment: fully cloud-hosted SaaS. Client data lives on FutureVault's servers, not the advisor's machine.** Their privacy pitch is *contractual* (encryption, SOC 2 Type II, PCI DSS), not *architectural*. No local / on-prem / zero-data-leaves option exists.
- **Buyer: enterprise, not solo.** They target broker-dealers, wealth enterprises, large RIA aggregators, family offices, banks, and insurers. Named clients are institutional (CI Financial, Wellington-Altus, a $200B-AUM Miami aggregator, etc.). They cite "$1.5T+ AUM of partner firms" and "500,000+ client vault accounts."
- **Sales motion: consultative enterprise sales.** No public pricing — everything is "Request a Demo," custom-quoted per organization. A solo or small RIA effectively cannot self-serve buy this.

## Their strengths (honest)

- **Real trust paperwork we don't have yet:** SOC 2 Type II + PCI DSS, blue-chip client logos, and ~$31M raised. In a formal vendor-approval process, they clear bars we currently can't.
- **Client-facing collaboration & records:** polished client portal, bulk document requests/checklists, household consolidation, and built-in records retention.
- **Deep integrations:** Salesforce, DocuSign, Addepar, and a large integration surface.
- **Their AI vision is shipped, not hypothetical** — the Insights Engine is live at enterprise scale.

## Their weaknesses (for OUR buyer: the privacy-conscious solo / small RIA)

- **Client data sits in FutureVault's cloud.** For an advisor whose whole reason to buy is "client data never leaves my control," this is a deal-breaker — FutureVault *is* exactly the outside cloud vendor they'd have to vet and monitor. Advisor Prep Hero removes that vendor from the picture entirely.
- **Not solo-buyable:** enterprise sales, custom quotes, slow onboarding, and an enterprise price point that almost certainly dwarfs our $468–$1,548/yr.
- **It's a portal first, a private workspace second:** great for storing, sharing, and compliance; it is not a private, advisor-side place to think and draft, and the AI lives in *their* governed cloud (no bring-your-own-key, no local model).

## Head-to-head

| Dimension | FutureVault | Advisor Prep Hero |
|---|---|---|
| **Data location / privacy** | Client data on FutureVault's cloud; privacy by contract | On the advisor's own machine; privacy by architecture (local-first + bring-your-own-key) |
| **Deployment** | Cloud SaaS, white-labeled | Desktop app (Windows/Mac/Linux), offline except the AI call |
| **Buyer / sales motion** | Enterprises & aggregators; enterprise sales | Solo & small RIAs; self-serve |
| **AI over client docs** | Insights Engine (their cloud LLM) | Client Map: cited answers across the household's files (advisor's own / local model) |
| **Price** | Custom enterprise quote, not public (likely $$$) | Public: $468 / $948 / $1,548 per seat/yr |
| **Trust artifacts** | SOC 2 Type II + PCI DSS (their advantage) | None yet (our gap) — but no vendor cloud to certify in the first place |

## Why Advisor Prep Hero over FutureVault

**One sentence:**
> With FutureVault, your clients' most sensitive documents live on FutureVault's servers and only an enterprise can buy it. With Advisor Prep Hero, the data never leaves your own machine, and a solo advisor can start today.

**Honest version:**
> FutureVault is the better fit for a large broker-dealer or RIA aggregator that wants a client-facing, certified document portal with AI on top — they're bigger, funded, and certified. But for the independent advisor who specifically refuses to put client data in someone else's cloud, FutureVault *is* the cloud they're trying to avoid, sold through a process they can't access. Advisor Prep Hero wins on the one thing that buyer cares about most — the data stays in their control — at a price they can buy themselves.

## What to watch (how they could beat us)

The honest threats, in order:
1. They launch a **down-market / self-serve tier** for small RIAs.
2. They offer a **private / single-tenant / on-prem deployment** that narrows our "your cloud vs. their cloud" wedge.
3. Their **MCP feature** (which lets an advisor point their own AI at the vault) blurs our bring-your-own-key story.

None of these exist today. But this is exactly why speed matters: our window is the gap between "they're enterprise-only and cloud-only" and "they go down-market." Re-check FutureVault every quarter and add it to `docs/strategy/competitor-watch-log.md` (it's currently not listed there — it belongs in a new "document-vault / client-portal" sub-category, distinct from note-takers like Jump/Zocks).

## Sources

- https://www.futurevault.com/ ; https://www.futurevault.com/segments/wealth-management/ ; https://www.futurevault.com/pricing/
- https://www.prnewswire.com/news-releases/futurevault-launches-embedded-ai-advisor-insights-engine-turning-client-documents-into-real-time-intelligence-and-automated-advisor-actions-302709448.html
- https://www.futurevault.com/futurevault-secures-an-additional-us-3-million-in-equity-capital/
- https://www.crunchbase.com/organization/futurevault ; https://www.g2.com/products/futurevault/reviews ; https://www.capterra.com/p/228552/FutureVault/

*Uncertainty flags: FutureVault publishes no pricing (custom enterprise quotes). Exact data-residency (which cloud/region) isn't public. "Private LLM infrastructure" is their wording; whether that's self-hosted models or a zero-retention provider contract isn't spelled out. Funding (~$31M total) is from their own releases + Crunchbase, not audited.*
