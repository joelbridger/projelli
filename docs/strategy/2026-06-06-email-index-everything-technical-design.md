# Keepance Email Intelligence: "Index Everything" Technical Design

**Date:** 2026-06-06
**Author:** CEO / lead research (for Jameson)
**Status:** Deep-dive design and recommendation, for decision
**Companion to:** `2026-06-06-email-search-local-rag-strategy.md` (the why and the market). This document is the how.

**Decisions this design is built on (Jameson, 2026-06-06):**
- Go ambitious: **index everything, across multiple providers** (not a narrow first cut).
- **Microsoft 365 first.**
- **No manual drag-in.** Thousands of emails must import automatically, organized and tracked.
- **Encryption is in scope**, planned where it makes sense.

---

## 1. The verdict, in one page

**"Index everything" is viable on a normal laptop. The right way to deliver it is tiered, not all-at-once.** That distinction is the whole design, so let me be plain about what it means and why it is actually *better* for you, not a watering-down of the ambitious choice:

- **Everything comes down, and everything is searchable, fast.** We pull the entire mailbox onto the machine and make every message keyword-searchable almost immediately. From the user's point of view, "all my mail is here and I can find it" happens early.
- **The deep AI understanding fills in progressively, in the background.** Turning 100,000 emails into AI-searchable "meaning" is the one step we can't promise is instant on a weak laptop (more on that below). So we do it as a background job, most-recent and most-important mail first, the long tail filling in while they work. Nothing freezes. They can use the app the whole time.
- **The end state is exactly what you asked for:** the entire mailbox, fully understood by the AI, fully local. We just get there on a ramp instead of a cliff.

Why I'm confident: the performance fear turned out to be mostly unfounded. *Searching* a local index of 100k–200k emails is a few milliseconds even on a five-year-old laptop with no graphics card (verified against public benchmarks). Microsoft's own API for pulling a whole mailbox down and keeping it in sync is fully documented and stable. The one genuinely open number is how fast the *initial* AI-indexing runs on a slow machine, and the tiered design is specifically built so that number stops being a make-or-break risk: even if it's slow, it happens invisibly in the background and the product is useful from minute one.

**My recommendation: build it, Microsoft 365 first, in the phases in section 8, and benchmark the one unknown number before we commit to thresholds.**

---

## 2. Performance: what's proven, what isn't, and the strategy that de-risks it

**Proven and reassuring:**
- **Search latency is a non-issue.** LanceDB (the local vector store we already use) returns results in roughly 1 to 20 milliseconds on a 1-million-vector benchmark on an old no-GPU laptop CPU. Our target (100k–200k emails at 384 dimensions) is *smaller and lighter* than that benchmark. So once an email is indexed, finding it is instant. (Source: LanceDB engineering benchmarks, independently corroborated; runs on a 5-year-old Xeon laptop with no GPU.)
- **Our embedding model is the right tool.** The on-device model we already ship (a small 384-dimension sentence encoder running on ONNX, CPU-only, no GPU, ~80MB) is purpose-built for exactly this: semantic search and clustering over short text like emails. (Source: model card + fastembed/ONNX docs.)

**The one unverified number, stated honestly:** nobody could give a confirmed figure for *how long it takes to embed 100,000 emails on an 8–16GB no-GPU laptop* (emails per second, total wall-clock, peak memory). Every claim that tried to was either absent or didn't survive fact-checking. This is the single most important thing we don't yet know, and I won't pretend otherwise.

**How the design makes that gap safe:**
- **Keyword index everything immediately.** Keyword search needs no AI and no embedding. So "all my mail, searchable" is true from the start regardless of the embedding speed.
- **Embed lazily and by priority** on a background thread, off the UI: most recent mail first, then anything the user opens or searches, then the long tail backfills. The heavy work is an interruptible background job, never a blocking step.
- **Phase 0 is a benchmark.** Before we build thresholds around it, we measure our actual model's throughput on a representative machine. I can run a rough version of this measurement on our own hardware now if you want an early read (caveat: our server is beefier than a user laptop, so it's an upper bound, not the real figure). The real test is on modest hardware.

**Two concrete LanceDB facts the build must respect** (both verified):
1. **New rows aren't auto-indexed in the open-source build.** Freshly added emails are searchable right away, but via slow brute-force scan until we explicitly call `optimize()`. Automatic background re-indexing is a paid-cloud-only feature; in the embedded version we ship, we own that scheduling. So the importer must: skip building the index while the mailbox is tiny (brute force is fine), build the real index once a few thousand emails land, and re-run `optimize()` periodically during long backfills (guidance: roughly every 100k changes) so search stays fast.
2. **Long emails get truncated by the embedder** (it reads roughly the first 512 tokens). Our existing chunker already splits text at ~512-token boundaries, so email indexing reuses machinery we have; we just need to chunk long emails rather than embedding them whole.

---

## 3. The import pipeline (Microsoft 365), well-grounded

This part is on solid, fully-documented ground (Microsoft's own Graph API docs, verified). The pattern is **"backfill once, then track changes."**

- **Authenticate** with Microsoft via standard OAuth (the user signs in to their own Microsoft account and grants read access to their mail). The login token is refreshed automatically and stored in the OS secure vault (see section 5). Note for planning: reading mail via Graph requires a registered Microsoft app and, for broad use, Microsoft's app-verification/publisher process. That's a real setup and compliance step, not a code detail, and I'll track it as such.
- **Backfill:** walk the mailbox folder by folder and page through every message, writing each one down locally. Microsoft's "delta" sync is **per folder**, so we track each folder's own position independently.
- **Resumability is free if we do it right.** Microsoft hands back an opaque bookmark token after each page and each completed pass. We save that token string verbatim. If the import is interrupted (laptop sleeps, network drops, app quits), we resume from the saved bookmark. No re-downloading what we already have.
- **Stay in sync forever after:** on a schedule (or when Microsoft pushes a change notification), we ask only "what changed since my last bookmark?" and get back just the additions, edits, and deletions. Unchanged mail is never re-fetched. Microsoft explicitly recommends this over re-scanning, and it's gentler on rate limits.
- **Handle the rough edges** (all documented, all required): deletions arrive as a small "removed" marker (just an id) that we tombstone locally; the same message can show up more than once, so every update is an idempotent "upsert by id" that's safe to replay; bookmarks can expire and occasionally Microsoft forces a "start this folder over" (a `410 Gone`), which we treat as "re-backfill that one folder."
- **Respect throttling:** when Microsoft says "too many requests, wait N seconds," we wait exactly that long and retry, backing off with jitter if no time is given, and pausing the whole import under sustained pushback. One shared, rate-limited connection handles all of this in one place. (Realistic expectation to set: a very large mailbox, 100k+ messages, may take a meaningful while to fully back-fill on the first run. That's fine because it's a resumable background job and keyword search lights up as mail arrives.)

The same "adapter" shape (authenticate, backfill, track-changes, normalize) is how Gmail and IMAP slot in later without reworking the core (section 7).

---

## 4. Organization and tracking (designed; flagged as not-yet-externally-validated)

The research did not get solid third-party coverage here, so treat this as my engineering design, not a sourced finding. It's built on well-known email patterns and on what we already have.

**Principle: we organize the local copy, we never touch their real mailbox.** Nothing we do moves or deletes a message in Outlook. We mirror their existing folder structure and add Keepance-side groupings on top.

**Automatic organization, cheapest-and-most-reliable first:**
- **By conversation/thread.** Reconstruct full back-and-forth threads. Microsoft gives us a conversation id directly; Gmail and IMAP have their own equivalents we map to one common thread id later. Deterministic, no AI needed.
- **By correspondent (person and company domain).** "Everything with the Hendersons," "everything from anyone @meridian-property.com." Deterministic.
- **By client/matter, the valuable one.** Lead with deterministic mapping: the user (or the AI, with their confirmation) maps email addresses and domains to the client or matter folders they *already keep in Keepance*. So imported mail auto-files alongside the documents for that client. Pure-AI topic clustering and entity extraction (NER) are a nice later enrichment, not the v1 backbone.

**Tracking and progress (we already have most of the hooks):** we already emit live progress (processed / total / current item) and support cancel. We extend that to a real status view: per-folder sync state, last-synced bookmark, and three honest counters, "downloaded," "keyword-searchable," and "deep-AI-indexed," plus an audit log (we already have an audit service). The user sees something like: *"38,212 of 41,002 emails imported and searchable. Deep AI index 64% complete, finishing in the background."* Resumable and auditable by design.

---

## 5. The security model (your priority; designed, standard patterns)

You greenlit encryption, so this is first-class, not a footnote. The research under-covered it, but encryption-at-rest for a local desktop app is well-trodden ground, and the relevant building blocks (SQLCipher, OS keychain, vetted crypto libraries) showed up in the sources. Here's the design.

**What we're protecting against (threat model):** the realistic threats to a privilege-bound professional's laptop are a **lost or stolen device**, **another person on a shared computer**, and **malware**. (The biggest threat for the cloud competitors, a server-side breach, simply doesn't exist for us, because there is no server.) Encryption-at-rest is aimed squarely at the first two.

**Two layers:**
1. **Secrets** (the Microsoft login/refresh token, and our master encryption key): stored in the **OS secure vault** (Windows Credential Manager / macOS Keychain / Linux Secret Service). We already have this capability wired in. Tokens never sit in a plain file.
2. **Data at rest** (the email bodies, the metadata, the search indexes): **encrypted by us**, not left to chance. The plan:
   - Email content and the metadata database: encrypt with a vetted standard (SQLCipher for the database; AES-256 or XChaCha20-Poly1305 for stored mail files), using libraries we don't hand-roll.
   - The master key lives in the OS vault. Optional higher tier: derive it from a user passphrase with a strong key-derivation function (Argon2id), so the data is protected *even if* someone gets at the OS vault. That's the "even my own machine isn't fully trusted" mode some firms will want.
   - **Verify full-disk encryption is on** (BitLocker / FileVault) and nudge the user if it isn't. Belt and suspenders.

**One honest wrinkle I want to flag:** our vector index (LanceDB) stores the actual email text alongside the math, and the open-source build has no native encryption. So we either wrap its files in an app-managed encrypted container or encrypt the stored text ourselves. It's solvable, but it's the fiddliest part of the security work, and I'd validate the exact approach with a focused spike before building it. Calling it out now so it's not a surprise later.

**Sequencing (your "when it makes sense"):** build the storage layer in Phase 1 and encrypt *that* store as we build it, rather than shipping plaintext and retrofitting encryption twice. So encryption is part of standing up the real store, before any real client mail lands in a production build. That's the natural "makes sense" point.

---

## 6. What we already have vs. what's genuinely new

Grounded in our actual code, so the build estimate is real, not hand-wavy.

**Reuse as-is (already shipping, on-device, no cloud):** the local embedding model; the LanceDB vector store with idempotent per-file replace; the chunker (its ~512-token window already matches the embedder); keyword search; the memory/facts system; cited chat-over-your-files; live progress events; cancellation; the OS keychain integration; the audit log; and a Rust backend that already has the networking stack we'd use to reach Microsoft.

**Genuinely new (the focused build):**
- The **email connectors + OAuth + sync engine** (per-folder delta, token persistence, throttling-aware client, idempotent apply loop). Greenfield, but fully specified by section 3.
- The **normalizer** that turns each email into a local file plus structured metadata so the rest of our pipeline picks it up automatically.
- The **encryption layer** from section 5.

**Upgrades to our existing indexer for scale** (today it works but isn't tuned for 100k items):
- **Skip-unchanged:** today a re-index re-embeds every file; at mailbox scale we add a "only embed new or changed" manifest (by id and hash). Essential.
- **Batch embedding:** embed many emails per batch during backfill instead of one at a time.
- **Background orchestration + `optimize()` scheduling:** run embedding on a worker thread off the UI, build the index once a few thousand emails exist, and re-optimize periodically (per section 2).

This is the concrete "missing 20%." It's connectors, a normalizer, an encryption layer, and three targeted upgrades to an indexer we already ship.

---

## 7. Multi-provider, without lock-in (designed)

To honor "multiple providers" without painting ourselves into a Microsoft corner, everything flows through **one normalized internal email model** (id, account, folders/labels, thread id, from/to/cc, date, subject, body, attachments, headers, flags) fed by **per-provider adapters**:
- **Microsoft Graph adapter** ships first.
- **Gmail adapter** and **IMAP adapter** are added later against the same internal model.
- **Threading is reconciled** by mapping each provider's notion of a conversation (Microsoft's conversation id, Gmail's thread id, IMAP's reply-reference headers) onto one Keepance thread.
- **Cross-provider de-duplication** uses the universal `Message-ID` header, so a professional who has both an Outlook and a Gmail account doesn't get doubles.
- **Folders and labels** are modeled as tags (a message can carry several), which absorbs the Outlook-folders-vs-Gmail-labels difference cleanly.

Because the core pipeline only ever sees the normalized model, "index everything across providers" is real, and adding a provider is writing one adapter, not touching the engine.

---

## 8. Phased build plan

- **Phase 0: De-risk the one unknown.** Benchmark our embedding model's throughput and memory on representative hardware and a representative mailbox size. Output: real numbers that set the tier thresholds. (Small, fast, and it retires the biggest risk before we build around it.)
- **Phase 1: Microsoft 365, automated, keyword-first, encrypted, tracked.** OAuth sign-in; full backfill + change-tracking sync; normalize to a local encrypted store (encryption built in here, per section 5); all mail keyword-searchable; the progress/tracking UI. This alone delivers "all my Outlook mail, automatically here, organized, secure, and findable", which is already past where Outlook itself fails.
- **Phase 2: Deep semantic layer, tiered.** Background priority embedding into LanceDB with `optimize()` scheduling; cited semantic search and chat over email ("what did I tell the Hendersons about the closing date?"); thread and correspondent/client organization.
- **Phase 3: Multi-provider.** Gmail and IMAP adapters against the normalized model.
- **Phase 4: Enrichment.** AI topic clustering / entity extraction; and, with the same "AI proposes, you approve" discipline we already enforce, assisted reply drafting.

Phases 1 and 2 are the product. 3 and 4 are expansion.

---

## 9. Risks and the honest open questions

**Risks:**
- **Embedding throughput on weak laptops is unproven** (the #1 item). Mitigated by Phase 0 benchmark + the tiered design that makes it a background concern rather than a blocker.
- **LanceDB open-source needs us to own indexing scheduling and has no built-in encryption.** Both solvable (sections 2 and 5), both flagged.
- **Microsoft app verification** for reading mail at scale is a real external/compliance step with its own timeline. Track it early.
- **First full backfill of a huge mailbox can be slow** and rate-limited. Mitigated by resumability + keyword search lighting up as mail arrives + honest progress UI.
- **Prompt injection** once AI reads untrusted email (the Superhuman failure mode from the companion doc). Our existing stance, no autonomous actions, no auto-rendering of remote content, aggressive sanitization, is the right foundation and we hold it.
- **Scope.** "Index everything, multiple providers, encrypted" is a real body of work. The phasing ships value at Phase 1 and protects us from a big-bang build.

**Open questions the research explicitly could not close (so we shouldn't pretend they're closed):**
1. The real embedding throughput / memory number on modest hardware (Phase 0 answers this).
2. The exact encryption approach for the vector index specifically (validate with a spike).
3. The detailed auto-organization UX at scale (designed here, worth a dedicated pass before Phase 2).
4. The normalized multi-provider schema specifics (designed here; firms up in Phase 3).

A focused third research pass on security, organization, and multi-provider would harden sections 4, 5, and 7 before we build those phases. We don't need it to start Phase 0 or Phase 1.

---

## 10. Recommendation and the decision

**Recommendation:** proceed. Start with **Phase 0 (benchmark)** and **Phase 1 (Microsoft 365, automated, encrypted, keyword-first)**. This delivers your ambitious "index everything" vision in the only way that's actually fast and reliable on real hardware, builds encryption in from the start as you asked, and reaches a genuinely useful, demoable product at the end of Phase 1 without betting the whole thing on the one number we haven't measured yet.

**What I'd like from you:**
1. **Green light to turn this into a build plan** (the proper step-by-step the engineering process wants before code).
2. **Want me to run the rough Phase 0 benchmark now** on our own hardware for an early gut-check on embedding speed (with the caveat it's an optimistic upper bound versus a user's laptop)? Quick to do and it sharpens everything downstream.
3. **Do you want the third research pass** on security + organization + multi-provider before I write the build plan, or should I design those from the patterns above and we validate as we go? Given you want to move, my lean is to write the build plan now and slot a focused security spike into Phase 1.

---

## Appendix: verified findings and sources (research pass 2)

Multi-agent deep-research pass: 5 angles, 25 sources fetched, 123 claims extracted, top 25 adversarially fact-checked (3 verifiers each), 22 confirmed, 3 refuted. Coverage was strong on performance and Microsoft sync, thin on security/organization/multi-provider (designed from first principles above and labeled as such).

**Confirmed (high confidence):**
1. Our on-device embedding stack (small 384-dim ONNX sentence encoder, CPU-only, no GPU) is fit-for-purpose for email semantic search/clustering. Long inputs truncate (~512 tokens), so chunk. *(fastembed/Qdrant docs; MiniLM model card.)*
2. LanceDB returns vector queries in ~1–20ms even on an old no-GPU laptop at 1M vectors; our 100k–200k @ 384-dim is lighter, so search latency is a non-issue. *(LanceDB engineering benchmarks, corroborated.)*
3. LanceDB open-source does not auto-index new rows (brute force until manual `optimize()`); defer index creation until a few thousand rows, re-optimize periodically. *(LanceDB reindexing/vector-index docs.)*
4. Microsoft Graph mailbox sync = one backfill then per-folder delta change-tracking; track each folder's own bookmark. *(Graph delta-query docs.)*
5. Sync state is fully carried by opaque next/delta bookmark tokens; persist them verbatim to resume/replay. *(Graph delta-query docs.)*
6. Incremental rounds return only changes; deletions are a minimal "@removed" marker; never re-fetch unchanged mail. *(Graph message-delta API.)*
7. Hard edges that force idempotent merge logic: tokens expire, `410 Gone` forces per-folder full resync, entities can replay. *(Graph delta-query overview + MS Q&A.)*
8. Throttling is `429 + Retry-After`; wait and retry, exponential backoff as fallback; Microsoft recommends delta over polling to avoid throttling. *(Graph throttling + best-practices docs.)*

**Refuted/dropped:** "fastembed officially ships multilingual-e5-small" (our code does use fastembed's e5-small variant and works in our build, so this is a docs-wording nuance, not a problem for us, but worth a glance at our integration); "LanceDB OSS has a built-in async/non-blocking index build" (don't assume; we own the background orchestration); "Graph publishes no Outlook mailbox rate ceiling" (don't assume unlimited; handle 429 adaptively *and* design for limits).

**Primary sources:**
- Microsoft Graph delta query (overview): https://learn.microsoft.com/en-us/graph/delta-query-overview
- Microsoft Graph delta query (messages): https://learn.microsoft.com/en-us/graph/delta-query-messages
- Microsoft Graph throttling: https://learn.microsoft.com/en-us/graph/throttling
- Microsoft Graph throttling limits: https://learn.microsoft.com/en-us/graph/throttling-limits
- Microsoft Graph auth (user, OAuth): https://learn.microsoft.com/en-us/graph/auth-v2-user
- LanceDB reindexing: https://docs.lancedb.com/indexing/reindexing
- LanceDB vector index: https://docs.lancedb.com/indexing/vector-index
- LanceDB benchmarks: https://medium.com/etoai/benchmarking-lancedb-92b01032874a
- fastembed: https://github.com/qdrant/fastembed
- MiniLM model card (encoder class reference): https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2
- SQLCipher + Tauri/Rust local-first reference: https://mhmtsr.medium.com/building-a-local-first-password-manager-tauri-rust-sqlx-and-sqlcipher-09d0134db5bc
- Rust keyring crate (OS keychain): https://docs.rs/keyring
- Email threading reference (JWZ algorithm): https://www.jwz.org/doc/threading.html
- Unified email API reference (multi-provider abstraction): https://www.unipile.com/unified-email-api-integration/
