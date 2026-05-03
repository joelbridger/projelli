/**
 * Stream A1 — Single source of truth for vision-capable model detection.
 *
 * Rules per provider:
 *   claude:  claude-3-5-sonnet-*, claude-3-opus-*, claude-3-haiku-*,
 *            claude-sonnet-4-*, claude-opus-4-*, claude-haiku-4-* (the
 *            modern 4.x series). Explicit exclusion: claude-3-5-haiku-*
 *            (text-only, see spec §4.2).
 *   openai:  gpt-4o* or o1* prefix.
 *   gemini:  gemini-1.5* or gemini-2.0* prefix.
 *   ollama:  runtime probe — model name contains 'llava', 'vision', or
 *            'qwen2.5-vl' (case-insensitive). No static list possible
 *            because Ollama users pull arbitrary models.
 *   mock:    always returns true (test convenience).
 */

/** Accepted image MIME types across all providers. */
export const SUPPORTED_IMAGE_MIMES: ReadonlyArray<string> = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
];

/** Maximum file size cap in bytes (20 MB). */
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

/**
 * Returns true when the given model ID is known to support image input
 * for the specified provider, false otherwise.
 *
 * Provider IDs must match the string used in AIChatFile.provider:
 *   'claude' | 'anthropic' | 'openai' | 'gemini' | 'google' | 'ollama' | 'mock'
 *
 * Model IDs are compared case-insensitively for Ollama; exact-prefix
 * (lowercase) for all others.
 */
export function isVisionModel(provider: string, model: string): boolean {
  const m = model.toLowerCase();
  switch (provider) {
    case 'claude':
    case 'anthropic': {
      // Explicit text-only exclusion first.
      if (m.startsWith('claude-3-5-haiku')) return false;
      // Vision-capable Claude families.
      return (
        m.startsWith('claude-3-5-sonnet') ||
        m.startsWith('claude-3-opus') ||
        m.startsWith('claude-3-haiku') ||
        m.startsWith('claude-sonnet-4') ||
        m.startsWith('claude-opus-4') ||
        m.startsWith('claude-haiku-4')
      );
    }
    case 'openai': {
      return m.startsWith('gpt-4o') || m.startsWith('o1');
    }
    case 'gemini':
    case 'google': {
      return m.startsWith('gemini-1.5') || m.startsWith('gemini-2.0');
    }
    case 'ollama': {
      return (
        m.includes('llava') ||
        m.includes('vision') ||
        m.includes('qwen2.5-vl')
      );
    }
    case 'mock': {
      return true;
    }
    default:
      return false;
  }
}

/**
 * Returns a sensible vision-capable model to suggest when the user has
 * attached an image to a text-only model. The suggestion is the cheapest
 * broadly-available vision model per provider.
 */
export function getSuggestedVisionModel(provider: string): string {
  switch (provider) {
    case 'claude':
    case 'anthropic':
      return 'claude-3-haiku-20240307';
    case 'openai':
      return 'gpt-4o-mini';
    case 'gemini':
    case 'google':
      return 'gemini-1.5-flash';
    case 'ollama':
      // Suggest pulling llava if nothing vision-capable is locally installed.
      return 'llava';
    default:
      return '';
  }
}
