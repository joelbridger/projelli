import { describe, it, expect } from 'vitest';
import { parseSnapshot, parsePages, parseEvalResult, findByTestId, findByText } from '../parse.mjs';

describe('parseSnapshot', () => {
  it('parses a valid JSON array of elements', () => {
    const stdout = JSON.stringify([{ testid: 'docx-draft-follow-up', tag: 'button', text: 'Draft follow-up' }]);
    const result = parseSnapshot(stdout);
    expect(result.ok).toBe(true);
    expect(result.elements).toHaveLength(1);
  });

  it('reports not-ok on invalid JSON', () => {
    const result = parseSnapshot('not json');
    expect(result.ok).toBe(false);
    expect(result.elements).toEqual([]);
    expect(result.error).toMatch(/not valid JSON/);
  });

  it('reports not-ok when the JSON is not an array', () => {
    const result = parseSnapshot('{"oops":true}');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not a JSON array/);
  });
});

describe('parsePages', () => {
  it('parses a valid pages array', () => {
    const result = parsePages(JSON.stringify([{ url: 'http://localhost:5173/', title: 'Keepance' }]));
    expect(result.ok).toBe(true);
    expect(result.pages[0].title).toBe('Keepance');
  });

  it('reports not-ok on invalid JSON', () => {
    expect(parsePages('garbage').ok).toBe(false);
  });
});

describe('parseEvalResult', () => {
  it('parses JSON output', () => {
    expect(parseEvalResult('true')).toBe(true);
    expect(parseEvalResult('["a","b"]')).toEqual(['a', 'b']);
  });

  it('falls back to the trimmed raw string for non-JSON output', () => {
    expect(parseEvalResult('  installed  \n')).toBe('installed');
  });

  it('handles empty output', () => {
    expect(parseEvalResult('')).toBe('');
  });
});

describe('findByTestId / findByText', () => {
  const elements = [
    { testid: 'docx-draft-follow-up', tag: 'button', text: 'Draft follow-up' },
    { tag: 'div', text: 'Synced 2 meetings.' },
  ];

  it('finds by exact testid', () => {
    expect(findByTestId(elements, 'docx-draft-follow-up')).toBe(elements[0]);
    expect(findByTestId(elements, 'nope')).toBeUndefined();
  });

  it('finds by case-insensitive text substring', () => {
    expect(findByText(elements, 'synced')).toBe(elements[1]);
  });

  it('finds by a supplied regex', () => {
    expect(findByText(elements, /^draft follow-up$/i)).toBe(elements[0]);
  });

  it('safely escapes regex metacharacters in a plain-string needle', () => {
    const withParens = [{ tag: 'div', text: 'Approve 1 change (pending)' }];
    expect(findByText(withParens, 'change (pending)')).toBe(withParens[0]);
  });
});
