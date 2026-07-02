# Brainstorm — lens: simplicity, elegance, product experience (2026-07-02)

*Board stance: win on simplicity + AI-first clarity; notetaking is a feature, never the identity.*

## 0. The design constitution (five rules everything obeys)

1. **Three tabs, forever.** Every capability lands inside Client Map, Ask, or Workflows. If a feature "needs" a fourth surface, the feature is wrong. Jump's product is a pile of surfaces; ours is a place.
2. **The client is the container.** No global notes inbox, no tasks inbox, no meetings list, no briefs library. Everything that happens with the Hendersons appears on the Hendersons' timeline. One mental model: *"Where is it? On the client."*
3. **A meeting is just another source.** A transcript sits on the timeline next to a PDF and an email, cited the same way, asked about the same way. Zero new concepts. (The RAG source allowlist already includes `transcript` and `meeting`.)
4. **Defaults you edit, not options you configure.** No template pickers, no field-mapping screens, no per-integration wizards. The app guesses well, shows its work, learns from edits.
5. **AI proposes, you approve — as a moment, not a modal maze.** Every write (CRM update, email send, fact added to the Map) is one clean preview → one Approve.

## 1. Meeting capture + notes

**Jump:** a bot joins your Zoom ("Jump Notetaker has joined"), records to their cloud, sometimes drops the recording (their most-cited real complaint; XYPN accuracy 3.5/5), notes land in Jump's notes surface.

**Keepance — capture at the device, keep it as a file:**
- **No bot, ever.** Records from the machine the meeting happens on: mic on one channel, system audio on a second. Your client never sees a robot participant.
- **One button, ambient.** Quiet strip: *"Meeting with the Hendersons in 4 min — record it?"* One click: **Record**. While recording, a small pill floats: elapsed time + the egress indicator glowing green — **"Local — nothing has left this machine."** That pill is the whole recording UI.
- **Un-droppable by construction.** Audio streams to a real file as it records. No upload, so no failed upload. Crash mid-meeting → audio is on disk → on relaunch: *"Found Tuesday's recording — finish the notes?"* Jump's #1 failure mode is structurally impossible.
- **Where it lands:** on Stop, local transcription runs and the meeting appears as a timeline entry: **"Meeting · Jun 30 · 41 min — transcript + notes."** Notes left, transcript right, audio scrubber on top. Not a Meetings tab. A timeline entry, like every other source.

**Honest constraints:** two-channel truth instead of full diarization for v1 (your mic = "You", loopback = "Them" — 90% of the value at 10% of the complexity); macOS one-time permission designed as a trust-onboarding moment; in-person-away-from-desk out of scope (no mobile — say so honestly).

**Principle:** *capture at the source; a recording is a file you own, not a job in someone's queue.*

## 2. Note templates

**Jump:** template gallery, per-meeting-type configuration — a settings jungle.

**Keepance — one great default, learned refinements:**
- Zero picker at record time. Every meeting gets one well-designed shape: **What changed · Decisions · Action items · Facts worth keeping** — rendered as a real Word document (tracked changes, our uncontested strength).
- If the advisor restructures a note, the app notices after save: *"Keep this shape for future meeting notes?"* — one Yes, and the template was "configured" without a configurator existing.
- Power shapes live in **Workflows** (the pro drawer); the default path never opens it.

**Principle:** *templates are learned from edits, not configured in settings.*

## 3. Follow-up emails

One button at the bottom of every meeting note: **"Draft follow-up."** Pre-addressed reply draft (email connector already drafts/sends), written from the note, with *citation chips inline*: hover "we'll revisit the 529 in the fall" → see the exact transcript moment. Sent email lands back on the timeline. Nothing added to the IA; a card grew a button.

**Principle:** *outputs appear where their source lives, one click away, never in a new place.*

## 4. Task extraction — refuse the task manager

- Action items are checkboxes inside the meeting note (a Word doc — survive export, printing, everything).
- Open items surface as chips at the top of the client's Map: *"3 open from Jun 30 meeting."* Check one → strikes through in the source note.
- Wealthbox connected? One button — **"Send 3 tasks to Wealthbox"** → preview → Approve. No due-date engine, no reminders, no global task inbox. Your CRM is your task system; we hand it clean, reviewed items.

**Principle:** *don't build a second brain for tasks; extract, show on the client, hand off.*

## 5. CRM sync — read richly, write as a reviewed handoff

- **Read:** Wealthbox feeds the Client Map silently. Setup = one screen: paste key, done.
- **Write:** after a meeting, one card — *"Update Wealthbox: 1 note · 3 tasks · 2 field changes."* Expand → changes render like tracked changes (our house visual language for "AI proposes"). One **Approve**. Never a background sync, never a field-mapping screen, never a sync-conflict dialog.
- One CRM done beautifully (Wealthbox), then Redtail. **Refuse the marketplace.** Everything a connector ingests must land as cited facts on the Map, or the connector doesn't ship.

**Principle:** *reads are invisible; writes are a stamp you press.*

## 6. Calendar + pre-meeting briefs — the one place to match Jump's ambition

The product is literally named **Advisor Prep Hero**; Jump's auto-brief is its genuinely best feature.

- **The 9:00am moment:** open the app; the top of Client Map says *"Today: Hendersons 10:00 · Ortiz 1:30."* Click a name → that client's Map, with a **"Before you meet"** strip already there: five bullets, each with a source chip (last meeting's transcript, a statement PDF, an email from March). No Generate button. No spinner. **It was ready before you asked.**
- One keystroke → a printable one-page Word brief.
- **Contrast to sell:** Jump assembles briefs from CRM + meetings. Ours is assembled from *the actual file pile* — the IPS, the statements, the email thread — the thing Jump structurally can't read deeply.

**Principle:** *prep isn't produced on demand; the app is simply always prepared.*

## 7. Client profiles — the Client Map, with provenance as the aesthetic

- **Every fact wears its source:** *"Risk tolerance: moderate — Annual Review, Mar 2026"* — click the chip, land on the exact sentence (or the exact second of meeting audio).
- **No silent mutation.** After a meeting: a soft badge — *"2 new facts from Tuesday's meeting"* → small review card → Accept/Skip. The Map stays something the advisor trusts *because they curated it*.
- Completeness scoring (already built) tells you what the Map *doesn't* know — which a profile page in Jump never does.

## 8. Ask-anything — the scope always visible

- A permanent **scope pill** above the input: *"Asking: the Hendersons · 214 files · 891 emails · 6 meetings."* You always know what the AI can see (client isolation is cryptographic underneath). Click to widen to the whole practice.
- Practice-wide questions return client chips, each opening to the cited passage. No dashboards, no agent theater.
- Citations are live: doc citations open the doc; transcript citations *play the audio from that moment*.

## 9. Doc intake / onboarding

- **App onboarding = product demo.** First run: *"Point me at a client folder."* Drag the messy folder in; watch the Map assemble live — documents categorizing, facts appearing with chips, completeness climbing. Under a minute to the first cited answer. That flow IS the pitch, vs Jump's connect-60-things checklist.
- **Client intake = gap-finding, not form-filling.** *"Have: IPS ✓, 2025 statements ✓. Missing: beneficiary designations, risk questionnaire."* The advisor's actual anxiety, and a document-pile skill Jump doesn't have.
- **The cheeky migration moment:** the ingester already recognizes Jump note exports. Surface it: *"Leaving Jump? Drop your exported notes here — they'll join each client's timeline, cited."*

## 10. Compliance — by architecture, expressed as three artifacts and one flow

1. **The egress indicator** — always visible and *interrogable*: click it mid-recording and see, live, that zero content connections are open. Not a claim; an instrument.
2. **The printable Data Map** — one page for the CCO: everywhere data can possibly go, per confidentiality mode.
3. **The audit log** — append-only, encrypted, exportable. Already built.
4. **Consent as a flow, not a setting:** on Record: *"Utah is one-party consent — you're set"* or *"California is two-party — try: 'I'd like to record this for my notes, is that alright?'"* with a **"Consent noted"** stamp living on the recording's timeline entry forever. Retention = one honest action: *"Delete audio · keep transcript."*

**Honesty line:** no SOC 2 yet, no supervision dashboards — don't fake enterprise controls; sell the solo/small-RIA truth that with local mode there's far less for compliance to vet at all.

---

## The anti-roadmap (refuse, to protect simplicity)

- No meeting bot that joins calls. Clients never meet our software.
- No fourth tab, ever.
- No integration marketplace. Two CRMs done beautifully beats 39 done adequately.
- No template gallery or configurator.
- No standalone task manager, reminders, or due-date engine.
- No revenue/"Grow"-style dashboards, sentiment scores, referral signals.
- No autonomous agent acting unattended. Approval is the brand.
- **No cloud transcription fallback. Ever.** That one shortcut deletes the entire positioning.
- No mobile app. Own the desk.
- No per-feature settings pages. If a feature needs one to be usable, redesign the feature.

---

## Signature "better than Jump" demo moments

1. **The un-droppable recording.** Force-quit the app mid-recording in the demo. Relaunch. *"Found Tuesday's recording — finish the notes?"* Dropped recordings are Jump's most-cited complaint; ours can't drop because it never travels.
2. **Pull the Wi-Fi.** Yank the network mid-meeting. Recording continues, transcription runs, notes appear, egress dot stays green. *"Everything they do in a data center, done with the cable out."*
3. **Click a fact, hear the moment.** *"Wants to fund a 529 for the grandkids — Meeting, Jun 30."* Click → transcript scrolls to the sentence → the audio plays from that second, in the client's own voice. Citations you can *hear.*
4. **Folder in, Map out.** Drag one messy client folder in; sixty seconds later there's a living, cited Client Map with a gaps list. One drag vs Jump's wall of 60 integrations.
5. **No bot in the room.** Split-screen: theirs shows *"Jump Notetaker has joined the meeting"*; ours shows two humans and a quiet green dot. *"Your client never meets our software."*

---

**Caution for downstream work:** the public comparison page (`~/keepance/website/vs/jump.html`) still says "Advisor Prep Hero isn't a meeting-notes tool" with a hard **No** on meeting capture, and mentions Markdown files (contradicting the Word-native identity). If meeting capture ships, that page needs a coordinated rewrite — framing shifts from "complementary to Jump" to "the simpler, private way to do the whole job." Identity stays *AI app with meetings as one more cited source*, never note-taker.
