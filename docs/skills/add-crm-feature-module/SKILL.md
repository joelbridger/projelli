---
name: add-crm-feature-module
description: Add an atomic CRM native feature module, its append-only descriptor, and its native command manifest while preserving the legacy CRM compatibility facade.
---

# Add a CRM feature module

Use this workflow when a new, independent CRM capability needs native Tauri
commands. Keep its implementation separate from the existing connector feature
and from the legacy CRM command entry point.

## Create the feature

1. Create a new Rust module at
   `src-tauri/src/commands/crm/features/<name>/`. Give it a `mod.rs`; put the
   feature's command implementation in that module or in child modules it
   exports. The existing connector is the reference shape:
   [`features/connector/mod.rs:7-15`](../../../src-tauri/src/commands/crm/features/connector/mod.rs#L7-L15).
2. Export the new module from
   [`features/mod.rs`](../../../src-tauri/src/commands/crm/features/mod.rs#L7)
   with `pub mod <name>;`.
3. In the new feature's `mod.rs`, define one public `FEATURE_DESCRIPTOR` of
   type `CrmFeatureDescriptor`. Give it a stable, unique `id` and a
   `module_path` beginning with `crate::commands::crm::features::`; those are
   the two fields the descriptor provides
   ([`features/mod.rs:12-15`](../../../src-tauri/src/commands/crm/features/mod.rs#L12-L15)) and
   its tests require unique IDs and paths under this module tree
   ([`features/mod.rs:26-48`](../../../src-tauri/src/commands/crm/features/mod.rs#L26-L48)).
4. Add `<name>::FEATURE_DESCRIPTOR` to `CRM_FEATURE_REGISTRY` in
   [`features/mod.rs:18`](../../../src-tauri/src/commands/crm/features/mod.rs#L18).
   This registry is append-only: do not remove, reorder, or alter existing
   descriptors. It is the feature inventory used by boundary tests and future
   tooling ([`features/mod.rs:9-10`](../../../src-tauri/src/commands/crm/features/mod.rs#L9-L10)).

## Register native commands

1. Add `command-manifest.txt` inside the new feature directory. The native
   command registry recursively discovers manifests below `src-tauri/src`
   ([`native_command_manifest.rs:60-93`](../../../src-tauri/build_support/native_command_manifest.rs#L60-L93)); the CRM boundary test also proves a nested atomic feature manifest is discovered
   ([`crm_feature_boundaries.rs:55-84`](../../../src-tauri/tests/crm_feature_boundaries.rs#L55-L84)).
2. Add one `command <unused-order-key> <full-rust-path>` line for every
   renderer-callable command. Use a new, unused numeric key and leave existing
   manifest entries unchanged; the CRM domain manifest states that rule
   ([`commands/crm/command-manifest.txt:1-3`](../../../src-tauri/src/commands/crm/command-manifest.txt#L1-L3)).
   For a feature named `client_notes`, a command can look like:

   ```text
   command 1740 crate::commands::crm::features::client_notes::create_client_note
   ```

3. Make each path in the manifest reachable through the feature module's
   `mod.rs`, and mark renderer-callable functions with `#[tauri::command]`.

## Preserve the compatibility facade

`src-tauri/src/commands/crm/commands.rs` is the compatibility facade for old
paths. Keep it under 180 lines, do not put `#[tauri::command]` implementations
there, and do not add a new feature's implementation to it. It may retain the
stable shared CRM state/service boundary, but feature commands must live below
`crm::features` ([`commands.rs:1-5`](../../../src-tauri/src/commands/crm/commands.rs#L1-L5),
[`commands.rs:54-85`](../../../src-tauri/src/commands/crm/commands.rs#L54-L85)).

When an existing compatibility path is required, add only the necessary
re-export. The current connector re-export is the model
([`commands.rs:16`](../../../src-tauri/src/commands/crm/commands.rs#L16)). The
boundary test enforces the size limit and implementation-free rule in
[`tests/crm_feature_boundaries.rs:14-36`](../../../src-tauri/tests/crm_feature_boundaries.rs#L14-L36).

## Check before handing off

Run the CRM feature-boundary test from `src-tauri/`:

```bash
CARGO_TARGET_DIR=/home/jameson/lantern/target cargo test -p lantern --test crm_feature_boundaries
```

Also inspect the combined manifest entries before choosing an order key:

```bash
rg '^(command|state) ' src-tauri/src --glob command-manifest.txt
```
