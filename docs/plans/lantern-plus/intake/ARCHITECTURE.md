# Lantern Intake — E2EE Architecture & Threat Model
**Author:** dedicated Intake design session (Fable 5), 2026-07-10.
**Verified against real code** in `~/lp-ux-integrate` (branch `lp/ux-simplify-v1`); every reuse claim below names the file. One correction to the brief: the relay's configured production base is `https://api.lanternplatform.app` (`backend/src/lib/config.ts:160,165`, indirected via `BRAND.urls.firmApi`), not api.keepance.com. Same server, current name.

---

## 0. The one-paragraph design

The intake link is a **capability URL**: everything secret rides in the URL fragment, which browsers never send to servers. The client's browser encrypts each answer and document **to the advisor's public key** (which also rides in the fragment, so the server is never in the key path) using the exact sealing construction the firm relay already uses for matter keys. The relay stores ciphertext blobs plus minimal routing metadata and can decrypt nothing. The advisor's desktop app holds the only private key (OS keychain), pulls ciphertext down, decrypts locally, files documents into the client's folder (vault-encrypted at rest), and writes typed secrets into an encrypted facts store. The sentence we get to say honestly: *your client's Social Security number is encrypted in their browser and can only be decrypted on your computer; the server only ever carries sealed envelopes.*

---

## 1. What exists today (ground truth), and what is net-new

**Reused as-is (client-side crypto, all WebCrypto, browser-compatible):**
- AES-256-GCM blob sealing with versioned wire format `[1B version][12B IV][ct+tag]` and AAD binding — `src/platform/firm/matterCrypto.ts:10-11,47-49,99-103`.
- ECDH P-256 + HKDF-SHA256 + AES-256-GCM key wrapping, wire format `[version][65B ephemeral P-256 pubkey][16B salt][12B IV][ct+tag]`, epoch/context bound into HKDF info and GCM AAD — `src/platform/firm/keyWrap.ts:1-34,137-143`. **This is the sealing primitive the client page uses to encrypt to the advisor.** It already runs outside Tauri (plain WebCrypto).
- OS-keychain storage pattern (`com.lantern.<domain>.<id>` services) — `src/platform/firm/firmKeychain.ts:29-43`; vault VMK precedent for keychain-held master secrets — `src-tauri/src/commands/vault/mod.rs:42-64`.
- Ciphertext-only relay discipline: server treats blobs as opaque bytes, size cap is the only shape check — `backend/src/routes/matters.ts:28-30`, `backend/src/lib/matters.ts:14-17`.
- Capability-token precedent: single-use, short-lived, HMAC-hashed-at-rest sync tickets — `backend/src/lib/syncTickets.ts`, `backend/src/routes/matters.ts:359-428`. Refresh tokens and license keys are likewise stored only as SHA-256 HMAC hashes (`backend/src/lib/crypto.ts:163-173`) — the intake link token follows the same rule.
- Seat-token auth (Ed25519, offline-verifiable, works for solo users with no firm account) — `backend/src/lib/crypto.ts:99-137`, `src/platform/firm/seatToken.ts`.
- Advisor-side encrypted-at-rest storage: `lantern-vault` crate (KPV1, AES-256-GCM, VMK in keychain) for workspace files — `src-tauri/crates/lantern-vault/src/format.rs:18,45,66`; SQLCipher stores for structured sensitive data (CRM proposals: `src-tauri/src/commands/crm/store.rs:247-275`; encrypted audit store: `commands.rs:676`; encrypted mail blobs: `.lantern/mail/blobs/*.enc`).
- Intent/outcome audit pair machinery — `src-tauri/src/commands/crm/commands.rs:644,1126-1192` (`audit_pair_id`, intent row written before any external effect, refusal if the audit append fails).

**Net-new (nothing like it exists — verified by search of `backend/src`):**
- All intake relay endpoints and tables (there is no invite/share/guest/upload concept in the backend today; no endpoint accepts a write from an account-less browser).
- Chunked large-blob storage (today's relay caps a single update at 1 MiB, `backend/src/lib/matters.ts:34`; a license scan or statement PDF needs chunking).
- The client-facing static page (the backend serves no HTML at all; the Calendly plan's public booking page is the sibling rail — one hosting pattern for both).
- `src/features/intake/` (advisor UI) and `src/platform/intake/` (shared client-fact + intake sync logic), per the 5-layer DAG (`ARCHITECTURE.md:16-117` in the repo; features never import features, cross-cutting logic goes in `platform/`).
- The encrypted client-facts store (nothing today holds a structured SSN; the Client Map store is Zustand + localStorage and must never hold restricted values).

---

## 2. Key model (precise)

Per intake, created on the advisor's machine at compose time:

| Secret | Generated where | Lives where | Purpose |
|---|---|---|---|
| `intake_id` | advisor machine | plaintext everywhere (opaque random id) | routing |
| **Intake keypair** (ECDH P-256) | advisor machine | private key: OS keychain, service `com.lantern.intake.<intake_id>`, never leaves the machine. Public key: in the link fragment | everything sensitive is sealed to this |
| **Link secret `s`** (256-bit random) | advisor machine | only in the link fragment; advisor keeps a copy in the keychain entry to re-derive on demand | derives the two link-scoped keys below via HKDF-SHA256 with distinct info strings |
| `k_page = HKDF(s, "intake/page/v1")` | derived | client browser (in memory) + advisor machine | AES-256-GCM key for the checklist definition and the resume/progress state (the client must be able to read these back) |
| `t_auth = HKDF(s, "intake/auth/v1")` | derived | presented as a bearer header by the client page; **server stores only `HMAC(t_auth)`** (same rule as refresh tokens, `crypto.ts:163-173`) | proves link possession to the relay; gates every public intake request |
| **Per-item content key** (AES-256, fresh per submission) | client browser | wrapped to the intake public key via the `keyWrap.ts` construction; the browser discards it after upload | encrypts one item's payload; gives us write-only semantics |

**The link:** `https://<intake-host>/i/<intake_id>#v1.<base64(s)>.<base64(advisor P-256 public key, 65B)>` — roughly 160 characters. The fragment is never transmitted in HTTP requests, never logged by the server, and never appears in referrers (the page sets `Referrer-Policy: no-referrer`).

**Why the public key rides in the fragment:** if the page fetched the advisor's public key from the relay, a malicious or compromised relay could substitute its own key and read every submission. With the key in the fragment, the relay is out of the key path entirely; the trust root shifts to the served JavaScript (addressed honestly in §8 and RISKS.md).

**Write-only property (the design's backbone):** typed secrets and documents are sealed with a fresh content key wrapped only to the advisor. The resume state (encrypted with `k_page`, which any link holder has) contains **only** item completion flags, display confirmations (SSN last-4, file names as the client typed them), and the client's first name. Therefore: a leaked or forwarded link can see progress and submit or overwrite items, but can never read back a submitted SSN or download a license scan. The client page tells the client this plainly.

**Multi-advisor firms:** v1 decrypts on the creating advisor's machine only. Wave 5 wraps the intake private key to the matter's member devices using the existing `wrapped_matter_keys` machinery (`backend/src/routes/matterKeys.ts:30-148`, `src/platform/firm/matterKeyService.ts`) and, matching the vault's escrow precedent (`vaultClient.ts:272-302`), to org-admin devices — so a departed advisor's in-flight intakes are recoverable by the firm. Until then, the failure mode is honest: if the creating advisor's machine is lost, in-flight submissions are unreadable and the intake is re-sent (facts already synced down are unaffected).

**Solo advisors:** intake creation authenticates with the seat token alone (`X-Seat-Token`, Ed25519-verified server-side as `/seat/validate` does today, `routes/seats.ts:11-15`) — no firm account required. Firm users additionally send their access JWT, which lets the relay attach org context for the Wave 5 sharing case.

---

## 3. Relay: endpoints, storage, and honest metadata

New route group `routes/intake.ts` beside the existing groups in `backend/src/server.ts`. Same Bun + `bun:sqlite` stack, new tables in the one schema string (`backend/src/lib/db.ts`).

**Advisor-authenticated (seat token; JWT additionally when present):**

| Endpoint | Effect |
|---|---|
| `POST /intake` | create: stores `{intake_id, seat/org identity, token_hash, expires_at, status, checklist_ciphertext (k_page-sealed), state_ciphertext}` |
| `PUT /intake/:id/checklist` | replace the sealed checklist (advisor edited items after sending); bumps a `checklist_version` the page polls |
| `GET /intake/:id/inbox` | list submitted items' envelopes since a cursor (metadata + ciphertext refs) |
| `GET /intake/:id/blob/:blob_id` | download ciphertext chunks |
| `POST /intake/:id/ack` | confirm items durably stored locally → **relay deletes the acked ciphertext** (retention minimization; the relay is a mailbox, not an archive) |
| `POST /intake/:id/revoke` \| `/extend` | kill or extend the link |

**Public (require `Authorization: Bearer t_auth`; constant-time HMAC compare; rate-limited per intake and per IP):**

| Endpoint | Effect |
|---|---|
| `GET /intake/:id/bundle` | sealed checklist + sealed resume state + `checklist_version` (the page's boot call) |
| `PUT /intake/:id/state` | save sealed resume state (small cap, ~64 KiB) |
| `POST /intake/:id/item/:item_id/chunk` | upload one ciphertext chunk (≤4 MiB per chunk — comfortably inside SQLite blob handling; server enforces per-intake total cap, default 500 MiB) |
| `POST /intake/:id/item/:item_id/submit` | finalize an item: sealed manifest (file names, chunk hashes, content type live *inside* the ciphertext) + the wrapped content key; server marks prior chunks bound |

Expired or revoked intakes answer every public call with the same neutral 410 — the revoked page must leak nothing, not even whether the id ever existed (uniform response for unknown ids too).

**What the server unavoidably sees (the honest list, for the Data Map and the IT pack):**
- `intake_id`; the creating seat/org identity; creation, expiry, revocation timestamps.
- Opaque item ids and their submission timestamps; ciphertext sizes and chunk counts (traffic analysis can guess "a ~2 MB photo was uploaded"); `checklist_version`.
- `HMAC(t_auth)`; client-side request metadata the HTTP layer always has: IP address and user agent per request (we keep these out of durable storage — access-log retention 24h, in-memory rate-limit buckets only).
- **Not** seen: the client's name (inside the sealed checklist), email or phone (v1 links are sent from the advisor's own mail/SMS apps — the relay never learns the address), item labels, any answer, any file name or content. Note this is *tighter* than today's firm sync, which stores `client_name` in plaintext in the `matters` table (`db.ts:142-149`); intake must not repeat that.

**Advisor offline:** submissions queue as ciphertext on the relay until the desktop next syncs (mailbox model). Nothing requires the advisor online except Document Detective's deep tier.

---

## 4. Client-page crypto (what the browser can and cannot do)

The page is a self-contained static SPA (no third-party origins, no CDN, no analytics; CSP `default-src 'none'` plus its own bundle and the relay API; `Referrer-Policy: no-referrer`). Hosting rides the same rail as the Calendly plan's public booking page (one static-host + relay-API pattern for both client-facing surfaces).

Boot: parse fragment → derive `k_page`, `t_auth` → fetch bundle → decrypt checklist + state → render. Per item submit: fresh AES-256 content key → encrypt payload (typed value as a small JSON blob; files as 4 MiB chunks, each `[version][IV][ct+tag]` with AAD `intake:<id>:item:<item_id>:chunk:<n>` so chunks can't be reordered or transplanted) → wrap content key to the advisor public key (`keyWrap.ts` construction, context string `intake/item/v1` in HKDF info + AAD) → upload chunks, then submit manifest + wrapped key → **discard the content key and plaintext**; update the sealed resume state with the completion flag + display confirmation only.

The page **can**: render the checklist, resume progress on any device with the link, show last-4/file-name confirmations, run Tier-1 Document Detective locally (text extraction + keyword rules on the user's own document, in their own browser — nothing leaves the device unencrypted).
The page **cannot**: read back any submitted secret (it holds no unwrap key), see other clients or the advisor's workspace, or reach any origin but the relay.

**Old browsers:** feature-detect WebCrypto (`crypto.subtle`, P-256 ECDH) at boot; on failure, show the honest fallback ("reply to [advisor]'s email instead") — no degraded-crypto mode, ever. Every 2020+ evergreen browser and iOS/Android system browser passes.

---

## 5. Advisor machine: where decrypted data lands

Sync-down (in `src/platform/intake/IntakeSyncClient.ts`, modeled on `MatterSyncClient.ts`): fetch inbox → unwrap content key with the keychain private key → decrypt → route by payload type → **ack only after local durable write succeeds** (crash between decrypt and write must re-deliver, so ack is the last step).

| Payload | Destination | At-rest protection |
|---|---|---|
| Documents (license scans, statements) | the client's folder via `WorkspaceService` (one folder per client — `matterManagerDialogHelpers.ts:53,73`), under an `Onboarding/` subfolder | `lantern-vault` KPV1 when the vault is on (`vault.rs:117`); the UI nudges vault-off users once, plainly, when the first intake lands |
| Typed secrets (SSN, DOB) | **new encrypted facts store** — SQLCipher, same pattern as the CRM proposal store (`crm/store.rs:247`), keyed by `matter_id` | SQLCipher; never localStorage, never the Zustand Client Map store |
| Non-secret answers (income figure, spending range, "I don't know" flags) | facts store (canonical) + a masked/summary `ClientMapItem` with a `SourceRef` into the facts store | Client Map shows presence and provenance, not restricted values |
| Checklist/item state | intake state in `src/platform/intake/intakeStore.ts` (Zustand, non-sensitive: states, timestamps, last-4 display strings) | ordinary app state |

**Masking and audit:** SSN renders `•••-••-1234` everywhere by default; click-to-reveal writes an audit row (the reveal is an auditable event, same append-only encrypted audit store as CRM writes, `commands.rs:676`). Export/copy of a restricted fact likewise audits. Every intake receipt writes an intent/outcome pair via the existing machinery (`audit_pair_id` pattern, `commands.rs:1126`): intent = "item received, filing to folder/facts", outcome = confirmed with the file path / fact id — mirroring the CRM engine's refuse-if-audit-fails rule.

**Retention:** relay ciphertext deleted on ack (and at expiry + 30-day grace regardless). Local retention is firm policy: facts persist (they are the ask-once layer); a per-item purge control exists from Wave 1 (delete scan + fact, with an audit row). Defaults per QUESTIONS-FOR-JAMESON #4.

---

## 6. Link lifecycle

- **Expiry:** default 30 days (product default, advisor-visible and extendable in one click). Server enforces; the page renders the friendly expired state; the advisor board shows "client tried an expired link" as a signal.
- **Revocation:** instant server-side kill (`status=revoked`); uniform neutral page. Received items are unaffected.
- **Regeneration:** new `s` (new `t_auth`, new `k_page`) for the same intake and the same keypair; the old link dies. Used for "I think I forwarded it somewhere weird" and for un-revoking. Because submissions are sealed to the keypair, not to `s`, nothing already received needs rewrapping; the resume state is re-sealed to the new `k_page` by the advisor app at regeneration time.
- **Resume:** the link is the resume token. State saves after every item; any device with the link resumes at the next incomplete item.
- **Opened twice / two devices:** allowed; per-item last-write-wins with both provenance rows kept advisor-side. No sessions, no lockouts.
- **Partial uploads:** chunks are individually durable; the manifest-submit finalizes. A dead upload resumes at the missing chunk (the page asks the relay which chunk indexes exist — count only, no content).

---

## 7. AI placement (why Document Detective is two-tier)

The client's browser has no AI keys and must never get any (BYOK keys are the advisor's; shipping them into a public page would be an incident). So:
- **Tier 1, in-browser, instant:** deterministic local classification (pdf/text extraction + keyword and layout rules) on the client's own device. Private by construction — the document hasn't left the device yet. Catches wrong-document and wrong-side-of-license immediately.
- **Tier 2, advisor machine, minutes later:** full AI read (BYOK/local, the app's normal provider rails) after decryption; proposes checklist matches, extracted income/spending facts, and nudge content — all propose-then-approve with receipts.

An "instant AI on the client page" variant would require routing plaintext through someone's inference account and would break the E2EE sentence; we don't do it, and we say so in the privacy explainer.

---

## 8. Threat model

| # | Threat | Answer |
|---|---|---|
| T1 | **Relay compromise / subpoena / insider** reads stored data | Gets ciphertext, token hashes, and §3's metadata list. No keys, no plaintext, no client names. This is the core guarantee and it is structural, not policy. |
| T2 | **Relay actively malicious: substitutes keys** | Out of the key path — the sealing key arrives via the link fragment, never from the relay (§2). |
| T3 | **Relay actively malicious: serves poisoned page JS** | The residual trust root, stated honestly (also RISKS.md §3): a malicious intake host could serve JS that exfiltrates plaintext. Mitigations: page and API on separate concerns (static host serves only the audited bundle), self-contained versioned builds with published hashes, CSP pinning `connect-src` to the relay origin only (exfiltration would need the relay itself to cooperate), reproducible-build verification on the roadmap. Equal-or-better than every "secure portal" competitor, which holds server-readable plaintext outright. |
| T4 | **Link leaked / forwarded / guessed** | Guessing: 256-bit fragment secrets and unguessable ids; uniform 410s prevent oracle probing. Leak: holder can view progress labels and submit items, cannot read any submitted secret (write-only, §2), cannot learn the client's identity beyond the first name in the sealed state they can decrypt with the leaked fragment. Advisor one-click revoke + regenerate; anomalies (new item overwrites after completion) flag on the board. |
| T5 | **Client device malware / shoulder-surfing** | Out of scope, stated honestly — identical exposure to typing an SSN anywhere. Masked input reduces shoulder-surfing; we never persist plaintext to the device (no localStorage of answers, memory only). |
| T6 | **Advisor machine compromise** | Equivalent to today's posture for everything else in the app; keychain-held keys, vault at rest, audit trail. Intake adds no new class of exposure. |
| T7 | **Wrong-recipient send** (advisor texts the wrong person) | The link opens with the intended client's first name on it ("Hi Sarah") — a human-visible tripwire; write-only means a wrong recipient can inject noise but read nothing; revoke + regenerate recovers. |
| T8 | **Malicious client uploads** (malware files, zip bombs) | Files land as inert bytes in the vault-encrypted folder; no server-side parsing (server never decrypts — structurally immune); advisor-side: type sniffing, size caps, no auto-open, Tier-2 parsing in the existing sandboxed extraction rails. |
| T9 | **DoS on public endpoints** | `t_auth` required before any body is read; per-intake and per-IP rate limits; chunk and total-size caps; upload quota per intake. |
| T10 | **Traffic analysis** | Sizes/timing/IPs visible (§3). Minimized (24h access logs, no durable IP storage), not hidden — stated in the honest-metadata list rather than overclaimed. |
| T11 | **Email fallback confusion** | The email door is *not* E2EE and is never described as such; provenance chips distinguish channels; marketing may never blur this (RISKS.md §5). |

---

## 9. The "ask once" client-fact schema (defined now, consumed by prefill later)

Canonical TypeScript in `src/platform/intake/types.ts`; persisted rows in the SQLCipher facts store. This is the contract the Schwab-prefill mapping (its plan's step 2: meeting/CRM fields → form fields) extends to intake facts, and the ACATS/RightCapital tracks consume later.

```ts
interface ClientFact {
  fact_id: string;
  matter_id: string;              // locked identifier, never renamed
  subject: string;                // household member key ("primary", "spouse", or person id)
  kind: FactKind;                 // 'dob' | 'ssn' | 'income_annual' | 'spending_monthly'
                                  // | 'drivers_license' | 'address' | 'employer' | ... (extensible registry)
  value: FactValue;               // typed union: { t:'date'|'string'|'money'|'range'|'doc_ref', v: ... }
  sensitivity: 'restricted'       // SSN, full DL data: SQLCipher only, masked UI, audited reveal
             | 'confidential'     // income, spending, DOB
             | 'standard';
  provenance: {
    channel: 'intake_link' | 'email_reply' | 'phone_walkthrough' | 'doc_extraction' | 'manual';
    source_ref?: string;          // intake item id, mail message id, or document path + page
    entered_by: 'client' | string;    // advisor user id when not the client
    confirmed_by?: string;        // advisor id for channels requiring confirmation (email, extraction)
    at: string;                   // ISO timestamp
  };
  verification: 'client_stated' | 'document_verified' | 'advisor_confirmed';
  status: 'active' | 'superseded';
  superseded_by?: string;         // facts are never edited in place; corrections append
}
```

Rules: append-only with supersede chains (an SSN correction is a new fact superseding the old — the audit story writes itself); one active fact per `(matter_id, subject, kind)`; every consumer (prefill, CRM write, map item) records the `fact_id` it used, which is what makes "ask once, never re-ask" auditable end to end. Downstream consumers read through one accessor (`platform/intake/factsStore.ts`) that enforces masking policy by sensitivity tier — features never query SQLCipher directly.

---

## 10. Failure modes (explicit)

| Failure | Behavior |
|---|---|
| Link opened twice / two devices | Both valid; last-write-wins per item; dual provenance kept (§6). |
| Old browser, no WebCrypto | Detected at boot; honest email-fallback screen; no downgraded crypto path exists (§4). |
| Upload dies mid-file | Chunk-level resume; page shows "didn't finish" with one-tap resume (§6). |
| Advisor offline for days | Relay is the ciphertext mailbox; board catches up on next launch; ack-after-write means nothing is lost either way (§5). |
| Advisor machine lost (v1, pre-Wave-5) | In-flight submissions unreadable (private key gone); already-synced facts/files intact; advisor re-sends a fresh intake. Honest, bounded, fixed by Wave 5 escrow. |
| Relay down | Client page fails politely and preserves typed-but-unsubmitted input in memory; retry with backoff; nothing sensitive persisted client-side. |
| Crash between decrypt and local write | No ack sent → relay re-delivers on next sync (§5 ack-last rule). |
| Duplicate submission of one item | Server versions per item; advisor sees both with timestamps; facts store supersede chain resolves (§9). |
