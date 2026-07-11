import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const BACKEND_RELAY_FILES = [
  'backend/src/routes/matters.ts',
  'backend/src/routes/matterKeys.ts',
  'backend/src/server.ts',
  'backend/src/lib/matters.ts',
  'backend/src/lib/db.ts',
];

function firmClientSources(dir = 'src/platform/firm'): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return firmClientSources(path);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [path] : [];
  });
}

describe('opaque firm relay contract', () => {
  it('keeps every v2 relay boundary free of plaintext routes and fields', () => {
    const files = [...BACKEND_RELAY_FILES, ...firmClientSources()];
    expect(files).toContain('src/platform/firm/contract.ts');
    expect(existsSync('backend/src/contract.ts')).toBe(false);

    for (const file of files) {
      // db.ts has one intentional historical-schema detector. It never reads
      // or emits the value; removing it would strand pre-v2 installations.
      const source = readFileSync(file, 'utf8').replace('c.name === "matter_id"', 'c.name === "legacy_column"');
      expect(source, file).not.toMatch(/\b(?:client_name|matter_id|doc_id)\b/);
      expect(source, file).not.toContain('/matter/:id');
      expect(source, file).not.toContain('/org/matters');
    }
  });
});
