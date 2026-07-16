import path from 'node:path';
import { readSourceFile } from './NodeFilesystemReexport';

const registryPath = path.resolve(process.cwd(), 'src/platform/flags/registry.ts');

export const registrySource = readSourceFile(registryPath, 'utf8');
