# Settings module contribution doorway

Use the public Settings doorway when a feature needs to add a panel to an
existing Settings section:

```ts
import {
  settingsModuleRegistry,
  type SettingsModuleDescriptor,
} from '@/features/settings';
```

Make one `SettingsModuleDescriptor`, then call
`settingsModuleRegistry.register(descriptor)` during the feature's setup. The
returned function removes that exact contribution when setup is undone. The
registry validates the new descriptor together with every existing Settings
panel before it changes the live list.

The real Settings renderer reads that same list. The executable, type-checked
outside-consumer fixture is
[`settingsModule.import.ts`](../../foundation-contracts/settings/settingsModule.import.ts).
The Settings test registers that outside consumer's descriptor and proves the
real panel renderer includes it. Keep that fixture updated with this doorway
rather than replacing it with a prose-only example.
