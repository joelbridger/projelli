# 2. The kill sheet — Jump vs Lantern at program completion

*Ground truth: Jump's side = the verified 2026-07-02 feature inventory (168 help-center
articles + all product pages + press, triple-swept). Our side = the five wave plans as
written + what already ships in the 3.3.5 base — NOT aspiration. Status honesty: Waves
0–2 are built and bench-verified; Waves 3–4 are in build now, and Wave 3 carries a
hardware proof-spike and Jameson go/no-go gate. Items below marked with their wave so
nobody sells vapor.*

**Verdicts:** **BEAT** (we do it better, and here's concretely why) · **MATCH** (parity,
no meaningful difference) · **DIFFERENT** (we deliberately answer it another way — with
the sales story) · **GAP** (they win this row today, honestly).

## 2.1 Before the meeting (prep)

| Capability | Jump | Lantern | Verdict |
|---|---|---|---|
| Auto prep briefs | Cited briefs pulled from connected systems (CRM, planning, portfolio, tax, email, past meetings) | Wave 1: auto-generated on app open for every matched meeting, from the client's **entire local file pile** + email + meetings + CRM reads, cited, exported to real .docx | **BEAT** — deeper sources: we read the 20 years of documents no integration reaches. Honest caveat: their *structured* coverage (live planning/portfolio feeds) is broader than our reads today |
| Calendar integration | Outlook + Google | Wave 1: Outlook + Google + ICS-URL fallback (any calendar app), read-only-scoped, encrypted at rest | **MATCH**+ (ICS covers the long tail; Google pending their verification review — test-users-only until approved) |
| Client-facing agenda | Meet builds agendas | Wave 1: agenda export as a clean client-shareable Word doc, internal content stripped | **MATCH** (ours is a real .docx) |
| Meeting scheduling / booking pages | Compliant Scheduling: branded booking pages + disclosures | Calendly integration; no booking pages | **DIFFERENT** — "your scheduler already works; we read it." Booking-page disclosure blocks noted for the future |
| Prep visuals (portfolio charts in briefs) | Yes (portfolio-connector-fed) | Backlogged (needs portfolio data we don't hold) | **GAP** (small; solo ICP impact low) |

## 2.2 During the meeting (capture)

| Capability | Jump | Lantern | Verdict |
|---|---|---|---|
| Video-call capture | Bot joins Zoom/Teams/Meet/Webex/GoTo (host-independent on several) + web recorder | Wave 3: system-audio loopback + mic on the advisor's machine — **any** platform by construction, **no bot in the room**, no cloud | **BEAT** for desk meetings: nothing announces itself to the client, nothing uploads, works on platforms Jump needs per-platform bot support for. **The trade:** advisor's machine must be in the meeting |
| Phone-call capture | 9 dialer platforms + "call a Jump number" dial-in | Phone-through-computer captured by loopback; phone-recording import bridge | **DIFFERENT/GAP** — softphone-at-desk covered; true any-phone dial-in is an accepted gap (needs cloud telephony we won't build) |
| In-person capture | Mobile apps + in-person mode | Wave 3: conference-room mode (mic + attendee prefill); Wave 4 diarization for multi-voice | **MATCH** at the desk/office; **GAP** away from the machine |
| Mobile capture apps | Real, top-rated iOS/Android (4.9/5) | None. Bridge: any phone recorder → synced folder → auto-transcribe | **GAP** — named, accepted. Qualify mobile-first advisors out of the replace pitch |
| Capture without the advisor's machine (closed laptop, absent advisor) | Yes (bot/cloud) | No — architecturally | **GAP** — the trade IS the product; own it out loud |
| Transcription | Cloud; XYPN accuracy 3.5/5 (lowest of advisor tools tested); documented dropped recordings | Wave 3: **fully local**, crash-durable chunked recording (force-quit → recover → finished notes is an acceptance test), works with network unplugged | **BEAT on architecture + durability story; accuracy/reliability parity must be PROVEN in pilots before we say it out loud** |
| Speaker attribution | Diarization + AI role labeling; imperfect | Wave 3: two-channel physics (you/them, no guessing) + Wave 4 local diarization + voiceprint naming ("Looks like Sarah, 82%") stored encrypted per client | **BEAT in common desk calls** (channel = truth); multi-person rooms need Wave 4 proof |
| Consent handling | Cloud-analyzed auto consent detection | Wave 3: consent dialog + state-law-aware table + per-client ledger + **local** deterministic verbal-consent detection (additive evidence only) | **BEAT** — the consent question itself never leaves the machine (their cloud reads the conversation even to detect consent) |
| Video recording | Yes | No — audio + transcript only, deliberately | **DIFFERENT** — "video of your clients on a vendor's server multiplies risk for zero advisory value" |
| Dictation notes | Yes (Mobile Assistant heritage) | Wave 3: dictation → meeting-note pipeline | **MATCH** |

## 2.3 After the meeting (notes → tasks → CRM → follow-up)

| Capability | Jump | Lantern | Verdict |
|---|---|---|---|
| AI meeting notes | Templated, customizable, app-locked text + PDF export | Wave 3: templated **real .docx** with Word checkboxes, every bullet carrying a timestamp citation back to the exact transcript moment; uncited bullets dropped (anti-hallucination test) | **BEAT** — your notes are your files, in Word, with receipts; their notes live in their app |
| Firm-enforced note templates | Yes | Wave 4: admin-locked template policy (firm tier) | **MATCH** |
| Task extraction with due dates | Yes | Waves 2/3: structured extraction, due dates from spoken commitments | **MATCH** |
| CRM write-back | 13+ CRMs, incl. field-level "blended updates" with 3-column review; approval-gated | Wave 2: Wealthbox notes + tasks + field-level blends with the same 3-column review, **plus** idempotency ledger, double-post recovery, stale-guard, PII-clean audit logging. Redtail/Salesforce trait-ready, credential-gated | **MATCH on Wealthbox depth (BEAT on write-safety machinery); GAP on CRM breadth** — 1 live vs 13+. The sales story: "your CRM, done deeply" — and the live-API probe must clear before we claim even Wealthbox publicly |
| Compliance logs to CRM | Yes | Wave 2: optional approval-gated compliance-summary note | **MATCH** |
| Follow-up email | Drafted "within a minute," sent via Jump's rails (needing their own e-comms supervision product) | Wave 0 (built): draft into the advisor's **own** Outlook/Gmail Drafts — review and send from their real inbox; recipients never AI-chosen (injection-proofed) | **BEAT** — rides the firm's existing archiving/supervision; a whole compliance surface Jump needs, we don't, by architecture |
| Post-meeting speed | "~1 minute" (vendor-asserted) | Local pipeline; notes at stop | **MATCH-ish** — don't race a vendor-asserted number; sell "before you're back at your desk" |

## 2.4 Intelligence (the ask layer — our home field)

| Capability | Jump | Lantern | Verdict |
|---|---|---|---|
| Ask-anything | AI Associate (Mar 2026): grounded in CRM/planning/email/meetings, action execution with approval; early-access, chat history "coming soon" | Ask (shipping today): cited answers over the client's **entire document pile** + email + meetings, per-client crypto isolation, refuse-rather-than-bluff | **BEAT** — shipped vs early-access; documents vs connected-systems-only; citations to the exact source |
| Document intelligence | Intake/field-extraction for account opening — not folder reasoning | Whole-pile RAG + OCR + estate/beneficiary mismatch detection (Wave 4, deterministic, no-LLM) | **BEAT** — this is the structural gap in their product (verified 06-28, unchanged) |
| Unified client profiles | "Evergreen" profiles fed by meetings/CRM | Client Map: cited, curated, completeness-scored, gap-flagged | **BEAT** on citations + gap analysis; their live structured feeds refresh from more connected systems |
| Book-level view | Grow dashboards, Signals, Scorecards (+$50/mo) | Wave 4: Book view (completeness/staleness ranking) + whole-practice Ask (summaries-only isolation) | **DIFFERENT** — we deliberately refuse revenue/sentiment surveillance; sales story: "insight without informing on your clients" |
| Keyword tracking | Per-meeting analytics | Wave 4: local per-client topic chips, no dashboards | **MATCH** (shaped to our stance) |
| Benchmarks from aggregated transcripts | Yes — the Insights product | Never — structurally impossible for us | **DIFFERENT** — attack line #11: "your clients' conversations never train anyone's benchmarks" |
| MCP / API access | MCP on all plans (Jun 2026); enterprise API | Local MCP server BACKLOGGED (our answer: your agent tools reach your data locally) | **GAP today / DIFFERENT later** — and their MCP carries the unfiltered-egress disclosure we can quote |

## 2.5 Compliance & trust

| Capability | Jump | Lantern | Verdict |
|---|---|---|---|
| Retention controls | Auto-delete, summary-only, zero-transcript options (server-side) | Wave 4: retention engine with **fail-closed** config, hash-chained audit, sweep tests (a "deleted" chunk surviving is a hard test failure) | **MATCH on features, BEAT on verifiability** — deletion on your own disk is inspectable; deletion on their cloud is a promise |
| Redaction | Compliance-settings redaction | Wave 4: local redaction = true deletion (must not survive in .docx revision nodes, RAG index, or caches — enumeration-tested) | **BEAT** on rigor |
| Attestation / audit | Attestation tracking, audit trails, compliance dashboard (enterprise) | Wave 4: one-click attestation .docx + append-only encrypted audit log + printable Data Map | **MATCH** for solo/small; **GAP** on enterprise admin dashboards (deliberate) |
| SOC 2 | Type II claimed, Vanta trust center | None | **GAP** — never claim otherwise; the counter is architecture ("less to vet"), the entity, and honesty |
| Books-and-records (204-2) | Records live in Jump; export on exit | Notes/transcripts/briefs are files on the advisor's machine; their existing archiving applies | **BEAT** — "your records are your files" is the native shape of the rule |
| E-comms supervision | A product they had to build (they originate comms) | Not needed — follow-ups send from the advisor's inbox | **BEAT by architecture** (with the red-team's caveat: some firms will still want AI-draft audit records — our audit log is the answer) |

## 2.6 Where they simply win (the consolidated honest-gap list)

1. **Mobile apps** (capture, AI Associate, widget — real and top-rated).
2. **Capture anywhere** (closed laptop / absent advisor / any-phone dial-in).
3. **Integration breadth** — 40+ live integrations vs our top-connectors-done-well
   (+ several code-complete but credential-gated: Redtail, Salesforce, DocuSign).
4. **Enterprise machinery** — SSO/SCIM depth, admin dashboards, usage analytics,
   Intune, procurement/support apparatus, SOC 2.
5. **Account-opening execution** — pre-fill and transmit to Schwab; we stop at
   organize/extract ("we don't file with Schwab — yet").
6. **Client-facing surfaces** — forms, surveys, booking pages (deliberate skip).
7. **Proof.** 35,000 users, enterprise references, category awards. We have zero
   customers. Every "BEAT" above is an architecture-and-build claim until pilots
   convert it into a witnessed claim.

## 2.7 The five beats that carry the sales deck

If an advisor remembers only five rows:

1. **No bot, no cloud** — the meeting never leaves your machine (Wave 3).
2. **We read everything** — answers cited from the whole client file pile, not just
   what's connected (today).
3. **Real Word notes with receipts** — every bullet clicks back to the moment it was
   said (Wave 3).
4. **Your CRM, written to safely** — approval card, diff preview, no double-posts
   (Wave 2).
5. **Half the price, and the AI bill is yours at cost** (section 4's math).

## 2.8 Claim-discipline register (before anything public)

- Wealthbox write claims: **after** the live-API probe clears (it merged on mocks).
- Google Calendar: **test-users-only** until Google's verification approves
  (submission is Jameson-gated).
- Capture reliability/accuracy superiority: **after** real-pilot evidence (the
  Wave 3 acceptance bar is the internal proof; pilots are the public proof).
- Redtail/Salesforce/DocuSign: "ready pending vendor credentials," never "live."
- The public vs/jump.html page currently says Lantern *isn't* a meeting-notes tool
  and contains a stale advisor count, a wrong-looking HIPAA credit to Jump, and
  "plain Markdown" file-format copy — it must be rewritten when Wave 3 merges
  (already flagged in the master plan; see section 8, open question 5).
