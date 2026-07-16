import { createRequire } from 'node:module';

// Reproduced (REVIEW-speedup-b-REDESIGN-VERDICT.md): `require` bound to a
// non-`require` name via createRequire escapes a selector that only
// recognizes a call literally spelled `require` (the round-4 "rename erases
// meaning" pattern). Closed via a blanket node:module capability signal
// (REVIEW-speedup-b-MANIFEST-VERDICT.md): the import specifier itself is
// what is flagged, not the call site -- so it does not matter what `req`
// gets renamed to below, or what it is later called with. See the block
// comment in staticImports for why an earlier version that instead tried to
// resolve req('node:fs') back to the fs specifier was replaced: that
// call-site recognition had its own alias escape (see
// AliasedCreateRequireSourceReadAdversarial.test.ts).
const req = createRequire(import.meta.url);
const fs = req('node:fs');

export const registrySource = fs.readFileSync('src/platform/flags/registry.ts', 'utf8');
