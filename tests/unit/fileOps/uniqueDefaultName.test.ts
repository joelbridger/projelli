/**
 * findUniqueDefaultName — walks "base", "base 2", "base 3", … until an
 * `existsInDir` check reports one that's free. Backs the create-document
 * dialogs' default value so repeated "New Word document" clicks never
 * collide with an existing file.
 */
import { describe, it, expect, vi } from 'vitest';
import { findUniqueDefaultName } from '@/app/fileOps/uniqueDefaultName';

describe('findUniqueDefaultName', () => {
  it('returns the plain base when nothing exists', async () => {
    const exists = vi.fn().mockResolvedValue(false);
    const result = await findUniqueDefaultName(exists, 'my-document', '.docx');
    expect(result).toBe('my-document');
    expect(exists).toHaveBeenCalledWith('my-document.docx');
  });

  it('increments to "base 2" when the plain base already exists', async () => {
    const existing = new Set(['my-document.docx']);
    const exists = vi.fn(async (name: string) => existing.has(name));
    const result = await findUniqueDefaultName(exists, 'my-document', '.docx');
    expect(result).toBe('my-document 2');
  });

  it('keeps incrementing past multiple collisions', async () => {
    const existing = new Set(['my-document.docx', 'my-document 2.docx', 'my-document 3.docx']);
    const exists = vi.fn(async (name: string) => existing.has(name));
    const result = await findUniqueDefaultName(exists, 'my-document', '.docx');
    expect(result).toBe('my-document 4');
  });

  it('works with no extension (folders)', async () => {
    const existing = new Set(['my-folder']);
    const exists = vi.fn(async (name: string) => existing.has(name));
    const result = await findUniqueDefaultName(exists, 'my-folder');
    expect(result).toBe('my-folder 2');
  });

  it('normalizes an extension without a leading dot', async () => {
    const exists = vi.fn().mockResolvedValue(false);
    await findUniqueDefaultName(exists, 'my-notes', 'txt');
    expect(exists).toHaveBeenCalledWith('my-notes.txt');
  });
});
