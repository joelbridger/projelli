# 1. Honest Jump assessment — who we're actually fighting

*Everything here is sourced (SOURCES.md has every URL). Claims are labeled: VERIFIED
(we fetched the page), SECONDHAND (reported by press/third parties), INFERENCE (our
read). Written 2026-07-03 from research run 2026-07-02/03.*

## 1.1 The company, in one paragraph

Jump (legal entity Accio, Inc., d/b/a Jump; jump.ai; Salt Lake City; CEO Parker Ence,
co-founders Tim Chaves and Adam Kirk) launched publicly in January 2024 and is, two and
a half years later, the category leader in advisor AI: ~$105M raised ($4.6M seed →
$20M Series A, Battery, Feb 2025 → $80M Series B led by Insight Partners, Feb 2026),
~245 employees, claiming 35,000+ advisors (27,000 at the Series B; the count and its
definition have drifted — "advisors" quietly became "users"/"financial professionals"
in some materials). Independent anchor: Kitces Research puts them at ~10% of US
advisors, the #1 standalone AI notetaker, with the *highest advisor satisfaction* among
notetakers. Enterprise distribution: LPL, Osaic, Cetera (~12,000 advisors), Focus
Financial (800-advisor rollout after a competitive bake-off), Equitable, StoneX. Their
homepage today calls them "The #1 AI platform for advisors" and pointedly says "AI
notetaking is only the beginning."

## 1.2 Their strengths — respect them, they're real

1. **Install base + satisfaction.** ~1 in 10 US advisors, adding 1,500–2,000/month
   (self-reported), and — this matters — Kitces reports them *highest in satisfaction*
   among notetakers. This is not a hated incumbent living on lock-in. Advisors like
   Jump. One advisor on record: "If Jump came back and told me they're raising my
   price from like $96 a month to $500 a month… It's so good." (SECONDHAND quote.)
2. **Enterprise distribution.** The LPL/Osaic/Cetera/Focus deals mean tens of
   thousands of advisors get Jump as the house option, often without an individual
   buying decision. This is the moat we cannot copy, and it's the strongest thing they
   own.
3. **Execution cadence.** Monthly what's-new posts, a major launch roughly every
   month March–June 2026 (AI Associate → Redtail embedding → account-opening +
   Compliant Scheduling + MCP), plus an acquisition (Mobile Assistant, Oct 2025) and
   four senior go-to-market hires in April. That is a disciplined machine, not chaos.
4. **A real compliance/security story.** SOC 2 Type II claimed with a named report on
   a Vanta trust center (report itself gated; auditor and period unverified —
   VERIFIED as a claim, not as a certificate), retention controls, redaction,
   attestation tracking, "we don't train AI models on your data" stated in both
   marketing and the MSA contract. Their answer isn't flimsy; it's the standard cloud
   answer done competently.
5. **$80M of fresh powder** aimed, in their words, at an "agentic… AI orchestration
   layer" — i.e., more product, more integrations, more enterprise.

## 1.3 Their verified weaknesses — the attack surface (each cited)

1. **Cloud-only, structurally.** No local, on-device, or BYOK option anywhere in
   their public footprint (VERIFIED, exhaustive sweep). Every client conversation is
   recorded to, transcribed on, and stored on Jump's servers (US/Iowa).
2. **The contract takes more than the marketing admits.** Their MSA grants Jump an
   irrevocable (during term), sublicensable, transferable license to "prepare
   derivative works of the Customer Data… to convert Customer Data to Anonymized Data
   for Jump to use **for any legal purpose**" — and the customer contractually signs
   away any interest in that Anonymized Data ("To the extent Customer has any right,
   title or interest in the Anonymized Data… Customer hereby assigns all such right,
   title, and interest") while the MSA elsewhere declares Jump "the sole and exclusive
   owner" of it (VERIFIED, jump.ai/msa — quote with the qualifier intact whenever this
   goes public). This is the legal machinery behind their benchmarks product, which
   they describe as built from "hundreds of thousands of anonymized and aggregated
   advisor-client transcripts" (VERIFIED, jump.ai/insights-data-methodology; the
   benchmark *program* is opt-in and off by default — the MSA license is not).
3. **Their new openness is a new egress path.** Jump's own privacy policy says that
   when a firm connects a third-party AI service via their connectors/MCP (read-only,
   authorized by the firm, acting "on your behalf"), meeting transcripts, documents,
   contact data, "incidental health information," financial and family details flow
   out — and Jump's connector "does not filter or redact sensitive content before
   delivery unless you or your firm has special configurations or agreements in place
   with Jump," after which "Jump cannot control and is not responsible for how the
   third-party service processes, stores, retains, or uses your data… **including
   whether your data may be used to train or improve the third-party service's AI
   models**" (VERIFIED, jump.ai/privacy-policy, updated June 30, 2026). The firm
   authorizes the connection; the clients in the transcripts don't.
4. **A bot in the room.** Capture is a notetaker bot or cloud recorder; clients see
   it join. Competitor Zocks attacks this exact surface ("clients often don't want to
   be recorded"), and recording triggers all-party-consent law in ~12 states plus
   CIPA class-action exposure in California (Mayer Brown, June 2026; the Otter.ai
   privacy litigation is live precedent — against Otter, not Jump).
5. **Reliability and accuracy complaints.** XYPN's independent test scored Jump's
   transcript accuracy **3.5/5 — the lowest among advisor-specific tools tested**
   (VERIFIED, Jan 2026), with "some bugs in testing" and "second most expensive."
   Dropped-recording complaints are real and vivid (VERIFIED App Store review: "a
   disaster of a product… works amazing WHEN/IF it works… the failure rate is simply
   unacceptable"); Jump's own help center documents seven ways a recording can go
   missing and concedes recovery isn't guaranteed. Balance: their iOS app holds
   4.9/5 (~1,100 ratings), so these are painful exceptions, not the norm.
6. **Price pressure from below.** Core price cut $120 → $100 ($75 small-firm tier)
   under pressure from $49–50 CRM-bundled notetakers (Wealthbox AI, Altruist Hazel);
   InvestmentNews's analyst read: stripping features into paid add-ons to hit the
   lower price "doesn't necessarily speak highly of the value advisors place on those
   additional non-core features." The fully-loaded price ($200/seat/mo) is the
   category's high end.
7. **Sprawl and thin layers.** 40+ integrations, three product SKUs, six verticals
   (advisors, insurance, accounting, asset managers, banks, credit unions — homepage,
   VERIFIED), an "operating system" claim — while the document layer remains
   intake/field-extraction (not deep folder reasoning), AI Associate shipped
   early-access with chat history "coming soon," and InvestmentNews titles their
   flagship coverage "Jump expands its AI 'operating system' — but it still isn't yet
   a CRM." The breadth-vs-depth tension is real and visible.
8. **Value requires the stack.** Jump preps from what's *connected* (CRM, planning,
   email). For a stack-light solo, or for the 20 years of unstructured files no
   integration reaches, Jump has no answer. This remains the core exploitable gap
   (2026-06-28 competitive report, unchanged by anything since).

## 1.4 Pressure-testing Jameson's read — where it's right, where it isn't

Your read, tested against the record:

**"Started as a generic note-taker, not even in financial advising" — PARTLY WRONG.**
The verified origin story: Ence and Chaves first tried a *structured-notes secondary
market* for advisors (killed after customer conversations), then built **an AI tool
for B2B sales teams** — CRM-admin automation, not a note-taking app per se ("The first
version of Jump was actually an AI tool for B2B sales teams" — Ence, on the record,
TechBullion, Mar 2024). So yes, they were not born an advisor company — but they were
never a "generic note-taker" either.

**"Pivoted on an investor's recommendation" — UNSUPPORTED, likely false.** Every
on-record account (three independent founder interviews) attributes the pivot to
customer discovery: a local advisor team (Solidarity Wealth, per secondhand accounts)
asked to use it for client meetings; Ence's brother is an advisor; an RIA owner's
"note taking is the bane of my existence" crystallized it. No source ties the pivot to
an investor. **Do not use the "pivoted on an investor's tip" line anywhere** — it
would hand them an easy public correction and cost us credibility.

**"Panic-adding AI features" — WRONG on "panic," RIGHT on the underlying tension.**
The release record reads as disciplined platform expansion, not panic: a coherent
March reorg (Meet/Grow/Operate), an agent layer (AI Associate), monthly cadence,
senior hires, an acquisition. The Codex red-team's steelman is fair: wedge → data
layer → platform is the standard playbook, executed on schedule. BUT the tension your
instinct is pointing at is real and cited: features stripped into add-ons under price
pressure, an early-access agent missing table stakes, six verticals before the core
product's accuracy leads the category, and a document layer that's still shallow.
The honest formulation: **Jump is executing a breadth strategy competently; the
breadth itself is the vulnerability.** They are becoming "connect 60 things" — which
is exactly the failure mode the board decision named.

**"The whole thing's a mess" (your firsthand product experience) — VALID AS UX
TESTIMONY, not as a company assessment.** Your hands-on read (messy, scattered, hard
to access) aligns with the sprawl critique and with the "still isn't yet a CRM"
analyst skepticism. It does NOT align with their satisfaction ratings — most of their
users like the product. Use your read to drive our *simplicity* positioning, not as a
public claim about Jump's quality.

**"The space is ripe for disruption" — RIGHT, but the disruption vector matters.**
The category is commoditizing from below ($49 CRM bundles), consolidating (Zeplyn
pivoted away citing saturation; Mobile Assistant sold to Jump), and the incumbent is
fleeing upmarket into platform/enterprise. That leaves exactly one open flank:
**depth + privacy + price for the independent advisor who chooses their own stack.**
That's our flank. "Ripe for disruption" head-on across their whole surface — bot
capture, mobile, enterprise — is not supported by the evidence; ripe on OUR flank is.

## 1.5 How Jump likely responds to a "replace Jump" attacker

Ranked by likelihood (fuller mechanics in section 3's counter-moves):

1. **Ignore us until we're visible** (near-certain, and it's a gift — use the quiet
   period to bank switchers). A $105M company does not respond to a zero-customer
   vendor's comparison page.
2. **Battlecard FUD once we cost them deals**: no SOC 2, no mobile, one person,
   laptop-dependent capture, no support team. All true today. Our answers must be
   pre-built (section 5's risk ledger).
3. **Blur the privacy story**: they already say "we don't train on your data"; expect
   "local mode" marketing, maybe on-device features that leave the pipeline in the
   cloud. Counter: the egress indicator + Data Map + their own MSA language make the
   difference inspectable.
4. **Price moves down-market** (they've done it twice) and/or a free/Lite solo tier.
5. **Buy document intelligence** (they bought Mobile Assistant; estate/tax doc AI
   startups are available). This blunts "whole-pile" *marketing* but keeps the
   upload-everything trust ask.
6. **Deepen enterprise lockout** — more house deals, making the independent flank
   *more* important, not less.

What they can't do (without becoming a different company): give up the cloud pipeline,
the per-seat AI margin, or the aggregated-data products. That's the ground we fight on.

## 1.6 Bottom line for the battle plan

Jump is a **strong, liked, well-run incumbent with a structural blind spot**, not a
shambling mess. The winning posture is therefore not "Jump is bad" — it's **"Jump is
the cloud way; here's the private way, it costs less, and here's everything you can
cancel."** Aggression goes into the *architecture contrast, the contract receipts, and
the replacement math* — all verifiable, all things they cannot fix with a press
release — and never into claims about their competence, origin, or motives that the
record doesn't support.
