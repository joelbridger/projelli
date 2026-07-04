# The Provable Privacy Record — design

*Tier C flagship design (E4, with E5-retention, R10, and R2 folded in), per the Jameson-approved trust-tier plan. Fable 5 design pass, lane `lp/trust-tier-c-design`, 2026-07-05. Answers `docs/design/2026-07-04-skeptical-advisor-trust-review.md` (E4/E5/R10/R2) and `2026-07-04-trust-review-coordinator-recommendations.md` (Tier C). Design only — build lanes follow. Style sibling: `docs/strategy/2026-07-04-notice-participant-design.md`.*

## What it is, in one sentence

For every AI interaction, per client, the app keeps a tamper-evident record of **what left this machine and what the AI read to produce each answer** — retained under the same hash-chained, fail-closed audit machinery that already exists — and can hand a compliance officer a per-client bundle whose integrity they can verify themselves, offline, without trusting us.

**The sentence we're designing for:** *"Show me exactly what produced this answer, and prove my client's data never left"* — answered with evidence, not assertion.

## The gap, precisely (what exists, what stops one step short)

The trust review's E4 finding is that every piece exists but none of it is retained as *proof*:

- **"What left" is already recorded and already tamper-evident.** Every AI send emits an `egress` audit event — `{provider, model, mode, destination, dataLeaves, scope}` (`src/platform/types/audit.ts:421-444`) — from ~11 call sites (e.g. `src/features/ask/hooks/useChatSending.ts:911`, `src/features/documents/docx/redline.ts:296`, `src/features/meetings/generateBrief.ts:193`). `egress` is in `CRITICAL_ACTIONS` (`src/platform/audit/AuditService.ts:56-80`), so it is durably awaited into the SQLCipher store.
- **The store is the real thing.** `<workspace>/.lantern/audit-enc.db`, SQLCipher-encrypted with a dedicated keychain key (`lantern-audit-enc`, `src-tauri/src/identity.rs:44`), SHA-256 hash-chained per entry (`compute_entry_hash`, `src-tauri/src/commands/audit/store.rs:155-160`), sealed with a chain-head record (`chain_head_v1`, `store.rs:52,189-198`), guarded by an AUTOINCREMENT high-water mark against full wipes (`store.rs:210-230`), **fail-closed** (appends refused when the seal is missing but rows survive, `store.rs:349-373`), with verify (`verify_chain`, `store.rs:650-699`) and an anomaly-minting repair path (`store.rs:717-796`).
- **"What the AI read" is fully known at answer time — and then discarded.** Retrieval returns `RagHit[]` with a content-addressed chunk `id`, `path`, `sourceId`, `matterId`, `chunkText`, `paragraphIndex`, `pageNumber`, `sourceType`, `privilege` (`src/platform/utils/tauri-commands.ts:138-172`). But the only audit trace is `retrieval_executed` with `{query, scope, hitCount, topScore}` (`useChatSending.ts:674-683`) — *"8 results"*, not *which eight*. Exactly the E4 evidence.
- **Citation verification already proves content matches.** `rag_verify_citation` does a point-lookup by chunk id scoped to the claimed `matterId`, decrypts the stored text, and compares (`src-tauri/src/commands/rag/verify.rs:25,60-81`), yielding `verified | notFound | matterMismatch | textMismatch` per cite (`src/platform/types/ai.ts:206-210`).
- **The reporting surfaces all read the same two sources** — `resolveEgress()` (`src/platform/privacy/egress.ts:171-236`) and the audit log's `egress` entries. The Confidentiality Report is `buildConfidentialityReport(entries)` (`src/platform/privacy/confidentialityReport.ts:145-205`); the retention attestation already merges `auditList()` + `auditVerifyIntegrity()` + the per-client consent ledgers into a `.docx` (`src/platform/privacy/attestation.ts:67-135`).

So the design problem is narrow and good: **join what-left to what-was-read, per interaction, per client; retain it in the chain that is already tamper-evident; and make the proof exportable and independently checkable.** No new integrity mechanism, no new store, no new crypto.

---

## Part 1 — The record: one provenance event per AI interaction

### 1.1 The event

A new structured audit event, **`answer_provenance`**, appended once per AI interaction at answer completion. It joins the `AuditEvent` union (`src/platform/types/audit.ts:202-455`) and the `AuditActionType` union, and is added to `CRITICAL_ACTIONS` so its write is durably awaited like `egress`.

```ts
type AnswerProvenanceEvent = {
  type: 'answer_provenance';
  timestamp: string;
  payload: {
    interactionId: string;          // uuid minted at send time — the join key
    surface: 'ask' | 'meeting-notes' | 'redline' | 'client-map' | 'workflow'
           | 'email-draft' | 'agenda' | 'brief';    // which feature produced it
    scope: AuditScope;              // same frozen send-time scope as the egress event
    outcome: 'completed' | 'cancelled' | 'failed';

    // What left (duplicated small, so each record is self-contained for export)
    provider: string; model?: string;
    mode: ConfidentialityMode; destination: EgressDestination; dataLeaves: boolean;

    // What the AI read — the retrieved set actually placed in the model's context
    sources: Array<{
      sourceId?: string;            // '/path/file.pdf' | 'mail:<message-id>' | 'meeting:<dir>#<ms>'
      basename: string;             // human-readable name for the CCO
      chunkId?: string;             // content-addressed RAG chunk id (the citation key)
      sourceType?: string;          // 'pdf' | 'mail' | 'transcript' | …
      paragraphIndex?: number; pageNumber?: number;
      privilege?: string;           // carried through from RagHit
      snippetSha256: string;        // hash of the exact chunkText sent — never the text
      cited?: 'verified' | 'notFound' | 'matterMismatch' | 'textMismatch';
    }>;
    attachments?: Array<{ name: string; sha256: string }>;

    // Binding hashes
    querySha256: string;            // the user's question as sent
    contextSha256: string;          // ordered concat of snippet texts + attachment hashes + query
    answerSha256?: string;          // final assistant text (absent when cancelled pre-first-token)
  };
};
```

Three additive companions, no renames:
- The `egress` payload gains optional `interactionId` (additive field; existing consumers unaffected).
- The saved `.aichat` message gains `interactionId` alongside its existing `sources` field, so a stored answer can be re-hashed and matched to its record.
- `describeAuditEvent` (`AuditService.ts:635-650`) gains a one-liner: *"Answer recorded — 8 sources read, 4 cited (all verified), sent to Anthropic (BYOK)"*.

### 1.2 Snippet hashes, not snippets — the argued trade-off

**Decision: the record stores identifiers and hashes, never content.** Three reasons, in order of weight:

1. **The record must not become the honeypot.** The audit DB is per-*workspace* (`store.rs:528-530`), not per-matter. Full snippets would concentrate the most sensitive excerpt of every client's file into one file — the exact opposite of the matter-isolation story ("client-scoped with cryptographic isolation"). Metadata (file names, chunk ids, hashes) matches the exposure level the audit log already carries in its descriptions; full content would be a new, worse exposure class.
2. **Content already lives in two better places.** The chunk text is durably persisted in the AES-256-GCM-encrypted RAG store (`src-tauri/src/commands/rag/crypto.rs:11-44`), retrievable and *verifiable* by chunk id via the existing `rag_verify_citation` machinery — and the full `chunkText` is also saved in plaintext inside the `.aichat` conversation file (`useChatSending.ts:825,1713-1714`). Duplicating it a third time buys nothing.
3. **Hashes survive retention; snippets would fight it.** When retention legitimately deletes a transcript, a record holding its hash still proves *"this content existed and matched"* (the R10 requirement) without the record becoming a retention-evading shadow copy of deleted content. A record holding snippets would mean "Summary only" never really deletes anything — a falsehood in the other direction.

The cost, stated honestly: a hash alone can't show a CCO *what* was read — only prove that what they're shown is what was read. The export bundle (Part 3) closes this with an opt-in **excerpts** section drawn live from the workspace at export time, verified against the recorded hashes as it's assembled. Proof lives in the chain; content stays in the workspace and is fetched only when a human deliberately exports it.

### 1.3 Where it lives — the same chain, and why the alternatives lose

**Decision: extend the existing SQLCipher audit store. No new store, no per-client record files.**

- **The brief's constraint is also the correct engineering call:** the seal + high-water-mark + fail-closed + repair machinery took real work to get right (`lp/audit-chain-failclosed`, merged at `5af15e5e`) and is tested against the nasty cases (truncated-prefix-plus-deleted-seal, full wipe, corrupt seal — `store.rs:1161,1259,1334,1387`). A second integrity mechanism would double the attack surface and halve the scrutiny each gets.
- **Per-client record files fail the whole-practice case.** A whole-practice Ask sends a digest of *every* client in one request (trust review R6; `wholePracticeAsk.ts:27`). That interaction belongs to no single client file; in a per-client layout it either duplicates N times (N seals to keep consistent) or falls into a "general" file that breaks the per-client story. In one chain, it's a single record with `scope: allMatters`, and per-client export filters it in for every client whose sources it touched (flagged as whole-practice — which is itself useful evidence for the R6 conversation).
- **No schema migration needed.** The persisted shape is five stable columns with the full event JSON in `payload_json`, hashed verbatim into the chain (`store.rs:30-44,138-153`; round-trip at `AuditService.ts:88-134`). A new event type is a TS-side change; Rust neither knows nor cares. That makes Rung 1 small and low-risk.
- **The layer DAG stays clean.** Event types in `src/platform/types/audit.ts`; the payload builder and hashing in `src/platform/audit/` (hash util from `lib/`); emit sites in `features/ask` (features → platform, allowed); export assembly in `src/platform/privacy/` beside `confidentialityReport.ts`; UI in `features/privacy` and the matter surface. Nothing imports rightward.
- **The E2EE-relay rule is untouched.** The record never syncs. On firm tier, each seat's record covers what *that machine* sent — which is the honest unit anyway (egress is a per-machine fact). Firm-wide aggregation, if ever wanted, composes per-seat export bundles; no plaintext (and in v1, no ciphertext either) ever goes through the relay.

### 1.4 The write path — why Ask stays fast

Where it hooks: retrieval completes and `retrievedSources` is fully known at `useChatSending.ts:539-588`; the answer completes (with per-citation verdicts) at `useChatSending.ts:1699-1714` (streaming) and `:1763-1785` (non-streaming); the cancel path is `:930-958`. One `answer_provenance` event is emitted at the completion/cancel site — after the final text is already on screen.

Cost accounting, against what already happens per interaction:
- The flow already emits 4+N audit events per Ask (`scope_active`, `privilege_evaluated`, `retrieval_executed`, `egress`, N × `citation_verified` — all in `useChatSending.ts:662-683,440-446,1731`), and `egress` is already durably awaited. We add **one** event, not per-source events.
- Hashing is WebCrypto `subtle.digest` over text already in memory (a few KB per snippet, tens of KB total) — sub-millisecond to low-millisecond, off the perceptible path because the answer has already rendered. The `.aichat` save (`onSave`, `:1713`) already writes the *full snippet text* to disk per answer; hashing the same bytes is strictly cheaper than a write we already do.
- The Rust append is one INSERT in its own transaction on `spawn_blocking` (`store.rs:567-622`, `mod.rs:60-68`) — the same cost as the `egress` append the flow already pays.

**Failure semantics — recording is evidence, not permission.** If the provenance append fails (e.g. the chain is fail-closed on a missing seal), the answer is *not* blocked — but the failure is never silent: the existing `auditPersistenceStatus: 'failed'` stamp (`AuditService.ts:556-563`) drives a visible per-message state — *"This answer isn't in your privacy record"* — mirroring how the Notice Kit refuses to log unconfirmed clipboard copies rather than fake evidence (`noticeClipboard.ts`). A firm-policy hook (later rung, riding the Standard/Strict precedent of `meetings.noticePolicy`, `src/platform/settings/schema.ts:606`) can invert this for firms that want it: in Strict, a cloud send is refused while the record is unhealthy. Default stays "answer first, honest flag" — a broken audit DB must never brick the advisor's workday.

### 1.5 Beyond Ask — the other ten egress sites

Ask is the flagship and Rung 1. The same `answer_provenance` shape covers the other surfaces because their input sets are equally known at call time: meeting-notes generation reads one transcript (`generateBrief.ts:193`), redline reads one document (`redline.ts:296`), Client Map generation reads its fact set (`clientMap/generator.ts:124`), the follow-up draft reads one note (`DraftFollowUpModal.tsx:158`). Each gets `sources: [the thing it read]` with content hashes. This is deliberately a separate rung per the ladder — mechanical, low-judgment, delegable — but the schema is designed for it from day one (`surface` field).

---

## Part 2 — Retention, rethought (E5 + R10)

### 2.1 The examiner's inversion, named

Today's `summary-only` mode deletes `audio.wav` *and* `transcript.json` once `notes.docx` exists (`src-tauri/src/commands/retention/sweep.rs:309-323`) — i.e., it destroys the accurate record and keeps the AI's interpretation. Given the review's E3 (notes can hallucinate), that is precisely backwards for anyone subject to books-and-records instincts, and the current copy (`src/locales/en.json`, `privacy.retention.mode-summary`) presents it as a neutral disk-space choice.

### 2.2 The retention matrix

| Mode | Keeps | Deletes | Solo default | Firm posture | Framing |
|---|---|---|---|---|---|
| **Keep everything** | audio + transcript + notes | temps only | **Default** (today: `retentionPolicyStore.ts:22`) | **Default** | "The complete record." |
| **Delete audio after N days** | transcript + notes | audio, imports | Offered, promoted | Recommended disk-saver | "Audio is big; text is small. The accurate record stays." |
| **Summary only** | notes only | audio + transcript | Offered **with a compliance warning** | **Requires an explicit firm-admin policy override** (enforcement rung rides the firm policy mechanism; until then, the strongest warning copy) | "This keeps the AI's summary and deletes the accurate transcript — the opposite of what compliance reviews usually want." |

**Summary-only survives — for solo, warned.** It's the advisor's data and some genuinely want minimal records; deleting the mode would be paternalism. What cannot survive is the *neutral framing*. The warning is in the product's honest voice, shown at selection time and echoed in the settings row: *"Most books-and-records guidance wants the transcript kept, not the summary. If your firm is subject to SEC or FINRA record rules, choose a mode that keeps the transcript."* On firm tier the mode is policy-gated off by default.

Retention stays per-workspace in mechanism (`SK_RETENTION_POLICIES`, `src/config/identity.ts:58`) — the matrix changes defaults, copy, and gating, not the storage design.

### 2.3 The citation-integrity rule (R10): deletion annotates, never dangles

Today, notes cite the recording with `[t:<ms>]` tokens rendered as seek chips (`TranscriptViewer.tsx:59-94`), and Client Map facts hold `meeting:<dir>#<ms>` refs (`meetingSources.ts:11-18`). After a sweep deletes the audio/transcript, those chips still render and **clicking them is a silent no-op** (`MeetingEntry.tsx:90-108,174-177`) — a "verifiable" note quietly becomes unverifiable. The rule this design sets:

> **A citation whose source was deleted is annotated, never silently dangling — and the record retains the hashes, so "it existed and matched" stays provable after deletion.**

Concretely:
1. **Hash before unlink.** The sweep's per-unlink audit callback (`DeleteAudit`, `sweep.rs:56-66`) gains a content SHA-256 computed immediately before deletion, recorded in the chained `retention_delete` event: *"transcript.json (sha256 abc…) deleted under policy summary-only."* Rust-side, inside the same blocking call — crash-safe like the rest of the sweep.
2. **Annotate on render.** When `MeetingEntry` finds the transcript/audio gone, `[t:ms]` chips render in a "source removed" state with plain-language hover copy: *"The recording this cites was deleted on <date> under your retention policy. Its fingerprint is kept in your privacy record, so this note's sourcing remains provable."* Client Map `meeting:` refs that fail to resolve get the same state — never a dead click.
3. **Warn at the moment of choice.** Selecting a deleting mode in `RetentionSettings.tsx` states the consequence: *"Notes that cite deleted recordings will show 'source removed'."*
4. **The synergy that already exists, kept:** the retention sweep is already fail-closed on a broken audit chain (`preflight_audit_store` + `reject_if_chain_altered`, `src-tauri/src/commands/retention/mod.rs:19-44`) — retention cannot destroy evidence while the evidence log itself is in doubt. The provenance record inherits this protection for free.

The provenance record completes the loop: a meeting-notes `answer_provenance` event records the transcript's chunk hashes at generation time, so even years after a policy deletion, the bundle can show a CCO: *this note was generated from a transcript with this fingerprint; here is the deletion event, under this policy, on this date; the chain over both is intact.*

---

## Part 3 — What the compliance officer receives

### 3.1 The bundle

One folder (or zip), exported per client from the Privacy Center or the client's own surface — **a local file write, never a network send** (the `fs.writeFile` pattern of `attestation.ts:129-134`):

```
Privacy Record — Henderson — 2026-07-05/
├── report.docx        # the human cover — readable by a CCO in Word
├── record.json        # the evidence — every disclosed record + the chain spine + the seal
├── verify.html        # the self-contained offline verifier (double-click, drag record.json, green/red)
└── excerpts/          # OPT-IN — cited snippets pulled live from the workspace at export time,
                       #   each checked against its recorded hash as it's copied
```

**`report.docx`** evolves the existing attestation export rather than adding a fourth surface (§3.3): client + period + generation time; the honest mode-mix attestation sentence (reusing `pickAttestation`, `confidentialityReport.ts:68-143`); per-interaction table (when · surface · destination/model · N sources read · N cited/verified · recorded ✓); the consent & notice trail (from the client's `.consent-ledger.json` — entries and notices, as `attestation.ts:95-110` already reads them); the retention policy + any deletion events affecting this client, with retained fingerprints; the chain-integrity verdict; and a **checkpoint line** — the chain-head hash and entry count at export time, with one sentence telling the CCO to keep it: *"Bundles exported later must agree with this line about everything before it."*

**`record.json`** is the machine layer: full audit records for this client's disclosed events (`egress`, `answer_provenance`, `retrieval_executed`, `retention_delete`, consent-mirror events), plus the **chain spine** — `{seq, prevHash, entryHash}` for *every* entry in the store, disclosed or not — plus the seal (`ChainHeadRecord`) and the canonicalization spec.

**Whole-practice interactions** that touched this client's sources are included and flagged *"whole-practice question — sources from other clients not disclosed in this bundle."* Honest, and it keeps other clients' metadata out of this client's bundle.

### 3.2 Verification a non-engineer can run

The spine is what makes per-client disclosure verifiable without disclosing the rest: hashes of undisclosed entries reveal nothing (SHA-256 preimage resistance), but they let the verifier walk the whole chain. `verify.html` is a single static file — no network access, no CDN, WebCrypto only — that checks four things and says so in words:

1. **Linkage:** every `prevHash[n]` equals `entryHash[n-1]`, genesis (`[0u8;32]`, `store.rs:51`) to head.
2. **Disclosure honesty:** every disclosed record re-hashes to its spine entry — the verifier re-implements `canonical_entry_bytes` (`store.rs:138-153`; length-prefixed big-endian framing, ~20 lines of JS) and computes `SHA-256(prevHash ‖ canonicalBytes)`.
3. **Seal:** the spine's tail matches the embedded `chain_head_v1` (entry count, last seq, last hash).
4. **Excerpts** (if present): each excerpt file re-hashes to the `snippetSha256` recorded in its interaction.

Output is one sentence a CCO can quote: *"8,214 entries · chain intact · seal matches · 47 disclosed records verified · 12 excerpts match."* The in-app equivalent ("Verify a bundle" in the Privacy Center) re-checks the same bundle against the **live** store, which additionally proves the bundle wasn't fabricated wholesale on some other machine.

Exporting is itself evidence: each export appends a `record_exported` event (client scope, bundle head-hash, excerpts yes/no) to the chain — the record records its own disclosures.

### 3.3 Composing with the existing surfaces — three layers, not four overlaps

The rule that keeps this from becoming a fourth overlapping trust surface: **the Data Map explains, the Confidentiality Report summarizes, the Privacy Record proves.**

- **Data Map** (`DataMapDialog.tsx:75-161`): unchanged — the static plain-English architecture explainer. Gains one row pointing at the record ("Every AI interaction is recorded — ask for the Privacy Record").
- **Confidentiality Report** (`ConfidentialityReportDialog.tsx:173-258`): stays the quick per-mode summary; its per-call table gains a "sources read: N" column fed by `answer_provenance` (same `buildConfidentialityReport` join, one new field), and its footer gains "Export the full Privacy Record" — replacing today's dead-end disclaimer with a path to the proof.
- **The Privacy Record bundle** absorbs and supersedes the current attestation `.docx` (`attestation.ts` already assembles audit + integrity + consent + retention — it becomes the cover-report builder rather than a separate artifact).
- The **Privacy Center** (`src/features/privacy/PrivacyCenterHome.tsx`) is the mount point — it already composes the indicator, the map, and the report (`:118,129,133-139`) and already receives `auditEntries` + `activeMatter` (`App.tsx:1648,1725`).

---

## Part 4 — Consent moves to client creation (R2)

The machinery is 80% built and half-wired. The consent ledger reads standing consent (`consentLedger.ts:77-81`) and the dialog pre-fills from it (`ConsentDialog.tsx:143-147`) — **but no code path ever writes a `scope: 'standing'` entry.** Jurisdiction has a full state table (`recordingConsentLaw.ts:10-28`) — but the record path hard-codes `consentModeFor(null)` and `stateKnown={false}` because the Matter type has no state field (`ClientMeetingsTab.tsx:166-169,400`). So the advisor re-answers the same questions at the worst moment of their day, every time (R2), and the app always assumes two-party.

The change, in two halves:

**At client creation (and editable later):** `MatterManagerDialog.tsx` (create section `:384-443`) gains an optional, collapsed **"Recording & consent"** section:
- *"Where is this client located?"* — state dropdown, with "Not sure" defaulting to the conservative two-party path exactly as today. Stored as a new **optional** `clientState?: string` on the `Matter` type (`src/platform/types/matter.ts`) — additive; `matter`/`matter_id` and every locked identifier untouched.
- *"Standing recording consent on file"* — checkbox + optional note, which finally writes the `scope: 'standing'` consent-ledger entry the read side has been waiting for (`consentLedger.ts:64-73` is the same append path). Plain-language explainer of what standing consent does and doesn't cover.

**At record time (the reduction):** `ClientMeetingsTab` passes `consentModeFor(matter.clientState ?? null)` and `stateKnown={!!matter.clientState}`. The dialog becomes one specific sentence and one click: *"California requires everyone's consent — say the notice aloud"* instead of the generic unknown-state hedge; standing consent pre-fills the attestation **except in all-party-consent states** (preserving Tier B's R1 decision: never let the checkbox become a reflex where notice is legally required every time). The state on file also feeds the Notice Kit's "recommend Strict" logic (`RecordingNoticeSettings.tsx:6-8`) and, later, the Notice Card's policy hook.

And the client-creation consent answers land in the consent ledger — which the Privacy Record bundle already exports — so "when did this client consent, and on what basis" becomes part of the same provable trail. (A cheap adjacent rung mirrors each consent/notice ledger append into the audit chain, closing the honest gap that the per-client JSON ledger is append-only by convention, not tamper-evident — `consentLedger.ts:38-45` serializes writes but nothing chains them.)

---

## Part 5 — Honest boundaries: what this record does NOT prove

This section is part of the product, not just the doc — the export cover carries a plain-voice version of it. Overclaiming is how the category got a trust review in the first place.

1. **It cannot prove the provider deleted its copy.** The record proves what was *sent* — destination, mode, model, content fingerprints. What Anthropic or OpenAI did with it afterward is governed by the user's own BYOK terms (or the firm's zero-retention proxy contract in Assured mode), not by cryptography. The cover says so: *"This record proves what left and what was read. It cannot prove what a cloud provider retained — that's a contract, not a measurement."*
2. **"What the AI read" means what was placed in its context.** We prove the retrieved set given to the model, not the model's internal attention. That's the strongest claim any RAG system can honestly make, and we make exactly it.
3. **Tamper-evident, not tamper-proof.** The chain detects edits, deletions, truncation, and wipe-and-reseal through any normal path (and appends fail closed when the seal is broken). An attacker with full control of the machine and the OS keychain could, in principle, regenerate the *entire* chain consistently. The practical mitigations are external witnesses: every exported bundle's checkpoint line pins the head hash at a moment in time — two bundles that disagree about their common prefix are proof of tampering — and firms can make the quarterly export a ritual for exactly this reason. (A future opt-in anchor — e.g. the firm relay timestamping a bare head hash — would strengthen this; it is deliberately out of v1 because "the record must never itself become an egress path," and even a hash leaving the machine is egress and must be a deliberate, visible choice.)
4. **Local-only mode proves the app's AI path sent nothing — not that the machine is silent.** The Data Map's existing honesty about OS-level reliance (disk encryption, other software) stands; the record doesn't extend to what other programs do.
5. **The record starts when the feature ships.** Interactions before it have `egress` events but no source-level provenance, and we will not backfill what wasn't captured — the report renders a "records begin <date>" line, the same honesty the hash-chain migration applied (`store.rs:375-440` seals only from the upgrade moment forward).
6. **On firm tier, each machine's record covers that machine.** A per-client bundle from one seat is that seat's evidence. Firm-wide proof is the composition of per-seat bundles, stated as such — never a silently merged view.

What it *does* prove, for balance, in the voice of the cover page: *every AI interaction on this machine that touched this client — where it went, under which mode, what was read to produce it, what was cited and whether the citations checked out — recorded as it happened, chained so edits and deletions show, checkable by you, offline, without trusting the vendor.*

---

## Part 6 — Build ladder

Each rung ships value alone; order is dependency-honest. Effort classes: S (≤1 day lane), M (2–4 days), L (a week-class lane). TS/Rust split named per rung. Every rung's tests ride the existing gate (`npm run gate`).

| Rung | Ships | Where | Effort | Tests | Notes |
|---|---|---|---|---|---|
| **P1 — Record the read-set (Ask)** | `answer_provenance` event type + payload builder + hashing; `interactionId` on egress + `.aichat` message; emit at streaming/non-streaming/cancel completion sites; `CRITICAL_ACTIONS` entry; Activity-log renderer line | TS only (`platform/types/audit.ts`, `platform/audit/`, `features/ask/hooks/useChatSending.ts`) | **M** | Unit: payload builder (hash determinism, snippet exclusion — assert no `chunkText` in payload); integration: emitted at both completion sites + cancel; existing `useChatSending` tests extended | No Rust change — `payload_json` is schema-free (`store.rs:30-44`). The one rung everything else builds on. |
| **P2 — Show it** | Per-answer "What produced this answer" line in the sources accordion (destination · model · recorded ✓/⚠); "sources read: N" column in the Confidentiality Report; the not-recorded warning state | TS (`features/ask/ChatSourcesAccordion.tsx`, `platform/privacy/confidentialityReport.ts`, dialog) | **S** | Component tests for both states; report-builder unit test | Makes the record visible day one — evidence users can *see* builds the habit of trusting it. |
| **P3 — The bundle + offline verifier** | `audit_export_spine` Rust read command (seq/hashes/seal); bundle assembler (per-client filter, whole-practice flagging); `report.docx` cover (evolves `attestation.ts`); `verify.html`; opt-in excerpts with live hash-check; `record_exported` event; Privacy Center + client-surface entry points | Rust: one read-only command. TS: `platform/privacy/` assembler + UI | **L** | Rust: spine correctness vs `verify_chain`. TS security tests: tamper matrix — edited payload, dropped entry, truncated tail, forged seal, mismatched excerpt → verifier must fail each with the right message; path-containment on export writes | The flagship rung. The verifier's canonical-bytes JS must be fixture-tested against Rust-produced vectors. |
| **P4 — Retention integrity (R10 + E5 copy)** | Pre-unlink content hashes in `retention_delete` events; "source removed" annotated states for `[t:ms]` chips + Client Map meeting refs; retention matrix copy + Summary-only compliance warning; deleting-mode consequence line | Rust (`sweep.rs` hash-before-unlink) + TS (viewer states, `RetentionSettings.tsx`, locales) | **M** | Rust: sweep emits hashes (fixture workspace); TS: chip states with/without transcript; copy keys in all three locales | Independent of P3; can run parallel to it after P1. |
| **P5 — Consent at client creation (R2)** | `Matter.clientState?` + creation/edit UI section; standing-consent **write** path (`scope:'standing'`); `ClientMeetingsTab` wiring (`consentModeFor(state)`, `stateKnown`); record-time copy reduction; R1 rule (no pre-check in all-party states) | TS only | **S–M** | Unit: `consentModeFor` wiring, standing-entry write shape; component: dialog copy per state × standing-consent matrix | Coordinate with the Notice Card lane — it extends the same `ConsentDialog`; land this first or rebase carefully. |
| **P6 — Provenance everywhere + consent chain-mirror** | `answer_provenance` from the remaining egress surfaces (meeting notes, redline, Client Map, workflows, email drafts, agenda/brief); consent/notice ledger appends mirrored into the audit chain | TS only, mechanical | **M** (delegable, per-surface) | Per-surface: event emitted with correct `surface` + sources; mirror: ledger write ⇒ chained twin | Schema already fits (P1's `surface` field); pure fan-out. |
| **Later** | Firm policy enforcement (retention matrix + Strict record-gating via the firm mechanism); wire-exact request hashing at the `instrumentEgressFetch` choke point (`egressActivity.ts`); opt-in external witness/anchoring; per-seat bundle composition UX for firms | — | — | — | Each is a real decision, not a default — especially anchoring (deliberate egress) and Strict gating (can block work). |

**Migration:** none destructive. Everything is additive — new event types ride `payload_json`; `Matter.clientState` is optional; existing workspaces simply start recording at P1 install, with the "records begin" line carrying the honesty. Nothing is backfilled, nothing renamed, no store format changes.

**Sequencing with live lanes:** P1/P2 can start immediately after this design is approved. P3 is the flagship lane. P5 touches `ConsentDialog`/`ClientMeetingsTab`, which the Notice Card build is also extending — sequence after that merge (same rule the Notice Card doc applied to the Notice Kit: don't have two lanes fighting over the same files).

## Risks, named honestly

1. **The verifier must be boringly correct.** A `verify.html` that says "intact" wrongly is worse than no verifier. Mitigation: the canonicalization JS is fixture-tested against vectors generated by the Rust implementation, and the tamper-matrix security tests treat every false-green as a release blocker.
2. **Metadata sensitivity of the record itself.** File basenames, source types, and query hashes concentrate a map of the practice. Mitigations: same SQLCipher store and keychain protections as the data it describes; hashes-not-content by design; per-client filtering at export; whole-practice interactions disclose only this client's slice; and the bundle is a deliberate local export, never automatic.
3. **Scope creep toward overclaiming.** Marketing pressure will want "tamper-proof" and "prove the provider deleted it." Part 5 is written into the export cover precisely so the product's own artifact keeps contradicting the overclaim.
4. **Performance regressions hiding in the tail.** The argument in §1.4 says imperceptible; the P1 lane must still measure (Ask p95 before/after on the bench) rather than assert — per the repo's evidence-before-assertions rule.
5. **Two lanes, one dialog.** P5 collides with the in-flight Notice Card work on `ConsentDialog`. Named in the ladder; the fix is sequencing, not cleverness.

## Why this wins

Jump and every cloud notetaker can show a dashboard that *says* what happened. None of them can hand a CCO a bundle that proves what happened **on hardware the vendor never touched** — their architecture routes client data through their own servers, so "prove my client's data never left" is a sentence they cannot say at all. We can, because the hard parts — the citation engine that knows every source, the hash chain that survives hostile QA — are already built and already ours. This design just refuses to let that evidence evaporate.

---

*Appendix A (adversarial review) follows after the independent Codex pass.*
