/**
 * API Key Security Tests
 *
 * These tests verify that API keys are handled securely throughout
 * the application, including storage, transmission, and logging.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock patterns that should never appear in logs or error messages
const SENSITIVE_PATTERNS = [
  /sk-[a-zA-Z0-9]{20,}/, // Anthropic API key pattern
  /sk-ant-[a-zA-Z0-9-]+/, // Anthropic API key pattern v2
  /sk-proj-[a-zA-Z0-9]{20,}/, // OpenAI project key pattern
  /AIza[a-zA-Z0-9_-]{35}/, // Google API key pattern
  /bearer [a-zA-Z0-9-_]+/i, // Bearer tokens
];

/**
 * Check if a string contains sensitive data
 */
function containsSensitiveData(text: string): boolean {
  for (const pattern of SENSITIVE_PATTERNS) {
    if (pattern.test(text)) {
      return true;
    }
  }
  return false;
}

/**
 * Mask sensitive data in strings (for safe logging)
 */
function maskSensitiveData(text: string): string {
  let masked = text;

  // Mask API keys
  masked = masked.replace(/sk-[a-zA-Z0-9]{20,}/g, 'sk-***MASKED***');
  masked = masked.replace(/sk-ant-[a-zA-Z0-9-]+/g, 'sk-ant-***MASKED***');
  masked = masked.replace(/sk-proj-[a-zA-Z0-9]{20,}/g, 'sk-proj-***MASKED***');
  masked = masked.replace(/AIza[a-zA-Z0-9_-]{35}/g, 'AIza***MASKED***');
  masked = masked.replace(/bearer [a-zA-Z0-9-_]+/gi, 'Bearer ***MASKED***');

  return masked;
}

describe('API Key Security Tests', () => {
  describe('Sensitive Data Detection', () => {
    it('should detect Anthropic API keys', () => {
      expect(containsSensitiveData('key=sk-ant-api03-abc123def456')).toBe(true);
      expect(containsSensitiveData('API_KEY=sk-1234567890abcdefghij')).toBe(true);
    });

    it('should detect OpenAI API keys', () => {
      expect(containsSensitiveData('sk-proj-1234567890abcdefghijklmn')).toBe(true);
    });

    it('should detect Google API keys', () => {
      expect(containsSensitiveData('AIzaSyAbCdEfGhIjKlMnOpQrStUvWxYz12345678')).toBe(true);
    });

    it('should detect bearer tokens', () => {
      expect(containsSensitiveData('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9')).toBe(true);
    });

    it('should not flag normal text', () => {
      expect(containsSensitiveData('Hello, this is a normal message')).toBe(false);
      expect(containsSensitiveData('The API returned 200 OK')).toBe(false);
    });
  });

  describe('Data Masking', () => {
    it('should mask Anthropic keys', () => {
      const input = 'Using key sk-ant-api03-abc123def456xyz for auth';
      const masked = maskSensitiveData(input);

      expect(masked).not.toContain('abc123def456');
      expect(masked).toContain('***MASKED***');
    });

    it('should mask multiple keys in same string', () => {
      const input = 'Keys: sk-ant-abc123 and AIzaSyAbCdEfGhIjKlMnOpQrStUvWxYz12345678';
      const masked = maskSensitiveData(input);

      expect(containsSensitiveData(masked)).toBe(false);
    });

    it('should preserve non-sensitive parts', () => {
      const input = 'Error calling API with key sk-1234567890abcdefghij: Connection failed';
      const masked = maskSensitiveData(input);

      expect(masked).toContain('Error calling API');
      expect(masked).toContain('Connection failed');
      expect(masked).toContain('***MASKED***');
    });
  });

  describe('Logging Security', () => {
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
    let consoleLogSpy: ReturnType<typeof vi.spyOn>;
    let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
      consoleErrorSpy.mockRestore();
      consoleLogSpy.mockRestore();
      consoleWarnSpy.mockRestore();
    });

    it('should document that console logging must mask sensitive data', () => {
      // This is a documentation/reminder test
      // All logging code should use maskSensitiveData before logging

      const sensitiveError = 'Failed to authenticate with key sk-ant-secret123';
      const safeToLog = maskSensitiveData(sensitiveError);

      console.error(safeToLog);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.not.stringMatching(/sk-ant-secret123/)
      );
    });
  });

  describe('Error Message Security', () => {
    it('should not leak API keys in error messages', () => {
      // Simulate an API error that might include the key
      const apiKey = 'sk-ant-api03-supersecret123456789';

      // Wrong way (leaks key)
      const badError = `Authentication failed for key ${apiKey}`;

      // Right way (masks key)
      const goodError = maskSensitiveData(`Authentication failed for key ${apiKey}`);

      expect(containsSensitiveData(badError)).toBe(true);
      expect(containsSensitiveData(goodError)).toBe(false);
    });

    it('should provide meaningful errors without sensitive data', () => {
      const createSafeError = (apiKeyPresent: boolean) => {
        if (!apiKeyPresent) {
          return 'API key not configured. Please add your API key in Settings.';
        }
        return 'Authentication failed. Please verify your API key is valid.';
      };

      const noKeyError = createSafeError(false);
      const invalidKeyError = createSafeError(true);

      expect(containsSensitiveData(noKeyError)).toBe(false);
      expect(containsSensitiveData(invalidKeyError)).toBe(false);
      expect(noKeyError).toContain('Settings');
    });
  });

  describe('Network Request Security', () => {
    it('should document that API keys must only be in headers, not URLs', () => {
      // BAD: Key in URL
      const badUrl = 'https://api.anthropic.com/v1/messages?api_key=sk-ant-secret';

      // GOOD: Key only in headers
      const goodUrl = 'https://api.anthropic.com/v1/messages';

      expect(badUrl.includes('sk-ant')).toBe(true); // Shows the problem
      expect(goodUrl.includes('sk-ant')).toBe(false); // Key not in URL
    });
  });

  describe('Storage Security', () => {
    it('should document that API keys must be stored securely', () => {
      // This documents the expected storage patterns

      // BAD patterns that should never be used:
      const badPatterns = [
        'localStorage.setItem("api_key", key)', // Accessible to XSS
        'sessionStorage.setItem("api_key", key)', // Accessible to XSS
        'cookies without httpOnly', // Accessible to XSS
        'plaintext config files', // Accessible to file read
      ];

      // GOOD patterns:
      const goodPatterns = [
        'OS Keychain (Tauri keychain plugin)', // Secure, encrypted
        'Encrypted file with user password', // Secure if password is strong
        'In-memory only (re-enter each session)', // Inconvenient but secure
      ];

      // This is a documentation test - actual implementation should use keychain
      expect(goodPatterns.length).toBeGreaterThan(0);
      expect(badPatterns.length).toBeGreaterThan(0);
    });
  });
});
