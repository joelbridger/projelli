import { readFile } from 'node:fs/promises';
import path from 'node:path';
import postcss from 'postcss';
import tailwindcss from '@tailwindcss/postcss';
import { chromium } from 'playwright';
import { withBrowserLaunchOptions } from '../../scripts/browser-launch.mjs';

describe('global table cell spacing', () => {
  it('restores readable padding after Tailwind Preflight resets plain table cells', async () => {
    const source = await readFile(
      path.resolve(process.cwd(), 'src/styles/globals.css'),
      'utf8'
    );
    const compiled = await postcss([tailwindcss()]).process(source, {
      from: path.resolve(process.cwd(), 'src/styles/globals.css'),
    });

    const browser = await chromium.launch(withBrowserLaunchOptions({ headless: true }));
    try {
      const page = await browser.newPage();
      await page.setContent(`
        <style>${compiled.css}</style>
        <table>
          <thead><tr><th id="heading">Record type</th><th>Found</th></tr></thead>
          <tbody><tr><td id="cell">Household</td><td>1</td></tr></tbody>
        </table>
      `);

      const spacing = await page
        .locator('#heading, #cell')
        .evaluateAll((cells) =>
          cells.map((cell) => {
            const style = getComputedStyle(cell);
            return {
              block: [style.paddingTop, style.paddingBottom],
              inline: [style.paddingLeft, style.paddingRight],
            };
          })
        );

      expect(spacing).toEqual([
        { block: ['8px', '8px'], inline: ['12px', '12px'] },
        { block: ['8px', '8px'], inline: ['12px', '12px'] },
      ]);
    } finally {
      await browser.close();
    }
  });
});
