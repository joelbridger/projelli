import { createRequire } from 'node:module';

// Reproduced (REVIEW-speedup-b-REDESIGN-VERDICT.md): `require` bound to a
// non-`require` name via createRequire escapes a selector that only
// recognizes a call literally spelled `require` (the round-4 "rename erases
// meaning" pattern). This is closed structurally: any variable initialized
// from createRequire(...) is tracked as require-like, so `req('node:fs')`
// below is recorded as an ordinary `node:fs` import -- filesystemCapability,
// not a separate escape-vector flag.
const req = createRequire(import.meta.url);
const fs = req('node:fs');

export const registrySource = fs.readFileSync('src/platform/flags/registry.ts', 'utf8');
