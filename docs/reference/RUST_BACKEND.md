# The Rust backend

> A map of Keepance's native side: the Tauri command layer in
> [`src-tauri/src/`](../../src-tauri/src/) and the two pure crates under
> [`src-tauri/crates/`](../../src-tauri/crates/) — `keepance-vault` (the
> encrypted workspace vault) and `keepance-docx` (the in-house `.docx` engine) —
> plus the encrypted audit/SQLCipher store. Written for humans and AI agents.
> Identifiers below were verified against the source on 2026-06-28. If a detail
> disagrees with the code, trust the code and fix this doc.

Keepance is a Tauri 2 app: a React/TypeScript frontend (see
[ARCHITECTURE.md](../../ARCHITECTURE.md)) talking over Tauri's IPC to a Rust
backend that does the things a browser can't — real filesystem access, OS
keychain, local AI model sidecars, encryption, the vector store, and faithful
`.docx` editing. The frontend never touches these directly; it calls
`#[tauri::command]` functions, which the conventions in
[TAURI_COMMANDS.md](./TAURI_COMMANDS.md) describe how to add.

```
src-tauri/
├── Cargo.toml              workspace root: members [".", crates/keepance-docx, crates/keepance-vault]
├── src/
│   ├── lib.rs              the app: builds Tauri, registers ALL commands (generate_handler!) + managed state
│   ├── main.rs             thin entry → lib::run()
│   └── commands/           one module per capability (below)
└── crates/
    ├── keepance-vault/     pure crate: AES-256-GCM workspace vault + BIP39 recovery (no Tauri dep)
    └── keepance-docx/      pure crate: OOXML/.docx parse + serialize + tracked-changes (no Tauri dep)
```

Keeping the crates **pure** (no Tauri, no LanceDB, no fastembed in their
dependency graph) is deliberate: `cargo test -p keepance-vault` and
`-p keepance-docx` compile and run in seconds, independent of the heavy app
build. Edition 2021; the app pins `rust-version = 1.77.2` but lancedb 0.21 needs
**Rust ≥ 1.78**, so build with current stable.

---

## The command layer (`src-tauri/src/commands/`)

Every capability is a module here. Commands are registered in one big
`tauri::generate_handler![...]` list in
[`lib.rs`](../../src-tauri/src/lib.rs) (~80+ commands), and per-module managed
state is set up in the `.setup()` hook (`commands::<module>::manage_state(app)`).

| Module | What it does |
|---|---|
| `fs.rs` | File ops: `check_path`, `get_home_dir`, `open_in_explorer`, LibreOffice detection + `.doc`→`.docx`/`.ppt`→`.pdf` conversion. |
| `keychain.rs` | OS keychain get/set/delete (`keychain_set`/`get`/`delete`) — the primitive every connector and the vault build on. Default service `com.keepance.app`. |
| `http.rs` | `fetch_url_title` (smart-paste), legacy Ollama stubs. |
| `watcher.rs` | `watch_workspace` — a `notify` file watcher that emits `workspace-file-changed` to trigger incremental RAG indexing. |
| `rag/` | The local search engine: indexing, embeddings, LanceDB vector store, retrieval, citation verification. Full detail in [RAG_PIPELINE.md](./RAG_PIPELINE.md). |
| `vault/` | Tauri wrapper over the `keepance-vault` crate (encrypt/decrypt the workspace). Detailed below. |
| `docx/` | Tauri wrapper over the `keepance-docx` crate (open/save/redline/clean-export `.docx`). Detailed below. |
| `audit/` | The append-only, hash-chained, SQLCipher-encrypted audit log. Detailed below. |
| `mail/`, `crm/`, `onedrive/`, `calendly/`, `docusign/`, `connector/` | The data connectors. See [CONNECTORS.md](./CONNECTORS.md). |
| `local_llm/` | Bundled llama.cpp sidecar lifecycle + GGUF model download (on-device AI). |
| `voice/`, `tts/` | Bundled Parakeet/whisper.cpp transcription and Piper text-to-speech sidecars. |
| `firm/` | Wave 3a SSO — `firm_sso_authenticate` (OIDC loopback + browser). |
| `mcp.rs` | The MCP approval bridge (`mcp_list_pending_approvals`, `mcp_approve_write`, `mcp_bundle_path`) — see [TAURI_COMMANDS.md](./TAURI_COMMANDS.md). |
| `setup_progress/`, `checksum.rs`, `tarball.rs` | Onboarding progress aggregation, SHA-256 file hashing, template tarball extraction. |

Three modules store data in an **encrypted local DB** under
`<workspace>/.keepance/`, all using the same SQLCipher master-key-in-keychain
pattern: the **audit log** (`audit-enc.db`), **mail** (`mail-enc.db`), and the
RAG **vector store** (`vectors/`, encrypted at the column level rather than
SQLCipher).

---

## `keepance-vault` — the encrypted workspace vault

[`src-tauri/crates/keepance-vault/`](../../src-tauri/crates/keepance-vault/).
Encrypts the user's actual documents at rest so that even someone with the disk
sees ciphertext, while the files stay ordinary files in a folder the user chose.
The crate is pure (file format + crypto + recovery + metadata); the Tauri glue
lives in [`src/commands/vault/`](../../src-tauri/src/commands/vault/).

**The KPV1 file format** ([`format.rs`](../../src-tauri/crates/keepance-vault/src/format.rs)):

```
[0..4]   b"KPV1"            magic (MAGIC)
[4]      0x01               version byte (VERSION = 1)
[5..17]  12-byte nonce      random per encryption
[17..]   AES-256-GCM ciphertext ‖ 16-byte auth tag
```

`has_vault_magic(bytes)` is the cheap guard everything uses to tell a vaulted
file from a plaintext one (so encrypt/decrypt are idempotent and the RAG indexer
knows when to decrypt-in-memory before extraction).

**Encryption.** AES-256-GCM (`aes-gcm` crate). The **Vault Master Key (VMK)** is
a full 256-bit key from `OsRng` — there is intentionally no memory-hard KDF over
it, because it's already full entropy. A fresh 12-byte nonce per file prevents
reuse; the 16-byte GCM tag gives tamper detection. The VMK is `zeroize`d
immediately after use.

**Key storage.** The VMK lives in the OS keychain under service
`com.keepance.vault.{vault_id}`, key `vmk-v1`, where `vault_id` is the SHA-256
(hex) of the canonical workspace path. So unlocking a vault = the VMK being
present in the keychain; locked = enabled but VMK absent.

**BIP39 recovery** ([`recovery.rs`](../../src-tauri/crates/keepance-vault/src/recovery.rs)).
So a user can recover a vault even if the keychain is lost:

- A **24-word BIP39 mnemonic** *is* 256 bits of entropy. From it,
  `create_recovery(vmk)` derives a recovery KEK via HKDF-SHA256 (info string
  `keepance-vault-recovery-kek:v1`, random 16-byte salt) and AES-256-GCM-**wraps**
  the VMK under it.
- The salt + wrapped VMK go into the vault metadata; the phrase is shown once and
  **never stored**.
- `recover_vmk(phrase, wrap)` validates the BIP39 checksum *before* any crypto,
  then unwraps the VMK.

**Metadata** lives at `<workspace>/.keepance-vault.json`
([`metadata.rs`](../../src-tauri/crates/keepance-vault/src/metadata.rs),
atomic-written): version, `vault_id`, created-at, the recovery wrap, a verifier
blob (`verifier.rs` — a fixed-plaintext proof a candidate key is correct), and an
optional firm-tier escrow section.

**Bulk operations.** `encrypt_all(root, vmk)` / `decrypt_all(root, vmk)` sweep
the workspace, skipping `.keepance/` (live DBs that must not be wrapped) and the
metadata file, cleaning up `.kpv-tmp-*` orphans from crashed writes, and
no-op'ing already-correct files (idempotent, resumable).

**Tauri commands** ([`commands/vault/mod.rs`](../../src-tauri/src/commands/vault/mod.rs)),
all path-guarded against `..` traversal: `vault_status`, `vault_create` (returns
the recovery phrase once), `vault_read_file` (decrypts if vaulted), `vault_write_file`,
`vault_unlock_with_recovery`, `vault_encrypt_all`, `vault_decrypt_all`,
`vault_disable` (refuses if any file still has KPV1 magic), and the firm-tier
escrow pair `vault_export_vmk_for_escrow` / `vault_set_escrow_wraps`.

Crate deps: `aes-gcm`, `sha2`, `hkdf`, `bip39`, `zeroize`, `rand`, `serde`/`serde_json`/`base64`, `thiserror`.

---

## `keepance-docx` — the OOXML / `.docx` engine

[`src-tauri/crates/keepance-docx/`](../../src-tauri/crates/keepance-docx/).
Word (`.docx`) is Keepance's first-class document format, so this in-house engine
reads and writes real OOXML with **tracked changes and comments** as first-class
DOM nodes — no Microsoft SDK, no SaaS. It's pure Rust over generic XML/ZIP crates
(`quick-xml`, `zip`), so it round-trips faithfully and tests fast.

**The design principle: model what you edit, preserve everything else.** Tracked
changes, comments, paragraphs and runs are parsed into a typed DOM; anything the
engine doesn't model (styles, numbering, themes, fonts, headers/footers, media,
hyperlinks, fields, drawings) is kept as **raw XML bytes and re-emitted
unchanged**. `OpenedDocument` even preserves the original ZIP package so unmodeled
parts survive byte-for-byte on save.

**The DOM** ([`model.rs`](../../src-tauri/crates/keepance-docx/src/model.rs),
`DOM_FORMAT_VERSION = 1`):

- `Document { format_version, body: Vec<BlockContent>, comments: BTreeMap<String, Comment> }`
- `BlockContent::Paragraph(Paragraph)` | `Raw { xml }`
- `Paragraph { properties_xml?, inlines: Vec<Inline> }`
- `Inline::Run(Run)` | `Insertion { meta, runs }` (`w:ins`) | `Deletion { meta, runs }` (`w:del`) | `CommentRangeStart/End/Reference { id }` | `Raw { xml }`
- `Run { text, preserve_space, properties_xml? }`; `RevisionMeta { id, author, date }`

**Public API** (re-exported from
[`lib.rs`](../../src-tauri/crates/keepance-docx/src/lib.rs)):

| Function | Purpose |
|---|---|
| `open_docx_bytes(bytes) -> OpenedDocument` | Parse a `.docx` and keep the original package (lossless save). |
| `parse_docx_bytes(bytes) -> Document` | Parse to DOM only. |
| `serialize_docx_bytes(doc) -> Vec<u8>` / `OpenedDocument::save_bytes()` | DOM → `.docx`. |
| `document_to_json` / `document_from_json` / `*_value` | serde bridge for the React editor. |
| `extract_paragraph_texts(doc)` | Plain text for the RAG indexer. |
| `author::insert_at_paragraph_end` / `delete_run_containing` / `insert_paragraph_after` | Add tracked-change revisions (used by AI redline). |
| `resolve::resolve_revision` / `resolve_all` (`ResolveAction::Accept`/`Reject`) | Accept/reject tracked changes. |
| `scrub::clean_copy_bytes(opts)` | Privilege-safe export: strip metadata, optionally accept-all + drop comments. |
| `letterhead::merge_into_template(template, content)` | Embed content inside a firm letterhead's section boundaries. |

Modules: `model` / `parse` / `serialize` / `package` (ZIP) / `author` / `resolve` /
`scrub` / `letterhead` / `text` / `validate` / `fixture` (test docs). The Tauri
wrapper ([`commands/docx/`](../../src-tauri/src/commands/docx/)) exposes
`docx_open`, `docx_save`, `docx_author_revision(s)`, `docx_resolve_revision`,
`docx_resolve_all`, `docx_export_copy`, `docx_export_clean_copy`,
`docx_apply_letterhead`.

Crate deps: `zip`, `quick-xml`, `serde`/`serde_json`, `chrono`, `thiserror`.

---

## The audit log + SQLCipher store

[`src-tauri/src/commands/audit/`](../../src-tauri/src/commands/audit/). Keepance's
"defense file": an **append-only, hash-chained, encrypted** record of every AI
action (model calls, retrievals, imports). It's what makes the product
*auditable* — a user can prove what the AI did and that the record wasn't
tampered with. The mail connector uses the identical pattern for `mail-enc.db`.

**Encryption (SQLCipher).** The DB is `<workspace>/.keepance/audit-enc.db`,
opened with `PRAGMA key = "x'<hex>'"` — a raw-hex key (bypassing SQLCipher's
passphrase KDF). The 32-byte master key comes from
`crypto::get_or_create_master_key()`, stored in the OS keychain under service
`keepance-audit-enc`, key `master-key-v1`. The whole database is encrypted at
rest; the schema is plaintext only in memory.

**Schema** ([`store.rs`](../../src-tauri/src/commands/audit/store.rs)):

```sql
CREATE TABLE entries (
  seq          INTEGER PRIMARY KEY AUTOINCREMENT,
  id           TEXT NOT NULL UNIQUE,   -- renderer-generated id (INSERT OR IGNORE → idempotent)
  timestamp    TEXT NOT NULL,          -- ISO-8601
  action       TEXT NOT NULL,          -- e.g. model_call, retrieval_executed
  description  TEXT NOT NULL,
  payload_json TEXT NOT NULL,          -- the full entry as JSON
  prev_hash    BLOB,                   -- SHA-256 of the previous row
  entry_hash   BLOB                    -- SHA-256(prev_hash ‖ canonical_bytes(row))
);
CREATE TABLE audit_metadata ( key TEXT PRIMARY KEY, value_json TEXT NOT NULL );
```

**Tamper-evidence (hash chain).** Each row's `entry_hash` is
`SHA-256(prev_hash ‖ canonical row bytes)`, chained from a fixed genesis
(`[0u8;32]`). `audit_verify_integrity()` recomputes the chain and returns
`Verified { checked }` or `Altered { seq, id, reason, checked }` at the first
break. Appends use `INSERT OR IGNORE` (retrying the same id is safe), and there
are no UPDATE/DELETE paths — append-only by construction.

**Commands:** `audit_set_workspace`, `audit_append`, `audit_list(limit?, offset?)`,
`audit_count`, `audit_verify_integrity`.

---

## How it fits together

```
        React frontend  ──IPC──►  #[tauri::command] fns (lib.rs generate_handler!)
                                          │
                 ┌────────────────────────┼───────────────────────────┐
                 ▼                        ▼                            ▼
        thin command wrappers       managed state            OS keychain (keyring)
        (commands/<module>/)     (RagState, MailState,    com.keepance.* / keepance-*
                 │                AuditState, …)             VMK · master keys · tokens
        ┌────────┴─────────┐
        ▼                  ▼
   pure crates       encrypted stores under <workspace>/.keepance/
   keepance-vault    ├─ audit-enc.db   (SQLCipher, hash-chained)
   keepance-docx     ├─ mail-enc.db    (SQLCipher)
                     └─ vectors/       (LanceDB, column-encrypted)  → RAG_PIPELINE.md
   workspace docs encrypted in place as KPV1 files (keepance-vault)
```

The throughline: **secrets live in the OS keychain, content lives encrypted on
disk, and the frontend only ever sees decrypted data through a command call** —
never a key, never a plaintext file path on disk.

## See also

- [TAURI_COMMANDS.md](./TAURI_COMMANDS.md) — conventions + checklist for adding a
  command (some of its per-command sections predate 3.0; the patterns hold).
- [RAG_PIPELINE.md](./RAG_PIPELINE.md) — the `rag/` module in depth.
- [CONNECTORS.md](./CONNECTORS.md) — the `mail/`/`crm/`/`onedrive/`/etc. modules.
- [SECURITY.md](./SECURITY.md) — the threat model these controls serve.
- [DEVELOPER_ONBOARDING.md](../operations/DEVELOPER_ONBOARDING.md) — building and
  testing the Rust side (`cargo test`, the gate).
