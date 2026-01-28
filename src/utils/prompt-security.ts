/**
 * Prompt Security Utilities
 *
 * Functions for safely including user content in AI prompts
 * to prevent prompt injection attacks.
 */

/**
 * Sanitize user content for safe inclusion in AI prompts
 *
 * This function removes or escapes patterns that could be used to
 * manipulate the AI's behavior, including:
 * - Code block delimiters (which might end system prompts)
 * - Role prefixes (SYSTEM:, USER:, etc.)
 * - XML-like instruction tags
 * - Null bytes and control characters
 *
 * @param content - The raw user content to sanitize
 * @returns Sanitized content safe for prompt inclusion
 */
export function sanitizeForPrompt(content: string): string {
  let sanitized = content;

  // Remove or escape code block delimiters
  // These could be used to "escape" from wrapped content
  sanitized = sanitized.replace(/```/g, "'''");

  // Escape instruction-like patterns at the start of lines
  // These could confuse the model about who is speaking
  sanitized = sanitized.replace(
    /^(SYSTEM|USER|ASSISTANT|HUMAN|AI|CLAUDE|GPT|MODEL):/gim,
    (match) => `[${match}]`
  );

  // Escape XML-like tags that might be interpreted as system instructions
  // Different models may interpret these differently
  sanitized = sanitized.replace(
    /<(system|instruction|override|ignore|prompt|context|tool|function)>/gi,
    '[$1]'
  );
  sanitized = sanitized.replace(
    /<\/(system|instruction|override|ignore|prompt|context|tool|function)>/gi,
    '[/$1]'
  );

  // Remove null bytes which could be used to truncate strings
  sanitized = sanitized.replace(/\0/g, '');

  // Remove other control characters except newlines and tabs
  // eslint-disable-next-line no-control-regex
  sanitized = sanitized.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

  return sanitized;
}

/**
 * Wrap user content with clear boundaries
 *
 * This creates unambiguous delimiters around user content,
 * making it clear to the model where user input begins and ends.
 *
 * @param content - The user content to wrap
 * @param label - A label for the content type (e.g., 'DOCUMENT', 'USER_INPUT')
 * @returns Content wrapped with clear boundaries
 */
export function wrapUserContent(
  content: string,
  label: string = 'USER_CONTENT'
): string {
  const sanitized = sanitizeForPrompt(content);
  const upperLabel = label.toUpperCase().replace(/[^A-Z0-9_]/g, '_');

  return `--- BEGIN ${upperLabel} ---\n${sanitized}\n--- END ${upperLabel} ---`;
}

/**
 * Create a safe prompt with user content
 *
 * This is a higher-level function that combines sanitization and wrapping
 * with a template for common use cases.
 *
 * @param template - The prompt template with {content} placeholder
 * @param userContent - The user-provided content to include
 * @param contentLabel - Label for the user content section
 * @returns Complete prompt with safely included user content
 */
export function createSafePrompt(
  template: string,
  userContent: string,
  contentLabel: string = 'USER_INPUT'
): string {
  const wrappedContent = wrapUserContent(userContent, contentLabel);
  return template.replace('{content}', wrappedContent);
}

/**
 * Mask sensitive data in strings (for safe logging/display)
 *
 * This is used to prevent API keys and other secrets from
 * appearing in logs or error messages.
 *
 * @param text - Text that may contain sensitive data
 * @returns Text with sensitive data masked
 */
export function maskSensitiveData(text: string): string {
  let masked = text;

  // Mask Anthropic API keys
  masked = masked.replace(/sk-ant-[a-zA-Z0-9-]+/g, 'sk-ant-***MASKED***');
  masked = masked.replace(/sk-[a-zA-Z0-9]{20,}/g, 'sk-***MASKED***');

  // Mask OpenAI API keys
  masked = masked.replace(/sk-proj-[a-zA-Z0-9]{20,}/g, 'sk-proj-***MASKED***');

  // Mask Google API keys
  masked = masked.replace(/AIza[a-zA-Z0-9_-]{35}/g, 'AIza***MASKED***');

  // Mask bearer tokens
  masked = masked.replace(/bearer [a-zA-Z0-9-_.]+/gi, 'Bearer ***MASKED***');

  // Mask base64-encoded JWTs (common in auth headers)
  masked = masked.replace(
    /eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g,
    '***JWT_MASKED***'
  );

  return masked;
}

/**
 * Check if a string contains potentially sensitive data
 *
 * @param text - Text to check
 * @returns True if sensitive patterns are detected
 */
export function containsSensitiveData(text: string): boolean {
  const sensitivePatterns = [
    /sk-[a-zA-Z0-9]{20,}/, // Anthropic/OpenAI key
    /sk-ant-[a-zA-Z0-9-]+/, // Anthropic v2 key
    /sk-proj-[a-zA-Z0-9]{20,}/, // OpenAI project key
    /AIza[a-zA-Z0-9_-]{35}/, // Google API key
    /bearer [a-zA-Z0-9-_.]+/i, // Bearer tokens
    /eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/, // JWT
  ];

  for (const pattern of sensitivePatterns) {
    if (pattern.test(text)) {
      return true;
    }
  }

  return false;
}

/**
 * Safe error message generator
 *
 * Creates error messages that don't leak sensitive information.
 *
 * @param error - The original error (may contain sensitive data)
 * @param context - Safe context to include in the message
 * @returns Safe error message
 */
export function createSafeErrorMessage(
  error: unknown,
  context: string = 'Operation'
): string {
  if (error instanceof Error) {
    const safeMessage = maskSensitiveData(error.message);
    return `${context} failed: ${safeMessage}`;
  }

  return `${context} failed with unknown error`;
}
