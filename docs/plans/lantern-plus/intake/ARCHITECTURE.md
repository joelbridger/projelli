# Lantern Intake — E2EE Architecture & Threat Model
**Author:** dedicated Intake design session (Fable 5), 2026-07-10.
**Verified against real code** in `~/lp-ux-integrate` (branch `lp/ux-simplify-v1`); every reuse claim below names the file. One correction to the brief: the relay's configured production base is `https://api.lanternplatform.app` (resolved by `getFirmApiBase` in `src/platform/firm/firmConfig.ts:15-74` from `BRAND.urls.firmApi` in `src/config/brand`, overridable via `VITE_FIRM_API_BASE`), not api.keepance.com. Same server, current name.

---

## 0. The one-paragraph design

The intake link is a **capability URL**: everything secret rides in the URL fragment, which browsers never send to servers. The client's browser encrypts each answer and document **to the intake public key** (created by the advisor's desktop; it also rides in the fragment, so the server is never in the key path) using the same sealing construction the firm relay already uses for matter keys. The relay stores opaque bytes plus minimal routing metadata; an honest client sends only ciphertext, and the relay holds no key to read anything. The advisor's desktop app holds the only private key (OS keychain), pulls ciphertext down, decrypts locally, files documents into the client's folder (vault-encrypted at rest), and writes typed secrets into an encrypted facts store. The sentence we get to say honestly: *your client's Social Security number is encrypted in their browser and can only be decrypted on your computer; the server holds no key to read anything.* (Claims wording rules: RISKS.md §2.)

---

## 1. What exists today (ground truth), and what is net-new

**Reused as-is (client-side crypto, all WebCrypto, browser-compatible):**
- AES-256-GCM blob sealing with versioned wire format `[1B version][12B IV][ct+tag]` and AAD binding — `src/platform/firm/matterCrypto.ts:10-11,47-49,99-103`.
- ECDH P-256 + HKDF-SHA256 + AES-256-GCM key wrapping, wire format `[version][65B ephemeral P-256 pubkey][16B salt][12B IV][ct+tag]`, epoch/context bound into HKDF info and GCM AAD — `src/platform/firm/keyWrap.ts:1-34,137-143`. **Same construction, sibling implementation:** the existing functions hardcode matter-key context strings and unwrap via the local device key, so intake gets its own wrapper module reusing the construction and wire format with intake-specific HKDF info + AAD (`intake/item/v1`) and intake-keychain unwrap — with its own round-trip and cross-context tamper tests (a matter-context wrap must never unwrap under an intake context, and vice versa). It runs outside Tauri (plain WebCrypto).
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

**Why the public key rides in the fragment:** if the page fetched the intake public key from the relay, a malicious or compromised relay could substitute its own key and read every submission. With the key in the fragment, the relay is out of the key path entirely; the trust root shifts to the served JavaScript (addressed honestly in §8 and RISKS.md).

**Write-only property (the design's backbone):** typed secrets and documents are sealed with a fresh content key wrapped only to the intake public key. The resume state (encrypted with `k_page`, which any link holder has) contains **only** item completion flags, display confirmations, and the client's first name. Therefore: a leaked or forwarded link can see progress and submit items, but can never read back a submitted SSN or download a license scan. The client page tells the client this plainly.

**What a link holder can see and do (the exact list, kept minimal by design):** the firm's name and branding; the checklist item labels; the client's first name; per-item done/not-done flags; generic confirmations ("Social Security number provided", "2 photos provided" — the resume state stores **no last-4 and no file names**; those confirmations render only in the live session from memory); any outbound prefill values the advisor explicitly chose to include (later waves; tiered and previewed, never restricted facts — §9a); and the ability to submit new values for open items. They can never read a submitted value or document. Overwrites of already-completed items are flagged to the advisor as anomalies.

**Resume state is cosmetic, never authoritative — for the client page too:** because any link holder can rewrite `k_page`-sealed state, nothing trusted may derive from it on either side. The advisor app derives all truth (item states, provenance, values) exclusively from finalized sealed submissions. The client page derives **done/not-done from the relay's own finalization records** (the server already knows which items have a finalized submission — that's §3 metadata it holds regardless), so *forging state* cannot mark items done. The honest limit: a link holder can still mark an open item done the legitimate way — **by actually submitting to it**, which creates a real finalization record the real client's page will show as done. Three mitigations: every submission carries an ephemeral per-session marker (minted at first page open, kept in that browser), and the advisor board surfaces a "new device" chip on **every** submission from a previously unseen session — first submissions to open items included, not just post-completion overwrites; the client page renders "provided by you just now" for the local session vs plain "provided" for anything else, so a real client can notice work they didn't do; and revoke + regenerate remains one click. The resume state itself carries only harmless display details (current position, draft non-sensitive text, generic confirmations).

**Replay protection:** every submission carries a client-generated random `submission_id` inside the sealed manifest, bound into every chunk's AAD, and repeated in plaintext metadata. The plaintext copy is **only a relay hint** (it lets the server reject crude duplicate posts); the authoritative id is the sealed one. After decrypting, the advisor app verifies that the plaintext id, the sealed manifest id, and the chunk AAD binding all agree — any mismatch is rejected and flagged — then dedupes by the **decrypted** manifest id. So re-posting old ciphertext under a fresh plaintext label fails the mismatch check, and a stale submission can only ever surface as a flagged duplicate, never silently replace a newer answer (the facts store's supersede chain orders by advisor-verified receipt, not by claimed timestamps).

**Multi-advisor firms:** Wave 5 grants team decrypt and recovery by wrapping the intake private-key JWK separately to each eligible matter-member device and to org-admin devices for escrow. The relay holds only those opaque device wraps. Removal stops future grants, deletes the departed member's relay rows, and stops their relay fetch access. It does **not** cryptographically revoke a private key that member already downloaded: they may still decrypt ciphertext they already hold. That limit is inherent because an in-flight intake must keep the same public key so the client link remains valid. The real rotation path is to re-send a fresh intake with a new keypair. If an admin device was enrolled before the creator's machine is lost, it can recover the in-flight intake through escrow; without an enrolled escrow device, re-send a fresh intake. Facts and files already synced down are unaffected in either case.
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
| `GET /intake/:id/bundle` | sealed checklist + sealed resume state + `checklist_version` + per-item finalization flags from the server's own records (the page's boot call; done/not-done never trusts the writable resume state — §2) |
| `PUT /intake/:id/state` | save sealed resume state (small cap, ~64 KiB) |
| `POST /intake/:id/item/:item_id/chunk` | upload one ciphertext chunk (≤4 MiB per chunk — comfortably inside SQLite blob handling; 100 MB per file, matching the client-page cap; per-intake total default 500 MiB). Chunks are stored keyed by `(intake, item, submission_id, index)` — never by item+index alone, or two concurrent submissions to the same open item (two devices, §6) would collide on index 0 before either finalizes |
| `POST /intake/:id/item/:item_id/submit` | finalize an item: sealed manifest (file names, chunk hashes, content type, `submission_id` live *inside* the ciphertext) + plaintext `submission_id` + the wrapped content key; server marks prior chunks bound and rejects duplicate `submission_id`s |

Expired, revoked, unknown, and wrong-token requests all answer with the same neutral 410 after the same constant-time token check — a probe must not be able to distinguish "wrong token on a live intake" from "no such intake," or the id space becomes an oracle. For unknown ids there is no stored `HMAC(t_auth)`, so the handler compares against a fixed decoy hash with the same constant-time routine (the relay's `hmacEquals` pattern, `backend/src/lib/crypto.ts:163-173`) — otherwise the timing difference itself leaks existence.

**What the server unavoidably sees (the honest list, for the Data Map and the IT pack):**
- `intake_id`; the creating seat/org identity; creation, expiry, revocation timestamps.
- Opaque item ids and their submission timestamps; ciphertext sizes and chunk counts (traffic analysis can guess "a ~2 MB photo was uploaded"); `checklist_version`.
- `HMAC(t_auth)`; client-side request metadata the HTTP layer always has: IP address and user agent per request (we keep these out of durable storage — access-log retention 24h, in-memory rate-limit buckets only).
- **Not** seen: the client's name (inside the sealed checklist), email or phone (v1 links are sent from the advisor's own mail/SMS apps — the relay never learns the address), item labels, any answer, any file name or content. Note this is *tighter* than today's firm sync, which stores `client_name` in plaintext in the `matters` table (`db.ts:142-149`); intake must not repeat that.

**Advisor offline:** submissions queue as ciphertext on the relay until the desktop next syncs (mailbox model). Nothing requires the advisor online except Document Detective's deep tier.

---

## 4. Client-page crypto (what the browser can and cannot do)

The page is a self-contained static SPA (no third-party origins, no CDN, no analytics; CSP `default-src 'none'` plus its own bundle and the relay API; `Referrer-Policy: no-referrer`). Hosting rides the same rail as the Calendly plan's public booking page (one static-host + relay-API pattern for both client-facing surfaces).

Boot: parse fragment → derive `k_page`, `t_auth` → fetch bundle → decrypt checklist + state → render. Per item submit: fresh AES-256 content key → encrypt payload (typed value as a small JSON blob; files as 4 MiB chunks, each `[version][IV][ct+tag]` with AAD `intake:<id>:item:<item_id>:submission:<sid>:chunk:<n>` so chunks can't be reordered, transplanted across items or intakes, or mixed between submissions) → wrap content key to the intake public key (the intake sibling of the `keyWrap.ts` construction, §1) → upload chunks, then submit manifest + wrapped key → **discard the content key and plaintext**; update the sealed resume state with the completion flag + a generic confirmation only (no last-4, no file names — §2).

The page **can**: render the checklist, resume progress on any device with the link, show in-session confirmations (last-4 renders from memory during the submitting session only), run Tier-1 Document Detective locally (text extraction + keyword rules on the user's own document, in their own browser — nothing leaves the device unencrypted).
The page **cannot**: read back any submitted secret (it holds no unwrap key), see other clients or the advisor's workspace, or reach any origin but the relay.

**Old browsers:** feature-detect WebCrypto (`crypto.subtle`, P-256 ECDH) at boot; on failure, show the sensitivity-routed fallback (documents → reply to the advisor's email; SSN and other restricted fields → "call [advisor] and do it together," i.e. phone mode — PRODUCT-DESIGN.md §6; the most sensitive value never gets nudged into the weakest channel). With JS disabled entirely the page can't decrypt the checklist or know the advisor's name, so a static `<noscript>` block says only: "This secure page needs a current browser. Please reply to the message that brought you here." No degraded-crypto mode, ever. Every 2020+ evergreen browser and iOS/Android system browser passes.

---

## 5. Advisor machine: where decrypted data lands

Sync-down (in `src/platform/intake/IntakeSyncClient.ts`, modeled on `MatterSyncClient.ts`): fetch inbox → unwrap content key with the keychain private key → decrypt → route by payload type → **ack only after local durable write succeeds** (crash between decrypt and write must re-deliver, so ack is the last step).

| Payload | Destination | At-rest protection |
|---|---|---|
| Documents (license scans, statements) | the client's folder via `WorkspaceService` (one folder per client — `matterManagerDialogHelpers.ts:53,73`), under `Requests/onboarding/` — the general engine's convention from day one (§9a), so Wave 7 never re-files anything | `lantern-vault` KPV1 when the vault is on (`vault.rs:117`); the UI nudges vault-off users once, plainly, when the first intake lands |
| Typed secrets (SSN, DOB) | **new encrypted facts store** — SQLCipher, same pattern as the CRM proposal store (`crm/store.rs:247`), keyed by `matter_id` | SQLCipher; never localStorage, never the Zustand Client Map store |
| Non-secret answers (income figure, spending range, "I don't know" flags) | facts store (canonical) + a masked/summary `ClientMapItem` with a `SourceRef` into the facts store | Client Map shows presence and provenance, not restricted values |
| Checklist/item state | intake state in `src/platform/intake/intakeStore.ts` (Zustand, non-sensitive: item states, timestamps, `fact_id` references, provenance) — **no last-4 or any value fragment ever enters ordinary app state**; masked renderings (•••-••-1234) are produced on demand by the facts-store accessor | ordinary app state |

**Masking and audit:** SSN renders `•••-••-1234` everywhere by default; click-to-reveal writes an audit row (the reveal is an auditable event, same append-only encrypted audit store as CRM writes, `commands.rs:676`). Export/copy of a restricted fact likewise audits. Every intake receipt writes an intent/outcome pair via the existing machinery (`audit_pair_id` pattern, `commands.rs:1126`): intent = "item received, filing to folder/facts", outcome = confirmed with the file path / fact id — mirroring the CRM engine's refuse-if-audit-fails rule.

**Retention:** relay ciphertext deleted on ack (and at expiry + 30-day grace regardless). Local retention is firm policy: facts persist (they are the ask-once layer); a per-item purge control exists from Wave 1 (delete scan + fact, with an audit row). Defaults decided 2026-07-10 (QUESTIONS #4): scans kept encrypted in the client folder; per-client one-click delete; optional firm-wide auto-delete, off by default.

---

## 6. Link lifecycle

- **Expiry:** default 30 days (product default, advisor-visible and extendable in one click). Server enforces; the page renders the friendly expired state; the advisor board shows "client tried an expired link" as a signal.
- **Revocation:** instant server-side kill (`status=revoked`); uniform neutral page. Received items are unaffected.
- **Regeneration:** new `s` (new `t_auth`, new `k_page`) for the same intake and the same keypair; the old link dies. Used for "I think I forwarded it somewhere weird" and for un-revoking. Because submissions are sealed to the keypair, not to `s`, nothing already received needs rewrapping; the advisor app re-seals **both** the `checklist_ciphertext` and the `state_ciphertext` under the new `k_page` at regeneration time (the old-key copies would otherwise be undecryptable to the new link and the page would break — regeneration is a Wave 1 gate and this re-seal is part of it).
- **Resume:** the link is the resume token. State saves after every item; any device with the link resumes at the next incomplete item.
- **Opened twice / two devices:** allowed; when one item receives multiple sealed submissions, the advisor side keeps every one with its provenance and resolves through the facts store's supersede chain (advisor-visible, never a silent overwrite). No sessions, no lockouts.
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
| T3 | **Relay actively malicious: serves poisoned page JS** | The residual trust root, stated honestly (also RISKS.md §3): a malicious intake host could serve JS that exfiltrates plaintext typed *from that session onward*. This means the E2EE guarantee is conditional on page integrity, and every claim we publish must be worded accordingly (RISKS.md §2). Mitigations, required from Wave 1: static host serves only the audited self-contained bundle; versioned builds with **published hashes and a deploy-time integrity check** (the deploy fails if the served bundle's hash differs from the signed manifest); CSP pinning `connect-src` to the relay origin only (exfiltration would need the relay itself to cooperate); reproducible-build verification on the roadmap. Equal-or-better than every "secure portal" competitor, which holds server-readable plaintext as its normal operating mode. |
| T4 | **Link leaked / forwarded / guessed** | Guessing: 256-bit fragment secrets and unguessable ids; uniform 410s (including wrong-token, §3) prevent oracle probing. Leak: the holder gets exactly the §2 list — firm name, item labels, client first name, done flags, generic confirmations, any advisor-opted outbound prefills (§9a; never restricted facts), and the ability to submit — never a submitted value, never last-4, never file names. A holder can also complete an open item by genuinely submitting to it (§2's honest limit) — every submission from a new session carries a "new device" chip on the board, overwrite or not. Advisor one-click revoke + regenerate. |
| T5 | **Client device malware / shoulder-surfing** | Out of scope, stated honestly — identical exposure to typing an SSN anywhere. Masked input reduces shoulder-surfing; we never persist plaintext to the device (no localStorage of answers, memory only). |
| T6 | **Advisor machine compromise** | Equivalent to today's posture for everything else in the app; keychain-held keys, vault at rest, audit trail. Intake adds no new class of exposure. |
| T7 | **Wrong-recipient send** (advisor texts the wrong person) | The link opens with the intended client's first name on it ("Hi Sarah") — a human-visible tripwire; write-only means a wrong recipient can read nothing, though they can submit into open items (each such submission wears the new-device chip, per T4); revoke + regenerate recovers. |
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
  kind: FactKind;                 // versioned registry, defined in full in Wave 1 even where not yet
                                  // collected: 'dob' | 'ssn' | 'income_annual' | 'spending_monthly'
                                  // | 'drivers_license' | 'address' | 'citizenship' | 'employer'
                                  // | 'beneficiary' | ... — the Schwab prefill mapping needs address,
                                  // citizenship, and beneficiaries, so those registry entries (and their
                                  // sensitivity tiers) are locked now; intake merely populates them later
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

### 9a. The form-request primitive (Addendum 1: one schema for onboarding AND standing requests)

The engine's unit is a **form request**; onboarding intake is one kind of it. The `intake` wire namespace (endpoints §3, tables, keychain services) is the primitive's stable name — like `matter`, it never renames as the user-facing surface generalizes.

```ts
interface FormRequest {
  request_id: string;             // == the intake_id of §2-§3; one E2EE link per request
  schema_version: number;         // from Wave 1; later waves evolve additively
  matter_id: string;
  kind: 'onboarding' | 'standing';        // v1 ships 'onboarding'; the field exists from Wave 1
  blueprint_ref?: string;         // firm template, imported-PDF map, or (later) built form
  items: RequestItem[];
  // link/key/lifecycle state exactly as §2 and §6 — properties of the primitive
}

type RequestItem =
  | { t: 'typed_field'; ... } | { t: 'doc_upload'; ... }
  | { t: 'guided_question'; ... } | { t: 'readonly_card'; ... }
  | { t: 'pdf_fill';               // later wave: imported AcroForm field map;
      pdf_ref: string;             // fields render as ordinary items on the page;
      field_map: PdfFieldMap;      // filled PDF regenerated + sealed client-side
      prefill: PdfPrefill[] }
  | { t: 'signature';              // later wave: the sign stage
      grade: 'docusign' | 'native_clicksign' };

type PrefillMode = 'blank' | 'hidden_confirm' | 'visible_prefill';
interface PdfPrefill {
  field_id: string;
  fact_id?: string;                // provenance on the advisor side
  fact_kind: FactKind;
  sensitivity: 'restricted' | 'confidential' | 'standard';
  mode: PrefillMode;               // restricted → never 'visible_prefill' (enforced in types + tests)
  value_page_ciphertext?: string;  // present only for 'visible_prefill' — the page renders values
}                                  // from this, never from a fact_id it cannot resolve

// FormRequest carries schema_version from Wave 1. Waves 7-10 are expected to evolve the
// schema ADDITIVELY (new item types, new fields) — "forward-compatible" means no migration
// of existing data and no breaking rewrites, not that the Wave 1 types are final.
```

**Prefill respects the leaked-link model (§2), with tiered modes:** anything prefilled to the client page necessarily becomes readable to any link holder (it ships under `k_page` so the page can render it). So the promise splits in two — **submitted payloads are write-only, always; outbound prefills are link-visible, by construction** — and prefill is tiered accordingly: `standard` facts may prefill automatically; `confidential` facts (address, DOB) prefill only on explicit advisor opt-in with a preview of exactly what ships; `restricted` facts (SSN, DL data) **never** prefill outbound — the page shows "already on file with [Firm] — confirm it's still right, or replace it" with no value and no fragment of it. Secrets flow client → advisor, never advisor → link.

Two honesty rules the schema encodes:
- **PDF fill stays inside the E2EE envelope** — parsing the AcroForm map happens on the advisor's machine at import; the client page receives the sealed map, renders mapped fields as normal items, regenerates the filled PDF locally (pdf-lib class tooling, in-browser), and seals it like any payload. Prefilled values come from `ClientFact`s and each carries its `fact_id` (ask-once, auditable).
- **The DocuSign sign stage exits the E2EE envelope by design** — a document sent for custodian-grade signature transits DocuSign's cloud, because that is the rail custodians accept. The flow marks this boundary explicitly (audit row + Integration Honesty Card); the native click-to-sign grade (firm-internal forms, later) stays E2EE end to end.

**Returned artifacts:** everything lands under the client folder's `Requests/<request-slug>/` from Wave 1 onward (the onboarding intake is `Requests/onboarding/`) — filled PDFs, signed envelopes, uploads — each write audited, each extracted answer becoming a `ClientFact` with `source_ref` into the request. One convention from day one; nothing ever re-files.

---

## 10. Failure modes (explicit)

| Failure | Behavior |
|---|---|
| Link opened twice / two devices | Both valid; last-write-wins per item; dual provenance kept (§6). |
| Old browser, no WebCrypto | Detected at boot; sensitivity-routed fallback (documents → email, restricted fields → phone; generic message under no-JS); no downgraded crypto path exists (§4). |
| Upload dies mid-file | Chunk-level resume; page shows "didn't finish" with one-tap resume (§6). |
| Advisor offline for days | Relay is the ciphertext mailbox; board catches up on next launch; ack-after-write means nothing is lost either way (§5). |
| Advisor machine lost | With a previously enrolled org-admin escrow device, the firm can recover the in-flight intake. Without that enrolled escrow device, in-flight submissions are unreadable; already-synced facts/files remain intact and the advisor re-sends a fresh intake with a new keypair. Team grant-set re-publishing is not key revocation: a device that already obtained the old in-flight key may still decrypt ciphertext it already holds. |
| Advisor machine lost (v1, pre-Wave-5) | In-flight submissions unreadable (private key gone); already-synced facts/files intact; advisor re-sends a fresh intake. Honest, bounded, fixed by Wave 5 escrow. |
| Relay down | Client page fails politely and preserves typed-but-unsubmitted input in memory; retry with backoff; nothing sensitive persisted client-side. |
| Crash between decrypt and local write | No ack sent → relay re-delivers on next sync (§5 ack-last rule). |
| Duplicate submission of one item | Server versions per item; advisor sees both with timestamps; facts store supersede chain resolves (§9). |
| Replayed ciphertext (old submission re-posted) | Relay rejects duplicate `submission_id`s; advisor sync flags replays and never lets a stale submission silently replace a newer answer (§2). |
| Forged resume state (link holder rewrites it) | Cosmetic only — advisor truth derives solely from sealed submissions, and the client page's done/not-done flags come from the relay's finalization records, not the writable state (§2); a forgery cannot mark items done or derail the real client's flow. |
