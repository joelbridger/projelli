import { resolve } from 'node:path';

// Reproduced (REVIEW-speedup-b-REDESIGN-VERDICT.md): process.getBuiltinModule
// needs no import at all -- `process` is a Node global -- so it cannot be
// caught by specifier-based recordImport. It is matched on the call-site
// property name instead (see staticImports); the module string it names is
// intentionally not re-resolved, since a real adversarial caller could pass
// anything ('node:fs', 'node:child_process', ...).
const registryPath = resolve(process.cwd(), 'src/platform/flags/registry.ts');
const fs = process.getBuiltinModule('node:fs');

export const registrySource = fs?.readFileSync(registryPath, 'utf8');
