import { describe, it, expect } from 'vitest';
import { CHECKLIST, STUBS, allCheckIds, findCheck } from '../checklist.mjs';
import { STATUS } from '../result.mjs';

describe('CHECKLIST', () => {
  it('every entry has a unique id, a section, a title, and a run function', () => {
    const ids = new Set();
    for (const c of CHECKLIST) {
      expect(typeof c.id).toBe('string');
      expect(typeof c.section).toBe('string');
      expect(typeof c.title).toBe('string');
      expect(typeof c.run).toBe('function');
      expect(ids.has(c.id)).toBe(false);
      ids.add(c.id);
    }
  });

  it('covers the smoke-2 sections: setup, wave 0, wave 1, wave 2, cross-cutting', () => {
    const sections = new Set(CHECKLIST.map((c) => c.section));
    expect([...sections].some((s) => /setup/i.test(s))).toBe(true);
    expect([...sections].some((s) => /wave 0/i.test(s))).toBe(true);
    expect([...sections].some((s) => /wave 1/i.test(s))).toBe(true);
    expect([...sections].some((s) => /wave 2/i.test(s))).toBe(true);
    expect([...sections].some((s) => /cross-cutting/i.test(s))).toBe(true);
  });

  it('marks exactly the Wealthbox Approve step as liveOnly', () => {
    const liveOnly = CHECKLIST.filter((c) => c.liveOnly).map((c) => c.id);
    expect(liveOnly).toEqual(['wave2-wealthbox-approve-live']);
  });
});

describe('STUBS', () => {
  it('has entries for both Wave 3 and Wave 4', () => {
    expect(STUBS.some((s) => /wave 3/i.test(s.section))).toBe(true);
    expect(STUBS.some((s) => /wave 4/i.test(s.section))).toBe(true);
  });

  it('every stub cites a plan doc and never touches the bench (run() takes no ctx)', async () => {
    for (const s of STUBS) {
      expect(s.planRef).toMatch(/docs\/plans\/lantern-plus\//);
      const result = await s.run();
      expect(result.status).toBe(STATUS.TODO);
    }
  });

  it('stub ids are unique and do not collide with live check ids', () => {
    const stubIds = STUBS.map((s) => s.id);
    expect(new Set(stubIds).size).toBe(stubIds.length);
    const liveIds = new Set(CHECKLIST.map((c) => c.id));
    for (const id of stubIds) expect(liveIds.has(id)).toBe(false);
  });
});

describe('allCheckIds / findCheck', () => {
  it('allCheckIds includes both live checks and stubs', () => {
    const ids = allCheckIds();
    expect(ids).toContain('workspace-binding');
    expect(ids).toContain('wave3-capture-start-stop');
  });

  it('findCheck resolves an id from either list, and undefined for unknown ids', () => {
    expect(findCheck('index-health')).toBeDefined();
    expect(findCheck('wave4-whole-book-view')).toBeDefined();
    expect(findCheck('totally-unknown')).toBeUndefined();
  });
});
