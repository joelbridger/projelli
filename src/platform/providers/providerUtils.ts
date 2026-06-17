/**
 * Stream A1 — Shared utilities for provider implementations.
 */

/** Convert Uint8Array to base64 string (browser-safe, no Node Buffer). */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i] as number);
  }
  return btoa(binary);
}
