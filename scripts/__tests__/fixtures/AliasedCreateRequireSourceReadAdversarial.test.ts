import { createRequire } from 'node:module';

// Reproduced (REVIEW-speedup-b-MANIFEST-VERDICT.md): aliasing the
// createRequire *function itself* (not its result) escaped the earlier
// call-site recognition, which only tracked a variable initialized FROM
// calling createRequire(...) -- `const cr = createRequire` never calls it,
// so `cr(...)` was never recognized as require-like, and `req('node:fs')`
// was never recorded. `unresolved` stayed false too, so no downstream
// full-suite backstop caught it either: the test was silently skippable.
// Tracking one more alias level does not end this (`const cr2 = cr`,
// `[createRequire][0](...)`, `({ cr: createRequire }).cr(...)` all escape
// the same way) -- closed instead by blanket-flagging the node:module import
// itself, which cannot be aliased away.
const cr = createRequire;
const req = cr(import.meta.url);
const fs = req('node:fs');

export const registrySource = fs.readFileSync('src/platform/flags/registry.ts', 'utf8');
