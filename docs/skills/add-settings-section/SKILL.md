# Add a settings section

Each settings feature owns one descriptor beside its panel. Do not add a
section branch to `SettingsContent`, a category entry to `schema.ts`, or search
terms to `settingsContentHelpers.ts`.

1. Augment `SettingsSectionMap` in the feature module with its exact section
   id. This keeps misspellings out at type-check time.
2. Export a `SettingsModuleDescriptor` with a stable `order`, translated
   `labelKey`, `definitions`, `groups`, search terms, and `render` function.
3. Add one append-only registration entry to `settingsModuleRegistry`.
4. Put all user-facing copy in the feature locale shards and confirm English,
   Spanish, and German resolve it.
5. Add a focused registry and rendering test. Do not reorder existing entries.

The platform schema only flattens descriptor definitions for persistence,
defaults, export, and import. The settings screen only looks up descriptors;
it must not learn feature-specific panels.
