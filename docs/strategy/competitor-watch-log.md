# Advisor Prep Hero Competitor Watch Log

**What this log is:** A running record of material changes to the incumbent and emerging AI tools competing in Advisor Prep Hero's four professional verticals (legal, tax, consulting, financial advisors). The primary threat to track is any incumbent adding a local, on-premise, zero-egress, or BYOK option — that is the event that most directly narrows Advisor Prep Hero's core wedge.

**Source:** Baseline drawn from `docs/strategy/2026-06-06-vertical-competitive-landscape.md`. Each subsequent entry appends findings from a fresh web-research pass against the same competitor set.

**Routine prompt (copy verbatim into the scheduled agent):**

> Re-check the competitors in docs/strategy/2026-06-06-vertical-competitive-landscape.md against their current public pages (web search/fetch). Flag any material change: pricing, a new local/on-prem/zero-egress or BYOK option, major funding or acquisition, or a notable new entrant in legal/tax/consulting/advisor AI. Append a dated entry to docs/strategy/competitor-watch-log.md with sources. If anything materially threatens Advisor Prep Hero's local-first wedge or changes a comparison page's accuracy, notify Jameson with a one-paragraph summary and the affected pages.

**Recommended cadence:** Quarterly is sufficient for most changes; monthly-light is fine if the per-run cost is low. Note for Jameson: the recurring scheduled-agent cost needs your explicit go-ahead before enabling — do not start the cron until confirmed.

---

## 2026-06-08 — Baseline

Research date: 2026-06-08. Sources verified by live web search and fetch.

---

### Legal vertical

**Clio Duo / Manage AI**
Current status: Cloud-only. No local, on-premise, zero-egress, or BYOK option announced or found. Pricing unchanged from landscape doc: $49–59/mo add-on to Clio base, or bundled in Elite (~$159/mo total). Feature set is expanding (document analysis, email drafting) but all cloud. No material change to our comparison story.
Sources: [Lawyerist Clio Duo Review 2026](https://lawyerist.com/reviews/artificial-intelligence-in-law-firms/clio-duo-review-artificial-intelligence-for-lawyers/); [Clio Pricing 2026 — CostBench](https://costbench.com/software/ai-legal-tools/clio/)

**CoCounsel (Thomson Reuters) — Legal**
Current status: Cloud-only. No local or BYOK option. Pricing has been updated and is now more granular than the landscape doc's $225–428/mo range. Published 2026 tiers: On Demand $75/user/mo; Basic Research $220/user/mo; CoCounsel Core $225/user/mo; Westlaw Precision with CoCounsel $428/user/mo; All Access $500/user/mo. The All Access tier at $500/mo is new-to-public and higher than the doc's ceiling — MATERIAL CHANGE for /vs/CoCounsel pricing accuracy. Update comparison page upper bound.
Sources: [CoCounsel pricing page](https://sales.legalsolutions.thomsonreuters.com/en-us/products/cocounsel-legal/700/plans-pricing); [CoCounsel Pricing 2026 — CostBench](https://costbench.com/software/ai-legal-tools/cocounsel/)

**Lexis+ Protege (LexisNexis) — rebranded from Lexis+ AI**
STATUS: MATERIAL CHANGE — PARTIAL WEDGE ENCROACHMENT. In February 2026 LexisNexis replaced Lexis+ AI with a new product called Lexis+ with Protege, adding agentic drafting, Shepard's Verify Trust Markers, collaboration Workrooms, and — most importantly for Advisor Prep Hero — **Bring Your Own Key (BYOK) encryption** (customer-held keys via AWS KMS, Azure Key Vault, Google Cloud KMS, or HashiCorp Vault). BYOK deployed at AmLaw 100 firms as of May 7, 2026. This is still cloud-hosted (data travels through LexisNexis servers; customer merely controls the encryption key, not the transmission path). This is NOT zero-egress and NOT local. However, it is a meaningful encroachment on the "customer controls their data" story, and it makes the Lexis+ entry on /vs/ and comparison tables out of date. The landscape doc already anticipated this and flagged it as a watch item ("Lexis+ already shipped BYOK encryption (still cloud)") — that note is now confirmed and more specific. Update any comparison copy that reads "no BYOK" for Lexis+ to accurately reflect that BYOK-encryption is available at the enterprise/AmLaw tier. Our response: BYOK encryption is not the same as zero-egress — the data still leaves the building and traverses LexisNexis infrastructure; only a local model removes transmission entirely.
Sources: [LexisNexis Protege launch — GlobeNewswire, May 7 2026](https://www.globenewswire.com/news-release/2026/05/07/3289932/0/en/lexisnexis-launches-next-evolution-of-lexis-with-prot%C3%A9g%C3%A9-the-legal-ai-platform-built-on-the-authority-legal-work-demands); [LawNext coverage](https://www.lawnext.com/2026/05/lexisnexis-launches-lexis-with-protege-replacing-lexis-ai-with-an-end-to-end-workflow-platform.html); [XIRA summary](https://xira.com/p/2026/05/07/lexisnexis-expands-lexis-with-protege-adding-agentic-skills-collaboration-workrooms-and-customer-held-encryption-keys/)

**Elephas (closest local analogue for legal)**
Current status: Mac-only. Still no Windows support confirmed. Still no profession-specific legal template pack beyond generic workflows. Local/Ollama integration confirmed. Pricing page not fully public but free tier + paid upgrade confirmed. No material change from landscape doc (Mac-only, generic, no legal pack). We remain differentiated on Windows + profession-specific templates.
Source: [Elephas homepage](https://elephas.app/)

---

### Tax vertical

**Intuit Assist (bundled in Lacerte / ProConnect / ProSeries)**
Current status: Cloud-only. No local or zero-egress option. The 2026 press from Intuit emphasizes agentic AI and consumer-facing Full Service features (TurboTax). ProConnect/Lacerte Assist remains bundled at $0 extra for Intuit subscribers. No pricing change, no local/BYOK option, no §7216 clarity added. Training-data policy for uploaded client documents still ambiguous in public materials (unchanged from landscape doc). No material change to our comparison story.
Sources: [Intuit ProConnect AI features](https://accountants.intuit.com/tax-software/tax-online/ai-features/); [Intuit press release, 2026](https://investors.intuit.com/news-events/press-releases/detail/1279/intuits-all-in-one-agentic-ai-driven-consumer-platform-powers-year-round-money-outcomes-for-those-who-need-it-most)

**Blue J**
STATUS: MATERIAL CHANGE — SIGNIFICANT GROWTH AND FUNDING. Blue J raised $122M USD ($167.4M CAD) Series D in August 2025, led by Oak HC/FT and Sapphire Ventures, valuing the company at $300M+ USD. Revenue more than doubled in the preceding year. Customer count grew from ~200 (2021) to 2,500+ organizations. New partnership with IBFD for cross-border international tax research, with general availability in US/Canada/UK in Q1 2026. Blue J remains independent (a February 2025 Crunchbase entry for "StructureFlow acquires Blue J" refers specifically to "Blue J Diagramming" — a separate diagramming tool — not the tax AI company; the tax AI company is separate and still independent). Cloud-only; no local or BYOK option. Pricing at $1,498/yr confirmed directionally; no public change found. The Series D and customer growth reinforce Blue J as the dominant purpose-built tax research tool, well-funded and growing. Our story vs. Blue J (price + §7216-clean local architecture) remains accurate. Note: update any landscape copy that implies Blue J's scale was modest — they are now $300M+ valuation with 2,500+ firm customers.
Sources: [BetaKit Series D coverage](https://betakit.com/blue-j-series-d-after-doubling-revenue/); [International Accounting Bulletin](https://www.internationalaccountingbulletin.com/news/blue-j-secures-122m-funding/); [Blue J + IBFD launch — BusinessWire](https://www.businesswire.com/news/home/20250903168687/en/Blue-J-and-IBFD-Unveil-AI-Platform-for-Instant-Cross-Border-Tax-Research)

**CoCounsel Tax (Thomson Reuters)**
Current status: Cloud-only. Pricing is bundled with Checkpoint subscription; no public per-seat rate. No local or BYOK option. No material change to our comparison story beyond confirming pricing remains opaque/bundled.
Source: [CoCounsel Tax product page](https://tax.thomsonreuters.com/en/products/cocounsel-tax); [CostBench — CoCounsel Tax](https://curatesuite.com/accounting/tools/cocounsel-tax)

**NEW ENTRANT — Juno (tax, seed stage)**
A new entrant: Juno, a CPA-founded startup, raised $12M seed in April 2026 (led by Bonfire Ventures). Automates 90% of data entry across 92+ document types for tax prep, with human-in-the-loop validation and full source traceability. Cloud-only; no local or zero-egress option found. Focused on return prep automation rather than research or workspace. Not a direct threat to Advisor Prep Hero's positioning (Advisor Prep Hero is the private workspace and §7216-clean AI layer, not a return-prep tool), but watch as they grow.
Sources: [CPA Practice Advisor — Juno $12M seed](https://www.cpapracticeadvisor.com/2026/04/13/juno-raises-12m-seed-to-scale-ai-tax-preparation-platform-that-automates-90-of-busy-work/181502/)

---

### Consulting vertical

**Gamma**
Current status: Cloud-only. No local or on-premise option found. 2026 pricing is slightly more granular than the landscape doc: Free / Plus $12/mo / Pro $25/mo / Ultra $100/mo (individual); Team $20/seat/mo / Business $40/seat/mo. The Plus and Pro tiers are in the same range as the landscape doc's $9–18/mo. No local/BYOK option. No material change to comparison story; pricing update confirms the range.
Sources: [Gamma pricing page](https://gamma.app/pricing); [SaaSworthy Gamma Pricing 2026](https://www.saasworthy.com/product/gamma-app/pricing); [CostBench Gamma Pricing](https://costbench.com/software/ai-presentations/gamma/)

**Microsoft 365 Copilot**
Current status: Cloud-only. Copilot add-on remains at $30/seat/mo. Microsoft announced packaging and pricing changes to base M365 suites effective July 1, 2026 (global price increases), but Copilot standalone pricing is unchanged. No local or zero-egress option for Copilot. The Jan–Feb 2026 DLP-bypass bug noted in the landscape doc: not confirmed resolved or still present in this research pass — worth a dedicated check next cycle. No material change to comparison story.
Sources: [Microsoft M365 pricing update FAQ](https://www.microsoft.com/en-us/licensing/news/2026-m365-packaging-pricing-updates-faq); [Microsoft Copilot Pricing — GoSearch](https://www.gosearch.ai/blog/microsoft-copilot-pricing/)

---

### Financial advisor vertical

**Jump**
STATUS: MATERIAL CHANGE — MAJOR FUNDING. Jump raised $80M Series B in February 2026, led by Insight Partners, with participation from F-Prime, Allianz Life Ventures, TIAA Ventures, Peterson Partners, Battery Ventures, Sorenson Capital, Pelion, and Citi Ventures. Total capital raised is now $105M. The company has scaled to 27,000 advisors, adding 2,000+ new advisors per month. Nearly 1 in 10 U.S. financial advisors use Jump. The company plans to expand product from meeting-notes into broader agentic workflows. Jump remains cloud-only (AWS); no local or zero-egress option. The Series B and growth data materially update the landscape doc (which cited $105M total funding and 27,000 advisors, so the doc already reflects the post-Series-B state). The landscape doc is current on Jump. No wedge threat from Jump.
Sources: [Insight Partners announcement — Jump Series B](https://www.insightpartners.com/ideas/jump-raises-80-million-series-b-led-by-insight-partners-to-expand-ai-operating-system-for-financial-advisors/); [BusinessWire](https://www.businesswire.com/news/home/20260219487440/en/Jump-Raises-$80-Million-Series-B-Led-by-Insight-Partners-to-Expand-AI-Operating-System-for-Financial-Advisors)

**Zocks**
STATUS: MATERIAL CHANGE — FUNDING UPDATE. Zocks raised $45M Series B in January 2026, co-led by Lightspeed Venture Partners and QED Investors, with Illuminate Financial participating. Total funding now $65M (up from the landscape doc's figure). Over 5,000 financial firms now use Zocks (up from the doc's 5,000 cited, so roughly consistent). Expanding into Europe. Zocks remains cloud-only (notes-only architecture, no audio stored). No local or zero-egress option. No wedge threat.
Sources: [Zocks press release — $45M Series B](https://www.zocks.io/press/zocks-raises-45m-series-b-to-accelerate-ai-powered-automation-for-financial-advisors); [BusinessWire](https://www.businesswire.com/news/home/20260126549388/en/Zocks-Raises-$45M-Series-B-to-Accelerate-AI-Powered-Automation-for-Financial-Advisors)

**NEW ENTRANT — Altruist Hazel (advisor tax planning AI)**
A new entrant to watch: Altruist launched Hazel, an AI platform for financial advisors, at $60/seat/mo. Built on the Thyme AI productivity platform (acquired by Altruist in June 2024). The 2026 addition: analyzes 1040s, pay stubs, and account statements to generate personalized tax strategies and scenario modeling. Hazel operates under zero-data-retention agreements with AI model providers (no training on client data). Available to any advisory firm regardless of custodian. This is cloud-based (Altruist infrastructure) with contractual zero-retention — not local or zero-egress. Positioned as a broad AI assistant for advisors, including tax planning. Not a direct wedge threat (still cloud), but it is a new name in the advisor AI space at a lower price point than Jump. Watch whether Altruist expands Hazel's data-sovereignty story toward local options.
Source: [Wealth Management — Altruist Hazel launch](https://www.wealthmanagement.com/artificial-intelligence/altruist-launches-ai-powered-tax-planning-feature-in-hazel-platform-for-advisors)

---

### Wedge-threat watch

**Does any incumbent currently offer a true local / zero-egress / on-machine option? No.**

As of 2026-06-08, no incumbent in legal, tax, consulting, or financial advisor AI offers a genuine local or zero-egress deployment option. Specific findings:

- **Lexis+ Protege (LexisNexis):** The closest move toward customer-controlled data. Added BYOK encryption (customer-held keys via AWS KMS, Azure Key Vault, Google Cloud KMS, HashiCorp Vault) deployed at AmLaw 100 firms as of May 2026. This is the most significant encroachment on Advisor Prep Hero's data-control story to date. However, BYOK-encryption is not the same as zero-egress: the data still traverses LexisNexis cloud infrastructure; the customer controls the encryption key but not whether the data leaves their machine. Advisor Prep Hero's response is accurate: only a local model removes the transmission entirely. Source: [GlobeNewswire — Lexis+ Protege, May 7 2026](https://www.globenewswire.com/news-release/2026/05/07/3289932/0/en/lexisnexis-launches-next-evolution-of-lexis-with-prot%C3%A9g%C3%A9-the-legal-ai-platform-built-on-the-authority-legal-work-demands)

- **Elephas:** The only marketed local-AI tool in any of the four verticals. Mac-only, no Windows support confirmed. Generic (no legal- or tax-specific template pack beyond general professional content). Not a material change from landscape doc. Still the closest single-vendor analogue.

- **Clio Duo, Jump, Zocks, Intuit Assist, Gamma, Blue J, M365 Copilot, CoCounsel:** All confirmed cloud-only. No local, on-premise, or zero-egress option found.

**Verdict:** Advisor Prep Hero's local-first wedge remains intact. Lexis+ Protege's BYOK addition is the one item to watch and to address proactively in copy (clarify that BYOK-encryption differs from zero-egress/local). No incumbent has shipped a true local or zero-egress option.

---

*Next entry due: approximately 2026-09-08 (quarterly). Monthly-light acceptable if agent cost is low — confirm with Jameson before enabling the scheduled cron.*
