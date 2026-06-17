/**
 * Stream A1 — Image token estimation for the cost meter.
 *
 * Formulas per spec §4.2:
 *   Claude:  ~85 tokens per 512x512 tile (scales linearly with tile count).
 *   OpenAI:  ~85 base tokens + ~170 tokens per 512x512 detail tile.
 *   Gemini:  ~258 tokens per image (flat, dimension-independent).
 *   Ollama:  0 (model-dependent; cost-meter contribution skipped per spec).
 *   Mock:    0 (test convenience).
 *
 * When width/height are unavailable, fall back to a tile estimate derived
 * from byteSize (assumes ~3 bytes per pixel at the raw level).
 */

import type { ChatAttachment } from '@/platform/types/ai';

const TILE_PX = 512;
const CLAUDE_TOKENS_PER_TILE = 85;
const OPENAI_BASE_TOKENS = 85;
const OPENAI_TOKENS_PER_TILE = 170;
const GEMINI_TOKENS_PER_IMAGE = 258;

/**
 * Compute the number of 512x512 tiles needed to cover an image of the
 * given pixel dimensions. Minimum 1 tile.
 */
function tileCount(widthPx: number, heightPx: number): number {
  const tilesX = Math.ceil(widthPx / TILE_PX);
  const tilesY = Math.ceil(heightPx / TILE_PX);
  return Math.max(1, tilesX * tilesY);
}

/**
 * Estimate pixel dimensions from byte size when metadata.width/height are
 * absent. Assumes 3 bytes per pixel (RGB, no compression). This is a
 * rough upper bound; actual compressed images are smaller, but the
 * over-estimate is conservative (safe direction for cost display).
 */
function estimateDimensionsFromBytes(byteSize: number): { w: number; h: number } {
  const pixels = byteSize / 3;
  const side = Math.sqrt(pixels);
  return { w: Math.ceil(side), h: Math.ceil(side) };
}

/**
 * Returns the estimated number of input tokens consumed by a single image
 * attachment for the given provider.
 *
 * Provider IDs: 'claude'|'anthropic', 'openai', 'gemini'|'google', 'ollama', 'mock'.
 */
export function estimateImageTokens(
  provider: string,
  att: ChatAttachment
): number {
  if (att.type !== 'image') return 0;

  const { width, height } = att.metadata;
  const dims = (width !== undefined && height !== undefined)
    ? { w: width, h: height }
    : estimateDimensionsFromBytes(att.byteSize);
  const tiles = tileCount(dims.w, dims.h);

  switch (provider) {
    case 'claude':
    case 'anthropic':
      return CLAUDE_TOKENS_PER_TILE * tiles;

    case 'openai':
      return OPENAI_BASE_TOKENS + OPENAI_TOKENS_PER_TILE * tiles;

    case 'gemini':
    case 'google':
      return GEMINI_TOKENS_PER_IMAGE;

    case 'ollama':
    case 'mock':
    default:
      return 0;
  }
}
