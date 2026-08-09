# Advisor Workflow Model & Jobs-to-be-Done — 2026-07-10 session

**Source:** two recordings, 2026-07-10, ~116 min total. Participant is a practicing financial
advisor (client-service/ops role) at JBW, a ~6-person RIA, and is the founder's wife. The other
voice throughout is Jameson (founder), who spends much of the session walking her through a
feature map and pitching hypothetical capabilities. No speaker labels exist in the raw transcript;
all attribution below is inferred from content. **Evidence tiering used throughout:**

- 🟢 **Strong** — she describes something she or her team actually does, has done, or a real
  incident that happened.
- 🟡 **Weak/reactive** — she is reacting to or agreeing with a solution Jameson just pitched. Useful
  as a directional signal (what resonates), not proof of a validated need.

Citations are `[P1 hh:mm:ss]` (part 1, `feedback-7-10-26-part1-transcript-raw.md`) or
`[P2 hh:mm:ss]` (part 2). Timestamp = start of the cited transcript segment. Cast: **Andy** and
**Chris** (advisors), **participant** (client service/ops, the context-holder), **Seattle**
(ops/CRM, process-oriented), **Philip** (planning), **Jessica** (manager). Tools: **Jump** (AI
meeting notetaker), **Wealthbox** (CRM), **RightCapital** (planning software), **Schwab**
(custodian), **Calendly**, **JotForm**, **Outlook**, **Teams**, **OneDrive**, per-client
**PowerPoint decks**.

---

## 1. End-to-end workflow reconstruction

### 1.1 Client acquisition / onboarding
- New clients get a **JotForm** for a cash-flow intake, used "the most when someone's new" —
  rare after the first year 🟢 `[P1 01:16:03]`.
- She is often not part of the earliest conversations a client has before joining (a "service
  representative" role handles that phase) — she has to catch up on what was already promised,
  which drives her fear of "asking a question that gives off the vibe we didn't communicate as a
  team" 🟢 `[P1 00:12:27]`.
- Documents currently get filed into the right folder **by a human**, with a delay — she reacted
  very positively to the idea of self-filing documents specifically because that delay is real
  today 🟢 (pain) / 🟡 (solution reaction) `[P1 00:08:52]`.
- She flagged the feature-map's inclusion of legal/law-firm connectors (Clio, "document systems for
  law firms") as a mismatch for an advisor-only product 🟢 `[P1 00:08:13]`.

### 1.2 Meeting scheduling (annual cycle)
This is one of the most concretely evidenced workflows in the session, all 🟢:
- Ideally, the next meeting gets booked **verbally, live, during the current meeting**, like "at
  the dentist" — but advisors "don't really love doing that" on Calendly in front of the client
  `[P1 01:12:08]`.
- When it doesn't happen live, it falls to her: she pulls the client list, determines who hasn't
  scheduled for the year, and emails them `[P1 01:12:08]`.
- **Calendly has hard rules** (e.g., won't allow back-to-back bookings without a 30-minute buffer),
  so about **40% of the time** she has to book manually in Outlook, inviting advisor + client
  herself `[P1 01:12:46]`.
- Follow-up cascade: **two automated-ish follow-ups** sent by her; if still no response, she
  escalates to the advisor, who may do a third follow-up or say "let it go until next time"
  `[P1 01:13:14]`.
- Picking the *correct* Calendly link to send requires knowing: (a) which advisor owns the
  relationship (checked in Wealthbox if not known from memory), (b) whether the couple prefers to
  meet with both advisors together (needs the combined link), and (c) which **service tier** the
  client is on — e.g. investment-management-only clients meet once a year in spring vs. other
  tiers with different cadences `[P1 01:13:56]`.
- Explicit wish: a system that tracks "how long since this person's last meeting," auto-flags who's
  due, and lets her approve a batch send with one click 🟢(pain)/🟡(solution) `[P1 01:13:14]`.

### 1.3 Meeting prep
- She recalls client context from **Wealthbox**, but search is keyword-literal and brittle: if a
  detail was written as "retirement account at JP Morgan" and she later searches "401k," it won't
  surface 🟢 `[P1 00:14:16]`.
- Wealthbox's own AI tab exists but "isn't really that advanced," and **can't search email by
  keyword** at all (only lists emails chronologically) 🟢 `[P1 00:15:00]`.
- **Per-client PowerPoint decks** are central to prep: every client has one deck with always-visible
  slides (cover, agenda, investment-report screenshot, one-page financial-plan summary) plus a
  library of **hidden, categorized slides** (cash flow, estate, investment, insurance, tax
  planning). Before a meeting she pulls the relevant hidden slides into view (e.g., "next time
  we're doing estate" → unhide estate slides) and tasks **Philip** to make sure those specific
  slides are updated before the meeting `[P1 01:27:03]`. After the meeting, slides get re-hidden
  and re-filed. She called this deck **"a gold mine" for an AI client map** and said "client
  meetings are like the heart of our business" 🟢 `[P1 01:27:23, 01:28:24]`.
- She also checks **Schwab directly** for cash-position/savings-rate info as prep for cash-story
  conversations 🟢 `[P1 01:03:59]`.
- Cash/account tracking that supports prep is informal: the investment team marks earmarked cash
  in a money-market fund manually, and account-purpose (e.g., "this Wells Fargo account is their
  rental property account") lives in a **Wealthbox internal note pinned to the top of the record**
  so it "can't disappear" 🟢 `[P1 01:07:34]`.

### 1.4 The meeting itself
- **Jump** records and transcribes the meeting and auto-generates notes into their exact custom
  3-part template (client action items / JBW action items / other notables) 🟢 `[P1 00:16:33]`.
- **"Human story" pattern**: real financial-planning conversations often *reverse* in the final
  minutes — a client states an assumption early (e.g., a salary/retirement plan) and by the last
  ~10 minutes has changed their mind entirely; she called this "what is so valuable about these
  conversations... honestly, the last 10 minutes," and said "humans do not fit in their box" 🟢
  `[P1 00:31:02, 00:32:16]`. This is presented as a reason AI note summarization alone is
  insufficient — a human must review for narrative arc, not just extract facts.
- Work-phone convention: advisors are trained to have clients call them on **work lines** (not
  personal cell) specifically so Jump can capture the call — but this only "half and half" happens
  in practice, and **inbound calls are not automatically recorded**; someone has to manually add
  Jump mid-call, and Jump then announces "your call is being recorded," which is awkward 🟢
  `[P1 00:44:28, 00:44:51]`.
- She personally has a **"light seat"** in Jump — reduced access, not everything she does is
  recorded 🟢 `[P1 00:45:16]`.

### 1.5 Post-meeting notes
- Jump's fixed 3-part template is deliberately simple and the firm is **"married to that note
  template"** — advisors love it as-is 🟢 `[P1 00:24:04]`.
- Detail loss is real and acknowledged: anything that doesn't rise to "other notable" status simply
  doesn't make it into the CRM-facing notes, even though it exists in the raw Jump transcript —
  example given: a client's kid's college plans, or which sport they play, mentioned once and never
  captured, later needed via "SOS" messages between teammates ("hey, do you remember where
  so-and-so's kid is going to college?") 🟢 `[P1 00:18:21, 00:18:50]`.
- **Format breakage** happens: Jump updates sometimes "mess up" the notes format, and when that
  happens **Chris will write notes entirely from memory/scratch** rather than fight with Jump —
  described as a major "battery drain" 🟢 `[P1 00:30:19]`.
- **Advisor verification is non-negotiable**: the advisor confirms notes before they go out to the
  client; anything extra she wants (like "was it Auburn?") she either asks the advisor directly or
  digs through the transcript herself 🟢 `[P1 00:28:17]`.
- Jump *can* generate a supplementary "big data sheet" capturing every number mentioned (for the
  planning team), but this is only occasionally used, and even that requires advisor review because
  Jump "doesn't really know the clients" — she compared it to "overhearing someone on the bus,"
  noting it frequently misspells names and lacks context 🟢 `[P1 00:20:02, 00:21:01]`.
- **Notes are legally/socially public** (sent to the client), so sensitive relational dynamics (e.g.
  "wife feels this way, husband feels that way about an issue") must be "massaged" tastefully into
  the notables, never stated directly — this happens "all the time" 🟢 `[P1 00:40:24]`.
- The **"inside scoop"** — non-actionable-but-important color (e.g. "I was almost in a fight with
  so-and-so") — is currently NOT captured by the Jump template at all. It travels informally via
  **Teams messages** or verbal recall, and the team is "really trying" to get people to instead put
  it in a Wealthbox note 🟢 `[P1 00:40:44, 00:41:03]`. She explicitly wants this internal, searchable,
  advisor-reviewed, but says it should be **saved, not broadcast to the whole team** — no alert 🟢
  `[P1 00:42:29, 00:42:50]`.

### 1.6 Notes → CRM → tasks flow
Full chain as she described it, in order 🟢 `[P1 00:39:23–00:40:16]`:
1. Advisor has the meeting and signs off on the final client-facing notes (the "final source of
   truth for the meeting").
2. She reads the notes and manually converts relevant items into **Wealthbox tasks**.
3. She **assigns tasks to Philip** (planning) when a plan-affecting fact changed (e.g., new
   salary), typically as a brain-dumped task rather than a structured field update — "he gets to
   choose how to put it all into a plan."
4. Philip makes the actual change in RightCapital.
- Her own summary of this: **"it's a lot of hands."** She said it herself, unprompted 🟢
  `[P1 00:40:16]`.
- **Jump's direct "send to Wealthbox" feature is barely used** because Jump cannot parse their
  custom note template into correctly-typed tasks — it only gives "its best guess" from raw notes,
  which isn't good enough 🟢 `[P1 00:23:01, 00:23:26]`. She confirmed Jump itself told them, in a
  recent meeting, "still can't take your template and turn it into to-dos" 🟢 `[P1 00:24:34]`.
- She explicitly does **not** want full end-to-end automation here — she wants a human-approval gate
  before anything writes to Wealthbox 🟢 `[P1 00:22:34, 00:27:51]`.

### 1.7 Planning updates
- Philip gets a Wealthbox task any time a client plan detail changes — this is described as
  primarily a **tracking/audit mechanism** for what's changing in a plan, not a rich workflow 🟢
  `[P1 00:39:13]`.
- She deliberately avoids touching RightCapital or planning slides herself, framing this as
  respecting Philip's domain: "I'm not going to touch your software... that is how I'm respecting
  you" 🟢 `[P1 00:38:03]`.
- **Source-of-truth confusion is named explicitly and repeatedly** as one of Philip's biggest
  recurring frustrations since he was hired: "I'm trying to figure out what the source of truth is
  on XYZ thing... is it what lives in OneDrive... is it a scavenger hunt in Wealthbox" 🟢
  `[P1 01:29:33]`.

### 1.8 Team communication
- **Teams vs. Wealthbox split**: Teams is used for fast informal color ("hey I just met with this
  person, keep in mind X") and sometimes "holds more color" than Wealthbox notes; a note is also
  often left in Wealthbox with a notification blast to the whole team 🟢 `[P1 00:16:09]`.
- She explicitly names this as a **technical/reporting problem, not just an inconvenience**: "it's
  kind of a disaster in terms of accurate reporting and memory and history" when important info
  only lives in Teams chat 🟢 `[P1 00:43:03]`.
- **"SOS" messages** between teammates ("does anyone remember...") are a recurring symptom of
  information not making it into a durable, searchable system 🟢 `[P1 00:18:50]`.
- She names a persistent emotional cost: **"we are all living in this horrible fear that we are
  going to be the one that drops the ball"** — a direct quote about the stakes of information
  fragmentation 🟢 `[P1 00:44:03]`.

### 1.9 Document handling
- Client documents (e.g. an umbrella insurance policy) are saved to **OneDrive**. Clients are
  supposed to send updated documents when things change (e.g. a policy increase from $1M to $2M)
  but frequently don't — "it's just a pain" for them 🟢 `[P1 00:57:37]`.
- She said she "really doesn't like" reaching out to ask clients to upload items to a portal, or
  reaching out to a client's **accountant to request tax returns** — "I hate... I feel like I'm
  bothering people" 🟢 `[P1 01:17:04]`.
- **1099 documents**: downloaded from Schwab and emailed to the client's accountant, containing
  full name, address, SSN, and Schwab account number. This is called out by name as **"a nail
  biter for Seattle and I"** — real fear of sending to the wrong or a stale accountant. The firm
  already pulled back a prior practice of blanket-sending 1099s to reduce this risk 🟢
  `[P1 01:21:41]`.

### 1.10 Ongoing monitoring / task triage
- Wealthbox's task list is **not prioritization-aware in practice**: high/medium/low priority
  fields exist but "for the most part things are showing up like they take equal amount of space"
  — a spelling correction and an active fraud situation visually look the same once overdue (red)
  🟢 `[P2 00:09:57, 00:10:12]`.
- Overdue tasks "all turn red" and create a "stressful environment" 🟢 `[P2 00:09:38]`.
- She and **Andy** ("we house so much context within ourselves... a fingerprint on what's
  reasonable") are described as the org's informal triage judgment — this judgment is **not
  captured anywhere**; Seattle explicitly lacks it ("she has no idea if [a deadline] can be
  shifted or not") 🟢 `[P2 00:12:07, 00:12:23]`.
- Andy and she absorb a large volume of informal "consult on a bazillion things" requests that
  **never generate a Wealthbox task at all** — invisible workload 🟢 `[P2 00:12:52]`.

### 1.11 Workflow/process management in Wealthbox
- Advisors frequently don't know the correct task-template name for a routine action (e.g.
  "open an account," "move money"), so they create a blank/ad hoc task instead of triggering the
  right workflow. Seattle (or the participant) then has to manually transcribe that ad hoc task
  into the correct workflow template and close out the original — duplicated effort 🟢
  `[P1 01:20:03, 01:20:47]`.
- **Template changes don't propagate to already-open workflow instances.** If a post-meeting
  workflow template is edited, the ~40 already-open post-meeting workflows for various clients
  keep the old steps — people can silently miss a newly-added requirement 🟢 `[P1 01:25:36]`. This
  is the single most concrete, structurally-described Wealthbox defect in the whole session.
- **Role reassignment "tentacles"**: if responsibility for a task type shifts to a new person (e.g.
  Seattle takes over X), nothing automatically finds and updates every workflow-step/template
  assignment that should now point to her — she has to hunt them down herself 🟢
  `[P1 01:25:12]`.
- Compliance "tentacles" are structurally identical: a single compliance rule change requires a
  full manual audit across systems/files to find every place it might apply, with no tooling
  support today (their outside compliance consultant "just gets on calls") 🟢 `[P1 01:23:53]`.

---

## 2. Where information lives — the map

| Information | Primary home | Secondary/scattered locations | Search method | Recency signal |
|---|---|---|---|---|
| Client facts confirmed in a meeting | Wealthbox notes (via Jump template) | Jump raw transcript (rarely revisited) | Wealthbox keyword search (brittle — exact-phrase dependent) 🟢`[P1 00:14:16]` | Notes = "final source of truth" once advisor signs off 🟢`[P1 00:39:55]` |
| Actionable follow-ups | Wealthbox tasks | — | Task list / assignee | Due date (not judgment-weighted) 🟢`[P2 00:09:57]` |
| "Inside scoop" / relational color | People's heads; sometimes Teams | Sometimes a manual Wealthbox note if someone remembers to add it | None systematic — "SOS" asking around 🟢`[P1 00:18:50]` | None — often lost |
| Account-purpose context (e.g. "this account = rental property") | Wealthbox pinned internal note | — | Manual pin-to-top so "it can't disappear" 🟢`[P1 01:07:39]` | N/A, static |
| Client-facing meeting materials, categorized topic slides | Per-client PowerPoint deck (hidden/shown slide sections) | — | Manual — she knows the deck structure | Updated ad hoc per meeting via task to Philip 🟢`[P1 01:27:03]` |
| Cash position / account balances | Schwab (source system) | — | Direct Schwab lookup 🟢`[P1 01:03:59]` | Real-time in Schwab, but "latest and greatest" often isn't reflected elsewhere |
| Planning numbers / projections | RightCapital | Slides (summary), Wealthbox tasks (change requests) | Ask Philip | Philip's own complaint: no clear source of truth 🟢`[P1 01:29:33]` |
| Source documents (policies, statements) | OneDrive | — | Manual folder browsing (file self-organizes today via human filing) | Dated by upload, not necessarily current |
| Email correspondence | Outlook | — | **Cannot be searched by keyword at all** in Wealthbox's email view 🟢`[P1 00:15:00]` | N/A |
| Team-only urgent updates | Teams messages | — | Not searchable/durable — explicitly called "kind of a disaster" for history 🟢`[P1 00:43:03]` | Ephemeral |
| Compliance rules & their downstream implications | Outside compliance consultant's head; ad hoc audits | — | None — full manual sweep needed on each change 🟢`[P1 01:23:53]` | No system of record |

**Conflicts observed:**
- Notes (client-facing, sanitized) vs. transcript (complete, unfiltered) vs. Teams (informal,
  emotionally honest but undurable) — three parallel records of the same meeting with different
  audiences and different completeness, and no single reconciled version 🟢.
- OneDrive file vs. later email update vs. verbal meeting mention — three possible "current" values
  for the same fact (the umbrella-policy example is the clearest case) 🟢 `[P1 00:57:37]`.
- Wealthbox task template vs. an already-open instance of that template — the same workflow can be
  "current" in the template and "stale" in dozens of live instances simultaneously 🟢
  `[P1 01:25:36]`.

**What must never be exposed:** internal "inside scoop" / relational color is explicitly
client-invisible — it must be "massaged" before anything client-facing goes out, and even
internally she does not want it broadcast to the whole team, only saved and findable by the people
who need it for meeting prep 🟢 `[P1 00:40:24, 00:42:29]`. Sensitive documents (1099s with SSN/
account numbers) require correct-recipient guarantees, not just correct content 🟢
`[P1 01:21:41]`.

**Structured vs. unstructured:** Wealthbox tasks/workflows are the structured layer; Wealthbox
notes, Teams messages, and Jump transcripts are unstructured; the PowerPoint deck is a hybrid
(structured slide categories, unstructured content). She is fluent in browsing structured systems
but personally prefers **ask-and-get** over browse-a-structured-report (contrasted directly against
her prediction that Seattle, who is process-oriented, would prefer the structured/browsable
system) 🟡 `[P2 00:15:03–00:16:44]` (her own framing of the ask-vs-structured tradeoff is a direct
answer to a hypothetical, so treat the persona-contrast insight — not the specific preference — as
the sturdier part of this claim).

---

## 3. Jobs to be done

Ordered roughly by how much direct evidence supports each; all are hers unless noted.

**Functional**

1. **Latest-and-greatest recall.** *When a client fact might have changed since it was last
   recorded (an insurance amount, a benefit election, an account balance), I want to ask one
   question and get the current, dated answer instead of manually cross-checking OneDrive, email,
   and meeting notes, so I can trust what I tell the client without a scavenger hunt.* Strongest
   direct evidence in the session — the umbrella-policy and HSA examples were her own, stated as
   live problems, not reactions to a pitch 🟢 `[P1 00:58:44, 01:02:41]`.
2. **Never ask a client the same question twice.** *When a client has already told JBW something
   (in any channel, to any teammate), I want that fact to be findable before I talk to them, so I
   never make them repeat themselves and look like we don't know or care about them.* She named
   this unprompted and called it something she "loves" as a design principle, tying it directly to
   the "doctor's office" credibility failure mode 🟢 `[P1 00:12:16, 00:13:07]`.
3. **Capture the human story / inside scoop without contaminating the record.** *When something
   emotionally or relationally important comes up (a marital disagreement, a late-meeting change of
   heart, informal color), I want it saved somewhere searchable and advisor-reviewed, so the team
   can recall it later — but never sent to the client or broadcast firm-wide.* 🟢
   `[P1 00:33:14 human-story arc, 00:40:44 inside scoop]`.
4. **Get meeting outcomes into the CRM without losing detail or introducing errors.** *When a
   meeting ends, I want the true richness of what was said preserved somewhere durable, without
   either overwhelming the advisor with unreviewed volume or losing everything that doesn't fit the
   client template, so nothing important falls through the cracks.* 🟢 `[P1 00:17:22, 00:21:01]`.
5. **Delegate planning changes with a verification gate, not a rubber stamp.** *When a client
   detail changes that affects their plan, I want to hand it to Philip in a form he can trust and
   act on, while keeping a human checkpoint (the advisor's sign-off) in the loop — so a change never
   reaches RightCapital based on something an AI merely inferred.* 🟢 `[P1 00:39:23, 00:29:03]`.
6. **Triage an unreasonable task load.** *When I have far more open tasks than I can realistically
   finish today, I want something that knows my real capacity and the relative stakes of each item
   (a spelling fix vs. a fraud situation, a client with a meeting this week vs. one with no meeting
   scheduled), so I can decide what to actually do today without personally re-deriving priority
   from scratch every time.* 🟡 reaction to Jameson's "AI coach" pitch, but her elaboration (task
   equal-visual-weight problem, capacity math "6 done, 21 assigned") is her own and strong 🟢
   `[P2 00:10:31, 00:11:03]`.
7. **Schedule the yearly meeting cycle without manual chasing.** *When it's time for a client's
   annual meeting, I want the system to know who's overdue, pick the right advisor/link, and manage
   the reminder cascade, so I'm not manually cross-referencing a client list, Wealthbox, and
   Calendly every cycle.* 🟢 `[P1 01:11:53–01:14:26]` — the most granular, mechanically-detailed
   job in the whole session.
8. **Chase documents without feeling like a pest.** *When a client or their accountant needs to
   send us something, I want the ask and the reminder to come from a system, not from me
   personally, so I don't feel like I'm bothering people every time.* 🟢 `[P1 01:17:04]`.
9. **Send sensitive documents to the correct, current recipient with certainty.** *When I send a
   1099 or other sensitive document, I want the system to guarantee it's going to the right,
   currently-correct accountant/recipient, so a data-privacy mistake with real financial harm never
   happens.* 🟢 `[P1 01:21:41]`.
10. **Answer "how do we do X here" without hunting.** *When an advisor or teammate doesn't
    remember the firm's process for something (which task template, which workflow step), I want an
    answer that reflects our actual current setup, so people stop starting from a blank task and
    creating rework for ops.* 🟢 `[P1 01:20:03]`.
11. **Keep every downstream copy of a fact in sync when something changes.** *When a compliance
    rule changes, a responsibility gets reassigned, or a workflow template gets edited, I want the
    system to find every place that's now stale (open workflows, task assignments, slide content)
    and flag it, so nothing quietly falls out of date.* 🟢 `[P1 01:25:12, 01:25:36, 01:23:53]`.

**Emotional**

12. **Relief from the fear of dropping the ball.** *When information is scattered across Teams,
    Wealthbox, and people's memory, I want confidence that nothing important is lost, so I can stop
    living with the low-grade dread that I (or a teammate) will be the one who misses something.* 🟢
    `[P1 00:44:03]` — her own words, unprompted, and among the most emotionally direct statements in
    the session.
13. **Feel in control instead of like "a little slave" to grunt work.** *When routine
    review/approval work piles up, I want AI to absorb the minutiae so my day is spent deciding, not
    hunting — the way approving Figma/AI output has changed Jameson's own work — so I feel like I
    have my time and agency back.* 🟡 this framing is Jameson's, offered as an analogy from his own
    job, and she responded with resonance about wanting "our time back" for higher-value work like
    calling clients unprompted — treat the specific "little slave" framing as his language, but her
    response (wanting time back, wanting to attend more meetings, wanting to call clients just to
    check in) as her own genuine reaction 🟢 `[P1 00:55:13–00:56:03]`.

**Social / relational (advisor-to-client and teammate-to-teammate)**

14. **Prove attentiveness and credibility to the client.** *When I know something personal about a
    client (a kid's college choice, a hobby, a gift preference), I want to be able to act on it (send
    the right gift, ask the right question) without it slipping through the cracks, so the client
    feels genuinely known rather than processed.* 🟢 `[P1 00:18:21 college/gift example,
    00:19:16 "gifts are a big deal"]`.
15. **Never make the team look uncoordinated to a client.** *When a client interacts with more than
    one JBW teammate, I want us all working from the same up-to-date picture, so the client never
    senses (via a CC'd email or a repeated question) that we didn't talk to each other.* 🟢
    `[P1 00:13:41 "I cringe... did you look at every resource we had"]`.
16. **Respect role boundaries while still moving work forward.** *When something is outside my
    lane (planning, a teammate's software), I want a clean way to hand it off with enough context
    that they trust it and can act, without me having to touch their tools directly — that's how I
    show respect for their domain.* 🟢 `[P1 00:38:03]`.

---

## 4. Forces analysis

**Push (pain with the status quo)**
- Detail loss between a rich 60-minute conversation and a 3-bullet-category template; recall
  gaps requiring "SOS" messages between teammates 🟢 `[P1 00:17:22, 00:18:50]`.
- Manual, repetitive scheduling chase with brittle tooling (Calendly buffer rules forcing ~40%
  manual Outlook work) 🟢 `[P1 01:12:46]`.
- Real, named errors: the wrong-Roth-IRA task, the 1099-to-wrong-accountant risk 🟢
  `[P1 01:08:55, 01:21:41]`.
- A structurally broken template-propagation model in Wealthbox (open workflows don't inherit
  template edits) 🟢 `[P1 01:25:36]`.
- Chronic overload and a task list that doesn't distinguish stakes, landing hardest on the two
  people (participant + Andy) who hold the most undocumented institutional judgment 🟢
  `[P2 00:10:31, 00:12:07]`.
- The "fear of dropping the ball" as an ongoing emotional cost, not a one-off complaint 🟢
  `[P1 00:44:03]`.

**Pull (what draws her toward Lantern)**
- Explicit, unprompted hope that Lantern **replaces both Wealthbox and Jump** and becomes "an
  assistant... a source of truth... with amazing searchability" 🟢 `[P1 01:36:38]` — this is the
  single strongest pull statement in the session, and it is her language, not a reaction to a
  specific pitch (Jameson had just said he wasn't sure Wealthbox was replaceable, and she pushed
  back with her own hope).
- Approval-gated AI action model resonates strongly — she wants exactly the kind of
  propose-then-approve workflow Lantern already commits to (track-changes-style edits, cited
  answers, human sign-off before anything writes to a system of record) 🟢 `[P1 00:52:45,
  00:53:44 wanting things "popped up" for a required human check-off instead of hunting people down
  on Teams]`.
- The umbrella-insurance and HSA "latest and greatest" asks are exactly Lantern's cited-recall
  pitch, and she independently proposed them as ideal demo scenarios 🟢 `[P1 01:01:15]`.

**Anxiety (what worries her about the new solution)**
- Fear of AI **deleting or overwriting** something wanted — explicitly named when Jameson
  described AI editing real files 🟢 `[P1 00:49:11]`.
- Distrust of anything client-facing that hasn't passed through "advisor eyes" — she repeatedly
  drew the line at needing the advisor to confirm before anything (a gift-relevant fact, a planning
  number) moves forward 🟢 `[P1 00:27:51, 00:29:03]`.
- Concern about AI-generated content becoming "too much stuff for someone to look through," citing
  her own 100-page-Claude-plan experience as a cautionary analogy for advisor overwhelm 🟢
  `[P1 00:29:44, 00:30:02]`.
- Worry that a mapped/structured feature (e.g., cash-needs map) could go **stale and actively
  destroy trust** rather than help — "if you were to go visit it and I was out of date it'd
  probably decrease trust a lot" 🟢 `[P1 01:07:02]`.

**Habit / inertia**
- **"Married to the note template."** This is named explicitly, twice, as the binding constraint
  even when it's acknowledged to be limiting Jump's usefulness: Seattle has told them being more
  flexible on the template would let Jump do a lot more, and Jump itself confirmed it still can't
  convert their template into tasks — yet the firm hasn't changed the template, because clients
  have been trained to expect the current to-do format 🟢 `[P1 00:24:04, 00:25:26]`. This is the
  clearest single piece of evidence that **switching costs are social/behavioral (client
  expectations, advisor comfort), not purely technical** — any pitch to replace Jump has to solve
  for this, not just for feature parity.
- **Wealthbox as the firm's de facto operating system.** She states plainly it's used for "way
  more than" a CRM's typical scope — six people log into it inconsistently, "in their own rhyme and
  reason," and it's the backbone for tasks, workflows, pinned account context, and (attempted)
  inside-scoop capture 🟢 `[P1 01:31:52]`. Yet she personally believes Wealthbox is **not
  technically hard to rebuild** ("a way to display a database of people... pretty basic") 🟢
  `[P1 01:34:07]` — her inertia is about switching an operating habit for 6 people, not about
  respecting Wealthbox's technical moat.
- Net tension: **her hope (replace both Wealthbox and Jump) is running ahead of the firm's
  actual behavioral inertia** (template lock-in, six people's ingrained habits, role-based tool
  ownership like Philip-owns-RightCapital/she-doesn't-touch-it). Any roadmap should expect the
  organizational switching cost to be the harder problem, not the technical one.

---

## 5. Decision points & trust-sensitive moments

Ranked by how catastrophic a wrong AI action would be, based on her own framing of stakes:

1. **Wrong-account financial changes** (the Roth IRA story) — an AI or human acting on a
   task/note without disambiguating between multiple similar accounts caused a real error 🟢
   `[P1 01:08:55]`. Any AI-initiated account-level action needs hard disambiguation, not
   best-guess matching.
2. **Sensitive-document misdelivery** (1099 → wrong/stale accountant) — real financial-privacy
   harm (SSN, account number, address) if recipient-linkage is wrong or outdated 🟢
   `[P1 01:21:41]`. She independently proposed a cryptographic-linkage / key-based safeguard.
3. **Client-facing leakage of internal color** — sensitive relational content ("wife feels X,
   husband feels Y") must never reach the client verbatim; this is treated as a near-catastrophic
   failure mode requiring careful "massaging," done today by a human editorial pass 🟢
   `[P1 00:40:24]`.
4. **Unverified numbers reaching the planning team** — she was explicit that AI-extracted figures
   must pass through an advisor because Jump "doesn't know the client" and could misinterpret or
   misattribute a number, which would then propagate into an actual financial plan 🟢
   `[P1 00:29:03]`.
5. **Stale "map" data eroding trust** — she flagged this as a design risk, not just an annoyance:
   an out-of-date cash-needs or account map would "decrease trust a lot," implying users would
   likely abandon a feature (or the product) rather than tolerate visible staleness 🟢
   `[P1 01:07:02]`.
6. **Silent workflow staleness** — the open-workflow-doesn't-inherit-template-update problem is a
   lower-drama but high-frequency trust erosion: nobody notices until a step is missed, and by
   then trust in the process (not a single AI action) is what's damaged 🟢 `[P1 01:25:36]`.
7. **Auto-push to Wealthbox without a stop-and-confirm gate** — she was explicit that she does
   *not* want full automation on the Jump→Wealthbox path, even though it exists as an option in
   Jump today; the manual confirm step is treated as a feature, not friction to be removed 🟢
   `[P1 00:22:34]`.

Across all seven, the consistent pattern is: **AI proposing is welcomed and often actively wanted;
AI acting unilaterally on anything client-facing, financial, or relational is not.** The one
partial exception is document self-filing/self-organizing, which she reacted to very positively
with no stated caveat — likely because it's low-stakes (organizational, not decision-bearing) 🟢
`[P1 00:08:52]`.

---

## 6. Opportunity areas — ranked by workflow evidence (not excitement)

1. **Unified, cited "latest and greatest" recall across sources (email, OneDrive, Wealthbox,
   transcripts).** Strongest, most concrete, most repeated evidence (umbrella policy, HSA, "where's
   your time going," "what's the source of truth"). Directly matches Lantern's core cited-recall
   pitch. 🟢🟢🟢
2. **Approval-gated write actions into Wealthbox/RightCapital (propose → advisor confirms →
   commits), replacing the current "a lot of hands" manual relay.** Extremely well evidenced by the
   full notes→tasks→Philip→RightCapital chain and her own explicit approval-first design ask. 🟢🟢🟢
3. **Internal "inside scoop" capture layer, separate from client-facing notes, searchable, never
   broadcast.** Named as a real, current gap with a clear desired shape (saved to Wealthbox,
   findable at meeting-prep time, advisor-reviewed, no team-wide alert). 🟢🟢
4. **Meeting-cycle scheduling automation** (who's overdue, correct Calendly link by
   advisor/tier, reminder cascade with human-approved batch send). Extremely granular, concrete
   evidence; currently ~40% manual due to tooling limitations (Calendly buffer rules). 🟢🟢
5. **Template-propagation / stale-workflow detection in Wealthbox-equivalent workflows** — a
   structural defect she named unprompted and in detail (40 open post-meeting workflows not
   inheriting a template edit). High-confidence, narrow, technically tractable. 🟢🟢
6. **Sensitive-document routing safeguards** (1099-to-accountant correctness, cryptographic
   recipient linkage). Named as a top team-wide fear with real financial-privacy stakes; she
   proposed the mechanism herself. 🟢🟢
7. **Task triage / capacity-aware prioritization**, especially surfacing the informal judgment she
   and Andy hold personally so it doesn't bottleneck on two people. Strong elaboration once
   prompted, but originated from Jameson's pitch — treat as validated-on-reflection rather than
   spontaneously reported. 🟢🟡
8. **"How do we do X here" internal process assistant** — real, named example (task-template
   confusion causing rework), moderate depth of evidence. 🟢
9. **Client-facing self-service intake/portal (document self-filing, status checklist,
   client-visible to-do list).** Positive reaction, grounded partly in real competitor behavior
   (RightCapital's own portal), but shallower/more reactive than items above. 🟢🟡
10. **Manager-facing team-health/workload reports** (who's overloaded, who's a "hot client"
    consuming disproportionate resources). Good elaboration but entirely originated from Jameson's
    "smart reports" pitch — weakest evidence tier of the ranked opportunities, though directionally
    plausible given her adjacent triage complaints. 🟡
11. **Compliance change-impact ("tentacles") auditing.** Named and clearly painful, but discussed
    briefly relative to other items and without much elaboration on desired shape beyond "a first
    pass at flagging." 🟢 (shallow)
12. **Cash-needs/account-purpose mapping.** She raised this herself but immediately flagged her own
    doubt about whether it's "worth building" given staleness risk — the *idea* has decent evidence
    (the Roth IRA and rental-account examples are real), but her own ambivalence about durability
    makes this lower-confidence as a roadmap bet than items above it. 🟢 with a self-flagged caveat.

---

## Judgment calls made while writing this

- Timestamps are cited at the **start** of the transcript segment containing the quoted/paraphrased
  material, per the source file's segment boundaries — some segments span 5-15 seconds of dialogue
  from both speakers, so the citation marks "this exchange," not a single sentence.
- Where Jameson clearly originates an idea (a pitch, a hypothetical "what if X") and she reacts,
  I tagged the *pain underneath* her response (if she supplied one) as 🟢 strong even when the
  *proposed solution* is 🟡 weak — e.g., the task-triage section: her description of overdue tasks
  turning red and being equal-weight is her own lived fact; the "AI coach" framing is his.
  I called this out inline in Section 3 rather than silently upgrading confidence.
  - I did the same for the ask-bar-vs-structured-report question in Part 2 (`[P2 00:15:03]`):
  treated the *persona contrast* (Seattle=structured, her=open-ended ask) as the sturdier claim,
  since it's a factual character read she offered, versus her direct preference which was elicited
  by a leading either/or question from Jameson.
- I did not find explicit evidence in either transcript for a couple of the analysis brief's
  requested angles — most notably, there is **no direct discussion of what's structured vs.
  unstructured as a deliberate taxonomy** in her own words; Section 2's structured/unstructured
  column is my inference from how she described each tool, not a direct quote.
- "Would advisors attend more meetings / call clients unprompted if freed up" `[P1 00:55:34]` is
  presented as her own extrapolation in response to Jameson's time-back framing — I kept it as 🟢
  because she generated the specific examples (attending meetings, watching recordings, calling
  clients "just to check on you") herself, even though the general prompt was his.
- Two names in the transcript ("Seattle," teammate) and product names (JotForm, Wealthbox,
  RightCapital) were normalized per the README's known mis-hearing corrections; I did not encounter
  any additional unresolved mis-hearings worth flagging beyond what the README already documents.
