# 06 — Repository gap analysis: what the research asks for vs what Lantern actually has

*2026-07-11. Method: 32 needs were distilled (paraphrased, no transcript content) from the
2026-07-10 session and handed to an independent Codex agent for a read-only code
investigation of `~/lantern-plus` (its full report: `analysis-drafts/codex-repo-gap-analysis.md`).
The lead session then verified the load-bearing claims, including one material correction
about the intake program (below). Classification legend: ✅ already supported ·
🟨 partially supported · 📋 planned but absent · 🔀 built on a work branch, not mainline ·
🚫 contradicted by current product direction · 🆕 net-new.*

**A note on "the code" vs "the journal":** `docs/PRODUCT-JOURNEY.md` (2026-07-10) describes
intake waves 1–3 as built and bench-verified. That work is real but lives on the `lp/intake`
work branch (verified: `git log --all` shows intake waves 1–8 merged there; `src/features/intake`
does not exist on the `lantern-plus` mainline). Codex's classifications below reflect the
mainline checkout; where the branch changes the picture, it's marked 🔀.

---

## The headline reconciliation

The session's single strongest need — **"what's the latest and greatest on X?" answered as a
short, dated, cited timeline that reconciles a stored document against later emails** (the
umbrella-policy scenario, P1 ~00:57–01:02) — is **close but not delivered** by today's code:

- ✅ The raw ingredients exist and are strong: email ingestion + semantic search scoped per
  client (`src-tauri/src/commands/mail/`, `src/platform/rag/matterResolver.ts`), document RAG
  with citations that open the exact source (`src/features/ask/`,
  `src/features/matters/clientMap/openSource.ts`), CRM notes/tasks ingestion
  (`src-tauri/src/commands/crm/`).
- 🟨 What's missing is precisely the part she described: **dates carried through retrieval**
  (`RagHit` in `src-tauri/src/commands/rag/state.rs` has no source-date field), **recency-aware
  presentation**, and **conflict detection** ("file says $1M, email says $2M"). RightCapital/Jump
  exports already get dated-snapshot + stale-warning treatment (`src/platform/rag/sourceProvenance.ts`)
  — the pattern exists but is not generalized to documents/email/CRM.

Codex's sharpest architecture observation, which the lead endorses after verification: **the
missing shared layer is a dated "practice event" model.** Recency answers, last-contact
reports, timelines, conflict detection, service-tier due dates, and proactive reports are all
the same missing primitive wearing five costumes. Building it once (source timestamps carried
end-to-end + a per-client dated event index) turns five separate feature asks into views.

---

## Need-by-need (grouped by research theme)

### Theme: "Latest and greatest" / source-of-truth answers
| # | Need (from session) | Status | Key evidence |
|---|---|---|---|
| 1 | Cross-source reconciled answer with dated timeline + conflict flag | 🟨 | Retrieval unifies docs+email per client; no timeline builder, no conflict rule (`src/features/ask/useAsk.ts`, `src-tauri/src/commands/rag/query.rs`) |
| 2 | Recency/authority in retrieval; dates visible in citations | 🟨 | Semantic-relevance ranking only; `RagHit` carries no dates; dated-snapshot treatment exists only for RightCapital/Jump exports (`sourceProvenance.ts`) |
| 3 | Email (M365) ingestion + per-client semantic search | ✅ | `src-tauri/src/commands/mail/sync.rs`, Ask email scope in `askHelpers.ts`. Directly answers her "searching emails would be amazing" (P1 ~01:16) |
| 4 | Ask over Wealthbox content | 🟨 | Contacts/households/notes/tasks/events read + indexed (`commands/crm/render.rs`); **Wealthbox workflows and custom fields are NOT ingested** — and workflows are where her firm's process pain lives |
| 5 | Citation → source in a second | ✅ | Documents scroll-to-passage; email opens the message. CRM citations weaker (snippet only, `CrmSourcePanel.tsx`) |

### Theme: Meetings, notes, and the two-audience output
| # | Need | Status | Key evidence |
|---|---|---|---|
| 9 | Local meeting capture + transcription, with UI | ✅ | `src/features/meetings/ClientMeetingsTab.tsx`, `src-tauri/src/commands/capture/` — crash-durable, consent-handled |
| 10 | Three outputs per meeting: client-facing in firm template · internal-only "inside scoop" · every-number data sheet | 🟨 | One internal note template exists (`meetingNoteTemplate.ts`); **no client-safe/internal split, no protected internal artifact, no numbers extraction** — this is the session's clearest meetings gap |
| 11 | Firm's own note template (their 3-part format) + template→tasks conversion | 🟨 | Named meeting types exist but all use the same template; no template→task conversion. This is the exact capability Jump told her firm it cannot do — a competitive opening |
| 12 | Task extraction with include/exclude review + routing | 🟨 | The approval card and queue exist and are good (`CrmWriteReviewCard.tsx`, `crmWriteQueueStore.ts`); nothing extracts tasks from meetings into it; no route-to-colleague/workflow |
| 13 | Phone-call capture (esp. inbound) | 🟨 | No telephony; audio-file import exists (`importMeetingAudio.ts`) as an honest stopgap |

### Theme: Safe handoffs (the "lot of hands" chain)
| # | Need | Status | Key evidence |
|---|---|---|---|
| 14 | CRM write-back behind approval | 🟨→✅ | Notes+tasks with retry/dupe/stale protection + audit (`commands/crm/write.rs`). Missing: **assign task to a named teammate** and **write into a specific Wealthbox workflow** — both essential to her actual flow (she assigns planning tasks to a specific person) |
| 15 | Second-person approval routing (advisor green-lights, ops executes) | 🆕 | No proposer/approver object anywhere; queue is single-user. Her firm's core verification pattern — advisor-in-the-meeting must approve — has no rails yet |
| 16 | Quick capture → formatted, searchable CRM note | 🟨 | Dictation→meeting-artifact exists (`dictationToMeeting.ts`); no direct capture→CRM-proposal surface |
| 17 | RightCapital read/write | 📋 | Only dated export-snapshot recognition; write-socket plan exists (`docs/plans/lantern-plus/planning-write-sockets/PLAN.md`), no code, no vendor API access |
| 25 | Verified-recipient delivery of sensitive docs (1099→accountant) | 🆕 | Send panels validate email syntax only; no client↔accountant relationship record. Her "nail biter" has no rails |

### Theme: Client Map, staleness, and structured facts
| # | Need | Status | Key evidence |
|---|---|---|---|
| 18 | Completeness + per-fact freshness | 🟨 | Map exists with gaps/completeness (`src/platform/clientMap/`); facts carry `updatedAt` but UI doesn't show freshness — and her stale-map-kills-trust warning (P1 ~01:07) makes surfacing dates a trust requirement, not a nicety |
| 19 | Account-purpose / cash-needs / earmark mapping | 🟨 | Custom sections with free-text facts exist (`AddCustomSectionForm.tsx`); no typed account/purpose/amount/history model |
| 20 | Entity resolution (people, accounts, last-4 disambiguation) | 🟨 | Careful client-level matching, fails closed (`matterResolver.ts`); no account-level registry (the wrong-Roth-IRA class of error) |
| 21 | Household/couple modeling | 🟨 | Household read from CRM; `Matter` is still a single container, no typed members/ownership |

### Theme: Intake, chasing, and the client side
| # | Need | Status | Key evidence |
|---|---|---|---|
| 22 | Intake (private link, starter form, ask-once registry, document detective, email fallback) | 🔀 | Built and bench-verified on `lp/intake` (waves 1–8 commit history); NOT on mainline; docs in `docs/plans/lantern-plus/intake/`. Session evidence strongly supports the ask-once registry ("never ask a client the same question twice" landed hardest of all intake features) |
| 23 | Ongoing client portal / client to-do list with reminders | 🚫 | Explicitly out of scope today (`docs/plans/lantern-plus/welcome-journey/DESIGN.md`: "not a client portal"). Session gives it only moderate, reactive support — see 05-recommendations (Defer) |
| 24 | Document-chase reminders (clients + third parties) | 📋 | Nudge design exists in intake plans; nothing built; accountant/third-party chase not designed |
| 26 | Custodian paperwork prefill / transfer autopilot | 📋 | Plans only (`acats-autopilot/PLAN.md`, `phase-2/nigo-pre-validation.md`) |
| 32 | Scheduling: who's due, right booking link, service tiers | 🟨 | Calendly + calendar read exist (`src/platform/connectors/calendly/`, `commands/calendar/`); no service-tier record, no due-date engine, no outreach drafts. Her most mechanically-detailed pain (P1 ~01:11–01:14) |

### Theme: Proactive views and firm-level intelligence
| # | Need | Status | Key evidence |
|---|---|---|---|
| 6 | "No interaction in N months" report | 🚫→decision | No last-contact model; **explicitly scoped out** by `2026-07-02-ADVISOR-NEEDS-DISCOVERY.md` ("client-silence cadences are CRM-shaped — skip"). The session provides real counter-evidence from a target user; this is a product decision to revisit, not just a gap |
| 7 | Book-level questions / rankings | 🟨 | `wholePracticeAsk.ts` exists (summary-aggregation, good privacy design) but is **not exposed in the UI** (`ScopeToggle.tsx` lacks the option); no Book view despite the Wave 4 plan |
| 8 | Proactive standing reports | 🟨 | In-app auto-prep timer only (`useMeetingAutoprep.ts`); no scheduler, no report queue |
| 29 | "How do we do X here" firm-process assistant | 🟨 | Ask can search docs, but the data model has only client matters + `unassigned` (`src/platform/types/matter.ts`) — no first-class firm-knowledge scope with its own permissions/filter |
| 30 | Change-impact sweep ("tentacles") | 🆕 | Nothing; no plan. RAG search + a review-marking flow is the honest v1 shape |
| 31 | Approval-first posture (global) | 🟨 | Strong per-feature rails (CRM card, outbound-note gate `outboundNoteGate.ts`, email confirm); **no single shared external-action proposal/approval/audit engine** — each new connector re-invents the gate |

### Theme: Documents and artifacts
| # | Need | Status | Key evidence |
|---|---|---|---|
| 27 | Fill firm Word template with client data as tracked changes | 🟨 | Tracked-changes authoring + AI redline + template merge all exist (`lantern-docx/src/author.rs`, `DocxEditor.tsx`); missing only the "fill from Client Map facts" workflow. **But note the counter-evidence: her firm barely uses Word** — see 05 (Defer) |
| 28 | PowerPoint reading/indexing (+ OCR of embedded screenshots) | 🟨 | .pptx indexed slide-by-slide with slide-number citations (`commands/rag/indexing.rs`, `office.rs`); no OCR of images inside slides — and her firm's client decks embed investment-report **screenshots**, so slide OCR is what unlocks their #1 client-facing artifact |

---

## What the current implementation actively contradicts (worth an explicit decision)

1. **Engagement/last-contact reporting** was scoped out as "CRM-shaped" (needs-discovery doc);
   a real target user asked for exactly it, unprompted, as "really great." Revisit with eyes open:
   it pulls toward CRM territory the board said to avoid, but it's also a pure read-only view over
   data Lantern already ingests.
2. **Client portal** ("not a client portal" is in the welcome-journey design). The session
   supports only a narrow slice (intake links, reminder nudges) — the full portal remains rightly
   out of scope, but the boundary should be restated now that intake is built.
3. **"Every answer is cited" vs missing dates.** The trust story leans on citations; the session
   shows the trust question is equally **"is this current?"** Citations without dates are half the
   promise for this user.

## Where the product is ahead of what she knows to ask for
- Local meeting capture with consent rails, crash durability, and the Notice Card — she described
  Jump's cloud bot as the given; Lantern's approach directly answers her firm's inbound-call
  awkwardness and light-seat cost dynamics in ways the session never explored.
- The E2EE intake program (on `lp/intake`) already implements "never ask a client the same
  question twice" (the answer registry) — the single most enthusiastically received feature idea
  in the session.
- Whole-practice Ask exists with the right privacy architecture; it just isn't reachable in the UI.

## The five biggest build implications (lead's synthesis of Codex + session)
1. **Dated practice-event layer** (timestamps through RAG → timeline/conflict presentation) — one
   primitive, five research needs.
2. **Meeting output split** (client-facing in the FIRM's template · internal color · numbers
   sheet) + **template→tasks into the existing approval queue** with assignee + workflow routing —
   this combination is precisely what Jump told her firm it cannot do.
3. **Shared proposal/approval/audit engine** with a second-approver option — turns her firm's
   verification culture into product rails and makes every future connector safer and cheaper.
4. **Slide OCR** — small, unlocks the PowerPoint decks that are this firm's real client-facing
   source of truth.
5. **Merge-or-kill decision on `lp/intake`** — finished, verified work delivering the session's
   most-loved concept is sitting unmerged on a side branch.
