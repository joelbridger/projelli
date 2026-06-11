# Encrypted Workspace Vault (VG-6d-v2) — Design Spec

**Date:** 2026-06-11 · **Wave:** 3b · **Status:** approved direction (Jameson, 2026-06-11), spec written for review · **Effort tier:** xhigh (data-loss-sensitive) · **Plan of record:** `docs/strategy/2026-06-10-vision-gap-closure-plan.md` (VG-6d-v2)

> **Why this doc exists.** The vault is the one build in the gap-closure plan that can destroy a user's data if it's wrong. Per the operating contract it gets a brainstormed design + a destructive-failure test suite **before any vault code ships**. This is that design. The matching implementation plan (TDD, file-level) is written next under `docs/superpowers/plans/`.

---

## 1. Goal

An **optional, per-workspace** encrypted vault. When enabled, a workspace's document files are stored on disk as AES-256-GCM ciphertext; Keepance decrypts them transparently on open/edit; the file tree, search, and editing keep working. A one-click "decrypt everything" returns plain files and turns the vault off, so *"your files are always yours"* stays literally true.

This is **v2** of VG-6d. v1 (unmissable OS-disk-encryption guidance — onboarding step + Data Map row) already shipped in Wave 1 and stays; the vault is the belt to that suspenders.

## 2. Threat model

| Protects against | Does **not** protect against |
|---|---|
| Someone who copies the workspace folder, a cloud-synced/backup copy of it, or reads a stolen but **powered-off** disk — **independent of whether OS full-disk encryption is on**. | A running, **unlocked** machine while you're working (the key is necessarily in memory). |
| Document file **contents** leaking as plaintext on disk. | In v1, **file names and folder structure** (they stay visible — see §11 Fork 2). |
| A wrong/forged key producing readable content (GCM authentication). | A compromised OS keychain on a logged-in session (the everyday key lives there by design). |

The vault is a confidentiality-at-rest layer for file *contents*. It is explicitly **not** a substitute for OS disk encryption (which also protects the OS, swap, temp files, and the search index location); the Data Map says so.

## 3. Non-goals (v1 — YAGNI)

- Encrypting file **names** or folder structure (Fork 2).
- Vaulting the **RAG/vector index** — it is *already* encrypted at rest under its own keychain key (`keepance-vectors-enc`, Wave 2 VG-6e). The vault decrypts files *for* indexing (§9); the index stays under its existing protection.
- VMK **rotation** beyond the firm-escrow epoch bump on admin-roster change.
- Web/browser build support — the vault is **desktop (Tauri) only**. In the browser build the vault is reported unavailable.
- Per-file or per-folder selective encryption — the vault is whole-workspace (all document files) or off.

## 4. Cryptographic architecture

### 4.1 Keys

- **VMK (Vault Master Key):** one random **256-bit** key per vault. Generated Rust-side with `OsRng` at vault creation. It is the only key that encrypts file contents. It is held at rest in the **OS keychain** and only ever in transient memory while the vault is unlocked. It leaves Rust **once**, transiently, only to create firm-escrow wraps (§4.4).
- **Recovery KEK:** derived from the recovery phrase to wrap the VMK as an offline backstop (§4.3).
- **Escrow:** the VMK additionally wrapped to firm-admin device public keys (§4.4).

### 4.2 Everyday storage — OS keychain

The raw VMK (base64) is stored in the OS keychain at service `com.keepance.vault.<workspaceId>`, key `vmk-v1`, via the existing `keychain_set/get/delete` Tauri commands (`src-tauri/src/commands/keychain.rs`). `workspaceId` is a stable per-workspace id (a hash of the canonical workspace root path, recorded in the vault metadata). This mirrors how `keepance-mail-enc` / `keepance-vectors-enc` master keys already live in the keychain.

"Unlocked" = the VMK is retrievable from the keychain (or has been recovered into it). "Locked" = the keychain has no VMK for this workspace (e.g. moved to a new machine) → the app prompts for the recovery phrase (§4.3) or, for firm members, uses escrow (§4.4).

### 4.3 Recovery phrase (the offline backstop) — **net-new code**

No mnemonic/KDF code exists in the repo today; this is added.

- At vault creation, generate a **BIP39 24-word mnemonic** from 256 bits of `OsRng` entropy (the `bip39` Rust crate). The 24 words **are** that 256-bit entropy.
- Derive the **Recovery KEK** = `HKDF-SHA256(ikm = the 256-bit BIP39 entropy, salt = random 16 B [stored in metadata], info = "keepance-vault-recovery-kek:v1")` → 32 bytes.
  - *Why HKDF, not Argon2id:* a memory-hard KDF exists to slow brute force of **low-entropy** secrets. The recovery phrase carries the **full 256 bits** of entropy, so brute force is already infeasible by ~2^256 and a memory-hard stretch buys nothing while adding a heavy dependency. HKDF over full-entropy IKM is the correct, lighter choice. (Argon2id was considered and dropped for this reason; recorded so the decision is closed.)
- Wrap the VMK: `recovery_wrap = AES-256-GCM(key = Recovery KEK, nonce = random 12 B, plaintext = VMK, aad = "keepance-vault-recovery:v1")`. Store `recovery_wrap` (nonce‖ct‖tag) + the HKDF salt in the metadata file.
- **The phrase is shown exactly once**, at creation, with a mandatory "Keepance cannot recover this for you" ceremony (§11 Fork 3). It is never stored anywhere by Keepance.
- **Recover:** user enters the 24 words → validate the BIP39 checksum → re-derive Recovery KEK → AES-GCM-decrypt `recovery_wrap` → VMK → re-store VMK in the keychain → unlocked. A wrong/invalid phrase fails the BIP39 checksum or the GCM tag and is rejected cleanly (no partial state).

### 4.4 Firm-admin escrow (firm tier) — **reuses existing `keyWrap.ts`**

So a firm can recover a departed member's vault:

- At creation (and whenever the admin roster or escrow epoch changes), the VMK is wrapped to each firm-admin **device public key** using the existing, tested `wrapMatterKey(vmkB64, adminPubJwk, epoch)` (ECDH-P256 + HKDF-SHA256 + AES-256-GCM; `src/modules/firm/keyWrap.ts`) — the identical machinery that distributes matter keys today.
- To produce these wraps, Rust exports the VMK to TS **once, transiently, gated** behind `vault_export_vmk_for_escrow` (only callable by the workspace owner on an unlocked vault). TS wraps it to each admin pubkey, hands the wrapped blobs back via `vault_set_escrow_wraps`, and drops the plaintext. The VMK touches the JS heap **only** during this one-time escrow operation. *(Alternative considered: reimplement ECDH wrap in Rust so the VMK never leaves Rust. Rejected for v1: reusing the battle-tested `keyWrap.ts` is lower-risk than new Rust ECDH; the transient, gated export is an acceptable, documented trade-off. Revisit if a security review pushes back.)*
- Escrow wraps + `{user_id, device_id, epoch}` live in the vault metadata file (already-wrapped, non-secret). An admin recovers by `unwrapMatterKey(wrap, epoch)` with their device private key → VMK.
- **Escrow is firm-tier only and is disclosed**: the setup flow states plainly that a firm admin can recover this vault. Solo vaults have no escrow — only the keychain + the recovery phrase.

### 4.5 Verifier

A `verifier = AES-256-GCM(key = VMK, nonce = random 12 B, plaintext = "keepance-vault-verifier:v1")` blob (stored nonce‖ct‖tag in the metadata) lets the app confirm a candidate VMK is correct **before** touching files: decrypt the verifier and check the GCM tag. A correct VMK authenticates; a wrong VMK fails the tag. This is fast wrong-key detection at unlock. A single file failing GCM while the verifier passes therefore means *that file* is corrupt/tampered, not a wrong key — useful, honest diagnostics.

## 5. On-disk file format

Each vaulted file on disk is:

```
"KPV1"            4 bytes  magic (identifies a vaulted file)
version           1 byte   = 0x01
[ encrypt_with_key(plaintext, VMK) ]   = 12-byte nonce ‖ AES-256-GCM ciphertext ‖ 16-byte tag
```

The body reuses the canonical Rust helper `encrypt_with_key`/`decrypt_with_key` (`src-tauri/src/commands/mail/crypto.rs`) — already covered by 14 unit tests, fresh random nonce per write.

The **magic header** is load-bearing: it lets any reader tell a vaulted file from a plain one in O(4 bytes). That makes the enable-migration and the escape-hatch **idempotent and resumable** (skip files already in the target state) and lets `vault_read_file` transparently pass through a not-yet-encrypted file during migration instead of erroring.

Files keep their **original name and extension** (a `contract.docx` vault file is named `contract.docx` and is ciphertext; opening it outside Keepance shows encrypted bytes — the intended behavior).

## 6. Atomic write protocol (the kill-mid-write guarantee)

**The current stack has no atomic write** — workspace writes call the Tauri FS plugin directly (no temp file, no fsync, no rename). The vault owns its write path in Rust to fix this:

`vault_write_file(workspace, rel_path, plaintext)`:
1. Encrypt `plaintext` → blob (magic + version + GCM).
2. Write blob to a sibling temp `‹rel_path›.kpv-tmp-‹rand›` (same directory → same filesystem, so the rename is atomic).
3. `fsync` the temp file.
4. **Atomically rename** temp → `rel_path` (POSIX `rename(2)`; Windows `ReplaceFileW`/`MoveFileExW` with `MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH`).
5. Best-effort `fsync` the containing directory.

Guarantees: a crash **before** step 4 leaves the original file byte-for-byte intact (the orphan temp is swept on next open). The rename in step 4 is atomic — a reader always sees either the complete old file or the complete new file, **never a half-written file**. Orphan `*.kpv-tmp-*` files are cleaned up on vault unlock and ignored by `list()`.

## 7. Transparent access — the `VaultFSBackend` decorator

A new `VaultFSBackend` (TS) wraps the existing `TauriFSBackend` in the `FSBackend` decoration chain (constructed in `src/modules/workspace/BackendFactory.ts`). Because **every** write through `WorkspaceService` (editor autosave, version-history snapshots, AI artifact writes) flows through this one backend, all content paths are covered uniformly — no caller needs to know the vault exists.

- `read` / `readBinary` → `invoke('vault_read_file', …)` → Rust decrypts (or passes through if the file has no `KPV1` magic). Returns plaintext.
- `write` / `writeBinary` → `invoke('vault_write_file', …)` → Rust encrypts + atomic-writes.
- `list` → passthrough, **filtering out** the vault metadata file and any `*.kpv-tmp-*` orphans.
- `move` / `rename` / `copy` / `delete` / `mkdir` / `stat` / `exists` → **passthrough unchanged** (the ciphertext keeps its name; a move/copy doesn't rewrite content, so no re-encryption is needed; v1 doesn't encrypt names).

The VMK never enters the JS heap on this path — read/write decrypt/encrypt happen entirely in Rust, which fetches the VMK from the keychain.

## 8. Tauri command surface (held in `commands/vault/`)

| Command | Purpose |
|---|---|
| `vault_status(workspace)` | `{ enabled, locked, has_escrow, vault_id }` |
| `vault_create(workspace, escrow?)` | Generate VMK + 24-word phrase, write metadata, store VMK in keychain; **returns the phrase once** for the ceremony |
| `vault_export_vmk_for_escrow(workspace)` | Gated transient VMK export (base64) for TS `keyWrap` |
| `vault_set_escrow_wraps(workspace, epoch, wraps)` | Persist admin escrow wraps into metadata |
| `vault_unlock_with_recovery(workspace, phrase)` | Re-derive KEK, unwrap VMK, re-store in keychain |
| `vault_read_file(workspace, rel_path)` | Decrypt (passthrough if not vaulted) |
| `vault_write_file(workspace, rel_path, bytes)` | Encrypt + atomic write |
| `vault_encrypt_all(workspace)` | Enable-migration: encrypt every plain document file (resumable, atomic, progress events) |
| `vault_decrypt_all(workspace)` | Escape hatch: decrypt every vaulted file back to plaintext (resumable, atomic) |
| `vault_disable(workspace)` | After `decrypt_all`: delete metadata + keychain VMK |

Pure crypto + file-format + atomic-write logic lives in a new **`src-tauri/crates/keepance-vault`** crate (no Tauri deps → unit-testable in isolation, mirroring the `keepance-docx` crate). The `commands/vault/` module is the thin Tauri glue + keychain integration.

## 9. Integration: the RAG indexer must decrypt vaulted files

**Critical seam.** The Rust RAG indexer (`src-tauri/src/commands/rag/*`) reads workspace files **directly off disk** to extract text — it does not go through `WorkspaceService`. If a workspace is vaulted, the on-disk files are ciphertext, so the indexer would index garbage and search would silently break.

Fix: in the indexer's file-read path, when a workspace is vaulted, read through the `keepance-vault` crate's decrypt (it has the VMK from the keychain) before extraction. Files are decrypted **in memory** for indexing only; the resulting chunks are stored in the **already-encrypted** vector store (VG-6e). Net effect: search keeps working over vaulted files, and nothing lands as plaintext on disk.

The Data Map notes this honestly: vaulted file contents are decrypted in memory transiently for search indexing, and the index itself is separately encrypted at rest.

## 10. UX (light theme; sits beside the VG-6d-v1 guidance)

- **Enable flow:** explain what the vault does and its limits → generate + display the 24-word recovery phrase with the mandatory ceremony (§11 Fork 3) → (firm) confirm admin escrow with a plain statement that a firm admin can recover it → `vault_encrypt_all` with a progress UI. Crash-safe and resumable.
- **Locked state:** if the VMK isn't in the keychain (new machine), a clear "This workspace is locked. Enter your recovery phrase to unlock." flow (firm members may instead be unlocked via escrow).
- **Data Map:** a new row — "Keepance encrypts this workspace's files" — stating contents are AES-256-GCM at rest, file **names remain visible**, the recovery phrase is the only solo backstop, and (firm) escrow exists.
- **Escape hatch:** "Decrypt this workspace and turn off the vault" → `vault_decrypt_all` then `vault_disable`, with a confirmation that explains files return to normal unencrypted files.

## 11. Decisions (the three strategic forks — approved 2026-06-11)

1. **Scope = solo + firm-admin escrow, both in v1.** The plan commits escrow and this is the firm-sale wave; escrow reuses `keyWrap.ts`, so marginal cost is small.
2. **Encrypt contents only, not names/structure, in v1.** Keeps the file tree working; the residual (a sensitive *file name* is still visible) is disclosed in the Data Map. Full filename encryption is a large scope + UX jump, deferred.
3. **Recovery-phrase ceremony is mandatory + confirmed.** The user must view the phrase and confirm they've saved it (re-enter 3 random words from it) before the vault activates. For a legal product, that friction is preferable to ever silently losing a firm's files.

## 12. Failure semantics (explicit)

| Situation | Behavior |
|---|---|
| Wrong VMK at unlock | Verifier GCM fails → vault stays locked, clear message; **no files touched** |
| Single file fails GCM, verifier passes | That file is corrupt/tampered → typed `decrypt_failed` for that file only; others unaffected; never returns garbage |
| Keychain lost (new machine) | Vault locked → recovery-phrase flow (solo) or escrow (firm) |
| Keychain lost **and** phrase lost **and** no escrow | **Unrecoverable by design** — the honest promise; the ceremony made this explicit up front |
| Crash mid-write | Original file intact (crash before rename) or fully replaced (rename is atomic) — never partial |
| Crash mid-enable-migration | Resumable: already-encrypted files have the magic header and are skipped; never double-encrypted |
| Tampered ciphertext / wrong magic / truncated file | GCM/format check fails → typed error, fail closed |

## 13. Destructive-failure test suite (written BEFORE vault code)

Per the hard rule, these are authored and run red/green first. They live in the `keepance-vault` crate (Rust, pure) plus a few TS integration tests for the backend seam.

**Crate-level (Rust, deterministic):**
1. **Kill-mid-write — original preserved.** Drive `vault_write_file`'s steps with the rename step forced to abort (inject a failure before rename): assert the target file still holds the *original* bytes and the temp is the only artifact; a subsequent sweep removes the temp.
2. **Kill-mid-write — atomicity.** Assert that at no observable point does the target contain a partial blob: it is either the full old file or the full new file (test the temp-then-rename invariant directly; assert the writer never opens the target for truncation).
3. **Wrong key.** Encrypt under VMK-A; attempt decrypt under VMK-B → typed `decrypt_failed`, **no plaintext, no panic, no partial buffer** returned.
4. **Tampered ciphertext.** Flip one byte of a vaulted file → decrypt fails with `decrypt_failed` (GCM tag), never returns garbage.
5. **Truncated / wrong-magic file.** A file missing the `KPV1` magic is treated as plaintext passthrough (migration safety); a file with magic but truncated body → typed error, fail closed.
6. **Recovery round-trip.** Create vault → derive recovery wrap → with the VMK *absent*, recover from the 24-word phrase → recovered VMK byte-identical to the original; decrypts existing files.
7. **Wrong / invalid recovery phrase.** A phrase failing the BIP39 checksum is rejected before any crypto; a checksum-valid but wrong phrase fails the GCM tag → clean rejection, keychain untouched.
8. **Escape-hatch round-trip.** Encrypt-all a fixture tree, then decrypt-all → every file byte-identical to the pre-vault original; metadata + keychain key removed; tree contains zero `KPV1` magic afterward.
9. **Enable-migration crash → resume.** Encrypt-all interrupted partway (some files vaulted, some not) → re-run completes, every file vaulted exactly once (magic-header guard prevents double-encryption).
10. **Escrow round-trip (firm).** Wrap VMK to an admin device pubkey via `keyWrap`, then unwrap with that device's private key → VMK recovered; an unrelated device cannot unwrap.

**Backend-seam (TS integration):**
11. **VaultFSBackend transparency.** Through `WorkspaceService`, write a file in a vaulted workspace, read it back → identical content; the raw on-disk bytes start with `KPV1` and are not the plaintext.
12. **Indexer-decrypt seam.** A vaulted file's content is retrievable by search (indexer decrypts in memory) while its on-disk form is ciphertext.

## 14. Module / file structure

**New:**
- `src-tauri/crates/keepance-vault/` — pure crate: `crypto.rs` (file-format encrypt/decrypt over `encrypt_with_key`), `atomic.rs` (temp+fsync+rename write), `recovery.rs` (BIP39 + HKDF KEK + VMK wrap/unwrap), `verifier.rs`, `metadata.rs` (`.keepance-vault.json` read/write), and the destructive-failure tests under `tests/`.
- `src-tauri/src/commands/vault/mod.rs` — the Tauri commands in §8 + keychain integration; registered in `lib.rs`.
- `src/modules/workspace/VaultFSBackend.ts` — the decorator.
- `src/modules/vault/vaultClient.ts` — TS wrappers over the Tauri commands + the escrow-wrap orchestration (reusing `keyWrap.ts`).
- `src/components/vault/*` — enable flow, recovery-phrase ceremony, locked-state prompt, escape-hatch confirm.

**Modified:**
- `src-tauri/Cargo.toml` workspace members += `crates/keepance-vault`; new deps `bip39` (and the crate's own `aes-gcm`/`hkdf`/`rand`/`zeroize`).
- `src-tauri/src/lib.rs` — register the vault commands.
- `src/modules/workspace/BackendFactory.ts` — wrap with `VaultFSBackend` when the workspace is vaulted.
- `src-tauri/src/commands/rag/*` (the indexer file-read path) — decrypt vaulted files in memory before extraction (§9).
- `src/components/privacy/DataMapDialog.tsx` — the vault Data Map row.
- Locale files `src/locales/{en,de,es}.json` — vault UI strings.

**Untouched:** the firm seat/wall/auth backend, the SSO work from Wave 3a, the existing RAG at-rest encryption (the vault decrypts *into* it, doesn't change it).

## 15. Security hygiene notes

- The VMK is `zeroize`d in Rust after use where the type allows; the transient escrow export is the only path it reaches JS, and only on an unlocked vault by the owner.
- The metadata file holds only wrapped/derived material (recovery wrap, escrow wraps, salt, verifier) — safe to sit in the workspace and be backed up.
- No key material is ever logged. The recovery phrase is returned exactly once from `vault_create` and never persisted by Keepance.
- All GCM uses fresh random nonces; AAD binds purpose/epoch where relevant (recovery, escrow), matching the existing `matterCrypto`/`keyWrap` conventions.
