# Keepance Independent AI Landscape Research

**Date:** June 24, 2026  
**Scope:** US financial advisors, especially solo advisors, small RIAs, independent wealth managers, and financial planners.  
**Product lens:** Keepance is a local-first, privacy-first desktop AI layer for client intelligence and drafting. It reads across an advisor's existing files, email, and tools, answers household questions with clickable citations, and keeps the working copy of client data on the advisor's own machine. It is not a CRM, planning tool, custodian, portfolio system, or meeting notetaker.

## Executive read

Advisor AI is no longer theoretical. By mid-2026, the market has moved from "ChatGPT experiments" into shipped features across CRM, meeting notes, document extraction, tax planning, portfolio reporting, and Microsoft 365.

The center of gravity is still narrow:

- **Meeting AI is the most proven category.** Jump, Zocks, Wealthbox, Zeplyn, Fathom, and others have trained advisors to expect meeting prep, notes, summaries, follow-up emails, CRM updates, and tasks.
- **Planning and tax AI mostly means document extraction, plan checking, tax-return reading, and next-action suggestions.** RightCapital's Smart Import and Iris, eMoney's CoPlanner beta, FP Alpha, Holistiplan, Conquest SAM, and TaxStatus/Advice.ai all point this way.
- **CRMs and all-in-one platforms are adding agentic workflow layers.** Wealthbox AI, Advyzon AI, Orion/Redtail AI plans, Salesforce Agentforce, and Envestnet Insights AI are trying to become the "command center" for advisor work.
- **Microsoft 365 Copilot is the broadest horizontal threat.** It already has access to Outlook, Teams, SharePoint, OneDrive, Word, Excel, and the Microsoft Graph, and Microsoft Purview gives firms governance tools. But Copilot is not advisor-native, does not naturally understand client households across non-Microsoft wealthtech systems, and creates its own permission and oversharing risk.

The white space for Keepance is real, but it is not "another AI assistant." Advisors already have tool fatigue. The defensible gap is a **private, cross-source client intelligence and drafting layer** that sits above the existing stack and answers: "What do we know about this client, where did it come from, what should I draft next, and can I prove it?"

The winning wedge is likely:

1. **Pre-meeting and in-between-meeting client intelligence** from files, email, CRM exports, planning PDFs, tax documents, custodian reports, notes, and advisor-created folders.
2. **Citation-first answers** with links back to source files/messages/pages, so the advisor can trust but verify.
3. **Drafting with evidence**: emails, agenda points, follow-up notes, planning questions, missing-data lists, and review prep, always tied to source citations.
4. **Privacy posture that is sharper than cloud tools:** local index, local working copy, no Keepance server holding client data, and bring-your-own AI key or local model. This reduces vendor-risk pressure, but it does not remove compliance duties.

The biggest adoption risk is not "Can AI do it?" It is: **"I do not want another tool."** Keepance has to feel like a search layer and workbench over the tools the advisor already uses, not a new place to manage clients.

## Source confidence

I treated vendor press releases and product pages as evidence that a feature is announced or marketed, not proof of deep adoption. I treated analyst/blog sources as useful market interpretation, but I flag where something is not independently verified. Dates below are based on source publication dates when available.

Key market baseline from the existing Keepance Kitces digest in this repo: the typical independent advisory firm runs about 12 software apps for about 20 business functions; integration is the top driver of tech satisfaction; overall tech-stack satisfaction declined; and advisors broadly prefer AI that keeps a human in the loop. Source file: `/home/jameson/keepance/docs/strategy/positioning/research/kitces-report-2025-digest.md`.

External sources used inline include vendor pages, vendor press releases, SEC/FINRA/Microsoft documentation, and industry coverage.

---

# 1. Current state of AI by advisor software category

## CRM

### Wealthbox

**What shipped / announced**

- **AI-powered reports**: Wealthbox says its March 2026 AI launch followed prior releases of AI-powered Reports and Wealthbox AI Notetaker. I did not find a primary source with the exact original release date for AI Reports, so date confidence is medium. Source: https://www.prnewswire.com/news-releases/wealthbox-announces-early-access-to-new-ai-features-for-financial-advisors-302707692.html
- **Wealthbox AI Notetaker**: Native meeting capture inside Wealthbox Meetings. It records, transcribes, summarizes, saves structured notes to the right contact record, creates follow-up email drafts, and converts generated ideas into tasks. Current product page confirms the feature. Source: https://www.wealthbox.com/ai-notetaker/
- **AI Notetaker enhancements, 2026**: Uploading audio recordings, meeting reports and filters, meeting AI status visibility, better contact/task association, and expanded prep. Source: https://www.wealthbox.com/webinars/new-ai-notetaker-enhancements-in-wealthbox/
- **Wealthbox AI early access, March 9, 2026**: Agents, Playbooks, and AI Assistant. Agents run scheduled/triggered background processes, monitor workloads, flag overdue tasks, and take action. Playbooks are saved prompts for multi-step workflows. The AI Assistant answers questions about CRM data, prepares meeting briefings, and drafts personalized communications. Source: https://www.prnewswire.com/news-releases/wealthbox-announces-early-access-to-new-ai-features-for-financial-advisors-302707692.html

**Positioning meaning for Keepance**

Wealthbox is directly moving toward "CRM as action layer." This is a real threat inside firms that already live in Wealthbox. Keepance should avoid sounding like "a smarter CRM." The opening is that Wealthbox's AI is strongest inside Wealthbox's own system of record. Keepance can win where the answer lives across PDFs, email archives, tax docs, planning reports, custodian statements, loose folders, SharePoint/OneDrive, and other tools that are not cleanly represented in CRM fields.

### Redtail / Orion

**What shipped / announced**

- **Redtail Speak AI Assistant, January 2024**: Orion announced Redtail Speak AI features using ChatGPT-3.5. The assistant scans message history in a Speak room and provides suggested responses plus autocomplete. Redtail Speak conversations, messages, and documents are searchable, archived daily, and shareable with email surveillance providers. Source: https://www.businesswire.com/news/home/20240123152275/en/Orion-and-Redtail-Boost-Advisor-Efficiency-with-Premier-EmailCalendar-Integration-and-AI-Enhancements
- **AI-first Redtail CRM direction, 2026 blog**: Redtail previewed future plans for an AI-first CRM: natural-language searches/reports, prompt-triggered workflows, adding accounts through multi-step actions, next-best actions, outreach candidates, anniversaries, milestone alerts, and client touch recommendations. This reads as roadmap/tease, not a fully shipped general feature. Source: https://redtailtechnology.com/blog/ricky-redtails-ascent-recap-tech-gets-smarter-so-advisors-stay-more-human
- **Orion platform AI, February 2025 onward**: Orion introduced AI-powered meeting agendas inside Portfolio View using portfolio analytics, planning data, and CRM notes. Source: https://www.businesswire.com/news/home/20250204421685/en/Orion-Enhances-its-Unified-Flexible-Advisor-Platform-with-New-Tech-Upgrades
- **Orion AI assistants, beta Q4 2025, broader rollout 2026**: WealthManagement.com reported Orion planned AI-driven data queries, a reporting assistant, an executive insights dashboard, and a digital platform for high-net-worth clients. Source: https://www.wealthmanagement.com/artificial-intelligence/orion-to-release-new-ai-assistants-for-advisors-in-2026

**Positioning meaning for Keepance**

Redtail/Orion's strength is distribution and existing advisor workflow. The weakness is that many advisors view Orion as broad and complex, and AI in Redtail is still partly roadmap. Keepance should not compete with Redtail's core CRM tasks. It should give Redtail users an evidence layer over everything Redtail cannot see well.

### Salesforce Financial Services Cloud / Agentforce

**What shipped / announced**

- **Financial Services Cloud Einstein**: Salesforce has long marketed Einstein for financial advisors, including relationship intelligence and opportunity insights. Older source but still part of Salesforce's AI lineage: https://www.salesforce.com/ca/blog/introducing-financial-services-cloud-einstein/
- **Agentforce for Financial Services, May 21, 2025**: Salesforce introduced pre-built, role-based AI agent templates for banking, wealth, and insurance. Wealth use cases include preparing for an investment review, automating front-office tasks, and reducing administrative overhead. Source: https://www.salesforce.com/news/stories/agentforce-for-financial-services-announcement/
- **Wealth management AI agents**: Salesforce's wealth-management page says pre-built AI agents can automate manual research, summarize complex accounts, and generate meeting briefs. Source: https://www.salesforce.com/financial-services/wealth-management-software/
- **Agentforce Financial Services product page**: Salesforce positions Agentforce for Financial Services as agentic AI grounded in industry data and contextualized for banking, wealth, and insurance firms. Source: https://www.salesforce.com/financial-services/artificial-intelligence/

**Positioning meaning for Keepance**

Salesforce is a strong threat in enterprise advisory firms that already have implementation budgets, clean data models, Salesforce admins, Data Cloud, and compliance teams. It is less threatening for solo/small RIAs that do not want a Salesforce project. Keepance can win by being lighter, local-first, and useful even when the advisor's "system of record" is a mix of Outlook, folders, PDFs, Wealthbox/Redtail exports, planning reports, and custodian portals.

### Advyzon

**What shipped / announced**

- **Advyzon AI, visible by early 2026**: Advyzon markets Advyzon AI as an agentic intelligence layer across its all-in-one platform. It connects permissioned data across CRM, portfolios, planning, trading/rebalancing, reporting, documents, communications, and workflows. Source: https://www.advyzon.com/advyzon-ai/
- Specific features listed: client meeting prep, AI Notetaker post-meeting summaries and action items, next-best actions, task generation, workflow triggering, firm performance/advisor productivity visibility, at-risk client/growth opportunity spotting, and document data extraction with discrepancy/missing-information review. Source: https://www.advyzon.com/advyzon-ai/

**Positioning meaning for Keepance**

Advyzon is one of the closest conceptual threats because it is already all-in-one and now markets "one platform, now agentic." But that is also its limit: it works best when firms are in Advyzon. Keepance can be the "works with the messy stack you already have" alternative.

## Financial planning

### eMoney

**What shipped / announced**

- **Needs Analysis with embedded solver intelligence, launched earlier in 2025**: eMoney described an enhanced Needs Analysis for fast topical planning around goals like retirement, education, and life insurance. Source: https://www.prnewswire.com/news-releases/emoney-advisor-presents-product-roadmap-and-expert-insights-on-the-future-of-financial-planning-during-annual-summit-302589135.html
- **eMoney CoPlanner, beta as of October 2025**: eMoney said CoPlanner was in beta with over 1,000 advisors. It analyzes a client's full financial picture and suggests strategies tailored to goals. It was "fast, compliant" and users reported 48% average time savings. Source: https://www.prnewswire.com/news-releases/emoney-advisor-presents-product-roadmap-and-expert-insights-on-the-future-of-financial-planning-during-annual-summit-302589135.html
- **Machine-learning account categorization, planned early 2026**: eMoney said it would launch a machine-learning-powered Account Type categorization engine, plus payroll aggregation and real-time connection alerts. Source: https://www.prnewswire.com/news-releases/emoney-advisor-presents-product-roadmap-and-expert-insights-on-the-future-of-financial-planning-during-annual-summit-302589135.html
- **AI research, not necessarily product**: eMoney's 2025 research found planners see AI opportunities in large-data analysis, automation, personalization, compliance, and hidden-opportunity detection. It also found concerns around inaccurate output, lack of human oversight, and data security. Source: https://emoneyadvisor.com/blog/understand-ai-in-financial-planning/

**Confidence note**

CoPlanner was beta/roadmap in the source. I did not verify general availability by June 24, 2026.

**Positioning meaning for Keepance**

eMoney owns planning workflows and client portal data, but its AI is naturally tied to plan data. Keepance should not "build plans." It should prepare the advisor with cited evidence and missing questions before they update eMoney.

### RightCapital

**What shipped / announced**

- **AI Smart Import, Q1/March 2026**: Smart Import reads uploaded documents such as meeting transcripts, investment statements, account statements, and client emails; identifies plan-relevant data; and converts it into RightCapital plan inputs for advisor review. RightCapital said internal testing showed 70%+ time savings versus manual entry. Sources: https://www.rightcapital.com/blog/q1-2026-updates/ and https://t3technologyhub.com/rightcapital-introduces-smart-import-ai-powered-tool-to-reduce-the-time-to-manually-input-plan-data-by-70-percent/
- **OCR migration tools, October 2025 and Q1 2026**: RightCapital added OCR-based migration from eMoney reports first, then MoneyGuide reports, to reduce switching cost. Source: https://www.rightcapital.com/blog/q1-2026-updates/
- **Iris AI Agent, June 23, 2026**: RightCapital launched Iris to analyze client information within financial planning software, review profile data, identify plan inconsistencies, run retirement simulations, and use Plan Builder to suggest strategies based on probability targets. It is available to Premium and Platinum users at no added charge. Source: https://www.wealthmanagement.com/artificial-intelligence/rightcapital-launches-iris

**Positioning meaning for Keepance**

RightCapital is a strong example of AI becoming embedded where the work already happens. Keepance should integrate with planning outputs and input prep, not try to replace plan-building. The obvious Keepance use case: "Here are the client facts, documents, emails, and prior advice that should be reviewed before you update RightCapital."

### Envestnet MoneyGuide / MoneyGuidePro

**What shipped / announced**

- **Dash, March 2026**: Envestnet launched Dash inside MoneyGuide to create a clear planning snapshot for prospects and under-advised clients using five essential data points. This is a planning simplification/prospecting tool; the source does not describe it as generative AI. Source: https://newsroom.envestnet.com/2026-03-09-Envestnet-MoneyGuide-Launches-Dash%2C-Further-Simplifying-Streamlining-the-Planning-Experience
- **MoneyGuide tax and retirement income updates, March 2026**: Same release says Envestnet enhanced retirement income and tax planning capabilities. Source: https://newsroom.envestnet.com/2026-03-09-Envestnet-MoneyGuide-Launches-Dash%2C-Further-Simplifying-Streamlining-the-Planning-Experience
- **Envestnet AI layer, June 2025**: Envestnet launched Gen BI and Insights AI across its platform. This matters for MoneyGuide because Envestnet owns MoneyGuide and is building a broader wealth data/decision layer. Source: https://newsroom.envestnet.com/2025-06-04-Envestnet-Unveils-Two-Breakthrough-AI-Innovations%2C-Ushering-in-a-New-Era-of-Intelligence-Driven-Wealth-Management

**Confidence note**

I did not verify a MoneyGuide-specific genAI planning agent comparable to RightCapital Iris as of June 24, 2026. Envestnet's AI is real, but the public evidence is more platform-wide than MoneyGuide-specific.

**Positioning meaning for Keepance**

MoneyGuide remains a planning system, not a broad client-file intelligence layer. Keepance can be useful before and after MoneyGuide by summarizing evidence and drafting advisor/client communication tied to the source documents.

### Conquest Planning

**What shipped / announced**

- **Strategic Advice Manager (SAM)**: Conquest markets SAM as a proprietary AI expert system that is deterministic, auditable, and built on codified financial-planning best practices. It traces recommendations from input to output. Source: https://conquestplanning.com/sam
- **AI-powered planning platform**: Conquest says its platform is built on a deterministic AI engine that makes recommendations auditable, consistent, and verifiable. Source: https://conquestplanning.com/
- **US expansion and investment, June 2025**: Barron's reported Conquest raised about CAD 110 million / USD 80 million led by Goldman Sachs, with Citi and others, and described its proprietary AI planning suggestions after examining client information. Source: https://www.barrons.com/articles/goldman-sachs-citi-ai-conquest-6d9d6ee9
- **Agentic features noted in 2026 RightCapital coverage**: WealthManagement.com reported Conquest had introduced agentic features including SAM Guide in March 2026. Source: https://www.wealthmanagement.com/artificial-intelligence/rightcapital-launches-iris

**Positioning meaning for Keepance**

Conquest is one of the strongest "AI that actually makes planning recommendations" examples. Keepance should not frame itself as making financial-planning recommendations. The safer and more defensible lane is cited client context, drafting, and evidence collection for the human advisor.

## Tax planning

### Holistiplan

**What shipped / announced**

- **Tax return analysis and planning reports**: Holistiplan markets tax planning software that analyzes tax returns, identifies planning opportunities, supports tax projections/scenarios, and creates client-friendly reports. Current product page: https://www.holistiplan.com/
- **Estate and related planning expansion**: Holistiplan describes estate reporting, asset diagrams, and beneficiary reviews. Source: https://www.holistiplan.com/resources/articles/best-software-for-estate-planning/
- **Zocks partnership, 2025/2026**: Zocks announced a Holistiplan partnership to streamline advisor workflows through AI-powered automation. Source: https://www.zocks.io/press/holistiplan-and-zocks-announce-strategic-partnership-to-streamline-advisor-workflows-through-ai-powered-automation

**Confidence note**

Holistiplan is often described in the market as AI/OCR-driven tax return reading, but its own current page emphasizes tax planning outcomes more than naming generative AI. I would not over-claim "genAI" for Holistiplan without stronger primary proof.

**Positioning meaning for Keepance**

Holistiplan is a specialist. Advisors will keep using it for tax outputs. Keepance can help pull tax insights into the broader client context: "Which clients mentioned Roth conversion concerns in email, have tax docs in the folder, and need a draft agenda?"

### FP Alpha

**What shipped / announced**

- **AI document reading across tax, estate, and insurance**: FP Alpha says its AI-driven technology reads clients' tax returns, wills, trusts, and insurance policies; summarizes key data; identifies actionable planning insights; quantifies advice value; and helps advisors scale advanced planning. Source: https://fpalpha.com/
- **Platform uses AI plus subject matter experts**: FP Alpha says its platform uses a combination of AI and subject matter experts for holistic planning advice. Source: https://fpalpha.com/solutions/
- **NextGen Tax Insights, announced around T3 2025**: T3 reported FP Alpha introduced NextGen Tax Insights, an AI-driven tax planning feature. Source: https://t3technologyhub.com/fp-alpha-announces-expansion-of-ai-powered-solutions-with-nextgen-tax-insights-and-new-enterprise-features-at-t32025-conference/
- **2025 tax management expansion**: FP Alpha's own media page references FP Alpha launching an AI-powered tax management tool and NextGen Tax Insights in October 2025 coverage. Source: https://fpalpha.com/advertorials/

**Positioning meaning for Keepance**

FP Alpha overlaps more with Keepance on document reading. The difference is scope and architecture. FP Alpha is an advanced-planning analysis tool; Keepance can be the local evidence layer across all client material, not just tax/legal/insurance documents uploaded to FP Alpha.

### TaxStatus

**What shipped / announced**

- **Verified IRS client data**: TaxStatus retrieves official IRS-sourced client data through client consent, reducing reliance on clients uploading/scanning tax documents. Source: https://www.taxstatus.com/
- **Financial Baseline, 2025**: T3 reported TaxStatus introduced Financial Baseline, using a 60-second client consent process and direct IRS integration across 100+ IRS forms/schedules and 200+ transcripts for individuals, businesses, and trusts. Source: https://t3technologyhub.com/taxstatus-introduces-the-taxstatus-financial-baseline-empowering-advisors-and-clients-with-a-complete-financial-picture-sourced-directly-from-irs-data/
- **Advice.ai partnership, March 2026**: TaxStatus and Advice.ai partnered to deliver AI-powered tax planning strategies built on verified financials. Source: https://www.businesswire.com/news/home/20260309927898/en/TaxStatus-and-Advice.ai-Partner-to-Deliver-the-Industrys-Most-Comprehensive-AI-Powered-Tax-Planning-Strategies-Built-on-Verified-Financials
- **Tax Strategies product page**: TaxStatus says Advice.ai evaluates 100+ strategies against verified IRS data, with eligibility, savings estimates, implementation steps, and IRS code references. Source: https://www.taxstatus.com/strategies

**Positioning meaning for Keepance**

TaxStatus has a very defensible data source: IRS records. Keepance should not compete with IRS data access. The overlap is connecting tax insights to the rest of the household record and helping the advisor draft/refine communication with cited support.

## Portfolio management / performance reporting

### Orion

**What shipped / announced**

- **Denali AI / embedded AI positioning**: Orion's current product page says Orion Advisor Technology combines portfolio accounting, Redtail CRM, trading, planning, compliance, portals, and embedded AI (Denali AI). Source: https://orion.com/advisor-tech
- **AI-powered meeting agendas, February 2025**: Orion added auto-generated meeting agendas inside Portfolio View, using portfolio analytics, financial planning, CRM notes, and AI. Source: https://www.businesswire.com/news/home/20250204421685/en/Orion-Enhances-its-Unified-Flexible-Advisor-Platform-with-New-Tech-Upgrades
- **AI assistants, 2025-2026**: Orion planned natural-language data queries, a reporting assistant, executive insights dashboard, and HNW digital platform, with beta in Q4 2025 and broader rollout in 2026. Source: https://www.wealthmanagement.com/artificial-intelligence/orion-to-release-new-ai-assistants-for-advisors-in-2026

**Positioning meaning for Keepance**

Orion can become a strong "AI inside the all-in-one" competitor. Keepance wins where advisors are not fully in Orion or where the needed evidence sits outside Orion's data universe.

### Envestnet / Tamarac

**What shipped / announced**

- **Gen BI and Insights AI, June 2025**: Envestnet launched Generative Business Intelligence and Insights AI. Gen BI lets users ask natural-language questions and generate grids, charts, dashboards, and widgets with data explainability. Insights AI builds on an Insights Engine that Envestnet says already generates 25 million+ next-best actions daily, adding agentic workflows for tax-loss harvesting opportunities, asset consolidation, meeting briefs, and milestone outreach. Source: https://newsroom.envestnet.com/2025-06-04-Envestnet-Unveils-Two-Breakthrough-AI-Innovations%2C-Ushering-in-a-New-Era-of-Intelligence-Driven-Wealth-Management
- **Tamarac is part of Envestnet's end-to-end RIA platform**: Tamarac covers reporting, trading/rebalancing, CRM, proposals, billing, and client portal. Source: https://www.envestnet.com/tamarac
- **Five-year roadmap, September 2025**: Envestnet announced investment in R&D, client support, and AI, including unified advisor experience across planning, investment management, performance reporting, and engagement. Source: https://www.prnewswire.com/news-releases/envestnet-announces-five-year-strategic-roadmap-marked-by-investments-in-research--development-client-support-and-ai-302548816.html

**Confidence note**

I found strong Envestnet-wide AI evidence, but less public detail tying specific genAI features to Tamarac Reporting alone. Treat Tamarac as part of the broader Envestnet AI direction.

**Positioning meaning for Keepance**

Envestnet's AI is aimed at firm-scale data and decisioning. Keepance's advantage for small RIAs is a lower-lift, advisor-owned, local-first layer over the advisor's actual files and tools.

### SS&C Black Diamond

**What shipped / announced**

- **Core platform remains portfolio management/reporting/client portal**: Black Diamond markets portfolio visibility, unified reporting, data aggregation, client experience, and workflow. Source: https://www.sscblackdiamond.com/
- **No clearly verified Black Diamond-specific generative AI feature found in this research window.** I found broad market references to Black Diamond, and the Kitces index notes Morningstar Office pushing advisors to Black Diamond in 2026, but I did not verify a named Black Diamond AI assistant comparable to Orion's Denali, Envestnet Insights AI, or Advyzon AI.

**Positioning meaning for Keepance**

Black Diamond is a strong incumbent system, but not obviously an AI answer layer yet. Keepance can work alongside it by reading reports, exports, files, and advisor notes.

### Advyzon

**What shipped / announced**

- **Advyzon AI spans portfolio/performance data**: Advyzon AI explicitly connects CRM, portfolios, planning, trading/rebalancing, reporting, documents, communications, and workflows. Features include client intelligence, next-best actions, practice intelligence, at-risk clients, growth opportunities, and document intelligence. Source: https://www.advyzon.com/advyzon-ai/
- **All-in-one satisfaction position**: Advyzon says it ranked highly in CRM, portfolio management, performance reporting, client portals, and file sharing in the 2025 Kitces AdvisorTech rankings; this reinforces the threat that Advyzon can make AI feel native to one connected workspace. Source: https://www.advyzon.com/

**Positioning meaning for Keepance**

Advyzon is the all-in-one version of Keepance's "cross-source" promise, but only for firms inside the Advyzon world. Keepance should be the independent layer for advisors who do not want to switch into an all-in-one.

## AI meeting notetakers and meeting assistants

### Jump

**What shipped / announced**

- **Advisor AI meeting workflow, 2023 onward**: Jump was founded in 2023 and says it delivers 20+ AI-powered features including meeting prep, note-taking, recaps, follow-ups, CRM updates, and growth insights. Source: https://jump.ai/press/jump-launches-ai-associate-an-intelligent
- **AI Operating System / products**: Jump's navigation lists Notetaker, Pre-meeting prep, Agendas, Post-meeting data sync, Follow-up, Meeting scheduling, Signals, Playbooks, Scorecards, Pulse & Surveys, Dashboards, AI intake forms, Document intelligence, and Email assistant. Source: https://jump.ai/press/jump-launches-ai-associate-an-intelligent
- **AI Associate, March 26, 2026**: Jump launched AI Associate, an agent that can answer questions and take action across meetings, CRM, email, planning systems, and more. It can ask across the tech stack, create/update records, draft/send client communications, schedule meetings, and requires human confirmation for actions. Source: https://jump.ai/press/jump-launches-ai-associate-an-intelligent

**Positioning meaning for Keepance**

Jump is the most important category proof that advisors will pay for AI when it removes painful admin work. It is also a threat because Jump is expanding from notetaker to operating system. Keepance should not lead with meeting notes. It should focus on the client record outside the meeting and evidence across long-lived files and email.

### Zocks

**What shipped / announced**

- **Privacy-first AI assistant**: Zocks markets meeting notes, intake forms, client emails, CRM updates, and financial plans. Source: https://www.zocks.io/
- **Next-gen platform, September 8, 2025**: Zocks announced automatic capture of client data from conversations to populate planning, onboarding, and proposal systems. It said advisors could go from meeting to proposed plan in under 10 minutes. Source: https://www.zocks.io/press/zocks-launches-next-gen-ai-assistant-to-accelerate-client-acquisition-and-servicing-for-financial-advisors
- **Zocks Forms, Coaching Center, Zocks Email, Live Zocks AI Assistant in Zoom**: These include intake/account-opening workflows, meeting scorecards, email drafting from conversation/CRM/plan/portfolio data, and real-time client data inside Zoom. Source: https://www.zocks.io/press/zocks-launches-next-gen-ai-assistant-to-accelerate-client-acquisition-and-servicing-for-financial-advisors
- **Integrations**: Zocks says the next-gen features use two-way integrations with eMoney, Orion, PreciseFP, and dozens of other tools. Source: https://www.zocks.io/press/zocks-launches-next-gen-ai-assistant-to-accelerate-client-acquisition-and-servicing-for-financial-advisors
- **Client Queries, June 2026**: Zocks site references a June 2026 agentic AI capability for book-wide intelligence and service/growth needs. Source visible in press page links: https://www.zocks.io/press/zocks-launches-next-gen-ai-assistant-to-accelerate-client-acquisition-and-servicing-for-financial-advisors

**Positioning meaning for Keepance**

Zocks overlaps with Keepance on "client intelligence" and privacy-first language. But its center is still meeting/conversation capture and workflow automation. Keepance can win on local-first storage, deep file/email indexing, and source citations from the advisor's own historical record.

### Zeplyn

**What shipped / announced**

- **Agentic AI for wealth managers**: Zeplyn markets an agentic AI platform that captures meetings, researches clients, identifies opportunities, and executes work across the firm. Source: https://www.zeplyn.ai/
- **Seed funding and positioning, 2024/2025**: Zeplyn says it is built by former Google engineers and purpose-built for wealth management workflows, cutting manual work by more than 90%. Source: https://www.zeplyn.ai/newsroom/zeplyn-raises-3m-seed-funding
- **Advisor-in-the-loop framing**: Zeplyn emphasizes keeping advisors in AI workflows. Source: https://www.zeplyn.ai/blogs/wealth-management-advisor-in-the-loop-ai

**Positioning meaning for Keepance**

Zeplyn is another agentic-workflow competitor. The likely split is cloud workflow execution versus local cited knowledge work. Keepance should be very explicit that it is a verifiable private research/drafting layer, not a meeting bot.

### Fathom

**What shipped / announced**

- **Generic AI notetaker**: Fathom is a broad meeting notes product, not advisor-specific. Its current page markets bot/no-bot meeting capture, instant AI summaries, and enterprise features such as SSO/SCIM/compliance. Source: https://www.fathom.ai/

**Positioning meaning for Keepance**

Fathom competes only around meeting notes. Advisor-specific firms like Jump and Zocks are more serious threats because they understand CRM, compliance, and wealth workflows. Keepance should avoid being compared to generic notetakers.

## Microsoft 365 Copilot and Purview

**What shipped / announced**

- **Microsoft 365 Copilot for financial services use cases**: Microsoft says Copilot can identify relevant source materials, create messages and documents, and pull information from Microsoft Graph, the API layer connecting Microsoft 365 data, documents, and users. Source: https://www.microsoft.com/en-us/microsoft-cloud/blog/financial-services/2025/06/16/4-ways-microsoft-copilot-empowers-financial-services-employees/
- **Copilot Studio Financial Insights template**: Microsoft has a Financial Insights agent template for financial services professionals, intended to help build agents that access organizational financial documents and other resources such as news and regulatory reports. Source: https://learn.microsoft.com/en-us/microsoft-copilot-studio/template-fin-insights
- **Microsoft Purview for AI governance**: Microsoft Purview provides controls for AI usage, including Data Security Posture Management for AI, compliance controls, and governance for Copilots, agents, and other generative AI apps. Sources: https://learn.microsoft.com/en-us/purview/ai-microsoft-purview and https://learn.microsoft.com/en-us/purview/ai-m365-copilot
- **Financial-services compliance assessment, January 2025**: Microsoft published a financial-services compliance assessment for Microsoft 365 Copilot, aimed at building confidence for regulated firms. Source: https://www.microsoft.com/en-us/microsoft-cloud/blog/financial-services/2025/01/30/new-compliance-assessment-builds-financial-services-confidence-in-microsoft-365-copilot/
- **Purview oversharing controls**: Microsoft markets Purview controls to identify oversharing risks, detect risky activity, and apply policy recommendations. Source: https://www.microsoft.com/en-ie/security/business/solutions/data-security-b

**Positioning meaning for Keepance**

Copilot is the biggest horizontal threat because many advisors already live in Outlook, Word, Excel, Teams, OneDrive, and SharePoint. But Copilot is not local-first, not advisor-specific, and only sees what Microsoft Graph and connectors expose. It also inherits the firm's permission problems. Keepance can win by:

- Being household/client-aware rather than file-search-only.
- Including non-Microsoft sources and local folders.
- Providing stronger citation discipline.
- Avoiding Keepance-server custody of client data.
- Giving small RIAs useful privacy posture without requiring enterprise Purview setup.

## Emerging standalone AI assistant / agentic AI category

### Vega Minds

**What shipped / announced**

- **AI Associate Advisor**: Vega markets automation for email drafts, meeting prep, notetaking, follow-ups, CRM updates, research, and logging. Source: https://vegaminds.com/
- **Cross-tool layer**: Vega says it sits between tools, pulling in data and pushing out results, with Outlook, Gmail, Zoom, Google Meet, Salesforce, Wealthbox, and Redtail shown on its site. Source: https://vegaminds.com/
- **App Store description**: Vega syncs with Outlook/Gmail, Zoom/Google Meet, CRM, internal data, public communications, client deliverables, articles, blogs, and podcasts. Source: https://apps.apple.com/us/app/vega-minds/id6505107676

**Positioning meaning for Keepance**

Vega is directly adjacent to Keepance on "AI associate." Keepance should differentiate on local-first architecture, source-cited answers, privacy, and not claiming to be another worker that operates the whole practice.

### Parthean

**What shipped / announced**

- **AI-enhanced planning platform**: Parthean markets itself for advisors as an AI-enhanced financial planning platform that eliminates document reading/data entry and does research on any topic. Source: https://www.parthean.com/
- **Consumer/client financial assistant**: Parthean also markets a client app with a financial assistant that answers using personal financial information. Source: https://www.parthean.com/client-app

**Positioning meaning for Keepance**

Parthean is closer to planning and client-facing financial assistant territory. Keepance should stay clearly advisor-facing and evidence/drafting-focused.

### CogniCor

**What shipped / announced**

- **Advisor AI assistant/copilot**: CogniCor markets an AI assistant for financial advisors that centralizes, cleans, and organizes client data in real time by connecting CRM, planning tools, and other sources. Source: https://www.cognicor.com/post/how-ai-assistant-for-financial-advisors-simplifies-client-management
- **Meeting assistant / intelligence layer**: CogniCor markets meeting prep, client summaries, follow-ups, and real-time insights. Source: https://www.cognicor.ai/
- **Wealthbox integration, 2024**: Wealthbox describes CogniCor's Sam as an AI-powered meeting assistant inside Wealthbox that can create agendas, schedule meetings, and generate post-meeting notes/tasks. Source: https://www.wealthbox.com/cognicor-partners-with-wealthbox-to-provide-advisors-with-an-ai-driven-meeting-assistant/

**Positioning meaning for Keepance**

CogniCor is another direct "advisor copilot" threat. Its public positioning is broader client management and meeting assistant. Keepance should be concrete about the job: private, cited client intelligence from existing local/client files and communications.

---

# 2. White space for Keepance

## The gap

The market is filling with AI, but most shipped features are bounded by the vendor's own system:

- CRM AI knows CRM data.
- Planning AI knows planning inputs and outputs.
- Tax AI knows tax/legal/insurance documents uploaded to that platform.
- Meeting AI knows calls, transcripts, follow-ups, and CRM sync.
- Microsoft Copilot knows the Microsoft 365 data estate and whatever connectors the firm configures.
- All-in-one platforms know more, but only if the advisor moves into that all-in-one ecosystem.

The practical advisor reality is messier:

- Client facts are scattered across Outlook/Gmail, PDFs, tax returns, planning reports, custodian statements, old notes, CRM fields, Excel sheets, Word docs, downloads folders, shared drives, and portals.
- Advisors often need the answer before they know which app contains it.
- The "truth" is often in a PDF, attachment, email thread, old meeting note, or client-provided document, not a clean CRM field.
- Advisors are compliance-sensitive and mistake-sensitive. They need to know why the answer is true.

That leaves a real opening for Keepance:

> **A private, local, cited answer-and-drafting layer over the advisor's existing client knowledge.**

This is not the same as being an AI assistant that "runs the practice." It is closer to a trusted research desk living on the advisor's machine.

## What would make an advisor adopt Keepance

### 1. It saves time on a painful, frequent job

The strongest use case is not "ask anything." It is a narrow set of jobs advisors already hate:

- "Prep me for the Smith review with citations."
- "What changed since the last meeting?"
- "What did they say about Roth conversions, college funding, inherited IRA, RSUs, insurance, estate docs, or cash needs?"
- "What files are missing before I update the plan?"
- "Draft a follow-up email based only on verified facts."
- "Give me the source for every claim."

If Keepance saves 20-45 minutes before every review meeting, it has a real wedge.

### 2. It does not ask them to switch systems

Advisors resist switching core tools. Keepance must feel additive:

- No CRM replacement.
- No planning replacement.
- No custodian replacement.
- No new place where the advisor must maintain client records.
- Reads from existing folders, email, exports, and integrations.
- Produces drafts and cited answers that can be pasted/sent/saved elsewhere.

This answers stack fatigue better than "we integrate with everything" alone.

### 3. Citations make AI usable

Generic AI answers are not enough for regulated advice. Keepance should make every important answer look like:

- Claim.
- Source file/message.
- Date.
- Exact excerpt or page reference.
- Confidence/limits.
- "I could not find support for X."

This turns AI from a black box into a research assistant the advisor can supervise.

### 4. Privacy is not a slogan

The privacy claim must be exact:

- "Your local index and working copy stay on your machine."
- "Keepance does not store your client data on Keepance servers."
- "You can run a local model, or you can use your own API key."
- "If you use a cloud AI provider with your own key, the prompt data may be sent to that provider under your account and contract. It does not pass through Keepance servers."

That last sentence matters. Overstating "data never leaves your machine" would create trust and compliance risk if BYOK cloud models are used.

### 5. It gives the compliance officer something to like

Even solo RIAs have compliance pressure. Keepance should have:

- Audit logs of prompts/outputs when enabled.
- Exportable records for retention.
- Source citations.
- Human approval before sending anything.
- Clear data-flow diagram.
- No training on advisor/client data.
- Controls for which folders/accounts are indexed.
- Clear local data deletion and re-indexing behavior.

## What would make advisors reject Keepance

### 1. "I do not want another tool"

This is the biggest objection. If Keepance requires a new daily workflow, manual data entry, or another dashboard to babysit, it loses.

Mitigation:

- Lead with "works over the tools and files you already have."
- Keep setup shallow.
- Make the first useful result happen fast.
- Push output back to email/CRM/docs, rather than forcing work to stay in Keepance.

### 2. "My CRM/planning/notetaker already does AI"

This objection will grow. The answer is:

- "Those tools know what is inside those tools. Keepance is for the whole client record across tools, files, and email, with citations."

### 3. "I cannot risk wrong AI"

Mitigation:

- Never present unsupported claims as fact.
- Make "not found" an acceptable answer.
- Provide citations by default.
- Show source context, not just a link.
- Use a human-in-the-loop workflow.

### 4. "Compliance will not approve it"

Mitigation:

- Provide plain-English security/compliance documentation.
- Support local-only/local-model mode.
- Provide BYOK documentation explaining provider risk.
- Provide retention/export controls.
- Avoid client-facing autonomous advice.

### 5. "Setup will be a mess"

Mitigation:

- Start with local folders + Outlook/Gmail + common PDF/doc formats.
- Let advisors test on one client household.
- Avoid requiring full CRM API integration on day one.
- Provide a "source readiness" report: what Keepance can and cannot read.

---

# 3. Threats and strongest counter-arguments

## Threat: Microsoft 365 Copilot + Purview

**How real:** Very real. Many advisors already use Microsoft 365. Copilot is built into familiar apps. Microsoft Graph gives it access to email, calendar, documents, chats, and users. Purview gives firms governance and compliance controls. Sources: https://www.microsoft.com/en-us/microsoft-cloud/blog/financial-services/2025/06/16/4-ways-microsoft-copilot-empowers-financial-services-employees/ and https://learn.microsoft.com/en-us/purview/ai-m365-copilot

**Counter-argument against Keepance:** "Why buy Keepance if Copilot can search Outlook, Teams, Word, Excel, SharePoint, and OneDrive?"

**How Keepance can still win**

- Copilot is not advisor-native by default. It does not naturally model households, advisory workflows, planning-review prep, or client-specific compliance records.
- Copilot is strongest inside Microsoft 365. Advisors still have CRM, planning tools, custodians, tax tools, local files, downloads, PDFs, and non-Microsoft systems.
- Copilot inherits permission problems. If files are overshared, Copilot can surface them. Purview helps but requires setup and governance maturity.
- Keepance can be simpler for small RIAs: local index, scoped folders, explicit household mapping, and source-cited answers.
- Keepance can be more precise about "no Keepance server holds your client data."

**Required product proof**

Keepance must produce better advisor-specific answers than Copilot on real messy client folders, not just claim better privacy.

## Threat: Wealthbox AI and CRM-native AI

**How real:** Very real for Wealthbox users. Wealthbox has moved from notetaker to Agents, Playbooks, and AI Assistant inside the CRM. Source: https://www.prnewswire.com/news-releases/wealthbox-announces-early-access-to-new-ai-features-for-financial-advisors-302707692.html

**Counter-argument:** "I already live in Wealthbox. Why add another AI layer?"

**How Keepance can still win**

- Wealthbox AI is strongest on Wealthbox data and CRM workflows.
- Advisors still have evidence outside the CRM.
- Keepance should position as "the cited client evidence layer over your CRM, files, and email."
- Keepance can create CRM-ready notes/drafts without trying to own the CRM record.

## Threat: Jump and Zocks expanding from notetakers into operating systems

**How real:** Very real. Jump's AI Associate can ask across the tech stack and take actions. Zocks has forms, email, live Zoom assistant, client intelligence, and two-way integrations. Sources: https://jump.ai/press/jump-launches-ai-associate-an-intelligent and https://www.zocks.io/press/zocks-launches-next-gen-ai-assistant-to-accelerate-client-acquisition-and-servicing-for-financial-advisors

**Counter-argument:** "My meeting AI already handles prep, notes, follow-up, CRM updates, and email."

**How Keepance can still win**

- Meeting tools are optimized around conversations and post-meeting workflow.
- Keepance should own non-meeting client knowledge: old files, document folders, email history, planning PDFs, tax docs, and cross-source research.
- Keepance can also work for advisors who do not want a meeting bot recording/transcribing calls.
- Local-first is a sharper privacy stance than most cloud meeting assistants.

**Product requirement**

Keepance must avoid becoming a worse Jump/Zocks. It should not lead with notes. It should lead with "I found the answer in your records, and here is the source."

## Threat: Planning tools embedding AI

**How real:** High. RightCapital Smart Import and Iris are concrete. eMoney CoPlanner is in beta/roadmap. Conquest is AI-native. Sources: https://www.rightcapital.com/blog/q1-2026-updates/, https://www.wealthmanagement.com/artificial-intelligence/rightcapital-launches-iris, https://www.prnewswire.com/news-releases/emoney-advisor-presents-product-roadmap-and-expert-insights-on-the-future-of-financial-planning-during-annual-summit-302589135.html, https://conquestplanning.com/sam

**Counter-argument:** "The plan is where advice happens. AI belongs there."

**How Keepance can still win**

- Keepance should not generate financial plans or recommendations.
- Keepance helps gather, verify, and draft around the plan.
- The advisor still needs to know what changed in email/files before updating the planning tool.
- Planning tools cannot fully see every client source unless all evidence has been uploaded and structured.

## Threat: Tax and advanced-planning tools

**How real:** Medium to high for tax/legal/insurance documents. FP Alpha, Holistiplan, and TaxStatus/Advice.ai are credible specialists. Sources: https://fpalpha.com/, https://www.holistiplan.com/, https://www.taxstatus.com/strategies

**Counter-argument:** "Specialists already read tax returns and find strategies."

**How Keepance can still win**

- Do not compete as a tax strategy engine.
- Pull specialist outputs into the broader client context.
- Find cross-document context: emails about cash flow, planning PDFs, tax docs, estate docs, and old advisor notes.
- Help draft implementation emails and meeting agendas with citations.

## Threat: All-in-one platforms

**How real:** High for firms willing to consolidate. Advyzon AI and Orion/Envestnet AI are examples. Sources: https://www.advyzon.com/advyzon-ai/, https://newsroom.envestnet.com/2025-06-04-Envestnet-Unveils-Two-Breakthrough-AI-Innovations%2C-Ushering-in-a-New-Era-of-Intelligence-Driven-Wealth-Management, https://www.wealthmanagement.com/artificial-intelligence/orion-to-release-new-ai-assistants-for-advisors-in-2026

**Counter-argument:** "If everything is in one platform, the AI should live there."

**How Keepance can still win**

- Many advisors are not in one platform and do not want to switch.
- Even all-in-one users still have local files, email attachments, external PDFs, custodian documents, client-uploaded docs, and legacy archives.
- Keepance can become the independent memory layer that survives tool changes.

---

# 4. Compliance and regulatory angle

This section is not legal advice. It is the product/positioning read from current rules and regulatory signals.

## Regulation S-P 2024 amendments

The SEC adopted amendments to Regulation S-P in May 2024. Covered institutions, including registered investment advisers and broker-dealers, must have written incident response programs for unauthorized access to or use of customer information and notify affected individuals when sensitive customer information was or is reasonably likely to have been accessed or used without authorization. SEC final rule source: https://www.sec.gov/files/rules/final/2024/34-100155.pdf

Industry summaries emphasize three practical impacts:

- Formal incident response programs.
- Customer notification generally within 30 days when required.
- Vendor/service-provider oversight and reporting standards.
- Record retention around the program.

Sources: https://www.comply.com/resource/secs-regulation-s-p-amendments-what-organizations-need-to-know/ and https://www.finra.org/rules-guidance/guidance/cybersecurity-advisory-sec-amends-regulation-s-p

**How local-first changes the burden**

Local-first does not eliminate compliance. But it can reduce one of the hardest risks: a vendor holding a copy of client data in its own cloud.

If Keepance truly keeps the working client index and documents on the advisor's machine and does not send them to Keepance servers, then:

- Keepance is less exposed as a custodian of customer information.
- A Keepance server breach is less likely to be a client-data breach, because the server should not have the data.
- Vendor due diligence can focus more on software security, update mechanisms, telemetry, license/auth systems, local encryption, and support access.

But firms still need to assess:

- The advisor's endpoint security.
- Local backups.
- Whether Keepance telemetry or crash reports include sensitive data.
- Whether support staff can access client data.
- Whether the advisor uses a cloud AI provider through BYOK.
- Whether connectors pull data from email/cloud tools.

**BYOK nuance**

Bring-your-own-key shifts some AI-provider oversight to the advisor's contract and account with the model provider. Keepance should not say "data never leaves your machine" if the advisor chooses a cloud model. The safer claim:

> "Client data does not pass through Keepance servers. In local-model mode, prompts stay local. In BYOK cloud mode, prompts are sent directly from your environment to the AI provider you choose, under your account."

That wording is more compliant and more believable.

## SEC AI-washing enforcement

The SEC brought settled charges in March 2024 against Delphia and Global Predictions for allegedly false or misleading statements about their use of AI. The firms paid $400,000 in total civil penalties. Source: https://www.sec.gov/newsroom/press-releases/2024-36

**Implication for Keepance**

Do not overstate:

- Do not claim "fully compliant" in a blanket way.
- Do not claim "no data leaves your machine" unless local-only mode is being described.
- Do not claim "eliminates vendor oversight."
- Do not imply Keepance provides regulated financial advice.
- Do not imply AI recommendations are fiduciary advice.

Better:

- "Designed to support advisor review."
- "Cited answers from your records."
- "Human approval before client use."
- "No Keepance server stores your client working copy."
- "Retention/export features to support your books-and-records process."

## Books-and-records retention for AI outputs

Investment advisers and broker-dealers already have books-and-records duties for communications and recommendations. AI does not create an exception. If AI-generated content is used in client communication, recommendations, advice, marketing, meeting notes, or supervision, it may need to be retained under existing rules.

Useful legal/regulatory commentary:

- Skadden notes that AI capabilities in tools like Zoom and Microsoft can implicate SEC recordkeeping rules, especially for communications. Source: https://www.skadden.com/insights/publications/2024/09/how-and-when-sec-recordkeeping-rules-may-apply
- FINRA Regulatory Notice 24-09 points firms back to existing obligations around AI, supervision, communications, and technology governance. Source: https://www.finra.org/rules-guidance/notices/24-09
- Zocks' compliance guide says prompts and outputs can create books-and-records issues when used for recommendations or client communications. This is vendor commentary, not primary law, but it reflects the direction firms are hearing. Source: https://www.zocks.io/blog/ai-compliance-guide-for-financial-advisory-firms

**Implication for Keepance**

Keepance should support:

- Optional prompt/output logging.
- Export of answer, sources, and draft history.
- Clear labels: draft, not sent; sent/used externally; internal research.
- Source citation retention.
- Admin setting for retention policy.
- "Do not log" mode may be attractive for privacy, but firms need to understand when logs are required.

## Local-first compliance advantage

The strongest compliance argument is not "no compliance burden." It is:

> "Keepance can reduce the amount of client data entrusted to a new cloud vendor while improving the advisor's ability to verify, supervise, and retain AI-assisted work."

That is credible.

Specific advantages:

- Less vendor-side data custody.
- Fewer copies of sensitive files in third-party systems.
- Better evidence trail through citations.
- Human-in-the-loop drafting.
- Advisor-controlled AI provider choice.
- Local-only option for the most sensitive firms.

Specific remaining risks:

- Local machine compromise.
- Cloud model provider exposure in BYOK mode.
- Misconfigured file/folder access.
- Incorrect AI output.
- Missing citations.
- Retention gaps if outputs are used but not archived.
- Advisors pasting confidential data into other AI tools outside Keepance.

---

# Strategic positioning recommendation

## The best plain-English positioning

Keepance should not lead as:

- "An AI assistant for financial advisors."
- "An agentic AI operating system."
- "A CRM copilot."
- "AI that gives advice."
- "A notetaker."

Those categories are crowded or risky.

Keepance should lead as:

> **Private client intelligence for financial advisors. Ask questions across your existing client files, email, and tools. Get answers and drafts with clickable proof.**

Alternative internal framing:

> **The cited client-memory layer over the advisor's existing stack.**

## What must be true for the position to hold

1. **Citations are excellent.** If the citations are weak, Keepance becomes another hallucination-prone AI tool.
2. **Setup is simple.** If it takes a consulting project, small RIAs will not adopt.
3. **Privacy wording is exact.** Especially BYOK versus local-model mode.
4. **The product does not pretend to replace advice tools.** It should feed and support them.
5. **It handles messy advisor reality.** PDFs, emails, attachments, scans, folders, exports, and inconsistent client names.
6. **It makes "another tool" feel false.** The product must feel like a command/search layer over what already exists.

## Likely first buyer

The best early buyer is a planning-forward solo or small RIA that:

- Uses Wealthbox/Redtail/RightCapital/eMoney/Holistiplan/Orion/Tamarac/Black Diamond/Advyzon in some combination.
- Has lots of files and email history.
- Feels pain before reviews and follow-ups.
- Is nervous about uploading client data to generic AI.
- Wants to use AI but needs proof and control.
- Does not have a full operations team to maintain a perfect CRM.

## Likely first rejected buyer

The hardest early buyer is:

- A large enterprise with Microsoft Copilot, Purview, Salesforce, and a formal data team.
- An all-in-one Advyzon/Orion firm with strong internal adoption.
- A compliance-led firm that bans all AI except approved enterprise tools.
- An advisor who wants full automation and does not care about citations.

## Bottom line

The market is moving fast, and incumbents are adding AI everywhere. But most of that AI is still **inside a single system** or **centered on meetings**. Keepance's best wedge is the space between systems: the advisor's messy, private client memory.

The product has a real strategic gap if it can prove three things quickly:

1. It finds client answers across messy real-world sources better than Copilot or CRM AI.
2. It cites every important answer in a way advisors trust.
3. It reduces cloud-vendor data exposure instead of adding another copy of client data to the stack.

If those are true, Keepance can be positioned not as another app in the advisor stack, but as the private intelligence layer that makes the existing stack usable.
