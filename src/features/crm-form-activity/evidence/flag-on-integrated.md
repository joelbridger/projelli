# Flag-on integrated proof

Date: 2026-07-15

This proof does not use `form-activity-preview.tsx`. It renders the real
`CrmHomeShell` with the registered `form-activity` route, enables the public
flag through `setDevFlagOverride`, and mounts the production
`FormActivitySurface`. The surface mounts the real `useLiveCrmRecords` hook;
in the browser test environment that reader correctly returns its safe empty
state because no Tauri store is available.

Exact command and result:

```text
$ npx vitest run src/features/crm-form-activity/FormActivitySurface.test.tsx src/features/crm-form-activity/FormActivitySurface.integration.test.tsx src/features/crm-form-activity/selectors.test.ts src/features/crm-form-activity/surfaceRegistration.test.ts

Test Files  4 passed (4)
Tests  8 passed (8)
```

The separately committed `form-activity-preview.*` files remain visual-only
evidence. They are not used as flag, shell, live-reader, or durability proof.
