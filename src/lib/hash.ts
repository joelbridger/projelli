/**
 * Compute the SHA-256 hex digest of a byte array using the Web Crypto API.
 * Works in both browser and Tauri (Node-compatible) environments.
 */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
