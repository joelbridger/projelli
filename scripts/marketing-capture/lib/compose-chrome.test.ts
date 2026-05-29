import { test, expect } from 'vitest';
import { composeChrome } from './compose-chrome';
import sharp from 'sharp';

test('composeChrome wraps PNG in macOS frame at expected dimensions', async () => {
  const fakeScreenshot = await sharp({
    create: { width: 1280, height: 800, channels: 3, background: { r: 255, g: 0, b: 0 } }
  }).png().toBuffer();

  const out = await composeChrome(fakeScreenshot, { title: 'Keepance — Test' });
  const meta = await sharp(out).metadata();
  expect(meta.format).toBe('png');
  expect(meta.width).toBeGreaterThan(1280);
  expect(meta.height).toBeGreaterThan(800 + 28);
}, 30_000);
