/**
 * Stream A2 - Single source of truth for native PDF support detection.
 *
 * Only Anthropic's Claude API supports a native PDF content block
 * ({ type: 'document', source: { type: 'base64', ... } }).
 * All other providers receive extracted text via PDF.js.
 *
 * Within Claude, native PDF support is available on Sonnet (3.5+) and
 * Opus (3+) families. Haiku 3.x is text-extract only because Anthropic
 * has not documented native PDF support for it.
 * All Claude 4.x Sonnet and Opus models support native PDF.
 *
 * Provider IDs match the string used in AIChatFile.provider:
 *   'claude' | 'openai' | 'gemini' | 'ollama' | 'mock'
 */

/** The sole MIME type accepted for PDF attachments. */
export const SUPPORTED_PDF_MIME = 'application/pdf';

/** PDF processing mode. */
export type PdfMode = 'native' | 'text-extract';

/**
 * Returns true when the given provider + model combination supports
 * Anthropic's native PDF content block.
 *
 * Only 'claude' provider can return true. All others always return false.
 */
export function supportsNativePdf(provider: string, model: string): boolean {
  if (provider !== 'claude' && provider !== 'anthropic') return false;

  const m = model.toLowerCase();

  // Claude 4.x Sonnet and Opus: native PDF supported.
  if (m.startsWith('claude-sonnet-4') || m.startsWith('claude-opus-4')) return true;

  // Claude 3.5 Sonnet: native PDF supported.
  if (m.startsWith('claude-3-5-sonnet')) return true;

  // Claude 3 Opus: native PDF supported.
  if (m.startsWith('claude-3-opus')) return true;

  // Claude 3 Haiku, Claude 3.5 Haiku: text-extract only.
  // No documented native PDF API support for Haiku models.
  return false;
}

/**
 * Returns the PDF processing mode for the given provider + model.
 * 'native' means bytes are sent as Anthropic document block.
 * 'text-extract' means PDF.js extracts text sent as a text content block.
 */
export function getPdfMode(provider: string, model: string): PdfMode {
  return supportsNativePdf(provider, model) ? 'native' : 'text-extract';
}
