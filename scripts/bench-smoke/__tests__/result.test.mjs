import { describe, it, expect } from 'vitest';
import { makeResult, summarize, aggregateExitCode, toMarkdownTable, STATUS } from '../result.mjs';

describe('makeResult', () => {
  it('builds a well-formed result', () => {
    const r = makeResult({ id: 'x', section: 'S', status: STATUS.PASS, detail: 'ok' });
    expect(r).toMatchObject({ id: 'x', section: 'S', status: 'PASS', detail: 'ok', screenshots: [] });
  });

  it('rejects an invalid status', () => {
    expect(() => makeResult({ id: 'x', section: 'S', status: 'NOPE', detail: 'ok' })).toThrow(/invalid status/);
  });

  it('requires id, section, and detail', () => {
    expect(() => makeResult({ section: 'S', status: STATUS.PASS, detail: 'ok' })).toThrow(/id is required/);
    expect(() => makeResult({ id: 'x', status: STATUS.PASS, detail: 'ok' })).toThrow(/section is required/);
    expect(() => makeResult({ id: 'x', section: 'S', status: STATUS.PASS })).toThrow(/detail is required/);
  });
});

describe('summarize', () => {
  it('overall is PASS when everything passed', () => {
    const results = [makeResult({ id: 'a', section: 'S', status: STATUS.PASS, detail: 'ok' })];
    expect(summarize(results).overall).toBe('PASS');
  });

  it('overall is FAIL when anything failed, even alongside passes', () => {
    const results = [
      makeResult({ id: 'a', section: 'S', status: STATUS.PASS, detail: 'ok' }),
      makeResult({ id: 'b', section: 'S', status: STATUS.FAIL, detail: 'broke' }),
    ];
    expect(summarize(results).overall).toBe('FAIL');
  });

  it('overall is SETUP-BLOCKED when nothing failed but something was blocked', () => {
    const results = [
      makeResult({ id: 'a', section: 'S', status: STATUS.PASS, detail: 'ok' }),
      makeResult({ id: 'b', section: 'S', status: STATUS.SETUP_BLOCKED, detail: 'no precondition' }),
    ];
    expect(summarize(results).overall).toBe('SETUP-BLOCKED');
  });

  it('FAIL outranks SETUP-BLOCKED', () => {
    const results = [
      makeResult({ id: 'a', section: 'S', status: STATUS.SETUP_BLOCKED, detail: 'blocked' }),
      makeResult({ id: 'b', section: 'S', status: STATUS.FAIL, detail: 'broke' }),
    ];
    expect(summarize(results).overall).toBe('FAIL');
  });

  it('counts every status bucket', () => {
    const results = [
      makeResult({ id: 'a', section: 'S', status: STATUS.PASS, detail: 'ok' }),
      makeResult({ id: 'b', section: 'S', status: STATUS.PASS, detail: 'ok' }),
      makeResult({ id: 'c', section: 'S', status: STATUS.TODO, detail: 'stub' }),
    ];
    expect(summarize(results).counts).toMatchObject({ PASS: 2, TODO: 1, FAIL: 0 });
  });

  it('TODO/SKIPPED-only results summarize to INCOMPLETE, not PASS', () => {
    const results = [makeResult({ id: 'a', section: 'S', status: STATUS.TODO, detail: 'stub' })];
    expect(summarize(results).overall).toBe('INCOMPLETE');
  });
});

describe('aggregateExitCode', () => {
  it('is 0 when all passed', () => {
    expect(aggregateExitCode([makeResult({ id: 'a', section: 'S', status: STATUS.PASS, detail: 'ok' })])).toBe(0);
  });

  it('is 1 when anything failed', () => {
    const results = [
      makeResult({ id: 'a', section: 'S', status: STATUS.SETUP_BLOCKED, detail: 'blocked' }),
      makeResult({ id: 'b', section: 'S', status: STATUS.FAIL, detail: 'broke' }),
    ];
    expect(aggregateExitCode(results)).toBe(1);
  });

  it('is 3 when blocked but nothing failed', () => {
    expect(aggregateExitCode([makeResult({ id: 'a', section: 'S', status: STATUS.SETUP_BLOCKED, detail: 'blocked' })])).toBe(3);
  });

  it('is 4 when TODO/SKIPPED remain but nothing failed or blocked', () => {
    const results = [
      makeResult({ id: 'a', section: 'S', status: STATUS.TODO, detail: 'stub' }),
      makeResult({ id: 'b', section: 'S', status: STATUS.SKIPPED, detail: 'skipped' }),
    ];
    expect(aggregateExitCode(results)).toBe(4);
  });
});

describe('toMarkdownTable', () => {
  it('renders a row per result with pipes/newlines escaped', () => {
    const results = [makeResult({ id: 'a', section: 'S', status: STATUS.FAIL, detail: 'broke | badly\nline2' })];
    const table = toMarkdownTable(results);
    expect(table).toContain('| S — a | FAIL | broke \\| badly line2 |');
  });
});
