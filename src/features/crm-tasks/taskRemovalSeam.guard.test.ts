import { readFileSync, readdirSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();

function productionFiles(directory: string, extensions: readonly string[]): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = resolve(directory, entry);
    if (statSync(path).isDirectory()) {
      files.push(...productionFiles(path, extensions));
    } else if (
      extensions.some((extension) => entry.endsWith(extension)) &&
      !entry.includes('.test.') &&
      !entry.includes('.spec.')
    ) {
      files.push(path);
    }
  }
  return files;
}

function filesContaining(files: readonly string[], pattern: RegExp): string[] {
  return files
    .filter((file) => pattern.test(readFileSync(file, 'utf8')))
    .map((file) => relative(ROOT, file).replaceAll('\\', '/'))
    .sort();
}

describe('task removal single-path guard', () => {
  it('keeps task removal behind the public task store and the shared trash authority', () => {
    const taskFiles = productionFiles(
      resolve(ROOT, 'src/features/crm-tasks'),
      ['.ts', '.tsx']
    );
    const rendererFiles = productionFiles(resolve(ROOT, 'src'), ['.ts', '.tsx']);
    const rustFiles = productionFiles(resolve(ROOT, 'src-tauri/src'), ['.rs']);

    expect(filesContaining(taskFiles, /\bsoftDeleteCrmRecord\b/)).toEqual([
      'src/features/crm-tasks/taskRecordStore.ts',
    ]);
    expect(filesContaining(taskFiles, /crm_trash_/)).toEqual([]);
    expect(filesContaining(rendererFiles, /['"]crm_trash_soft_delete['"]/)).toEqual([
      'src/features/crm-trash/trashClient.ts',
    ]);
    expect(filesContaining(rustFiles, /DELETE\s+FROM\s+crm_docs/i)).toEqual([
      'src-tauri/src/commands/crm/features/trash/commands.rs',
    ]);
  });
});
