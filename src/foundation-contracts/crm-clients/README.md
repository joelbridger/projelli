# CRM clients public doorway

Outside CRM contributors import household sections, record tabs, and the
meetings client-boundary adapter only from `@/features/crm-clients`.

`pavedPath.import.ts` is a type-checked consumer example. It creates a
`HouseholdSectionContext`, validates both live registries, reads a registered
tab, and creates a Meetings `ClientBoundary` from a verified household record
identity. `doorways.test.tsx` executes the same path and proves the selected
tab mounts through the live registry.

Do not create a matter ID from a household ID. If the live record does not
carry a matter ID that resolves to a current matter, do not pass a household
identity to `HouseholdRecordSurface`; it will not provide a client boundary.
