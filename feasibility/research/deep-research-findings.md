# Deep-research findings on Jump (2026-07-02)

**Verified summary:** Jump (jump.ai, formerly jumpapp.com) has evolved from an AI meeting notetaker into a self-described "AI Operating System for Advisors," formally reorganized in March 2026 into three integrated products — Meet (notetaker, pre-meeting prep, agendas, data sync, follow-up automation, scheduling), Grow (Signals, Playbooks, Scorecards, Pulse & Surveys, Dashboards), and Operate (AI intake forms, document intelligence, email assistant) — all sitting on a shared foundation that includes an "AI Associate" chat assistant, unified client profiles, an email assistant, and 30+ integrations. Its capture layer spans Zoom, Teams, Google Meet, Webex, GoTo, and VoIP/dialer platforms (Zoom Phone, Teams Phone, RingCentral, Dialpad, Vonage, Intulse, Webex Calling, GoTo Connect) plus in-person, web, and mobile recording, delivering polished notes, extracted tasks (with inferred due dates), and drafted follow-up emails within about a minute of a meeting ending. Integration depth is a core differentiator: 13+ advisor CRMs (deep bidirectional Wealthbox and Redtail integrations that sync notes/tasks and can trigger CRM workflows; Salesforce with Financial Services Cloud support; embedded inside Redtail), plus financial planning (eMoney, RightCapital, Asset-Map), portfolio/custodian (Orion, Black Diamond, Schwab), tax (Holistiplan, TaxStatus beta), and estate (Wealth.com) tools feeding pre-meeting prep and AI queries. Compliance features include firm-enforced note templates, built-in audit trails, attestation tracking, and compliance logs synced to CRM; positioning targets RIA and broker-dealer teams. Traction is strong: an $80M Series B led by Insight Partners (Feb 2026, ~$105M total raised), 27,000+ advisors adopted in two years per the company (marketing now claims 35,000+, naming LPL, Osaic, Cetera, StoneX, Mission Wealth, and Equitable Advisors), and a #1 ranking in advisor satisfaction and adoption in its category in the 2025 T3/Inside Information Software Survey.

---
**[HIGH] vote 3-0 (claims 4, 7 merged)**

Product architecture (March 2026): Jump is organized as an 'AI Operating System for Advisors' with three products — Meet (notetaker, pre-meeting prep, agendas, post-meeting data sync, follow-up automation, meeting scheduling), Grow (Signals, Playbooks, Scorecards, Pulse & Surveys, Dashboards), and Operate (AI intake forms, document intelligence, email assistant) — on a shared foundation included in all plans: AI Associate for cross-platform queries, unified client profiles, an email assistant, and 30+ integrations. Jump ranked #1 in advisor satisfaction and adoption in its category (AI notetakers / transcription) in the 2025 T3/Inside Information Software Survey.

*Evidence:* Press release (March 9, 2026) lists all three products and their sub-features item-for-item; live help-center docs confirm this is the shipping product structure, not just press framing. T3 survey data corroborates the #1 category ranking (highest user rating 8.61 and largest AI-notetaker market share). Note the ranking is within Jump's product category, not survey-wide. Unanimous 3-0 verification on both underlying claims.

*Sources:* https://jump.ai/press/jump-expands-ai-operating-system-for-advisors-with-new-products-powering-growth-and-operations; https://help.jumpapp.com (article 13952138, 'Understanding Meet, Grow, and Operate'); https://www.t3technologyhub.com (2025 T3/Inside Information Software Survey)

---
**[HIGH] vote 3-0 (claims 0, 12, 17 merged)**

Meeting and call capture: Jump's notetaker captures Zoom, Microsoft Teams, Google Meet, Webex, GoTo Meeting, phone calls, and in-person conversations, with a web recorder, audio upload, and top-rated iOS/Android apps. It supports at least 9 meeting/VoIP platforms including dialers — Zoom Phone, Microsoft Teams Phone, GoTo Connect, Webex Calling, Dialpad, RingCentral, Intulse, and Vonage — automatically generating notes, transcripts, summaries, and action items from calls, and can join/record many platforms even when the host is not present.

*Evidence:* Primary product page lists all capture channels verbatim; the integrations page and help-center collection document each VoIP/dialer platform with per-platform setup articles; shipped mobile apps independently confirmed on both app stores. Host-independent joining is explicitly stated for Zoom, Webex, GoTo, Dialpad, and RingCentral (Teams/Meet require the invite link). Unanimous 3-0 on all three underlying claims.

*Sources:* https://jump.ai/products/meet/notetaker; https://jump.ai/integrations; https://help.jumpapp.com/en/collections/13842287-integrations; Apple App Store (id6475781425) and Google Play (com.jumpapp.mobile)

---
**[MEDIUM] vote 3-0 (claims 2, 19 merged; timing figure vendor-asserted)**

Post-meeting automation: within roughly one minute of a meeting ending, Jump delivers polished notes, extracted tasks, and drafted follow-up emails ready for review and sync. Task extraction generates tasks with titles, descriptions, and assignees, and can infer due dates from spoken commitments (e.g., 'I'll get that to you by next Thursday').

*Evidence:* The 'within a minute' figure is verbatim vendor copy with no independent measurement found (hence medium on timing); no third-party source disputes it. Task extraction specifics are confirmed by two independent vendors (Jump's follow-up product page and Wealthbox's integration page) with matching language, and by a help article updated May 2026. Both claims passed 3-0.

*Sources:* https://jump.ai/products/meet/notetaker; https://jump.ai/products/meet/follow-up; https://www.wealthbox.com/integrations/jump/; https://help.jumpapp.com/en/articles/9055647

---
**[HIGH] vote 3-0 (claims 8, 9, 10 merged)**

AI Associate (ask-anything chat): launched March 2026, an AI assistant accessible from anywhere in the Jump web app that answers questions grounded in the firm's client data — pulling from connected CRMs (Salesforce, Wealthbox, Redtail), financial planning tools (RightCapital, eMoney), and email (Outlook, Gmail) — and can execute actions like creating CRM records with human-in-the-loop confirmation. As of the current help documentation it is an early-access rollout, available to all users regardless of pricing tier, with chat history 'coming soon.'

*Evidence:* Live help article confirms grounding sources, access point, 'all users' availability, early-access status, and missing chat history verbatim; launch corroborated by press release and Kitces AdvisorTech coverage (April 2026). April/May 2026 updates added mobile, PDF upload, and voice dictation. All three underlying claims passed 3-0.

*Sources:* https://help.jumpapp.com/en/articles/11824817-how-to-use-ai-associate; https://jump.ai/blog/introducing-AI-associate; Business Wire via Morningstar (March 26, 2026 launch release)

---
**[HIGH] vote 3-0 (claims 11, 15 merged)**

CRM integration breadth: Jump offers native integrations with at least 13 advisor CRMs — Salesforce (with Financial Services Cloud support), Wealthbox, Redtail (Jump is embedded directly inside Redtail CRM), HubSpot, Dynamics 365 Sales, Zoho CRM, AdvisorEngine, Practifi, XLR8, Advyzon, LeadCenter, Quivr, MedicarePRO, and SmartOffice — syncing pre/post-meeting notes and tasks to the correct CRM records.

*Evidence:* Live integrations page lists all named CRMs; 'native' is supported by per-CRM OAuth setup articles in the help center (42 total documented integrations), not just a logo wall. Salesforce FSC support confirmed via field-mapping docs ('Interaction Summary'). Independent trade-press roster matches. Minor nuance: Quivr/XLR8 are CRM-overlay tools. Both underlying claims 3-0.

*Sources:* https://jump.ai/integrations; https://help.jumpapp.com/en/collections/13842287-integrations; WealthTech Today 2025 AI-notetaker buyer's guide (independent corroboration)

---
**[HIGH] vote 3-0 (claims 18, 20, 21 merged)**

Deep Wealthbox integration: Jump creates AI notes and tasks from in-person or remote client meetings and syncs them to Wealthbox Contact Records after an advisor approval step; it can trigger Wealthbox workflows by pulling the firm's available workflow list and matching meeting action items to the most appropriate one; pre-meeting prep populates from Wealthbox Contact Record data; and compliance logs can be synced to Wealthbox. Positioning explicitly targets RIA and broker-dealer teams.

*Evidence:* Two independent vendors (Wealthbox and Jump) document the same mechanics in operational help docs: approval-gated sync ('nothing leaves Jump without your approval'), workflow-template matching by title/description, pre-meeting prep from Contact data, and compliance-log sync. Workflow starts are advisor-confirmed, not fully autonomous. All three underlying claims 3-0.

*Sources:* https://www.wealthbox.com/integrations/jump/; https://help.jumpapp.com/en/articles/12011656-wealthbox-integration; https://jump.ai/products/meet/post-meeting-data-sync

---
**[HIGH] vote 3-0 (claims 22, 23, 24 merged)**

Deep Redtail integration: bidirectional — syncs the advisor's Redtail calendar (selectable categories), generates pre-meeting prep from Redtail Contact, Account, Know Your Client (KYC), and Task data plus note/activity comments and custom fields on Contacts and Accounts, and pushes post-meeting notes and follow-up tasks back into Redtail, including the ability to kick off a Redtail workflow as part of the sync. Jump is also embedded directly inside Redtail CRM.

*Evidence:* Current help doc confirms every element verbatim, including the specific data types and the 'Sync to Redtail... or kick off a Redtail workflow' action. Post-meeting sync is manually initiated (advisor selects and clicks sync), which is consistent with the approval-gated design. All three underlying claims 3-0.

*Sources:* https://help.jumpapp.com/en/articles/11870465-redtail-integration; https://jump.ai/integrations/redtail; https://jump.ai/blog/redtail-crm-integration

---
**[HIGH] vote 3-0 (claims 13, 14, 16 merged)**

Pre-meeting prep data ecosystem: Jump integrates with financial planning tools (eMoney, RightCapital, Asset-Map), portfolio management (Orion, Black Diamond), the Schwab custodian, tax tools (Holistiplan; TaxStatus with IRS-verified data, in beta), estate planning (Wealth.com), and lead tools (LeadCenter.AI), largely to pull client data into pre-meeting prep notes; planning integrations also use meeting conversations to suggest updates to client financial data (AI-Suggested Fact Updates) and power AI Associate queries (e.g., 'Who is the beneficiary of Jill's 401k?').

*Evidence:* Live integrations page and help-center setup articles confirm each vendor and its pre-meeting-prep purpose with category-specific language; third-party press releases corroborate the eMoney, RightCapital, Asset-Map, TaxStatus, and Wealth.com partnerships as shipped, dated 2025 to early 2026. TaxStatus carries an explicit BETA label. All three underlying claims 3-0.

*Sources:* https://jump.ai/integrations; https://help.jumpapp.com/en/collections/13842287-integrations; https://help.jumpapp.com/en/articles/11604737-emoney-integration; Businesswire: Jump-RightCapital partnership (June 24, 2025); Jump-Asset-Map (Jan 28, 2026); Jump-TaxStatus (Feb 4, 2026); PLANADVISER coverage

---
**[HIGH] vote 3-0 (claims 3, 21-partial merged)**

Compliance features: firm account owners can enforce a standard note structure across the entire team; complete audit trails are built in; firm-level compliance settings centrally control access, notetaker behavior, data retention, redaction, and disclosures, with attestation tracking (who attested, to what, when); and compliance logs can sync to CRM. Jump's security FAQ references SOC 2 infrastructure.

*Evidence:* Product page states both headline features verbatim; help-center compliance-settings and security-FAQ articles corroborate beyond marketing copy. Caveat: the SOC 2 reference surfaced in verifier evidence for the audit-trail claim, but no standalone claim about a specific SOC 2 Type I/II certification survived verification — treat the certification level as unconfirmed. Underlying claims 3-0.

*Sources:* https://jump.ai/products/meet/notetaker; https://help.jumpapp.com/en/articles/11526343 (Compliance settings); https://help.jumpapp.com/en/articles/10055503 (Security/Privacy FAQ); https://www.wealthbox.com/integrations/jump/

---
**[HIGH] vote 3-0 (claims 1, 5, 6 merged)**

Funding and traction: Jump raised an $80M Series B led by Insight Partners (announced Feb 19, 2026; participants included F-Prime, Allianz Life Ventures, TIAA Ventures, Peterson Partners, plus existing investors Battery, Sorenson, Pelion, Citi Ventures; ~$105M total raised). Per co-founder/COO Tim Chaves (March 2026), more than 27,000 advisors adopted Jump in two years; current marketing claims 35,000+ advisors at firms including LPL, Osaic, Cetera, StoneX, Mission Wealth, and Equitable Advisors.

*Evidence:* Funding details are consistent across the lead investor's own site, the wire release, and multiple independent trade outlets. Advisor counts are company-reported: 27,000+ (March 2026, corroborated by Insight Partners) grew to a 35,000+ marketing figure by July 2026 — the two numbers are consistent as a timeline, but neither is independently audited. Customer names are Jump's own logo wall. All three underlying claims 3-0.

*Sources:* https://jump.ai/press/jump-expands-ai-operating-system-for-advisors-with-new-products-powering-growth-and-operations; https://jump.ai/products/meet/notetaker; Insight Partners announcement; Businesswire (2026-02-19) via Morningstar/Yahoo Finance; WealthManagement.com; FinTech Global; Finovate
