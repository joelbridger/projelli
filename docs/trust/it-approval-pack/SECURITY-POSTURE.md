# Advisor Prep Hero Security Posture

This page is intentionally plain and honest. It lists what is in place today, what depends on settings, and what should not be overstated.

## Certification Status

Advisor Prep Hero is not SOC 2 certified today. Do not treat this pack as a SOC 2 report. It is an architecture and security review packet based on the current code.

If a firm requires SOC 2 certification before normal approval, the honest path is a limited pilot, a security exception, or waiting until a formal SOC 2 process is complete.

## Security Controls In Place

### Local-First Storage

The desktop app works from a workspace folder chosen by the user. The app reads and writes files through a workspace service and a native file backend. This keeps normal document work on the advisor's machine unless the user chooses a cloud path.

Source: [WorkspaceService.ts](../../../src/platform/fs/WorkspaceService.ts), [TauriFSBackend.ts](../../../src/platform/fs/TauriFSBackend.ts), [BackendFactory.ts](../../../src/platform/fs/BackendFactory.ts).

### Confidentiality Modes And Egress Visibility

The app has an egress model that labels where AI data is going:

- Local-only: no cloud AI data leaves the machine.
- BYOK direct: selected prompt and context go directly to the chosen provider.
- Assured: selected prompt and context go to the firm proxy, then to the provider.

The app also records egress audit events when a chat send occurs. The egress indicator and data map use the same egress logic so the user can see the current path.

Source: [egress.ts](../../../src/platform/privacy/egress.ts), [EgressIndicator.tsx](../../../src/platform/privacy/ui/EgressIndicator.tsx), [DataMapDialog.tsx](../../../src/platform/privacy/ui/DataMapDialog.tsx), [useChatSending.ts](../../../src/features/ask/hooks/useChatSending.ts), [AuditService.ts](../../../src/platform/audit/AuditService.ts).

### Local-Only Cloud Send Guard

The cloud-send guard is a central fail-closed check for cloud AI sends. If the app is in Local-only mode, or if the confidentiality settings are not safely loaded, cloud AI sends are blocked instead of silently falling back to a provider.

Source: [cloudSendGuard.ts](../../../src/platform/privacy/cloudSendGuard.ts), [localOnlyGuard.ts](../../../src/platform/privacy/localOnlyGuard.ts), [resolvePersonalEgressDefault.ts](../../../src/platform/privacy/resolvePersonalEgressDefault.ts), [useChatSending.ts](../../../src/features/ask/hooks/useChatSending.ts).

### Operating System Keychain

On desktop, the app stores AI API keys and other secrets in the operating system keychain. The native command layer uses the platform keychain through the `keyring` library. The Rust layer denies renderer access to several internal service namespaces, including audit, mail, vectors, vault, CRM, and connector secret services.

Source: [KeychainService.ts](../../../src/platform/providers/KeychainService.ts), [keychain.rs](../../../src-tauri/src/commands/keychain.rs).

### Encryption At Rest

The app uses several local encryption controls:

| Area | Protection | Source |
|---|---|---|
| Optional workspace vault | AES-256-GCM file encryption with a KPV1 file format and fresh nonce per write | [format.rs](../../../src-tauri/crates/lantern-vault/src/format.rs), [vault.rs](../../../src-tauri/crates/lantern-vault/src/vault.rs), [vault mod.rs](../../../src-tauri/src/commands/vault/mod.rs) |
| Audit log | SQLCipher encrypted database, append-only API, hash-chain tamper evidence, master key in OS keychain | [audit store.rs](../../../src-tauri/src/commands/audit/store.rs), [audit crypto.rs](../../../src-tauri/src/commands/audit/crypto.rs), [AuditService.ts](../../../src/platform/audit/AuditService.ts) |
| Imported mail | SQLCipher metadata plus AES-256-GCM encrypted blobs, master key in OS keychain | [mail store.rs](../../../src-tauri/src/commands/mail/store.rs), [mail crypto.rs](../../../src-tauri/src/commands/mail/crypto.rs) |
| Search and vector store text | AES-256-GCM encrypted text, HMAC-protected path tokens, master key in OS keychain | [rag crypto.rs](../../../src-tauri/src/commands/rag/crypto.rs), [DataMapDialog.tsx](../../../src/platform/privacy/ui/DataMapDialog.tsx) |
| Firm shared workspace updates | AES-256-GCM encrypted update blobs before relay upload | [matterCrypto.ts](../../../src/platform/firm/matterCrypto.ts), [MatterSyncClient.ts](../../../src/platform/firm/MatterSyncClient.ts) |

Important limit: if the workspace vault is not enabled, regular document files rely on the computer's disk encryption, such as BitLocker, FileVault, or LUKS. The app's data map says this plainly.

Source: [DataMapDialog.tsx](../../../src/platform/privacy/ui/DataMapDialog.tsx).

### Audit Log And Egress Receipts

The desktop audit store is SQLCipher encrypted and append-only from the public API. It records app events, including AI egress events. This gives the firm a local record of when data was sent to local AI, direct provider AI, Assured proxy AI, or a demo proxy path.

Source: [AuditService.ts](../../../src/platform/audit/AuditService.ts), [audit store.rs](../../../src-tauri/src/commands/audit/store.rs), [useChatSending.ts](../../../src/features/ask/hooks/useChatSending.ts).

### Firm Relay Encryption

Firm sync is designed as a ciphertext-only relay. Each install has a device keypair. Per-matter content keys are kept in the operating system keychain and wrapped only for authorized devices or admins. The relay stores encrypted update blobs and routing metadata.

Source: [deviceKeys.ts](../../../src/platform/firm/deviceKeys.ts), [matterKeyService.ts](../../../src/platform/firm/matterKeyService.ts), [keyWrap.ts](../../../src/platform/firm/keyWrap.ts), [matterCrypto.ts](../../../src/platform/firm/matterCrypto.ts), [MatterSyncClient.ts](../../../src/platform/firm/MatterSyncClient.ts), [backend README](../../../backend/README.md).

## Known Limits And Honest Caveats

- No SOC 2 certification is available today.
- If the user chooses cloud AI, the selected provider receives the prompt and selected context.
- Provider-side retention, training controls, and abuse monitoring are governed by the provider account and provider terms.
- In Firm Assured mode, the firm proxy handles prompt bytes in transient memory while forwarding the request. The code is designed not to store prompt or completion bodies.
- If the vault is not enabled, normal document files are not app-encrypted by default. Use full-disk encryption on managed devices.
- Even with the vault, file names and folder structure may still be visible outside encrypted file content.
- Search embeddings are numeric summaries and are listed in the app data map as unencrypted, while passage text and path tokens are protected.
- The browser development key fallback is not secure enough for confidential production use. Desktop keychain storage should be required.
- Optional connectors send data to the connected vendor. Those vendors' security terms still matter.
- Corporate TLS inspection, proxy tools, and VPNs can affect provider calls, OAuth sign-in, WebSockets, and update checks. See [NETWORK-REQUIREMENTS.md](./NETWORK-REQUIREMENTS.md).

## Suggested IT Approval Conditions

For a cautious first pilot:

1. Require desktop app use, not browser development mode.
2. Require Local-only mode unless IT approves a specific AI provider or Firm Assured mode.
3. Require BitLocker, FileVault, or equivalent full-disk encryption on managed computers.
4. Approve only the needed connectors for the pilot.
5. Disable optional telemetry and diagnostics unless IT approves them.
6. Keep the network allowlist narrow and review it again before expanding cloud AI or firm sync.
