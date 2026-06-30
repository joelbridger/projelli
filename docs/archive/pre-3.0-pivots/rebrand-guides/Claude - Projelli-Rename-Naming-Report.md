# Renaming Projelli — A Naming & Brand-Identity Report

### Finding an available, ownable name for a local-first AI workspace sold on confidentiality

*Prepared May 2026 · Working naming analysis for Jameson Daines*

---

## 0. How to read this report, and the one hard constraint that shaped it

You asked for new names and logo ideas where **the key requirement is availability** — a free `.com` and a genuinely clear field with no existing brand sitting on it. So before anything else, here is the most important thing I learned, because it determines everything downstream:

**Every clean, real-word `.com` is already gone.** I generated and registry-checked just over **680 candidate domains** across six naming strategies. Of the real English / Latin / concept words — `vellum`, `cairn`, `cloister`, `sanctum`, `vesper`, `sequester`, `tenet`, `enclave`, `haven`, `keep`, `hush`, `quill` and dozens more — **not one** was available on `.com`. They are 100% claimed. In the very first batch of 140 names that included real words, exactly **one** was free (and it was an awkward one). That is not bad luck; that is the structural reality of the `.com` namespace in 2026.

That leaves three honest paths, and this report is built around them:

1. **A coined word on `.com`** — an invented name with a *whisper* of meaning but no dictionary entry and no owner. This is the path that actually yields a clean `.com` *and* a defensible trademark. It's where almost all of my top recommendations live.
2. **A strong real word on a credible alternate TLD** — `.ai`, `.so`, `.app`. Legitimate for software, but I'll be honest about the tradeoffs (and about what I could and couldn't verify).
3. **A descriptive/compound `.com`** — something like a `Priv-` or `Keep-` construction that's available because it's a touch utilitarian.

Every name I recommend was checked at the **registry level (RDAP)**, which is the authoritative source — far more reliable than a DNS ping, because an unregistered domain returns a clean "no such object" straight from the registry operator. I then **web-screened the finalists** for existing software/SaaS brands. I'll flag exactly what's verified and what still needs a human eyeball (mainly `.ai`, whose registry blocks automated checks).

One caveat stated plainly up front: **domain availability is a moving target and trademark clearance is a legal determination.** I verified these on May 26, 2026. Before you commit, re-check at a registrar and run a proper USPTO/TESS + Companies House-style search (or pay a clearance attorney for the one you pick). I am not a lawyer and this is not a clearance opinion — it's a strong, evidence-based shortlist that does the expensive 95% of the filtering for you.

---

## 1. The naming brief: what the name actually has to do

I read all five of your strategy reports (ChatGPT, both Claude reports, both Gemini reports). They disagree on *which* vertical to chase first, but they agree — emphatically and unanimously — on the **product's soul**, and the name has to serve that soul, not a single vertical.

The thesis every report converged on:

> Projelli is **not** an indie-founder tool. It is *the AI workspace for people who legally or temperamentally cannot put their work in the cloud.* Its moat is the combination of **own-it-once + never-trained-on + offline-capable + workspace-aware RAG + wiki-linked knowledge base + a confidentiality-bound profession's trust story.** Every competitor (LM Studio, Jan, AnythingLLM, Msty, Open WebUI) has two or three of those. None has the set.

That positioning generates a precise list of **emotional registers** the name should hit. The best names hit two or three at once:

| Register | What the name should whisper | Why it matters (from your reports) |
|---|---|---|
| **Privacy / discretion** | "Nothing leaks. This is held quietly." | The *Heppner* ruling, IRC §7216, NDA AI-clauses — confidentiality is the entire wedge. |
| **Locality / on-device** | "It lives here, on your machine, not in someone's cloud." | "Files-on-your-machine," the `~/Documents/Projelli/` model, the air-gapped edition. |
| **Ownership / permanence** | "You own this. It's yours, forever, as plain files." | "Own it, don't rent it"; Markdown files you control; no vendor lock-in. |
| **Vault / containment** | "A protected, bounded, sealed space." | "Matter/case/client container," the audit-mode boundary, the strongroom feeling. |
| **Memory / mind / second brain** | "It remembers your whole body of work." | Workspace-aware RAG, wiki-links/backlinks, the "private colleague to think with." |
| **Trust / gravitas** | "Serious, professional, defensible." | The buyers are lawyers, CPAs, deal teams, therapists — they distrust hype, respect precision. |

And the **hard constraints** on the word itself, also drawn from the reports' buyer psychology:

- **Pronounceable and spellable on first hearing.** A CLE-talk audience, a referral whispered partner-to-partner, a CPE webinar — the name travels by *voice* in these markets. If a therapist can't spell it to a colleague, it's dead.
- **Not vertical-locking.** You may lead with CPAs or estate attorneys but expand to therapists, novelists, deal teams. The name can't say "law" or "tax" — it has to hold the whole portfolio. (This is why `behaviorux.com` energy is wrong here; that's your *consulting* brand, a different thing.)
- **Tonally trustworthy, not cute.** "Deal-hunter" SaaS cuteness (extra vowels, dropped letters à la `Flickr`) actively repels the risk-averse professional buyer. Lean classical/sturdy, not startup-quirky.
- **Available, ergo coined.** Per §0.

---

## 2. Methodology — how the shortlist was built and verified

So you can trust the availability claims, here's exactly what I did:

**Generation.** I produced ~680 candidates across six strategies: vault/enclosure metaphors, locality/home metaphors, mind/memory roots, trust/discretion roots, workspace/scriptorium roots, and pure abstract coinages. I deliberately over-generated, because the kill rate on `.com` is brutal and you need volume to find the survivors that are *also* good.

**Availability check (RDAP, registry-authoritative).** I queried each domain against the official RDAP endpoint for its TLD (Verisign for `.com`/`.net`, PIR for `.org`, etc.). A `404 / no such object` from the registry = genuinely unregistered. A returned record = taken. I calibrated the checker against known anchors first: `projelli.com` and `google.com` correctly read **REGISTERED**, a random nonsense string correctly read **AVAILABLE**. The tool works.

**The yield, by strategy (this is the useful part):**

| Strategy | Names checked | `.com` available | Hit rate |
|---|---|---|---|
| Real words + light coinages | 140 | 1 | **0.7%** |
| Genuinely invented words | 133 | 11 | **8%** |
| Euphonic engineered coinages | 134 | 17 | **13%** |
| Concept words (vellum, cairn…) | 121 | 3 | 2.5% |

The lesson is stark and worth internalizing for any future naming you do: **the more "real" the word, the lower the odds. Coined-but-euphonic is the sweet spot** — it reads as a deliberate brand, stays pronounceable, and is actually registrable.

**Brand-collision screening.** For each finalist I web-searched for existing software, SaaS, or app brands on the exact string. I treated a hit as disqualifying only if it was a *product/company in an adjacent space*; I treated near-misses (a person's name, a Latin liturgical term, a dormant social handle, a centuries-old French barn) as acceptable noise.

**What I could NOT verify, stated honestly:**
- **`.ai` domains** — `nic.ai`'s registry blocks automated RDAP/whois, so every `.ai` below is marked "manual check needed." Don't trust any `.ai` claim until you've looked at a registrar.
- **Trademark registration** — I screened for *brand existence*, not *registered marks*. A name can be collision-free on the open web and still have a filed-but-not-yet-indexed USPTO application. Clear your final pick properly.
- **Social handles** — I spot-checked but didn't exhaustively verify @-handle availability on every platform.

---

## 3. The recommendations

I've organized these into three tiers. **Tier 1** is where I'd actually spend your money — names that are available on `.com`, pronounceable, brand-clear, and on-thesis. **Tier 2** are strong alternates with one tradeoff each. **Tier 3** are the "if you're feeling bolder" plays, including the alternate-TLD real words.

Throughout, ✅ = registry-verified available on May 26 2026; ⚠️ = needs your manual confirmation.

---

### TIER 1 — Lead candidates (verified `.com`, recommended)

---

#### ⭐ 1. **Cloisen** — `cloisen.com` ✅

**The hook.** Cloisen is a coinage off *cloister* — the withdrawn, walled, private inner space of a monastery; a place of focused, protected work. It also faintly echoes *enclosed* and *chosen*. The meaning-whisper is exactly right: **a private, bounded place where your work is kept apart from the world** — which is the literal architecture of the product (your files, walled off on your own machine).

**Why it's my #1.** It does the most jobs at once. It hits *privacy*, *containment/vault*, and *quiet focus* simultaneously, while sounding like a real, sturdy, slightly old-world brand — exactly the gravitas a lawyer or CPA trusts. Two clean syllables (CLOY-sen). It is not vertical-locked. And it's genuinely available.

**Availability.** `cloisen.com` ✅ and `cloisen.so` ✅ both verified free. `.ai` ⚠️ needs a manual check.

**Brand clearance.** Clean. Web search surfaces only near-misses in unrelated spaces (CLO the fashion-design software, Cleo the integration platform, Cloem the patent-claim NLP company) — none is "Cloisen," and none is a local-AI or knowledge-workspace product. Low collision risk.

**Watch-outs.** Some people will want to spell it "Cloison" (the French for a partition wall — which is actually *thematically perfect* but a different spelling). Decide your spelling and be consistent. The French resonance is a quiet asset given your dormant German/European-privacy angle.

---

#### ⭐ 2. **Sancten** — `sancten.com` ✅

**The hook.** From *sanctum* / *sanctuary* — your inner sanctum, the one room only you enter. Sancten reads as "the sanctioned, sacred-keeping place." For a tool whose pitch is "the private workspace that never touches a server," the sanctuary metaphor is almost too on-the-nose in the best way.

**Why it's high.** Strong *trust + privacy + refuge* register, and it carries real gravitas without being pompous. It travels beautifully into your faith-community channel (§7E of your expanded report — clergy as a distribution channel) *without* being faith-locked, because "sanctum" is fully secular in tech usage ("inner sanctum"). Clean two syllables (SANK-ten).

**Availability.** `sancten.com` ✅ and `sancten.so` ✅ verified. `.co` and `.ai` ⚠️ unverified.

**Brand clearance.** Clean — results are Latin liturgical references and a dormant social handle, no competing product.

**Watch-outs.** Slightly churchy to some ears; if you intend to lead with the M&A/PE deal-team vertical (the most secular, hard-nosed buyer), Cloisen or Vaulel may seat better in a boardroom. For therapists/clergy/novelists it's superb.

---

#### ⭐ 3. **Vaulel** — `vaulel.com` ✅

**The hook.** A soft coinage off *vault* — the strongroom, the safe-deposit box, the sealed container. Vaulel keeps the unmistakable "vault" reading (security, value held safely) but smooths it into something brandable and ownable rather than the impossible-to-get bare word "vault."

**Why it's here.** The vault metaphor is the single most literal expression of your value proposition ("a protected, bounded space where valuable things are kept and nothing leaks"), and it's the register your most *secular, highest-WTP* buyers — deal teams, patent attorneys, corp-dev — respond to instinctively. VAW-lel, two syllables, easy.

**Availability.** `vaulel.com` ✅ and `vaulel.so` ✅ verified.

**Brand clearance.** Clean — no competing software brand surfaced. (Note: the broader "Vault" space is crowded — HashiCorp Vault, various password vaults — so the *smoothing* into "Vaulel" is doing real defensive work here. Don't drift back toward bare "Vault.")

**Watch-outs.** The double-L-ish ending makes some people pause on spelling ("Vaul-el? Vaulell?"). Test it out loud with 3–4 people before committing. If it spells cleanly for your circle, it's a powerhouse.

---

#### ⭐ 4. **Mnemel** — `mnemel.com` ✅

**The hook.** From *mneme / mnemonic* — the Greek root for memory (Mneme was the muse of memory). Mnemel evokes **the second brain that remembers your whole body of work** — your workspace-aware RAG, your wiki-linked archive, the "private colleague to think out loud with." This is the *memory/mind* register, which none of the other Tier-1 names occupy.

**Why it's here.** It's the most *intellectually* flavored name on the list, which fits the academic/researcher/novelist/therapist end of your market beautifully, and it's distinctive. The silent "M" (NEE-mel or em-NEH-mel) is a double-edged sword — see watch-outs.

**Availability.** `mnemel.com` ✅ and `mnemel.so` ✅ verified.

**Brand clearance.** Clean — only the root "Mneme" (mythology, a moon of Jupiter, Semon's memory concept) appears, no product.

**Watch-outs.** The `mn-` opening is the real risk for a name that has to travel by *voice*. People may not know whether the M is silent. For markets that spread by spoken referral and CPE talks, this is a meaningful friction. I'd rank it slightly below the first three for that reason — but if "the memory tool" is the brand story you love most, it's the truest expression of it. (`Engramel`, below, is the same idea with a friendlier mouthfeel.)

---

#### ⭐ 5. **Cairnith** — `cairnith.com` ✅

**The hook.** A coinage off *cairn* — the stack of stones a traveler builds, by hand, to mark a place and guide those who follow. It's **self-built, durable, local, and yours** — a near-perfect metaphor for a personal knowledge base you assemble file by file and own permanently. The `-ith` ending gives it a sturdy, slightly Celtic/ancient feel.

**Why it's here.** The cairn metaphor is genuinely beautiful and unusually *ownable* as a brand story (you can build an entire visual identity around it — see §5). It hits *ownership + permanence + locality*. Distinctive and memorable.

**Availability.** `cairnith.com` ✅ and `cairnith.so` ✅ verified.

**Brand clearance.** Clean — the bare word "Cairn" is used by others (Cairn Capital in finance; Cairn the outdoor-gear subscription box), which is *exactly why the coined "Cairnith" matters* — it sidesteps those while keeping the metaphor. No "Cairnith" product exists.

**Watch-outs.** Pronunciation of "cairn" itself trips some Americans (it's KAIRN, rhymes with "barn," not "cay-urn"). The metaphor needs one sentence of explanation to land ("a cairn is the stack of stones you build to mark the trail") — but once explained, it's sticky and emotionally resonant. Great for the novelist/genealogist/academic end; needs the explainer.

---

### TIER 2 — Strong alternates (verified `.com`, one tradeoff each)

---

#### 6. **Engramel** — `engramel.com` ✅

From *engram* — the physical trace a memory leaves in the brain. Same "second brain / it remembers everything" story as Mnemel, but **far easier to say** (EN-gram-el). The tradeoff: "engram" carries a faint Dianetics/Scientology association for a small slice of people (it's also legit neuroscience). For most buyers that's invisible. `engramel.com` ✅ and `engramel.so` ✅ verified; brand-clear (only the neuroscience/football-surname roots appear). A very strong, friendlier sibling to Mnemel.

#### 7. **Tacitel** — `tacitel.com` ✅

From *tacit* — understood without being spoken; held quietly; implied trust. A gorgeous, subtle word for a confidentiality product ("what's said here stays unsaid elsewhere"). TASS-it-el. The tradeoff: it's a *quieter* metaphor — sophisticated buyers (lawyers, therapists) will love the subtlety; it may be too understated for a punchy consumer launch. `tacitel.com` ✅ / `tacitel.so` ✅ verified; brand-clear. Punches above its weight for high-end professional verticals.

#### 8. **Cloistel** — `cloistel.com` ✅

A sibling of Cloisen, slightly more lyrical (cloister + a soft `-tel` ending; faint echo of "castle"). Same monastery/walled-private-space metaphor. CLOY-stel. Tradeoff vs. Cloisen: the `-tel` ending reads marginally more "hotel/brand-suffix" and slightly less sturdy. If you love the cloister concept but want a softer landing than Cloisen, this is it. `cloistel.com` ✅ / `cloistel.so` ✅ verified; brand-clear.

#### 9. **Cloistra** — `cloistra.com` ✅

The third cloister variant — more feminine/Latinate `-a` ending, reads as confident and a bit pharmaceutical-grade-serious. CLOY-struh. Same metaphor family. Having **three** registrable variants of the cloister idea (Cloisen / Cloistel / Cloistra) is itself useful: it means the metaphor is wide-open territory you could own completely. `cloistra.com` ✅ / `cloistra.so` ✅ verified; brand-clear.

#### 10. **Haveln** — `haveln.com` ✅

A coinage off *haven* — a safe harbor, a refuge. Warm, human, reassuring (HAV-eln). The *refuge* register, which is softer and more emotional than vault/cloister — well-suited to therapists, clergy, and the "private sounding board that never tells anyone" framing (your §7D). Tradeoff: the `-ln` ending is slightly unusual to spell. `haveln.com` ✅ / `haveln.so` ✅ verified; brand-clear.

---

### TIER 3 — Bolder / situational plays

---

#### 11. **Advisor Prep Hero** — `keepance.com` ✅

Compound coinage: *keep* (to hold safely; also a castle's stronghold) + the `-ance` noun suffix ("keepance" = the act of safekeeping). Plain-spoken, immediately legible, no pronunciation risk at all (KEEP-ance). The tradeoff: it's more *descriptive/utilitarian* than evocative — it tells rather than evokes. That's not bad; for a trust product, plainness reads as honesty (your reports note risk-averse buyers *distrust* over-clever names). If you want zero pronunciation friction and a name that explains itself, this is the safe, sturdy pick. `keepance.com` ✅ / `keepance.so` ✅ verified; brand-clear.

#### 12. **Quiret** — `quiret.com` ✅

From *quiet* (+ a soft `-ret`, faint echo of "secret/quaranta"). Whispers *discretion and calm* — "the quiet place for your work." Short, soft (QUY-ret). Tradeoff: close to the word "quiet," which is a double-edged familiarity (memorable, but one letter from a common word so people may auto-correct it). `quiret.com` ✅ / `quiret.so` ✅ verified.

#### 13. **Sequari** — `sequari.com` ✅

A coinage with a faint echo of *sequester* (the legal term for setting something apart and protecting it — e.g., a sequestered jury, sequestered documents) and *secure*. The "sequester" association is genuinely on-thesis for legal/deal-team buyers. Tradeoff: the meaning-whisper is fainter and it leans abstract/Italian-sounding (se-KWAR-ee). `sequari.com` ✅ / `sequari.so` ✅ verified; brand-clear.

#### 14. **Priveen** — `priveen.com` ✅

A `priv-` (private) coinage. Maximally legible privacy signal (PRIV-een). Tradeoff: `priv-` names are a slightly crowded *texture* (lots of privacy startups reach for it), so it's less distinctive even though *this exact string* is free and brand-clear. Reads as "obviously a privacy product," which is good for instant comprehension, less good for standing out. `priveen.com` ✅ / `priveen.so` ✅ verified; only a personal name surfaced in search, no product.

#### 15. **Vaultessa** — `vaultessa.com` ✅

Vault + `-essa` (a warm, almost personified ending — like a name). Reads as "your vault, personified" — friendly strongroom. Tradeoff: the `-essa` ending tips slightly consumer/feminine-brand and away from boardroom-sober, so it's better if you lead with novelists/therapists than with M&A. `vaultessa.com` ✅ verified; brand-clear.

#### 16. The **alternate-TLD real-word** play — `.so` and `.ai`

If you'd rather have a *real word* than a coinage and will accept a non-`.com`, these real words are **verified available on `.so`** (a clean, short, increasingly-accepted TLD for software — it literally abbreviates "software"):

- **`cloister.so`** ✅ — the real word, the full metaphor, no coinage needed.
- **`reliquary.so`** ✅ — a vessel that holds something precious and protected. Beautiful, if a touch ornate.
- **`scriptorium.so`** ✅ — the medieval room where manuscripts were written and kept. *Extremely* on-thesis for a writing/document workspace; long but distinctive.
- **`inkwell.so`** ✅ — writing, classic, warm.
- **`mnemo.so`** ✅ — the clean memory root.
- **`custody.so`** ✅ / **`privvy.so`** ✅ / **`onhand.so`** ✅ / **`homestead.so`** ✅ — various trust/locality reals.

**The tradeoff is real and you should weigh it honestly:** a non-`.com` costs you a little trust with the *least* technical buyers (a 65-year-old estate attorney may distrust a `.so` link), and you'll forever be correcting people who type `.com` out of habit — possibly *to a competitor* if someone parks the `.com`. For a trust-first product, I lean toward owning the `.com` outright via a coinage. But if a perfect real word matters more to you than the TLD, `.so` is the cleanest available option, and `cloister.so` in particular is excellent. **`.ai` real words (`cloister.ai`, `vault.ai`, etc.) I could not verify** — check manually; most desirable `.ai` reals are taken and expensive.

---

## 4. The shortlist at a glance

| # | Name | `.com` | `.so` | Register hit | Pronounce risk | Brand-clear | Best for |
|---|---|---|---|---|---|---|---|
| 1 | **Cloisen** | ✅ | ✅ | Privacy + vault + focus | Low | Clean | **All-rounder; my pick** |
| 2 | **Sancten** | ✅ | ✅ | Refuge + trust | Low | Clean | Therapists, clergy, writers |
| 3 | **Vaulel** | ✅ | ✅ | Vault + security | Low-Med | Clean | Deal teams, IP/patent, CPA |
| 4 | **Mnemel** | ✅ | ✅ | Memory / second brain | **Med-High** | Clean | Academics, researchers |
| 5 | **Cairnith** | ✅ | ✅ | Ownership + permanence | Med (needs explainer) | Clean | Novelists, genealogists |
| 6 | Engramel | ✅ | ✅ | Memory (friendlier) | Low-Med | Clean | Same as Mnemel, easier |
| 7 | Tacitel | ✅ | ✅ | Tacit / discretion | Low | Clean | High-end legal/therapy |
| 8 | Cloistel | ✅ | ✅ | Cloister (lyrical) | Low | Clean | Soft alt to Cloisen |
| 9 | Cloistra | ✅ | ✅ | Cloister (serious) | Low | Clean | Serious alt to Cloisen |
| 10 | Haveln | ✅ | ✅ | Refuge (warm) | Med | Clean | Therapists, solos |
| 11 | Advisor Prep Hero | ✅ | ✅ | Safekeeping (plain) | **None** | Clean | Zero-friction safe pick |
| 12 | Quiret | ✅ | ✅ | Quiet / discretion | Low-Med | Clean | Discretion-forward |
| 13 | Sequari | ✅ | ✅ | Sequester / secure | Med | Clean | Legal/abstract |
| 14 | Priveen | ✅ | ✅ | Privacy (overt) | Low | Clean | Instant comprehension |
| 15 | Vaultessa | ✅ | ✅ | Vault (warm) | Low | Clean | Consumer-leaning verticals |
| — | cloister.so | (taken) | ✅ | Real-word metaphor | Low | — | If you want a real word |

---

## 5. Logo & visual identity directions

A name and a mark should be designed together — the strongest of these names already *contain* their logo. Here are concrete directions, mapped to the top candidates. (These are art-direction briefs you can hand to a designer or prototype yourself; I'd recommend mocking the top 2–3 before you finalize the name, because seeing the mark often breaks a tie.)

**For Cloisen / Cloistel / Cloistra — the cloister system.**
The visual language writes itself: a **cloister arch** or a **single rounded archway** as the icon. Simplify a Romanesque arch to its purest geometric form — a square with a semicircle on top, or a keyhole shape (which doubles as a *privacy/lock* signal — a lovely double meaning). Even cleaner: an enclosed courtyard rendered as a simple **square frame with an inner square** (a walled garden seen from above), which also reads as a "container/workspace." Palette: deep slate or ink-blue + warm stone/parchment neutral + a single restrained accent. Type: a humanist serif or a sturdy geometric sans with slightly classical proportions (think Tiempos, Freight, or GT Sectra for serif gravitas; or a clean grotesque like Söhne for a more modern read). Avoid anything that looks like a generic "AI sparkle." The whole point is *calm, sturdy, trustworthy, timeless* — the opposite of cloud-AI's purple-gradient sparkle aesthetic.

**For Vaulel / Vaultessa — the vault system.**
Icon: an abstracted **vault door** (a circle with radial lines / a simplified dial), or — more elegant — a **keyhole formed from negative space** inside a rounded square. Or the cleanest: a simple **closed bracket pair `[ ]`** or a **bounded square** suggesting "everything inside this boundary stays inside" — which also nods to your Markdown `[[wiki-links]]` and the "matter container" primitive your reports recommend. Palette: graphite/steel + a single confident accent (deep green = "safe/go," or brass/gold = "valuable/strongroom"). Type: confident, slightly condensed sans for a "secure infrastructure" feel.

**For Mnemel / Engramel — the memory system.**
Icon: an abstracted **node graph** (3–5 dots connected by lines) — which literally depicts your wiki-links/backlinks and "second brain," and is instantly legible as "connected knowledge." Or a **spiral / concentric arcs** (memory, recall, depth). Keep it minimal — two or three nodes, not a busy network. Palette: ink + a warm recall-accent (amber/ochre reads as "memory/old paper"). Type: an intellectual serif or a clean sans with a literary feel.

**For Cairnith — the cairn system.**
This is the most *distinctive and brandable* visual of the lot, and a real argument for the name. Icon: **three or four stacked stones**, balanced — minimalist, geometric, instantly recognizable, and rich with meaning (you build it yourself, stone by stone; it's local; it endures; it guides others). It scales perfectly from favicon to billboard. It's warm and human in a category full of cold tech marks. Palette: natural stone greys + moss/slate-green + warm sand. Type: a sturdy humanist serif. **If you want a logo that's an asset rather than an afterthought, Cairnith is the strongest pick on that single axis.**

**For Sancten / Haveln — the refuge system.**
Icon: a simple **roofline/gable** (shelter), an **arch over a dot** (a sanctuary niche), or a **rounded enclosure with an opening** (a haven you can enter). Warmer palette — terracotta, deep teal, warm cream. Type: humanist, approachable, trustworthy.

A general principle for all of them, straight from your buyer psychology: **design for the managing partner / compliance officer / 60-year-old estate attorney, not for Product Hunt.** Restrained, classical, sturdy, calm. The mark should make a risk-averse professional feel "this is a serious tool built by serious people," not "this is a trendy AI startup." That restraint *is* the differentiation in a category drowning in sparkle-gradient sameness.

---

## 6. My recommendation, stated plainly

You said you value directness over hedging, so here it is.

**Lead with Cloisen (`cloisen.com`).** It is the single best balance of everything that matters: it's available on the `.com` you require, it's brand-clear, it's easy to say and spell, it carries privacy + vault + quiet-focus in one word, it's not locked to any vertical, it has gravitas without pomposity, and it comes with a ready-made, beautiful visual identity (the arch / walled garden / keyhole). It will seat equally well in a CPE webinar for tax preparers, on an estate attorney's referral, in a novelist's Discord, and in a deal-team's procurement review. That cross-vertical durability matters enormously given that your five reports can't agree on which vertical you'll actually lead with — Cloisen doesn't force that bet.

**Hold Vaulel and Sancten as the two finalists to mock up against it.** Vaulel if you end up leading with the hard-nosed, highest-WTP secular buyers (M&A/PE, patent attorneys, CPAs) where "vault" is the instinctive trust word. Sancten if you lead with the warmer, trust-and-relationship verticals (therapists, clergy, novelists) and want to leverage your faith-community distribution channel.

**If logo-strength is your top priority, seriously consider Cairnith** — the stacked-stones mark is the most ownable and meaningful visual on the list, and the "build it yourself, stone by stone, it's yours and it endures" story is a *gift* for the novelist/genealogist/academic markets. Its only cost is the one-sentence pronunciation explainer.

**Before you commit to any of them, do three cheap things:**
1. **Re-verify the `.com` at a registrar and register it the same day** you decide — availability is volatile and a good coined name can vanish in a week. Grab the `.so` and (after manual check) the `.ai` as defensive holds.
2. **Say it out loud to 5 people in your actual target market** and have them spell it back without seeing it. The name that survives this test wins. (This single test will likely settle Cloisen vs. Vaulel vs. Mnemel for you.)
3. **Run a real trademark clearance** (USPTO TESS at minimum; ideally an attorney for the finalist) before you print anything. My web-screen found no collisions, but that is not legal clearance.

---

## 7. Appendix — the full verified-available pool

Every domain below was confirmed **available at the registry level on May 26, 2026**. Use this as your backup menu if a top pick gets taken or fails your out-loud test. (`.so` siblings of most of these are also available; check at point of purchase.)

**Verified-available `.com` coinages (the full survivor list):**
`cloisen` · `cloistel` · `cloistra` · `sancten` · `vaulel` · `vaultessa` · `mnemel` · `engramel` · `cairnith` · `tacitel` · `haveln` · `keepance` · `quiret` · `sequari` · `priveen` · `recollio` · `privwork` · `closque` · `coveling` · `hearthel` · `pridenza` · `burrowa` · `keepyx` · `onkeepa` · `onlokal` · `privka` · `privko` · `privnu` · `privomi` · `privaultio` · `cifrel` · `cipherel` · `cloisa` · `cloisara` · `hushis`

**Verified-available real words on `.so`:**
`cloister.so` · `reliquary.so` · `scriptorium.so` · `inkwell.so` · `mnemo.so` · `custody.so` · `privvy.so` · `onhand.so` · `homestead.so` · `sequester.so`

**Needs your manual check (could not verify here):** all `.ai` domains; all `.co` domains (the `.co` registry endpoint was intermittently unreachable during testing).

---

*A closing note on confidence and its limits.* I'm highly confident in the `.com` and `.so` availability (registry-level RDAP, re-verified). I'm confident in the brand-collision screening for the Tier-1 names (active web search, no adjacent products found). I'm **not** offering a trademark clearance opinion, and `.ai`/`.co` availability is genuinely unverified — treat those as leads, not facts. The single highest-leverage thing you can do next is the out-loud spelling test in §6, because availability gets you a domain but *spellability* gets you word-of-mouth, and word-of-mouth in dense professional communities is the entire distribution thesis of your five reports.

*— End of report —*
