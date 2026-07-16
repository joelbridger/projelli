import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const registryPath = resolve(process.cwd(), 'src/platform/flags/registry.ts');

// Reproduced (REVIEW-speedup-b-REDESIGN-VERDICT.md): a test can read a
// production source file's raw text through a spawned child process, with no
// import edge to that file and no fs import at all. `node:child_process` is a
// blanket capability signal (see the comment in staticImports) precisely
// because this argument cannot be reduced to a resolvable module specifier.
export const registrySource = execFileSync('cat', [registryPath], { encoding: 'utf8' });
