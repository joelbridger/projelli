# 3. The structural moat — what Jump cannot copy without rebuilding their company

*The question this section answers: which of our advantages are STRUCTURAL (Jump would
have to rebuild their architecture or break their business model to match them), which
are merely CURRENT (they could copy in a quarter with $80M in the bank), and — most
important — which ones advisors actually care about versus which ones are engineering
pride.*

## The core idea, in plain words

Jump is a **cloud service**. Every recording, every transcript, every note, every client
fact their customers create lives on Jump's servers and is processed there. That isn't a
bug they can patch — it's their business model. Their pricing, their enterprise deals,
their analytics products (Grow's benchmarks are built from aggregated customer
transcripts — their own methodology page says so), and their $105M of venture
expectations all assume the data flows through them.

Lantern is built the opposite way: the software runs on the advisor's own computer, the
files stay in the advisor's own folders, transcription happens on the advisor's own
machine, and AI calls go directly from the advisor's machine to the AI provider the
advisor chose ("BYOK" — bring your own key). There is no Lantern content server at all.

That difference creates a set of advantages Jump can only match by **becoming a
different company**. This section grades each one honestly.

## Grading scale

- **Moat strength:** how hard it is for Jump to copy. STRUCTURAL = requires rearchitecting
  or cannibalizing their model. HARD = a year-plus of real engineering against their
  grain. SOFT = they could ship it in a quarter.
- **Buyer weight:** how much it moves a real advisor's buying decision, based on the
  evidence we have (advisor research, compliance reality, practitioner voices). DECIDER =
  can close or kill a deal on its own. SUPPORTER = strengthens trust, rarely decides
  alone. PRIDE = we love it; buyers mostly shrug.

## The ledger

### 1. No meeting bot — capture happens on the advisor's machine
- **What it is:** Jump's capture is a bot that joins the meeting ("Jump Notetaker has
  joined…") or a cloud recorder. Lantern captures the meeting's audio directly on the
  advisor's computer (system audio + microphone), so nothing joins the call and no third
  party is in the room.
- **Moat strength: STRUCTURAL.** A bot IS their capture architecture, across every
  platform they support. Matching "no bot, no cloud" means abandoning cloud
  transcription — which breaks their retention products, their benchmarks pipeline, and
  their enterprise compliance-dashboard story.
- **Buyer weight: DECIDER for a real segment.** Some compliance departments block
  meeting bots outright; some clients react badly to a robot announcing itself in a
  sensitive money conversation. For those advisors this is an eligibility test Jump
  fails. For everyone else it's a SUPPORTER ("my client never sees a bot" reads calmer
  and classier).
- **The honest flip side:** the same architecture means we can't capture when the
  advisor's machine isn't in the meeting (closed laptop, phone-only, advisor absent —
  see the kill sheet's accepted gaps). We trade capture-anywhere for private-everywhere.
  The positioning must own that trade proudly rather than hide it.

### 2. Local transcription — the conversation never leaves the machine
- **What it is:** Jump transcribes in their cloud. Lantern transcribes on-device with a
  local speech model. The most sensitive artifact an advisor produces — a verbatim
  record of a client's money, family, and health talk — never exists anywhere but the
  advisor's own computer.
- **Moat strength: STRUCTURAL.** Their entire post-meeting pipeline runs server-side.
  On-device transcription would mean shipping and supporting a desktop runtime they
  don't have, and giving up the aggregated transcript corpus they publicly say powers
  their insights.
- **Buyer weight: SUPPORTER trending DECIDER as AI-privacy scrutiny grows.** The 2026
  Reg S-P amendments (the SEC's customer-data-protection rule, which reached small
  firms in June 2026) made every RIA formally responsible for overseeing vendors that
  touch customer data. "The transcript never left my machine" is the shortest possible
  answer to a due-diligence questionnaire. Our own advisor memo is blunt, though:
  privacy is usually the *permission to try*, not the reason to buy — most advisors are
  accepting SOC-2-plus-contract cloud vendors today. Sell it as "less to vet," not "you
  must have this."

### 3. Per-client cryptographic isolation + the egress indicator + printable Data Map
- **What it is:** each client's data is isolated with its own encryption; an
  always-visible indicator shows when anything leaves the machine; a printable Data Map
  documents exactly where data lives and flows. Jump has retention *settings*; we have
  an *architecture you can show an examiner*.
- **Moat strength: HARD.** A cloud vendor can write a data map too — but theirs
  necessarily says "your client conversations are processed and stored on our servers
  and our AI subprocessors." Ours says "your machine, your keys." They can't write our
  sentence.
- **Buyer weight: SUPPORTER.** No advisor wakes up wanting cryptographic isolation. But
  in the compliance-review moment — an SEC exam, a Reg S-P program, an E&O
  questionnaire — a one-page artifact beats a 40-page audit report for a solo who IS
  their own compliance officer. Trust ammunition, not the headline.

### 4. BYOK — the advisor's own AI key, no inference middleman, no per-seat AI tax
- **What it is:** Lantern never proxies or resells AI. The advisor plugs in their own
  provider key (or runs a fully local model); requests go machine → provider, and
  inference costs them cents at cost. Jump's ~$100–200/seat/mo *is* largely an
  AI-and-cloud markup.
- **Moat strength: STRUCTURAL (economically).** Jump can't drop to BYOK pricing without
  detonating the revenue model their $105M raise was priced on. An incumbent can always
  discount; it can't switch to "you pay the AI company directly and we just sell
  software" without a shareholder-level rethink.
- **Buyer weight: DECIDER via price, SUPPORTER via control.** The money math (section 4)
  is the loudest version. Jump's own price moves — the $120→$100 core cut, the $75
  small-firm tier — tell us their buyers push back on price. "Your AI bill is your own
  and it's tiny" also future-proofs the buyer against per-seat AI price creep across
  their whole stack. The honest caveat: BYOK adds a setup step a non-technical advisor
  must survive; onboarding must make the key feel like "enter your license code," or
  this moat costs us more deals than it wins.

### 5. Word-native artifacts — real .docx with tracked changes, not app-locked text
- **What it is:** every artifact Lantern produces (meeting notes, prep briefs,
  attestation reports) is a real Word document via our in-house OOXML engine, with
  tracked-changes AI redline. Jump produces text inside their app plus PDF export.
- **Moat strength: HARD.** An in-house Word engine is years of unglamorous work no
  venture-backed meeting-notes company will prioritize. They'd integrate Office online
  instead — which pushes their users *further* into the cloud and still isn't
  redline-native.
- **Buyer weight: SUPPORTER, DECIDER for document-heavy practices.** Advisory work
  product ultimately lives in Word and the file system ("books and records" = files you
  keep, not rows in a vendor's database). "Your notes are your files, in the format your
  compliance archiving already handles" is a quiet but very adult advantage — and it's
  also why leaving Lantern is safe (your files remain yours), which flips the
  vendor-risk question back onto Jump.

### 6. Whole-pile intelligence — we read the client's actual documents, not just meetings + CRM
- **What it is:** Lantern's answers come from the client's real file pile (plans,
  statements, wills, beneficiary forms, emails, meeting transcripts) with citations to
  the exact source. Jump's client picture is meeting-and-integration-fed; its document
  layer is intake and field-extraction, not deep folder reasoning (verified in the
  2026-06-28 competitive report and unchanged since).
- **Moat strength: HARD (today), SOFT (long-run).** Nothing physically stops Jump from
  building document intelligence — but doing it *in their cloud* means asking advisors
  to upload the entire client file pile to a startup's servers, a much bigger trust ask
  than "let a bot take notes." Our local architecture makes the whole-pile version
  *possible to say yes to*. Their version of this feature carries their weakness with it.
- **Buyer weight: DECIDER.** This is the product's actual thesis, externally validated:
  meeting/plan prep is the single largest documented advisor time-drain (26% of advisor
  time vs 19% spent in actual meetings — Kitces Research, n=621), and the underlying
  pain is retrieval across scattered sources. Jump preps from what's connected; we prep
  from what the advisor actually has.

### 7. E2EE firm collaboration — the relay only ever stores ciphertext
- **What it is:** the firm tier syncs shared client data end-to-end encrypted;
  information barriers are enforced by key denial, not UI hiding. ("End-to-end
  encrypted" means our server physically cannot read what passes through it.)
- **Moat strength: STRUCTURAL.** Jump's enterprise tier is the opposite by design —
  admin dashboards, usage analytics, and firm-wide compliance visibility all depend on
  the server seeing content.
- **Buyer weight: PRIDE today.** Our wedge is solos and small RIAs; multi-seat E2EE
  matters later, and enterprise buyers currently *want* the visibility features Jump
  sells. Keep it; don't lead with it.

### 8. Pricing structure — flat annual license vs per-seat SaaS creep
- **What it is:** Lantern is per-seat annual (current list: Solo $468/yr, Professional
  $948/yr, Firm $1,548/seat/yr; the 06-28 memo recommends testing higher) with ~95%
  gross margin because inference is BYOK. Jump lands at ~$1,200–2,400/seat/yr and
  *added* paid modules (Onboard +$50/mo, Grow +$50/mo) after getting installed.
- **Moat strength: SOFT as a number, STRUCTURAL as a model** (see #4 — they can match
  any price for a while; they can't match the model).
- **Buyer weight: DECIDER in the replacement math.** "Half the price, and the AI bill is
  yours at cost" is the most legible sentence in the whole package. Caveat from our own
  memo: too-cheap signals toy. The pitch is *serious value at a sane price*, not *cheap*.

## Which of these actually matter — the honest ranking

Tying to the discovery research and compliance reality:

1. **DECIDER-grade:** whole-pile intelligence (#6 — it's the validated pain),
   the replacement price math (#8/#4), and no-bot capture (#1) for the bot-blocked and
   bot-averse segment.
2. **SUPPORTERS that compound into trust:** local transcription (#2), isolation + Data
   Map (#3), Word-native (#5). None closes alone; together they make "the private one"
   unarguable.
3. **PRIDE today:** E2EE firm tier (#7) as a lead message; BYOK framed as *technology*
   rather than as money. Keep building them; don't spend headline space on them.

And one non-obvious point the whole package leans on: **our moat also answers the
"one-person vendor" objection.** With a cloud vendor, vendor failure means your data and
workflow are stranded. With Lantern, everything is the advisor's own files on their own
machine in standard formats — if we disappeared tomorrow, they'd lose future updates,
not their practice's memory. No cloud competitor can say that sentence.

## What Jump CAN do about all this (their realistic counter-moves)

Honesty about the Goliath's options — fuller treatment in section 1:

1. **Blur the privacy story** — "we never train on your data" pledges (already made),
   partial on-device features, a "private mode" label. **Likelihood: high.** Our answer:
   the egress indicator and Data Map make "kind of private" vs "architecturally private"
   inspectable; keep receipts on what still flows to their cloud.
2. **Buy their way to document intelligence** — acquire an estate/tax-doc AI startup
   (they already bought Mobile Assistant). **Likelihood: medium.** Doesn't touch
   local-first; raises the trust ask their architecture imposes.
3. **Price war downward** — another cut, a free solo tier. **Likelihood: medium-high**
   (two price moves already). They can outlast us on price; never make price the only
   pillar.
4. **FUD the solo vendor** — "no SOC 2, one person, who supports you?" **Likelihood:
   near-certain inside deals.** Mitigations: the legal entity, the design-partner case
   study, scrupulous honesty, and the your-files-stay-yours answer above.
5. **Lean on enterprise distribution** (LPL/Osaic/Cetera bundling ~35k+ advisors'
   platforms). **Likelihood: already happening.** Not winnable head-on; our wedge is
   independent RIAs who choose their own stack.

## Bottom line

The moat is real, and three pieces of it are genuinely structural (no-bot local capture,
BYOK economics, E2EE). But it's a moat of *architecture and positioning*, not of
distribution — and Jump's actual moat (install base, enterprise deals, brand, $80M of
runway) is exactly the kind we lack. **They can't copy our architecture; we can't copy
their distribution.** That asymmetry is the strategic shape of the whole fight, and
sections 5 and 6 are about making our side count before they blur it.
