import { readFile } from 'node:fs/promises';
import path from 'node:path';
import postcss from 'postcss';
import tailwindcss from '@tailwindcss/postcss';
import { chromium } from 'playwright';

function relativeLuminance(color: string): number {
  const channels = color
    .match(/\d+(?:\.\d+)?/g)
    ?.slice(0, 3)
    .map(Number);
  if (!channels || channels.length !== 3) {
    throw new Error(`Expected a computed RGB color, received ${color}`);
  }
  const [red, green, blue] = channels.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  if (red === undefined || green === undefined || blue === undefined) {
    throw new Error(`Expected three RGB channels, received ${color}`);
  }
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrastRatio(foreground: string, background: string): number {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  return (
    (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
    (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
  );
}

describe('global success badge contrast', () => {
  // Load-sensitive: compiling Tailwind and launching Chromium can exceed 5s under fleet load.
  it('keeps normal-size success badge text at the 4.5:1 accessibility floor', async () => {
    const stylesheetPath = path.resolve(
      process.cwd(),
      'src/styles/globals.css'
    );
    const source = await readFile(stylesheetPath, 'utf8');
    const compiled = await postcss([tailwindcss()]).process(source, {
      from: stylesheetPath,
    });

    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(`
        <style>${compiled.css}</style>
        <span class="kp-badge kp-badge--success kp-badge--sm">Verified</span>
      `);
      const colors = await page
        .locator('.kp-badge--success')
        .evaluate((badge) => {
          const style = getComputedStyle(badge);
          return { foreground: style.color, background: style.backgroundColor };
        });

      expect(
        contrastRatio(colors.foreground, colors.background)
      ).toBeGreaterThanOrEqual(4.5);
    } finally {
      await browser.close();
    }
  }, 30_000);
});
