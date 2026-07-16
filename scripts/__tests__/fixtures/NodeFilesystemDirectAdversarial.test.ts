import { readFileSync } from 'node:fs';
import path from 'node:path';

const registryPath = path.resolve(process.cwd(), 'src/platform/flags/registry.ts');

export const registrySource = readFileSync(registryPath, 'utf8');
