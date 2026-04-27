import { test, expect } from 'vitest';
import { macStyles } from './inject-mac-styles';

test('macStyles returns CSS with key selectors', () => {
  const css = macStyles();
  expect(css).toContain('-apple-system');
  expect(css).toContain('"SF Pro Text"');
  expect(css).toContain('::-webkit-scrollbar');
  expect(css).toContain('#007AFF');
  expect(css.length).toBeGreaterThan(200);
});
