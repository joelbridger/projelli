# Registering a Settings panel

The Settings registry has two append-only lists in `settingsModuleRegistry.ts`:

- Add one `SettingsPanelDescriptor` line to `settingsPanelRegistry`. Use a unique `id`, the target `section`, stable within-section `order`, optional `flagId`, and a React `render` component.
- If the target rail section is new, first augment `SettingsSectionMap` beside your feature descriptor, then add one `SettingsSectionDescriptor` line to `settingsSectionRegistry`. Empty sections are hidden until a visible panel mounts there.

Example panel mount:

```ts
myFeatureSettingsPanel,
```

Panels never replace another feature's panel. The registry sorts panels by `order` and renders each one as a separate React component boundary. Do not call a panel component directly.

The validator is the enforcement point. It rejects duplicate section ids, duplicate panel ids, panels targeting unknown sections, groups in the wrong section, and duplicate setting keys across both section and panel definitions. Add or update a colocated registry test, then run the focused registry tests, `npm run typecheck`, and `npm run typecheck:tests`.

For a dark feature, set `flagId`; the registry hides the panel while the flag is off. Do not add a second visibility check in `SettingsContent`.
