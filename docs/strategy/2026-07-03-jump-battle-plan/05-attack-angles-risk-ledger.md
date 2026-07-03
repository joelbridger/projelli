# 5. Aggressive positioning angles + the risk ledger

*Each angle: the factual basis (cited), the punchy version (drafted in house voice for
when it's used), and the blowback assessment. Marked SAFE NOW / NEEDS EVIDENCE /
DO NOT USE. Hard rules first, because aggression only works from clean hands.*

## The hard rules (non-negotiable)

1. **Never claim SOC 2** or any certification we don't hold. Never say "compliant."
2. **Never state a Jump fact without a source we can produce.** Before anything goes
   public, archive every quoted Jump page (their MSA, privacy policy, methodology
   page, pricing) via archive.org the same day — vendors edit legal pages, and our
   receipts must outlive their edits.
3. **Quote, don't characterize.** "Their contract says X" with the verbatim words is
   safe; "they take your data" as a paraphrase is a defamation/false-advertising
   (Lanham Act) exposure. Comparative advertising about a named competitor is legal
   in the US when claims are truthful and substantiated; the burden of proof is ours.
4. **Attack the architecture, never the people.** No "panic," "mess," "desperate,"
   or motive claims. Their satisfaction ratings are high; calling a liked product a
   mess makes *us* the unreliable narrator.
5. **State our own asterisks in the same breath** (BYOK-cloud mode sends query text
   to the advisor's chosen provider; mobile capture gap; no SOC 2). Pre-stated limits
   are armor; discovered limits are scandals.
6. **One legal-review pass** over any public page that names Jump, before it ships.
   Cheap insurance for a trust product.

## The angles

*Label definitions: **SAFE NOW** = safe to publish at Stage 0/1 — i.e., at program
completion, when the referenced capability has passed its wave's acceptance gates —
with no further evidence needed. It does not mean "publish today while Waves 3–4 are
still building." **NEEDS EVIDENCE** = gated on real-pilot proof beyond the build
itself. **DO NOT USE** = retired regardless of evidence.*

### Angle 1 — "Read their contract" (the license grant) — SAFE NOW ✅ (strongest angle we have)
- **Factual basis (VERIFIED, jump.ai/msa):** Jump's customer agreement grants Jump a
  "worldwide, non-exclusive, irrevocable (during the Term), royalty-free… sublicensable
  and transferable license to use, process… and prepare derivative works of the
  Customer Data… (d) to convert Customer Data to Anonymized Data for Jump to use **for
  any legal purpose**." The MSA declares Jump "the sole and exclusive owner" of
  Anonymized Data, and the customer signs away any claim to it ("To the extent
  Customer has any right, title or interest in the Anonymized Data… Customer hereby
  assigns all such right, title, and interest"). Public use must keep that "to the
  extent" qualifier — quote, don't compress.
- **Punchy version (draft, house voice):** *"I read Jump's customer agreement so you
  don't have to. It licenses your client meetings to Jump to 'prepare derivative
  works,' and once they become 'anonymized data,' the contract makes Jump the sole
  and exclusive owner, for any legal purpose. Their words, not mine. My contract
  can't say any of that. There's no server to license your data to."*
- **Blowback:** Jump's fair reply is "standard SaaS language, benchmarks are opt-in,
  we never train models on your data." All true — so we must never say "they train on
  your data" (they contractually don't) and never conflate the opt-in benchmarks
  program with the always-on license. The precise attack is *ownership and
  irrevocability of the anonymized derivative*, which their reply doesn't touch. Legal
  risk: low if verbatim. Credibility risk: low — it invites advisors to read the
  contract, which is exactly the behavior a fiduciary respects.

### Angle 2 — "Your clients never feed anyone's benchmarks" — SAFE NOW ✅ (with the honesty caveat)
- **Factual basis (VERIFIED, jump.ai/insights-data-methodology):** Jump's benchmarks
  are built from "hundreds of thousands of anonymized and aggregated advisor-client
  transcripts." Participation is "entirely optional and off by default" — an *account
  owner* opts the firm in; the clients in the conversations are not the ones asked.
- **Punchy version:** *"Jump built a benchmarks product out of hundreds of thousands of
  advisor-client conversations. Anonymized, aggregated, opt-in for the firm. Still:
  did the client in that meeting opt in? With Lantern the question can't come up. The
  conversation never leaves the room."* (Wording discipline: say conversations
  "feed" or "power" their benchmarks — never "train," which Jump could read as a
  model-training accusation their methodology page explicitly denies.)
- **Blowback:** Must always include "anonymized, opt-in" or we're materially
  misleading and they get a clean public correction. With the caveat included, the
  angle actually *strengthens* — we're being fairer to Jump than Jump's competitors
  are (Zocks omits the caveat), which reads as confidence.

### Angle 3 — The MCP egress disclosure — SAFE NOW ✅ (fresh: their June 2026 launch)
- **Factual basis (VERIFIED, jump.ai/privacy-policy, updated June 30, 2026):** when a
  firm authorizes a third-party AI connection to Jump (their new MCP support, launched
  June 25 — read-only, acting "on your behalf"), transcripts, documents, contact data,
  "incidental health information," financial and family details flow out; Jump's
  policy states the connector "does not filter or redact sensitive content before
  delivery unless you or your firm has special configurations or agreements in place
  with Jump," and "Jump cannot control and is not responsible for how the third-party
  service processes, stores, retains, or uses your data… including whether your data
  may be used to train or improve the third-party service's AI models."
- **Punchy version:** *"Jump just added MCP so other AI tools can read your meetings.
  It's your firm's choice to connect one, and it's read-only. But read their privacy
  policy on what goes out when you do: transcripts, documents, health details, family
  details, not filtered by default, and once it's out, Jump 'cannot control' whether
  it trains someone else's model. Their words, June 30, 2026. Lantern's version of
  MCP will run on your machine, where 'out' doesn't exist."*
- **Blowback:** with the authorized/read-only framing built in (above), their fair
  reply is already inside our copy — which is the strongest position. The sting
  survives: the *firm* authorizes, the *clients* in the transcripts were never asked,
  and the local alternative is structurally different. Legal risk: minimal (verbatim
  policy quotes). Note: our own MCP answer is backlogged — don't promise dates.

### Angle 4 — "No bot in the room" — SAFE NOW ✅ (ships with Wave 3)
- **Factual basis:** Jump's capture is a notetaker bot/cloud recorder clients can see
  join; recording triggers all-party-consent law in ~12 states; the Otter.ai privacy
  class action (N.D. Cal., 2025) is live precedent that recording-bot vendors carry
  legal surface; Mayer Brown (June 2026) flags CIPA exposure for notetaker vendors.
  Lantern's capture is the advisor's own machine recording its own audio; consent
  handling is local.
- **Punchy version:** *"Your client came to talk about their money and their family.
  'Jump Notetaker has joined the meeting' changes that conversation. Lantern doesn't
  join meetings. Your computer takes the notes, they stay on your computer, and
  nobody else was ever in the room."*
- **Blowback:** low. It's an architecture fact plus a client-experience observation.
  Do NOT imply Jump is illegal or non-consenting — they have consent machinery; the
  angle is about who's in the room and where the audio lives. (And recording-consent
  law binds *us* too: our Wave 3 consent dialog/ledger is the answer, and voiceprints
  are biometrics — Illinois BIPA — so our Wave 4 voiceprint consent copy gets its own
  legal look. Clean hands first.)

### Angle 5 — The replacement math / per-seat AI tax — SAFE NOW ✅
- **Factual basis:** verified pricing (Meet $100 + Onboard $50 + Grow $50, per
  advisor, per month; $75 small-firm tier; two pricing restructures in 18 months);
  the InvestmentNews price-compression analysis; our §4.3 table.
- **Punchy version:** *"Jump's stack runs $1,200 to $2,640 per advisor per year, and
  the price has been restructured twice in 18 months. Lantern is one license, about
  half the full Jump stack at today's list prices, and the AI runs on your own key at
  cost — pennies, with a receipt. When the AI industry raises prices, your bill
  doesn't move."* (Re-run this sentence against whatever price Q6 in section 8
  lands on — it must stay literally true at the chosen price.)
- **Blowback:** price wars favor the funded incumbent; they can cut again. Which is
  why price is one pillar of five, never the lead. Keep numbers dated ("as of July
  2026, jump.ai/pricing") so their next price change doesn't make us liars.

### Angle 6 — Reg S-P / "less to vet" — SAFE NOW ✅ (framed exactly this way)
- **Factual basis:** amended Reg S-P (small-RIA deadline June 3, 2026) requires
  written incident-response programs, 30-day breach notification, and vendor
  oversight. Jump is a vendor holding client NPI (their subprocessor list is gated
  behind a trust-center access request — friction for a diligence-doing solo). In
  Lantern's local-only mode, nothing leaves; in BYOK mode, only query text to the
  provider the advisor chose. Rule 204-2: AI notes are books-and-records; ours are
  files the advisor's existing archiving already covers (Cooley analysis, Apr 2026).
- **Punchy version:** *"Reg S-P now makes you responsible for every vendor that
  touches client data. Jump's answer is a SOC 2 report behind a request form. My
  answer is shorter: in local mode there's no vendor to oversee, and your notes are
  files your archiving already keeps."*
- **Blowback:** the compliance-overclaim trap. NEVER "compliant," never "nothing to
  vet" as an absolute (BYOK mode has the provider), never legal advice. The 06-28
  memo's framing is the law here: privacy is the permission to try; "less to vet" is
  the honest claim. SEC is actively fining AI-washing — this angle gets the legal
  pass twice.

### Angle 7 — Simplicity vs sprawl — SAFE NOW ✅ (as contrast, not insult)
- **Factual basis:** Jump's own surface: three SKUs, 40+ integrations, six verticals
  on the homepage, an early-access agent, "operating system" language; the board's
  firsthand UX read; InvestmentNews's "still isn't yet a CRM" skepticism; the market's
  documented punishment of bloat (§4.1).
- **Punchy version:** *"Jump's pitch is an operating system: three products, forty
  integrations, six industries. Mine is one sentence: connect your files, ask
  questions, get cited answers. You'll be working in it this afternoon, and there's
  no module to add later."*
- **Blowback:** low as written. The moment it becomes "Jump is a mess," we're
  contradicted by their satisfaction scores and 4.9-star app. Contrast our shape;
  never grade their quality.

### Angle 8 — Reliability / accuracy — NEEDS EVIDENCE ⚠️ (hold until pilots)
- **Factual basis:** XYPN scored Jump's transcript accuracy 3.5/5, lowest of the
  advisor tools tested (Jan 2026); verified dropped-recording complaints; their own
  help center lists seven ways a recording goes missing.
- **Why hold:** our capture hasn't survived a single real pilot yet. Attacking their
  reliability invites "and yours?" — which today has no answer. The Codex red-team is
  right that a failed capture at a real client meeting is a brand-killer.
- **Unlock:** after pilot evidence (10+ real meetings captured cleanly, per the
  red-team's proof gate), the angle becomes: *"Local capture can't drop a recording
  in upload. If my machine is recording, I have the file. Here's the crash-recovery
  demo."* Show, don't assert: the force-quit-recovery demo is the argument.

### Angle 9 — The origin/pivot story — DO NOT USE ❌
- **What the record shows (§1.4):** Jump began as a structured-notes marketplace,
  then a B2B sales-team AI tool, and pivoted to advisors through customer discovery.
  No investor-driven pivot on record.
- **Why not:** (a) the version you'd been told is partly wrong and they can correct
  it publicly at our expense; (b) even the true version is a respectable
  customer-driven pivot — attacking it reads as motive-questioning, which violates
  rule 4; (c) it's the weakest of our nine angles with the highest credibility risk.
- **The one acceptable trace of it:** a positive-only heritage line about *us* —
  *"Lantern was built from day one for confidential client work"* — which implies the
  contrast without asserting anything about Jump. Even this stays low-key.

### Angle 10 — "What happens when you leave" — SAFE NOW ✅ (the quiet closer)
- **Factual basis:** Jump's MSA gives a departing customer 90 days to download
  Customer Data after termination, and its anonymized derivatives sit outside any
  deletion duty (VERIFIED, jump.ai/msa); Cooley's 204-2 analysis notes deletion of a
  required record "may itself be the violation." Lantern's artifacts are ordinary
  files on the advisor's machine; if we vanish, nothing is stranded.
- **Punchy version:** *"Ask any vendor two questions. What do you keep when I leave?
  And what happens to my records if you shut down? My answers: nothing, and nothing.
  Your files were always yours. Jump's contract answers differently: 90 days to
  download, and the anonymized data stays theirs."*
- **Blowback:** near-zero; it simultaneously answers the "one-person vendor" fear —
  the strongest objection to us — by making vendor risk symmetrical and ours smaller.

## The meta-risks of the aggressive posture (from the independent red-team, kept whole)

1. **Punching up without proof reads as noise.** A zero-customer vendor attacking a
   liked incumbent looks insecure. → Mitigation: the rung ladder (§4.4). Rung 1 is a
   calm, cited comparison page; the war-cry campaign waits for switchers.
2. **It invites their battlecard** (no SOC 2, no mobile, one person, laptop-dependent
   capture, no support team). → Mitigation: pre-write our answers into the comparison
   page itself; being first to state your own weakness defuses it.
3. **Every capture bug becomes a brand failure** once "replace Jump" is public. →
   Mitigation: Angle 8's evidence gate; controlled early-access posture.
4. **It narrows the funnel too early** — "rip out Jump" is a harder yes than "add the
   private intelligence layer, keep your notetaker for now." → Mitigation: run both
   doors (section 6): coexistence for Jump loyalists (Wave 0's import path exists for
   exactly this), replacement for the fed-up and the not-yet-committed.
5. **Goliath sympathy** if we're nasty. → Mitigation: rules 3–5. Receipts, not
   adjectives. The tone that wins: a careful craftsman showing his work, not a
   challenger shouting.

## Summary verdicts

| # | Angle | Verdict |
|---|---|---|
| 1 | Their contract's license grant | SAFE NOW — flagship |
| 2 | Benchmarks from client conversations | SAFE NOW (with opt-in caveat, always) |
| 3 | MCP unfiltered egress | SAFE NOW |
| 4 | No bot in the room | SAFE NOW (ships with Wave 3) |
| 5 | Replacement math / AI tax | SAFE NOW (dated numbers) |
| 6 | Reg S-P "less to vet" | SAFE NOW (exact framing, legal pass) |
| 7 | Simplicity vs sprawl | SAFE NOW (contrast, never insult) |
| 8 | Reliability / dropped recordings | NEEDS EVIDENCE — hold for pilot proof |
| 9 | Origin/pivot story | DO NOT USE |
| 10 | What happens when you leave | SAFE NOW — the closer |
