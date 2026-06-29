Reading additional input from stdin...
OpenAI Codex v0.141.0
--------
workdir: /home/jameson/kp-jump
model: gpt-5.5
provider: openai
approval: never
sandbox: danger-full-access
reasoning effort: high
reasoning summaries: detailed
session id: 019f10a0-7763-7403-93e3-853c7f5408c5
--------
user
READ-ONLY MODE: investigate and report only. Do NOT create, edit, move, or delete any files, and do not mutate any external state. Output your findings and recommended changes as text/diff only.

You are an independent competitive-intelligence engineer with web access. Investigate the company Jump (https://jump.ai), an AI platform for financial advisors, and produce a BLUNT, skeptical, evidence-based briefing. PUBLIC INFO ONLY — respect robots.txt/paywalls; if blocked, say so; never fabricate. Cite source URLs.

Cover: (1) What Jump actually IS (category, target customer, core product modules — meeting notes, CRM sync, email drafting, task automation, the 'AI Associate' agentic layer, ask-across-client-data). (2) Funding/scale/adoption — verify total raised, investors, advisor-count claims; flag marketing vs verified. (3) Integrations breadth (CRMs, planning tools, custodians). (4) Security/compliance posture (cloud, SOC 2, data retention, human-review-before-actions). (5) The SHARPEST honest assessment: where is Jump genuinely deep vs shallow marketing? What are its WEAKNESSES and blind spots a small competitor could exploit? (6) Specifically: does Jump do cross-document SYNTHESIS of a client's whole document set (financial plan + statements + beneficiary forms + emails) into one cited brief, or is it primarily a meeting-notes-to-CRM tool? Is it cloud-only (no local/on-device/BYOK option)? These two are the key competitive seams for a rival called Keepance (local-first, BYOK, cross-document client synthesis). Assess honestly whether those seams are real and defensible, or whether Jump already covers them.

Be concise but specific. Output your full briefing to stdout as markdown — this is your deliverable.
codex
I’ll only read public web pages and report back. I’m checking Jump’s own site first, then outside sources so we can separate their marketing claims from things other people have verified.
web search: 
web search: Jump AI financial advisors funding total raised investors advisor count integrations SOC 2
**Exploring deeper pages**

I need to look for deeper pages. I'm thinking about the Jump home and checking out product pages, which might include information about AI associates, integrations, and security. There’s a lot to consider, and I want to make sure I gather comprehensive information. Let’s explore these areas thoroughly to get a complete understanding of what’s available!
web search: 
web search: site:jump.ai "AI Associate" "Ask" "client data" Jump
**Looking into integrations**

I’m trying to gather a complete list of integrations. I think just opening the integration page might help, but it feels like I need more specific details too. It's a bit overwhelming to ensure I capture everything! I want to make sure I have all the right options and features, so I don't miss anything important. Let's see if I can find a comprehensive breakdown of all available integrations to get a clear view.
web search: 
web search: https://jump.ai/integrations/
web search: 
web search: https://jump.ai/products/operate/document-intelligence
web search: 
web search: https://security.jump.ai/
web search: 
web search: security.jump.ai Jump SOC 2 HIPAA subprocessors AWS retention
web search: 
web search: https://help.jumpapp.com/en/articles/10055503-jump-security-and-data-privacy-faqs
web search: 
web search: Jump AI "AWS" "Iowa" "Jump" "financial advisors"
web search: 
web search: https://help.jumpapp.com/en/articles/12738978-using-ask-anything-in-jump-meetings
web search: 
web search: https://help.jumpapp.com/en/articles/12738978-using-ask-anything-in-jump-meetings
web search: 
web search: https://jump.ai/pricing
**Searching for adoption info**

I need to find information on independent adoption, and it looks like I should check the T3 survey and perhaps the Kitces report if it's available. Maybe I can search to see what the latest press coverage says. There seems to be a lot to explore here! Gathering more details will help ensure I have the most accurate and relevant information for what I need. Let’s see what I can uncover!
web search: 
web search: 2025 T3 Inside Information Software Survey Jump advisor AI market share satisfaction
**Planning competitive analysis**

I need to open Kitces April for a competitive analysis. It seems like an important step to evaluate the market. I’ll gather insights and data from this resource to get a clearer picture of how my competitors are performing. It’s all about understanding the landscape better and making informed decisions. I’m curious to see what interesting findings I might come across that could help shape my approach. Let’s dive into that!
web search: 
web search: https://www.kitces.com/blog/the-latest-in-financial-advisortech-april-2026-wealthbox-ai-agents-tools-jump-rightcapital-wealthstream/
web search: 
web search: https://jump.ai/products/meet/notetaker
web search: 
web search: https://jump.ai/products/meet/follow-up
**Evaluating marketing strategies**

I’m thinking about the differences between marketing and verification. WealthManagement reported a $27k based CEO/announcement, but there’s no independent audit available. The T3 survey user ratings are somewhat independent, which is good to note. I need to define my target customer category, focusing on financial advisors, RIAs, broker-dealers, and banks. The pricing model of $100/month per advisor seems reasonable. I also want to verify total funding and integration breadth for better adoption.
codex
Jump is not just selling “AI notes” anymore. The clearest public evidence says they are trying to own the whole advisor workflow around meetings, client records, prep, follow-ups, onboarding, and firm-level insights.
**Citing funding sources**

I need to find and cite the funding press and independent wealth management sources. I think it’s important to use exact URLs and maybe include citations from the web with titles. In the end, I could reference something like the "Jump Series B press release" with the URL. Also, I should note that the homepage mentions “35,000 advisors,” while a June 25 press release states “35,000 users worldwide.” It seems using "advisors" is best if I reference the homepage, but "users" is what I need for the June release.
codex
# Jump.ai Competitive Briefing

## 1. What Jump Actually Is

Jump is a **cloud AI workflow platform for financial advisors**, not just a notetaker anymore.

Its core buyer is RIAs, broker-dealers, enterprise advisory firms, insurance/financial-services teams, and independent advisors. The product started around meeting admin, but now markets itself as an “AI operating system” for advisors.

Core modules:

- **AI Notetaker:** captures Zoom, Teams, Google Meet, Webex, phone, in-person, and mobile meetings; generates notes, tasks, emails, and CRM-ready outputs. Source: https://jump.ai/products/meet/notetaker
- **Pre-meeting prep:** pulls from CRM, portfolio/custodian data, financial plans, tax records, emails, and past meetings into a cited briefing. This is more serious than basic meeting notes. Source: https://jump.ai/products/meet/pre-meeting-prep
- **Post-meeting sync:** drafts CRM notes, tasks, and financial-planning updates, then waits for human review before syncing. Source: https://jump.ai/products/meet/post-meeting-data-sync
- **Follow-up emails/tasks:** generates client recap emails and structured tasks matched to CRM fields. Source: https://jump.ai/products/meet/follow-up
- **AI Associate:** assistant/agent layer that answers questions across Jump, CRMs, planning software, email, meetings, and tasks. It is “early access,” so treat it as live but still maturing. Source: https://help.jumpapp.com/en/articles/11824817-how-to-use-ai-associate
- **Document Intelligence / Onboard:** document intake and structured extraction, mainly to turn uploaded documents into reviewable updates and downstream system sync. Source: https://jump.ai/products/onboard/document-intelligence

## 2. Funding, Scale, Adoption

Jump is well-funded and moving fast.

Verified public claims:

- **$80M Series B** announced February 20, 2026, led by Insight Partners.
- **$105M total raised** after the Series B.
- Investors include Insight Partners, F-Prime, Allianz Life Ventures, TIAA Ventures, Peterson Partners, Battery Ventures, Sorenson Capital, Pelion Venture Partners, Citi Ventures, plus angels Hans Tung, Ryan Anderson, and Aaron Skonnard.
- February 2026 claim: **27,000+ advisors**, adding **2,000+ advisors/month**, nearly 1 in 10 U.S. advisors.
- June 25, 2026 claim: **35,000+ users worldwide**.

Sources:
- Jump Series B release: https://jump.ai/press/series-b-announcement
- WealthManagement.com coverage: https://www.wealthmanagement.com/artificial-intelligence/jump_secures_series_b
- June 2026 Jump release: https://jump.ai/press/jump-unveils-new-ai-powered-account-opening-and-workflow-innovations-for-advisors

Blunt read: the funding is real. The investor list is real. The usage numbers are still mostly **company-reported**, even when repeated by trade press. The strongest independent signal is not exact user count, but category recognition: Jump cites strong T3/Inside Information survey ratings, including 8.61 in transcription/text capture and 8.64 in onboarding/proposal generation. Source: https://jump.ai/blog/jumps-ai-powered-tools-take-top-honors-in-the-2025-t3-inside-information-software-survey

## 3. Integrations Breadth

This is one of Jump’s real strengths.

They publicly list **39-40+ integrations** across CRM, planning, meetings, calendar, portfolio, custodian, estate, tax, document storage, VoIP, and workflow tools.

Named examples:

- **CRMs:** Salesforce, Redtail, Wealthbox, HubSpot, Dynamics 365, AdvisorEngine, Advyzon, XLR8, LeadCenter, Quivr, SmartOffice
- **Planning:** eMoney, RightCapital
- **Portfolio/custodian:** Black Diamond, Orion, Schwab
- **Estate/tax:** Wealth.com, Holistiplan, TaxStatus
- **Meetings/phone:** Zoom, Teams, Google Meet, Webex, GoTo, Dialpad, RingCentral, Intulse, Vonage
- **Docs/calendar/email:** Google Drive, Box, Google Calendar, Microsoft Calendar, Exchange
- **Workflow:** Karbon, Hubly

Source: https://jump.ai/integrations/

Blunt read: this is not shallow. The integrations are central to their moat. Keepance should assume Jump can keep expanding integration coverage quickly.

## 4. Security / Compliance Posture

Jump’s public posture is strong for normal enterprise SaaS, but it is still cloud SaaS.

Publicly stated:

- SOC 2 Type II audits.
- Encryption in transit and at rest.
- MFA.
- Vanta monitoring.
- Third-party penetration testing.
- Data hosted on servers in the U.S., specifically Iowa.
- No firm/client data used to train AI models.
- Human review before AI outputs are synced, saved, or sent.
- Configurable consent, disclosure, retention, redaction, downloads, and attestation controls.
- Summary-only mode can avoid storing audio/video, but transcripts may still be generated temporarily to create outputs.
- Zero-transcript retention disables some features like Ask Anything.

Sources:
- Security FAQ: https://help.jumpapp.com/en/articles/10055503-jump-security-and-data-privacy-faqs
- Summary-only mode: https://help.jumpapp.com/en/articles/10209840-an-overview-of-summary-only-mode
- Compliance settings: https://help.jumpapp.com/en/articles/11526343-compliance-settings
- Auto-delete media/transcripts: https://help.jumpapp.com/en/articles/9072064-how-to-get-jump-to-automatically-delete-media-transcripts
- Zero transcript retention: https://help.jumpapp.com/en/articles/12452440-tips-for-using-jump-with-zero-transcript-retention

Caveat: Jump’s Trust Center page at `security.jump.ai` loaded with no readable text through my public fetch, likely because it is JavaScript/Vanta-gated. I relied on Jump’s public Help Center instead.

## 5. Sharp Assessment

Where Jump is genuinely deep:

- **Advisor-specific workflow design.** It understands meetings, notes, tasks, CRM fields, planning updates, consent, attestations, and compliance review.
- **Integrations.** This is their biggest practical advantage.
- **Enterprise compliance controls.** Retention, consent, redaction, attestation, admin policy, and parent-child account restrictions are real buyer-facing controls.
- **Distribution momentum.** Funding + enterprise logos + 35k user/advisor claims make them hard to dismiss.

Where it is still marketing-heavy:

- **“AI Operating System” is inflated language.** The real product is an advisor workflow layer around meetings, client data, and system updates.
- **“Agentic” is constrained.** Public docs repeatedly show human review before actions. That is good for compliance, but it means this is not a fully autonomous associate.
- **AI Associate is early access.** Jump’s own help doc says it is still rolling out and evolving.
- **Chat/history maturity looks limited.** AI Associate help says chat history is “coming soon.”
- **It is not a CRM.** Kitces bluntly notes Jump may be trying to become everything except the one thing advisors may actually want next: a better CRM. Source: https://www.kitces.com/blog/the-latest-in-financial-advisortech-april-2026-wealthbox-ai-agents-tools-jump-rightcapital-wealthstream/

Weaknesses a smaller competitor could exploit:

- **Cloud trust gap:** no public local-first, on-device, or customer-BYOK option found.
- **Data-control gap:** “delete/retain” is not the same as “your data never leaves your machine.”
- **Document-depth gap:** document intelligence appears focused on extraction, intake, and syncing fields, not deep legal/financial document reasoning across arbitrary folders.
- **Advisor-tool dependency:** Jump’s strength is connected SaaS systems. A competitor can win where the truth lives in messy PDFs, Word docs, statements, emails, folders, exports, and private local archives.
- **Enterprise drag:** Jump’s large-firm motion may make it slower or less attractive for privacy-obsessed solos/small firms who want control over every file and model call.

## 6. Key Keepance Seams

### Seam A: Cross-document synthesis

This seam is **real, but narrower than hoped**.

Jump already claims cross-source synthesis. Their pre-meeting prep page says it connects CRM, portfolio accounting, custodians, financial plans, tax records, emails, and past meetings into a structured, cited briefing. That directly overlaps with “client brief from many sources.”

But public evidence suggests Jump’s **document** layer is more about extracting fields from uploaded paperwork and syncing updates, not building a private, cited knowledge base over a client’s entire document set.

So:

- If Keepance says “Jump is only meeting-notes-to-CRM,” that is false.
- If Keepance says “Jump does not publicly prove deep, local, arbitrary cross-document synthesis across a whole client file room,” that is fair.
- The strongest Keepance wedge is not just “synthesis.” It is **local-first cited synthesis over the messy full client record**, including documents that are not cleanly inside CRM/planning systems.

### Seam B: Cloud-only / no local / no BYOK

This seam looks **real and defensible based on public info**.

Jump publicly describes cloud hosting in Iowa, cloud service providers, AI distributors, and secure infrastructure. I found no public local-first, on-device, offline, self-hosted, customer-held-key, or BYOK model option.

Important nuance: Jump says it does not train models on customer data and supports strong retention controls. That reduces risk, but it does not equal Keepance’s stronger claim: client data can stay local and AI can be BYOK-direct.

## Bottom Line

Jump is a serious competitor. Do not frame them as a glorified notetaker. They are building a cloud workflow layer for advisors with strong integrations, compliance controls, and fast adoption.

Keepance’s best honest positioning is:

> Jump is excellent when an advisor wants cloud AI to automate meetings, prep, CRM updates, and follow-ups across an existing SaaS stack. Keepance should win when the buyer wants private, local-first, BYOK-controlled synthesis across the full client document record, with citations, without making a cloud AI platform the center of gravity.
tokens used
134,496
# Jump.ai Competitive Briefing

## 1. What Jump Actually Is

Jump is a **cloud AI workflow platform for financial advisors**, not just a notetaker anymore.

Its core buyer is RIAs, broker-dealers, enterprise advisory firms, insurance/financial-services teams, and independent advisors. The product started around meeting admin, but now markets itself as an “AI operating system” for advisors.

Core modules:

- **AI Notetaker:** captures Zoom, Teams, Google Meet, Webex, phone, in-person, and mobile meetings; generates notes, tasks, emails, and CRM-ready outputs. Source: https://jump.ai/products/meet/notetaker
- **Pre-meeting prep:** pulls from CRM, portfolio/custodian data, financial plans, tax records, emails, and past meetings into a cited briefing. This is more serious than basic meeting notes. Source: https://jump.ai/products/meet/pre-meeting-prep
- **Post-meeting sync:** drafts CRM notes, tasks, and financial-planning updates, then waits for human review before syncing. Source: https://jump.ai/products/meet/post-meeting-data-sync
- **Follow-up emails/tasks:** generates client recap emails and structured tasks matched to CRM fields. Source: https://jump.ai/products/meet/follow-up
- **AI Associate:** assistant/agent layer that answers questions across Jump, CRMs, planning software, email, meetings, and tasks. It is “early access,” so treat it as live but still maturing. Source: https://help.jumpapp.com/en/articles/11824817-how-to-use-ai-associate
- **Document Intelligence / Onboard:** document intake and structured extraction, mainly to turn uploaded documents into reviewable updates and downstream system sync. Source: https://jump.ai/products/onboard/document-intelligence

## 2. Funding, Scale, Adoption

Jump is well-funded and moving fast.

Verified public claims:

- **$80M Series B** announced February 20, 2026, led by Insight Partners.
- **$105M total raised** after the Series B.
- Investors include Insight Partners, F-Prime, Allianz Life Ventures, TIAA Ventures, Peterson Partners, Battery Ventures, Sorenson Capital, Pelion Venture Partners, Citi Ventures, plus angels Hans Tung, Ryan Anderson, and Aaron Skonnard.
- February 2026 claim: **27,000+ advisors**, adding **2,000+ advisors/month**, nearly 1 in 10 U.S. advisors.
- June 25, 2026 claim: **35,000+ users worldwide**.

Sources:
- Jump Series B release: https://jump.ai/press/series-b-announcement
- WealthManagement.com coverage: https://www.wealthmanagement.com/artificial-intelligence/jump_secures_series_b
- June 2026 Jump release: https://jump.ai/press/jump-unveils-new-ai-powered-account-opening-and-workflow-innovations-for-advisors

Blunt read: the funding is real. The investor list is real. The usage numbers are still mostly **company-reported**, even when repeated by trade press. The strongest independent signal is not exact user count, but category recognition: Jump cites strong T3/Inside Information survey ratings, including 8.61 in transcription/text capture and 8.64 in onboarding/proposal generation. Source: https://jump.ai/blog/jumps-ai-powered-tools-take-top-honors-in-the-2025-t3-inside-information-software-survey

## 3. Integrations Breadth

This is one of Jump’s real strengths.

They publicly list **39-40+ integrations** across CRM, planning, meetings, calendar, portfolio, custodian, estate, tax, document storage, VoIP, and workflow tools.

Named examples:

- **CRMs:** Salesforce, Redtail, Wealthbox, HubSpot, Dynamics 365, AdvisorEngine, Advyzon, XLR8, LeadCenter, Quivr, SmartOffice
- **Planning:** eMoney, RightCapital
- **Portfolio/custodian:** Black Diamond, Orion, Schwab
- **Estate/tax:** Wealth.com, Holistiplan, TaxStatus
- **Meetings/phone:** Zoom, Teams, Google Meet, Webex, GoTo, Dialpad, RingCentral, Intulse, Vonage
- **Docs/calendar/email:** Google Drive, Box, Google Calendar, Microsoft Calendar, Exchange
- **Workflow:** Karbon, Hubly

Source: https://jump.ai/integrations/

Blunt read: this is not shallow. The integrations are central to their moat. Keepance should assume Jump can keep expanding integration coverage quickly.

## 4. Security / Compliance Posture

Jump’s public posture is strong for normal enterprise SaaS, but it is still cloud SaaS.

Publicly stated:

- SOC 2 Type II audits.
- Encryption in transit and at rest.
- MFA.
- Vanta monitoring.
- Third-party penetration testing.
- Data hosted on servers in the U.S., specifically Iowa.
- No firm/client data used to train AI models.
- Human review before AI outputs are synced, saved, or sent.
- Configurable consent, disclosure, retention, redaction, downloads, and attestation controls.
- Summary-only mode can avoid storing audio/video, but transcripts may still be generated temporarily to create outputs.
- Zero-transcript retention disables some features like Ask Anything.

Sources:
- Security FAQ: https://help.jumpapp.com/en/articles/10055503-jump-security-and-data-privacy-faqs
- Summary-only mode: https://help.jumpapp.com/en/articles/10209840-an-overview-of-summary-only-mode
- Compliance settings: https://help.jumpapp.com/en/articles/11526343-compliance-settings
- Auto-delete media/transcripts: https://help.jumpapp.com/en/articles/9072064-how-to-get-jump-to-automatically-delete-media-transcripts
- Zero transcript retention: https://help.jumpapp.com/en/articles/12452440-tips-for-using-jump-with-zero-transcript-retention

Caveat: Jump’s Trust Center page at `security.jump.ai` loaded with no readable text through my public fetch, likely because it is JavaScript/Vanta-gated. I relied on Jump’s public Help Center instead.

## 5. Sharp Assessment

Where Jump is genuinely deep:

- **Advisor-specific workflow design.** It understands meetings, notes, tasks, CRM fields, planning updates, consent, attestations, and compliance review.
- **Integrations.** This is their biggest practical advantage.
- **Enterprise compliance controls.** Retention, consent, redaction, attestation, admin policy, and parent-child account restrictions are real buyer-facing controls.
- **Distribution momentum.** Funding + enterprise logos + 35k user/advisor claims make them hard to dismiss.

Where it is still marketing-heavy:

- **“AI Operating System” is inflated language.** The real product is an advisor workflow layer around meetings, client data, and system updates.
- **“Agentic” is constrained.** Public docs repeatedly show human review before actions. That is good for compliance, but it means this is not a fully autonomous associate.
- **AI Associate is early access.** Jump’s own help doc says it is still rolling out and evolving.
- **Chat/history maturity looks limited.** AI Associate help says chat history is “coming soon.”
- **It is not a CRM.** Kitces bluntly notes Jump may be trying to become everything except the one thing advisors may actually want next: a better CRM. Source: https://www.kitces.com/blog/the-latest-in-financial-advisortech-april-2026-wealthbox-ai-agents-tools-jump-rightcapital-wealthstream/

Weaknesses a smaller competitor could exploit:

- **Cloud trust gap:** no public local-first, on-device, or customer-BYOK option found.
- **Data-control gap:** “delete/retain” is not the same as “your data never leaves your machine.”
- **Document-depth gap:** document intelligence appears focused on extraction, intake, and syncing fields, not deep legal/financial document reasoning across arbitrary folders.
- **Advisor-tool dependency:** Jump’s strength is connected SaaS systems. A competitor can win where the truth lives in messy PDFs, Word docs, statements, emails, folders, exports, and private local archives.
- **Enterprise drag:** Jump’s large-firm motion may make it slower or less attractive for privacy-obsessed solos/small firms who want control over every file and model call.

## 6. Key Keepance Seams

### Seam A: Cross-document synthesis

This seam is **real, but narrower than hoped**.

Jump already claims cross-source synthesis. Their pre-meeting prep page says it connects CRM, portfolio accounting, custodians, financial plans, tax records, emails, and past meetings into a structured, cited briefing. That directly overlaps with “client brief from many sources.”

But public evidence suggests Jump’s **document** layer is more about extracting fields from uploaded paperwork and syncing updates, not building a private, cited knowledge base over a client’s entire document set.

So:

- If Keepance says “Jump is only meeting-notes-to-CRM,” that is false.
- If Keepance says “Jump does not publicly prove deep, local, arbitrary cross-document synthesis across a whole client file room,” that is fair.
- The strongest Keepance wedge is not just “synthesis.” It is **local-first cited synthesis over the messy full client record**, including documents that are not cleanly inside CRM/planning systems.

### Seam B: Cloud-only / no local / no BYOK

This seam looks **real and defensible based on public info**.

Jump publicly describes cloud hosting in Iowa, cloud service providers, AI distributors, and secure infrastructure. I found no public local-first, on-device, offline, self-hosted, customer-held-key, or BYOK model option.

Important nuance: Jump says it does not train models on customer data and supports strong retention controls. That reduces risk, but it does not equal Keepance’s stronger claim: client data can stay local and AI can be BYOK-direct.

## Bottom Line

Jump is a serious competitor. Do not frame them as a glorified notetaker. They are building a cloud workflow layer for advisors with strong integrations, compliance controls, and fast adoption.

Keepance’s best honest positioning is:

> Jump is excellent when an advisor wants cloud AI to automate meetings, prep, CRM updates, and follow-ups across an existing SaaS stack. Keepance should win when the buyer wants private, local-first, BYOK-controlled synthesis across the full client document record, with citations, without making a cloud AI platform the center of gravity.
