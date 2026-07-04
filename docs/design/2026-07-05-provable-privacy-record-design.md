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
    surface: 'ask' | 'ask-chat' | 'meeting-notes' | 'redline' | 'client-map'
           | 'workflow' | 'email-draft' | 'agenda' | 'brief';   // which feature produced it
    scope: AuditScope;              // same frozen send-time scope as the egress event
    matterSeq?: number;             // per-scope monotonic counter (1, 2, 3 …) — the
                                    //   disclosure-completeness anchor (see §3.2)
    outcome: 'completed' | 'cancelled' | 'failed';   // EXACTLY ONE terminal event
                                    //   per interactionId, whatever happens (§1.4)

    // What left (duplicated small, so each record is self-contained for export)
    provider: string; model?: string;
    mode: ConfidentialityMode; destination: EgressDestination; dataLeaves: boolean;

    // What the AI read — EVERYTHING placed in the model's context, not just retrieval
    sources: Array<{
      via: 'retrieval' | 'tool-read' | 'attachment' | 'open-file' | 'facts';
      matterId?: string;            // per-source scope — required for whole-practice
                                    //   interactions to filter per-client at export
      sourceId?: string;            // '/path/file.pdf' | 'mail:<message-id>' | 'meeting:<dir>#<ms>'
      basename: string;             // human-readable name for the CCO
      chunkId?: string;             // content-addressed RAG chunk id (the citation key)
      sourceType?: string;          // 'pdf' | 'mail' | 'transcript' | …
      paragraphIndex?: number; pageNumber?: number;
      privilege?: string;           // carried through from RagHit
      contentSha256: string;        // hash of the raw stored content (chunk text /
                                    //   file bytes / fact text) — never the text itself
      cited?: 'verified' | 'notFound' | 'matterMismatch' | 'textMismatch';
    }>;

    // The rest of the request manifest — the non-source context the model also saw
    context: {
      querySha256: string;              // the user's question as sent
      systemPromptSha256: string;       // the assembled system prompt (buildSystemPrompt output)
      historySha256?: string;           // conversation history included, + message count
      historyMessageCount?: number;
      factsIncluded?: number;           // count; each fact is also a sources[] row (via:'facts')
      assembledContextSha256: string;   // the exact post-sanitization context block handed
                                        //   to the provider (see §1.2 — this is the
                                        //   "bytes-adjacent" hash; raw hashes live per source)
    };

    answerSha256?: string;          // final assistant text (absent when cancelled pre-first-token)
  };
};
```

Two things the adversarial pass (Appendix A) forced into this schema, worth naming because they're load-bearing:

- **`sources` covers the whole context window, not just retrieval.** The model can also read tool-loop file reads (`useChatSending.ts:1149-1172`), attachments, open-file context, and injected durable facts (`snapshotFactsForInjection`, imported at `useChatSending.ts:105`). Each is a `sources[]` row with its `via` kind. A record that said "what the AI read" but silently meant "what retrieval returned" would be this feature committing the app's original sin — an overclaim a skeptic can catch.
- **`matterSeq`** is a per-scope counter assigned at record time and hashed into the chain with everything else. It's what lets a per-client export *prove completeness*, not just integrity (§3.2): disclosed records for a client must read 1, 2, …, K with no gaps, and a gap is visible to the verifier.

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

One subtlety the adversarial pass caught: the raw chunk text is **not** byte-identical to what the provider saw — chunks are sanitized and wrapped with headers during prompt assembly (`src/platform/rag/workspaceCommand.ts:161-171`). So the schema records both layers: per-source `contentSha256` over the raw stored content (verifiable against the RAG store via the existing citation machinery), and `assembledContextSha256` over the exact post-sanitization context block handed to the provider. The first proves *which* content; the second proves *what form of it* was sent. Neither alone is honest; together they are.

### 1.3 Where it lives — the same chain, and why the alternatives lose

**Decision: extend the existing SQLCipher audit store. No new store, no per-client record files.**

- **The brief's constraint is also the correct engineering call:** the seal + high-water-mark + fail-closed + repair machinery took real work to get right (`lp/audit-chain-failclosed`, merged at `5af15e5e`) and is tested against the nasty cases (truncated-prefix-plus-deleted-seal, full wipe, corrupt seal — `store.rs:1161,1259,1334,1387`). A second integrity mechanism would double the attack surface and halve the scrutiny each gets.
- **Per-client record files fail the whole-practice case.** A whole-practice Ask sends a digest of *every* client in one request (trust review R6; `wholePracticeAsk.ts:27`). That interaction belongs to no single client file; in a per-client layout it either duplicates N times (N seals to keep consistent) or falls into a "general" file that breaks the per-client story. In one chain, it's a single record with `scope: allMatters`, and per-client export filters it in for every client whose sources it touched (flagged as whole-practice — which is itself useful evidence for the R6 conversation).
- **No schema migration needed.** The persisted shape is five stable columns with the full event JSON in `payload_json`, hashed verbatim into the chain (`store.rs:30-44,138-153`; round-trip at `AuditService.ts:88-134`). A new event type is a TS-side change; Rust neither knows nor cares. That makes Rung 1 small and low-risk.
- **The layer DAG stays clean.** Event types in `src/platform/types/audit.ts`; the payload builder and hashing in `src/platform/audit/` (hash util from `lib/`); emit sites in `features/ask` (features → platform, allowed); export assembly in `src/platform/privacy/` beside `confidentialityReport.ts`; UI in `features/privacy` and the matter surface. Nothing imports rightward.
- **The E2EE-relay rule is untouched.** The record never syncs. On firm tier, each seat's record covers what *that machine* sent — which is the honest unit anyway (egress is a per-machine fact). Firm-wide aggregation, if ever wanted, composes per-seat export bundles; no plaintext (and in v1, no ciphertext either) ever goes through the relay.

### 1.4 The write path — structural recording, and why Ask stays fast

**Recording must be structural, not cooperative.** The adversarial pass exposed the weakness of a purely hook-based design: audit emission today is an *optional* prop at the call sites (`onAuditLog?.(…)`, `useChatSending.ts:674`), and there are **two** Ask pipelines, not one — `useChatSending.ts` (the `.aichat` chat viewer) *and* `src/features/ask/useAsk.ts` (the Ask surface, with its own retrieval, egress, and save paths, e.g. `useAsk.ts:988-1010`). A surface that forgets to wire the hook — or a future eleventh-plus egress site — would silently produce unrecorded interactions, which is exactly the evidence gap this feature exists to close.

The app already owns the right seam: **`assertCloudSendAllowed` in `src/platform/privacy/cloudSendGuard.ts` is the documented "CENTRAL CLOUD-SEND CHOKE POINT — fail-closed,"** called at the top of every cloud provider send method (`sendMessage` / `sendMessageStreaming` / `structuredOutput` on the Anthropic, OpenAI, and Google providers — `cloudSendGuard.ts:80-92`). The provenance design extends that same seam rather than trusting call sites:

- **Pre-send:** the provider wrapper requires an active *interaction context* (`interactionId` + scope, registered by the surface before sending) and refuses a cloud send that has none — the same fail-closed posture the guard already applies to Local-only mode. The `egress` event (already critical, already durably awaited) is bound to that context.
- **Terminal, exactly once:** every `interactionId` must end in exactly one `answer_provenance` event with `outcome: 'completed' | 'cancelled' | 'failed'`. The cancel and failure paths are first-class, not afterthoughts — today a non-streaming abort can return without any egress record and failures are logged as `user_action` rather than a critical event (`useAsk.ts:1203,1213-1243`); the wrapper closes both.
- **Orphan detection:** interactions that opened but never terminated (a crash mid-answer) are detected at next launch and surfaced honestly in the Activity log — *"1 interaction has no completion record (the app closed mid-answer)"* — never silently absent. An examiner who finds a gap we labeled trusts the rest more, not less.

Where the data comes from: retrieval completes and `retrievedSources` is fully known at `useChatSending.ts:539-588`; the answer completes (with per-citation verdicts) at `useChatSending.ts:1699-1714` (streaming) and `:1763-1785` (non-streaming); tool-loop reads accumulate at `:1149-1172`; `useAsk.ts` has the equivalent points in its own flow. The surfaces supply the manifest; the platform wrapper guarantees an event exists at all.

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
| **Summary only** | notes only | audio + transcript | Offered **with a compliance warning** | **Disabled on firm-connected workspaces** (a local check in the settings UI at rung P4 — not deferred to the full firm-policy mechanism; warning copy is not a control, a disabled option is) | "This keeps the AI's summary and deletes the accurate transcript — the opposite of what compliance reviews usually want." |

**Summary-only survives — for solo, warned.** It's the advisor's data and some genuinely want minimal records; deleting the mode would be paternalism. What cannot survive is the *neutral framing*. The warning is in the product's honest voice, shown at selection time and echoed in the settings row: *"Most books-and-records guidance wants the transcript kept, not the summary. If your firm is subject to SEC or FINRA record rules, choose a mode that keeps the transcript."* On firm tier the mode is policy-gated off by default.

Retention stays per-workspace in mechanism (`SK_RETENTION_POLICIES`, `src/config/identity.ts:58`) — the matrix changes defaults, copy, and gating, not the storage design.

### 2.3 The citation-integrity rule (R10): deletion annotates, never dangles

Today, notes cite the recording with `[t:<ms>]` tokens rendered as seek chips (`TranscriptViewer.tsx:59-94`), and Client Map facts hold `meeting:<dir>#<ms>` refs (`meetingSources.ts:11-18`). After a sweep deletes the audio/transcript, those chips still render and **clicking them is a silent no-op** (`MeetingEntry.tsx:90-108,174-177`) — a "verifiable" note quietly becomes unverifiable. The rule this design sets:

> **A citation whose source was deleted is annotated, never silently dangling — and the record retains the fingerprint, so "this exact content existed and was what the note cited" stays checkable after deletion.**

(Stated carefully: a retained hash proves *identity*, not *content* — it can confirm a surviving copy is authentic, and it proves the note's sourcing wasn't invented after the fact, but it cannot show an examiner what was said. That's why the transcript-keeping modes are the compliance path and Summary-only carries the warning; the fingerprint is the honest floor for advisors who delete anyway, not a substitute for keeping records.)

Concretely:
1. **Hash before unlink.** The sweep's per-unlink audit callback (`DeleteAudit`, `sweep.rs:56-66`) gains a content SHA-256 computed immediately before deletion, recorded in the chained `retention_delete` event: *"transcript.json (sha256 abc…) deleted under policy summary-only."* Rust-side, inside the same blocking call — crash-safe like the rest of the sweep.
2. **Annotate on render.** When `MeetingEntry` finds the transcript/audio gone, `[t:ms]` chips render in a "source removed" state with plain-language hover copy: *"The recording this cites was deleted on <date> under your retention policy. Its fingerprint is kept in your privacy record, so this note's sourcing can still be checked against any surviving copy."* Client Map `meeting:` refs that fail to resolve get the same state — never a dead click.
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

**`record.json`** is the machine layer: full audit records for this client's disclosed events (`egress`, `answer_provenance`, `retention_delete`, consent-mirror events), plus the **chain spine** — `{seq, prevHash, entryHash}` for *every* entry in the store, disclosed or not — plus the seal (`ChainHeadRecord`) and the canonicalization spec. Disclosed records carry their **`payloadJson` verbatim as stored** — never re-parsed and re-stringified — because the chain hashes the exact string (`store.rs:138-153`; written by `JSON.stringify` once at `AuditService.ts:88-95`) and any re-serialization could silently change bytes and break verification.

**Disclosure redaction rule (what stays out by default):** the existing `retrieval_executed` events store the user's question in *plaintext* (`src/platform/types/audit.ts:371-383`). Since disclosure granularity is whole-record (a redacted payload can't re-hash), those events are **undisclosed by default** — present in the spine as hashes only — and included only when the exporter checks *"include the questions asked."* The `answer_provenance` events disclose freely because they were designed for it: they carry `querySha256`, never the question text. CCOs who want the questions opt in deliberately; nothing leaks by default.

**Whole-practice interactions** that touched this client's sources are included with only this client's `sources[]` rows (the per-source `matterId` makes the filter exact), flagged *"whole-practice question — sources from other clients not disclosed in this bundle."* Honest, and it keeps other clients' metadata out of this client's bundle.

**The export event, without circularity:** `record_exported` is appended *before* the bundle is assembled, containing the export parameters and a digest of the disclosure set (a hash over the disclosed entries' chain hashes — computable without the bundle file existing). The bundle's cutoff is that very event: it is the last entry in its own spine. No self-referencing bundle-file hash, and every bundle carries the chained proof of its own creation.

### 3.2 Verification a non-engineer can run

The spine is what makes per-client disclosure verifiable without disclosing the rest: hashes of undisclosed entries reveal nothing (SHA-256 preimage resistance), but they let the verifier walk the whole chain. `verify.html` is a single static file — WebCrypto only, and **provably network-silent**: a strict `<meta http-equiv="Content-Security-Policy">` blocking all remote loads and connections, no `fetch`/`XMLHttpRequest`/`WebSocket`/`sendBeacon` anywhere in it, enforced by a build-time test that greps the artifact (a "no-network verifier" that could phone home would be the feature refuting itself). It checks five things and says so in words:

1. **Linkage:** every `prevHash[n]` equals `entryHash[n-1]`, genesis (`[0u8;32]`, `store.rs:51`) to head.
2. **Disclosure honesty:** every disclosed record re-hashes to its spine entry — the verifier re-implements `canonical_entry_bytes` (`store.rs:138-153`; length-prefixed big-endian framing, ~20 lines of JS) over the **verbatim `payloadJson` strings** and computes `SHA-256(prevHash ‖ canonicalBytes)`, fixture-tested against Rust-generated vectors.
3. **Seal:** the spine's tail matches the embedded `chain_head_v1` (entry count, last seq, last hash).
4. **Completeness of disclosure:** the disclosed `answer_provenance` records for this client carry `matterSeq` 1, 2, …, K with **no gaps** — so an interaction can't be quietly withheld from the middle of a bundle. (The residual: a *tail* could be cut by exporting "as of" an earlier moment — which is why the checkpoint line pins the head, and why successive bundles must agree; see the boundaries.)
5. **Excerpts** (if present): each excerpt file re-hashes to the `contentSha256` recorded in its interaction.

Output is one sentence a CCO can quote: *"8,214 entries · chain intact · seal matches · 47 disclosed records verified, sequence complete · 12 excerpts match."* The in-app equivalent ("Verify a bundle" in the Privacy Center) re-checks the same bundle against the **live** store, which additionally proves the bundle wasn't fabricated wholesale on some other machine.

Said plainly, because the distinction matters: the offline verifier proves the disclosed records are **authentic, unmodified, correctly sequenced, and consistent with one sealed history**. It does not, by itself, prove that history is the only one that ever existed on that machine — no purely local scheme can (boundary #3). Integrity is cryptographic; completeness is cryptographic up to the tail; the tail is anchored by checkpoints and, when it matters, the in-app live check.

### 3.3 Composing with the existing surfaces — three layers, not four overlaps

The rule that keeps this from becoming a fourth overlapping trust surface: **the Data Map explains, the Confidentiality Report summarizes, the Privacy Record proves.**

- **Data Map** (`src/platform/privacy/ui/DataMapDialog.tsx:75-161`): unchanged — the static plain-English architecture explainer. Gains one row pointing at the record ("Every AI interaction is recorded — ask for the Privacy Record").
- **Confidentiality Report** (`src/platform/privacy/ui/ConfidentialityReportDialog.tsx:173-258`): stays the quick per-mode summary; its per-call table gains a "sources read: N" column fed by `answer_provenance` (same `buildConfidentialityReport` join, one new field), and its footer gains "Export the full Privacy Record" — replacing today's dead-end disclaimer with a path to the proof.
- **The Privacy Record bundle** absorbs and supersedes the current attestation `.docx` (`attestation.ts` already assembles audit + integrity + consent + retention — it becomes the cover-report builder rather than a separate artifact).
- The **Privacy Center** (`src/features/privacy/PrivacyCenterHome.tsx`) is the mount point — it already composes the indicator, the map, and the report (`:118,129,133-139`) and already receives `auditEntries` + `activeMatter` (`src/App.tsx:1648,1725`).

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
7. **The bundle proves what's in it, and that nothing was hidden from the middle — the tail needs a witness.** The offline verifier proves disclosed records are authentic and gap-free (`matterSeq`), but a bundle exported "as of" an earlier moment would omit later interactions without a visible gap. The checkpoint line exists for exactly this: each bundle pins the head, and any two bundles must agree about their overlap. The cover says it in one line: *"Keep this page — future exports must agree with it."*

What it *does* prove, for balance, in the voice of the cover page: *every AI interaction on this machine that touched this client — where it went, under which mode, what was read to produce it, what was cited and whether the citations checked out — recorded as it happened, chained so edits and deletions show, checkable by you, offline, without trusting the vendor.*

---

## Part 6 — Build ladder

Each rung ships value alone; order is dependency-honest. Effort classes: S (≤1 day lane), M (2–4 days), L (a week-class lane). TS/Rust split named per rung. Every rung's tests ride the existing gate (`npm run gate`).

| Rung | Ships | Where | Effort | Tests | Notes |
|---|---|---|---|---|---|
| **P1 — Record the read-set (both Ask paths, structurally)** | `answer_provenance` event type + manifest builder + hashing (`matterSeq`, per-source `matterId`/`via`, raw + assembled hashes, tool-loop reads, facts, open files); interaction-context registration enforced at the `cloudSendGuard` provider seam (no context → no cloud send); exactly-one-terminal rule incl. cancel/failure; orphan detection; `interactionId` on egress + saved messages; `CRITICAL_ACTIONS` entry; Activity-log renderer line | TS only (`platform/types/audit.ts`, `platform/audit/`, `platform/privacy/cloudSendGuard.ts` seam, `features/ask/hooks/useChatSending.ts` **and** `features/ask/useAsk.ts`) | **L** (was M before the adversarial pass — the second Ask path, the full manifest, and the structural seam are real work, and pretending otherwise would just move the cost into surprises) | Unit: manifest builder (hash determinism, content exclusion — assert no `chunkText` in payload; `matterSeq` monotonicity); integration: terminal event on complete/cancel/fail in **both** pipelines; seam test: cloud send without a registered context is refused | No Rust change — `payload_json` is schema-free (`store.rs:30-44`). The one rung everything else builds on. |
| **P2 — Show it** | Per-answer "What produced this answer" line in the sources accordion (destination · model · recorded ✓/⚠); "sources read: N" column in the Confidentiality Report; the not-recorded warning state | TS (`features/ask/ChatSourcesAccordion.tsx`, `platform/privacy/confidentialityReport.ts`, dialog) | **S** | Component tests for both states; report-builder unit test | Makes the record visible day one — evidence users can *see* builds the habit of trusting it. |
| **P3 — The bundle + offline verifier** | `audit_export_spine` Rust read command (seq/hashes/seal, verbatim `payloadJson` for disclosed rows); bundle assembler (per-client filter via per-source `matterId`, whole-practice flagging, `retrieval_executed` undisclosed by default with question-text opt-in); pre-assembly `record_exported` event (disclosure-set digest, no circularity); `report.docx` cover (evolves `attestation.ts`); `verify.html` with CSP + no-network build test; `matterSeq` completeness check; opt-in excerpts with live hash-check; Privacy Center + client-surface entry points | Rust: one read-only command. TS: `platform/privacy/` assembler + UI | **L** | Rust: spine correctness vs `verify_chain`. TS security tests: tamper matrix — edited payload, dropped entry, truncated tail, forged seal, hidden mid-sequence record (`matterSeq` gap), re-stringified payload, mismatched excerpt → verifier must fail each with the right message; artifact grep: no `fetch`/`XMLHttpRequest`/`WebSocket`/`sendBeacon`/remote refs; path-containment on export writes | The flagship rung. The verifier's canonical-bytes JS must be fixture-tested against Rust-produced vectors. |
| **P4 — Retention integrity (R10 + E5 copy)** | Pre-unlink content hashes in `retention_delete` events; "source removed" annotated states for `[t:ms]` chips + Client Map meeting refs; retention matrix copy + Summary-only compliance warning; deleting-mode consequence line; **Summary-only disabled on firm-connected workspaces** (local check — a warning is not a control) | Rust (`sweep.rs` hash-before-unlink) + TS (viewer states, `RetentionSettings.tsx`, locales) | **M** | Rust: sweep emits hashes (fixture workspace); TS: chip states with/without transcript; firm-gate test; copy keys in all three locales | Independent of P3; can run parallel to it after P1. |
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

## Appendix A — independent adversarial review (Codex, gpt-5.5) and adjudication

Per the lane brief, an independent Codex pass was prompted to attack the draft for integrity holes, egress leaks, examiner objections, grounding errors, and feasibility. It returned 14 findings and a verdict of "not sound to build as written." **Eleven findings were adopted and are folded into the body above; three were adopted in part with a stated rebuttal.** The verdict's three must-fix items (per-client completeness, the full request manifest, structural rather than cooperative recording) are all now core to the design. This is the pass working as intended — the draft's weakest claims died here instead of in front of a CCO.

| # | Finding (condensed) | Sev. | Adjudication |
|---|---|---|---|
| 1 | The offline verifier can prove disclosed records are unedited but **not that a client's record was withheld** among the undisclosed hashes. | Blocker | **Adopted.** Added `matterSeq` (per-scope monotonic counter, hashed into each record) + a verifier completeness check (§1.1, §3.2 check 4) + boundary #7 for the residual tail-truncation case. The claim language throughout was downgraded to match what is actually proven. |
| 2 | Whole-practice per-client export can't work — `sources[]` omitted `matterId`, which `RagHit`/`WorkspaceSource` already carry. | Blocker | **Adopted.** Per-source `matterId` added (§1.1); the whole-practice disclosure filter now has an exact key (§3.1). |
| 3 | "What the AI read" missed real prompt inputs: injected facts, open-file context, conversation history, system prompt, tool-loop file reads. | Blocker | **Adopted.** `sources[]` now spans all context kinds via `via:`; a `context` manifest (system-prompt/history/assembled-context hashes) was added (§1.1). Wire-exact request hashing at the fetch choke point remains a Later rung, stated as such — the component manifest is the CCO-readable layer; byte-exactness is hardening, not the claim. |
| 4 | Selective non-recording is possible — audit emission is an optional callback at call sites, and durable writes aren't awaited by callers. | Blocker | **Adopted, with the app's own seam.** Recording moves from cooperative hooks to the documented fail-closed cloud-send choke point (`cloudSendGuard.ts:80-92`): no registered interaction context → no cloud send (§1.4). |
| 5 | Cancel/failure paths leave weak or missing records (aborts can return silently; failures logged as `user_action`, not critical). | Major | **Adopted.** Exactly-one-terminal-event rule per `interactionId` with `outcome` enum, first-class cancel/fail, and crash-orphan detection surfaced honestly (§1.4). |
| 6 | Raw `chunkText` hashes aren't hashes of the bytes sent — chunks are sanitized/wrapped during prompt assembly (`workspaceCommand.ts:161-171`). | Major | **Adopted.** Dual-layer hashing: per-source `contentSha256` (raw, verifiable against the RAG store) + `assembledContextSha256` (exact post-sanitization block), with the distinction argued in §1.2. |
| 7 | `record.json` would leak plaintext questions via disclosed `retrieval_executed` rows, contradicting the hashes-not-content posture. | Major | **Adopted.** Disclosure redaction rule: `retrieval_executed` is spine-only by default; question text is a deliberate export-time opt-in (§3.1). |
| 8 | `record_exported` was circular (bundle can't contain a hash of itself). | Major | **Adopted.** Pre-assembly event carrying a disclosure-set digest; the export event is the bundle's own cutoff entry (§3.1). |
| 9 | "Sourcing remains provable" after deletion overstates what a retained hash gives an examiner — identity, not content. | Major | **Adopted.** Wording corrected in §2.3 and the annotation copy; transcript-keeping modes stated as the compliance path, the fingerprint as the honest floor. |
| 10 | Firm Summary-only gating deferred to a "later" policy rung is not a control a compliance reviewer accepts. | Major | **Adopted.** Summary-only is disabled on firm-connected workspaces at rung P4 via a local check; the full firm-policy mechanism remains Later but is no longer load-bearing (§2.2, P4). |
| 11 | The design covered only `useChatSending` and missed the second Ask pipeline (`useAsk.ts`) with its own retrieval/egress/save paths. | Major | **Adopted.** P1 scope is both pipelines, and the structural seam of finding 4 is what makes an unknown third pipeline safe by construction (§1.4, P1). Effort re-classed M→L honestly. |
| 12 | Wrong file citations (`src/app/App.tsx`; dialogs attributed to `features/privacy`). | Minor | **Adopted.** Paths corrected to `src/App.tsx` and `src/platform/privacy/ui/…` throughout. |
| 13 | Re-parsing and re-stringifying JSON in the verifier can change bytes and break hash verification. | Minor | **Adopted.** Bundles carry `payloadJson` verbatim as stored; the verifier hashes the exact strings, fixture-tested against Rust vectors (§3.1, §3.2). |
| 14 | "No network verifier" needs enforcement, not intention — a static HTML file can still phone home. | Minor | **Adopted.** Strict CSP meta + a build-time artifact test forbidding `fetch`/`XMLHttpRequest`/`WebSocket`/`sendBeacon`/remote references (§3.2, P3 tests). |

**Where the review was pushed back, and why (partial rebuttals inside adopted findings):**
- *(re #3)* The review's fix asks for "a manifest/hash of the final provider request." Full wire-byte hashing lands at the provider/fetch seam in a Later rung, not P1 — because the manifest a CCO reads is component-level (files, facts, question), and blocking the entire feature on byte-exact capture across four provider adapters would trade a shippable evidence layer for a purity property nobody can *read*. The boundary is stated in the doc rather than hidden.
- *(re #1)* No purely local scheme can prove a negative about withheld *tails* to an offline verifier; `matterSeq` closes mid-sequence withholding, checkpoints close the tail across time. The review's alternative ("a real disclosure-proof/index design") collapses to the same primitives once the adversary controls the machine — so the design spends its complexity budget on the checkable parts and its honesty budget on the rest.
- *(re the verdict)* "Not sound to build as written" was correct for the draft. With findings 1–11 folded in, the load-bearing claims and the mechanisms now match; the three must-fix items are the design's core rather than its gaps.

*Review artifact: run 2026-07-05, `codex-task --read-only`, gpt-5.5 high reasoning; full log retained in the session workspace.*
