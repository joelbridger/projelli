# FB2 railchrome round 2

Branch: `lp/fb2-railchrome`

Done:

- Fixed feedback lines 18-20.
- Workflows now uses the shared `SurfaceHeader` treatment.
- Ask, Client Map, and Workflows header rows measured the same browser height: 77px.
- Rail row title and meta text now use shared tokens across the touched rails.

Checks:

- `npm run typecheck`
- Scoped rail tests: 19 files, 305 tests
- Workflows tests: 10 files, 110 tests
- `node scripts/eslint-gate.mjs`
- `git diff --check`
