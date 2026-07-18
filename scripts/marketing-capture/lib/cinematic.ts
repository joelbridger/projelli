/**
 * cinematic.ts — shared post-processing for marketing demo videos.
 *
 * Two-part pipeline that turns a raw Playwright webm into a polished,
 * self-narrating demo video:
 *
 *   1. Animated camera (crop+pan+zoom) that follows the action.
 *      Each "shot" is a focus rect + a moment in time; transitions
 *      between consecutive shots use cubic ease-in-out so the camera
 *      feels intentional, not jumpy.
 *
 *   2. Caption overlays — short text labels that appear during specific
 *      time ranges, explaining what's happening on screen so the video
 *      works without audio.
 *
 * Both are driven off frame-number expressions (`n`) instead of `t`,
 * because Playwright's webm has unreliable PTS — `t` is NaN inside the
 * crop and drawtext filters and any condition involving `t` always
 * evaluates false. We probe the source webm's frame rate at render time
 * and convert seconds → frames.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { withBrowserLaunchOptions } from '../../browser-launch.mjs';

// ────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────

export interface PageRect { x: number; y: number; width: number; height: number; }
export interface CropRect { x: number; y: number; w: number; h: number; }

/** A single keyframe in the camera timeline. */
export interface CameraShot {
  /** Seconds since recording start (i.e. webm time). */
  tSec: number;
  /** Crop window in 1x post-composite coords (1920x1080 frame). */
  crop: CropRect;
  /** Optional label for debugging. */
  label?: string;
}

/** A short text overlay shown for a time range. */
export interface Caption {
  /** Seconds since recording start. */
  startSec: number;
  endSec: number;
  text: string;
  /** Optional override for vertical position; default is lower-third. */
  position?: 'bottom' | 'top';
}

export interface CinematicRenderOptions {
  /** Path to the raw Playwright webm (4K, 3840x2160). */
  webmPath: string;
  /** Path to the macOS chrome PNG (1920x1080, alpha). */
  chromePngPath: string;
  /** Output mp4 path. */
  outPath: string;
  /** Camera shots in timeline order. Earliest first. */
  shots: CameraShot[];
  /** Caption overlays. */
  captions?: Caption[];
  /** Seconds to trim from the start of the source webm (output seek). */
  trimSec?: number;
  /** Cubic ease-in-out duration between shots. Default 0.5s. */
  transitionSec?: number;
  /**
   * Title shown on the intro card (~3s, fade-in). When omitted, no
   * title card is prepended.
   */
  videoTitle?: string;
  /**
   * End-card tagline shown under the logo (~3s, fade-in). When
   * omitted, defaults to "keepance.com".
   */
  endTagline?: string;
}

// ────────────────────────────────────────────────────────────────────────
// Geometry constants
// ────────────────────────────────────────────────────────────────────────

// All camera coords are in 1x post-composite space (1920x1080 frame
// where the page renders into a 1808x1004 inner area at offset 56,52).
// These get multiplied by 2 when feeding into the 4K composite below.
const SCALE_X = 1808 / 1920;
const SCALE_Y = 1004 / 1080;
const OFF_X = 56;
const OFF_Y = 52;

const VISIBLE_X = 56, VISIBLE_Y = 24, VISIBLE_W = 1808, VISIBLE_H = 1032;
export const OUT_W = 1808, OUT_H = 1032;
const OUT_ASPECT = OUT_W / OUT_H;

const SCALE_TO_4K = 2;
const FONT_PATH = '/usr/share/fonts/opentype/sf-pro/SF-Pro-Display-Semibold.otf';

// ────────────────────────────────────────────────────────────────────────
// Public helpers — coordinate math
// ────────────────────────────────────────────────────────────────────────

/** Convert a CSS-pixel page rect to post-composite coords. */
export function mapPageRectToPost(r: PageRect): { x1: number; y1: number; x2: number; y2: number } {
  return {
    x1: r.x * SCALE_X + OFF_X,
    y1: r.y * SCALE_Y + OFF_Y,
    x2: (r.x + r.width) * SCALE_X + OFF_X,
    y2: (r.y + r.height) * SCALE_Y + OFF_Y,
  };
}

export function wideCrop(): CropRect {
  return { x: VISIBLE_X, y: VISIBLE_Y, w: VISIBLE_W, h: VISIBLE_H };
}

/**
 * Compute the smallest crop window with OUT_ASPECT that contains the
 * union of the given page rects (any number, any subset null) plus
 * padding, clamped inside the visible area.
 */
export function focusOn(
  rects: Array<PageRect | null>,
  opts: { minWidth?: number; pad?: number; padRight?: number } = {},
): CropRect {
  const minW = opts.minWidth ?? 620;
  const minH = minW / OUT_ASPECT;
  const pad = opts.pad ?? 36;
  const padRight = opts.padRight ?? pad;

  const valid = rects.filter((r): r is PageRect => r !== null);
  if (valid.length === 0) return wideCrop();

  const boxes = valid.map(mapPageRectToPost);
  const xMin = Math.min(...boxes.map((b) => b.x1)) - pad;
  const yMin = Math.min(...boxes.map((b) => b.y1)) - pad;
  const xMax = Math.max(...boxes.map((b) => b.x2)) + padRight;
  const yMax = Math.max(...boxes.map((b) => b.y2)) + pad;
  const uw = xMax - xMin;
  const uh = yMax - yMin;

  let cropW = Math.max(uw, uh * OUT_ASPECT, minW);
  let cropH = cropW / OUT_ASPECT;
  if (cropH < uh) {
    cropH = Math.max(uh, minH);
    cropW = cropH * OUT_ASPECT;
  }
  cropW = Math.min(cropW, VISIBLE_W);
  cropH = Math.min(cropH, VISIBLE_H);

  const cx = (xMin + xMax) / 2;
  const cy = (yMin + yMax) / 2;
  let cropX = cx - cropW / 2;
  let cropY = cy - cropH / 2;
  cropX = Math.max(VISIBLE_X, Math.min(cropX, VISIBLE_X + VISIBLE_W - cropW));
  cropY = Math.max(VISIBLE_Y, Math.min(cropY, VISIBLE_Y + VISIBLE_H - cropH));
  return { x: cropX, y: cropY, w: cropW, h: cropH };
}

// ────────────────────────────────────────────────────────────────────────
// ffmpeg expression builders
// ────────────────────────────────────────────────────────────────────────

/**
 * Build a piecewise expression that holds at each keyframe value, then
 * eases over `transitionSec` to the next. Driven by `n` (frame number)
 * not `t`, since webm timestamps don't work in crop/drawtext.
 */
function buildExpr(values: Array<{ t: number; v: number }>, transitionSec: number, fps: number): string {
  const toFrame = (sec: number) => Math.round(sec * fps);
  if (values.length === 0) return '0';
  if (values.length === 1) return values[0]!.v.toFixed(2);

  let expr = values[values.length - 1]!.v.toFixed(2);
  for (let i = values.length - 1; i >= 1; i--) {
    const prev = values[i - 1]!;
    const curr = values[i]!;
    const tStart = Math.max(prev.t, curr.t - transitionSec);
    const nStart = toFrame(tStart);
    const nEnd = toFrame(curr.t);
    const dur = Math.max(1, nEnd - nStart);
    const p = `((n-${nStart})/${dur})`;
    const eased = `if(lt(${p},0.5),4*${p}*${p}*${p},1-pow(-2*${p}+2\\,3)/2)`;
    const lerp = `(${prev.v.toFixed(2)}+(${(curr.v - prev.v).toFixed(2)})*(${eased}))`;
    expr = `if(lt(n,${nStart}),${prev.v.toFixed(2)},if(lt(n,${nEnd}),${lerp},${expr}))`;
  }
  expr = `if(lt(n,${toFrame(values[0]!.t)}),${values[0]!.v.toFixed(2)},${expr})`;
  return expr;
}

// Brand logo (extracted from website/scripts/keepance-nav.v2.js). Used
// on title + end cards. The white-fill variant for dark backgrounds.
const PROJELLI_LOGO_WHITE_SVG = `<svg viewBox="0 0 2697 727" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <path d="M236.565 0C373.994 0 478.215 124.076 454.667 259.652L443.272 325.261C438.907 350.393 438.907 376.091 443.272 401.223L454.667 466.832C478.214 602.41 373.993 726.485 236.567 726.485C132.427 726.485 42.3667 653.804 20.243 551.905C-6.74766 427.582 -6.74766 298.905 20.243 174.582C42.3639 72.6812 132.424 0 236.565 0Z" fill="#FF7C6E"/>
  <path d="M288.008 720.487C271.55 724.395 254.34 726.485 236.567 726.485C132.427 726.485 42.3667 653.804 20.243 551.905C-6.74766 427.582 -6.74766 298.905 20.243 174.582C42.3639 72.6812 132.424 0 236.565 0C254.339 0 271.549 2.09148 288.007 5.99776C206.645 25.3475 141.289 89.8628 122.897 174.581C95.9067 298.903 95.9067 427.581 122.897 551.903C141.291 636.622 206.646 701.138 288.008 720.487Z" fill="#FF6554"/>
  <path d="M339.552 102.656C339.552 124.462 321.875 142.139 300.069 142.139C278.263 142.139 260.586 124.462 260.586 102.656C260.586 80.8499 278.263 63.173 300.069 63.173C321.875 63.173 339.552 80.8499 339.552 102.656ZM363.242 157.931C350.16 157.931 339.552 168.538 339.552 181.621C339.552 194.705 350.158 205.312 363.242 205.312C376.324 205.312 386.932 194.705 386.932 181.621C386.932 168.538 376.324 157.931 363.242 157.931Z" fill="#FFA69F"/>
  <path d="M2601.16 522.463V205.311H2686.11V522.463H2601.16ZM2643.95 161.892C2628.85 161.892 2616.26 157.487 2606.19 148.677C2596.55 139.448 2591.72 127.911 2591.72 114.067C2591.72 100.223 2596.55 88.8963 2606.19 80.0865C2616.26 70.8573 2628.85 66.2426 2643.95 66.2426C2659.47 66.2426 2672.06 70.8573 2681.71 80.0865C2691.78 88.8963 2696.81 100.223 2696.81 114.067C2696.81 127.911 2691.78 139.448 2681.71 148.677C2672.06 157.487 2659.47 161.892 2643.95 161.892Z" fill="#FFFFFF"/>
  <path d="M2431.51 522.463V69.389H2516.46V522.463H2431.51Z" fill="#FFFFFF"/>
  <path d="M2263.74 522.463V69.389H2348.7V522.463H2263.74Z" fill="#FFFFFF"/>
  <path d="M2037.48 530.014C2005.6 530.014 1977.28 523.302 1952.53 509.878C1928.2 496.034 1909.11 476.946 1895.27 452.614C1881.84 427.863 1875.13 399.336 1875.13 367.033C1875.13 333.892 1881.84 304.736 1895.27 279.565C1909.11 253.975 1928.2 234.048 1952.53 219.784C1976.86 205.101 2005.18 197.76 2037.48 197.76C2068.95 197.76 2096.42 204.682 2119.92 218.526C2143.41 232.37 2161.66 251.038 2174.66 274.531C2187.67 298.023 2194.17 324.663 2194.17 354.448C2194.17 358.643 2194.17 363.467 2194.17 368.921C2194.17 373.955 2193.75 379.199 2192.91 384.653H1935.54V333.053H2108.59C2107.33 312.497 2099.99 296.345 2086.57 284.599C2073.56 272.853 2057.2 266.979 2037.48 266.979C2023.22 266.979 2010 270.336 1997.84 277.048C1985.67 283.34 1976.02 293.199 1968.89 306.623C1962.18 320.048 1958.82 337.038 1958.82 357.594V375.843C1958.82 393.043 1961.97 408.146 1968.26 421.151C1974.98 433.736 1984.2 443.594 1995.95 450.726C2007.7 457.438 2021.33 460.794 2036.85 460.794C2052.38 460.794 2065.17 457.438 2075.24 450.726C2085.73 444.014 2093.49 435.414 2098.52 424.926H2185.36C2179.49 444.643 2169.63 462.473 2155.79 478.414C2141.94 494.355 2124.95 506.941 2104.81 516.17C2084.68 525.399 2062.23 530.014 2037.48 530.014Z" fill="#FFFFFF"/>
  <path d="M1652.74 660.902V588.536H1678.54C1691.96 588.536 1701.4 585.81 1706.86 580.356C1712.73 574.902 1715.67 566.092 1715.67 553.927V205.311H1800.62V553.297C1800.62 579.307 1796 600.073 1786.77 615.595C1777.96 631.536 1765.38 643.073 1749.02 650.205C1732.66 657.336 1713.36 660.902 1691.12 660.902H1652.74ZM1758.46 161.892C1742.93 161.892 1730.35 157.487 1720.7 148.677C1711.05 139.448 1706.23 127.911 1706.23 114.067C1706.23 100.223 1711.05 88.8963 1720.7 80.0865C1730.35 70.8573 1742.93 66.2426 1758.46 66.2426C1773.98 66.2426 1786.56 70.8573 1796.21 80.0865C1805.86 88.8963 1810.69 100.223 1810.69 114.067C1810.69 127.911 1805.86 139.448 1796.21 148.677C1786.56 157.487 1773.98 161.892 1758.46 161.892Z" fill="#FFFFFF"/>
  <path d="M1478.21 530.014C1448 530.014 1420.74 523.092 1396.4 509.248C1372.49 494.985 1353.4 475.477 1339.14 450.726C1325.3 425.555 1318.38 396.819 1318.38 364.516C1318.38 331.375 1325.3 302.428 1339.14 277.677C1353.4 252.506 1372.7 232.999 1397.03 219.155C1421.37 204.892 1448.63 197.76 1478.84 197.76C1509.46 197.76 1536.73 204.892 1560.64 219.155C1584.98 232.999 1604.06 252.506 1617.91 277.677C1632.17 302.428 1639.3 331.165 1639.3 363.887C1639.3 396.609 1632.17 425.555 1617.91 450.726C1604.06 475.477 1584.98 494.985 1560.64 509.248C1536.31 523.092 1508.83 530.014 1478.21 530.014ZM1478.21 456.39C1492.47 456.39 1505.06 453.033 1515.97 446.321C1527.29 439.609 1536.1 429.331 1542.4 415.487C1549.11 401.643 1552.46 384.443 1552.46 363.887C1552.46 343.331 1549.11 326.341 1542.4 312.916C1536.1 299.072 1527.29 288.794 1515.97 282.082C1505.06 274.95 1492.68 271.384 1478.84 271.384C1465.41 271.384 1453.04 274.95 1441.71 282.082C1430.39 288.794 1421.37 299.072 1414.65 312.916C1408.36 326.341 1405.21 343.331 1405.21 363.887C1405.21 384.443 1408.36 401.643 1414.65 415.487C1421.37 429.331 1430.18 439.609 1441.08 446.321C1452.41 453.033 1464.79 456.39 1478.21 456.39Z" fill="#FFFFFF"/>
  <path d="M1075.88 522.463V205.311H1151.39L1159.57 263.833C1167.12 249.989 1176.56 238.243 1187.89 228.594C1199.63 218.945 1212.85 211.394 1227.53 205.94C1242.63 200.487 1259.2 197.76 1277.24 197.76V287.745H1248.3C1235.71 287.745 1223.96 289.214 1213.06 292.15C1202.57 295.087 1193.34 299.911 1185.37 306.623C1177.4 312.916 1171.31 321.726 1167.12 333.053C1162.92 344.38 1160.83 358.643 1160.83 375.843V522.463H1075.88Z" fill="#FFFFFF"/>
  <path d="M663.532 660.902V205.311H739.044L748.483 249.36C755.195 240.131 763.166 231.74 772.395 224.189C781.625 216.218 792.532 209.926 805.117 205.311C818.122 200.277 833.225 197.76 850.425 197.76C880.21 197.76 906.43 205.101 929.083 219.784C951.737 234.467 969.566 254.394 982.571 279.565C995.996 304.316 1002.71 332.633 1002.71 364.516C1002.71 396.399 995.996 424.926 982.571 450.097C969.147 474.848 951.108 494.356 928.454 508.619C905.801 522.882 880 530.014 851.054 530.014C827.561 530.014 807.215 525.819 790.015 517.429C773.234 508.619 759.39 496.663 748.483 481.56V660.902H663.532ZM830.917 455.76C847.698 455.76 862.381 451.985 874.966 444.433C887.971 436.882 898.04 426.185 905.171 412.341C912.303 398.497 915.869 382.555 915.869 364.516C915.869 346.477 912.303 330.536 905.171 316.692C898.04 302.428 887.971 291.521 874.966 283.97C862.381 275.999 847.698 272.014 830.917 272.014C814.556 272.014 799.873 275.999 786.869 283.97C774.283 291.521 764.215 302.219 756.664 316.062C749.532 329.906 745.966 345.848 745.966 363.887C745.966 381.926 749.532 398.077 756.664 412.341C764.215 426.185 774.283 436.882 786.869 444.433C799.873 451.985 814.556 455.76 830.917 455.76Z" fill="#FFFFFF"/>
</svg>`;

/**
 * Render an arbitrary HTML body to a PNG at given dimensions via
 * Playwright. Used for title + end cards (full-frame visuals with
 * brand logo + text).
 */
async function renderHtmlPng(html: string, outPath: string, width: number, height: number): Promise<void> {
  const browser = await chromium.launch(withBrowserLaunchOptions());
  const context = await browser.newContext({
    deviceScaleFactor: 1,
    viewport: { width, height },
  });
  const page = await context.newPage();
  const fullHtml = `<!doctype html><html><head><meta charset="utf-8"><style>
    html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; }
  </style></head><body>${html}</body></html>`;
  await page.setContent(fullHtml, { waitUntil: 'load' });
  await page.evaluate(() => (document as any).fonts?.ready);
  await page.screenshot({ path: outPath, fullPage: false });
  await browser.close();
}

/**
 * Render a caption as a PNG with rounded coral pill background, white
 * text, SF Pro Display Medium. Uses Playwright to render styled HTML
 * to a screenshot — this is the only way to get true rounded corners,
 * proper kerning, and arbitrary CSS styling that ffmpeg's drawtext
 * can't produce.
 */
async function renderCaptionPng(text: string, outPath: string): Promise<{ width: number; height: number }> {
  const browser = await chromium.launch(withBrowserLaunchOptions());
  const context = await browser.newContext({
    deviceScaleFactor: 2, // retina render so the overlay stays crisp
    viewport: { width: 1920, height: 200 },
  });
  const page = await context.newPage();

  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    html, body { margin: 0; padding: 16px; background: transparent; }
    .caption {
      display: inline-block;
      background: #FF7C6E;
      color: #FFFFFF;
      font-family: 'SF Pro Display', 'Inter', system-ui, sans-serif;
      font-weight: 500;
      font-size: 32px;
      letter-spacing: -0.005em;
      padding: 13px 26px 14px;
      border-radius: 14px;
      line-height: 1.25;
      white-space: nowrap;
    }
  </style></head>
  <body><span class="caption">${escaped}</span></body></html>`;

  await page.setContent(html, { waitUntil: 'load' });
  await page.evaluate(() => (document as any).fonts?.ready);
  const el = page.locator('.caption');
  await el.screenshot({ path: outPath, omitBackground: true });
  const box = await el.boundingBox();
  await browser.close();
  if (!box) throw new Error(`caption "${text}" produced no bounding box`);
  // Bounding box is in CSS pixels; PNG was rendered at deviceScaleFactor=2,
  // so the actual PNG dimensions are double.
  return { width: Math.round(box.width * 2), height: Math.round(box.height * 2) };
}

/**
 * Build the ffmpeg expression that fades a caption overlay's alpha
 * in/out over its time range. Used as the `enable` toggle plus an
 * alpha multiplier on the overlay.
 */
function buildOverlayEnable(caption: Caption, fps: number): string {
  const startN = Math.round(caption.startSec * fps);
  const endN = Math.round(caption.endSec * fps);
  return `between(n,${startN},${endN})`;
}

// ────────────────────────────────────────────────────────────────────────
// Main render
// ────────────────────────────────────────────────────────────────────────

export async function renderCinematic(options: CinematicRenderOptions): Promise<void> {
  const { webmPath, chromePngPath, outPath, shots, captions = [], trimSec = 0 } = options;
  const transitionSec = options.transitionSec ?? 0.5;

  // Probe input fps. Playwright's recordVideo writes 25 fps webm by default.
  const probe = execFileSync('ffprobe', [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=r_frame_rate',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    webmPath,
  ]).toString().trim();
  const [num, den] = probe.split('/').map(Number);
  const FPS = (num ?? 25) / (den ?? 1);

  // Build crop expressions in 4K coords (multiply by 2).
  const exprX = buildExpr(shots.map((s) => ({ t: s.tSec, v: s.crop.x * SCALE_TO_4K })), transitionSec, FPS);
  const exprY = buildExpr(shots.map((s) => ({ t: s.tSec, v: s.crop.y * SCALE_TO_4K })), transitionSec, FPS);
  const exprW = buildExpr(shots.map((s) => ({ t: s.tSec, v: s.crop.w * SCALE_TO_4K })), transitionSec, FPS);
  const exprH = buildExpr(shots.map((s) => ({ t: s.tSec, v: s.crop.h * SCALE_TO_4K })), transitionSec, FPS);

  // ── Render each caption to a PNG via Playwright ──────────────────────
  const captionDir = path.join(path.dirname(outPath), '.tmp-captions');
  rmSync(captionDir, { recursive: true, force: true });
  mkdirSync(captionDir, { recursive: true });
  const captionAssets: Array<{ caption: Caption; pngPath: string; size: { width: number; height: number } }> = [];
  for (let i = 0; i < captions.length; i++) {
    const caption = captions[i]!;
    const pngPath = path.join(captionDir, `caption-${String(i).padStart(2, '0')}.png`);
    const size = await renderCaptionPng(caption.text, pngPath);
    captionAssets.push({ caption, pngPath, size });
    console.log(`[cinematic] caption ${i}: "${caption.text}" → ${size.width}x${size.height}px`);
  }

  // Persist timeline for debugging.
  mkdirSync(path.dirname(outPath), { recursive: true });
  const timelinePath = outPath.replace(/\.mp4$/, '.timeline.json');
  writeFileSync(timelinePath, JSON.stringify({ FPS, transitionSec, shots, captions, trimSec }, null, 2));

  // ── Build ffmpeg filter graph ────────────────────────────────────────
  // Inputs: [0]=webm, [1]=chrome PNG, [2..N+1]=caption PNGs
  // Filter graph:
  //   1. Scale 4K source → chrome's content area (3616x2008)
  //   2. Pad to 3840x2160 with content offset (112, 104)
  //   3. Scale chrome PNG to 4K
  //   4. Overlay chrome
  //   5. Animated crop with time-varying expressions
  //   6. Lanczos downscale to 1808x1032 final output
  //   7. Overlay each caption PNG with timed enable
  const captionInputs = captionAssets.map((c) => ['-i', c.pngPath]).flat();

  let filterGraph =
    '[0:v]scale=3616:2008:flags=lanczos[scaled];' +
    '[scaled]pad=3840:2160:112:104:color=0x1a1a1a[padded];' +
    '[1:v]scale=3840:2160:flags=lanczos,format=rgba[chrome];' +
    '[padded][chrome]overlay=0:0[composed];' +
    `[composed]crop=w='${exprW}':h='${exprH}':x='${exprX}':y='${exprY}'[zoomed];` +
    '[zoomed]scale=1808:1032:flags=lanczos[base]';

  if (captionAssets.length === 0) {
    filterGraph += `;[base]format=yuv420p[v]`;
  } else {
    let prev = 'base';
    for (let i = 0; i < captionAssets.length; i++) {
      const { caption, size } = captionAssets[i]!;
      const inputIdx = 2 + i; // 0=webm, 1=chrome, 2+ = captions
      const yPos = caption.position === 'top' ? '90' : `H-${size.height}-72`;
      const next = i === captionAssets.length - 1 ? 'with_caps' : `s${i}`;
      filterGraph += `;[${prev}][${inputIdx}:v]overlay=x=(W-w)/2:y=${yPos}:enable='${buildOverlayEnable(caption, FPS)}'[${next}]`;
      prev = next;
    }
    filterGraph += `;[with_caps]format=yuv420p[v]`;
  }

  // Render the main video to a tmp path; we'll concat title + main + end
  // afterwards if videoTitle was provided.
  const wantsCards = typeof options.videoTitle === 'string' && options.videoTitle.length > 0;
  const mainPath = wantsCards ? outPath.replace(/\.mp4$/, '.main.mp4') : outPath;

  execFileSync(
    'ffmpeg',
    [
      '-y',
      '-i', webmPath,
      '-i', chromePngPath,
      ...captionInputs,
      '-ss', trimSec.toFixed(3),
      '-filter_complex', filterGraph,
      '-map', '[v]',
      '-c:v', 'libx264',
      '-preset', 'slow',
      '-crf', '18',
      '-r', '30',
      mainPath,
    ],
    { stdio: 'inherit' },
  );

  if (wantsCards) {
    await composeWithCards({
      mainPath,
      outPath,
      videoTitle: options.videoTitle!,
      endTagline: options.endTagline ?? 'keepance.com',
      cardDir: captionDir, // reuse the tmp dir for card PNGs
    });
  }

  console.log(`✓ ${outPath}`);
}

// ────────────────────────────────────────────────────────────────────────
// Title + end card composition
// ────────────────────────────────────────────────────────────────────────

export interface ComposeWithCardsOpts {
  /** Path to the rendered "main" mp4 (output of the composite pipeline). */
  mainPath: string;
  /** Final output path. */
  outPath: string;
  /** Title shown on the intro card. */
  videoTitle: string;
  /** Tagline under the logo on the end card. */
  endTagline: string;
  /** Scratch dir for the rendered title/end PNGs and intermediate mp4s. */
  cardDir: string;
}

/**
 * Render a navy-gradient title PNG + end PNG, build them into 3-second
 * mp4 segments with fade-in, then concat title + main + end → outPath.
 */
export async function composeWithCards(opts: ComposeWithCardsOpts): Promise<void> {
  const { mainPath, outPath, videoTitle, endTagline, cardDir } = opts;
  const W = 1808, H = 1032;
  const TITLE_DUR = 2.6;
  const END_DUR = 3.0;
  const FADE = 0.55;

  const titlePng = path.join(cardDir, 'title-card.png');
  const endPng = path.join(cardDir, 'end-card.png');
  const titleMp4 = path.join(cardDir, 'title-card.mp4');
  const endMp4 = path.join(cardDir, 'end-card.mp4');

  const escapedTitle = videoTitle
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const escapedTagline = endTagline
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Shared visual: deep navy gradient with a subtle coral accent dot
  // in the corner. Logo is the white-ink Keepance wordmark.
  const cardStyle = `
    body { margin: 0; padding: 0; }
    .card {
      width: 100%; height: 100%;
      display: flex; flex-direction: column;
      align-items: center; justify-content: center;
      background: radial-gradient(ellipse at 30% 25%, #1e3a5f 0%, #111F35 60%, #0a1322 100%);
      font-family: 'SF Pro Display', 'Inter', system-ui, sans-serif;
      color: #FFFFFF;
      position: relative;
      overflow: hidden;
    }
    .card::before {
      content: '';
      position: absolute;
      width: 320px; height: 320px;
      border-radius: 50%;
      background: radial-gradient(circle, rgba(255,124,110,0.32) 0%, transparent 70%);
      top: -80px; right: -80px;
    }
    .card::after {
      content: '';
      position: absolute;
      width: 240px; height: 240px;
      border-radius: 50%;
      background: radial-gradient(circle, rgba(255,124,110,0.18) 0%, transparent 70%);
      bottom: -60px; left: -60px;
    }
    .logo { width: 320px; height: auto; position: relative; z-index: 1; }
    .title-text {
      font-size: 64px;
      font-weight: 600;
      line-height: 1.15;
      letter-spacing: -0.015em;
      text-align: center;
      max-width: 1400px;
      margin-top: 56px;
      position: relative;
      z-index: 1;
    }
    .end-tag {
      font-size: 26px;
      font-weight: 400;
      color: rgba(255,255,255,0.65);
      letter-spacing: 0.04em;
      margin-top: 32px;
      position: relative;
      z-index: 1;
    }
  `;

  await renderHtmlPng(
    `<style>${cardStyle}</style><div class="card"><div class="logo">${PROJELLI_LOGO_WHITE_SVG}</div><div class="title-text">${escapedTitle}</div></div>`,
    titlePng, W, H,
  );
  await renderHtmlPng(
    `<style>${cardStyle} .logo { width: 460px; }</style><div class="card"><div class="logo">${PROJELLI_LOGO_WHITE_SVG}</div><div class="end-tag">${escapedTagline}</div></div>`,
    endPng, W, H,
  );

  // Build title mp4: hold the still PNG with fade-in.
  execFileSync('ffmpeg', [
    '-y',
    '-loop', '1',
    '-framerate', '30',
    '-i', titlePng,
    '-t', String(TITLE_DUR),
    '-vf', `fade=t=in:st=0:d=${FADE},format=yuv420p`,
    '-c:v', 'libx264',
    '-preset', 'slow',
    '-crf', '18',
    '-r', '30',
    titleMp4,
  ], { stdio: 'inherit' });

  // Build end mp4: same idea.
  execFileSync('ffmpeg', [
    '-y',
    '-loop', '1',
    '-framerate', '30',
    '-i', endPng,
    '-t', String(END_DUR),
    '-vf', `fade=t=in:st=0:d=${FADE},format=yuv420p`,
    '-c:v', 'libx264',
    '-preset', 'slow',
    '-crf', '18',
    '-r', '30',
    endMp4,
  ], { stdio: 'inherit' });

  // Concat the three segments. Force matching SAR (sample aspect ratio)
  // — the main mp4 carries non-square SAR from the upstream lanczos
  // pipeline, while the still-image cards default to 1:1, and concat
  // refuses to combine streams with mismatched SAR.
  execFileSync('ffmpeg', [
    '-y',
    '-i', titleMp4,
    '-i', mainPath,
    '-i', endMp4,
    '-filter_complex',
    '[0:v]setsar=1[v0];' +
    '[1:v]setsar=1[v1];' +
    '[2:v]setsar=1[v2];' +
    '[v0][v1][v2]concat=n=3:v=1[v]',
    '-map', '[v]',
    '-c:v', 'libx264',
    '-preset', 'slow',
    '-crf', '18',
    '-r', '30',
    outPath,
  ], { stdio: 'inherit' });
}
