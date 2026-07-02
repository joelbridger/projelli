# Jump — Complete Feature Inventory (as of 2026-07-02)

*Consolidated from the internal competitive report (2026-06-28, `~/keepance/competitive-analysis/jump-vs-keepance/`) and fresh adversarially-verified web research (2026-07-02, `research/deep-research-findings.md`). Every fresh claim below survived 3-vote verification unless marked.*

## Company snapshot

- **Jump** (jump.ai, formerly jumpapp.com), Salt Lake City. CEO Parker Ence. ~$105M raised: $4.6M seed (Sorenson) → $20M Series A (Battery, Feb 2025) → **$80M Series B (Insight Partners, Feb 2026)**. Acquired Mobile Assistant Oct 2025.
- Traction: 27,000+ advisors per company (Mar 2026), marketing now says 35,000+. Kitces: ~10% of US advisors, #1 standalone notetaker. #1 in its category in the 2025 T3 survey (rating 8.61). Enterprise distribution: LPL, Osaic, Cetera (all 12,000 advisors), StoneX, Mission Wealth, Equitable, Focus Financial.
- Pricing (per internal report, June 2026): Meet ~$100/advisor/mo core (cut from $120 under price pressure) + Onboard $50 + Grow $50 → fully loaded ~$200/seat/mo. Enterprise tier adds SSO/SCIM, compliance dashboard.

## Product architecture (reorganized March 2026): "AI Operating System for Advisors"

Three products on a shared foundation:

### MEET (the core — meeting lifecycle)
| Feature | Detail |
|---|---|
| Meeting capture | Bot/recorder for **Zoom, Teams, Google Meet, Webex, GoTo** + web recorder + audio upload + **iOS/Android apps** + in-person mode. Host-independent joining on Zoom/Webex/GoTo/Dialpad/RingCentral |
| Phone/dialer capture | **Zoom Phone, Teams Phone, RingCentral, Dialpad, Vonage, Intulse, Webex Calling, GoTo Connect** |
| Transcription + diarization | With voice differentiation; note accuracy imperfect (XYPN 3.5/5; documented dropped-recording complaints) |
| Templated AI notes | Customizable templates; **firm-enforced note structure** for compliance |
| Post-meeting automation | Notes + tasks + drafted follow-up email "within ~1 minute" of meeting end (vendor-asserted timing) |
| Task extraction | Titles, descriptions, assignees, **inferred due dates** from spoken commitments |
| Pre-meeting prep briefs | Auto-generated, cited; pulls CRM, planning, portfolio, tax, email, past meetings |
| Agendas + scheduling | Meeting scheduling included in Meet |
| Follow-up email drafts | In the advisor's inbox flow |

### GROW (book-of-business intelligence — add-on)
Signals (held-away assets, consolidation, referral intent, sentiment), Playbooks, Scorecards, Pulse & Surveys, Dashboards. Analysts doubt the attach rate.

### OPERATE (ops — add-on)
AI intake forms, document intelligence (**intake/field-extraction → account-opening forms** — NOT deep folder synthesis), email assistant.

### Shared foundation (all plans)
- **AI Associate** (launched Mar 2026): ask-anything chat grounded in CRM (Salesforce/Wealthbox/Redtail), planning (RightCapital/eMoney), email (Outlook/Gmail); can execute actions (create CRM records) with human confirmation. Still early-access; chat history "coming soon"; added mobile, PDF upload, voice dictation Apr–May 2026.
- **Unified client profiles** ("evergreen," pulled across data sources — meeting/CRM-fed).
- Email assistant; 30+ integrations (42 documented in help center).

## Integrations (the moat, with the report's caveats)

- **CRMs (13+, native):** Salesforce (incl. Financial Services Cloud), Wealthbox, Redtail (Jump is *embedded inside* Redtail), HubSpot, Dynamics 365, Zoho, AdvisorEngine, Practifi, XLR8, Advyzon, LeadCenter, Quivr, MedicarePRO, SmartOffice.
  - **Wealthbox depth:** approval-gated note/task sync, triggers Wealthbox workflows matched to action items, prep from Contact records, compliance-log sync.
  - **Redtail depth:** bidirectional — calendar sync, prep from Contact/Account/KYC/Task data + custom fields, push notes/tasks back, kick off Redtail workflows.
- **Planning:** eMoney, RightCapital, Asset-Map (+ AI-Suggested Fact Updates back into planning tools).
- **Portfolio/custodian:** Orion, Black Diamond, Schwab (only true custodian).
- **Tax:** Holistiplan; TaxStatus (IRS-verified data, BETA). **Estate:** Wealth.com.
- **Calendars/email:** Outlook, Gmail/Google Calendar.

## Compliance & security

- Firm-enforced note templates; complete audit trails; firm-level compliance settings (access, notetaker behavior, **data retention**, redaction, disclosures); **attestation tracking**; compliance logs synced to CRM; human approval before every CRM write ("nothing leaves Jump without your approval").
- Retention controls: summary-only mode, auto-delete, zero-transcript-retention options.
- **SOC 2: referenced in Jump's security FAQ, but the fresh research could NOT independently verify the certification level** (the internal report recorded "SOC 2 Type II (Jump-stated)"). Cloud-only (US/Iowa); no public DPA found; **no local/on-device/BYOK option anywhere** (verified gap).

## Jump's verified weaknesses (attack surface)

1. **Cloud-only, no BYOK/local** — architecturally locked in; can't match "nothing leaves your machine" without cannibalizing itself.
2. **Bot-in-the-meeting capture** — clients see "Jump Notetaker has joined"; some BD compliance depts block bots.
3. **Reliability complaints** — dropped recordings ("failure rate unacceptable" — advisor review), XYPN note-accuracy 3.5/5 (below FinMate).
4. **No document authoring** — zero Word-native editing/redline capability.
5. **Document layer = intake/extraction, not folder synthesis** — cannot read/reason over an arbitrary local file pile.
6. **Sprawl** — "connect 60 things" onboarding; scattered surfaces (Jameson's firsthand read: "messy, scattered, hard to access").
7. **AI Associate is early** — early-access, no chat history, no efficacy data.
8. **Value requires the stack** — thin for a stack-light solo with no CRM.
9. **Price** — ~$100–200/seat/mo and rising pressure (already cut core price once).
10. **No public API** — can't be built on (also means: its notes reach us only via its CRM/SharePoint destinations, which Keepance already reads).
