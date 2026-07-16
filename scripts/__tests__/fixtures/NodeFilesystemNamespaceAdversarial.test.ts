import { promises as fs } from 'node:fs';
import path from 'node:path';

const registryPath = path.resolve(process.cwd(), 'src/platform/flags/registry.ts');

export const registrySource = await fs.readFile(registryPath, 'utf8');
