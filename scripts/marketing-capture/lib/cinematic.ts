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

/**
 * Render a caption as a PNG with rounded coral pill background, white
 * text, SF Pro Display Medium. Uses Playwright to render styled HTML
 * to a screenshot — this is the only way to get true rounded corners,
 * proper kerning, and arbitrary CSS styling that ffmpeg's drawtext
 * can't produce.
 */
async function renderCaptionPng(text: string, outPath: string): Promise<{ width: number; height: number }> {
  const browser = await chromium.launch();
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
      outPath,
    ],
    { stdio: 'inherit' },
  );

  console.log(`✓ ${outPath}`);
}
