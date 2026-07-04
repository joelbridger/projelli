import { describe, it, expect } from 'vitest';
import { installScript, readAndClearScript, interpretConsoleErrors } from '../console-watch.mjs';

describe('installScript / readAndClearScript', () => {
  it('installScript is a self-contained string patching console.error and error listeners', () => {
    const js = installScript();
    expect(typeof js).toBe('string');
    expect(js).toContain('__benchSmokeErrors');
    expect(js).toContain('console.error');
    expect(js).toContain("addEventListener('error'");
    expect(js).toContain("addEventListener('unhandledrejection'");
  });

  it('readAndClearScript reads and clears the buffer', () => {
    const js = readAndClearScript();
    expect(js).toContain('__benchSmokeErrors');
    expect(js).toContain('window.__benchSmokeErrors=[]');
  });
});

describe('interpretConsoleErrors', () => {
  it('is clean when the array is empty', () => {
    expect(interpretConsoleErrors([])).toEqual({ clean: true, errors: [], note: null });
  });

  it('is not clean when errors were captured', () => {
    const result = interpretConsoleErrors(['TypeError: boom']);
    expect(result.clean).toBe(false);
    expect(result.errors).toEqual(['TypeError: boom']);
  });

  it('treats a non-array result as unknown (clean: null), not as clean', () => {
    const result = interpretConsoleErrors('installed');
    expect(result.clean).toBeNull();
    expect(result.note).toMatch(/not installed/);
  });
});
