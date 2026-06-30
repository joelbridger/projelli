# Advisor Prep Hero Email Encryption-at-Rest: Design & Decision (Group G)

**Date:** 2026-06-06
**Status:** Decision, for build
**Context:** Phase 1 email import is built + E2E-validated (PR #30). Today it writes email as **plaintext** `Mail/*.md` in the workspace and tracks metadata in plaintext SQLite. Before any real client mail in production, the local store must be encrypted (Jameson greenlit this). This doc settles the architecture so the build is deliberate, not improvised.

---

## Threat model (what we protect against)

A privilege-bound professional's laptop. Realistic threats: **lost/stolen device**, **another user on a shared machine**, **casual malware/exfiltration of files**. (Server-side breach — the cloud competitors' big risk — doesn't exist for us; there is no server.) Encryption-at-rest targets the first three: someone with the *files* must not be able to read the client email.

Out of scope for v1 (documented, not solved now): a compromised OS while the app is unlocked (the key is in the OS keychain and data is decrypted in memory while running — unavoidable for a usable local app); a passphrase tier where even keychain access is insufficient (a strong fast-follow, see "Deferred").

## What holds plaintext today (the gaps to close)

1. **Email bodies** — `Mail/<folder>/<id>.md` plaintext files in the workspace.
2. **Metadata** — `.keepance/mail.db` plaintext SQLite (ids, paths, cursors).
3. **Search index** — `.keepance/vectors/` LanceDB stores the **verbatim chunk `text`** column (plaintext email content) alongside embeddings. This is the subtle one the recon confirmed.

## Decision (v1)

**A master data key, generated once and stored in the OS keychain, encrypts all three.** Concretely:

1. **Master key.** 32-byte random key created on first mail connect, stored via the existing `keychain` commands (service `keepance-mail-enc`). All mail encryption derives from it. Crypto: `aes-gcm` crate (AES-256-GCM, AEAD, per-blob random nonce). No hand-rolled crypto.

2. **Email bodies → encrypted blobs.** Stop writing plaintext `Mail/*.md` into the workspace. Each message's normalized Markdown is encrypted and written to `.keepance/mail/blobs/<safe-id>.enc` (nonce ‖ ciphertext ‖ tag). The store maps message-id → blob path. **No plaintext email file ever touches disk.** (Trade-off: email is no longer browsable as loose files in the workspace tree — it is read through Advisor Prep Hero's UI. Acceptable and arguably better for confidentiality hygiene.)

3. **Metadata → SQLCipher.** Switch the mail metadata DB to SQLCipher (rusqlite `bundled-sqlcipher` feature), keyed from the master key via `PRAGMA key`. Holds message metadata + per-folder delta cursors, all encrypted. Implemented as an `EncryptedMailStore` behind the existing `MailStore` trait, so `sync.rs` is unchanged.

4. **Search index → in-memory feed + encrypted chunk text.** Email is indexed **without writing plaintext to disk**:
   - Add a `rag_index_text(docId, text)`-style path (precedent: `rag_index_pdf_chunks` already takes text, not a file) so the sync engine decrypts a blob in memory and feeds the text straight to the embedder + keyword index — no plaintext file round-trip.
   - In the LanceDB store, the chunk **`text` column for mail chunks is stored encrypted** (the embedding vector is computed from plaintext in memory, then the text is encrypted before upsert; retrieval decrypts in memory before display/use). This is **additive and surgical**: gated by a flag/source-type so existing document/PDF indexing is byte-for-byte unchanged. Embeddings (384 floats) remain plaintext — they leak fuzzy semantics but are not readily reversible to readable text; this is the one documented residual.
   - Keyword search (FlexSearch) is in-memory and rebuilt per session from decrypted text, so no plaintext keyword index persists.

5. **OS full-disk encryption check.** Detect BitLocker/FileVault; if off, surface a one-line nudge in the Connect panel. Defense in depth, not a substitute.

### Net at-rest posture
No plaintext email bodies, metadata, or chunk text on disk. Only embeddings (non-readable math) sit unencrypted — explicitly documented. This is a strong, honest v1 that delivers the "we encrypt it" promise and keeps the local-first moat intact.

## Deferred (fast-follows, explicitly not in this build)
- **Passphrase tier** (Argon2id-wrapped master key) for "even the keychain isn't trusted." High-value next; documented now.
- **Embedding encryption** (encrypting the vectors themselves) — only worth it if the fuzzy-semantic leak of plaintext embeddings is deemed unacceptable by a reviewer; deferred with the residual documented.
- **Re-key / key-rotation** tooling.

## Why not the alternatives
- *Rely only on OS full-disk encryption*: we don't control whether it's on, and it doesn't protect against another logged-in user. Rejected as the primary mechanism (kept as defense-in-depth, point 5).
- *Encrypt the whole `.keepance/vectors` dir via an app-managed encrypted container*: heavier, OS-specific, and fights LanceDB's file management. The per-chunk-text encryption (point 4) is more surgical and provider-agnostic.
- *Keep plaintext `Mail/*.md` files and let the existing watcher index them*: simplest, but leaves plaintext email on disk — fails the whole point. Rejected.

## Build outline (detailed plan to follow)
Crypto/keymgmt module → SQLCipher `EncryptedMailStore` → encrypted blob read/write → switch `sync.rs` apply to blobs + in-memory index feed (replacing plaintext `.md` writes) → `rag_index_text` + encrypted mail-chunk text in the store + retrieval decryption → keyword in-memory feed → OS-FDE check + Connect-panel nudge → migration (existing plaintext Phase-1 mail, if any, re-imported/cleaned). Each step TDD; crypto + shared-store changes get rigorous review.

**Residual risk accepted for v1:** plaintext embeddings in the vector store (non-readable). Everything a human would recognize as "the email" is encrypted.
