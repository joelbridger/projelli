# The Skeptical Advisor: a whole-app trust, timing & workflow review

*Commissioned by Jameson, 2026-07-04. Reviewer: Fable 5 (the Lantern-Plus judgment lane). Method: read the strategy + notice-design docs, swept every screenshot from today's five QA lanes and the real-hardware meeting lanes, read the user-facing code (consent, notice, Ask, meeting notes, email drafting, CRM, egress, Data Map, audit) with an independent Codex adversarial pass, and then lived an advisor's arc on the real Windows laptop — connected a client, asked a cited question, recorded a meeting, watched the notes generate, and pulled the compliance report.*

> **This is a review to make decisions from, not a fix list.** Nothing here has been changed. Jameson asked to see the whole picture first and decide what (if anything) to act on. Everything below is "here's what a suspicious advisor, their client, or a compliance officer would feel," ranked so you can pick your battles.

---

## Read this first (plain-language summary)

The app is genuinely good, and its trust story is mostly real, not marketing. When it shows you an answer with sources, you can click each source and it really is in the client's own files — I checked, and it holds up. Your data really does stay on the machine in the ways it says. The recording-consent screen is calm and honest. I could not make it lose or leak a client's data across clients.

But the whole product is a **promise of trust**, and a trust product dies the first time someone catches it in one thing that isn't quite true — even a small thing. I found a handful of those. They aren't crashes; they're gaps between what the app *says* or *implies* and what a careful, skeptical person can actually *see or prove*. That's exactly the class of problem the recording example was: the recording worked perfectly, but the other people in the meeting had no way to know it was happening.

The five that matter most, in one breath each:

1. **A page that's supposed to reassure a client says something that isn't true.** The "Where your data goes" map tells the client the Wealthbox (CRM) connection is *read-only and never writes anything back* — but the app has a whole feature that writes notes *into* Wealthbox. If a compliance officer reads that page and then sees the write feature, every other true claim on the page is now suspect.

2. **The people in the meeting still can't see they're being recorded.** This is the original problem, and it's still real. The proof that a notice happened is weaker than it looks: the app records "notice copied to clipboard," not "the client actually received it," and it only checks *after* the meeting whether you said the words out loud.

3. **The AI can be confidently wrong, and the wrong thing then travels.** In one real test the meeting note the app wrote said "target $1,889,000 by 2013" — a nonsense date it invented — and that same made-up line got queued to be pushed into the client's CRM record for a colleague to see. In my own live recording, the "meeting note" was the AI apologizing that it had no transcript — and that apology got saved as the client's note. The advisor is the only safety net, and the app doesn't make the risk obvious.

4. **An advisor can't prove the privacy story to their compliance officer.** The app *asserts* "nothing left your machine" and logs *that* a search happened — but it can't show *which* files the AI read to write a given answer, and the printable report even says it "does not certify compliance." A compliance officer's whole job is to verify, not take your word for it.

5. **The top-line privacy promise is bigger than the truth.** The welcome screen and privacy settings say things like "nothing ever leaves your machine," but that's only true in one mode; in normal cloud-AI mode your questions do go to your AI company, and connectors do sync. The detailed map is honest about this — but the headline isn't, and skeptics read headlines.

None of these is fatal on its own. Together they're the difference between "impressive demo" and "I'd trust this with my book." The good news: most are about honesty and provability, not missing engineering — the hard parts (local-first, citations, the audit log) are already built.

The rest of this document is the full ranked list, then the five I'd fix first, then the real strengths worth protecting.

---

## How to read the rankings

Each finding says **when it bites**, **who loses trust** (advisor / client / compliance officer / colleague), and a **severity for adoption**:

- **Existential** — could kill a sale or the product's credibility outright. A caught falsehood, an unprovable core claim, an embarrassment in front of a client.
- **Erosion** — no single one loses the deal, but they accumulate into "I don't quite trust this."
- **Polish** — small, but the kind of small that a suspicious person notices.

Functional bugs already filed by the QA lanes (the 41 in `coordination/qa-campaign/BUG-DB.md`) are *not* re-listed here; where a filed bug also has a human-trust dimension I note it and point to the ID.

---

## Existential findings

### E1 — The Data Map tells the client a falsehood about the CRM connection
**When it bites:** an advisor prints the "Where your data goes" map (explicitly offered as "you can print it or save it as a PDF to show a client") for a client or compliance officer. **Who loses trust:** compliance, client, advisor. **Severity: existential.**

The Data Map's Wealthbox row says, verbatim: *"The connection is read-only: Advisor Prep Hero never writes anything back to Wealthbox."* But the product ships a full write path — "Send to Wealthbox," the CRM review card, `crm_create_note` / `crm_create_task` / field-update — and a whole approval-gated compliance-note feature that exists *specifically* to write into the CRM. The single most damaging thing a trust product can do is get caught in one demonstrably false claim on the very page meant to earn trust. A CCO who reads "never writes back," then sees a "Send to Wealthbox" button, now rereads every other (true) claim on that page as marketing. This one is cheap to correct and should not survive contact with a real reviewer.

*Evidence:* `src/platform/privacy/ui/DataMapDialog.tsx:112` (the claim) vs. `src/platform/utils/wealthbox-commands.ts` (`crm_create_note`/`crm_create_task`/field-update) and the live "Send to Wealthbox" review card.

### E2 — The people in the meeting still cannot see, and cannot later prove, that recording happened
**When it bites:** the moment a client joins a call; and months later when someone asks "prove the client was told." **Who loses trust:** client, compliance. **Severity: existential** (this is the calibration case, and it is still open).

On the real-hardware calls I reviewed and in my own live recording, the only recording indicator is a small pill in the *advisor's own* window (bottom-right, "Recording 0:05 · Local"). Nothing appears in Teams or Zoom, because the capture is local and outside the platform. The client has zero on-screen cue. The Notice Kit is a genuine, thoughtful answer to this — but as shipped it has three soft spots a skeptic will find:

- **"Copied" is treated like "delivered."** Copying the chat/invite notice writes a ledger entry (`chat-notice-copied`, `invite-disclosure-copied`) that reads as evidence, but it only proves the advisor put text on their clipboard — not that any client ever saw it.
- **Verification is retrospective and one-sided.** The spoken-notice check scans only the advisor's mic channel, only the first five minutes, and only *after* the meeting. At the one moment it matters — record-time — nothing prompts the advisor if they forget to say it. (In my live run, the consent dialog did **not** show a "say this out loud" script at all; the script is conditional and didn't render, so the record-time nudge was simply absent.)
- **"Detected" ≠ "consented."** The strongest evidence the system can produce is "the advisor spoke a notice," not "the participants agreed." Fair as a floor, but the internal labels ("verified," "consent noted") claim more than the mechanism delivers.

This is defensible to *ship* — it's honestly better than a silent "Notetaker" bot in some ways — but the current wording oversells the proof, and the participant-facing gap the CFP named is still the gap.

*Evidence:* `docs/strategy/2026-07-04-recording-notice-brainstorm.md:21`; `RecordPill.tsx:118` (advisor-only pill); `NoticeTrail.tsx:69`, `noticeLedger.ts:46` (copied≠delivered); `noticeVerification.ts` (mic-only, first-5-min); live: `leg-09/10/13` on this branch's scratch run.

### E3 — The AI can be confidently wrong, and the wrongness travels outward unchecked
**When it bites:** every time an AI-written note, email, or CRM update leaves the advisor's screen. **Who loses trust:** client, colleague, compliance, advisor. **Severity: existential.**

Two real instances, not hypotheticals:

- On a real Windows run (`windows-smoke` lanes), a generated meeting note read *"Reviewed progress toward 'Retirement' — target $1,889,000 by 2013 (high priority)."* The dollar figure is real; "2013" is a fabricated, nonsensical past date. That exact hallucinated line was carried, unedited, into the **Wealthbox review card queued to sync into the client's real CRM record** — a fabricated fact one click away from the firm's system of record.
- In my own live recording, the transcript was near-silent (synthetic), and the AI "meeting note" that got saved as the client's note was: *"I don't see a transcript included in your message. Could you please share the transcript…"* — the model's confused apology, filed as `notes.docx` for the client, and the meeting flagged only with a generic "Needs review."

The safety architecture is real — citations, "AI proposes, human decides," the "refuse rather than bluff" posture — but it protects the *advisor's reading* moment, not the *outbound* moment. Citations are visible only in the app; when a follow-up email is sent or a CRM note is written, the provenance drops off and the recipient/colleague gets un-sourced text that reads as the advisor's own considered words. An advisor who has internalized "cited = safe" is exactly the advisor who forwards the hallucination.

*Evidence:* `windows-smoke-1/xc-02`, `windows-smoke-2/s2-62`, `wave2-retest-01/02` (the 2013 line into CRM); live meeting-note apology (this run); `DraftFollowUpModal.tsx:431` vs `:217` (citations shown in modal, only body sent); `write.rs:265` (CRM note is title+body only).

### E4 — An advisor cannot prove the privacy story to a compliance officer
**When it bites:** a CCO's diligence: "show me exactly what produced this answer" / "prove this client's data never left." **Who loses trust:** compliance, advisor. **Severity: existential** (this is the buyer's veto for any firm).

The pieces exist but stop one step short of *proof*:

- The **Confidentiality Report** is destination-level only. It lists each AI call's mode/model/provider and "Data left machine? Yes/No," then states in its own footer that it reflects "architecture-level data flow" and "does not certify compliance with any specific regulation." It proves *where requests went*, not *what content* or *which sources* were involved.
- The **Activity log** records "Files Searched (matter …): 8 results" — the fact of a search, not *which* files were read. The Ask send-path likewise logs query/scope/hit-count, not source IDs or snippet hashes.
- So the honest answer to "what did the AI read to write this?" is: *the app can't show you.* For a supervision-minded firm, "trust the architecture" is not the same as "here is the evidence," and the gap is precisely where a compliance officer says no.

This is the flip side of the app's greatest strength (the citation engine already knows the sources per answer) — it just isn't *retained as a provable record*. Closing it would convert the entire privacy story from claim to proof.

*Evidence:* `ConfidentialityReportDialog.tsx:208` & `:255` (destination-only + disclaimer); live report (6 calls, "Data left machine? Yes"); `useChatSending.ts:674` (retrieval audit without source IDs); live Activity log ("8 results," no file list).

### E5 — Books-and-records retention is a manual checklist, and "Summary only" deletes the best evidence
**When it bites:** a firm configures retention, or later must reconstruct what was said/advised. **Who loses trust:** compliance. **Severity: existential** for any firm subject to SEC Rule 204-2 / 17a-4 instincts.

Retention offers a **"Summary only"** mode: *"Audio and transcript are removed once notes exist. Only the notes stay."* Given E3 (the notes can hallucinate), that setting can destroy the *accurate* record (the transcript) and keep only the *AI's* interpretation — the exact inversion of what an examiner wants. There's no framing that flags this as compliance-risky. More broadly, the app's books-and-records support is a *generated guide* that tells the user to manually export AI work product; there's no automatic, per-client, tamper-evident retention/export of AI outputs and meeting artifacts. "We made you a checklist" is not "we retain your records," and a CCO knows the difference.

*Evidence:* `src/locales/en.json:1398` (summary-only copy); `MeetingEntry.tsx:442` (manual delete keeps only transcript/notes); `BooksRecordsRetentionNote.ts:50,148` (guide, not system).

---

## Erosion findings

### R1 — Consent is attestation, not evidence, and "standing consent" turns it into a reflex click
**When/who:** every recorded meeting; compliance/client. The checkbox "I have the consent I need" becomes "Consent noted · two-party" in the record — wording that claims more than a self-check delivers. Once standing consent is on file the checkbox pre-checks, so the attestation degrades into a single reflexive click even in all-party-consent states where notice is needed *every* time. *Evidence:* `ConsentDialog.tsx:148`, `en.json` "Consent noted"; live meeting header "Consent noted · two-party."

### R2 — Everything lands at the most loaded second of the day
**When/who:** the 60 seconds before a client meeting; advisor. The consent dialog, the (conditional) spoken-notice step, the future "admit the Notice Card" click, and jurisdiction reasoning all fire at record-time, with the client waiting. State/consent rules are resolved at the moment of recording ("No per-client state on file yet" → conservative default) rather than captured once during setup. The design target in the Notice-Card doc ("zero new habits, at most one extra click") is the right instinct; today the cognitive load is front-loaded onto the worst moment. *Evidence:* `ClientMeetingsTab.tsx:166`; `docs/strategy/2026-07-04-notice-participant-design.md`.

### R3 — The "notes blocked" message coaches the advisor to turn privacy *off*
**When/who:** right after a meeting, in Local-only mode; advisor. The error reads: *"Notes need your AI provider, but Local-only mode is blocking it. Turn off Local-only mode in Settings → Privacy, or connect a local model."* Leading with "turn off Local-only mode" trains the confidentiality-anxious buyer to downgrade their own privacy as the fast fix. *Evidence:* `en.json` `meetings.entry.notes-failed-blocked`.

### R4 — AI-drafted follow-up email: content leaves early, provenance leaves entirely
**When/who:** drafting a post-meeting email; advisor, recipient. Opening the Draft Follow-Up modal *immediately* resolves the provider, logs egress, and sends the note content to the cloud AI — the confidential content leaves before any deliberate "generate" click. The citations that make the draft trustworthy are shown only in the modal; when saved/sent, only the body goes, so the advisor's own audit trail and the recipient both lose the sourcing. *Evidence:* `DraftFollowUpModal.tsx:76,140` (generate-on-open) and `:431` vs `:217` (citations dropped on save).

### R5 — CRM notes enter Wealthbox with no visible AI/source provenance, and the compliance receipt is opt-in
**When/who:** a colleague reads the Wealthbox note later; colleague, compliance. The note written to the CRM is just title + body — a colleague reading it has no signal a machine drafted it or what it was based on. The companion "compliance note" that records provenance is a checkbox that starts **off**. In a firm, supervisory provenance shouldn't be opt-in. *Evidence:* `write.rs:265`; `CrmWriteReviewCard.tsx:74` (compliance note defaults false).

### R6 — One whole-practice question ships a digest of *every* client to the cloud
**When/who:** an advisor asks a book-wide question in cloud mode; advisor, compliance. "Whole practice" Ask sends a compressed summary (up to ~40 facts per client) across the entire book to the AI provider in a single request, with no pre-send count or preview of what's about to leave. The scope pill says "summaries only," which sounds *smaller*, not "a little bit of all my clients at once." *Evidence:* `wholePracticeAsk.ts:27`, `bookFacts.ts:8`.

### R7 — The app can't decide which AI provider it's using, out loud
**When/who:** a skeptic reading the trust surfaces; advisor, compliance. The Ask header pill says only "Using cloud AI" (real destination hidden in a tooltip). The Privacy Center's "Current mode" pill read **"Sent to your OpenAI account,"** while every actual call in the same session's Confidentiality Report went to **Anthropic / claude-sonnet-4-6**. A careful reader now has two surfaces disagreeing about where their client's data is going. *Evidence:* `EgressIndicator.tsx:250`; live: Privacy Center "OpenAI" vs report "anthropic."

### R8 — "It forgot what I just told it" and "my meetings are gone" — the trust reading of two filed bugs
**When/who:** an advisor jotting a note then asking about it; after any restart; advisor. New docs aren't searchable until an app restart (QA-19) — to a human this reads as the app *forgetting* what they just entered, which for a memory/recall product is the worst possible impression. Separately, meetings vanishing after restart (QA-30, since fixed) rendered *identical* to the genuine "you have no meetings" empty state — the recurring pattern where a silent failure looks exactly like "your data is gone." Filed as functional bugs; flagged here because the *felt* meaning is "this tool loses my work." *Evidence:* BUG-DB QA-19, QA-30.

### R9 — Client voiceprints are enrolled without the client's biometric consent
**When/who:** speaker separation on a recorded meeting; client, compliance (biometric-law states). "Separate speakers" builds per-client **voice profiles** ("stored only on this computer, encrypted"). The recording consent covers *recording*, not *biometric enrollment* — and in BIPA-style states (IL, TX, WA) a voiceprint is regulated biometric data with its own consent regime. Storing it locally is good hygiene but not the same as having consent to create it. *Evidence:* `en.json` `meetings.speakers.privacy-note`; live "WHO IS SPEAKING? / Separate speakers."

### R10 — Meeting-note citations dangle when the audio they point to is deleted
**When/who:** reviewing an older note after retention cleanup; advisor, compliance. Notes cite timestamps ("(at 2:15)") into the recording; retention modes that delete audio (or transcript) leave those citations pointing at nothing, quietly turning a "verifiable" note into an unverifiable one. *Evidence:* `meetingNoteTemplate.ts` (timestamp citations) + retention delete modes.

---

## Polish findings

- **P1 — The core privacy pill is permanently truncated.** "Isolated client: outside connections are block…" is cut off in essentially every screenshot across every lane. The one always-visible statement of the network-lockdown promise can never be fully read in place. (Related filed item: QA-11.)
- **P2 — Engineering's internal name leaks into the UI.** The Documents "Tree" view shows a real folder named `Meetings/2026-07-04-matter_1866c9fa-…/audio.wav`. The repo's own facade rule says "matter" must never appear in user-facing copy; here a raw UUID-laden `matter_` path is visible in ordinary UI. Reads as "the seams are showing."
- **P3 — The perpetual trial countdown.** "Free trial, 29 days left" sits in the corner of every client and meeting screen, including mid-recording. On a calm, confidential tool it's a small note of sales anxiety in exactly the rooms that should feel unhurried.
- **P4 — The onboarding trust pills are checkable claims a CCO will scrutinize.** "Advisor Prep Hero stores none of your data" / "Fully encrypted (AES-256)" / "AI provider is SOC 2 certified" are strong and mostly true, but "AI provider is SOC 2 certified" leans on the *provider's* certification (not the app's) and sits one screen away from the honest, more-nuanced Data Map. First impression vs. fine print.
- **P5 — Half-finished localization.** German/Spanish translate Settings but leave the daily nav ("Client Map," "Clients," column headers) in English, and leak the literal English word "client" into German sentences. For a European or detail-oriented skeptic it reads as unfinished, not multilingual. (Related: QA-14, partially fixed.)
- **P6 — "Recommended" points away from the private mode.** In AI & Privacy, the higher-privacy "On this computer only" is selected, but the "Recommended" badge sits on "Cloud AI." A privacy-motivated advisor can read this as the app quietly nudging away from its own strongest promise.

---

## The five I'd fix first (and why)

1. **E1 — Kill the false "Wealthbox is read-only, never writes back" claim in the Data Map.** Cheapest fix on the list, highest blast radius if left. It's a caught falsehood on the exact page you hand a compliance officer; one contradiction discredits ten true statements. Fix the copy to describe the *approval-gated* write path honestly. This is the "don't get caught lying" hygiene the whole category depends on.

2. **E3 — Put provenance and a confidence check on anything the AI sends outward.** The hallucination-into-CRM path is the scariest single thing I found, because it's silent, it's outbound, and it lands in a *system of record a colleague trusts*. Never auto-queue an un-reviewed AI note to the CRM; keep source/confidence attached to outbound emails and CRM writes; make "this was AI-drafted from these sources" travel with the artifact. This protects the advisor from embarrassing themselves and the firm.

3. **E2 — Make the recording notice provable-as-delivered and present at record-time.** The calibration finding deserves the calibration fix. Two moves: (a) stop logging "copied" as if it were "delivered" — either integrate real delivery (calendar/chat) or label it honestly; (b) surface the spoken-notice step *at* record-time (it didn't even render in my run) so the advisor is nudged when it matters, not graded after. The Notice Card v1 direction is right; the evidence semantics need to be honest.

4. **E4 — Build the one artifact that proves the privacy story: "what left, and what the AI read," per client.** This is the compliance-officer veto and the deepest moat at once. The citation engine already knows the sources for every answer; retain them as a tamper-evident, exportable record alongside the destination log the Confidentiality Report already has. This is the difference between "trust our architecture" and "here is the evidence," and it's the sentence that closes firm deals.

5. **E5 + R7 — Tell the truth at the top, consistently.** Reconcile the headline promise ("nothing ever leaves your machine") with the true, still-excellent version ("nothing leaves unless you choose cloud AI or a connector — and here's exactly what does"), and make the provider name agree across the egress pill, the Privacy Center mode, and the report. Honesty at the headline is what lets the skeptic believe the fine print.

*Why these five and not others:* they're the ones where a *single* skeptical encounter ends the relationship — a caught lie (E1), an embarrassment in front of a client or colleague (E3), the unanswerable "prove it" (E2, E4), or a headline that doesn't survive scrutiny (E5). The erosion and polish items matter, but you recover from those; you don't get a second first impression on the five above.

---

## What already earns trust (protect these — don't break them while fixing the above)

- **The cited-answer experience is the real thing.** "4 claims cited from your files," each with a source card you can open, a "Verified against source" check, and account-level detail (real Schwab statement figures, IPS clauses) — I pushed on it live and it held. The split between "from your files (cited)" and "general knowledge, clearly marked — that's the point" is exactly the honesty a skeptic wants. This is the product's soul; guard it.
- **The recording-consent dialog is a model of calm honesty.** Plain language, a suggested spoken ask, an explicit "this is general guidance, not legal advice, confirm with your counsel," and it doesn't pretend to know the advisor's jurisdiction. You could show it to a client and it would *build* trust.
- **The Data Map's body copy is scrupulously honest** — the "honest asterisk" about providers retaining prompts, the note that connectors still sync in local mode, the plain statement of what the license check sends. (Fix the one Wealthbox line and this becomes a genuine asset.)
- **Client isolation actually holds.** Across every lane, scoped Ask never bled another client's data into an answer. The core promise is real, not UI theater.
- **Data resilience is near-bulletproof.** Force-kills mid-edit, mid-import, mid-recording, a full disk, a skewed clock — the app came back intact every time. For a trust product, "it never loses my work" is foundational, and it's earned.
- **Failure messages, where they fire, are honest and reassuring** — "Notes couldn't be written… your recording and transcript are safe" is the right posture. The gap is only that some silent failures never reach this message (see R8), not that the message is wrong.
- **The trust infrastructure exists** — egress indicator, audit log with CSV/JSON export, retention controls, a Confidentiality Report, a firm security pack. The findings above are mostly about making these *prove* rather than *assert* — which is a far better place to start from than not having them at all.

---

*Bottom line: this is a strong, honest product with a handful of honesty gaps that a suspicious buyer will find fast. Fix the five, protect the strengths, and the trust story goes from "impressive" to "provable" — which, for this buyer, is the whole game.*
