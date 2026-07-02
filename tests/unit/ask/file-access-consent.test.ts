/**
 * F2.5 — per-conversation consent for the AI's file tools.
 *
 * Locks the security-critical decision surface: whether the AI's cloud file
 * tools may run, given a conversation's consent state and the active scope. A
 * grant is bound to the scope it was made under (a single-client grant never
 * widens to another client or to all-clients). Pure helpers only.
 */
import { describe, it, expect } from 'vitest';
import {
  fileToolsAllowed,
  needsFileAccessConsent,
  isReadClassTool,
  READ_CLASS_TOOL_NAMES,
  WRITE_CLASS_TOOL_NAMES,
  type ConsentScope,
  type FileAccessConsent,
} from '@/platform/ai/fileAccessConsent';
import { FILE_ACCESS_TOOLS } from '@/platform/tools/fileAccessTools';

const A: ConsentScope = { kind: 'matter', matterId: 'client-A' };
const B: ConsentScope = { kind: 'matter', matterId: 'client-B' };
const ALL: ConsentScope = { kind: 'allMatters' };

describe('tool-class constants', () => {
  it('read-class = read/list/search', () => {
    expect([...READ_CLASS_TOOL_NAMES].sort()).toEqual(['list_files', 'read_file', 'search_files']);
    for (const n of READ_CLASS_TOOL_NAMES) expect(isReadClassTool(n)).toBe(true);
    for (const n of WRITE_CLASS_TOOL_NAMES) expect(isReadClassTool(n)).toBe(false);
  });
  it('every FILE_ACCESS_TOOLS entry is covered by exactly one class', () => {
    const all = new Set<string>([...READ_CLASS_TOOL_NAMES, ...WRITE_CLASS_TOOL_NAMES]);
    for (const t of FILE_ACCESS_TOOLS) expect(all.has(t.name)).toBe(true);
    expect(all.size).toBe(FILE_ACCESS_TOOLS.length);
  });
});

describe('fileToolsAllowed — fails closed', () => {
  it('unasked → not allowed, any scope', () => {
    expect(fileToolsAllowed({ state: 'unasked' }, A)).toBe(false);
    expect(fileToolsAllowed({ state: 'unasked' }, ALL)).toBe(false);
  });
  it('undefined consent → not allowed', () => {
    expect(fileToolsAllowed(undefined, A)).toBe(false);
    expect(fileToolsAllowed(undefined, ALL)).toBe(false);
  });
  it('denied → not allowed, any scope', () => {
    expect(fileToolsAllowed({ state: 'denied' }, A)).toBe(false);
    expect(fileToolsAllowed({ state: 'denied' }, ALL)).toBe(false);
  });
  it('granted with no recorded scope → not allowed (fail closed)', () => {
    expect(fileToolsAllowed({ state: 'granted' }, A)).toBe(false);
  });
});

describe('fileToolsAllowed — grant bound to scope', () => {
  it('single-client grant → allowed for that SAME client only', () => {
    const c: FileAccessConsent = { state: 'granted', grantedScope: A };
    expect(fileToolsAllowed(c, A)).toBe(true);
  });
  it('single-client grant → NOT allowed for a DIFFERENT client (Codex #1: no widening)', () => {
    const c: FileAccessConsent = { state: 'granted', grantedScope: A };
    expect(fileToolsAllowed(c, B)).toBe(false);
  });
  it('single-client grant → NOT allowed on an all-clients turn', () => {
    const c: FileAccessConsent = { state: 'granted', grantedScope: A };
    expect(fileToolsAllowed(c, ALL)).toBe(false);
  });
  it('all-clients grant → allowed on an all-clients turn', () => {
    const c: FileAccessConsent = { state: 'granted', grantedScope: ALL };
    expect(fileToolsAllowed(c, ALL)).toBe(true);
  });
  it('all-clients grant → also allowed on any single-client turn', () => {
    const c: FileAccessConsent = { state: 'granted', grantedScope: ALL };
    expect(fileToolsAllowed(c, A)).toBe(true);
    expect(fileToolsAllowed(c, B)).toBe(true);
  });
});

describe('needsFileAccessConsent', () => {
  it('is the inverse of fileToolsAllowed', () => {
    const cases: Array<[FileAccessConsent | undefined, ConsentScope]> = [
      [undefined, A],
      [{ state: 'unasked' }, A],
      [{ state: 'denied' }, ALL],
      [{ state: 'granted', grantedScope: A }, A],
      [{ state: 'granted', grantedScope: A }, B],
      [{ state: 'granted', grantedScope: A }, ALL],
      [{ state: 'granted', grantedScope: ALL }, ALL],
    ];
    for (const [consent, scope] of cases) {
      expect(needsFileAccessConsent(consent, scope)).toBe(!fileToolsAllowed(consent, scope));
    }
  });
});
