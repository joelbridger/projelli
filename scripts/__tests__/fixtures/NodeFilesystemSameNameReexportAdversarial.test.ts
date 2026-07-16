import path from 'node:path';
import { readFileSync } from './NodeFilesystemSameNameReexport';

const registryPath = path.resolve(process.cwd(), 'src/platform/flags/registry.ts');

export const registrySource = readFileSync(registryPath, 'utf8');
