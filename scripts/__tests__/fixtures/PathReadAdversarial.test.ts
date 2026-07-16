import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const sourceRoot = resolve(process.cwd(), 'src/platform');
const inspectedSource = resolve(sourceRoot, 'flags/registry.ts');

// This is intentionally a source-inspection fixture, not an imported module.
// The selector must connect it to registry.ts through the assembled path.
readFileSync(inspectedSource, 'utf8');
