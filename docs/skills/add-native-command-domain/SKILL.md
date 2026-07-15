---
name: add-native-command-domain
description: Register new Lantern Tauri commands and managed native state through domain-owned command manifests. Use when adding a Rust command, a native feature command folder, a managed-state initializer, or a new root native command domain without editing src-tauri/src/lib.rs.
---

# Add a native command domain

Keep `src-tauri/src/lib.rs` unchanged. The build scans every file named
`command-manifest.txt` below `src-tauri/src`, validates the combined registry,
and generates the one Tauri handler and the ordered state initializer.

## Add commands

1. Put the Rust implementation in its owning domain. Prefer
   `src-tauri/src/commands/<domain>/features/<feature>/` for a new feature.
2. Export the module through the nearest `mod.rs`. Add one append-only
   `pub mod <domain>;` to `commands/mod.rs` only when creating a truly new root
   domain.
3. Add `#[tauri::command]` to each renderer-callable function and make its full
   Rust path reachable from the crate root.
4. Create `command-manifest.txt` beside the feature or domain implementation.
5. Add one line per command:

```text
command 3000 crate::commands::calendar::features::event_write::create_event
```

Use a unique unsigned order key. Never renumber existing entries. Inspect all
allocated keys before choosing one:

```bash
rg '^(command|state) ' src-tauri/src --glob command-manifest.txt
```

Use an optional compile condition only when the Rust item has the same condition:

```text
command 3010 crate::commands::example::debug_probe cfg(debug_assertions)
```

## Add managed state

Expose a function accepting `&tauri::App` and add it to the same manifest:

```text
state 200 crate::commands::calendar::features::event_write::manage_state
```

State order is startup order. Append after existing state initializers unless a
real dependency requires an earlier unused key. Keep each initializer path
unique.

## Verify

Run the manifest tests, then the normal native test suite with the shared warm
Cargo target. Run these commands from `src-tauri/`:

```bash
CARGO_TARGET_DIR=/home/jameson/lantern/target cargo test -p lantern --test native_command_manifests
CARGO_TARGET_DIR=/home/jameson/lantern/target cargo test -p lantern
```

Treat these build failures as registry bugs and fix the manifest:

- duplicate order key;
- duplicate Rust command path;
- duplicate public Tauri command name;
- duplicate state initializer;
- missing or misspelled function path (reported by Rust compilation). The
  manifest parser cannot prove a Rust symbol exists; this is intentionally a
  compiler check. Expect `cargo check -p lantern` to fail with a
  `cannot find function` / `cannot find value` error that names the path.

Do not add a second handler, state list, or command registry to `lib.rs`. Do not
adopt Specta while performing this workflow. The manifest format is the shared
seam a later Specta binding generator can consume; extend its optional metadata
in the generator instead of creating another command list.
