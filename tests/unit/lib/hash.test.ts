import { describe, it, expect } from 'vitest';
import { sha256Hex } from '@/lib/hash';

describe('sha256Hex', () => {
  it('hashes empty bytes to known value', async () => {
    const result = await sha256Hex(new Uint8Array(0));
    expect(result).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('hashes "hello" to known value', async () => {
    const bytes = new TextEncoder().encode('hello');
    const result = await sha256Hex(bytes);
    expect(result).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  });

  it('produces deterministic output for same input', async () => {
    const bytes = new TextEncoder().encode('test123');
    const a = await sha256Hex(bytes);
    const b = await sha256Hex(bytes);
    expect(a).toBe(b);
  });

  it('produces different outputs for different inputs', async () => {
    const a = await sha256Hex(new TextEncoder().encode('a'));
    const b = await sha256Hex(new TextEncoder().encode('b'));
    expect(a).not.toBe(b);
  });
});
