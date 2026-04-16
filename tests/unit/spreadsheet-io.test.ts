/**
 * UX-32: parseSpreadsheet must handle both data URLs AND raw text for
 * CSVs. Previously it always routed through dataUrlToArrayBuffer, which
 * calls atob() — raw CSV text isn't base64, so atob throws
 * "InvalidCharacterError: failed to execute 'atob' on 'Window': the string
 * to be decoded is not correctly encoded."
 */

import { describe, expect, it } from 'vitest';
import { parseSpreadsheet } from '../../src/utils/spreadsheet-io';

describe('parseSpreadsheet (UX-32)', () => {
  it('parses raw-text CSV without throwing an atob error', async () => {
    const raw = 'name,age,city\nAlice,30,Austin\nBob,25,Berkeley';
    const model = await parseSpreadsheet(raw, 'csv');
    const sheet = model.sheets[0];
    expect(sheet).toBeDefined();
    expect(sheet!.rows.length).toBe(3);
    expect(sheet!.rows[0]![0]?.display).toBe('name');
    expect(sheet!.rows[1]![0]?.display).toBe('Alice');
    expect(sheet!.rows[2]![2]?.display).toBe('Berkeley');
  });

  it('parses a data-URL CSV identically', async () => {
    const raw = 'a,b\n1,2';
    const b64 = typeof btoa !== 'undefined' ? btoa(raw) : Buffer.from(raw).toString('base64');
    const url = `data:text/csv;base64,${b64}`;
    const model = await parseSpreadsheet(url, 'csv');
    expect(model.sheets[0]!.rows.length).toBe(2);
    expect(model.sheets[0]!.rows[0]![1]?.display).toBe('b');
    expect(model.sheets[0]!.rows[1]![0]?.display).toBe('1');
  });

  it('parses an ArrayBuffer CSV', async () => {
    const raw = 'x,y\n10,20';
    const buffer = new TextEncoder().encode(raw).buffer as ArrayBuffer;
    const model = await parseSpreadsheet(buffer, 'csv');
    expect(model.sheets[0]!.rows[1]![1]?.display).toBe('20');
  });
});
