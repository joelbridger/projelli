// scripts/robot/__tests__/connection.test.mjs
import { describe, it, expect } from 'vitest';
import { pickPage } from '../connection.mjs';

describe('pickPage', () => {
  it('prefers the localhost:5173 app page over connector/account windows', () => {
    const pages = [
      { url: 'http://localhost:5173/connector' },
      { url: 'devtools://devtools/bundled/x.html' },
      { url: 'http://localhost:5173/' },
    ];
    expect(pickPage(pages)?.url).toBe('http://localhost:5173/');
  });
  it('falls back to the first non-devtools page when no 5173 page exists', () => {
    const pages = [
      { url: 'devtools://devtools/x' },
      { url: 'tauri://localhost/index.html' },
    ];
    expect(pickPage(pages)?.url).toBe('tauri://localhost/index.html');
  });
  it('returns null for an empty list', () => {
    expect(pickPage([])).toBe(null);
  });
});
