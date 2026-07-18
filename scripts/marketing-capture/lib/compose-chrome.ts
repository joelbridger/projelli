import { chromium, type Browser } from 'playwright';
import { withBrowserLaunchOptions } from '../../browser-launch.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const TEMPLATE_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../chrome-template/sequoia-window.html'
);

let cachedTemplate: string | null = null;
function loadTemplate(): string {
  if (!cachedTemplate) cachedTemplate = readFileSync(TEMPLATE_PATH, 'utf-8');
  return cachedTemplate;
}

export interface ComposeChromeOptions {
  title?: string;
  padding?: number;
  browser?: Browser;
}

export async function composeChrome(
  screenshot: Buffer,
  opts: ComposeChromeOptions = {}
): Promise<Buffer> {
  const { title = 'Keepance', padding = 80 } = opts;
  const ownsBrowser = !opts.browser;
  const browser = opts.browser ?? await chromium.launch(withBrowserLaunchOptions());

  try {
    const html = loadTemplate().replace(
      '<div class="title" id="title">Keepance</div>',
      `<div class="title" id="title">${escapeHtml(title)}</div>`
    );

    const dataUrl = `data:image/png;base64,${screenshot.toString('base64')}`;

    // We need the natural image dimensions before we can set viewport size.
    // Decode width/height from the PNG header in the buffer.
    if (screenshot.length < 24) {
      throw new Error('Invalid PNG buffer: too small to contain dimensions');
    }
    const imgWidth = screenshot.readUInt32BE(16);
    const imgHeight = screenshot.readUInt32BE(20);

    const page = await browser.newPage({
      // Start viewport wide enough to render the image at natural size.
      viewport: { width: imgWidth + padding * 2, height: imgHeight + padding * 2 + 28 },
      deviceScaleFactor: 2,
    });
    try {
      await page.setContent(html);
      await page.evaluate((url) => {
        (document.getElementById('screenshot') as HTMLImageElement).src = url;
      }, dataUrl);
      await page.waitForFunction(() => {
        const img = document.getElementById('screenshot') as HTMLImageElement;
        return img.complete && img.naturalWidth > 0;
      });

      // Read the actual rendered window dimensions (handles any CSS adjustments).
      const dims = await page.evaluate((pad) => {
        const win = document.getElementById('window')!;
        const r = win.getBoundingClientRect();
        return { w: Math.ceil(r.width + pad * 2), h: Math.ceil(r.height + pad * 2) };
      }, padding);
      await page.setViewportSize({ width: dims.w, height: dims.h });

      const buf = await page.screenshot({ type: 'png', fullPage: false });
      return buf;
    } finally {
      await page.close();
    }
  } finally {
    if (ownsBrowser) await browser.close();
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
