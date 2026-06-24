# AI Features Across the Advisor Stack (mid-2026) — Consolidated Reference

**Purpose:** A single scannable answer to "what AI does each tool in a financial advisor's stack ship today?" — the input for assessing Keepance's positioning.
**Built from:** the Kitces 2025 report, ~50 Kitces monthly #AdvisorTech roundups (2022-2026), Kitces's AI analysis pieces, and an independent Codex web-research pass. Full per-vendor sourcing lives in `codex-independent-ai-landscape.md`; news-by-month detail in `advisortech-news-digest-2025-2026.md` and `...-2022-2024.md`.
**One-line takeaway:** **AI is now in every category of the stack, so "we have AI" is not a differentiator.** The race has split into three patterns (embedded-per-system AI, meeting-AI-becoming-an-OS, and a new contested "cross-source intelligence layer"). Trust is being won by **citations + privacy + human-in-the-loop**, not by automation.

---

## The verified stack (matches Keepance's onboarding screen + Kitces data)

Keepance's onboarding shows: **Wealthbox (CRM), RightCapital (planning), Holistiplan (tax), Envestnet/Tamarac (portfolio), Charles Schwab (custodian), Outlook (email), OneDrive (files), Jump (meeting notes).** The research confirms this is an accurate, representative solo/small-RIA stack. The other commonly-present tools to be aware of (so the stack story is complete):
- **CRM alternatives:** Redtail (Orion), Salesforce, Advyzon
- **Planning alternatives:** eMoney (market leader), MoneyGuidePro (Envestnet), Conquest
- **Tax alternatives:** FP Alpha, TaxStatus
- **Portfolio alternatives:** Orion, Black Diamond, Advyzon, Altruist
- **Notetaker alternatives:** Zocks, Zeplyn, Fathom
- **Near-universal horizontals:** Microsoft 365 / Outlook / OneDrive / SharePoint, Zoom, Calendly, DocuSign
- **Risk tolerance:** Nitrogen (Riskalyze), DataPoints
- **Account aggregation:** ByAllAccounts (being sold by Morningstar, 2026), Yodlee, Plaid

> Median firm = ~12 tools for ~20 jobs. No single tool holds the whole client picture, and integration between them is the #1 satisfaction gap.

---

## AI features by tool (current as of mid-2026)

### CRM
| Tool | Current AI features | Notable dates |
|---|---|---|
| **Wealthbox** | **AI Notetaker** (native meeting capture → structured notes filed to the contact, follow-up email drafts, tasks); **AI Reports**; **Wealthbox AI** = **Agents** (scheduled/triggered background processes that monitor workload, flag overdue, take action), **Playbooks** (saved multi-step prompt workflows), **AI Assistant** (Q&A on CRM data, meeting briefings, draft communications) | AI early access Mar 2026 |
| **Redtail / Orion** | Redtail Speak AI (suggested replies); **"AI-first CRM" roadmap** (NL search, prompt-triggered workflows, next-best-action); **Orion Denali AI** (embedded); Orion AI meeting agendas; Orion AI assistants (NL data queries, reporting assistant, exec insights) | Speak AI Jan 2024; Orion agendas Feb 2025; Orion assistants beta Q4 2025 → 2026 |
| **Salesforce FSC** | Einstein relationship/opportunity intelligence; **Agentforce for Financial Services** — pre-built wealth AI agents (investment-review prep, research automation, account summaries, meeting briefs) | Agentforce FS May 2025 |
| **Advyzon** | **Advyzon AI** — agentic layer across CRM/portfolio/planning/reporting/docs: meeting prep, notetaker, next-best-action, document data extraction + discrepancy/missing-info review | visible early 2026 |

### Financial planning
| Tool | Current AI features | Notable dates |
|---|---|---|
| **RightCapital** | **AI Smart Import** (reads transcripts, statements, emails → plan inputs, 70%+ time savings); OCR migration from eMoney/MoneyGuide; **Iris AI Agent** (reviews plan data, finds inconsistencies, runs retirement simulations, suggests strategies) | Smart Import Q1 2026; Iris Jun 23 2026 |
| **eMoney** | Enhanced Needs Analysis; **CoPlanner** (analyzes full picture, suggests goal-tailored strategies, ~48% time savings); ML account categorization | CoPlanner beta Oct 2025 |
| **MoneyGuide / Envestnet** | Dash (planning snapshot); **Envestnet Gen BI** (NL questions → charts/dashboards) + **Insights AI** (25M+ next-best-actions/day, agentic tax-loss/consolidation/meeting-brief workflows) | Gen BI/Insights AI Jun 2025; Dash Mar 2026 |
| **Conquest** | **Strategic Advice Manager (SAM)** — *deterministic, auditable* AI planning recommendations (traces input→output); SAM Guide (agentic) | SAM Guide Mar 2026 |

### Tax / advanced planning
| Tool | Current AI features | Notable dates |
|---|---|---|
| **Holistiplan** | AI/OCR **tax-return reading** + planning reports + scenarios; **estate-document extraction**; client-friendly reports | estate-doc tool Nov 2024 |
| **FP Alpha** | AI reads **tax returns, wills, trusts, insurance policies** → summaries + planning insights; **NextGen Tax Insights** (matches against advisor-vetted strategies, not open generation) | NextGen Tax Insights ~T3/Oct 2025 |
| **TaxStatus** | **IRS-direct verified client data** (100+ forms, 200+ transcripts via 60-sec consent); **Advice.ai** partnership = 100+ tax strategies evaluated vs verified IRS data | Advice.ai Mar 2026 |

### Portfolio / performance
| Tool | Current AI features | Notable dates |
|---|---|---|
| **Orion** | Denali AI (embedded); AI meeting agendas; AI assistants (NL queries, reporting assistant) | 2025-2026 |
| **Envestnet / Tamarac** | Gen BI + Insights AI (platform-wide; agentic next-best-actions) | Jun 2025 |
| **Black Diamond (SS&C)** | No clearly-named generative-AI assistant verified yet (core = reporting/aggregation/portal) | — |
| **Advyzon** | (see CRM row — same agentic AI spans portfolio data) | early 2026 |

### Meeting notetakers (the most-proven AI category — and the one expanding into an "OS")
| Tool | Current AI features | Notable dates |
|---|---|---|
| **Jump** | 20+ features (prep, notes, recaps, follow-ups, CRM updates); **Signals** (auto-detect held-away assets, referral mentions); document intelligence; AI intake; **AI Associate** — agent that asks across the whole stack, creates/updates records, drafts/sends comms, schedules (human-confirm) | AI Associate Mar 2026; ~27,000 advisors |
| **Zocks** | Privacy-first capture; **next-gen** (conversation → populated plan/onboarding/proposal in <10 min); Forms, Email, live Zoom assistant; **Client Queries** (book-wide intelligence); 2-way integrations (eMoney, Orion, PreciseFP) | next-gen Sep 2025; Client Queries Jun 2026 |
| **Zeplyn** | Agentic AI: captures meetings, researches clients, identifies opportunities, executes work; advisor-in-the-loop | 2024-2026 |
| **Fathom** | Generic (non-advisor) AI notetaker | — |
| **Nitrogen** | Added an AI notetaker (defending its risk/proposal franchise) | Aug 2025 |

### Horizontal / cross-source AI (the new battlefield) + standalone "AI assistants"
| Tool | Current AI features | Notable dates |
|---|---|---|
| **Microsoft 365 Copilot + Purview** | Copilot across Outlook/Word/Excel/Teams/SharePoint/OneDrive via Microsoft Graph; **Copilot Studio "Financial Insights" agent template**; **Purview** AI governance/oversharing controls; published FS compliance assessment | FS compliance assessment Jan 2025 |
| **Advisor360 / Orion / Envestnet / Dispatch / Milemarker** | Explicit "**unified data fabric / cross-platform intelligence layer**" plays — AI that reads across all advisor platforms and answers | named as a category by Kitces Jan 2026 |
| **Vega** | "AI Associate" — cross-tool layer (Outlook/Gmail/Zoom/Salesforce/Wealthbox/Redtail): email drafts, prep, notes, follow-ups, CRM updates, research | 2025-2026 |
| **Parthean** | AI-enhanced planning + a client-facing financial assistant app | 2025-2026 |
| **CogniCor** | Advisor copilot; "Sam" AI meeting assistant inside Wealthbox | Wealthbox integration 2024 |

---

## The three patterns (how to read all of the above)

1. **Embedded, single-system AI** (Wealthbox, RightCapital, Holistiplan, Orion, etc.): each tool added AI *over its own data*. Powerful inside that silo; blind to everything else. This is most of the market.
2. **Meeting AI becoming an "operating system"** (Jump, Zocks, Zeplyn): the notetaker was a Trojan horse. Jump's AI Associate and Zocks' Client Queries now reach across the stack and take actions. **This is the most direct competitive pressure on Keepance's "client intelligence" promise** — but it is centered on the *meeting* and is cloud-based.
3. **The contested cross-source intelligence layer** (Microsoft Copilot, Orion Denali, Advisor360 Unified Data Fabric, Dispatch, Milemarker, Advyzon all-in-one): well-funded players openly racing to be "the AI that reads across everything." **This is Keepance's exact architecture — the category is validated, but Keepance is late and out-funded in it.**

## What's winning trust (validated by the news + the survey)
- **Citations / show-your-work** beat black-box generation. Wealth.com estate summaries link to sources; FP Alpha matches advisor-vetted strategies; TaxStatus uses IRS-verified data. (And a Janus Henderson survey: **80% of HNW clients would be upset if their advisor used AI without disclosing it.**)
- **Privacy became concrete**, not slogan: a transcription vendor (Mobile Assistant) nearly **sold ~5M advisor-client meeting transcripts as AI training data** (Dec 2025) before Jump acquired and deleted them. Local-first is now a real fiduciary argument.
- **Human-in-the-loop**: 57% of advisors want AI to *expedite*, only 28% want full automation; client-facing AI is rejected. Every serious tool now requires human confirmation before acting.

## Relevance to Keepance (the honest read)
- **"We use AI" is table stakes, not a wedge.** Every tool has it; tax-doc reading (Keepance's old hero feature) is now commodity (6+ tools do it).
- **Keepance's bet (the cross-source cited layer) is validated — and crowded.** Keepance is not first; Jump (from meetings), Orion/Advisor360 (from the platform), and Copilot (from Microsoft) are building the same thing with distribution Keepance lacks.
- **The defensible wedge is the part incumbents structurally can't copy:** truly **local-first / no-vendor-server + BYOK** + **cross-source + cited + Word-native drafting**, aimed at the **solo/small RIA** who (a) is not inside one all-in-one, (b) distrusts cloud AI with client data, and (c) needs proof (citations) because "one mistake = a lawsuit." Copilot can't be advisor/household-native + local; Wealthbox AI can't see outside Wealthbox; Jump is meeting-centric and cloud.
- **Positioning must avoid the "AI assistant" shelf** (low-importance, distrusted) and the "another tool" reflex. Lead as **the private, cited memory/answer layer over the stack you already have** — additive, reads from everything, switches you away from nothing.
