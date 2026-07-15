# Settings panel composition parity notes

- The seven legacy rail sections retain their original ids, rail orders (10 through 70), labels, schema definitions, group keywords, and bound section renderers.
- The Organization rail section is registered but stays invisible until a visible panel targets it. With `teams-roles` dark, the rail remains the original seven sections.
- With `teams-roles` enabled, the composed panel renders `TeamsRolesSettings` as its React component. The focused parity test compares its full rendered DOM with the pre-composition direct component render.
- The registry test asserts the legacy rail order and visible set. The SettingsContent regression test continues to cover the legacy search and navigation behavior.
- `settingsContentRegistry.test.tsx` uses a type-augmented fake section and panel to prove a new section can reach the rail, content, and search without another SettingsContent section list.

No Rust/native file or platform-to-feature type move was made.
