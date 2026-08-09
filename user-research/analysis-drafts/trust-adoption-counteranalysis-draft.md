# Trust · Adoption · Counter-analysis (skeptic lane)
### Session 2026-07-10, ~116 min · single participant (advisor at 6-person RIA "JBW", founder's wife) · two recordings, no speaker labels

**How to read this file.** Every claim is cited to `[P1/P2 hh:mm:ss]`. P1 = part 1 (`feedback-7-10-26-part1-transcript-raw.md`), P2 = part 2. Because the transcript has no speaker labels, attribution is inferred from content; where a line could be either voice and it matters, I say so. This is the **designated-skeptic** deliverable: its job is to find the evidence *against* the exciting reading, name where the interviewer put words in her mouth, and separate what she actually does at work from what she was reacting to warmly in the moment. Two structural cautions sit over the whole session:

1. **She is not a neutral user.** She is the founder's wife, a prior product collaborator, saw a related session two days earlier (2026-07-08), and repeatedly acts like a co-founder — coaching GTM, offering her alumni/XYPN network, volunteering to recruit interviewees [P2 00:04:31–00:05:24]. She *wants his product to win* and says so [P1 01:33:36]. Warmth is the default state, not a signal.
2. **The interviewer pitches constantly.** He is a product designer who narrates AI theory, supplies benefit framings ("so that it…"), and often states the answer before she does. Many "she loved X" moments are "he described X warmly and she agreed." Those are flagged individually in §4.

---

## 1. TRUST MODEL — what Lantern must do to be trusted

### 1a. The advisor-verification principle (her single hardest trust rule)
The person who was in the meeting must green-light anything derived from it before it moves. This is the most consistent, least-prompted trust position she holds.

- *"it has to go through advisor eyes… to know that that's correct… the advisor and the client in the meeting [are] the only two people"* [P1 00:27:56–00:28:07]. Said in response to a Jameson pitch, but the conviction is hers and she repeats it unprompted.
- On auto-routing meeting content to the planning team: *"I just feel like the planning team would kind of need to know from an actual human who is in the meeting is this all good… is that actually legit"* [P1 00:29:22–00:29:32]. She distrusts machine-to-machine flow specifically because the human context (see §1f "human story") is what the AI can't verify.
- On pushing to the CRM: *"it shouldn't make it to the crm unless… a human has kind of reviewed it… because it may have captured something incorrectly and then we don't want to further that"* [P1 00:20:52–00:21:14].
- Why she distrusts the AI's reading of a meeting: Jump *"comes in thinking that someone's a stranger… like if you were to just overhear someone on the bus… no context for their life"* [P1 00:19:14–00:19:29]. The AI lacks relationship history, so its output is suspect until a human who has that history signs off.

**Design consequence:** the verification gate is not a nice-to-have checkbox — it is the precondition for her trusting *any* write-back or downstream routing. A "one human who was present approves, then it flows" model matches her mental model exactly.

### 1b. Approval, NOT audit-log review — her explicit stated preference
When Jameson offered the two guardrail styles (block-and-ask-approval vs. let-it-act-and-log-for-later-review), she chose approval, and gave the reason:

> *"approval… I'd be more comfortable with that, like can you approve this — versus just it's changing things and it's hoping that I get [around to] review its log of changes. I've got a lot to do then, and that's maybe just one more thing to think about doing."* [P1 00:51:43–00:52:01]

This is a real, load-bearing preference: **an after-the-fact audit log does not earn her trust, because she knows she will never read it.** A blocking approval step does. Note this cuts against any "move fast, everything is reversible/logged" design instinct.

- She also wants the guarantee stated as a hard rule: *"this thing will never change something without asking for your approval"* [P1 00:51:30–00:51:36] — but that framing was supplied by Jameson [P1 00:35:00] and she agreed; treat "never without approval" as *co-authored*, and "I won't read the log" as *purely hers* (stronger evidence).

### 1c. Accuracy as an absolute precondition
Trust collapses to zero on a single visible error. She says this in three different contexts, which is what makes it credible rather than a throwaway:

- *"obviously it needs to be accurate"* — attached to the meeting-detail-capture wish [P1 00:18:35].
- *"it has to be real… the accuracy has to be there, like you can't make mistakes, but once it doesn't [make mistakes] then people are usually… it ends up helping a lot"* [P1 00:54:26–00:54:37].
- Stale data is the same failure as a wrong answer: *"if you were to go visit it and it was out of date, it'd probably decrease trust a lot — like, oh, I can't trust this system"* [P1 01:06:37–01:06:43]. She pre-emptively worries a Client Map *"would be hard to keep up to date"* [P1 01:00:26], meaning **a Map that is ever wrong is worse than no Map.**

### 1d. Citation expectations — mostly his frame, she affirms the precondition
The "every answer is cited, click to source in <1 second" story is **Jameson's pitch** [P1 00:53:46–00:54:12], not something she asked for. What is hers: she agrees accuracy must be real [P1 00:54:30], and independently the umbrella-policy example shows she wants answers grounded in named sources with dates (*"while the file shows one million dollar, we've received email updates that say two million, and these are the dates"* [P1 00:59:49–01:00:04]). So: **the desire for source-grounded, verifiable answers is real and hers; the specific "citation-chip" UX is his and untested.**

### 1e. Fear inventory (each is a concrete "never do this autonomously" boundary)
- **AI deleting / overwriting files:** *"it scares me… what if it gets it wrong or accidentally delete something… or override something or overwrite something that we wanted to keep"* [P1 00:49:11–00:49:22]. This is her top spontaneous fear about read-write ability.
- **Wrong data furthering through systems:** *"we don't want to further that"* [P1 00:21:08] — an error that propagates from meeting → CRM → planning → RightCapital is worse than a local error because it compounds (see §5 "a lot of hands").
- **Full transcript to the client = liability exposure:** *"I don't love the idea of sending a full transcript… you have to be very careful how you say things, you can't guarantee market returns… are you more liable [when] every word is recorded that you said as an advisor?"* [P1 00:26:15–00:27:00]. A raw-transcript-to-client feature is an active fear, not a feature. **Do not build "share the transcript with the client."**
- **1099 to the wrong accountant:** *"us sending tax documents to the wrong place… you run the risk of sending it to the wrong accountant… that's a nail biter for Seattle and I"* [P1 01:21:51–01:23:00]. She wants a *programmatic* client↔accountant link so it "couldn't mess up" [P1 01:23:26].
- **Wrong-Roth-IRA error (a real past mistake):** *"a certain client had two Roth IRAs… I did it on the wrong one… the guy had like nine accounts, it's hard to see them all at once in Schwab"* [P1 01:08:55–01:09:31]. This is the strongest single artifact of the cost of ambiguous data — but note it is **one story, not a frequency claim** (see §4).
- **The overarching emotional fact:** *"we all are living in this horrible fear that we are going to be the one that drops the ball"* [P1 00:43:31]. The product's emotional job is to *reduce dread*, not add a review burden.

### 1f. The internal-vs-client-facing information boundary ("inside scoop")
A distinct trust surface: some information must be captured and searchable *internally* but must **never** appear in anything client-facing.

- *"if we pick up on something — and this happens all the time — like oh, wife feels this way, husband feels this way about an issue… you don't want to broadcast that"* [P1 00:40:27–00:40:44]. Note **"this happens all the time"** — this is a *frequency* claim, so the inside-scoop need is well-evidenced, unlike most of her feature ideas.
- She calls it *"the inside scoop"* [P1 00:40:56] and *"we need the inside scoop too"* [P1 00:41:37]; today it lives as manually-massaged "notables" or Teams messages or pinned Wealthbox notes.
- **Design consequence:** any generated artifact needs a hard internal/external classification, and the internal channel must be searchable at meeting-prep time (*"I want that in wealth box so we can search that for later… as part of meeting prep"* [P1 00:42:30–00:42:43]). Getting this boundary wrong is a client-relationship disaster, not a bug.

### 1g. What the system must NEVER do autonomously (her list, consolidated)
Push to the CRM without human review [P1 00:21:00]; route to the planning team without the in-meeting human's sign-off [P1 00:29:22]; change/overwrite/delete a file without approval [P1 00:49:11, 00:51:30]; send a full transcript to a client [P1 00:26:33]; send tax docs without a verified recipient link [P1 01:23:26]. **Every one of these is an approval-gated action, not an autonomous one.** This is consistent with her §1b preference and is the firmest, most repeated signal in the session.

### 1h. Firm-practice vs. speculative comfort — an honesty split
- **Actual firm practice (high confidence):** advisor confirms notes before they go to the client [P1 00:28:24]; Jump→Wealthbox push is manual and they *choose* to keep it manual [P1 00:22:15]; inside scoop is hand-massaged into notables [P1 00:41:03]; salary/plan changes flow advisor→notes→her→task→Philip [P1 00:39:58–00:40:16].
- **Speculative comfort (low confidence — she's imagining):** that she'd be comfortable with AI-generated internal summaries *if* she could trust them [P1 00:27:51 "to a degree, I'd need to know I could trust it"]; that approval-gated write-back would feel safe [P1 00:51:43]; that track-changes editing "would be nice" [P1 00:50:52]. These are *conditional* acceptances of Jameson's pitches, not observed behavior. Treat as hypotheses to test, not validated demand.

---

## 2. ADOPTION & CHANGE MANAGEMENT

### 2a. Married to the note template — the biggest switching cost, and it's emotional/political, not technical
This is the single most important adoption fact in the session, and it cuts *against* the "we'll replace their workflow" story.

- *"we're married to that note template… the advisors just love the template the way it is. And Seattle has told us, if we could be way more flexible on the template, this could do a lot more work for us — but because we're so married to the notes as we like them…"* [P1 00:24:14–00:24:30]. **Their own ops person (Seattle) already told them the template is what blocks automation, and they refused to change it.**
- They pushed back on Jump for the same thing: *"we just had a meeting with Jump and they're like, no sorry, still can't take your template and turn it into to-dos"* [P1 00:24:30]. A well-funded incumbent could not bend them off the template; a new product should not assume it can either.
- Chris routes *around* the tool entirely to preserve it: *"Chris will sometimes do the notes from scratch, entirely from his memory, versus dealing with the Jump stuff"* [P1 00:30:35–00:30:45].
- The clients are trained on the output: *"clients have now been trained that you get a little to-do list after the meetings… of course, where are my to-dos?"* [P1 00:25:35–00:26:04].

**Implication:** Lantern must *reproduce their exact 3-part template* (client action items / JBW action items / other notables [P1 00:16:53–00:17:10]) as a first-class, faithful output — the thing Jump could not do. "Be more flexible" is a non-starter. The wedge is *fitting their rigidity*, not improving on it.

### 2b. Wealthbox is the firm's operating system — displacement is unlikely and not her call
- Six people, all writing to it their own way: *"six people adding things to wealth box in their own rhyme and reason"* [P1 01:31:52–01:32:01]; *"such an integral part of our software suite"* [P1 01:32:47]. Tasks, workflows, templates, pinned notes, notifications — their whole coordination lives there [P1 01:26:42].
- Cost sensitivity is visible: she has a *"light seat"* on Jump and *"technically doesn't have full access"* [P1 00:44:23–00:44:29]. A 6-person firm buying light seats is price-conscious; a full per-seat replacement of two tools is a real budget event.

### 2c. The meta-pain that a new tool could *become*: "so many places to keep updated"
Her deepest structural complaint is fragmentation: *"we have so many places to keep updated… of everything… that just is like a full-time job"* [P1 01:29:25–01:29:33], and Philip's recurring question *"what's the source of truth on XYZ?"* [P1 01:29:44–01:29:49].

**The skeptic's warning:** a Client Map that must be manually kept current becomes *one more place to update* — the exact pain it claims to solve. She half-sees this herself: *"that would be hard to keep up to date"* [P1 01:00:26] and *"out of date decreases trust"* [P1 01:06:37]. **A Map only reduces this pain if it is auto-derived and never stale; a Map that needs tending makes the pain worse.** This is the central adoption risk for the flagship feature.

### 2d. Replace-vs-coexist — her hope vs. its credibility
- Her hope: *"I've been kind of hoping that you would just replace Wealthbox and combine a lot of softwares into one… if this could replace Wealthbox and Jump, obviously that would be ideal"* [P1 01:33:36–01:33:50].
- **Why to discount it:** (1) it is a spouse-invested wish, prefaced with "I've been *hoping*" — aspiration, not evaluation; (2) it directly contradicts her own married-to-the-template reality (§2a) and Wealthbox-as-OS reality (§2b); (3) she is not the buyer or the decider. Jameson himself lands in the right place: *"I don't think Wealthbox will really be replaceable in the near future; I think Jump could be"* [P1 01:33:11–01:33:16], and she agrees. **The credible near-term play is displacing Jump (meetings/notes/ask) while coexisting with Wealthbox, not replacing the CRM.**

### 2e. Who actually decides at JBW — not her
She repeatedly hands the decision to others and describes them evaluating differently:
- Seattle *"is married to the CRM… would be really good to talk to about CRM-oriented stuff"* [P2 00:04:09–00:04:24] and would want a *browse/categorize/structured* interface, the opposite of what she wants [P2 00:15:21–00:15:32].
- Andy does deep planning and needs recall of life details [P2 00:08:02].
- Jessica (manager) *"wants Wealthbox to unite our team"* — a people/adoption lens [P2 00:08:24–00:08:31].
- She names herself as the empathetic outlier: Jameson tells her *"most people you talk to are more like Seattle or Andy… they give you a slice"* [P2 00:08:38–00:09:01], and she accepts it. **She is explicitly the least representative person in the firm** — high-empathy, generalist, not process-bound. Everything below is filtered through that atypical lens (see §4h).

### 2f. Smallest experience that would prove value to HER role specifically
Her role is client service/ops (scheduling, follow-ups, filing, routing, the "gift person"). The lowest-friction, highest-credibility first win for *her* is **comprehensive cited inquiry across the scattered record** — she pulls for this more than anything else and it needs no workflow change:
- *"being able to search emails would be amazing"* [P1 01:16:18]; today Wealthbox can't keyword-search email or notes written with different words [P1 00:14:38–00:15:00].
- *"think about the source of truth… make inquiries of 'where are we with this' and have an AI give you a summary — I think would be hugely valuable for our firm"* [P2 00:18:21–00:18:48].
- The umbrella-policy "latest and greatest" answer [P1 00:59:03–01:00:04].

This is the one job where the current tools genuinely fail her *and* adoption costs nothing (read-only, no template disruption, no write-back trust problem). **It should be the demo and the wedge.** Note the contrast with the write-back/automation features, which all carry the §1 trust tax.

---

## 3. MENTAL MODELS & LANGUAGE (glossary with timestamps)

### Her natural vocabulary (use these words in the product/positioning)
- **"source of truth"** — her and Philip's central concept [P1 00:01:15 (Jameson), 01:29:44, P2 00:18:21]. The product's job, in her words, is to *be* or *find* the source of truth.
- **"latest and greatest"** — what she wants an answer to surface [P1 00:59:03, 01:30:12]. Pairs with "spill the tea" [P1 01:30:12–01:30:20].
- **"inside scoop"** — internal-only relational context [P1 00:40:56, 00:41:37].
- **"the human story" / "the human element"** — the last-10-minutes discovery an AI summary misses [P1 00:32:52, 00:56:46].
- **"married to the template / the notes / the CRM"** — irreducible attachment to a format [P1 00:24:14; Seattle "married to the CRM" P2 00:04:18].
- **"battery drain" / "battery dinner [drainer]"** — her word for depleting grunt work, esp. follow-ups [P1 00:30:30, P2 00:02:30].
- **"nail biter"** — the 1099 fear [P1 01:23:00].
- **"tentacles"** — compliance ripple: one rule change forces edits everywhere [P1 01:24:08–01:24:22].
- **"a lot of hands"** — the multi-step human relay that breeds error [P1 00:26:22].
- **"notables" / "other notables"** — the catch-all third section of their note template [P1 00:17:10].
- **"light seat"** — a partial/cheaper software seat [P1 00:44:23].
- **"hot client" / "who's the hot client"** — who's consuming the most resource right now [P2 00:13:43–00:13:51].
- **"strike while the iron's hot"** — capture info while the client is engaged [P1 00:12:02].
- **"accumulator / decumulate," "earmark" (cash)** — domain terms she uses fluently [P1 01:03:59, 01:04:24, 01:05:16]; the product should speak this.
- **"AI team member / historian / bridge"** — her own framing suggestions for what the product *is* (see below) [P1 00:47:44–00:48:34].
- **"AI coach"** — her framing for the task-triage idea [P2 00:09:22–00:09:27].
- **"I'm an emoji girl"** — she liked the emoji in the feature map [P1 00:04:03] (minor, but a genuine warmth signal about tone).

### Concepts/product language that CONFUSED her (fix these)
- **"practice"** — read as medical/dental: *"connect your practice… sounds to me like dental practice or medical practice; maybe 'connect your firm'"* [P1 00:04:09–00:04:15]. **Use "firm," not "practice."**
- **"exported from RightCapital / Jump"** — broke her model: *"we don't export documents from RightCapital"*; they screenshot into PowerPoint and copy/paste from Jump [P1 00:05:13–00:06:12]. She feared the wording meant the product *"would count us out from the RightCapital benefits"* [P1 00:05:41]. **Meet the data where it actually is (screenshots, copy/paste, CRM), not "exports."** (This exact confusion also appeared 2026-07-08 — it's a repeat miss.)
- **"the flagship"** — *"I don't know what the flagship means"* [P1 00:09:30].
- **"fill it in together over the phone"** — unclear who's calling whom [P1 00:10:49–00:11:21].
- **"Clio / document systems for law firms / word & outlook add-ins"** — flagged the map as *"less advisor-based and more law-firm based"* [P1 00:08:20–00:08:44]. Jameson conceded it's a mistake; **strip legal-vertical language from advisor-facing surfaces.**

### Her framing suggestions (positioning gold, but note the source)
- **"AI team member / historian / bridge"**: *"I wonder if it should be framed as an AI team member… almost like a person who's a historian… who can recall like crazy… this is meant to bridge a lot of gaps"* [P1 00:47:44–00:48:34]. Note this is *her* language, unprompted — the strongest positioning contribution in the session. But also note it's a spouse who's absorbed his product vision; validate with strangers.
- **"story selling / 'so that it…'"**: she wants benefit-first framing on every feature (from Mitch Anthony's *Story Selling*): *"you're always telling the person what's in it for me… 'plug in the tools your firm already uses, so that it does this thing, so that it helps you'"* [P1 00:07:08–00:07:31]. Concrete copy guidance, and hers.

### What her language implies for positioning — and the near-total absence of compliance
This session **bracketed compliance as pre-approved** [P1 00:06:55–00:07:08], and the result is striking: **the entire "the AI you're actually allowed to use" thesis from the 2026-07-08 session is essentially absent here.** Compliance surfaces only once, and not as a buying gate — as an internal *workflow* pain ("tentacles," auditing systems when a rule changes [P1 01:24:08]). She never says "local," "private," "nothing leaves my machine," or "the AI I'm allowed to use" in a product-desire sense the whole session. Privacy appears exactly once, and only because *Jameson* raised encryption for 1099s [P1 01:23:33].

**What this means (skeptic reading):** the 2026-07-08 "compliance is the wedge / privacy is the headline" conclusion is a **pillar-1 (can-we-use-it) finding, not a pillar-2 (is-it-useful) desire.** Once you tell her she's *allowed* to use it, privacy stops being a reason she *wants* it. Her actual pull is toward **capability** — cited inquiry, source-of-truth, template fidelity, less battery-draining follow-up. So local-first/privacy is a *permission-to-buy* enabler and a trust-hygiene requirement, **but it is not, on this evidence, the thing that makes her want the product.** Leading the value story with privacy risks selling the lock instead of the house. (This is a genuine tension with the prior session's "privacy is the whole sale" headline — see §4.)

---

## 4. COUNTER-ANALYSIS (the core of this lane)

### 4a. Every moment the interviewer led (with confidence adjustment)
Format: `[timestamp]` his framing → what she'd said before → the shift → how much to discount.

1. **Two meeting outputs** `[P1 00:19:54]`. He: *"have you guys ever tried to get Jump to give you two outputs — one in your template and one a normal summary?"* Before: she was describing detail loss. Shift: *"yeah… I think we could try that."* → She had never asked for this; it's his idea she agreed to try. **Discount heavily as demand evidence.**
2. **Multi-output + internal summary + smart task-generation** `[P1 00:27:07–00:27:43]`. Long compound pitch by him. Before: transcript-liability worry. Shift: *"yeah, to a degree — I'd need to know I could trust it."* → Conditional, hedged agreement to his construction. **Medium-heavy discount; the only durable signal is the trust condition, which is hers.**
3. **Colleague-routing/approval of notes** `[P1 00:37:12–00:37:31]`. He: *"would that be helpful, so you don't have to reach out personally?"* — supplied the benefit. She half-agreed then redirected to how they use Philip. **Discount; benefit was his.**
4. **Approval list as the workday** `[P1 00:51:24]`. He: *"what if it was just an approval list — what do you think of something like that?"* She agreed but immediately surfaced the real constraint (won't read a log, §1b). → The *approval-over-log* preference is hers and strong; the *"approval list as your whole day"* product shape is his. **Keep her preference, discount the product shape.**
5. **Cited sources / click-to-source <1s** `[P1 00:53:46–00:54:12]`. Entirely his pitch; she affirmed only "accuracy has to be real." **Citation UX = untested; accuracy precondition = hers.**
6. **Cash-flow / accounts Map** `[P1 01:07:00–01:10:08]`. He: *"I was trying to decide if this is worth building… I'll just go down the path,"* then narrated the entire scenario himself. She followed and elaborated with real examples, but **the "map" artifact framing is his** — see 4b. **Medium discount; her underlying pain (tracking earmarked cash, which bank is for what) is real, the "Map" solution is his.**
7. **"Does this deserve its own map?"** `[P1 01:03:07, 01:07:88]`. He repeatedly offers "a map" as the shape for every pain she raises (insurance, HSA, cash, accounts). She adopts "map" language *after* he supplies it. → **The Client Map as a first-class object is substantially interviewer-introduced, not user-pulled.** This is the most important leading pattern in the session because the Map is the flagship. **Discount the Map-as-artifact demand significantly.**
8. **Track changes / Word redlining** `[P1 00:49:42–00:50:52]`. He explained track-changes at length; she said *"we don't really use Word… I don't know how much we use Word either"* [P1 00:50:39]. Only *after* he built the "fill a template with the client's address for you to approve" scenario did she say *"that sounds like an amazing thing"* [P1 00:50:52–00:51:20]. → **Zero organic pull for Word/redline; the warmth is entirely to his constructed scenario.** Strong discount.
9. **Ask-bar vs. structured system** `[P2 00:14:36–00:15:38]`. He: *"I think I know the answer already as I'm saying this… you'd like more of the open-ended."* She: *"exactly, exactly."* → He stated her answer *before she did* and she confirmed it. **Textbook leading; discount the strength of the preference (though it's plausibly directionally right for her).**
10. **"Real teammate" / agentic project-management** `[P2 00:17:04–00:17:44]`. His pitch about ChatGPT-agents and a "real human teammate." She mostly listened. **His vision, not her demand.**
11. **"Could your firm use a smart assistant?"** `[P2 00:16:36]`. He immediately self-corrects: *"that's not the best question, like 'can you use it.'"* Her *"yeah, of course, I know, I know"* is pure acquiescence and he flags it himself. **No signal.**

### 4b. Features SHE proposed with no frequency/severity evidence (solution-first, self-hedged)
These are brainstorms, and she *labels them as such* — take them as idea-generation, not validated need:
- **Composable-notes checkboxes** [P1 00:35:18–00:36:59]: *"I don't know… almost like… interesting"* — visibly improvising.
- **AI keeps notes by dictation** [P1 01:30:36–01:31:11]: *"I don't even know if this is needed, I'm just going to throw this out there as a brainstorm."*
- **Task-triage coach** [P2 00:10:36–00:12:00]: *"that might sound so stupid, like shouldn't you be able to do that as a functioning adult"* and *"that might just sound like such a dumb feature."*
- **Smart reports / "who's the hot client"** [P2 00:13:43–00:14:14]: *"I don't know what exactly we would do with that, I guess we would probably just try to…"* — no defined use.
- **Manager report on stressed teammates** [P2 00:13:13–00:13:27]: floated, "not in a tattletale way," no evidence it's a felt need.
- **Cash-needs / HSA / insurance maps** [P1 01:02:35–01:10:08]: repeatedly *"I don't know if that's worth building."*

**Skeptic's rule for §4b:** none of these should enter a roadmap on this session alone. They are hypotheses from one atypical user, most of them self-flagged as uncertain.

### 4c. Negative cases and contradictions (the productive tensions)
- **Automation desire vs. verification insistence.** She's excited about time saved [P1 00:55:22] but will not let content move without a human who was present approving it [§1a]. → The product cannot deliver "hands-off" value; every automation must route through an approval, which *reintroduces* work. The value is *better-organized* review, not *eliminated* review.
- **Replace-Wealthbox hope vs. married-to-template/CRM reality.** [P1 01:33:36] vs. [P1 00:24:14, 01:31:52]. She wants consolidation in the abstract but is behaviorally locked to the incumbents.
- **"Would be helpful" vs. "we don't use that Jump feature at all."** She calls Jump's send-to-Wealthbox and workflow-launch features things they *"don't use at all"* [P1 00:23:08–00:23:57] — because they don't fit the template. → A cautionary tale: Jump *built* the automation she's now nodding along to, and JBW ignored it. Building the same thing better isn't enough; it has to fit the template.
- **Proactive reports interest vs. stale-data trust fear.** She likes the idea of auto-published reports [P2 00:15:50] but also says an out-of-date artifact destroys trust [P1 01:06:37]. → Proactive artifacts raise the staleness risk she's most afraid of.
- **She wants the opposite interface from her own teammates.** She wants open-ended ask; Seattle wants structured browse/categorize [P2 00:15:21–00:15:32]. → No single UI satisfies the firm; whatever ships will be wrong for some seats. Adoption is not one decision.

### 4d. Frequency evidence — which pains are actually recurrent
**Well-evidenced (she used "all the time / always / so often"):**
- Inside-scoop capture: *"this happens all the time"* [P1 00:40:34].
- Client reversing a decision in the last 10 minutes: *"that happens like so often, you'd be shocked"* [P1 00:32:05].
- Detail slipping past the template: *"a lot of times stuff slips through the cracks"* [P1 00:20:45]; SOS "where's the kid going to college" messages *"sometimes"* [P1 00:18:50].
- Scheduling follow-ups: a standing 2-follow-up cycle every period [P1 01:13:14].
- Search failing on differently-worded notes: recurring [P1 00:14:45].

**Thin (single anecdote, no frequency):**
- Wrong-Roth-IRA change: one story [P1 01:08:55].
- Umbrella policy update: she notes it happens *rarely* — *"maybe every four years… more likely you just get a policy and stick with it"* [P1 01:40:70–01:53:98 region, i.e. 01:01:40–01:01:53]. **The flagship demo example is, by her own account, a low-frequency event.**
- 1099-to-wrong-accountant: annual, seasonal — real but bounded to tax season.

### 4e. Problems adequately solved today (displacement unlikely)
- **The note template itself.** They *like* it; it *"keeps it clean"* [P1 00:17:22–00:17:28]. This is not a pain to solve; it's a constraint to honor.
- **Manual Jump→Wealthbox push.** They keep it manual *on purpose* and are fine with it [P1 00:22:15]; she explicitly does not want full automation [P1 00:22:49].
- **Inside scoop today.** Pinned Wealthbox note + Teams works well enough socially [P1 00:16:09, 01:07:39]. It's scattered, but functional — the gap is *search/recall*, not *capture*.
- **Cash earmarking.** The investment team already has "some sort of way to do it" [P1 01:05:52–01:06:05]; her pain is *visibility into their system*, not the absence of one.

### 4f. Firm-idiosyncratic vs. likely-general (mark as needs-replication)
**Almost certainly JBW-specific (do NOT generalize from n=1):**
- **Per-client PowerPoint decks with hidden/unhidden categorized slides** and a post-meeting re-hide ritual [P1 01:27:03–01:28:06]. Highly bespoke; likely not how other RIAs work.
- **Their exact 3-part note template** [P1 00:16:53].
- **Their role split** (service rep / planner Philip / ops Seattle / investment team / advisors Andy & Chris) [P1 00:37:52–00:39:16].
- **Light-seat Jump configuration** [P1 00:44:23].

**Plausibly general (but still needs replication):**
- Detail loss between meeting and CRM; fragmented source-of-truth; email un-searchability; scheduling toil; tax-doc-routing fear. These are structural to small RIAs, per her limited cross-firm knowledge — but *her* knowledge of other firms is explicitly thin [P2 00:05:50], and she offered to recruit others (Amanda who serves 4–5 offices; XYPN) precisely because she can't answer for them [P2 00:07:16–00:08:12]. **Everything here is a hypothesis pending the next 3–5 interviews.**

### 4g. What she did NOT ask for that the product strategy assumes matters
Honest listing of strategy-assumed features that got **zero organic pull** this session:
- **The Client Map as a first-class object** — interviewer-introduced (§4a #7); she never requested "a map" before he offered it. **This is the flagship, and it did not surface as a user desire.**
- **Meeting-prep briefs** — she describes prep as ad-hoc Schwab/Wealthbox lookups [P1 00:42:43, 01:04:13] but never asks for a generated pre-meeting brief.
- **Word redlining / track changes** — actively low-use; no pull (§4a #8).
- **"Book view"** — never mentioned.
- **Local-first / privacy as a desire** — never raised by her (§3); only Jameson mentions encryption once.
- **Estate/beneficiary detection** — "beneficiary" appears once in passing [P1 00:19:03]; no feature ask.
- **A dedicated tax-season pack** — the 1099 fear is real but she asks for a *safety link*, not a pack [P1 01:23:04].
- **Word-native / .docx as the artifact format** — she's unsure they even use Word much [P1 00:50:39].

**What she DID pull for, organically and repeatedly:** cited cross-source inquiry / "source of truth" summaries [P2 00:18:21], email search [P1 01:16:18], "latest and greatest" timeline answers [P1 00:59:03], and template-faithful notes [P1 00:24:14]. **The strategy's center of gravity (Map, Word redline, local-first headline) and her center of gravity (Ask across everything, honestly) are not the same place.**

### 4h. Prior-exposure & spouse-investment effects
- *"I've been kind of hoping that you would just replace Wealthbox"* [P1 01:33:36] — a statement of *investment in his success*, not a product evaluation. Weight accordingly.
- She references *"our private conversations"* [P1 00:48:00] and *"you've mentioned since early in the project"* [P2 00:18:48] — she is reacting partly to accumulated context no other user will have.
- She parrots AI theory *he taught her* (weighting, "global workspace scratchpad," "don't think about a spider") [P1 00:33:46–00:34:57] — **this is not participant evidence about the product**; it's his material reflected back.
- She switches into co-founder mode — GTM tactics, gift-card incentives, recruiting via XYPN/alumni [P2 00:04:31–00:05:24]. Valuable as a collaborator; disqualifying as a neutral demand signal.
- Jameson himself names the bias correctly: she's the high-empathy generalist who gives the *fullest* picture but the *least representative* one [P2 00:08:38–00:09:05], and warns he must *"clearly move on and talk to another slice."* **This session is a rich hypothesis generator and a poor validator.**

---

## 5. UX IMPLICATIONS (concrete, bounded)

1. **Composable meeting-notes review** [P1 00:35:18–00:36:59, 00:41:37]. Start from a minimal, high-confidence base note ("things clearly agreed"), then present every additional candidate item as an **include/exclude toggle**, each routable to a destination: client action items, JBW action items, "other notables," an **internal-only "inside scoop" lane** (never client-facing, §1f), and a **push-to-Wealthbox-task** toggle per item. Must render the firm's exact 3-part template (§2a). This is her most detailed, self-generated UI sketch — build it around the template, not around flexibility.
2. **Colleague routing on a note item** [P1 00:37:12–00:39:16]. Any item that would change a plan can be sent to a named colleague (e.g., "send this to Andy → he approves → flows to Philip") — modeling the advisor-verification gate (§1a) as a routing step, not an autonomous push.
3. **Approval-list-as-workday** [P1 00:51:24, P2 00:10:42]. A single surface of pending approvals is plausible, but the durable insight is that **approval must interrupt at decision time** (she won't review a log, §1b). Pair with a **task-triage coach** (§5.6).
4. **Timeline answers with dates** [P1 00:59:49–01:00:04]. For "latest and greatest" questions, answer with a short dated timeline and named sources: *"the file (dated X) shows $1M; emails (dated Y, Z) say it was raised to $2M."* Not a single value, not the full history.
5. **Answer-length calibration** [P1 01:00:04–01:01:25]. The window must adapt to the *question type*: umbrella/insurance → latest + one prior; recurring behavior (annual gifting) → ~3 years so the *pattern* is visible. A fixed truncation ("nothing older than a year") would hide exactly the patterns advisors need. Detect cadence, don't cap by calendar.
6. **Task-triage coach — tone is the risk she named and accepted** [P2 00:11:20–00:11:45]. A coach that resurfaces/re-sorts an overwhelming to-do list ("you can realistically finish 6 of 21 today — which move to later?", "a meeting with this family is coming up, prioritize theirs"). She flagged it could feel **shaming** and still said *"honestly, it would be helpful."* Design for *helpful, not scolding*: framing, opt-in, no red-alert equivalence between "spell this right" and "fraud situation" [P2 00:10:12]. Ship it behind a preference; it is not validated beyond her.
7. **Citation click-to-source** [P1 00:54:04]. His idea, but consistent with her accuracy precondition — every surfaced fact links to its dated source in one click so she can verify before trusting. Speed matters because trust is fragile (§1c).
8. **Internal/external hard boundary in the UI** (§1f). Any generated artifact must show, unmistakably, whether an item is client-facing or internal-only, defaulting sensitive relational content ("wife feels X, husband feels Y") to internal. Getting this visibly right is itself a trust feature.

---

## 6. Skeptic's bottom line
- The **flagship (Client Map)** was interviewer-introduced and rode on his "does this deserve a map?" prompts; it was **not** an organic user desire, and she pre-identified its fatal risk (staleness = trust collapse). Validate it hard before committing.
- The **privacy/local-first headline** from 2026-07-08 did not reappear once compliance was bracketed. On pillar-2 evidence, privacy is *permission to buy*, not *reason to want*. Her want is **cited inquiry / source-of-truth across scattered records** — that is the wedge and the demo.
- **Adoption is gated by the note template and Wealthbox**, both of which a funded incumbent (Jump) already failed to move. Fit their rigidity; don't try to improve it. And she is, by everyone's admission, the least representative person at her own firm — this is a hypothesis-rich session that **must** be replicated with Seattle, Andy, Jessica, and non-related advisors before anything here becomes a bet.
