# Codex adversarial review of ASSESSMENT.md (2026-07-02) — all 12 findings were incorporated into the final doc

Read-only review done. The assessment has a strong strategic idea, but it is too optimistic in several places. Main issues:

1. **High — “full parity” is overstated and contradicted later.**
   Quote: “**One genuinely big build stands between Keepance and full parity: meeting capture.**” [ASSESSMENT.md](/home/jameson/lantern-jump-feasibility/ASSESSMENT.md:13)
   The same doc later says parity cannot fix distribution, SOC 2, true mobile capture, and always-on capture [ASSESSMENT.md](/home/jameson/lantern-jump-feasibility/ASSESSMENT.md:112). Recommended change: say “credible sales-deck parity for solos/small RIAs,” not “full parity.”

2. **High — the “70% already exists” claim is not well-supported.**
   Quote: “**Roughly 70% of Jump's feature list is something Keepance already has, or nearly has**” [ASSESSMENT.md](/home/jameson/lantern-jump-feasibility/ASSESSMENT.md:11)
   The feature table includes many partial, skipped, or thin-v1 rows: mobile, 30-42 integrations, compliance, doc intake, task extraction, CRM write-back, calendar, meeting capture. Recommended change: define the denominator and split into “have,” “partial,” “thin story,” and “skip.”

3. **High — CRM write-back as `M` is too optimistic.**
   Quote: “**CRM sync (write notes/tasks)… Real gap — write-back on the existing connector | M**” [ASSESSMENT.md](/home/jameson/lantern-jump-feasibility/ASSESSMENT.md:37)
   The real Wealthbox client says “Read-only: GET requests only” and never creates/updates/deletes records [client.rs](/home/jameson/keepance/src-tauri/src/commands/crm/client.rs:1). The Codex readiness report calls CRM write-back **Large** because it needs write APIs, mapping, retries, duplicate protection, conflict handling, and audit [codex-codebase-readiness.md](/home/jameson/lantern-jump-feasibility/codex-codebase-readiness.md:33). Recommended change: mark Wealthbox note/task write-back as `L` or `M/L`, and Redtail/Salesforce as separate unknowns.

4. **Medium — calendar as `M` is plausible only for read-only import, not the full “morning moment.”**
   Quote: “**Calendar integration… Real gap — but cheap: the Microsoft/Google login plumbing already exists for email | M**” [ASSESSMENT.md](/home/jameson/lantern-jump-feasibility/ASSESSMENT.md:33)
   Current code has no Google/Outlook calendar sync; only Calendly scheduled-event metadata [keepance-current-map.md](/home/jameson/lantern-jump-feasibility/keepance-current-map.md:34). The Calendly client is explicitly GET-only [client.rs](/home/jameson/keepance/src-tauri/src/commands/calendly/client.rs:1). Recommended change: keep `M` for read-only calendar import, but call automatic overnight briefs `M/L` unless the app-running/background behavior is scoped down.

5. **Medium — pre-meeting prep is not “missing only” a calendar trigger.**
   Quote: “**~85% — missing only the automatic calendar trigger**” [ASSESSMENT.md](/home/jameson/lantern-jump-feasibility/ASSESSMENT.md:32)
   The template exists, but a Jump-like prep feature also needs attendee-to-client matching, recurring-event handling, source selection, brief caching, UI, refresh timing, and failure states. Recommended change: “the content engine is strong; the productized auto-brief workflow is still new.”

6. **High — Outlook/Gmail “drafts folder” is unsupported by code.**
   Quote: “**the draft lands in the advisor's own Outlook/Gmail drafts folder**” [ASSESSMENT.md](/home/jameson/lantern-jump-feasibility/ASSESSMENT.md:79)
   The backend has `mail_send`, which sends immediately [mod.rs](/home/jameson/keepance/src-tauri/src/commands/mail/mod.rs:1924), and Graph uses `/sendMail` [graph.rs](/home/jameson/keepance/src-tauri/src/commands/mail/graph.rs:333). The UI has an in-app AI draft textarea, copy, mailto, and send, but I found no provider draft-save command [EmailViewer.tsx](/home/jameson/keepance/src/features/email/EmailViewer.tsx:274). Recommended change: say “in-app draft,” or add real mailbox draft creation to scope.

7. **Medium — Ask-over-meetings as `S` is under-scoped.**
   Quote: “**Ask over past meetings… ✅ Nearly free once capture exists | S**” [ASSESSMENT.md](/home/jameson/lantern-jump-feasibility/ASSESSMENT.md:40)
   Allowlisting `meeting` only means the index can store that source type. It does not provide a meeting artifact model, speaker/timestamp chunking, meeting filters, audio timestamp citations, or transcript cleanup. Recommended change: `S/M` after transcripts exist; `M` if audio-linked citations are included.

8. **Medium — “two-channel trick gets 90% free” is too strong.**
   Quote: “**Speaker labeling… our two-channel trick gets 90% free**” [ASSESSMENT.md](/home/jameson/lantern-jump-feasibility/ASSESSMENT.md:39)
   Mic/system split gives “advisor vs everyone else,” not reliable client-level diarization. It breaks down for couples on one laptop, in-person meetings, phone speakerphone, shared conference rooms, and system-audio bleed. Recommended change: “cheap advisor/client-side split for common 1:1 video calls; real diarization remains `L/M` risk.”

9. **Medium — “recordings can’t be dropped” is too categorical.**
   Quote: “**Recordings can't be dropped.**” [ASSESSMENT.md](/home/jameson/lantern-jump-feasibility/ASSESSMENT.md:68)
   Local recording avoids upload failures, but it can still fail from app not running, OS permission failure, disk space, laptop sleep, device switching, or audio-driver problems. Recommended change: “fewer cloud-transfer failure modes; still needs crash recovery and capture reliability work.”

10. **Medium — connector readiness is oversold as only paperwork.**
   Quote: “**already written and merged, waiting only on vendor API keys. That's paperwork, not engineering**” [ASSESSMENT.md](/home/jameson/lantern-jump-feasibility/ASSESSMENT.md:52)
   The code does show many read-only connector modules, but several are not live-verified, Zocks is called provisional in the Codex report, and vendor credentials often expose schema, auth, quota, and production-review work. Recommended change: “mostly built, but live-vendor validation remains.”

11. **Medium — Jump export “flow into Keepance” is too automatic.**
   Quote: “**their Jump notes flow into Keepance via Wealthbox/SharePoint today**” [ASSESSMENT.md](/home/jameson/lantern-jump-feasibility/ASSESSMENT.md:50)
   The code recognizes saved/exported Jump notes after they land somewhere Keepance watches; it explicitly says Keepance does **not** integrate with Jump [sourceProvenance.ts](/home/jameson/keepance/src/platform/rag/sourceProvenance.ts:5). Recommended change: “Keepance can recognize Jump notes once exported/synced into an existing watched source.”

12. **Low — AI Associate comparison is too dismissive.**
   Quote: “**our approval-gated version is the same minus the cloud**” [ASSESSMENT.md](/home/jameson/lantern-jump-feasibility/ASSESSMENT.md:47)
   Jump’s AI Associate can create CRM records with approval; Keepance does not yet have CRM write actions. Recommended change: “philosophically similar approval model, but Keepance lacks the action layer today.”

Bottom line: the doc is directionally useful, but it should be toned down from “feature-for-feature/full parity” to “a credible, local-first alternative for the highest-value solo/small-RIA workflows.” The largest estimate corrections are CRM write-back, real mailbox drafts, Ask-over-meetings, and compliance.
