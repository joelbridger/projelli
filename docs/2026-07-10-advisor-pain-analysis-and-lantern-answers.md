# Advisor Pain Analysis → Lantern's Answers
**Source:** Jameson's wife (advisor at Journey Beyond Wealth, a Schwab-custodied RIA buying software through XYPN), conversation of 2026-07-09, captured in `General Advisor Pain Feedback 070926.md`. Analyzed 2026-07-10 by the Lantern coordinator (Fable 5).
**Why this document matters:** this is first-hand, unprompted pain from a real advising team that is actively evaluating Jump. It is the closest thing we have to sitting in their office. Board stance still governs: lead advisor AI, simple AI-first app, never a note-taker, beat Jump head-on.

---

## 1. What she actually told us (organized)

**Jump features her firm is excited about:**
- J1. Jump can "write to RightCapital" — a client mentions changed income in a meeting, and the planning software gets updated from the meeting notes.
- J2. Jump claims it can pre-fill Schwab digital-platform paperwork for new accounts based on meeting notes.
- J3. Jump has a new forms feature integrated with DocuSign that sends that paperwork to clients for signature.
- J4. Jump is integrating with Holistiplan (tax projection). Her firm would find a real Holistiplan connection genuinely helpful.

**Pains at the firm (independent of Jump):**
- P1. **Collecting sensitive client data is broken.** They need SSNs, income, spending, statements. Their portal (Tamarac / Envestnet) is secure but clunky and weak: clients can't organize uploads into folders, and it's "not very capable."
- P2. **So people fall back to secure email (Bracket)** and clients just reply with information scattered across messages. There is **no single form that asks for everything.**
- P3. **JotForm is their form tool but it is not secure**, so they can't ask for sensitive data through it, it's a separate service, a pain to use, and there's no standard way the team uses it.
- P4. **Prospect drop-off after "yes."** People get excited in the sales meeting, agree to join, then never send their information. Two causes: no good way to send it, AND the information itself (income, spending habits) is genuinely hard for clients to track down.
- P5. **Follow-up is manual, awkward, and untracked.** The firm knows it's asking a lot; repeated outreach feels like a burden and gets awkward. There is **no central way to track each onboarding client's progress.**
- P6. **Non-technical clients** (many older, some younger who just hate portals) need phone walkthroughs. But these people CAN handle email.
- P7. **Expectation-setting and "getting to know the firm"** after the sale is its own clunky phase.
- P8. **Account transfers (ACATS)** — e.g. moving a client from Wells Fargo to Schwab — mean yet more digital paperwork, more questions, more documents, more asks. The cumulative outreach becomes a burden for the team.
- P9. **Integration hype disappointment.** Marketed integrations from tools like Jump often turn out to read or write only a tiny thing. This burned-before skepticism is itself a pain.
- P10. **Vendor friction is real even for tools they want:** Wealthbox has a secure-forms feature on a higher tier, but they can't even get a quote (must go through XYPN; the boss is locked out of his XYPN account).

**Go-to-market intelligence:**
- G1. An outside IT/security company (**AlphaOne**) runs their IT, sets up VPNs (something like Perimeter/Guardian), and **approves software**. Winning the IT gatekeeper matters as much as winning the advisor.
- G2. They buy software **through XYPN** — XYPN is a channel (and right now, a bottleneck).

---

## 2. The big insight

Read pains P1-P8 together and a shape appears: **the firm's worst pain is not note-taking, meetings, or even integrations. It is the "first 90 days" of a client relationship — getting a new client's life INTO the practice.** Portals fail, forms are insecure, email scatters everything, clients stall, follow-up is awkward and untracked, and transfers multiply the asks.

And here is the strategic kicker: **this is the exact moment Lantern's whole identity — the private place a client's data lives — begins.** Onboarding is not a side feature for us. It is *how data enters the private intelligence layer.* A Client Map that builds itself from day zero, starting with intake, is the most natural expression of our product there is.

Jump attacks this from the meeting side (notes → prefill → e-sign). Nobody in her story attacks the **collection** side — the portal that clients hate, the form that can't be secure, the follow-up nobody tracks. That's an open flank, and privacy is the hard part of it — which is OUR home turf.

One sentence version: **Jump automates the advisor's paperwork. Lantern can fix the client's side of onboarding too — and that's where the deals are actually dying (P4).**

---

## 3. The flagship idea: Lantern Intake ("ask once, never re-ask")

A secure onboarding experience the advisor sends as one link, built on Lantern's end-to-end-encryption machinery (the same design as our firm relay: the server only ever stores ciphertext).

**For the client, it looks like:**
- One friendly link (their name on it, the firm's brand). Not a portal. No account creation. Works on a phone.
- A guided checklist, not a wall of fields: "Upload last month's statement → done ✓. Your Social Security number → done ✓. Rough monthly spending → 'I don't know' is an allowed answer, and the advisor gets told that gently."
- **Savable progress + smart nudges.** They can stop and resume. If they stall, Lantern drafts the polite follow-up (spaced, warm, references exactly what's missing) and the advisor approves it with one click. The awkwardness of "asking again" (P5) is delegated to software.
- **An email-native fallback (this is the sleeper feature).** For portal-haters (P6): the client just replies to a normal email with attachments and answers. Lantern ingests the reply, extracts the data, checks items off the same checklist automatically, and never makes grandma log into anything. Same checklist, two doors.
- **A phone-walkthrough mode:** the advisor opens the same checklist on their screen and fills it in live while talking the client through it. One source of truth regardless of path.

**For the advisor, it looks like:**
- **An Onboarding board in Lantern** — every in-progress client, what's received, what's missing, days since last touch, next suggested nudge (P5 solved: the central tracker that doesn't exist today).
- Every received item lands in the client's folder, indexed, feeding the Client Map from day one.
- **"Ask once" as a product promise:** anything collected at intake is never asked again — it prefills the Schwab paperwork, the ACATS transfer forms, the planning-software profile, the CRM. (This is what makes intake + J2/J3 parity into something bigger than Jump has.)

**Why only Lantern can tell this story:** JotForm can't take an SSN (P3). Portals are cloud databases full of everyone's SSNs. Lantern Intake can honestly say: *your client's Social Security number is encrypted in their browser and can only be decrypted on YOUR computer. We never see it. No one at Lantern can ever see it.* That is a sentence Jump — a cloud product — cannot say, and it's a sentence the firm's IT gatekeeper (G1) will love. It also matches our receipts-and-honesty brand perfectly.

**The AI angle (so it's still the simple AI-first app, not a forms tool):**
- The **Document Detective**: when a client uploads a statement, AI reads it immediately and responds like a great assistant would: "This shows your IRA. We still need your brokerage account — it's usually on a statement like this one." Fewer wrong uploads, fewer follow-ups.
- AI extracts income/spending signals from the documents clients DO manage to send (tax returns, statements), shrinking the "hard stuff to track down" burden (P4) instead of just asking harder.
- Intake answers flow straight into the Client Map, so the advisor walks into the first real meeting with a living map already built.

---

## 4. Jump scorecard — everything they praised, our answer

| Jump feature (as heard) | Parity plan | How we do it BETTER |
|---|---|---|
| J1: write meeting facts to RightCapital | Extend our approval-gated CRM-write machinery (built + hardened this week: backend-verified proposals, encrypted queue, honest receipts) to a RightCapital connector | Every write goes through the review card + a receipt; approval enforced in the engine, not just the UI. "AI never edits your planning software silently" is a stronger pitch than "AI writes to RightCapital" |
| J2: pre-fill Schwab paperwork from meeting notes | Already an approved plan (Schwab prefill + partnership, approved 2026-07-09, plans in `docs/plans/lantern-plus/`) | We prefill from meeting notes AND intake data AND uploaded documents (ask-once). Jump only has the notes |
| J3: forms + DocuSign to client for signature | Our DocuSign connector is code-complete, gated on vendor credentials (see CONNECTORS.md) — this is unlocking, not building | Bundle with intake: collect → prefill → sign, one pipeline, one tracker |
| J4: Holistiplan integration | Holistiplan connector: push the tax documents we already hold locally; pull projections back as cited documents in the client folder | See "Integration Honesty" below — we publish exactly what it reads/writes |
| (their marketing) big integration claims | — | **Integration Honesty Cards** (below) turn their hype problem (P9) into our trust asset |

**Integration Honesty Cards — direct counter to P9.** For every connector we ship, a public one-page card: exactly what it reads, exactly what it writes, what it can never touch, with a live verified date. In-app, the connector shows the same card. Her firm has been burned by integration hype; the vendor that documents its limits honestly becomes the believable one. Cheap to build, brand-defining, and Jump structurally can't follow without exposing how shallow some of its sixty connections are.

---

## 5. The wider idea grab-bag (nothing off the table, as requested)

Ranked roughly by leverage-to-effort:

1. **ACATS transfer autopilot (P8).** Client uploads their old Wells Fargo statement; local OCR reads account numbers, registration type, holdings; Lantern prefills the Schwab transfer paperwork and stages it for DocuSign. The single most hated document task in the industry, and the inputs are documents we already ingest. (Custodian API access matters here; the Schwab partnership track covers it.)
2. **Welcome journey / expectation-setting (P7).** From the firm's own templates: a personalized "here's what happens next" page on the same intake link (steps, timeline, who's who at the firm), plus AI-drafted welcome and milestone emails in the advisor's voice. Onboarding stops feeling like a paperwork chase and starts feeling like hospitality.
3. **The "IT gatekeeper pack" (G1).** A ready-to-send dossier for firms' IT vendors (like AlphaOne): one-page architecture (local-first, what leaves the machine and when), the printable Data Map, VPN/network compatibility notes, security posture (never claim SOC 2 certification — state the honest posture). Goal: "approved by your IT company from one email." Also: court the IT vendors themselves as a channel — they influence every software decision at every firm they manage.
4. **Onboarding analytics for the firm.** Where do clients stall? Which asks cause drop-off? Average days-to-funded? Turns P4 from an anecdote into a dashboard the firm owner cares about (it's revenue latency).
5. **Physical-mail mode (the anti-tech door, fully considered as instructed).** For the least technical clients: Lantern generates a printed, personalized intake packet with a prepaid return envelope and a checklist; the firm scans returns (or the client mails copies), local OCR ingests. Nobody else will bother building this; advisors with 80-year-old clients will hug us.
6. **AI phone-intake assistant (futuristic, flag for later).** A voice agent that walks a client through intake by phone, filling the checklist live. Technically within reach; compliance and trust questions are real — park it as a headline-grabber for later, not a build item now.
7. **Spending/income inference service.** We never do bank-scraping aggregation (stay simple, stay private), but AI extraction of income/spending from documents already collected (tax returns, pay stubs, statements) answers the "this is genuinely hard to track down" half of P4 without scope creep.
8. **Wealthbox gap exploit (P10/sales).** Their CRM's secure-forms feature is an unreachable up-tier quote away. Sales line for advisors on Wealthbox: "the secure intake you couldn't even get a quote for is included in Lantern, and it's end-to-end encrypted, which theirs isn't."

---

## 6. Honest tensions to manage (so we don't fool ourselves)

- **Board stance says simple AI-first app, not integration breadth.** The answer is sequencing and framing: Intake is ONE flow (send link → things arrive → map builds), not sixty connectors. RightCapital/Holistiplan writes reuse one machine (the approval-gated write queue) — each new target is a socket on the same engine, not a new engine.
- **Intake needs a small hosted, client-facing component** (the link the client opens). Our answer already exists in the architecture: the firm relay pattern — ciphertext-only server, keys on the advisor's machine. It must be built to that standard or not at all; a normal cloud form would forfeit the entire story.
- **DocuSign/Schwab/RightCapital/Holistiplan all need vendor relationships.** Some of this is on Jameson's plate (vendor applications) — worth batching into one vendor-access push.
- **We are hearing one firm.** It's a fantastic signal (a real Jump-evaluating RIA), but before heavy building, the intake concept deserves 30-minute validation chats with 3-5 more advisors. The wife's firm is design partner zero.

---

## 7. Recommended path (my call, pending your veto)

1. **Now:** adopt "Onboarding OS" as the next major product theme for lantern-plus, alongside the already-approved Schwab-prefill + Calendly tracks (which slot INTO it as the paperwork stage). Wave-plan it like the Jump-parity program: intake link + checklist + E2EE upload first; onboarding board + AI nudges second; email-native fallback third; ACATS autopilot fourth; RightCapital/Holistiplan write-backs as connector sockets on the existing write engine.
2. **Cheap immediate wins to start this week:** Integration Honesty Cards (docs + in-app card, mostly writing); the IT gatekeeper pack (mostly writing + the existing Data Map); unlock the code-complete DocuSign connector (vendor credential task for Jameson's list).
3. **Validate while building:** five questions for your wife (below), then the same conversation with a few XYPN-adjacent advisors.
4. **Demo tie-in:** the 80-household demo practice we're building tonight becomes the perfect stage — we add one "currently onboarding" household to show the intake board working when the next demo checkpoint comes.

**Five questions worth asking your wife next (each unlocks a design decision):**
1. When a prospect stalls after saying yes, who at the firm notices, and how long does it usually take? (Sizes the tracker's value.)
2. If a magic form existed, what are the actual 10-15 items they'd put on it for a typical new household? (Becomes our default template.)
3. Would their firm let clients type an SSN into a web page if it were provably encrypted end to end, or is verbal/phone the only acceptable channel for some data? (Shapes the intake fields + phone mode.)
4. What exactly does AlphaOne check before approving software? A form? A call? (Shapes the IT pack.)
5. In RightCapital, which 5 fields drift out of date most often after meetings? (Scopes the write-back connector to what matters.)

---

*Companion reading: the Jump-parity program plans in `docs/plans/lantern-plus/`, the 2026-06-29 board stance, and the receipts/egress work merged 2026-07-09 (the write-engine this document keeps reusing).*
