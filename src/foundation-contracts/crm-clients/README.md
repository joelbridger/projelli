# CRM clients public doorway

Outside CRM contributors import household sections, record tabs, and the
meetings client-boundary adapter only from `@/features/crm-clients`.

`pavedPath.import.ts` is a type-checked outside-contributor example. It defines
a real section and tab, registers both on the live registries, and returns a
cleanup function. `doorways.test.tsx` renders the real household screen,
selects the contributed tab, and proves both mounts occurred.

Do not create or accept a matter ID from a household record. The boundary
adapter finds exactly one `Matter.crmHouseholdKeys` match and uses that matter's
local `id` (never `firmMatterId`). Zero or multiple matches provide no boundary.
