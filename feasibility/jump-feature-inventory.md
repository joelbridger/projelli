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
10. ~~No public API~~ **RETIRED 2026-07-02:** Jump now lists **MCP support on all plans** and **"API & build access" on Enterprise** (jump.ai/pricing; June 25, 2026 press release). No public developer docs/portal were found, so depth is unverified — but do not claim "Jump can't be built on." (Its notes still reach us via its CRM/SharePoint/Drive destinations, which Lantern reads.)

---

## 2026-07-02 Completeness addendum (triple sweep: help-center census ×1, third-party ×1, Codex ×1)

*An exhaustive re-verification (all 7 help-center collections / 168 articles, all product
pages, Mar–Jun 2026 what's-new posts and press, third-party coverage, app stores) found
the items below missing from or shallower than the inventory above. Dispositions live in
`../docs/plans/lantern-plus/2026-07-02-JUMP-COVERAGE-AUDIT.md` §E.*

**Corrections to the inventory above:**
- "Operate" was renamed **Onboard** (Meet / Onboard / Grow; $50 add-on) — Jump's own materials were briefly inconsistent.
- Pricing depth: a **$75/mo small-firm tier** below the $100 core (InvestmentNews/Kitces, Apr 2026); **Lite seats** (cheap/free assistant seats for CSAs) vs Full seats; Core/Scale/Ramping account tiers; annual billing up to 20% off.
- **AI Associate action scope** is broader than recorded: update records, draft **and send** emails, schedule follow-ups, create contacts — all approval-gated (App Store listing + press).
- Integrations not previously listed: **Google Drive, Box, Zapier (with Jump-side triggers), Hubly, Karbon, Microsoft Exchange, SharePoint (meeting-note PDF destination)**; HubSpot integration creates **Deals and Tickets** from action items; Redtail integration now **embeds AI Associate inside Redtail** and preps from UDFs/comments; Holistiplan **Scenario Analysis** feeds prep.
- Capture depth: **dial-in Join My Call** (call a Jump number from any phone, incl. mid-call), **video** recording (not just audio), limited **Spanish**, AI **role labeling** (Advisor/Client), host-independent joining on Zoom/Webex/GoTo/Dialpad/RingCentral, account-level notetaker join-timing controls, a Zoom in-client control app, smart capture-now→calendar-event attachment, attendee prefill for in-person recording.

**Features first captured in this sweep (each one line; sources in the sweep files under `research/`):**
- **Automations builder + custom meeting types** — user-configured "meeting type → outputs" rules engine (help 12043223).
- **Blended updates** — CRM **field-level** writes with a 3-column existing/new/blended review (help 11032671).
- **Unified Action Items** — practice-wide queue of every task/update/follow-up (help 14625364).
- **Keyword tracking** — account-defined terms with per-meeting analytics (help 9842724).
- **Dictation notes** — standalone voice memo → formatted note + tasks (help 11593427; Mobile Assistant heritage).
- **Landing pages / "Compliant Scheduling"** — client-facing booking pages with auto-filled compliance disclosures, shared/team calendars, buffers, scheduling admins (help 15383115).
- **Marketing content generator** — transcript → LinkedIn/blog drafts, direct publish (help 11724026).
- **Schwab account-opening execution** — pre-fill and transmit to Schwab for signature (help 15694767; "End-to-End Client Onboarding", June 2026).
- **Smart Forms write-back into planning tools** — form answers sync to eMoney/RightCapital/Asset-Map with review (June 2026 update).
- **Holdings CSV extraction** from statements + RightCapital import automation (Apr 2026).
- **Contacts surface + Household records** — native contact detail pages; households imported from Salesforce/Dynamics/Redtail/Wealthbox (June 2026).
- **E-Comms Supervision** — Jump-originated outbound comms routed through the firm's supervised email path; SMS→email records (help 14741914).
- **Consent-monitoring modes** — incl. automatic verbal-consent detection from the transcript (help 10064437).
- **Reminders** — time-based alerts on contacts/deals/tasks (Mar 2026).
- **Meeting page as modular hub** — notes/tasks/transcript/sync/scorecards/forms/signals as first-class tabs.
- **Prep visuals** — portfolio charts/net-worth history in briefs, exportable toward client presentations.
- **Meeting-note PDF export preview** with formatting controls (Apr 2026); **Scorecard/Flash-Survey AI analysis reports** (June 2026).
- **Private meetings** — calendar-privacy mirroring with admin-visibility limits (help 13418754).
- **Admin/reporting depth** — usage dashboards, bulk user configs, custom invite emails, Intune app protection, notetaker rename/custom image.
- **Mobile depth** — Capture Card, AI Associate/Contacts/meeting details on mobile, booking management, lock-screen widget (announced).
- **New verticals** — insurance professionals/wholesalers, accounting, asset managers, banks & credit unions.
- *Unconfirmed (single source, contradicted by Jump's own directory):* archiving via Smarsh/Global Relay/Hadrius.

**New attack-surface entries (add to the weaknesses list):**
11. **Client conversations feed Jump's benchmarks.** Jump discloses processing "hundreds of thousands of anonymized and aggregated advisor-client transcripts" as the research base for its insights/Playbooks (jump.ai/insights-data-methodology). Our line: *with Lantern, your clients' conversations never train anyone's benchmarks — structurally.*
12. **Consent inferred by their cloud.** Jump's automatic consent detection means client conversations are analyzed server-side even for the consent question itself. Ours runs locally (Wave 3 Task 13b) and is additive evidence only.
13. **E-comms supervision exists because Jump originates client comms.** Lantern's follow-ups send from the advisor's own inbox, so the firm's existing archiving/supervision already applies — a whole compliance surface we don't need, by architecture.
