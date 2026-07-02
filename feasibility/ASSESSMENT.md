# Can Keepance Match Jump Feature-for-Feature? — Feasibility Assessment

*2026-07-02 · Prepared for Jameson · Sources: existing competitive intel (June 2026), fresh adversarially-verified web research on Jump (July 2026), a code-verified map of Keepance today, four independent design brainstorms (3 Claude lenses + 1 Codex), and an independent Codex read-only codebase investigation. This document was then adversarially reviewed by Codex against the codebase; all 12 of its corrections (mostly toning down optimism on effort sizes) are incorporated. All supporting files live in this folder.*

---

## The bottom line, up front

**Yes — a credible head-to-head story against Jump is feasible, and it's less work than it sounds, because Keepance already has more of Jump than anyone realized.** To be precise about what "match" means: this plan gets Keepance to **credible sales-deck parity for solo and small-RIA advisors** — every row on the comparison chart answered well — not a literal clone of everything Jump does (their mobile apps, enterprise rollout machinery, and cloud bot are different-shaped products we intentionally answer differently). Measured against Jump's feature list:

- Sorting Jump's ~18 headline capabilities honestly: **about 5 Keepance simply has** (client profiles, cited ask-anything, note templates, doc handling with OCR, audit trail — in several cases deeper than Jump's), **about 6 are partial** (prep briefs, follow-up emails, doc intake, compliance controls, task extraction, book-level questions), **4 are real gaps** (calendar, CRM write-back, meeting capture, speaker labeling), and **3 we deliberately answer differently or skip** (mobile, integration wall, autonomous agent).
- **Two builds close most of the remaining story:** a calendar connection (so prep briefs appear automatically each morning — Jump's flagship feature), and the ability to *write* notes and tasks into the advisor's CRM (today Keepance's CRM connection is strictly read-only — verified in code — so the write path, with retries, duplicate protection, and approval UI, is a solid medium-to-large job, not a tweak).
- **One genuinely big build remains: meeting capture.** This is Jump's core identity and the one area with zero Keepance code. The good news: we shouldn't copy how Jump does it — and the better way is also the cheaper way (details below).
- **A handful of Jump features we should deliberately NOT copy** (their meeting bot, their 39-integration wall, their mobile app, their revenue dashboards, enterprise user-provisioning) — each has a leaner answer or an honest "not our fight" story.

**The one thing this plan cannot buy is customers.** Every prior analysis agrees: Jump wins on distribution (LPL, Cetera, Osaic deals), not features. Feature parity makes Keepance *credible* in every sales conversation; it doesn't create the conversations. The "get real users weekly" discipline from the June evaluation still binds.

---

## How to read the effort labels

No calendar dates — just relative size. **S** = small (days-scale work for one engineer-agent, mostly wiring existing parts). **M** = medium (a real project, new code on existing rails). **L** = large (a new subsystem). **XL** = the biggest thing on this list (new engine touching each operating system).

---

## Part 1 — Feature-by-feature verdict

| Jump feature | Keepance today | Verdict | Lift |
|---|---|---|---|
| Client profiles ("evergreen") | **Client Map** — already the headline surface | ✅ Have it; ours is document+email-fed and cited | — |
| Ask-anything AI (cited) | **Ask** — cited answers over docs+email+CRM | ✅ Have it per-client; book-level questions need a small add | S/M |
| Pre-meeting prep brief | Meeting-prep template + Client Map | 🟨 The content engine is strong; the *productized* auto-brief (attendee→client matching, caching, refresh, failure states) is new work | M/L |
| Calendar integration | None (only Calendly metadata) | 🟥 Real gap — read-only import is cheap (Microsoft/Google login plumbing exists for email); the full automatic "morning briefs" experience is more | M read · M/L full |
| Note templates | Workflow template engine + marketplace | ✅ Have it — arguably deeper (real Word output; Jump has none) | — |
| Follow-up email drafts | Email connector already drafts/sends | 🟨 ~75% — needs one "draft follow-up from this note" button | S |
| Task extraction | Nothing dedicated | 🟨 Structured-output plumbing exists; needs extraction + review UI | M |
| CRM sync (write notes/tasks) | Read-only today — the Wealthbox client is GET-only in code (Redtail/Salesforce read clients code-complete awaiting vendor keys) | 🟥 Real gap — write path needs write APIs, mapping, retries, duplicate protection, approval UI | M/L |
| Meeting capture + transcription | Local dictation sidecar + audio recorder exist; **no meeting capture** (verified: zero code) | 🟥 The big one | XL |
| Speaker labeling (diarization) | None | 🟥 Gap — a cheap advisor-vs-clients split covers the common 1-on-1 video call; real per-person labeling is harder (below) | M–L |
| Ask over past meetings | RAG already allowlists `transcript`/`meeting` types | 🟨 Index plumbing is ready, but the meeting artifact model, speaker/timestamp chunking, and audio-linked citations are new | S/M |
| Doc intake (Onboard) | Viewers, OCR, ingestion, filing | 🟨 ~60% — field-extraction→forms doesn't exist; do the thin version | S/M |
| Compliance controls | Audit log, egress indicator, Data Map, vault, E2EE firm tier, SSO | 🟨 ~70% for solos — add retention settings, consent ledger, attestation export | M |
| Grow dashboards (signals/ROI) | Completeness scoring exists | Thin v1 only — "Book view" ranking clients by gaps/staleness | S/M |
| 30–42 integrations | ~4 shipped + 8 code-complete/merged awaiting vendor keys | Different answer: top-10 done well + read-their-exports for the rest | S each |
| Mobile apps | None (explicitly out of scope) | **Skip** — phone-as-recorder import bridge instead | S |
| Enterprise SSO/SCIM | SSO exists; SCIM doesn't | Partial — skip SCIM until enterprise deals are real | — |
| AI Associate (agent that acts) | Against product principle (AI proposes, user approves) | **Skip the autonomy** — philosophically we share Jump's approval model, but honestly: Keepance lacks the action layer (CRM writes) today; Waves 2–3 add it | — |

**Verified surprises worth knowing:**
- Keepance **already recognizes Jump's own note exports** — once an advisor's Jump notes land somewhere Keepance already watches (their Wealthbox or SharePoint), Keepance identifies and files them. It's not a Jump integration (there is none, by design), but it's a real coexistence and migration story.
- Codex found the current voice transcription has a **30-second hard cap** — it's dictation, not meeting-scale. The meeting pipeline is genuinely new work, not a tweak.
- Several "missing" connectors (DocuSign, Salesforce, Redtail, Addepar, Box, ShareFile, Zocks) are **already written and merged, waiting on vendor API keys.** Mostly paperwork — though each still needs live-vendor validation once keys arrive (real APIs always surprise), and the Zocks one is marked provisional in its own code. File all the vendor applications now, in parallel.

---

## Part 2 — The better-than-Jump designs (the brainstorm's best ideas)

All four brainstorm tracks — three different Claude lenses and an independent Codex pass — converged on the same core insight:

> **Don't copy Jump's architecture. Jump sends a robot into your meeting and ships the audio to their servers. Keepance should capture the meeting on the advisor's own computer and never let the audio leave.**

### The keystone: capture at the device, no bot (XL)

The advisor's computer already plays the meeting audio (Zoom, Teams, Meet, Webex, a phone call through the computer — anything). Every operating system offers a way to record "what the computer is playing" (called loopback capture). So Keepance records two tracks: the advisor's microphone, and everything coming out of the speakers. Then the already-bundled local transcription engine turns it into text. Why this beats Jump's bot:

1. **No robot participant.** Clients never see "Jump Notetaker has joined the meeting." Several broker-dealer IT departments block bots outright — we walk through that door.
2. **Works with every platform automatically.** A bot needs permission from each platform; loopback doesn't care whether it's Zoom, a browser call, or a softphone. We match Jump's 9-platform list by construction, plus platforms their bot can't join.
3. **Far fewer ways to lose a recording.** Jump's most-cited real complaint is lost recordings (audio dies somewhere between the bot and their cloud). Our audio streams straight to a file on disk as it records — a crash loses seconds, not the meeting, and there's no upload to fail. *Demo move: force-quit the app mid-recording, relaunch, and the meeting is still there.* (Honesty note: local capture has its own failure modes — app not running, disk full, laptop asleep, OS permission revoked — so capture reliability is real engineering work in Wave 3, not a freebie.)
4. **Nothing leaves the machine.** The recording, transcript, and speaker voiceprints never touch a vendor server. That's a sentence Jump can never say without abandoning its business model.

Speaker labeling comes in three tiers: (1) cheap and exact for the common case — your mic track is "You," the speaker track is "Them," which cleanly covers the classic one-advisor-on-a-video-call meeting (it does NOT separate a couple sharing one laptop, in-person rooms, or speakerphone — those need tier 2); (2) a small local model to split multiple far-end voices — genuinely harder, quality risk comparable to Jump's own imperfect labeling; (3) the killer feature — after one meeting you label "Speaker 2 = Sarah Henderson" and her *voiceprint is remembered locally*, auto-naming her in every future meeting. A cloud vendor storing client voiceprints is a biometric-privacy lawsuit magnet; only a local product can ship this comfortably.

**Honest blockers we design around, not hide:** the app must be running to capture (tray residency + calendar nudges help; a closed laptop records nothing); away-from-desk in-person capture is a workaround (record on the phone with any voice-memo app → it lands in a synced folder → Keepance transcribes it on arrival), not Jump-grade mobile; the Mac asks for one scary-sounding permission at setup; and transcribing a long meeting uses real battery — so we ship a "record now, transcribe when plugged in" mode.

### Everything after capture is downhill (S–M each)

- **Notes:** a meeting simply becomes another item on the client's timeline — notes as a real Word document (with tracked changes — a thing Jump literally cannot produce), every line citing the transcript moment. Click a fact on the Client Map and *the audio plays from that second, in the client's voice*. Citations you can hear.
- **Templates without a configurator:** one great default note shape; if the advisor rearranges a note, the app asks "keep this shape next time?" — templates learned from edits, not settings pages.
- **Follow-up email:** one button on the note produces an in-app draft written in the advisor's voice (learned from their sent mail, which Keepance already indexes locally — deeper personalization than Jump can reach), sent via the existing email connection. (Saving drafts *into* the advisor's real Outlook/Gmail drafts folder isn't supported by today's code — the send path exists but a draft-save path doesn't — so that's a small scope add, worth doing.)
- **Tasks without a task manager:** action items are checkboxes in the note plus chips on the Client Map; one button hands them to Wealthbox after a preview-and-approve. We refuse to build a second task system in the advisor's life.
- **CRM write-back:** shown as a tracked-changes-style preview ("1 note · 3 tasks · 2 field changes") with one Approve button. Same human-approval posture Jump advertises, better provenance — every pushed item cites its transcript moment, and the raw audio never touched any vendor.
- **The morning moment (calendar + prep):** open the app and today's meetings are listed with a "Before you meet" strip already prepared — no Generate button, no spinner. Built overnight, on-device, from the *actual document pile* (statements, the estate PDF, the email thread) — sources Jump's intake-only document layer structurally can't synthesize. This is where "Advisor Prep Hero" earns its name.
- **Compliance:** consent handled as a flow (state-aware one-party/two-party guidance, a "consent noted" stamp on the recording, a per-client consent ledger), retention as an honest local action ("delete audio, keep transcript"), and a one-click attestation report as a Word doc. Jump sells *promises about their servers*; we sell *facts about your machine*.

### The anti-roadmap (what we refuse to build, to stay simpler than Jump)

No meeting bot. No fourth tab (everything lands in Client Map / Ask / Workflows). No integration marketplace. No template gallery. No standalone task manager. No revenue-surveillance dashboards. No autonomous agent. No mobile app. **And never a cloud transcription fallback — that one shortcut would delete the entire positioning.**

---

## Part 3 — Recommended build order

Sequenced so the *sales story* completes earliest, and each wave reuses the last:

| Wave | What ships | Lift | What it unlocks |
|---|---|---|---|
| **0 — Story assembly** | "Draft follow-up" button on notes; polish the Jump-notes-import demo; publish "keep your notetaker" recipes; **file every pending vendor API application (Redtail, Salesforce, DocuSign) now — that's paperwork time, not build time** | S | Follow-up emails ✓, Jump coexistence/migration ✓ |
| **1 — Calendar → automatic prep** | Outlook + Google calendar connectors (read-only first); "Today's meetings" strip that pre-builds each brief | M/L | **Jump's flagship feature, with deeper sources** |
| **2 — CRM write-back** | Wealthbox notes + tasks with approve-preview, built properly (retries, duplicate protection, audit); Redtail/Salesforce ride along when keys arrive | M/L | Jump's core loop: meeting → CRM |
| **3 — Meeting capture v1** | Record/upload + long-form local transcription + two-channel speaker labels + templated Word notes + consent flow. Ask-over-meetings comes almost free | **XL** | The last big checkbox — done the private way |
| **4 — Depth** | Voiceprint naming; Book view (thin Grow); cross-client questions via per-client summaries (privacy-preserving); retention/attestation pack | M | "Which of my clients…?" + firm-conversation readiness |

**After Waves 0–2 (one small + two medium-to-large builds) the comparison chart against Jump is already ~full**, with three rows Jump can't fill: local-first/BYOK, Word-native redline, works-without-a-CRM. Wave 3 is the big investment and should only start once Waves 0–2 are validated with real advisors.

---

## Part 4 — What this collides with (flag for the board — i.e., you)

1. **The June 28 competitive report said "do NOT build meeting capture — Jump owns it."** Your June 29 board decision (compete head-on, simple AI-first app) supersedes that report's retreat advice — but the report's warning still has teeth: building capture means competing on Jump's home field, where they have a 2-year head start and $105M. The local-first design neutralizes most of that (different architecture, different buyer anxiety), but reliability expectations will be set by Jump.
2. **"NEVER a note-taker" (board stance) is compatible with this plan only if meetings ship as a *feature of the Client Map*** — one more cited source in the pile — never as the product's identity or homepage headline. Every brainstorm independently endorsed the same framing.
3. **The public vs-Jump comparison page currently promises "Advisor Prep Hero isn't a meeting-notes tool"** with a hard "No" on capture. If Wave 3 is greenlit, that page and the positioning need a coordinated rewrite (from "complementary to Jump" to "the simpler, private way to do the whole job").
4. **What parity cannot fix:** distribution (Jump's enterprise deals), a SOC 2 certificate (matters to firms; solos can accept "architecture instead of audit"), true mobile capture, and always-on capture when the laptop is closed. Sell around these honestly.
5. **Cost of the whole program**, relative: everything except Wave 3 together is roughly the size of one to two previous connector waves (the CRM write path and the productized auto-brief are the two that carry hidden depth). Wave 3 alone is on the order of the Word-engine build — the biggest single feature since 3.0.

---

## Verdict

**Feasible, and strategically coherent — in this order.** Waves 0–2 are low-risk, high-story-value, and almost entirely reuse code that already shipped. They complete every Jump comparison row except live capture. Wave 3 (capture) is a real bet — the one XL — but the local-first design turns Jump's architecture into our marketing, attacks their most-documented weakness (dropped recordings, bot resistance), and produces demo moments no cloud notetaker can copy. The features are the cheap part; users remain the scarce part.
