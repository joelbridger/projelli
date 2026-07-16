import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const homeDirectory = resolve(process.cwd(), 'src/features/home');
const legacyDescriptorPath = resolve(
  homeDirectory,
  '../../app/shell/registry/legacyAppSurfaceDescriptors.tsx'
);

describe('home surface boundaries', () => {
  it('uses the public Home package doorway for the sanctioned existing descriptor swap', () => {
    const source = readFileSync(legacyDescriptorPath, 'utf8');

    expect(source).toContain("from '@/features/home'");
    expect(source).not.toContain("from '@/features/home/");
  });

  it('does not occupy the reserved personalization subtree', () => {
    expect(existsSync(resolve(homeDirectory, 'personalization'))).toBe(false);
  });
});
