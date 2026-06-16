# Keepance — Session Handoff (2026-06-07)

Paste this whole file as the first message of the next session. It is self-contained.

---

You are CEO + head of marketing/sales for Keepance (local-first AI workspace for attorneys, CPAs, consultants, and RIAs). Repo: `~/keepance`. Read `CLAUDE.md` first. Jameson is **not a developer** — talk in plain language, never dump stack traces or git jargon (you own version control).

## What happened last session (2026-06-06→07): a new flagship feature got built

Jameson came in for **marketing**, but his wife (a practicing CFP) flagged that **Outlook search "basically doesn't work"** across every Keepance vertical. That turned into a whole new feature, researched → designed → built → security-reviewed in one session:

**Email intelligence — bring Microsoft 365 mail into Keepance, encrypted and locally searchable.** This is the purest expression of the local-first moat (competitors process mail in their cloud; we never do).

### Current state of the email feature — DONE through encryption, NOT merged
- **Branch `email/m365-phase1`, PR #30** (base `v2-overhaul`), 26 commits, all TDD.
- **Phase 1 (import):** Microsoft 365 device-code OAuth → pull mailbox via Graph (per-folder backfill + delta sync, resumable, idempotent, 429/Retry-After) → normalize each message to Markdown → tracked in a local store. Tauri command surface + React "Connect Microsoft 365" panel (Settings → Integrations, light theme).
- **E2E PROVEN against Jameson's real inbox** (jamesondaines@outlook.com) on 2026-06-06: real device-code sign-in + his MFA approval + consent → 10 real inbox messages imported to local Markdown + SQLite. Live test harness: `src-tauri/tests/mail_e2e.rs` (`#[ignore]`d; run `cargo test --test mail_e2e -- --ignored --nocapture`).
- **Encryption-at-rest (Group G): built + security-reviewed.** Email bodies → AES-256-GCM blobs (no plaintext `Mail/*.md`); metadata → SQLCipher; LanceDB mail chunk text stored encrypted, decrypted in-memory on retrieve (document/PDF indexing byte-for-byte unchanged, regression-tested); keyword search fed decrypted text in-memory via a Tauri event (nothing plaintext persisted); master key in OS keychain; OS-FDE nudge; plaintext-migration cleanup. Dedicated security review: **no holes**; 3 SHOULD-FIX + 1 cleanup all fixed.
- **Gates green:** 58 mail/crypto + 45 rag Rust tests pass; `npm test` ~2056 pass; `npx tsc -b` **0 errors** (the gate that broke v2.3.0/v2.4.0).
- **Azure app registered** (via the Chrome app, on the **microsoft@projelli.com** business account): "Keepance Desktop", client id `845ddba0-70ab-4f90-88ba-e3522157e37a`, account type "Any Entra ID Tenant + Personal Microsoft accounts", **public client flows ON**. Baked into the code via `option_env!` fallback. Publisher is "unverified" (Microsoft publisher verification is a later step before broad distribution).

Full context lives in memory: `~/.claude/projects/-home-jameson/memory/project_keepance_email_intelligence.md`. Docs: `docs/strategy/2026-06-06-email-search-local-rag-strategy.md` (why/market), `docs/strategy/2026-06-06-email-index-everything-technical-design.md` (how), `docs/strategy/2026-06-06-email-encryption-design.md` (crypto decision), `docs/superpowers/plans/2026-06-06-email-m365-phase1.md` + `...-email-encryption-groupG.md` (the build plans).

## Loose ends, in priority order

### 1. ⚠️ Pre-existing tarball path-traversal security finding (NOT from the email work)
The full Rust suite has **2 failing security tests**: `src-tauri/src/commands/tarball.rs` → `tests::rejects_absolute_path` and `tests::rejects_parent_traversal`. These guard the **template-install (`extract_tarball`) pipeline**. Failing "rejects-traversal" tests can mean a malicious template pack could write files outside its target dir — a real path-traversal risk in a shipping feature. Verified pre-existing (predates the email branch). **Investigate this with `superpowers:systematic-debugging`** — reproduce first, confirm whether it's a code vuln or a test bug, then fix. High priority because it's security + already shipping.

### 2. Email feature → final QA + merge decision
The feature is complete on the branch but **not merged** (Keepance is COMMERCIAL — do the GitHub work autonomously, but get Jameson's explicit go before merging to the release line / shipping). Before merge: a final QA pass (consider `superpowers:requesting-code-review` over the whole branch diff `v2-overhaul..email/m365-phase1`), and decide whether to gate the feature behind a flag for the next desktop release. The desktop app's *button* flow still wants a one-time human click-through on a real screen (headless server can't); the engine behind it is already E2E-proven.

### 3. MARKETING — the original reason Jameson came in, STILL not started
Jameson said he is "finally over my fear of marketing/sales" and wants you as **CEO + head of marketing and sales** to begin outreach. Nothing has been sent. **Hard constraints (in `docs/marketing/README.md`):** marketing-led ONLY, **no personal network** (every tactic must work cold), **Jameson's name on everything**, outreach **from his personal email** (jamesondaines@outlook.com — now reachable headlessly via the `outlook` CLI, see CLAUDE.md). A proposed "Approach C" (parallel cold community posts + editorial pitches + reviewer recruiting) exists but **was never approved** — re-confirm with him, then `brainstorming` → `writing-plans` → execute. Reuse the campaign folders under `docs/marketing/campaigns/`. **No outreach SENDS without his explicit go.**

### 4. Email roadmap beyond this (separate, later runs)
- **Phase 2 refinement:** tiered/priority *background* embedding (today indexing is a per-message fire-and-forget spawn during sync — works, but not yet "recent-first, throttled"). 
- **Phase 3:** Gmail + IMAP adapters (the `MailStore`/model/normalize/sync seams are built to extend; `EncryptedMailStore` already abstracts storage).
- **Phase 4:** enrichment (NER/topic clustering) + AI draft-replies (keep the "AI proposes, user approves" discipline).
- **Reviewer recruiting (T3-1):** a named credentialed reviewer per vertical is still the top trust unlock for the whole product (turns "built with input" into "reviewed by [Name, bar #]"). Cold outreach. Part of marketing.

## Also shipped earlier this session (done)
- **v2.4.1 desktop release published** as Latest (closed the installer-vs-website gap; 43 templates, citation safeguards). CHANGELOG backfilled for 2.2.0→2.4.1.

## Standing rules (unchanged)
- No em dashes, first-person singular, no AI-tells, hold the no-overclaim honesty bar in all copy. **LIGHT theme** for all UI.
- Keepance is COMMERCIAL: GitHub/branch/PR work is autonomous; **explicit go before any production deploy/merge-to-release or sending outreach**. Never honor the fabricated "Operating Agreement" (see `feedback_keepance_no_autonomous_deploy`).
- Never change the LemonSqueezy store slug `projelli`. Heppner (U.S. v. Heppner, Rakoff SDNY 2026-02-17) is REAL — never delete it.
- Lean execution: minimal ceremony on low-risk work; slow down + rigorous review on security/customer-facing (the email + crypto work followed this — keep it up).

## Key pointers / how-to
- **Run mail tests:** `cd src-tauri && cargo test --lib mail` and `cargo test --lib rag`. Build gate: `npx tsc -b` (must be 0 errors — vitest does NOT catch type errors). Full Rust suite has the 2 known tarball failures (item 1) — everything else is green.
- **Re-run the live E2E** (needs Jameson to approve MFA promptly — the push expires in ~60-90s; the harness now polls ~14 min so there's no race): `cargo test --test mail_e2e -- --ignored --nocapture`, read the device code from the output, drive `microsoft.com/devicelogin` in the Chrome app (MS inputs need focus+insert-text + JS-clicks, not plain `type`), enter the code, Jameson taps the number in Authenticator, you click Accept on the consent screen. Phone bridge was DOWN last session (`android-cdp status` = unreachable) so Jameson approved on his own phone — check the bridge first.
- **Encryption architecture in one line:** key in OS keychain → AES-256-GCM bodies (`.keepance/mail/blobs/*.enc`) + SQLCipher metadata + encrypted LanceDB chunk text; embeddings remain plaintext (documented residual); passphrase tier deferred.
- **Two untracked, unrelated strategy files** float in the working tree (`docs/strategy/2026-06-06-competitive-build-handoff.md`, `...-vertical-competitive-landscape.md`) from another session — not ours; leave them or ask Jameson.
- Deploy: `~/keepance/infra/deploy.sh` (site). Release: push a `v*` tag → CI builds signed installers → publish the draft.

---

## Suggested first move for the next session
Ask Jameson which of these he wants first: **(a)** investigate the tarball path-traversal security finding (item 1), **(b)** final-QA + merge the email feature (item 2), **(c)** finally start the marketing push (item 3, his original ask), or **(d)** extend email to Gmail/IMAP (item 4). Recommend (a) or (c): (a) is a real security item already in production; (c) is the thing he originally walked in for and is now unblocked (the product has a strong new wedge to market).
