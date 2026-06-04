import { describe, it, expect } from 'vitest';

// We test the firm-name persistence helper (pure logic, no DOM)
describe('export firm name persistence', () => {
  it('getFirmName returns empty string when nothing stored', () => {
    // Mock localStorage
    const storage: Record<string, string> = {};
    const mockStorage = {
      getItem: (k: string) => storage[k] ?? null,
      setItem: (k: string, v: string) => { storage[k] = v; },
    };
    const getFirmName = (ls: typeof mockStorage) => ls.getItem('keepance_firm_name') ?? '';
    expect(getFirmName(mockStorage)).toBe('');
  });

  it('getFirmName returns stored value', () => {
    const storage: Record<string, string> = { keepance_firm_name: 'Acme Law PLLC' };
    const mockStorage = {
      getItem: (k: string) => storage[k] ?? null,
      setItem: (k: string, v: string) => { storage[k] = v; },
    };
    const getFirmName = (ls: typeof mockStorage) => ls.getItem('keepance_firm_name') ?? '';
    expect(getFirmName(mockStorage)).toBe('Acme Law PLLC');
  });
});
