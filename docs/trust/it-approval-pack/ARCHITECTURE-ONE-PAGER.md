# Advisor Prep Hero Architecture One-Pager

This page is written for an outside IT reviewer. It explains what runs where, and exactly what can leave the advisor's machine.

## Short Answer

Advisor Prep Hero is a local-first desktop app. The advisor picks a workspace folder on their own computer. The app reads and writes files there, runs the main user interface locally, and stores secrets in the operating system keychain.

Data leaves the machine only in these cases:

1. The user chooses cloud AI and sends selected context to Anthropic, OpenAI, or Google with their own key.
2. A firm uses the Assured mode, where the app sends the AI request through the Lantern firm proxy with no prompt or completion storage.
3. A firm uses shared client workspaces, where only encrypted sync blobs go to the relay.
4. The user signs in to optional connectors, such as Microsoft Graph, Google, Wealthbox, or other vendor systems.
5. The app checks license status, checks for updates, or the user submits support, bug, telemetry, or diagnostic forms.

Source trail: [tauri.conf.json](../../../src-tauri/tauri.conf.json), [default.json](../../../src-tauri/capabilities/default.json), [WorkspaceService.ts](../../../src/platform/fs/WorkspaceService.ts), [egress.ts](../../../src/platform/privacy/egress.ts), [providerFactory.ts](../../../src/platform/providers/providerFactory.ts), [MatterSyncClient.ts](../../../src/platform/firm/MatterSyncClient.ts), [matterCrypto.ts](../../../src/platform/firm/matterCrypto.ts), [assuredInference.ts](../../../src/platform/firm/assuredInference.ts).

## What Runs On The Advisor's Computer

The desktop app is a Tauri app with a React user interface. The native shell, file access, local stores, document processing, search, audit logging, and local AI integrations run on the advisor's machine. The app name and allowed runtime endpoints are defined in [tauri.conf.json](../../../src-tauri/tauri.conf.json) and [default.json](../../../src-tauri/capabilities/default.json).

The app reads and writes the workspace folder chosen by the user. File operations go through the workspace service and path validation before they reach the local file system. Source: [WorkspaceService.ts](../../../src/platform/fs/WorkspaceService.ts), [TauriFSBackend.ts](../../../src/platform/fs/TauriFSBackend.ts), [BackendFactory.ts](../../../src/platform/fs/BackendFactory.ts).

Optional local AI can run without sending prompt content to the internet:

- Ollama uses `http://127.0.0.1:11434`.
- The built-in local AI sidecar uses `http://127.0.0.1:18089`.

Source: [OllamaProvider.ts](../../../src/platform/providers/OllamaProvider.ts), [AppLocalProvider.ts](../../../src/platform/providers/AppLocalProvider.ts), [default.json](../../../src-tauri/capabilities/default.json).

## Where Secrets Live

On desktop, API keys and encryption keys are stored in the operating system keychain. On Windows this is Windows Credential Manager. On macOS this is Keychain Services. On Linux this is Secret Service.

The browser development fallback uses local storage with base64 obfuscation and is marked in code as not secure and for development only. It is not the recommended mode for confidential client data.

Source: [KeychainService.ts](../../../src/platform/providers/KeychainService.ts), [keychain.rs](../../../src-tauri/src/commands/keychain.rs).

## AI Modes

Advisor Prep Hero has three practical AI paths.

### Local-Only

The app uses a local model. Prompt content does not leave the machine for AI generation. The app has a central cloud-send guard that blocks cloud AI calls when Local-only mode is active or the app has not safely loaded the user's confidentiality settings.

Source: [egress.ts](../../../src/platform/privacy/egress.ts), [cloudSendGuard.ts](../../../src/platform/privacy/cloudSendGuard.ts), [resolvePersonalEgressDefault.ts](../../../src/platform/privacy/resolvePersonalEgressDefault.ts), [useChatSending.ts](../../../src/features/ask/hooks/useChatSending.ts).

### BYOK Direct To Provider

BYOK means "bring your own key." If the user chooses Anthropic, OpenAI, or Google, the app sends the selected prompt and selected context directly from the desktop app to that provider's API. Lantern is not in the middle for direct BYOK calls.

The provider receives the prompt and any selected client context. Provider retention and training controls are governed by the user's provider account and provider terms.

Source: [fetchUtils.ts](../../../src/platform/providers/fetchUtils.ts), [ClaudeProvider.ts](../../../src/platform/providers/ClaudeProvider.ts), [OpenAIProvider.ts](../../../src/platform/providers/OpenAIProvider.ts), [GeminiProvider.ts](../../../src/platform/providers/GeminiProvider.ts), [egress.ts](../../../src/platform/privacy/egress.ts).

### Firm Assured Mode

In Assured mode, the desktop app routes the provider-native request to the Lantern firm API. The firm proxy forwards the request to the selected provider and streams the response back. The proxy code is designed to store billing and audit metadata, not prompt or completion bodies.

The BYOK provider key is not sent to the proxy. The app removes provider auth headers and replaces them with firm auth headers before calling the Assured endpoint.

Source: [assuredInference.ts](../../../src/platform/firm/assuredInference.ts), [FirmApiClient.ts](../../../src/platform/firm/FirmApiClient.ts), [backend README](../../../backend/README.md), [assured.ts](../../../backend/src/routes/assured.ts), [assured.ts lib](../../../backend/src/lib/assured.ts).

## Firm Sync And Shared Work

For firm shared client workspaces, encryption and decryption happen on the user's device. The relay receives encrypted Yjs document updates, not readable document text. Per-client matter keys are kept in the operating system keychain and wrapped only for authorized devices or admins.

The WebSocket URL uses a short-lived ticket. Access and seat tokens are not placed in the WebSocket URL.

Source: [MatterSyncClient.ts](../../../src/platform/firm/MatterSyncClient.ts), [matterCrypto.ts](../../../src/platform/firm/matterCrypto.ts), [matterKeyService.ts](../../../src/platform/firm/matterKeyService.ts), [keyWrap.ts](../../../src/platform/firm/keyWrap.ts), [deviceKeys.ts](../../../src/platform/firm/deviceKeys.ts), [backend README](../../../backend/README.md).

## Exactly What Leaves The Machine

| Data | Leaves the machine? | When | Destination |
|---|---:|---|---|
| Workspace documents | No by default | Only when the user includes content in a cloud AI request, shares through firm encrypted sync, uses a connector, or sends support material | Selected AI provider, firm encrypted relay, selected connector, or support form |
| Prompt and selected context in Local-only mode | No | Local model generation only | Local loopback AI service |
| Prompt and selected context in BYOK mode | Yes | User sends a cloud AI message | Anthropic, OpenAI, or Google |
| Prompt and selected context in Assured mode | Yes | Firm managed AI request | Lantern firm proxy, then selected AI provider |
| Firm shared document updates | Yes, encrypted only | Firm sync or live co-editing | Lantern firm relay |
| API keys and encryption keys | No in normal use | Stored and read locally | Operating system keychain |
| License status | Yes | License activation and validation | `licenses.lanternplatform.app` |
| Support, bug reports, optional telemetry, diagnostics | Yes, only when used or enabled | User support actions or enabled diagnostics | `forms.lanternplatform.app` |
| Optional connector data | Yes | User connects an outside system | The selected vendor API |

## What Lantern Servers Can See

For solo local-first use, Lantern servers do not need the advisor's documents or prompts.

For license checks, Lantern servers can see license and activation metadata. For support or diagnostics, Lantern can see the submitted form payload. For Firm Assured mode, the firm proxy sees the request in transient server memory while forwarding it, and the backend is designed not to store prompt or completion bodies. For firm sync, the relay stores opaque ciphertext plus routing metadata.

Source: [brand.ts](../../../src/config/brand.ts), [FirmApiClient.ts](../../../src/platform/firm/FirmApiClient.ts), [backend README](../../../backend/README.md), [contract.ts](../../../backend/src/contract.ts), [matters.ts](../../../backend/src/routes/matters.ts).

## Design Intent For IT Review

The design goal is simple: keep client files local by default, make every cloud path visible, avoid silent fallback from local to cloud AI, and make firm sharing encrypted before it reaches the relay.

This one-pager does not claim an external certification. It explains the architecture visible in the code today.
