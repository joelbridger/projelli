---
name: add-egress-operation
description: Add or change a whole-app egress operation through the per-domain slice registry, on both the renderer (TypeScript) and native (Rust) layers, without weakening enforcement. Use when a feature makes a new off-device network call (calendar write, booking confirmation, reminder/SMS, a new connector) or changes an existing operation's destination policy.
---

# Add an egress operation

Every off-device network call in Lantern is declared as a typed **egress
operation** before it is allowed. The catalogue is carved into per-domain slice
modules mounted through one append-only registry per layer:

- **Renderer (TypeScript):** `src/platform/privacy/egressModules/` — per-domain
  slices, mounted in `registry.ts` (`EGRESS_MODULE_REGISTRY`). The stable public
  surface stays in `src/platform/privacy/egressRegistry.ts`.
- **Native (Rust):** `src-tauri/src/network_policy/operations/` — per-domain
  slices, mounted in `operations/mod.rs` (`EGRESS_MODULES`). The authorization
  engine, receipts, and lockdown logic stay in `src-tauri/src/network_policy.rs`
  and never move.

A feature owns its slice file. It never edits the authorization engine, and it
never edits another domain's slice.

## What "enforcement" means here

An operation declares a **destination policy** that is checked before any
token-bearing request starts:

- **Schemes** — usually `https` only (mail TLS uses `imaps`/`smtps`; MCP uses
  `mcp`). Never add `http` to a credential-bearing operation.
- **Origins** — an exact hostname allowlist, never a wildcard suffix. Empty
  origins are allowed *only* for a `userSelectedHost` operation.
- **`userSelectedHost` + `rejectPrivateNetwork`** — for hosts a person types
  (IMAP, ICS, ShareFile). Setting both auto-adds `requiresResolvedAddressCheck`
  so a DNS answer that resolves to a private address is rejected too.
- **`redirects`** — `deny` by default; `allow-listed-only` re-checks the policy
  for each hop (updates, model downloads).
- **`forbidCredentialQuery`** — blocks API keys landing in a URL query string.
- **`requiresFinalApproval`** — a send/write is never a silent background action.
- Native mirror: `DestinationRule` is `LiteralLoopbackOnly` (local AI only),
  `ExactHosts(&[…])`, or `UserConfiguredHost`; `EgressDataClasses` states whether
  content / metadata / credentials leave.

**Loosening any of these — a new origin, `http` added, a dropped
private-network check, a flipped approval — is a policy change, not a refactor.**

## Renderer: add the operation

1. Add the operation to its domain slice (e.g. `calendar.ts`, `mail.ts`, `crm.ts`,
   `fileStorage.ts`), or create a new slice module for a new domain. Build it with
   the shared `connectorOperation` helper so the safe defaults (deny redirects,
   HTTPS, empty-origin) always apply:

   ```ts
   connectorOperation({
     id: 'calendar-write-microsoft',
     category: 'connector-write',
     title: 'Write to Outlook calendar',
     approvalText: 'This creates or updates the event you approved in Outlook Calendar.',
     dataSummary: 'The approved event fields and the target calendar reference.',
     dataClasses: ['content', 'metadata', 'credential'],
     recipient: 'Microsoft Outlook Calendar',
     requiresFinalApproval: true,
     destination: { allowedOrigins: ['graph.microsoft.com'] },
   })
   ```

2. If you created a new slice module, append **one line** to
   `EGRESS_MODULE_REGISTRY` in `registry.ts`. Never reorder existing entries.

3. Extend the parity golden in `egressModules/egressParity.test.ts` with the new
   operation's signature line, in the same change. The reviewer reads that added
   line as the intended, explicit surface delta.

## Native: mirror the operation (if it crosses to Rust)

1. Add the `pub const … : EgressOperation` to its domain slice under
   `network_policy/operations/`, and include it in that slice's `*_OPERATIONS`
   array. Add the const to the `pub use` re-export list in `network_policy.rs`
   only if a caller outside `network_policy` needs `network_policy::YOUR_CONST`.
2. If you added a new slice module, append one line to `EGRESS_MODULES` in
   `operations/mod.rs`.
3. Extend the `GOLDEN` list in `operations/mod.rs` `parity_tests` with the new
   operation's signature.

## Enforcement guarantees (what the registry gives you)

- Authorization never trusts an unregistered operation id (renderer:
  `getEgressOperation` returns `undefined` → callers throw/deny; native:
  `registered_operation` returns `None` → `UnregisteredOperation`).
- The renderer registry **fails closed at load**: a structurally malformed
  registry (duplicate id, missing field, empty scheme/origin) throws before the
  catalogue is built (`validateEgressModuleRegistry`).
- Native Offline Mode (Network lockdown) blocks every non-loopback operation;
  only the two literal-loopback local-AI operations pass. This is proven for
  *every* registered operation by
  `offline_mode_blocks_every_registered_non_loopback_operation`.
- The **parity tests** freeze the exact id set, scopes, and strictness on both
  layers and fail on any add, remove, reorder (renderer), or loosening.

## Prove it is safe

```bash
# Renderer
npx vitest run src/platform/privacy/egressModules/egressParity.test.ts \
               src/platform/privacy/egressFollowups/egressFollowups.test.ts
npm run typecheck

# Native (one cargo compile box-wide; wait if another cargo is running)
cd src-tauri && CI=1 cargo test --lib --locked network_policy
```

## Reviewer checklist

- [ ] The parity golden changed by **exactly** the intended operation(s) — no
      silent edit to an existing signature line.
- [ ] No new `http` scheme, no wildcard origin, no dropped `rejectPrivateNetwork`
      on a user-selected host, no `requiresFinalApproval: false` on a send/write.
- [ ] The renderer and native declarations agree for any id that crosses both
      layers (same host allowlist / rule, same data classes).
- [ ] The operation is in the correct domain slice; the registry gained at most
      one appended line and no reordering.
- [ ] No new lint-baseline/eslint-disable/`#[allow]` was added to make it pass.
- [ ] `EGRESS_MODULE_REGISTRY` / `EGRESS_MODULES` still validate clean (dup-id and
      missing-field tests green).
